import assert from 'node:assert/strict';
import test from 'node:test';

import {
  KNOWN_PROVIDER_CAPABILITIES,
  validateProviderCapability,
} from '../apps/local-server/src/storage/provider-capability.ts';

test('execution capability registry keeps WorkBuddy non-executing and codex-medium bounded', () => {
  assert.equal(KNOWN_PROVIDER_CAPABILITIES.workbuddy.canExecute, false);
  assert.equal(KNOWN_PROVIDER_CAPABILITIES['codex-medium'].canExecute, true);
  assert.equal(KNOWN_PROVIDER_CAPABILITIES['codex-medium'].endpointId, 'codex-medium');
  assert.equal(KNOWN_PROVIDER_CAPABILITIES['codex-medium'].maxConcurrentBridgeSlots, 1);
  assert.deepEqual(KNOWN_PROVIDER_CAPABILITIES['codex-medium'].supportedIsolations, ['patch-only']);
});

test('provider capability validation rejects WorkBuddy execution and endpoint mismatch', () => {
  const workbuddy = validateProviderCapability('workbuddy', 'sequential', 'patch-only', 1, 'workbuddy');
  assert.equal(workbuddy.ok, false);
  assert.ok(workbuddy.errors.some(error => error.includes('cannot execute')));

  const mismatch = validateProviderCapability('codex-medium', 'sequential', 'patch-only', 1, 'codex-command');
  assert.equal(mismatch.ok, false);
  assert.ok(mismatch.errors.some(error => error.includes('must use endpointId codex-medium')));

  const bounded = validateProviderCapability('codex-medium', 'sequential', 'patch-only', 1, 'codex-medium');
  assert.equal(bounded.ok, true);
});
