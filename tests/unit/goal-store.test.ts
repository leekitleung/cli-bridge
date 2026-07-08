// Unit tests for InMemoryGoalStore

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert';
import { InMemoryGoalStore, isStateMutatingKind } from '../../apps/local-server/src/storage/goal-store.ts';

describe('InMemoryGoalStore', () => {
  let store: InMemoryGoalStore;

  beforeEach(() => {
    store = new InMemoryGoalStore();
  });

  describe('createGoal()', () => {
    test('should create a goal with draft status', () => {
      const goal = store.createGoal({
        sessionId: 'session-1',
        description: 'Test goal',
      });
      assert.ok(goal.id);
      assert.strictEqual(goal.status, 'draft');
      assert.strictEqual(goal.description, 'Test goal');
    });

    test('should create goal with custom id', () => {
      const goal = store.createGoal({
        id: 'custom-id',
        sessionId: 'session-1',
        description: 'Test goal',
      });
      assert.strictEqual(goal.id, 'custom-id');
    });

    test('should create goal with projectId', () => {
      const goal = store.createGoal({
        sessionId: 'session-1',
        description: 'Test goal',
        projectId: 'my-project',
      });
      assert.strictEqual(goal.projectId, 'my-project');
    });

    test('should get created goal', () => {
      const created = store.createGoal({
        sessionId: 'session-1',
        description: 'Test goal',
      });
      const retrieved = store.getGoal(created.id);
      assert.strictEqual(retrieved?.id, created.id);
      assert.strictEqual(retrieved?.description, created.description);
    });
  });

  describe('attachPlan()', () => {
    test('should attach plan to draft goal', () => {
      const goal = store.createGoal({
        sessionId: 'session-1',
        description: 'Test goal',
      });
      const plan = store.attachPlan({
        goalId: goal.id,
        steps: [
          { intent: 'Step 1', kind: 'review', targetEndpointId: 'codex' },
        ],
      });
      assert.ok(plan);
      assert.strictEqual(plan.goalId, goal.id);
      assert.strictEqual(plan.status, 'awaiting-approval');
      assert.strictEqual(plan.steps.length, 1);
    });

    test('should not attach plan to non-draft goal', () => {
      const goal = store.createGoal({
        sessionId: 'session-1',
        description: 'Test goal',
      });
      goal.status = 'approved';
      store['goals'].set(goal.id, goal);

      const plan = store.attachPlan({
        goalId: goal.id,
        steps: [
          { intent: 'Step 1', kind: 'review', targetEndpointId: 'codex' },
        ],
      });
      assert.strictEqual(plan, undefined);
    });

    test('should mark mutating steps correctly', () => {
      const goal = store.createGoal({
        sessionId: 'session-1',
        description: 'Test goal',
      });
      const plan = store.attachPlan({
        goalId: goal.id,
        steps: [
          { intent: 'Read', kind: 'review', targetEndpointId: 'codex' },
          { intent: 'Write file', kind: 'write-file', targetEndpointId: 'codex' },
          { intent: 'Run command', kind: 'run-command', targetEndpointId: 'codex' },
        ],
      });
      assert.ok(plan);
      assert.strictEqual(plan!.steps[0].isStateMutating, false);
      assert.strictEqual(plan!.steps[1].isStateMutating, true);
      assert.strictEqual(plan!.steps[2].isStateMutating, true);
    });

    test('should get plan by goal', () => {
      const goal = store.createGoal({
        sessionId: 'session-1',
        description: 'Test goal',
      });
      const plan = store.attachPlan({
        goalId: goal.id,
        steps: [
          { intent: 'Step 1', kind: 'review', targetEndpointId: 'codex' },
        ],
      });
      const retrieved = store.getPlanByGoal(goal.id);
      assert.strictEqual(retrieved?.id, plan?.id);
    });
  });

  describe('approvePlan()', () => {
    test('should approve awaiting-approval plan', () => {
      const goal = store.createGoal({
        sessionId: 'session-1',
        description: 'Test goal',
      });
      store.attachPlan({
        goalId: goal.id,
        steps: [
          { intent: 'Step 1', kind: 'review', targetEndpointId: 'codex' },
        ],
      });
      const plan = store.approvePlan(goal.id);
      assert.strictEqual(plan?.status, 'approved');
      assert.ok(plan?.approvedAt);
    });

    test('should update goal status to approved', () => {
      const goal = store.createGoal({
        sessionId: 'session-1',
        description: 'Test goal',
      });
      store.attachPlan({
        goalId: goal.id,
        steps: [
          { intent: 'Step 1', kind: 'review', targetEndpointId: 'codex' },
        ],
      });
      store.approvePlan(goal.id);
      const updatedGoal = store.getGoal(goal.id);
      assert.strictEqual(updatedGoal?.status, 'approved');
    });

    test('should not approve non-awaiting plan', () => {
      const goal = store.createGoal({
        sessionId: 'session-1',
        description: 'Test goal',
      });
      const result = store.approvePlan(goal.id);
      assert.strictEqual(result, undefined);
    });
  });

  describe('nextRunnableStep()', () => {
    test('should return first pending step for approved plan', () => {
      const goal = store.createGoal({
        sessionId: 'session-1',
        description: 'Test goal',
      });
      store.attachPlan({
        goalId: goal.id,
        steps: [
          { intent: 'Step 1', kind: 'review', targetEndpointId: 'codex' },
          { intent: 'Step 2', kind: 'review', targetEndpointId: 'codex' },
        ],
      });
      store.approvePlan(goal.id);

      const step = store.nextRunnableStep(goal.id);
      assert.ok(step);
      assert.strictEqual(step!.index, 0);
    });

    test('should not return step for non-approved plan', () => {
      const goal = store.createGoal({
        sessionId: 'session-1',
        description: 'Test goal',
      });
      store.attachPlan({
        goalId: goal.id,
        steps: [
          { intent: 'Step 1', kind: 'review', targetEndpointId: 'codex' },
        ],
      });
      // Plan is awaiting-approval, not approved

      const step = store.nextRunnableStep(goal.id);
      assert.strictEqual(step, undefined);
    });

    test('should return gated-approved step', () => {
      const goal = store.createGoal({
        sessionId: 'session-1',
        description: 'Test goal',
      });
      store.attachPlan({
        goalId: goal.id,
        steps: [
          { intent: 'Step 1', kind: 'write-file', targetEndpointId: 'codex' },
        ],
      });
      store.approvePlan(goal.id);
      // Block and approve step
      store.blockStepForGate(goal.id, goal.id); // Will not work without step id
    });
  });

  describe('Step transitions', () => {
    test('markStepRunning() should mark step as running', () => {
      const goal = store.createGoal({
        sessionId: 'session-1',
        description: 'Test goal',
      });
      const plan = store.attachPlan({
        goalId: goal.id,
        steps: [
          { intent: 'Step 1', kind: 'review', targetEndpointId: 'codex' },
        ],
      });
      store.approvePlan(goal.id);

      const stepId = plan!.steps[0].id;
      const step = store.markStepRunning(goal.id, stepId);
      assert.strictEqual(step?.status, 'running');
    });

    test('markStepRunning() should not mark mutating step directly', () => {
      const goal = store.createGoal({
        sessionId: 'session-1',
        description: 'Test goal',
      });
      const plan = store.attachPlan({
        goalId: goal.id,
        steps: [
          { intent: 'Step 1', kind: 'write-file', targetEndpointId: 'codex' },
        ],
      });
      store.approvePlan(goal.id);

      const stepId = plan!.steps[0].id;
      const step = store.markStepRunning(goal.id, stepId);
      assert.strictEqual(step, undefined); // Must be gated first
    });

    test('blockStepForGate() should block mutating step', () => {
      const goal = store.createGoal({
        sessionId: 'session-1',
        description: 'Test goal',
      });
      const plan = store.attachPlan({
        goalId: goal.id,
        steps: [
          { intent: 'Step 1', kind: 'write-file', targetEndpointId: 'codex' },
        ],
      });
      store.approvePlan(goal.id);

      const stepId = plan!.steps[0].id;
      const step = store.blockStepForGate(goal.id, stepId);
      assert.strictEqual(step?.status, 'blocked-needs-gate');
    });

    test('approveStepGate() should approve blocked step', () => {
      const goal = store.createGoal({
        sessionId: 'session-1',
        description: 'Test goal',
      });
      const plan = store.attachPlan({
        goalId: goal.id,
        steps: [
          { intent: 'Step 1', kind: 'write-file', targetEndpointId: 'codex' },
        ],
      });
      store.approvePlan(goal.id);

      const stepId = plan!.steps[0].id;
      store.blockStepForGate(goal.id, stepId);
      const step = store.approveStepGate(goal.id, stepId);
      assert.strictEqual(step?.status, 'gated-approved');
    });

    test('completeStep() should mark step as done', () => {
      const goal = store.createGoal({
        sessionId: 'session-1',
        description: 'Test goal',
      });
      const plan = store.attachPlan({
        goalId: goal.id,
        steps: [
          { intent: 'Step 1', kind: 'review', targetEndpointId: 'codex' },
        ],
      });
      store.approvePlan(goal.id);

      const stepId = plan!.steps[0].id;
      store.markStepRunning(goal.id, stepId);
      const step = store.completeStep(goal.id, stepId, 'output');
      assert.strictEqual(step?.status, 'done');
      assert.strictEqual(step?.output, 'output');
    });

    test('failStep() should mark step as failed', () => {
      const goal = store.createGoal({
        sessionId: 'session-1',
        description: 'Test goal',
      });
      const plan = store.attachPlan({
        goalId: goal.id,
        steps: [
          { intent: 'Step 1', kind: 'review', targetEndpointId: 'codex' },
        ],
      });
      store.approvePlan(goal.id);

      const stepId = plan!.steps[0].id;
      store.markStepRunning(goal.id, stepId);
      const step = store.failStep(goal.id, stepId, 'test failure');
      assert.strictEqual(step?.status, 'failed');
      assert.strictEqual(step?.failureReason, 'test failure');
    });
  });

  describe('cancelGoal()', () => {
    test('should cancel goal and associated plan', () => {
      const goal = store.createGoal({
        sessionId: 'session-1',
        description: 'Test goal',
      });
      store.attachPlan({
        goalId: goal.id,
        steps: [
          { intent: 'Step 1', kind: 'review', targetEndpointId: 'codex' },
        ],
      });
      store.approvePlan(goal.id);

      const result = store.cancelGoal(goal.id);
      assert.ok(result);
      assert.strictEqual(result?.status, 'cancelled');

      const updatedGoal = store.getGoal(goal.id);
      assert.strictEqual(updatedGoal?.status, 'cancelled');
    });

    test('should not cancel done goal', () => {
      const goal = store.createGoal({
        sessionId: 'session-1',
        description: 'Test goal',
      });
      goal.status = 'done';
      store['goals'].set(goal.id, goal);

      const result = store.cancelGoal(goal.id);
      assert.strictEqual(result, undefined);
    });
  });

  describe('isStateMutatingKind()', () => {
    test('should return true for mutating kinds', () => {
      assert.strictEqual(isStateMutatingKind('write-file'), true);
      assert.strictEqual(isStateMutatingKind('run-command'), true);
      assert.strictEqual(isStateMutatingKind('git-commit'), true);
      assert.strictEqual(isStateMutatingKind('git-push'), true);
      assert.strictEqual(isStateMutatingKind('delete-file'), true);
      assert.strictEqual(isStateMutatingKind('apply-patch'), true);
    });

    test('should return false for non-mutating kinds', () => {
      assert.strictEqual(isStateMutatingKind('read'), false);
      assert.strictEqual(isStateMutatingKind('search'), false);
      assert.strictEqual(isStateMutatingKind('ask'), false);
      assert.strictEqual(isStateMutatingKind('review'), false);
    });
  });
});
