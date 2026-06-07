import assert from 'node:assert/strict';
import test from 'node:test';

import {
  validateWorkBuddyExecutionLedgerEvent,
  validateWorkBuddyProjectSnapshot,
  validateWorkBuddyPromptDraftSink,
  validateWorkBuddyReviewResultSink,
  validateWorkBuddyTaskReference,
} from '../packages/shared/src/schemas.ts';
import {
  InMemoryWorkBuddyStateStore,
} from '../apps/local-server/src/workbuddy/workbuddy-state-store.ts';

const now = 1770000000000;

const projectSnapshot = {
  id: 'snapshot-1',
  projectId: 'project-1',
  name: 'CLI Bridge',
  summary: 'Bridge current state',
  taskIds: ['task-1'],
  createdAt: now,
};

const taskReference = {
  id: 'task-1',
  projectId: 'project-1',
  title: 'Review handoff',
  status: 'open',
  createdAt: now,
  updatedAt: now,
};

test('WorkBuddy project and task contracts validate non-executing state', () => {
  assert.deepEqual(validateWorkBuddyProjectSnapshot(projectSnapshot), {
    ok: true,
    errors: [],
  });
  assert.deepEqual(validateWorkBuddyTaskReference(taskReference), {
    ok: true,
    errors: [],
  });
  assert.equal(validateWorkBuddyProjectSnapshot({
    ...projectSnapshot,
    autoExecute: true,
  }).ok, false);
  assert.equal(validateWorkBuddyTaskReference({
    ...taskReference,
    command: 'run',
  }).ok, false);
});

test('WorkBuddy review result and prompt draft sinks reject execution flags', () => {
  const reviewSink = {
    id: 'review-sink-1',
    projectId: 'project-1',
    taskId: 'task-1',
    reviewResultId: 'result-1',
    summary: 'Reviewed',
    findings: ['Keep draft-only'],
    createdAt: now,
  };
  const promptDraftSink = {
    id: 'prompt-sink-1',
    projectId: 'project-1',
    taskId: 'task-1',
    promptDraft: 'Follow up manually',
    status: 'draft',
    createdAt: now,
  };

  assert.equal(validateWorkBuddyReviewResultSink(reviewSink).ok, true);
  assert.equal(validateWorkBuddyPromptDraftSink(promptDraftSink).ok, true);
  for (const key of ['autoSend', 'confirmed', 'sent', 'executable']) {
    assert.equal(validateWorkBuddyReviewResultSink({
      ...reviewSink,
      [key]: true,
    }).ok, false);
    assert.equal(validateWorkBuddyPromptDraftSink({
      ...promptDraftSink,
      [key]: true,
    }).ok, false);
  }
});

test('WorkBuddy execution ledger records external status only and rejects commands', () => {
  const event = {
    id: 'ledger-1',
    projectId: 'project-1',
    taskId: 'task-1',
    kind: 'manual-delivery-recorded',
    summary: 'User confirmed delivery outside WorkBuddy',
    createdAt: now,
  };

  assert.equal(validateWorkBuddyExecutionLedgerEvent(event).ok, true);
  assert.equal(validateWorkBuddyExecutionLedgerEvent({
    ...event,
    command: 'npm test',
  }).ok, false);
  assert.equal(validateWorkBuddyExecutionLedgerEvent({
    ...event,
    autoExecute: true,
  }).ok, false);
});

test('WorkBuddy store records state and never confirms or sends prompts', () => {
  const store = new InMemoryWorkBuddyStateStore();

  const snapshot = store.recordProjectSnapshot(projectSnapshot);
  const task = store.recordTaskReference(taskReference);
  const reviewSink = store.recordReviewResultSink({
    id: 'review-sink-1',
    projectId: snapshot.projectId,
    taskId: task.id,
    reviewResultId: 'result-1',
    summary: 'Reviewed',
    findings: ['No source-agent feedback'],
    createdAt: now + 1,
  });
  const promptSink = store.recordPromptDraftSink({
    id: 'prompt-sink-1',
    projectId: snapshot.projectId,
    taskId: task.id,
    promptDraft: 'Draft only',
    createdAt: now + 2,
  });
  store.recordExecutionLedgerEvent({
    id: 'ledger-1',
    projectId: snapshot.projectId,
    taskId: task.id,
    kind: 'manual-delivery-recorded',
    summary: 'Manual note only',
    createdAt: now + 3,
  });

  assert.equal(reviewSink.summary, 'Reviewed');
  assert.equal(promptSink.status, 'draft');
  assert.equal(store.listPromptDraftSinks()[0].status, 'draft');
  assert.equal(JSON.stringify(store.listAll()).includes('confirmed'), false);
  assert.equal(JSON.stringify(store.listAll()).includes('sent'), false);
});
