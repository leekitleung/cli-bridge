import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  clearActiveRelaySession,
  getActiveRelaySession,
  setActiveRelaySession,
} from '../apps/extension/src/content/active-relay-session.ts';

const root = process.cwd();

test('active relay session starts empty and clears back to null', () => {
  clearActiveRelaySession();
  assert.equal(getActiveRelaySession(), null);
  setActiveRelaySession({
    sessionId: 's1',
    outboundPromptId: 'out-1',
    packetId: 'pk-1',
    updatedAt: 10,
  });
  assert.notEqual(getActiveRelaySession(), null);
  clearActiveRelaySession();
  assert.equal(getActiveRelaySession(), null);
});

test('active relay session stores a defensive copy (get returns a snapshot)', () => {
  clearActiveRelaySession();
  const input = {
    sessionId: 's-copy',
    outboundPromptId: 'out-copy',
    packetId: 'pk-copy',
    updatedAt: 1,
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
    updatedAt: 1,
  });
  setActiveRelaySession({
    sessionId: 's-new',
    outboundPromptId: 'out-new',
    packetId: 'pk-new',
    updatedAt: 2,
  });
  const stored = getActiveRelaySession();
  assert.equal(stored.sessionId, 's-new');
  assert.equal(stored.outboundPromptId, 'out-new');
  assert.equal(stored.packetId, 'pk-new');
  assert.equal(stored.updatedAt, 2);
  clearActiveRelaySession();
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

test('Bridge Panel uses the active relay session for extract and clears it on token clear', async () => {
  const source = await readFile(
    resolve(root, 'apps/extension/src/ui/bridge-panel.tsx'),
    'utf8',
  );
  assert.equal(source.includes('getActiveRelaySession'), true);
  assert.equal(source.includes('clearActiveRelaySession'), true);
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
  assert.equal(source.includes('no active relay session'), true);
  assert.equal(source.includes('active relay session: '), true);
  // The status is derived from the active relay session (session only).
  assert.equal(source.includes('renderRelayStatus'), true);
  // Clearing the token also clears + re-renders the relay status to none.
  const clearHandler = source.slice(source.indexOf('clearTokenButton.addEventListener'));
  const clearBlock = clearHandler.slice(0, clearHandler.indexOf('});'));
  assert.equal(clearBlock.includes('clearActiveRelaySession()'), true);
  assert.equal(clearBlock.includes('renderRelayStatus()'), true);
  // Observability never introduces an endpoint routing target in the panel.
  assert.equal(source.includes('endpointId'), false);
});
