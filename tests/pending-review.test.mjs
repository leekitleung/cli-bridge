import assert from 'node:assert/strict';
import test from 'node:test';

import {
  validateAgentReviewRequest,
  validateAgentReviewResult,
} from '../packages/shared/src/schemas.ts';
import { InMemoryEndpointRegistry } from '../apps/local-server/src/endpoints/endpoint-registry.ts';
import {
  DEFAULT_AGENT_ENDPOINTS,
  MOCK_REVIEW_ENDPOINT,
} from '../apps/local-server/src/endpoints/mock-endpoints.ts';
import { InMemoryAuditLog } from '../apps/local-server/src/storage/audit-log.ts';
import { InMemoryPacketStore } from '../apps/local-server/src/storage/packet-store.ts';
import { InMemoryPendingPromptStore } from '../apps/local-server/src/storage/pending-prompt-store.ts';
import { InMemoryPendingReviewStore } from '../apps/local-server/src/storage/pending-review-store.ts';

const now = 1770000000000;

const validReviewRequest = {
  id: 'review-1',
  sessionId: 'session-1',
  sourceEndpointId: 'mock-agent',
  targetEndpointId: 'mock-review-agent',
  packetId: 'packet-1',
  status: 'draft',
  prompt: 'Review this output',
  createdAt: now,
  updatedAt: now,
};

const validReviewResult = {
  id: 'result-1',
  reviewRequestId: 'review-1',
  summary: 'Looks safe',
  findings: ['No blocking issue'],
  nextPromptDraft: 'Apply the reviewed change',
  createdAt: now + 1,
};

function createStores() {
  const registry = new InMemoryEndpointRegistry([
    ...DEFAULT_AGENT_ENDPOINTS,
    MOCK_REVIEW_ENDPOINT,
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

test('valid ReviewRequest and ReviewResult pass validation', () => {
  assert.deepEqual(validateAgentReviewRequest(validReviewRequest), {
    ok: true,
    errors: [],
  });
  assert.deepEqual(validateAgentReviewResult(validReviewResult), {
    ok: true,
    errors: [],
  });
});

test('invalid review request and result shapes are rejected', () => {
  assert.equal(validateAgentReviewRequest({
    ...validReviewRequest,
    status: 'executed',
  }).ok, false);
  assert.equal(validateAgentReviewRequest({
    ...validReviewRequest,
    sourceEndpointId: '',
  }).ok, false);
  assert.equal(validateAgentReviewRequest({
    ...validReviewRequest,
    targetEndpointId: '',
  }).ok, false);
  assert.equal(validateAgentReviewRequest({
    ...validReviewRequest,
    packetId: '',
  }).ok, false);
  assert.equal(validateAgentReviewRequest({
    ...validReviewRequest,
    prompt: '',
  }).ok, false);
  assert.equal(validateAgentReviewResult({
    ...validReviewResult,
    summary: '',
  }).ok, false);
  assert.equal(validateAgentReviewResult({
    ...validReviewResult,
    findings: 'not-array',
  }).ok, false);
  assert.equal(validateAgentReviewResult({
    ...validReviewResult,
    executable: true,
  }).ok, false);
  assert.equal(validateAgentReviewResult({
    ...validReviewResult,
    autoSend: true,
  }).ok, false);
  assert.equal(validateAgentReviewResult({
    ...validReviewResult,
    confirmed: true,
  }).ok, false);
  assert.equal(validateAgentReviewResult({
    ...validReviewResult,
    sent: true,
  }).ok, false);
});

test('review creation is denied when the target cannot review', () => {
  const { pendingReviewStore } = createStores();

  assert.throws(() => pendingReviewStore.createDraft({
    id: 'review-1',
    sessionId: 'session-1',
    sourceEndpointId: 'mock-agent',
    targetEndpointId: 'mock-agent',
    prompt: 'review this',
    now,
  }), /capability-denied/);
});

test('pending review lifecycle requires confirmation before send and stores returned result', () => {
  const { pendingReviewStore } = createStores();

  const draft = pendingReviewStore.createDraft({
    id: 'review-1',
    sessionId: 'session-1',
    sourceEndpointId: 'mock-agent',
    targetEndpointId: 'mock-review-agent',
    prompt: 'review this',
    now,
  });

  assert.equal(draft.status, 'draft');
  assert.equal(pendingReviewStore.sendConfirmed('review-1', now + 1).ok, false);

  const previewed = pendingReviewStore.preview('review-1', now + 2);
  assert.equal(previewed?.status, 'previewed');
  const confirmed = pendingReviewStore.confirm('review-1', now + 3);
  assert.equal(confirmed?.status, 'confirmed');
  const sent = pendingReviewStore.sendConfirmed('review-1', now + 4);
  assert.equal(sent.ok, true);
  assert.equal(sent.review.status, 'sent');

  const returned = pendingReviewStore.returnResult('review-1', {
    id: 'result-1',
    summary: 'Reviewed',
    findings: ['Keep pending'],
    now: now + 5,
  });
  assert.equal(returned.ok, true);
  assert.equal(returned.review.status, 'returned');
  assert.equal(returned.result?.reviewRequestId, 'review-1');
  assert.equal(pendingReviewStore.sendConfirmed('review-1', now + 6).ok, false);
});

test('cancelled and failed reviews cannot be sent', () => {
  const { pendingReviewStore } = createStores();

  pendingReviewStore.createDraft({
    id: 'cancel-review',
    sessionId: 'session-1',
    sourceEndpointId: 'mock-agent',
    targetEndpointId: 'mock-review-agent',
    prompt: 'cancel this',
    now,
  });
  assert.equal(pendingReviewStore.cancel('cancel-review', now + 1)?.status, 'cancelled');
  assert.equal(pendingReviewStore.sendConfirmed('cancel-review', now + 2).ok, false);

  pendingReviewStore.createDraft({
    id: 'failed-review',
    sessionId: 'session-1',
    sourceEndpointId: 'mock-agent',
    targetEndpointId: 'mock-review-agent',
    prompt: 'fail this',
    now,
  });
  assert.equal(pendingReviewStore.fail('failed-review', 'mock failure', now + 3)?.status, 'failed');
  assert.equal(pendingReviewStore.sendConfirmed('failed-review', now + 4).ok, false);
});

test('review prompt is redacted and audit covers lifecycle without raw secret', () => {
  const { packetStore, auditLog, pendingReviewStore } = createStores();

  const draft = pendingReviewStore.createDraft({
    id: 'review-1',
    sessionId: 'session-1',
    sourceEndpointId: 'mock-agent',
    targetEndpointId: 'mock-review-agent',
    prompt: 'API_TOKEN=super-secret-token\nreview this',
    now,
  });
  pendingReviewStore.preview('review-1', now + 1);
  pendingReviewStore.confirm('review-1', now + 2);
  pendingReviewStore.sendConfirmed('review-1', now + 3);
  pendingReviewStore.returnResult('review-1', {
    id: 'result-1',
    summary: 'Reviewed',
    findings: [],
    now: now + 4,
  });
  const cancelReview = pendingReviewStore.createDraft({
    id: 'cancel-review',
    sessionId: 'session-1',
    sourceEndpointId: 'mock-agent',
    targetEndpointId: 'mock-review-agent',
    prompt: 'cancel this',
    now: now + 5,
  });
  pendingReviewStore.cancel(cancelReview.id, now + 6);
  const failReview = pendingReviewStore.createDraft({
    id: 'fail-review',
    sessionId: 'session-1',
    sourceEndpointId: 'mock-agent',
    targetEndpointId: 'mock-review-agent',
    prompt: 'fail this',
    now: now + 7,
  });
  pendingReviewStore.fail(failReview.id, 'expected failure', now + 8);

  const packet = packetStore.getPacket(draft.packetId);
  assert.equal(packet?.processedContent.includes('super-secret-token'), false);
  assert.equal(packet?.processedContent.includes('[REDACTED_ENV_SECRET]'), true);
  assert.equal(draft.prompt.includes('super-secret-token'), false);

  const serializedAudit = JSON.stringify(auditLog.listEvents());
  assert.equal(serializedAudit.includes('super-secret-token'), false);
  assert.deepEqual(auditLog.listEvents().map((event) => event.type), [
    'create_pending_review',
    'preview_review',
    'confirm_review',
    'send_review',
    'return_review_result',
    'create_pending_review',
    'operation_cancelled',
    'create_pending_review',
    'operation_failed',
  ]);
});

test('review result nextPromptDraft creates only a PendingPrompt draft requiring second confirmation', () => {
  const { pendingPromptStore, pendingReviewStore } = createStores();

  pendingReviewStore.createDraft({
    id: 'review-1',
    sessionId: 'session-1',
    sourceEndpointId: 'mock-agent',
    targetEndpointId: 'mock-review-agent',
    prompt: 'review this',
    now,
  });
  pendingReviewStore.preview('review-1', now + 1);
  pendingReviewStore.confirm('review-1', now + 2);
  pendingReviewStore.sendConfirmed('review-1', now + 3);

  const returned = pendingReviewStore.returnResult('review-1', {
    id: 'result-1',
    summary: 'Reviewed',
    findings: [],
    nextPromptDraft: 'Follow up manually',
    now: now + 4,
  });

  assert.equal(returned.ok, true);
  assert.equal(returned.nextPrompt?.status, 'draft');
  assert.equal(returned.nextPrompt?.prompt, 'Follow up manually');
  assert.equal(pendingPromptStore.listPrompts().length, 1);

  const adapter = {
    name: 'mock-adapter',
    sendPrompt: async () => ({
      ok: true,
      transport: 'mock',
    }),
  };
  return pendingPromptStore.sendConfirmedPrompt(returned.nextPrompt.id, adapter, now + 5)
    .then((sendResult) => {
      assert.equal(sendResult.ok, false);
      assert.equal(sendResult.failureReason, 'pending-prompt-not-confirmed');
      assert.equal(pendingReviewStore.get('review-1')?.status, 'returned');
    });
});
