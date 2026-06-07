import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertBridgePacket,
  validateBridgePacket,
} from '../packages/shared/src/schemas.ts';

function createPacket(overrides = {}) {
  return {
    id: 'packet-1',
    sessionId: 'session-1',
    source: 'chatgpt-web',
    target: 'codex',
    kind: 'manual-transfer',
    processedContent: 'review this result',
    safety: {
      redactionApplied: false,
      redactionSummary: [],
      blocked: false,
      blockReasons: [],
      contentHash: 'sha256:placeholder',
    },
    context: {
      transport: 'clipboard',
    },
    metrics: {
      processedLength: 18,
    },
    status: 'draft',
    createdAt: 1770000000000,
    updatedAt: 1770000000000,
    ...overrides,
  };
}

test('BridgePacket schema accepts the minimal v0.1 packet shape', () => {
  const packet = createPacket();

  assert.deepEqual(validateBridgePacket(packet), {
    ok: true,
    errors: [],
  });
  assert.doesNotThrow(() => assertBridgePacket(packet));
});

test('BridgePacket schema rejects invalid enum values', () => {
  const result = validateBridgePacket(createPacket({
    source: 'browser',
    target: 'agent',
    kind: 'auto-loop',
    status: 'queued',
  }));

  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /source is invalid/);
  assert.match(result.errors.join('\n'), /target is invalid/);
  assert.match(result.errors.join('\n'), /kind is invalid/);
  assert.match(result.errors.join('\n'), /status is invalid/);
});

test('BridgePacket schema rejects persisted rawContent', () => {
  const result = validateBridgePacket(createPacket({
    rawContent: 'secret raw prompt',
  }));

  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /rawContent must not be stored on BridgePacket/);
});

test('BridgePacket schema allows explicit rawContentRef without storing raw content', () => {
  const result = validateBridgePacket(createPacket({
    rawContentRef: {
      storage: 'memory-only',
    },
  }));

  assert.deepEqual(result, {
    ok: true,
    errors: [],
  });
});
