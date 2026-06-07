import assert from 'node:assert/strict';
import test from 'node:test';

import { MockAgentAdapter } from '../apps/local-server/src/adapters/MockAgentAdapter.ts';
import { InMemoryAuditLog } from '../apps/local-server/src/storage/audit-log.ts';
import { createMetricsSummary } from '../apps/local-server/src/storage/metrics-summary.ts';
import { InMemoryPacketStore } from '../apps/local-server/src/storage/packet-store.ts';
import { InMemoryPendingPromptStore } from '../apps/local-server/src/storage/pending-prompt-store.ts';

const failingAdapter = {
  name: 'failing-agent',
  async sendPrompt() {
    return {
      ok: false,
      transport: 'mock',
      failureReason: 'adapter-unavailable',
    };
  },
};

function createStores() {
  const packetStore = new InMemoryPacketStore();
  const auditLog = new InMemoryAuditLog();
  const pendingPromptStore = new InMemoryPendingPromptStore(packetStore, auditLog);

  return {
    auditLog,
    packetStore,
    pendingPromptStore,
  };
}

test('metrics summary counts packet lifecycle, redaction, fallback, and rates', async () => {
  const stores = createStores();
  const sentPrompt = stores.pendingPromptStore.createPendingPrompt({
    id: 'prompt-sent',
    sessionId: 'session-1',
    prompt: 'review this',
    now: 1770000000000,
  });
  stores.pendingPromptStore.confirmPrompt(sentPrompt.id, 1770000000001);
  await stores.pendingPromptStore.sendConfirmedPrompt(
    sentPrompt.id,
    new MockAgentAdapter(),
    1770000000002,
  );

  const cancelledPrompt = stores.pendingPromptStore.createPendingPrompt({
    id: 'prompt-cancelled',
    sessionId: 'session-1',
    prompt: 'API_TOKEN=super-secret-token',
    now: 1770000000003,
  });
  stores.pendingPromptStore.cancelPrompt(cancelledPrompt.id, 1770000000004);

  const failedPrompt = stores.pendingPromptStore.createPendingPrompt({
    id: 'prompt-failed',
    sessionId: 'session-1',
    prompt: 'send this',
    now: 1770000000005,
  });
  stores.pendingPromptStore.confirmPrompt(failedPrompt.id, 1770000000006);
  await stores.pendingPromptStore.sendConfirmedPrompt(
    failedPrompt.id,
    failingAdapter,
    1770000000007,
  );

  stores.auditLog.createAndAppend({
    sessionId: 'session-1',
    type: 'copy_to_clipboard',
    source: 'chatgpt-web',
    target: 'clipboard',
    result: {
      ok: true,
    },
    timestamp: 1770000000008,
  });

  assert.deepEqual(createMetricsSummary(stores), {
    packetCreatedCount: 3,
    packetSentCount: 1,
    packetCancelledCount: 1,
    packetFailedCount: 1,
    fallbackToClipboardCount: 2,
    redactionHitCount: 1,
    confirmRate: 2 / 3,
    cancelRate: 1 / 3,
  });
});

test('metrics summary does not read raw packet content', () => {
  const stores = createStores();
  stores.packetStore.createPacket({
    id: 'packet-1',
    sessionId: 'session-1',
    source: 'chatgpt-web',
    target: 'codex',
    kind: 'manual-transfer',
    rawContent: 'API_TOKEN=super-secret-token',
    now: 1770000000000,
  });
  stores.packetStore.getRawContent = () => {
    throw new Error('raw content must not be read for metrics');
  };

  const summary = createMetricsSummary(stores);

  assert.equal(summary.packetCreatedCount, 1);
  assert.equal(summary.redactionHitCount, 1);
});
