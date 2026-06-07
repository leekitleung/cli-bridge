import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import test from 'node:test';

import { CodexManagedPtyAdapter } from '../apps/local-server/src/adapters/CodexManagedPtyAdapter.ts';
import { MockAgentAdapter } from '../apps/local-server/src/adapters/MockAgentAdapter.ts';
import {
  cancelPendingPrompt,
  confirmPendingPrompt,
  createPendingPrompt,
  sendConfirmedPendingPrompt,
} from '../apps/local-server/src/routes/pending-prompts.ts';
import {
  getManagedCodexSessionStatus,
  readManagedCodexRecentOutput,
  startManagedCodexSession,
} from '../apps/local-server/src/routes/sessions.ts';
import { InMemoryAuditLog } from '../apps/local-server/src/storage/audit-log.ts';
import { InMemoryPacketStore } from '../apps/local-server/src/storage/packet-store.ts';
import { InMemoryPendingPromptStore } from '../apps/local-server/src/storage/pending-prompt-store.ts';

function createPendingStore() {
  const packetStore = new InMemoryPacketStore();
  const auditLog = new InMemoryAuditLog();
  const pendingStore = new InMemoryPendingPromptStore(packetStore, auditLog);

  return {
    packetStore,
    auditLog,
    pendingStore,
  };
}

test('pending prompt sends to MockAgent only after confirmation', async () => {
  const { auditLog, pendingStore } = createPendingStore();
  const adapter = new MockAgentAdapter();
  const pending = createPendingPrompt(pendingStore, {
    id: 'pending-1',
    sessionId: 'session-1',
    prompt: 'run the next safe step',
    now: 1770000000000,
  });

  const blockedSend = await sendConfirmedPendingPrompt(pendingStore, pending.id, adapter);
  assert.equal(blockedSend.ok, false);
  assert.equal(blockedSend.failureReason, 'pending-prompt-not-confirmed');
  assert.deepEqual(adapter.listDeliveredPrompts(), []);

  const confirmed = confirmPendingPrompt(pendingStore, pending.id);
  assert.equal(confirmed?.status, 'confirmed');

  const sent = await sendConfirmedPendingPrompt(pendingStore, pending.id, adapter);
  assert.equal(sent.ok, true);
  assert.equal(sent.prompt.status, 'sent');
  assert.deepEqual(adapter.listDeliveredPrompts(), ['run the next safe step']);
  assert.deepEqual(auditLog.listEvents().map((event) => event.type), [
    'create_pending_prompt',
    'confirm_prompt',
    'send_to_agent',
  ]);
});

test('cancelled pending prompt never triggers adapter delivery', async () => {
  const { pendingStore } = createPendingStore();
  const adapter = new MockAgentAdapter();
  const pending = createPendingPrompt(pendingStore, {
    id: 'pending-2',
    sessionId: 'session-1',
    prompt: 'do not send this',
  });

  const cancelled = cancelPendingPrompt(pendingStore, pending.id);
  assert.equal(cancelled?.status, 'cancelled');

  const result = await sendConfirmedPendingPrompt(pendingStore, pending.id, adapter);
  assert.equal(result.ok, false);
  assert.equal(result.failureReason, 'pending-prompt-not-confirmed');
  assert.deepEqual(adapter.listDeliveredPrompts(), []);
});

test('failed delivery returns clipboard fallback without losing prompt text', async () => {
  const { pendingStore } = createPendingStore();
  const pending = createPendingPrompt(pendingStore, {
    id: 'pending-3',
    sessionId: 'session-1',
    prompt: 'copy me if delivery fails',
  });
  confirmPendingPrompt(pendingStore, pending.id);

  const result = await sendConfirmedPendingPrompt(pendingStore, pending.id, {
    name: 'failing-agent',
    async sendPrompt() {
      return {
        ok: false,
        transport: 'clipboard',
        failureReason: 'adapter-failed',
      };
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.prompt.status, 'failed');
  assert.equal(result.failureReason, 'adapter-failed');
  assert.equal(result.clipboardFallback, 'copy me if delivery fails');
});

test('CodexManagedPtyAdapter starts a managed session and writes prompts', async () => {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const writtenChunks = [];
  stdin.on('data', (chunk) => {
    writtenChunks.push(String(chunk));
  });
  const adapter = new CodexManagedPtyAdapter(() => ({
    stdin,
    stdout,
    stderr,
    pid: 31337,
  }));

  const started = startManagedCodexSession(adapter);
  assert.deepEqual(started, {
    started: true,
    pid: 31337,
    recentOutput: '',
  });

  stdout.write('ready\n');
  assert.equal(readManagedCodexRecentOutput(adapter), 'ready\n');

  const sent = await adapter.sendPrompt('confirmed prompt');
  assert.deepEqual(sent, {
    ok: true,
    transport: 'managed-pty',
    deliveredPrompt: 'confirmed prompt',
  });
  assert.deepEqual(writtenChunks, ['confirmed prompt\n']);
  assert.equal(getManagedCodexSessionStatus(adapter).started, true);
});
