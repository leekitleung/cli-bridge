import assert from 'node:assert/strict';
import test from 'node:test';
import { Readable } from 'node:stream';

import {
  createBridgeRuntime,
  handleBridgeRequest,
} from '../apps/local-server/src/routes/bridge-api.ts';

// REVIEW-INBOUND-ROUTING-E2E evidence.
//
// Unlike tests/extract-return.test.mjs (which injects recordDelivered directly),
// this drives the REAL outbound lifecycle end to end through the route handlers:
//   POST /bridge/outbound (with endpointId)
//     -> GET /bridge/outbound/next (claim)
//     -> POST /bridge/outbound/ack ok=true   (this is what writes relay context)
//     -> POST /bridge/extract-return         (must route to inbound, not pending)
//     -> GET /bridge/inbound/next (claim)
//     -> POST /bridge/inbound/ack ok=true     (consumed)
// It proves the panel's "提取" path reaches the inbound queue once an outbound
// has actually been delivered for that session.

function jsonRequest(body) {
  return Readable.from([Buffer.from(JSON.stringify(body))]);
}

function registerInboundCapable(runtime, id) {
  runtime.endpointRegistry.register({
    id,
    label: id,
    transport: 'mock',
    risk: 'low',
    capabilities: {
      canAcceptPrompt: true,
      canReturnOutput: true,
      canReview: false,
      canExecute: false,
      canSummarize: false,
      canReceiveInbound: true,
    },
  });
}

test('full outbound→deliver→extract-return chain routes the reply into the inbound queue', async () => {
  const runtime = createBridgeRuntime();
  const endpointId = 'e2e-cli';
  const sessionId = 's-e2e';
  registerInboundCapable(runtime, endpointId);

  // 1. Create outbound prompt carrying the endpointId (binds session→endpoint).
  const outboundCreate = await handleBridgeRequest(
    runtime,
    'POST',
    '/bridge/outbound',
    jsonRequest({ sessionId, prompt: 'review this output', endpointId }),
  );
  assert.equal(outboundCreate.statusCode, 201);
  const outboundPromptId = outboundCreate.payload.outboundPrompt.id;
  assert.equal(outboundCreate.payload.outboundPrompt.endpointId, endpointId);

  // 2. Claim it (as the extension poller would).
  const claim = await handleBridgeRequest(runtime, 'GET', '/bridge/outbound/next', null);
  assert.equal(claim.statusCode, 200);
  assert.equal(claim.payload.outboundPrompt.id, outboundPromptId);
  assert.equal(claim.payload.outboundPrompt.status, 'claimed');

  // 3. Ack delivery ok — THIS writes the relay context.
  const ack = await handleBridgeRequest(
    runtime,
    'POST',
    '/bridge/outbound/ack',
    jsonRequest({ outboundPromptId, ok: true }),
  );
  assert.equal(ack.statusCode, 200);
  assert.equal(ack.payload.outboundPrompt.status, 'delivered');

  // Relay context now resolves the originating endpoint for this session.
  const ctx = runtime.relayContextStore.getRelayContext(sessionId);
  assert.equal(ctx.sessionId, sessionId);
  assert.equal(ctx.endpointId, endpointId);
  assert.equal(ctx.lastOutboundPromptId, outboundPromptId);

  // 4. Extract-return for the SAME session must route to inbound (not fallback).
  const extract = await handleBridgeRequest(
    runtime,
    'POST',
    '/bridge/extract-return',
    jsonRequest({ sessionId, content: 'reviewed reply from chatgpt' }),
  );
  assert.equal(extract.statusCode, 201);
  assert.equal(extract.payload.routedTo, 'inbound');
  const inboundId = extract.payload.inboundMessage.id;
  assert.equal(extract.payload.inboundMessage.endpointId, endpointId);
  assert.equal(extract.payload.inboundMessage.status, 'queued');

  // 5. The executor pulls it from the inbound queue (claim).
  const inboundClaim = await handleBridgeRequest(
    runtime,
    'GET',
    '/bridge/inbound/next',
    null,
    new URLSearchParams({ endpointId }),
  );
  assert.equal(inboundClaim.statusCode, 200);
  assert.equal(inboundClaim.payload.inboundMessage.id, inboundId);
  assert.equal(inboundClaim.payload.inboundMessage.status, 'claimed');

  // 6. Executor acks consumption.
  const inboundAck = await handleBridgeRequest(
    runtime,
    'POST',
    '/bridge/inbound/ack',
    jsonRequest({ inboundMessageId: inboundId, endpointId, ok: true }),
  );
  assert.equal(inboundAck.statusCode, 200);
  assert.equal(inboundAck.payload.inboundMessage.status, 'consumed');
});

test('extract-return for a session with no delivered outbound still falls back to pending-prompt', async () => {
  const runtime = createBridgeRuntime();
  const extract = await handleBridgeRequest(
    runtime,
    'POST',
    '/bridge/extract-return',
    jsonRequest({ sessionId: 'no-ctx-e2e', content: 'reply without context' }),
  );
  assert.equal(extract.statusCode, 201);
  assert.equal(extract.payload.routedTo, 'pending-prompt');
  assert.equal(extract.payload.fallbackReason, 'no-relay-context');
  // Nothing landed in any inbound queue.
  assert.equal(runtime.inboundMessageStore.summary().total, 0);
});

test('extract-return falls back when the delivered endpoint cannot receive inbound', async () => {
  const runtime = createBridgeRuntime();
  const sessionId = 's-incapable';
  const endpointId = 'plain-cli';
  // Register an endpoint WITHOUT canReceiveInbound.
  runtime.endpointRegistry.register({
    id: endpointId,
    label: endpointId,
    transport: 'mock',
    risk: 'low',
    capabilities: {
      canAcceptPrompt: true,
      canReturnOutput: true,
      canReview: false,
      canExecute: false,
      canSummarize: false,
      canReceiveInbound: false,
    },
  });

  const outboundCreate = await handleBridgeRequest(
    runtime,
    'POST',
    '/bridge/outbound',
    jsonRequest({ sessionId, prompt: 'p', endpointId }),
  );
  const outboundPromptId = outboundCreate.payload.outboundPrompt.id;
  await handleBridgeRequest(runtime, 'GET', '/bridge/outbound/next', null);
  await handleBridgeRequest(
    runtime,
    'POST',
    '/bridge/outbound/ack',
    jsonRequest({ outboundPromptId, ok: true }),
  );

  const extract = await handleBridgeRequest(
    runtime,
    'POST',
    '/bridge/extract-return',
    jsonRequest({ sessionId, content: 'reply' }),
  );
  assert.equal(extract.payload.routedTo, 'pending-prompt');
  assert.equal(extract.payload.fallbackReason, 'endpoint-cannot-receive-inbound');
  assert.equal(runtime.inboundMessageStore.summary().total, 0);
});

test('a failed outbound ack does NOT write a relay context, so extract-return falls back', async () => {
  const runtime = createBridgeRuntime();
  const sessionId = 's-failed-ack';
  const endpointId = 'e2e-cli-2';
  registerInboundCapable(runtime, endpointId);

  const outboundCreate = await handleBridgeRequest(
    runtime,
    'POST',
    '/bridge/outbound',
    jsonRequest({ sessionId, prompt: 'p', endpointId }),
  );
  const outboundPromptId = outboundCreate.payload.outboundPrompt.id;
  await handleBridgeRequest(runtime, 'GET', '/bridge/outbound/next', null);
  // Ack with ok=false (fill failed): no relay context should be recorded.
  await handleBridgeRequest(
    runtime,
    'POST',
    '/bridge/outbound/ack',
    jsonRequest({ outboundPromptId, ok: false, failureReason: 'composer-not-found' }),
  );
  assert.equal(runtime.relayContextStore.getRelayContext(sessionId), undefined);

  const extract = await handleBridgeRequest(
    runtime,
    'POST',
    '/bridge/extract-return',
    jsonRequest({ sessionId, content: 'reply' }),
  );
  assert.equal(extract.payload.routedTo, 'pending-prompt');
  assert.equal(extract.payload.fallbackReason, 'no-relay-context');
});
