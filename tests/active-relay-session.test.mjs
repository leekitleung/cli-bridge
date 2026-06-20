import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  clearActiveRelaySession,
  cancelActiveRelaySession,
  consumeActiveRelaySession,
  getActiveRelaySession,
  getRelaySessionSnapshot,
  recordRelaySessionStage,
  submitExtractReturn,
  setActiveRelaySession,
} from '../apps/extension/src/content/active-relay-session.ts';

const root = process.cwd();

test('active relay session starts empty and clears back to null', () => {
  clearActiveRelaySession();
  recordRelaySessionStage('unpaired', { now: 1 });
  assert.equal(getActiveRelaySession(), null);
  setActiveRelaySession({
    sessionId: 's1',
    outboundPromptId: 'out-1',
    packetId: 'pk-1',
    updatedAt: Date.now(),
  });
  assert.notEqual(getActiveRelaySession(), null);
  clearActiveRelaySession();
  assert.equal(getActiveRelaySession(), null);
});

test('relay session state machine records sanitized Stage A evidence', () => {
  clearActiveRelaySession();
  recordRelaySessionStage('paired', { now: 1 });
  recordRelaySessionStage('claiming', { now: 2 });
  recordRelaySessionStage('failed', { now: 3, reason: 'network-error' });

  const snapshot = getRelaySessionSnapshot();
  assert.equal(snapshot.stage, 'failed');
  assert.deepEqual(snapshot.evidence.map((event) => event.stage).slice(-3), [
    'paired',
    'claiming',
    'failed',
  ]);
  assert.equal(JSON.stringify(snapshot).includes('tok-'), false);
  assert.equal('endpointId' in snapshot, false);
});

test('cancelActiveRelaySession clears active route and records cancellation', () => {
  setActiveRelaySession({
    sessionId: 's-cancel',
    outboundPromptId: 'out-cancel',
    packetId: 'pk-cancel',
    updatedAt: 1,
  });
  cancelActiveRelaySession('pairing-cleared');
  assert.equal(getActiveRelaySession(), null);
  const snapshot = getRelaySessionSnapshot();
  assert.equal(snapshot.stage, 'cancelled');
  assert.equal(snapshot.evidence.at(-1).reason, 'pairing-cleared');
});

test('active relay session stores a defensive copy (get returns a snapshot)', () => {
  clearActiveRelaySession();
  const input = {
    sessionId: 's-copy',
    outboundPromptId: 'out-copy',
    packetId: 'pk-copy',
    updatedAt: Date.now(),
  };
  setActiveRelaySession(input);
  // Mutating the original input must not affect the stored value.
  input.sessionId = 'mutated';
  const stored = getActiveRelaySession();
  assert.equal(stored.sessionId, 's-copy');
  // Mutating the returned snapshot must not affect subsequent reads.
  stored.sessionId = 'mutated-again';
  assert.equal(getActiveRelaySession().sessionId, 's-copy');
  clearActiveRelaySession();
});

test('active relay session replaces the previous value on set', () => {
  clearActiveRelaySession();
  setActiveRelaySession({
    sessionId: 's-old',
    outboundPromptId: 'out-old',
    packetId: 'pk-old',
    updatedAt: Date.now(),
  });
  setActiveRelaySession({
    sessionId: 's-new',
    outboundPromptId: 'out-new',
    packetId: 'pk-new',
    updatedAt: Date.now(),
  });
  const stored = getActiveRelaySession();
  assert.equal(stored.sessionId, 's-new');
  assert.equal(stored.outboundPromptId, 'out-new');
  assert.equal(stored.packetId, 'pk-new');
  assert.equal(typeof stored.updatedAt, 'number');
  clearActiveRelaySession();
});

test('active relay session expires stale entries and can be consumed once', () => {
  clearActiveRelaySession();
  setActiveRelaySession({
    sessionId: 's-stale',
    outboundPromptId: 'out-stale',
    packetId: 'pk-stale',
    updatedAt: 1,
  });
  assert.equal(getActiveRelaySession({ now: () => 1_000_002 }), null);

  setActiveRelaySession({
    sessionId: 's-fresh',
    outboundPromptId: 'out-fresh',
    packetId: 'pk-fresh',
    updatedAt: 2_000,
  });
  const consumed = consumeActiveRelaySession({ now: () => 2_100 });
  assert.equal(consumed.sessionId, 's-fresh');
  assert.equal(getActiveRelaySession({ now: () => 2_101 }), null);
});

test('extract return keeps the active route on failure and clears it only after success', async () => {
  clearActiveRelaySession();
  setActiveRelaySession({
    sessionId: 'session-retry',
    outboundPromptId: 'out-retry',
    packetId: 'packet-retry',
    updatedAt: Date.now(),
  });
  const sessions = [];
  const operationIds = [];
  const failed = await submitExtractReturn('reviewed result', 'fallback-session', async (sessionId, _content, operationId) => {
    sessions.push(sessionId);
    operationIds.push(operationId);
    return { ok: false, status: 0, error: 'network-error' };
  });
  assert.equal(failed.ok, false);
  assert.equal(getActiveRelaySession().sessionId, 'session-retry');

  const succeeded = await submitExtractReturn('reviewed result', 'fallback-session', async (sessionId, _content, operationId) => {
    sessions.push(sessionId);
    operationIds.push(operationId);
    return { ok: true, status: 201, data: { routedTo: 'inbound' } };
  });
  assert.equal(succeeded.ok, true);
  assert.deepEqual(sessions, ['session-retry', 'session-retry']);
  assert.deepEqual(operationIds, ['out-retry', 'out-retry']);
  assert.equal(getActiveRelaySession(), null);
});

test('active relay session module records no endpointId by design', async () => {
  const source = await readFile(
    resolve(root, 'apps/extension/src/content/active-relay-session.ts'),
    'utf8',
  );
  // The content script never asserts a routing target; the server resolves it
  // from the relay context. So the interface must not carry an endpointId field.
  assert.equal(/endpointId\s*[:?]/.test(source), false);
  // Security boundary holds for this newly wired module too.
  assert.equal(source.includes('send-button'), false);
  assert.equal(source.includes('requestSubmit'), false);
  assert.equal(source.includes('KeyboardEvent'), false);
  assert.equal(source.includes('.submit('), false);
});

test('Stage B extension modules avoid forbidden submit primitives and later scopes', async () => {
  for (const file of [
    'apps/extension/src/content/outbound-poller.ts',
    'apps/extension/src/content/chatgpt-dom.ts',
    'apps/extension/src/content/index.ts',
    'apps/extension/src/ui/bridge-panel.tsx',
  ]) {
    const source = await readFile(resolve(root, file), 'utf8');
    assert.equal(source.includes('requestSubmit'), false, file);
    assert.equal(source.includes('KeyboardEvent'), false, file);
    assert.equal(source.includes('.submit('), false, file);
    assert.equal(source.includes('localStorage'), false, file);
    assert.equal(source.includes('document.cookie'), false, file);
    assert.equal(source.includes('/bridge/run'), false, file);
    assert.equal(source.includes('/bridge/shell'), false, file);
    assert.equal(source.includes('/bridge/exec'), false, file);
  }
});

test('Bridge Panel uses the active relay session for extract and clears it on token clear', async () => {
  const source = await readFile(
    resolve(root, 'apps/extension/src/ui/bridge-panel.tsx'),
    'utf8',
  );
  assert.equal(source.includes('getActiveRelaySession'), true);
  assert.equal(source.includes('cancelActiveRelaySession'), true);
  // The panel still never supplies a routing target for extract-return.
  assert.equal(source.includes('endpointId'), false);
});

test('Bridge Panel surfaces active relay session observability (G3) without an endpoint', async () => {
  const source = await readFile(
    resolve(root, 'apps/extension/src/ui/bridge-panel.tsx'),
    'utf8',
  );
  // A dedicated, observable status element exists.
  assert.equal(source.includes('data-cli-bridge-relay-status'), true);
  // Both the empty and active states are rendered.
  assert.equal(source.includes('no active relay session'), false);
  assert.equal(source.includes('active relay session: '), false);
  // The status is derived from the active relay session without exposing raw ids.
  assert.equal(source.includes('renderRelayStatus'), true);
  // Clearing the token also clears + re-renders the relay status to none.
  const clearHandler = source.slice(source.indexOf('clearTokenButton.addEventListener'));
  const clearBlock = clearHandler.slice(0, clearHandler.indexOf('});'));
  assert.equal(clearBlock.includes('cancelActiveRelaySession'), true);
  assert.equal(clearBlock.includes('renderRelayStatus()'), true);
  // Observability never introduces an endpoint routing target in the panel.
  assert.equal(source.includes('endpointId'), false);
});
