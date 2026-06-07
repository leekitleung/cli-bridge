import assert from 'node:assert/strict';
import test from 'node:test';

import { MockAgentAdapter } from '../apps/local-server/src/adapters/MockAgentAdapter.ts';
import { InMemoryAuditLog } from '../apps/local-server/src/storage/audit-log.ts';
import { InMemoryBridgeLoopStore } from '../apps/local-server/src/storage/bridge-loop-store.ts';
import { InMemoryPacketStore } from '../apps/local-server/src/storage/packet-store.ts';
import { InMemoryPendingPromptStore } from '../apps/local-server/src/storage/pending-prompt-store.ts';

function createLoopStore() {
  const packetStore = new InMemoryPacketStore();
  const auditLog = new InMemoryAuditLog();
  const pendingPromptStore = new InMemoryPendingPromptStore(packetStore, auditLog);
  const loopStore = new InMemoryBridgeLoopStore(packetStore, auditLog, pendingPromptStore);

  return {
    auditLog,
    loopStore,
  };
}

test('bidirectional loop stages Codex output into ChatGPT without auto sending', () => {
  const { auditLog, loopStore } = createLoopStore();

  const loop = loopStore.createFromCodexOutput({
    id: 'loop-1',
    sessionId: 'session-1',
    output: 'npm test failed in storage.test.mjs',
    now: 1770000000000,
  });

  assert.equal(loop.status, 'codex-output-ready');
  assert.equal(loop.chatGptFillRequired, true);
  assert.equal(loop.userSendRequired, true);
  assert.equal(loop.codexDeliveryRequired, false);

  const filled = loopStore.markChatGptFilled(loop.id, 1770000000001);
  assert.equal(filled?.status, 'chatgpt-awaiting-user-send');
  assert.equal(filled?.chatGptFillRequired, false);
  assert.equal(filled?.userSendRequired, true);
  assert.deepEqual(auditLog.listEvents().map((event) => event.type), [
    'read_cli_output',
    'fill_chatgpt',
  ]);
});

test('bidirectional loop turns ChatGPT extraction into confirmed Codex delivery only after approval', async () => {
  const { auditLog, loopStore } = createLoopStore();
  const adapter = new MockAgentAdapter();
  const loop = loopStore.createFromCodexOutput({
    id: 'loop-2',
    sessionId: 'session-1',
    output: 'review this output',
    now: 1770000000000,
  });
  loopStore.markChatGptFilled(loop.id, 1770000000001);

  const extracted = loopStore.createPendingPromptFromChatGpt(loop.id, {
    prompt: 'Apply the reviewed fix.',
    now: 1770000000002,
  });
  assert.equal(extracted?.status, 'pending-prompt-ready');
  assert.equal(extracted?.codexDeliveryRequired, true);

  const blockedDelivery = await loopStore.deliverConfirmedPrompt(extracted.id, adapter, 1770000000003);
  assert.equal(blockedDelivery.ok, false);
  assert.equal(blockedDelivery.failureReason, 'pending-prompt-not-confirmed');
  assert.deepEqual(adapter.listDeliveredPrompts(), []);

  const confirmed = loopStore.confirmPendingPrompt(extracted.id, 1770000000004);
  assert.equal(confirmed?.status, 'pending-prompt-confirmed');

  const delivered = await loopStore.deliverConfirmedPrompt(extracted.id, adapter, 1770000000005);
  assert.equal(delivered.ok, true);
  assert.equal(delivered.loop.status, 'codex-delivered');
  assert.deepEqual(adapter.listDeliveredPrompts(), ['Apply the reviewed fix.']);
  assert.deepEqual(auditLog.listEvents().map((event) => event.type), [
    'read_cli_output',
    'fill_chatgpt',
    'extract_chatgpt',
    'create_pending_prompt',
    'confirm_prompt',
    'send_to_agent',
  ]);
});
