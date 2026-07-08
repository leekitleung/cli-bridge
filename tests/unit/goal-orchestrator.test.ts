// Unit tests for GoalOrchestrator

import { test, describe, beforeEach, mock } from 'node:test';
import assert from 'node:assert';
import type {
  Goal,
  Plan,
  PlanStep,
  ExecutionTier,
  PlanStepKind,
} from '../../packages/shared/src/types.ts';
import { GoalOrchestrator } from '../../apps/local-server/src/goal/goal-orchestrator.ts';

// Helper to create a minimal goal
function makeGoal(overrides: Partial<Goal> = {}): Goal {
  return {
    id: 'goal-1',
    projectId: 'test-project',
    label: 'Test Goal',
    description: 'A test goal',
    status: 'approved',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    createdBy: 'test-user',
    ...overrides,
  };
}

// Helper to create a minimal plan
function makePlan(goalId: string, overrides: Partial<Plan> = {}): Plan {
  return {
    id: 'plan-1',
    goalId,
    projectId: 'test-project',
    label: 'Test Plan',
    status: 'approved',
    permittedTiers: ['patch-proposal', 'workspace-write'] as ExecutionTier[],
    steps: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

// Helper to create a step
function makeStep(overrides: Partial<PlanStep> = {}): PlanStep {
  return {
    id: 'step-1',
    index: 0,
    description: 'Test Step',
    tier: 'patch-proposal' as ExecutionTier,
    kind: 'review' as PlanStepKind,
    status: 'pending',
    isStateMutating: false,
    isVerified: false,
    ...overrides,
  };
}

// Mock GoalStore
class MockGoalStore {
  private goals = new Map<string, Goal>();
  private plans = new Map<string, Plan>();

  reset() {
    this.goals.clear();
    this.plans.clear();
  }

  addGoal(goal: Goal) {
    this.goals.set(goal.id, goal);
  }

  addPlan(plan: Plan) {
    this.plans.set(plan.id, plan);
  }

  getGoal(id: string): Goal | undefined {
    return this.goals.get(id);
  }

  getPlanByGoal(goalId: string): Plan | undefined {
    for (const plan of this.plans.values()) {
      if (plan.goalId === goalId) return plan;
    }
    return undefined;
  }

  nextRunnableStep(goalId: string): PlanStep | undefined {
    const plan = this.getPlanByGoal(goalId);
    if (!plan) return undefined;
    // Find first pending or gated-approved step
    return plan.steps.find(s => s.status === 'pending' || s.status === 'gated-approved');
  }

  blockStepForGate(goalId: string, stepId: string): PlanStep | undefined {
    const plan = this.getPlanByGoal(goalId);
    if (!plan) return undefined;
    const step = plan.steps.find(s => s.id === stepId);
    if (step) {
      step.status = 'blocked-needs-gate';
    }
    return step;
  }

  markStepRunning(goalId: string, stepId: string): PlanStep | undefined {
    const plan = this.getPlanByGoal(goalId);
    if (!plan) return undefined;
    const step = plan.steps.find(s => s.id === stepId);
    if (step) {
      step.status = 'running';
    }
    return step;
  }

  completeStep(goalId: string, stepId: string, output?: string): PlanStep | undefined {
    const plan = this.getPlanByGoal(goalId);
    if (!plan) return undefined;
    const step = plan.steps.find(s => s.id === stepId);
    if (step) {
      step.status = 'done';
      if (output) step.output = output;
    }
    return step;
  }

  failStep(goalId: string, stepId: string, reason: string): PlanStep | undefined {
    const plan = this.getPlanByGoal(goalId);
    if (!plan) return undefined;
    const step = plan.steps.find(s => s.id === stepId);
    if (step) {
      step.status = 'failed';
      step.failureReason = reason;
    }
    return step;
  }
}

describe('GoalOrchestrator', () => {
  let store: MockGoalStore;
  let orchestrator: GoalOrchestrator;

  beforeEach(() => {
    store = new MockGoalStore();
    orchestrator = new GoalOrchestrator(store as any, { stepCeiling: 10 });
  });

  describe('advance() - Goal pre-conditions', () => {
    test('should return noop when goal not found', () => {
      const result = orchestrator.advance('nonexistent');
      assert.strictEqual(result.type, 'noop');
      assert.strictEqual((result as any).reason, 'goal-not-found');
    });

    test('should return noop when goal is cancelled', () => {
      store.addGoal(makeGoal({ status: 'cancelled' }));
      store.addPlan(makePlan('goal-1'));
      const result = orchestrator.advance('goal-1');
      assert.strictEqual(result.type, 'noop');
      assert.strictEqual((result as any).reason, 'goal-cancelled');
    });

    test('should return noop when goal is failed', () => {
      store.addGoal(makeGoal({ status: 'failed' }));
      store.addPlan(makePlan('goal-1'));
      const result = orchestrator.advance('goal-1');
      assert.strictEqual(result.type, 'noop');
      assert.strictEqual((result as any).reason, 'goal-failed');
    });

    test('should return plan-completed when goal is done', () => {
      store.addGoal(makeGoal({ status: 'done' }));
      store.addPlan(makePlan('goal-1'));
      const result = orchestrator.advance('goal-1');
      assert.strictEqual(result.type, 'plan-completed');
    });

    test('should return noop when goal status is draft', () => {
      store.addGoal(makeGoal({ status: 'draft' }));
      store.addPlan(makePlan('goal-1'));
      const result = orchestrator.advance('goal-1');
      assert.strictEqual(result.type, 'noop');
      assert.ok((result as any).reason.includes('goal-status'));
    });
  });

  describe('advance() - Plan pre-conditions', () => {
    test('should return noop when plan not found', () => {
      store.addGoal(makeGoal({ status: 'approved' }));
      const result = orchestrator.advance('goal-1');
      assert.strictEqual(result.type, 'noop');
      assert.strictEqual((result as any).reason, 'plan-not-found');
    });

    test('should return noop when plan is cancelled', () => {
      store.addGoal(makeGoal({ status: 'approved' }));
      store.addPlan(makePlan('goal-1', { status: 'cancelled' }));
      const result = orchestrator.advance('goal-1');
      assert.strictEqual(result.type, 'noop');
      assert.strictEqual((result as any).reason, 'plan-cancelled');
    });

    test('should return plan-completed when plan is done', () => {
      store.addGoal(makeGoal({ status: 'approved' }));
      store.addPlan(makePlan('goal-1', { status: 'done' }));
      const result = orchestrator.advance('goal-1');
      assert.strictEqual(result.type, 'plan-completed');
    });

    test('should return noop when plan status is draft', () => {
      store.addGoal(makeGoal({ status: 'approved' }));
      store.addPlan(makePlan('goal-1', { status: 'draft' }));
      const result = orchestrator.advance('goal-1');
      assert.strictEqual(result.type, 'noop');
      assert.ok((result as any).reason.includes('plan-status'));
    });
  });

  describe('advance() - Fail-stop on failed step', () => {
    test('should return step-failed when any step has failed', () => {
      store.addGoal(makeGoal({ status: 'approved' }));
      store.addPlan(makePlan('goal-1', {
        steps: [
          makeStep({ id: 'step-1', status: 'done' }),
          makeStep({ id: 'step-2', status: 'failed', failureReason: 'test failure' }),
        ],
      }));
      const result = orchestrator.advance('goal-1');
      assert.strictEqual(result.type, 'step-failed');
      assert.strictEqual((result as any).stepId, 'step-2');
      assert.strictEqual((result as any).failureReason, 'test failure');
    });
  });

  describe('advance() - Step ceiling', () => {
    test('should return ceiling-reached when step ceiling exceeded', () => {
      store.addGoal(makeGoal({ status: 'approved' }));
      store.addPlan(makePlan('goal-1', {
        steps: [
          makeStep({ id: 'step-1' }),
          makeStep({ id: 'step-2' }),
          makeStep({ id: 'step-3' }),
        ],
      }));
      const limitedOrchestrator = new GoalOrchestrator(store as any, { stepCeiling: 2 });
      limitedOrchestrator.advance('goal-1');
      limitedOrchestrator.advance('goal-1');
      const result = limitedOrchestrator.advance('goal-1');
      assert.strictEqual(result.type, 'ceiling-reached');
      assert.strictEqual((result as any).stepCeiling, 2);
    });

    test('should track stepsAdvanced correctly', () => {
      assert.strictEqual(orchestrator.stepsAdvanced, 0);
      orchestrator.advance('goal-1'); // noop - no plan
      assert.strictEqual(orchestrator.stepsAdvanced, 0);

      store.addGoal(makeGoal({ status: 'approved' }));
      store.addPlan(makePlan('goal-1', {
        steps: [makeStep({ id: 'step-1' })],
      }));
      orchestrator.advance('goal-1');
      assert.strictEqual(orchestrator.stepsAdvanced, 1);
    });
  });

  describe('advance() - Tier violation', () => {
    test('should return tier-violation when step tier not permitted', () => {
      store.addGoal(makeGoal({ status: 'approved' }));
      store.addPlan(makePlan('goal-1', {
        permittedTiers: ['tier-1'] as ExecutionTier[],
        steps: [makeStep({ id: 'step-1', tier: 'tier-2' as ExecutionTier })],
      }));
      const result = orchestrator.advance('goal-1');
      assert.strictEqual(result.type, 'tier-violation');
      assert.strictEqual((result as any).tier, 'tier-2');
    });
  });

  describe('advance() - Mutating step gating', () => {
    test('should return step-gated for mutating pending step', () => {
      store.addGoal(makeGoal({ status: 'approved' }));
      store.addPlan(makePlan('goal-1', {
        steps: [makeStep({ id: 'step-1', isStateMutating: true })],
      }));
      const result = orchestrator.advance('goal-1');
      assert.strictEqual(result.type, 'step-gated');
      assert.strictEqual((result as any).stepId, 'step-1');
    });

    test('should complete mutating step if already gated-approved', () => {
      store.addGoal(makeGoal({ status: 'approved' }));
      store.addPlan(makePlan('goal-1', {
        steps: [makeStep({ id: 'step-1', isStateMutating: true, status: 'gated-approved' })],
      }));
      const result = orchestrator.advance('goal-1');
      assert.strictEqual(result.type, 'step-completed');
      assert.strictEqual((result as any).stepId, 'step-1');
    });
  });

  describe('advance() - Non-mutating step completion', () => {
    test('should complete non-mutating step', () => {
      store.addGoal(makeGoal({ status: 'approved' }));
      store.addPlan(makePlan('goal-1', {
        steps: [makeStep({ id: 'step-1', isStateMutating: false })],
      }));
      const result = orchestrator.advance('goal-1');
      assert.strictEqual(result.type, 'step-completed');
      assert.strictEqual((result as any).stepId, 'step-1');
      assert.strictEqual((result as any).stepKind, 'review');
    });

    test('should record output when completing step', () => {
      store.addGoal(makeGoal({ status: 'approved' }));
      store.addPlan(makePlan('goal-1', {
        steps: [makeStep({ id: 'step-1' })],
      }));
      const result = orchestrator.advance('goal-1', { output: 'test output' });
      assert.strictEqual(result.type, 'step-completed');
      assert.strictEqual((result as any).output, 'test output');
    });

    test('should fail step when simulateFailure is set', () => {
      store.addGoal(makeGoal({ status: 'approved' }));
      store.addPlan(makePlan('goal-1', {
        steps: [makeStep({ id: 'step-1' })],
      }));
      const result = orchestrator.advance('goal-1', { simulateFailure: 'simulated error' });
      assert.strictEqual(result.type, 'step-failed');
      assert.strictEqual((result as any).failureReason, 'simulated error');
    });
  });

  describe('advance() - No runnable steps', () => {
    test('should return plan-completed when all steps done', () => {
      store.addGoal(makeGoal({ status: 'approved' }));
      store.addPlan(makePlan('goal-1', {
        steps: [
          makeStep({ id: 'step-1', status: 'done' }),
          makeStep({ id: 'step-2', status: 'done' }),
        ],
      }));
      const result = orchestrator.advance('goal-1');
      assert.strictEqual(result.type, 'plan-completed');
    });

    test('should return noop with all-runnable-steps-are-gated when all steps blocked', () => {
      store.addGoal(makeGoal({ status: 'approved' }));
      store.addPlan(makePlan('goal-1', {
        steps: [
          makeStep({ id: 'step-1', status: 'blocked-needs-gate', isStateMutating: true }),
        ],
      }));
      const result = orchestrator.advance('goal-1');
      assert.strictEqual(result.type, 'noop');
      assert.strictEqual((result as any).reason, 'all-runnable-steps-are-gated');
    });

    test('should return noop with no-runnable-step when no pending steps', () => {
      store.addGoal(makeGoal({ status: 'approved' }));
      store.addPlan(makePlan('goal-1', {
        steps: [
          makeStep({ id: 'step-1', status: 'running' }),
        ],
      }));
      const result = orchestrator.advance('goal-1');
      assert.strictEqual(result.type, 'noop');
      assert.strictEqual((result as any).reason, 'no-runnable-step');
    });
  });

  describe('runAll()', () => {
    test('should run all non-mutating steps in sequence', () => {
      store.addGoal(makeGoal({ status: 'approved' }));
      store.addPlan(makePlan('goal-1', {
        steps: [
          makeStep({ id: 'step-1' }),
          makeStep({ id: 'step-2' }),
          makeStep({ id: 'step-3' }),
        ],
      }));
      const results = orchestrator.runAll('goal-1');
      // 3 steps completed + 1 plan-completed = 4 results
      assert.strictEqual(results.length, 4);
      assert.strictEqual(results[0].type, 'step-completed');
      assert.strictEqual(results[1].type, 'step-completed');
      assert.strictEqual(results[2].type, 'step-completed');
      assert.strictEqual(results[3].type, 'plan-completed');
    });

    test('should stop at first gate', () => {
      store.addGoal(makeGoal({ status: 'approved' }));
      store.addPlan(makePlan('goal-1', {
        steps: [
          makeStep({ id: 'step-1' }),
          makeStep({ id: 'step-2', isStateMutating: true }),
          makeStep({ id: 'step-3' }),
        ],
      }));
      const results = orchestrator.runAll('goal-1');
      assert.strictEqual(results.length, 2);
      assert.strictEqual(results[0].type, 'step-completed');
      assert.strictEqual(results[1].type, 'step-gated');
    });

    test('should stop at plan completion', () => {
      store.addGoal(makeGoal({ status: 'approved' }));
      store.addPlan(makePlan('goal-1', {
        steps: [
          makeStep({ id: 'step-1' }),
          makeStep({ id: 'step-2' }),
        ],
      }));
      const results = orchestrator.runAll('goal-1');
      assert.ok(results.some(r => r.type === 'plan-completed'));
    });
  });
});
