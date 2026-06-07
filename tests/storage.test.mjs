import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createAuditEvent,
  InMemoryAuditLog,
} from '../apps/local-server/src/storage/audit-log.ts';
import { InMemoryPacketStore } from '../apps/local-server/src/storage/packet-store.ts';
import { createContentHash } from '../packages/shared/src/utils/hash.ts';

function createStorePacket(rawContent) {
  const store = new InMemoryPacketStore();
  const packet = store.createPacket({
    id: 'packet-1',
    sessionId: 'session-1',
    source: 'chatgpt-web',
    target: 'codex',
    kind: 'manual-transfer',
    rawContent,
    context: {
      transport: 'clipboard',
    },
    now: 1770000000000,
  });

  return { store, packet };
}

test('packet store persists processedContent but not rawContent', () => {
  const rawContent = 'API_TOKEN=super-secret-token\nreview this result';
  const { store, packet } = createStorePacket(rawContent);

  const storedPacket = store.getPacket(packet.id);
  assert.equal(storedPacket?.processedContent.includes('super-secret-token'), false);
  assert.equal(storedPacket?.processedContent.includes('[REDACTED_ENV_SECRET]'), true);
  assert.equal(JSON.stringify(storedPacket).includes('"rawContent":'), false);
  assert.equal(JSON.stringify(storedPacket).includes('super-secret-token'), false);
  assert.equal(store.getRawContent(packet.id), rawContent);

  store.clearRawContent(packet.id);
  assert.equal(store.getRawContent(packet.id), undefined);
});

test('packet store records safety metadata and basic metrics', () => {
  const { packet } = createStorePacket('review this result');

  assert.equal(packet.safety.redactionApplied, false);
  assert.equal(packet.safety.blocked, false);
  assert.equal(packet.safety.contentHash, createContentHash(packet.processedContent));
  assert.equal(packet.metrics.rawLength, 'review this result'.length);
  assert.equal(packet.metrics.processedLength, packet.processedContent.length);
  assert.equal(typeof packet.metrics.rawTokenEstimate, 'number');
  assert.equal(typeof packet.metrics.processedTokenEstimate, 'number');
  assert.equal(packet.metrics.compressionRatio, 1);
});

test('packet store marks private keys and env snippets as blocked after redaction', () => {
  const { packet } = createStorePacket([
    'API_TOKEN=super-secret-token',
    '-----BEGIN PRIVATE KEY-----',
    'private material',
    '-----END PRIVATE KEY-----',
  ].join('\n'));

  assert.equal(packet.safety.redactionApplied, true);
  assert.equal(packet.safety.blocked, true);
  assert.deepEqual(packet.safety.blockReasons, [
    'private-key-block',
    'env-secret-assignment',
  ]);
  assert.doesNotMatch(packet.processedContent, /super-secret-token|private material/);
});

test('audit log appends traceable events and keeps insertion order', () => {
  const auditLog = new InMemoryAuditLog();
  const first = auditLog.createAndAppend({
    id: 'audit-1',
    sessionId: 'session-1',
    packetId: 'packet-1',
    approvalId: 'approval-1',
    type: 'process_content',
    source: 'chatgpt-web',
    target: 'codex',
    safety: {
      contentHash: 'sha256:placeholder',
      redactionSummary: ['env-secret-assignment'],
      riskLevel: 'medium',
    },
    result: {
      ok: true,
    },
    timestamp: 1770000000000,
  });
  const second = auditLog.createAndAppend({
    id: 'audit-2',
    sessionId: 'session-1',
    packetId: 'packet-1',
    type: 'operation_failed',
    source: 'chatgpt-web',
    target: 'codex',
    result: {
      ok: false,
      failureReason: 'blocked-by-redaction',
    },
    timestamp: 1770000000001,
  });

  assert.deepEqual(auditLog.listEvents().map((event) => event.id), ['audit-1', 'audit-2']);
  assert.deepEqual(auditLog.listEventsForPacket('packet-1'), [first, second]);
});

test('createAuditEvent validates event shape before append', () => {
  assert.throws(() => createAuditEvent({
    sessionId: 'session-1',
    type: 'auto_loop',
    source: 'chatgpt-web',
    target: 'codex',
    result: {
      ok: true,
    },
  }), /Invalid AuditEvent/);
});
