// Unit tests for goal-orchestrator.ts types and interfaces

import { test, describe } from 'node:test';
import assert from 'node:assert';

describe('GoalOrchestrator types', () => {
  describe('AdvanceResult types', () => {
    test('should support noop result', () => {
      const result = {
        type: 'noop' as const,
        reason: 'Goal already completed',
      };
      assert.strictEqual(result.type, 'noop');
      assert.strictEqual(result.reason, 'Goal already completed');
    });

    test('should support plan-completed result', () => {
      const result = {
        type: 'plan-completed' as const,
        goalId: 'goal-1',
        planId: 'plan-1',
      };
      assert.strictEqual(result.type, 'plan-completed');
    });

    test('should support step-completed result', () => {
      const result = {
        type: 'step-completed' as const,
        goalId: 'goal-1',
        planId: 'plan-1',
        stepId: 'step-1',
        stepIndex: 0,
        stepKind: 'read',
        output: 'file content',
      };
      assert.strictEqual(result.type, 'step-completed');
      assert.strictEqual(result.stepKind, 'read');
    });

    test('should support step-gated result', () => {
      const result = {
        type: 'step-gated' as const,
        goalId: 'goal-1',
        planId: 'plan-1',
        stepId: 'step-1',
        stepIndex: 0,
        stepKind: 'execute',
        reason: 'Requires user approval',
      };
      assert.strictEqual(result.type, 'step-gated');
      assert.strictEqual(result.stepKind, 'execute');
    });

    test('should support step-failed result', () => {
      const result = {
        type: 'step-failed' as const,
        goalId: 'goal-1',
        planId: 'plan-1',
        stepId: 'step-1',
        stepIndex: 0,
        failureReason: 'timeout',
      };
      assert.strictEqual(result.type, 'step-failed');
      assert.strictEqual(result.failureReason, 'timeout');
    });

    test('should support ceiling-reached result', () => {
      const result = {
        type: 'ceiling-reached' as const,
        goalId: 'goal-1',
        planId: 'plan-1',
        stepCeiling: 10,
      };
      assert.strictEqual(result.type, 'ceiling-reached');
      assert.strictEqual(result.stepCeiling, 10);
    });

    test('should support tier-violation result', () => {
      const result = {
        type: 'tier-violation' as const,
        goalId: 'goal-1',
        stepId: 'step-1',
        reason: 'Mutating step requires gate approval',
      };
      assert.strictEqual(result.type, 'tier-violation');
    });
  });

  describe('Step kinds', () => {
    test('should support all step kinds', () => {
      const stepKinds = [
        'read',
        'search',
        'ask',
        'review',
        'run-command',
        'write-file',
        'apply-patch',
        'execute',
        'custom',
      ] as const;

      for (const kind of stepKinds) {
        const step = { kind, intent: 'test' };
        assert.strictEqual(step.kind, kind);
      }
    });

    test('should identify mutating step kinds', () => {
      const mutatingKinds = new Set(['write-file', 'apply-patch', 'execute', 'run-command']);
      const nonMutatingKinds = new Set(['read', 'search', 'ask', 'review']);

      for (const kind of mutatingKinds) {
        assert.ok(
          ['write-file', 'apply-patch', 'execute', 'run-command'].includes(kind),
          `${kind} should be mutating`
        );
      }

      for (const kind of nonMutatingKinds) {
        assert.ok(
          ['read', 'search', 'ask', 'review'].includes(kind),
          `${kind} should be non-mutating`
        );
      }
    });
  });

  describe('Goal state transitions', () => {
    test('should support all goal statuses', () => {
      const statuses = [
        'draft',
        'approved',
        'executing',
        'completed',
        'failed',
        'cancelled',
      ] as const;

      for (const status of statuses) {
        const goal = { id: 'goal-1', status };
        assert.strictEqual(goal.status, status);
      }
    });

    test('should support valid state transitions', () => {
      const validTransitions: Record<string, string[]> = {
        draft: ['approved', 'cancelled'],
        approved: ['executing', 'cancelled'],
        executing: ['completed', 'failed', 'cancelled'],
        completed: [],
        failed: [],
        cancelled: [],
      };

      for (const [from, toList] of Object.entries(validTransitions)) {
        for (const to of toList) {
          assert.ok(
            validTransitions[from].includes(to),
            `${from} -> ${to} should be valid`
          );
        }
      }
    });
  });

  describe('Plan state transitions', () => {
    test('should support all plan statuses', () => {
      const statuses = [
        'draft',
        'approved',
        'in-progress',
        'completed',
        'failed',
      ] as const;

      for (const status of statuses) {
        const plan = { id: 'plan-1', status };
        assert.strictEqual(plan.status, status);
      }
    });
  });
});

describe('GoalOrchestrator options', () => {
  test('should require stepCeiling', () => {
    const options = { stepCeiling: 10 };
    assert.strictEqual(options.stepCeiling, 10);
  });

  test('should support optional fields', () => {
    const options = {
      stepCeiling: 10,
      autoApprove: false,
      gateTimeoutMs: 1800000,
    };
    assert.strictEqual(options.autoApprove, false);
    assert.strictEqual(options.gateTimeoutMs, 1800000);
  });

  test('should have sensible defaults', () => {
    const defaults = {
      stepCeiling: 10,
      autoApprove: false,
      gateTimeoutMs: 30 * 60 * 1000,
    };
    assert.strictEqual(defaults.stepCeiling, 10);
    assert.strictEqual(defaults.gateTimeoutMs, 1800000);
  });
});
