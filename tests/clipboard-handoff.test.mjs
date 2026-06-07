import assert from 'node:assert/strict';
import test from 'node:test';

import { InMemoryAuditLog } from '../apps/local-server/src/storage/audit-log.ts';
import { InMemoryPacketStore } from '../apps/local-server/src/storage/packet-store.ts';
import { InMemoryPendingPromptStore } from '../apps/local-server/src/storage/pending-prompt-store.ts';

function createPendingStore() {
  const packetStore = new InMemoryPacketStore();
  const auditLog = new InMemoryAuditLog();
  const pendingStore = new InMemoryPendingPromptStore(packetStore, auditLog);

  return {
    auditLog,
    pendingStore,
  };
}

test('clipboard handoff requires a confirmed pending prompt and does not send automatically', () => {
  const { auditLog, pendingStore } = createPendingStore();
  const pending = pendingStore.createPendingPrompt({
    id: 'pending-clipboard',
    sessionId: 'session-1',
    prompt: 'paste this into Codex',
    now: 1770000000000,
  });

  const blocked = pendingStore.createClipboardHandoff(
    pending.id,
    'managed-pty-experimental',
    1770000000001,
  );
  assert.equal(blocked.ok, false);
  assert.equal(blocked.failureReason, 'pending-prompt-not-confirmed');

  pendingStore.confirmPrompt(pending.id, 1770000000002);
  const handoff = pendingStore.createClipboardHandoff(
    pending.id,
    'managed-pty-experimental',
    1770000000003,
  );

  assert.equal(handoff.ok, true);
  assert.equal(handoff.clipboardText, 'paste this into Codex');
  assert.equal(handoff.prompt.status, 'confirmed');
  assert.equal(handoff.prompt.transport, 'clipboard');
  assert.equal(handoff.prompt.clipboardHandoff?.fallbackReason, 'managed-pty-experimental');
  assert.deepEqual(handoff.checklist, [
    'Copy the pending prompt text.',
    'Paste it into the managed Codex session.',
    'Submit manually after reviewing the prompt.',
    'Record success or failure in the bridge audit trail.',
  ]);
  assert.deepEqual(auditLog.listEvents().map((event) => event.type), [
    'create_pending_prompt',
    'confirm_prompt',
    'copy_to_clipboard',
  ]);
  assert.equal(auditLog.listEvents().at(-1)?.result.failureReason, 'managed-pty-experimental');
});
