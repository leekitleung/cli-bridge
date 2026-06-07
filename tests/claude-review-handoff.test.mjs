import assert from 'node:assert/strict';
import test from 'node:test';

import { InMemoryEndpointRegistry } from '../apps/local-server/src/endpoints/endpoint-registry.ts';
import {
  CLAUDE_CODE_REVIEW_ENDPOINT,
  DEFAULT_AGENT_ENDPOINTS,
} from '../apps/local-server/src/endpoints/mock-endpoints.ts';
import { buildClaudeReviewPrompt } from '../apps/local-server/src/review/claude-review-prompt.ts';
import { createClaudeReviewClipboardHandoff } from '../apps/local-server/src/review/claude-review-handoff.ts';
import { parseClaudeReviewResult } from '../apps/local-server/src/review/review-result-parser.ts';
import { InMemoryAuditLog } from '../apps/local-server/src/storage/audit-log.ts';
import { InMemoryPacketStore } from '../apps/local-server/src/storage/packet-store.ts';
import { InMemoryPendingPromptStore } from '../apps/local-server/src/storage/pending-prompt-store.ts';
import { InMemoryPendingReviewStore } from '../apps/local-server/src/storage/pending-review-store.ts';

const now = 1770000000000;

function createStores() {
  const registry = new InMemoryEndpointRegistry([
    ...DEFAULT_AGENT_ENDPOINTS,
    CLAUDE_CODE_REVIEW_ENDPOINT,
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

  return {
    registry,
    packetStore,
    auditLog,
    pendingPromptStore,
    pendingReviewStore,
  };
}

function createSentClaudeReview(stores) {
  const prompt = buildClaudeReviewPrompt({
    codexOutput: 'Changed pending review store and tests.',
    diffSummary: '2 files changed',
    cwd: '/repo',
    branch: 'main',
  });
  const review = stores.pendingReviewStore.createDraft({
    id: 'review-1',
    sessionId: 'session-1',
    sourceEndpointId: 'codex-cli',
    targetEndpointId: 'claude-code',
    prompt,
    now,
  });
  stores.pendingReviewStore.preview(review.id, now + 1);
  stores.pendingReviewStore.confirm(review.id, now + 2);
  stores.pendingReviewStore.sendConfirmed(review.id, now + 3);

  return stores.pendingReviewStore.get(review.id);
}

test('claude-code endpoint can review but cannot execute or accept prompts', () => {
  assert.equal(CLAUDE_CODE_REVIEW_ENDPOINT.id, 'claude-code');
  assert.equal(CLAUDE_CODE_REVIEW_ENDPOINT.transport, 'clipboard');
  assert.equal(CLAUDE_CODE_REVIEW_ENDPOINT.risk, 'medium');
  assert.equal(CLAUDE_CODE_REVIEW_ENDPOINT.capabilities.canReview, true);
  assert.equal(CLAUDE_CODE_REVIEW_ENDPOINT.capabilities.canExecute, false);
  assert.equal(CLAUDE_CODE_REVIEW_ENDPOINT.capabilities.canAcceptPrompt, false);
  assert.equal(CLAUDE_CODE_REVIEW_ENDPOINT.capabilities.canReturnOutput, true);
});

test('claude review prompt is review-only and asks for ReviewResult-shaped output', () => {
  const prompt = buildClaudeReviewPrompt({
    codexOutput: 'Codex output to review',
    diffSummary: 'No diff available',
    cwd: '/repo',
    branch: 'main',
  });

  assert.match(prompt, /You are a Review Agent, not an Execution Agent/);
  assert.match(prompt, /Do not call tools/);
  assert.match(prompt, /Do not apply patches/);
  assert.match(prompt, /Do not write files/);
  assert.match(prompt, /Do not run commands/);
  assert.match(prompt, /Do not modify repository state/);
  assert.match(prompt, /Do not send anything back to Codex automatically/);
  assert.match(prompt, /summary/);
  assert.match(prompt, /findings/);
  assert.match(prompt, /nextPromptDraft/);
});

test('claude clipboard handoff creates copy-only review handoff and audits without execution', () => {
  const stores = createStores();
  const review = createSentClaudeReview(stores);
  const handoff = createClaudeReviewClipboardHandoff({
    review,
    registry: stores.registry,
    auditLog: stores.auditLog,
    now: now + 4,
  });

  assert.equal(handoff.ok, true);
  assert.equal(handoff.transport, 'clipboard');
  assert.equal(handoff.status, 'ready-to-copy');
  assert.equal(handoff.targetEndpointId, 'claude-code');
  assert.equal(handoff.clipboardText.includes('Review Agent'), true);
  assert.equal(handoff.clipboardText.includes('Do not run commands'), true);
  assert.equal(stores.pendingReviewStore.get(review.id).status, 'sent');
  assert.equal(stores.pendingPromptStore.listPrompts().length, 0);
  assert.equal(JSON.stringify(stores.auditLog.listEvents()).includes('copy_to_clipboard'), true);
});

test('claude review result parser accepts valid result and rejects execution flags', () => {
  const parsed = parseClaudeReviewResult({
    text: JSON.stringify({
      summary: 'Looks correct',
      findings: ['Keep the second confirmation gate'],
      nextPromptDraft: 'Ask Codex to apply the reviewed change',
    }),
    reviewRequestId: 'review-1',
    id: 'result-1',
    now,
  });

  assert.equal(parsed.ok, true);
  assert.equal(parsed.result.summary, 'Looks correct');
  assert.deepEqual(parsed.result.findings, ['Keep the second confirmation gate']);
  assert.equal(parsed.result.nextPromptDraft, 'Ask Codex to apply the reviewed change');

  for (const forbiddenKey of ['executable', 'autoSend', 'confirmed', 'sent']) {
    const rejected = parseClaudeReviewResult({
      text: JSON.stringify({
        summary: 'Bad',
        findings: [],
        [forbiddenKey]: true,
      }),
      reviewRequestId: 'review-1',
      now,
    });
    assert.equal(rejected.ok, false, `${forbiddenKey} should be rejected`);
  }
});

test('captured claude review result stays non-executing and nextPromptDraft remains draft-only', async () => {
  const stores = createStores();
  const review = createSentClaudeReview(stores);
  const parsed = parseClaudeReviewResult({
    text: JSON.stringify({
      summary: 'Reviewed',
      findings: ['No blocker'],
      nextPromptDraft: 'Follow up manually',
    }),
    reviewRequestId: review.id,
    id: 'result-1',
    now: now + 4,
  });

  assert.equal(parsed.ok, true);
  const returned = stores.pendingReviewStore.returnResult(review.id, {
    id: parsed.result.id,
    summary: parsed.result.summary,
    findings: parsed.result.findings,
    nextPromptDraft: parsed.result.nextPromptDraft,
    now: now + 5,
  });

  assert.equal(returned.ok, true);
  assert.equal(returned.review.status, 'returned');
  assert.equal(returned.nextPrompt.status, 'draft');
  assert.equal(stores.pendingReviewStore.get(review.id).status, 'returned');

  const adapter = {
    name: 'mock-adapter',
    sendPrompt: async () => ({
      ok: true,
      transport: 'mock',
    }),
  };
  const sendResult = await stores.pendingPromptStore.sendConfirmedPrompt(
    returned.nextPrompt.id,
    adapter,
    now + 6,
  );
  assert.equal(sendResult.ok, false);
  assert.equal(sendResult.failureReason, 'pending-prompt-not-confirmed');
});
