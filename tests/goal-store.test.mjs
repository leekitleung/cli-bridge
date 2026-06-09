import assert from 'node:assert/strict';
import test from 'node:test';

import { InMemoryGoalStore, isStateMutatingKind } from '../apps/local-server/src/storage/goal-store.ts';

const now = 1780000000000;

function setup() {
  return new InMemoryGoalStore();
}

test('state-mutating kinds are classified correctly', () => {
  for (const k of ['apply-patch', 'run-command', 'write-file', 'delete-file', 'git-commit', 'git-push']) {
    assert.equal(isStateMutatingKind(k), true, `${k} should be mutating`);
  }
  for (const k of ['review', 'summarize', 'propose-patch']) {
    assert.equal(isStateMutatingKind(k), false, `${k} should be non-mutating`);
  }
});

test('createGoal starts in draft; attachPlan defaults tier and flags mutating steps', () => {
  const store = setup();
  const goal = store.createGoal({ sessionId: 's1', description: 'do X', now });
  assert.equal(goal.status, 'draft');

  const plan = store.attachPlan({
    goalId: goal.id,
    steps: [
      { intent: 'review code', kind: 'review', targetEndpointId: 'claude-code-command' },
      { intent: 'apply the patch', kind: 'apply-patch', targetEndpointId: 'codex-command' },
    ],
    now: now + 1,
  });
  assert.equal(plan.status, 'awaiting-approval');
  assert.equal(store.getGoal(goal.id).status, 'planned');
  assert.equal(plan.steps[0].tier, 'patch-proposal'); // default
  assert.equal(plan.steps[0].isStateMutating, false);
  assert.equal(plan.steps[1].isStateMutating, true);
});

test('a step cannot run before the plan is approved', () => {
  const store = setup();
  const goal = store.createGoal({ sessionId: 's1', description: 'x', now });
  const plan = store.attachPlan({
    goalId: goal.id,
    steps: [{ intent: 'review', kind: 'review', targetEndpointId: 'claude-code-command' }],
    now: now + 1,
  });
  // nextRunnableStep is undefined while awaiting-approval.
  assert.equal(store.nextRunnableStep(goal.id), undefined);
  // markStepRunning is rejected too.
  assert.equal(store.markStepRunning(goal.id, plan.steps[0].id), undefined);
});

test('non-mutating step auto-runs within an approved plan; plan completes', () => {
  const store = setup();
  const goal = store.createGoal({ sessionId: 's1', description: 'x', now });
  const plan = store.attachPlan({
    goalId: goal.id,
    steps: [{ intent: 'review', kind: 'review', targetEndpointId: 'claude-code-command' }],
    now: now + 1,
  });
  store.approvePlan(goal.id, now + 2);
  assert.equal(store.getGoal(goal.id).status, 'approved');

  const next = store.nextRunnableStep(goal.id);
  assert.equal(next.kind, 'review');
  const running = store.markStepRunning(goal.id, next.id, now + 3);
  assert.equal(running.status, 'running');
  const done = store.completeStep(goal.id, next.id, 'looks ok', now + 4);
  assert.equal(done.status, 'done');
  // Plan + goal complete when all steps done.
  assert.equal(store.getPlanByGoal(goal.id).status, 'done');
  assert.equal(store.getGoal(goal.id).status, 'done');
});

test('state-mutating step CANNOT run without passing the gate', () => {
  const store = setup();
  const goal = store.createGoal({ sessionId: 's1', description: 'x', now });
  const plan = store.attachPlan({
    goalId: goal.id,
    steps: [{ intent: 'apply patch', kind: 'apply-patch', targetEndpointId: 'codex-command' }],
    now: now + 1,
  });
  store.approvePlan(goal.id, now + 2);
  const step = plan.steps[0];

  // Directly trying to run a pending mutating step is rejected.
  assert.equal(store.markStepRunning(goal.id, step.id, now + 3), undefined);

  // It must be blocked for the gate, then gate-approved, then it can run.
  const blocked = store.blockStepForGate(goal.id, step.id, now + 3);
  assert.equal(blocked.status, 'blocked-needs-gate');
  // Still cannot run while only blocked.
  assert.equal(store.markStepRunning(goal.id, step.id, now + 4), undefined);

  const gated = store.approveStepGate(goal.id, step.id, now + 5);
  assert.equal(gated.status, 'gated-approved');
  const running = store.markStepRunning(goal.id, step.id, now + 6);
  assert.equal(running.status, 'running');
});

test('cancelGoal cancels goal and its plan', () => {
  const store = setup();
  const goal = store.createGoal({ sessionId: 's1', description: 'x', now });
  store.attachPlan({
    goalId: goal.id,
    steps: [{ intent: 'review', kind: 'review', targetEndpointId: 'claude-code-command' }],
    now: now + 1,
  });
  const cancelled = store.cancelGoal(goal.id, now + 2);
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(store.getPlanByGoal(goal.id).status, 'cancelled');
});

test('approvePlan only works on an awaiting-approval plan', () => {
  const store = setup();
  const goal = store.createGoal({ sessionId: 's1', description: 'x', now });
  // No plan yet.
  assert.equal(store.approvePlan(goal.id), undefined);
});
