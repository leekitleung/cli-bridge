import assert from 'node:assert/strict';
import test from 'node:test';

import { MockAgentAdapter } from '../apps/local-server/src/adapters/MockAgentAdapter.ts';
import {
  confirmBridgeLoopPendingPrompt,
  createBridgeLoopFromCodexOutput,
  createBridgeLoopPendingPromptFromChatGpt,
  deliverBridgeLoopConfirmedPrompt,
  markBridgeLoopChatGptFilled,
} from '../apps/local-server/src/routes/bridge-loop.ts';
import { InMemoryAuditLog } from '../apps/local-server/src/storage/audit-log.ts';
import { InMemoryBridgeLoopStore } from '../apps/local-server/src/storage/bridge-loop-store.ts';
import { InMemoryPacketStore } from '../apps/local-server/src/storage/packet-store.ts';
import { InMemoryPendingPromptStore } from '../apps/local-server/src/storage/pending-prompt-store.ts';

function createStore() {
  const packetStore = new InMemoryPacketStore();
  const auditLog = new InMemoryAuditLog();
  const pendingPromptStore = new InMemoryPendingPromptStore(packetStore, auditLog);
  return new InMemoryBridgeLoopStore(packetStore, auditLog, pendingPromptStore);
}

test('bridge loop route helpers expose controlled loop steps without shell execution', async () => {
  const store = createStore();
  const adapter = new MockAgentAdapter();
  const loop = createBridgeLoopFromCodexOutput(store, {
    id: 'route-loop',
    sessionId: 'session-1',
    output: 'review this output',
    now: 1770000000000,
  });

  assert.equal(markBridgeLoopChatGptFilled(store, loop.id, 1770000000001)?.status, 'chatgpt-awaiting-user-send');
  assert.equal(createBridgeLoopPendingPromptFromChatGpt(store, loop.id, {
    prompt: 'Apply reviewed change.',
    now: 1770000000002,
  })?.status, 'pending-prompt-ready');
  assert.equal(confirmBridgeLoopPendingPrompt(store, loop.id, 1770000000003)?.status, 'pending-prompt-confirmed');

  const delivered = await deliverBridgeLoopConfirmedPrompt(store, loop.id, adapter, 1770000000004);
  assert.equal(delivered.ok, true);
  assert.deepEqual(adapter.listDeliveredPrompts(), ['Apply reviewed change.']);
});
