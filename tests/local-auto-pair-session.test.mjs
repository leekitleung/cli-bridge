// Task 1: local auto-pair session store tests.
// Exercised with Node test runner; requires --experimental-strip-types.

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createLocalAutoPairSessionStore,
} from '../apps/local-server/src/security/local-auto-pair-session.ts';

test('local auto-pair store creates console session and one-time extension claim', () => {
  const store = createLocalAutoPairSessionStore({ now: () => 1000 });
  const session = store.createConsoleSession();

  assert.equal(typeof session.consoleSessionToken, 'string');
  assert.equal(typeof session.extensionClaimNonce, 'string');
  assert.notEqual(session.consoleSessionToken, session.extensionClaimNonce);
  assert.equal(store.verifyConsoleSession(session.consoleSessionToken), true);

  const claimed = store.claimExtensionSession(session.extensionClaimNonce);
  assert.equal(claimed.ok, true);
  assert.equal(typeof claimed.extensionSessionToken, 'string');
  assert.equal(store.verifyExtensionSession(claimed.extensionSessionToken), true);

  const replay = store.claimExtensionSession(session.extensionClaimNonce);
  assert.equal(replay.ok, false);
  assert.match(replay.message, /invalid or expired/);
});

test('local auto-pair store expires and revokes sessions', () => {
  let now = 1000;
  const store = createLocalAutoPairSessionStore({
    now: () => now,
    sessionTtlMs: 100,
    claimTtlMs: 50,
  });
  const session = store.createConsoleSession();
  now = 1060;
  assert.equal(store.claimExtensionSession(session.extensionClaimNonce).ok, false);

  now = 1001;
  const fresh = store.createConsoleSession();
  const claimed = store.claimExtensionSession(fresh.extensionClaimNonce);
  assert.equal(claimed.ok, true);
  store.revokeConsoleSession(fresh.consoleSessionToken);
  assert.equal(store.verifyConsoleSession(fresh.consoleSessionToken), false);
  assert.equal(store.verifyExtensionSession(claimed.extensionSessionToken), false);
});

test('local auto-pair store revokes sessions by extension token', () => {
  const store = createLocalAutoPairSessionStore({ now: () => 1000 });
  const session = store.createConsoleSession();
  const claimed = store.claimExtensionSession(session.extensionClaimNonce);
  assert.equal(claimed.ok, true);

  assert.equal(store.revokeExtensionSession(claimed.extensionSessionToken), true);
  assert.equal(store.verifyConsoleSession(session.consoleSessionToken), false);
  assert.equal(store.verifyExtensionSession(claimed.extensionSessionToken), false);
  assert.equal(store.revokeExtensionSession('missing'), false);
});

test('local auto-pair store rejects unknown tokens', () => {
  const store = createLocalAutoPairSessionStore({ now: () => 1000 });
  assert.equal(store.verifyConsoleSession('nonexistent'), false);
  assert.equal(store.verifyExtensionSession('nope'), false);
  const claim = store.claimExtensionSession('bad-nonce');
  assert.equal(claim.ok, false);
});

test('local auto-pair store rejects expired extension session', () => {
  let now = 1000;
  const store = createLocalAutoPairSessionStore({
    now: () => now,
    sessionTtlMs: 100,
    claimTtlMs: 100,
  });
  const session = store.createConsoleSession();
  const claimed = store.claimExtensionSession(session.extensionClaimNonce);
  assert.equal(claimed.ok, true);

  // Advance past session TTL
  now = 1200;
  assert.equal(store.verifyConsoleSession(session.consoleSessionToken), false);
  assert.equal(store.verifyExtensionSession(claimed.extensionSessionToken), false);
});
