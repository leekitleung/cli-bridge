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

test('full outbound→deliver→extract-return chain uses the server-configured endpoint and is idempotent', async () => {
  const endpointId = 'mock-inbound-agent';
  const runtime = createBridgeRuntime({ inboundRelayEndpointId: endpointId });
  const sessionId = 's-e2e';

  // 1. The client cannot choose an endpoint. The runtime owns that decision.
  const outboundCreate = await handleBridgeRequest(
    runtime,
    'POST',
    '/bridge/outbound',
    jsonRequest({ sessionId, prompt: 'review this output' }),
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
    jsonRequest({ outboundPromptId, claimToken: claim.payload.outboundPrompt.claimToken, ok: true }),
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
    jsonRequest({
      sessionId,
      content: 'reviewed reply from chatgpt',
      operationId: outboundPromptId,
    }),
  );
  assert.equal(extract.statusCode, 201);
  assert.equal(extract.payload.routedTo, 'inbound');
  const inboundId = extract.payload.inboundMessage.id;
  assert.equal(extract.payload.inboundMessage.endpointId, endpointId);
  assert.equal(extract.payload.inboundMessage.status, 'queued');

  const replay = await handleBridgeRequest(
    runtime,
    'POST',
    '/bridge/extract-return',
    jsonRequest({
      sessionId,
      content: 'reviewed reply from chatgpt',
      operationId: outboundPromptId,
    }),
  );
  assert.equal(replay.statusCode, 200);
  assert.equal(replay.payload.replayed, true);
  assert.equal(replay.payload.inboundMessage.id, inboundId);
  assert.equal(runtime.inboundMessageStore.summary().total, 1);

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

test('outbound rejects client endpoint selection and validates the trusted runtime endpoint', async () => {
  const runtime = createBridgeRuntime({ inboundRelayEndpointId: 'mock-inbound-agent' });
  const rejected = await handleBridgeRequest(
    runtime,
    'POST',
    '/bridge/outbound',
    jsonRequest({
      sessionId: 's-client-route',
      prompt: 'review',
      endpointId: 'codex-cli',
    }),
  );
  assert.equal(rejected.statusCode, 400);
  assert.match(rejected.payload.message, /endpointId/i);

  assert.throws(
    () => createBridgeRuntime({ inboundRelayEndpointId: 'not-registered' }),
    /inboundRelayEndpointId/i,
  );
});

test('extract-return rejects a mismatched operation id and conflicting replay content', async () => {
  const runtime = createBridgeRuntime({ inboundRelayEndpointId: 'mock-inbound-agent' });
  const sessionId = 's-operation';
  const created = await handleBridgeRequest(
    runtime,
    'POST',
    '/bridge/outbound',
    jsonRequest({ sessionId, prompt: 'review' }),
  );
  const claim = await handleBridgeRequest(runtime, 'GET', '/bridge/outbound/next', null);
  await handleBridgeRequest(
    runtime,
    'POST',
    '/bridge/outbound/ack',
    jsonRequest({
      outboundPromptId: created.payload.outboundPrompt.id,
      claimToken: claim.payload.outboundPrompt.claimToken,
      ok: true,
    }),
  );

  const mismatch = await handleBridgeRequest(
    runtime,
    'POST',
    '/bridge/extract-return',
    jsonRequest({ sessionId, content: 'reply', operationId: 'wrong-operation' }),
  );
  assert.equal(mismatch.statusCode, 409);

  const first = await handleBridgeRequest(
    runtime,
    'POST',
    '/bridge/extract-return',
    jsonRequest({
      sessionId,
      content: 'reply',
      operationId: created.payload.outboundPrompt.id,
    }),
  );
  assert.equal(first.statusCode, 201);

  const conflict = await handleBridgeRequest(
    runtime,
    'POST',
    '/bridge/extract-return',
    jsonRequest({
      sessionId,
      content: 'different reply',
      operationId: created.payload.outboundPrompt.id,
    }),
  );
  assert.equal(conflict.statusCode, 409);
  assert.equal(runtime.inboundMessageStore.summary().total, 1);
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

test('runtime rejects a configured endpoint that cannot receive inbound', async () => {
  assert.throws(
    () => createBridgeRuntime({ inboundRelayEndpointId: 'codex-cli' }),
    /cannot receive inbound/i,
  );
});

test('a failed outbound ack does NOT write a relay context, so extract-return falls back', async () => {
  const sessionId = 's-failed-ack';
  const runtime = createBridgeRuntime({ inboundRelayEndpointId: 'mock-inbound-agent' });

  const outboundCreate = await handleBridgeRequest(
    runtime,
    'POST',
    '/bridge/outbound',
    jsonRequest({ sessionId, prompt: 'p' }),
  );
  const outboundPromptId = outboundCreate.payload.outboundPrompt.id;
  const claim = await handleBridgeRequest(runtime, 'GET', '/bridge/outbound/next', null);
  // Ack with ok=false (fill failed): no relay context should be recorded.
  await handleBridgeRequest(
    runtime,
    'POST',
    '/bridge/outbound/ack',
    jsonRequest({
      outboundPromptId,
      claimToken: claim.payload.outboundPrompt.claimToken,
      ok: false,
      failureReason: 'composer-not-found',
    }),
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
