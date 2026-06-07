import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertAuditEvent,
  validateAuditEvent,
} from '../packages/shared/src/schemas.ts';

function createAuditEvent(overrides = {}) {
  return {
    id: 'audit-1',
    sessionId: 'session-1',
    packetId: 'packet-1',
    approvalId: 'approval-1',
    type: 'process_content',
    source: 'chatgpt-web',
    target: 'codex',
    snapshot: {
      transport: 'clipboard',
    },
    safety: {
      contentHash: 'sha256:placeholder',
      redactionSummary: [],
      riskLevel: 'low',
    },
    result: {
      ok: true,
    },
    timestamp: 1770000000000,
    ...overrides,
  };
}

test('AuditEvent schema accepts the minimal v0.1 audit event shape', () => {
  const event = createAuditEvent();

  assert.deepEqual(validateAuditEvent(event), {
    ok: true,
    errors: [],
  });
  assert.doesNotThrow(() => assertAuditEvent(event));
});

test('AuditEvent schema rejects invalid event type and risk level', () => {
  const result = validateAuditEvent(createAuditEvent({
    type: 'auto_loop',
    safety: {
      riskLevel: 'critical',
    },
  }));

  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /type is invalid/);
  assert.match(result.errors.join('\n'), /safety.riskLevel is invalid/);
});

test('AuditEvent schema supports failureReason for failed operations', () => {
  const result = validateAuditEvent(createAuditEvent({
    type: 'operation_failed',
    result: {
      ok: false,
      failureReason: 'pairing-token-missing',
    },
  }));

  assert.deepEqual(result, {
    ok: true,
    errors: [],
  });
});

test('AuditEvent schema requires structured result and safety metadata', () => {
  const result = validateAuditEvent(createAuditEvent({
    safety: {
      contentHash: 123,
      redactionSummary: ['secret-redacted', 1],
      riskLevel: 'medium',
    },
    result: {
      ok: 'yes',
      failureReason: 404,
    },
  }));

  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /safety.contentHash must be a string/);
  assert.match(result.errors.join('\n'), /safety.redactionSummary must be a string array/);
  assert.match(result.errors.join('\n'), /result.ok must be a boolean/);
  assert.match(result.errors.join('\n'), /result.failureReason must be a string/);
});
