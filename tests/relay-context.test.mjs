import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ALLOWED_EXTENSION_ORIGIN,
  PAIRING_TOKEN_HEADER,
} from '../packages/shared/src/constants.ts';
import { startLocalServer } from '../apps/local-server/src/server.ts';
import { InMemoryAuditLog } from '../apps/local-server/src/storage/audit-log.ts';
import { InMemoryRelayContextStore } from '../apps/local-server/src/storage/relay-context-store.ts';
import { InMemoryEndpointRegistry } from '../apps/local-server/src/endpoints/endpoint-registry.ts';

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

function endpoint(id, capabilities = {}) {
  return {
    id,
    label: id,
    transport: 'mock',
    risk: 'low',
    capabilities: {
      canAcceptPrompt: false,
      canReturnOutput: false,
      canReview: false,
      canExecute: false,
      canSummarize: false,
      ...capabilities,
    },
  };
}

// ── endpoint-registry capability: canReceiveInbound ──

test('endpoint capability canReceiveInbound defaults false and gates receive-inbound', () => {
  const registry = new InMemoryEndpointRegistry([
    endpoint('legacy'),
    endpoint('inbox', { canReceiveInbound: true }),
  ]);

  // Default (field absent) → false.
  assert.equal(registry.can('legacy', 'receive-inbound'), false);
  assert.equal(registry.validateAction('legacy', 'receive-inbound').ok, false);
  assert.equal(registry.validateAction('legacy', 'receive-inbound').failureReason, 'capability-denied');

  // Explicit true → allowed.
  assert.equal(registry.can('inbox', 'receive-inbound'), true);
  assert.equal(registry.validateAction('inbox', 'receive-inbound').ok, true);

  // Unknown endpoint → denied.
  assert.equal(registry.can('nope', 'receive-inbound'), false);
});

// ── RelayContextStore unit ──

test('relay context store binds a session to one endpoint and rejects conflicts', () => {
  const audit = new InMemoryAuditLog();
  const store = new InMemoryRelayContextStore(audit);

  assert.deepEqual(store.bind('s1', 'codex-cli'), { ok: true, endpointId: 'codex-cli' });
  assert.equal(store.getBoundEndpoint('s1'), 'codex-cli');

  // Idempotent re-bind of the same endpoint: ok, no second bound event.
  assert.equal(store.bind('s1', 'codex-cli').ok, true);

  // Conflicting endpoint for the same session: rejected.
  const conflict = store.bind('s1', 'claude-code');
  assert.equal(conflict.ok, false);
  assert.equal(conflict.failureReason, 'session-endpoint-conflict');
  assert.equal(store.getBoundEndpoint('s1'), 'codex-cli');

  const types = audit.listEvents().map((e) => e.type);
  assert.equal(types.filter((t) => t === 'relay_context_bound').length, 1);
  assert.equal(types.filter((t) => t === 'relay_context_conflict').length, 1);
});

test('relay context store records delivered context and resolves inbound endpoint', () => {
  const audit = new InMemoryAuditLog();
  const store = new InMemoryRelayContextStore(audit);

  // No delivered context yet.
  assert.equal(store.getRelayContext('s2'), undefined);
  assert.equal(store.resolveInboundEndpointForSession('s2'), undefined);

  const ctx = store.recordDelivered('s2', 'codex-cli', 'out-1', 1000);
  assert.deepEqual(ctx, {
    sessionId: 's2',
    endpointId: 'codex-cli',
    lastOutboundPromptId: 'out-1',
    updatedAt: 1000,
  });
  assert.equal(store.resolveInboundEndpointForSession('s2'), 'codex-cli');

  // A later delivery updates lastOutboundPromptId.
  store.recordDelivered('s2', 'codex-cli', 'out-2', 2000);
  assert.equal(store.getRelayContext('s2').lastOutboundPromptId, 'out-2');

  assert.equal(
    audit.listEvents().filter((e) => e.type === 'relay_context_delivered').length,
    2,
  );
});

// ── HTTP: outbound endpointId acceptance + binding ──

test('POST /bridge/outbound without endpointId keeps legacy behavior', async (t) => {
  const handle = await startLocalServer(0);
  t.after(closer(handle));

  const res = await fetch(`${handle.url}/bridge/outbound`, {
    method: 'POST',
    headers: authHeaders(handle),
    body: JSON.stringify({ sessionId: 's-legacy', prompt: 'hello' }),
  });
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.outboundPrompt.status, 'queued');
  assert.equal(body.outboundPrompt.endpointId, undefined);
});

test('POST /bridge/outbound rejects an unknown endpointId', async (t) => {
  const handle = await startLocalServer(0);
  t.after(closer(handle));

  const res = await fetch(`${handle.url}/bridge/outbound`, {
    method: 'POST',
    headers: authHeaders(handle),
    body: JSON.stringify({ sessionId: 's-x', prompt: 'hi', endpointId: 'does-not-exist' }),
  });
  assert.equal(res.status, 400);
});

test('POST /bridge/outbound rejects client-selected endpoint routing', async (t) => {
  const handle = await startLocalServer(0);
  t.after(closer(handle));

  const first = await fetch(`${handle.url}/bridge/outbound`, {
    method: 'POST',
    headers: authHeaders(handle),
    body: JSON.stringify({ sessionId: 's-a', prompt: 'one', endpointId: 'codex-cli' }),
  });
  assert.equal(first.status, 400);
  assert.match((await first.json()).message, /server-owned/i);
});

test('server-configured outbound endpoint round-trips through claim and manual-send wait ack', async (t) => {
  const handle = await startLocalServer(0, {
    inboundRelayEndpointId: 'mock-inbound-agent',
  });
  t.after(closer(handle));

  const create = await fetch(`${handle.url}/bridge/outbound`, {
    method: 'POST',
    headers: authHeaders(handle),
    body: JSON.stringify({ sessionId: 's-b', prompt: 'review me' }),
  });
  const created = await create.json();
  const id = created.outboundPrompt.id;

  const claim = await fetch(`${handle.url}/bridge/outbound/next`, { headers: authHeaders(handle) });
  const claimed = (await claim.json()).outboundPrompt;
  assert.equal(claimed.id, id);

  const ack = await fetch(`${handle.url}/bridge/outbound/ack`, {
    method: 'POST',
    headers: authHeaders(handle),
    body: JSON.stringify({ outboundPromptId: id, claimToken: claimed.claimToken, ok: true }),
  });
  const acked = await ack.json();
  assert.equal(acked.outboundPrompt.status, 'waiting_manual_send');
  assert.equal(acked.outboundPrompt.endpointId, 'mock-inbound-agent');
});
