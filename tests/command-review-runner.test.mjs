import assert from 'node:assert/strict';
import test from 'node:test';

import { createCommandReviewAdapter } from '../apps/local-server/src/adapters/command-review-adapter.ts';
import { InMemoryEndpointRegistry } from '../apps/local-server/src/endpoints/endpoint-registry.ts';
import {
  CLAUDE_CODE_REVIEW_COMMAND_ENDPOINT,
  CODEX_REVIEW_COMMAND_ENDPOINT,
  DEFAULT_AGENT_ENDPOINTS,
} from '../apps/local-server/src/endpoints/mock-endpoints.ts';
import { runCommandReview } from '../apps/local-server/src/review/command-review-runner.ts';
import { InMemoryAuditLog } from '../apps/local-server/src/storage/audit-log.ts';
import { InMemoryPacketStore } from '../apps/local-server/src/storage/packet-store.ts';
import { InMemoryPendingPromptStore } from '../apps/local-server/src/storage/pending-prompt-store.ts';
import { InMemoryPendingReviewStore } from '../apps/local-server/src/storage/pending-review-store.ts';

const now = 1770000000000;

// Tests must not depend on a real local install: inject a fixed resolver.
const fakeLauncherResolver = (command) => ({ executable: `/fake/${command}`, prependArgs: [] });

function fakeRunner(result) {
  return {
    async run() {
      return typeof result === 'function' ? result() : result;
    },
  };
}

function okRun(stdout) {
  return { exitCode: 0, stdout, stderr: '', timedOut: false };
}

function createStores() {
  const registry = new InMemoryEndpointRegistry([
    ...DEFAULT_AGENT_ENDPOINTS,
    CLAUDE_CODE_REVIEW_COMMAND_ENDPOINT,
    CODEX_REVIEW_COMMAND_ENDPOINT,
  ]);
  const packetStore = new InMemoryPacketStore();
  const auditLog = new InMemoryAuditLog();
  const pendingPromptStore = new InMemoryPendingPromptStore(packetStore, auditLog);
  const pendingReviewStore = new InMemoryPendingReviewStore(
    registry,
    packetStore,
    auditLog,
    pendingPromptStore,
  );
  return { auditLog, pendingPromptStore, pendingReviewStore };
}

function createSentReview(stores) {
  const review = stores.pendingReviewStore.createDraft({
    id: 'review-1',
    sessionId: 'session-1',
    sourceEndpointId: 'codex-command',
    targetEndpointId: 'claude-code-command',
    prompt: 'Review the Codex output',
    now,
  });
  stores.pendingReviewStore.preview(review.id, now + 1);
  stores.pendingReviewStore.confirm(review.id, now + 2);
  stores.pendingReviewStore.sendConfirmed(review.id, now + 3);
  return review;
}

function adapterReturning() {
  return createCommandReviewAdapter({
    adapterName: 'claude-code-review-command',
    command: 'claude',
    buildArgs: () => ['-p'],
  });
}

test('runCommandReview drives a sent review to returned with a draft follow-up', async () => {
  const stores = createStores();
  const review = createSentReview(stores);
  const adapter = adapterReturning();

  const result = await runCommandReview(
    stores.pendingReviewStore,
    stores.auditLog,
    adapter,
    { reviewId: review.id, prompt: 'Review the Codex output', resultId: 'res-1', now: now + 4 },
    {
      runner: fakeRunner(okRun(JSON.stringify({
        summary: 'one issue',
        findings: ['add a null check'],
        nextPromptDraft: 'Ask Codex to add a null check after confirmation',
      }))),
      launcherResolver: fakeLauncherResolver,
    },
  );

  assert.equal(result.ok, true);
  assert.equal(stores.pendingReviewStore.get(review.id).status, 'returned');
  assert.equal(result.returned.nextPrompt.status, 'draft');

  // The draft follow-up is not auto-sendable without an explicit confirm.
  const send = await stores.pendingPromptStore.sendConfirmedPrompt(
    result.returned.nextPrompt.id,
    { name: 'mock', sendPrompt: async () => ({ ok: true, transport: 'mock' }) },
    now + 5,
  );
  assert.equal(send.ok, false);
  assert.equal(send.failureReason, 'pending-prompt-not-confirmed');

  // A send_review audit with command transport metadata exists.
  const audits = stores.auditLog.listEvents();
  const sendAudit = audits.find((e) => e.type === 'send_review' && e.snapshot.transport === 'command');
  assert.ok(sendAudit);
  assert.equal(sendAudit.snapshot.agent, 'claude-code-review-command');
});

test('runCommandReview refuses a review that has not been sent', async () => {
  const stores = createStores();
  const review = stores.pendingReviewStore.createDraft({
    id: 'review-2',
    sessionId: 'session-1',
    sourceEndpointId: 'codex-command',
    targetEndpointId: 'claude-code-command',
    prompt: 'p',
    now,
  });
  // Only confirmed, never sent.
  stores.pendingReviewStore.preview(review.id, now + 1);
  stores.pendingReviewStore.confirm(review.id, now + 2);

  const result = await runCommandReview(
    stores.pendingReviewStore,
    stores.auditLog,
    adapterReturning(),
    { reviewId: review.id, prompt: 'p', now: now + 3 },
    { runner: fakeRunner(okRun('{"summary":"x","findings":[]}')), launcherResolver: fakeLauncherResolver },
  );

  assert.equal(result.ok, false);
  assert.equal(result.failureReason, 'pending-review-not-sent');
  assert.equal(stores.pendingReviewStore.get(review.id).status, 'confirmed');
});

test('runCommandReview fails the review when the CLI returns execution fields', async () => {
  const stores = createStores();
  const review = createSentReview(stores);

  const result = await runCommandReview(
    stores.pendingReviewStore,
    stores.auditLog,
    adapterReturning(),
    { reviewId: review.id, prompt: 'p', now: now + 4 },
    {
      runner: fakeRunner(okRun(JSON.stringify({
        summary: 'x',
        findings: [],
        autoSend: true,
      }))),
      launcherResolver: fakeLauncherResolver,
    },
  );

  assert.equal(result.ok, false);
  assert.equal(result.failureReason, 'review-result-forbidden-autoSend');
  assert.equal(stores.pendingReviewStore.get(review.id).status, 'failed');
  // No pending prompt was ever created from a rejected result.
  assert.equal(stores.pendingPromptStore.listPrompts().length, 0);
});

test('runCommandReview fails closed on a non-zero CLI exit', async () => {
  const stores = createStores();
  const review = createSentReview(stores);

  const result = await runCommandReview(
    stores.pendingReviewStore,
    stores.auditLog,
    adapterReturning(),
    { reviewId: review.id, prompt: 'p', now: now + 4 },
    { runner: fakeRunner({ exitCode: 1, stdout: '', stderr: 'boom', timedOut: false }), launcherResolver: fakeLauncherResolver },
  );

  assert.equal(result.ok, false);
  assert.equal(result.failureReason, 'command-nonzero-exit');
  assert.equal(stores.pendingReviewStore.get(review.id).status, 'failed');
});
