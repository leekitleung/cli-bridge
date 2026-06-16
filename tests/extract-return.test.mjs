import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Readable } from 'node:stream';

import {
  ALLOWED_EXTENSION_ORIGIN,
  PAIRING_TOKEN_HEADER,
} from '../packages/shared/src/constants.ts';
import { startLocalServer } from '../apps/local-server/src/server.ts';
import {
  createBridgeRuntime,
  handleBridgeRequest,
} from '../apps/local-server/src/routes/bridge-api.ts';

const root = process.cwd();

function closer(handle) {
  return async () => {
    await new Promise((resolve, reject) => {
      handle.server.close((error) => (error ? reject(error) : resolve(undefined)));
    });
  };
}

function authHeaders(handle, extra = {}) {
  return {
    origin: ALLOWED_EXTENSION_ORIGIN,
    [PAIRING_TOKEN_HEADER]: handle.pairingToken,
    'content-type': 'application/json',
    ...extra,
  };
}

function jsonRequest(body) {
  return Readable.from([Buffer.from(JSON.stringify(body))]);
}

// ── inbound-capable routing (direct runtime: register a capable endpoint) ──

test('extract-return routes to inbound when relay context resolves an inbound-capable endpoint', async () => {
  const runtime = createBridgeRuntime();
  runtime.endpointRegistry.register({
    id: 'inbox-cli',
    label: 'Inbox CLI',
    transport: 'mock',
    risk: 'low',
    capabilities: {
      canAcceptPrompt: false,
      canReturnOutput: true,
      canReview: false,
      canExecute: false,
      canSummarize: false,
      canReceiveInbound: true,
    },
  });
  // Establish a delivered relay context for the session.
  runtime.relayContextStore.recordDelivered('s-inbox', 'inbox-cli', 'out-1');

  const result = await handleBridgeRequest(
    runtime,
    'POST',
    '/bridge/extract-return',
    jsonRequest({ sessionId: 's-inbox', content: 'reviewed reply' }),
  );

  assert.equal(result.statusCode, 201);
  assert.equal(result.payload.routedTo, 'inbound');
  assert.equal(result.payload.inboundMessage.endpointId, 'inbox-cli');
  assert.equal(result.payload.inboundMessage.status, 'queued');
  // Routed inbound message is visible to that endpoint only.
  const list = runtime.inboundMessageStore.list({ endpointId: 'inbox-cli' });
  assert.equal(list.length, 1);
});

test('extract-return ignores any endpointId in the body (never trusted)', async () => {
  const runtime = createBridgeRuntime();
  runtime.endpointRegistry.register({
    id: 'inbox-cli',
    label: 'Inbox CLI',
    transport: 'mock',
    risk: 'low',
    capabilities: {
      canAcceptPrompt: false,
      canReturnOutput: true,
      canReview: false,
      canExecute: false,
      canSummarize: false,
      canReceiveInbound: true,
    },
  });
  runtime.relayContextStore.recordDelivered('s-inbox', 'inbox-cli', 'out-1');

  // Body carries a bogus endpointId; server must ignore it and use the context.
  const result = await handleBridgeRequest(
    runtime,
    'POST',
    '/bridge/extract-return',
    jsonRequest({ sessionId: 's-inbox', content: 'x', endpointId: 'attacker-endpoint' }),
  );
  assert.equal(result.payload.routedTo, 'inbound');
  assert.equal(result.payload.inboundMessage.endpointId, 'inbox-cli');
});

test('extract-return falls back to pending prompt when the endpoint cannot receive inbound', async () => {
  const runtime = createBridgeRuntime();
  // codex-cli is a default endpoint WITHOUT canReceiveInbound.
  runtime.relayContextStore.recordDelivered('s-codex', 'codex-cli', 'out-1');

  const result = await handleBridgeRequest(
    runtime,
    'POST',
    '/bridge/extract-return',
    jsonRequest({ sessionId: 's-codex', content: 'reply' }),
  );
  assert.equal(result.statusCode, 201);
  assert.equal(result.payload.routedTo, 'pending-prompt');
  assert.equal(result.payload.fallbackReason, 'endpoint-cannot-receive-inbound');
  assert.equal(result.payload.pendingPrompt.status, 'draft');
});

// ── fallback over real HTTP (default registry, no inbound-capable endpoint) ──

test('extract-return falls back to pending prompt when there is no relay context', async (t) => {
  const handle = await startLocalServer(0);
  t.after(closer(handle));

  const res = await fetch(`${handle.url}/bridge/extract-return`, {
    method: 'POST',
    headers: authHeaders(handle),
    body: JSON.stringify({ sessionId: 'no-ctx', content: 'reply text' }),
  });
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.routedTo, 'pending-prompt');
  assert.equal(body.fallbackReason, 'no-relay-context');

  // The v0.2 pending-prompt path still works: it shows up in the list.
  const list = await fetch(`${handle.url}/bridge/pending-prompts`, { headers: authHeaders(handle) });
  const prompts = (await list.json()).pendingPrompts;
  assert.equal(prompts.some((p) => p.id === body.pendingPrompt.id), true);
});

test('extract-return rejects missing sessionId/content', async (t) => {
  const handle = await startLocalServer(0);
  t.after(closer(handle));
  const res = await fetch(`${handle.url}/bridge/extract-return`, {
    method: 'POST',
    headers: authHeaders(handle),
    body: JSON.stringify({ sessionId: 'x' }),
  });
  assert.equal(res.status, 400);
});

// ── client + panel wiring (source assertions) ──

test('bridge-client exposes createExtractReturn and keeps createPendingPrompt', async () => {
  const source = await readFile(resolve(root, 'apps/extension/src/content/bridge-client.ts'), 'utf8');
  assert.equal(source.includes("'/bridge/extract-return'"), true);
  assert.equal(source.includes('export function createExtractReturn'), true);
  // Backward-compatible helper is not removed.
  assert.equal(source.includes('export function createPendingPrompt'), true);
});

test('Bridge Panel extract routes via createExtractReturn, not a direct pending prompt', async () => {
  const source = await readFile(resolve(root, 'apps/extension/src/ui/bridge-panel.tsx'), 'utf8');
  // The extract path resolves its session from the active relay session (or the
  // panel session fallback) before routing via createExtractReturn.
  assert.equal(source.includes('createExtractReturn(extractSessionId'), true);
  assert.equal(source.includes('createExtractRoutePanelStatus'), true);
  // The panel no longer calls createPendingPrompt directly on the extract path.
  assert.equal(source.includes('createPendingPrompt('), false);
  // No endpointId is supplied by the panel for routing.
  assert.equal(source.includes('endpointId'), false);
  // Security boundary holds.
  assert.equal(source.includes('send-button'), false);
  assert.equal(source.includes('requestSubmit'), false);
  assert.equal(source.includes('KeyboardEvent'), false);
});
