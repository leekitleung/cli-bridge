import assert from 'node:assert/strict';
import test from 'node:test';

import { InMemoryEndpointRegistry } from '../apps/local-server/src/endpoints/endpoint-registry.ts';
import {
  CLAUDE_CODE_REVIEW_ENDPOINT,
  CODEX_FEASIBILITY_REVIEW_ENDPOINT,
  DEFAULT_AGENT_ENDPOINTS,
} from '../apps/local-server/src/endpoints/mock-endpoints.ts';
import { buildCodexFeasibilityPrompt } from '../apps/local-server/src/review/codex-feasibility-prompt.ts';
import { createCodexFeasibilityClipboardHandoff } from '../apps/local-server/src/review/codex-feasibility-handoff.ts';
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
    CODEX_FEASIBILITY_REVIEW_ENDPOINT,
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
    auditLog,
    pendingPromptStore,
    pendingReviewStore,
  };
}

function createSentCodexFeasibilityReview(stores) {
  const prompt = buildCodexFeasibilityPrompt({
    claudeOutputOrPlan: 'Claude proposes a small endpoint metadata change.',
    contextSummary: 'Review feasibility only.',
    cwd: '/repo',
    branch: 'main',
  });
  const review = stores.pendingReviewStore.createDraft({
    id: 'review-1',
    sessionId: 'session-1',
    sourceEndpointId: 'claude-code',
    targetEndpointId: 'codex-feasibility',
    prompt,
    now,
  });
  stores.pendingReviewStore.preview(review.id, now + 1);
  stores.pendingReviewStore.confirm(review.id, now + 2);
  stores.pendingReviewStore.sendConfirmed(review.id, now + 3);

  return stores.pendingReviewStore.get(review.id);
}

test('codex feasibility endpoint can review but cannot execute or accept prompts', () => {
  assert.equal(CODEX_FEASIBILITY_REVIEW_ENDPOINT.id, 'codex-feasibility');
  assert.equal(CODEX_FEASIBILITY_REVIEW_ENDPOINT.transport, 'clipboard');
  assert.equal(CODEX_FEASIBILITY_REVIEW_ENDPOINT.risk, 'medium');
  assert.equal(CODEX_FEASIBILITY_REVIEW_ENDPOINT.capabilities.canReview, true);
  assert.equal(CODEX_FEASIBILITY_REVIEW_ENDPOINT.capabilities.canExecute, false);
  assert.equal(CODEX_FEASIBILITY_REVIEW_ENDPOINT.capabilities.canAcceptPrompt, false);
  assert.equal(CODEX_FEASIBILITY_REVIEW_ENDPOINT.capabilities.canReturnOutput, true);
});

test('codex feasibility prompt is review-only and requests ReviewResult-shaped output', () => {
  const prompt = buildCodexFeasibilityPrompt({
    claudeOutputOrPlan: 'Claude output to review',
    contextSummary: 'No extra context',
    cwd: '/repo',
    branch: 'main',
  });

  assert.match(prompt, /You are a Feasibility Review Agent, not an Execution Agent/);
  assert.match(prompt, /Do not call tools/);
  assert.match(prompt, /Do not apply patches/);
  assert.match(prompt, /Do not write files/);
  assert.match(prompt, /Do not run commands/);
  assert.match(prompt, /Do not modify repository state/);
  assert.match(prompt, /Do not send anything back to Claude Code automatically/);
  assert.match(prompt, /minimum patch scope/);
  assert.match(prompt, /summary/);
  assert.match(prompt, /findings/);
  assert.match(prompt, /nextPromptDraft/);
});

test('codex feasibility handoff creates clipboard payload only and audits without execution', () => {
  const stores = createStores();
  const review = createSentCodexFeasibilityReview(stores);
  const handoff = createCodexFeasibilityClipboardHandoff({
    review,
    registry: stores.registry,
    auditLog: stores.auditLog,
    now: now + 4,
  });

  assert.equal(handoff.ok, true);
  assert.equal(handoff.transport, 'clipboard');
  assert.equal(handoff.status, 'ready-to-copy');
  assert.equal(handoff.targetEndpointId, 'codex-feasibility');
  assert.equal(handoff.clipboardText.includes('Feasibility Review Agent'), true);
  assert.equal(handoff.clipboardText.includes('Do not run commands'), true);
  assert.equal(stores.pendingReviewStore.get(review.id).status, 'sent');
  assert.equal(stores.pendingPromptStore.listPrompts().length, 0);
  assert.equal(JSON.stringify(stores.auditLog.listEvents()).includes('copy_to_clipboard'), true);
});

test('codex feasibility result remains non-executing and nextPromptDraft remains draft-only', async () => {
  const stores = createStores();
  const review = createSentCodexFeasibilityReview(stores);
  const parsed = parseClaudeReviewResult({
    text: JSON.stringify({
      summary: 'Feasible with narrow scope',
      findings: ['Keep as one patch'],
      nextPromptDraft: 'Ask Codex to implement this after confirmation',
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
  assert.equal(returned.nextPrompt.status, 'draft');

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
