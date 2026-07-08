// Unit tests for goal-automation-loop types

import { test, describe } from 'node:test';
import assert from 'node:assert';
import type {
  GoalTickResult,
  GoalLoopConfig,
} from '../../apps/local-server/src/goal/goal-automation-loop.ts';

describe('goal-automation-loop types', () => {
  describe('GoalTickResult', () => {
    test('should accept valid goal-complete type', () => {
      const result: GoalTickResult = {
        type: 'goal-complete',
        message: 'Goal completed successfully',
      };
      assert.strictEqual(result.type, 'goal-complete');
    });

    test('should accept valid goal-failed type', () => {
      const result: GoalTickResult = {
        type: 'goal-failed',
        stepId: 'step-1',
        message: 'Step failed',
      };
      assert.strictEqual(result.type, 'goal-failed');
    });

    test('should accept valid blocked type', () => {
      const result: GoalTickResult = {
        type: 'blocked',
        message: 'Waiting for gate approval',
      };
      assert.strictEqual(result.type, 'blocked');
    });

    test('should accept valid waiting type', () => {
      const result: GoalTickResult = {
        type: 'waiting',
        message: 'Waiting for task completion',
      };
      assert.strictEqual(result.type, 'waiting');
    });

    test('should accept valid error type', () => {
      const result: GoalTickResult = {
        type: 'error',
        message: 'Loop not found',
      };
      assert.strictEqual(result.type, 'error');
    });

    test('should accept valid step-complete type', () => {
      const result: GoalTickResult = {
        type: 'step-complete',
        stepId: 'step-1',
        message: 'Step completed',
      };
      assert.strictEqual(result.type, 'step-complete');
    });

    test('should accept verification-result', () => {
      const result: GoalTickResult = {
        type: 'verification-pass',
        stepId: 'step-1',
        message: 'Verification passed',
        verificationResult: {
          passed: true,
          output: 'result',
        },
      };
      assert.strictEqual(result.verificationResult?.passed, true);
    });

    test('should accept all tick result types', () => {
      const types: GoalTickResult['type'][] = [
        'goal-advance',
        'step-dispatched',
        'step-complete',
        'step-failed',
        'verification-pass',
        'verification-fail',
        'goal-complete',
        'goal-failed',
        'waiting',
        'blocked',
        'error',
      ];

      for (const type of types) {
        const result: GoalTickResult = { type, message: 'test' };
        assert.strictEqual(result.type, type);
      }
    });
  });

  describe('GoalLoopConfig', () => {
    test('should accept full config', () => {
      const config: GoalLoopConfig = {
        planId: 'plan-1',
        workingDirectory: '/workspace',
        preferredExecutor: 'workbuddy',
        autoVerify: true,
        verifyTimeoutMs: 120000,
      };

      assert.strictEqual(config.planId, 'plan-1');
      assert.strictEqual(config.workingDirectory, '/workspace');
      assert.strictEqual(config.preferredExecutor, 'workbuddy');
      assert.strictEqual(config.autoVerify, true);
      assert.strictEqual(config.verifyTimeoutMs, 120000);
    });

    test('should accept minimal config', () => {
      const config: GoalLoopConfig = {
        planId: 'plan-1',
      };

      assert.strictEqual(config.planId, 'plan-1');
      assert.strictEqual(config.workingDirectory, undefined);
    });

    test('should allow autoVerify false', () => {
      const config: GoalLoopConfig = {
        planId: 'plan-1',
        autoVerify: false,
      };
      assert.strictEqual(config.autoVerify, false);
    });

    test('should allow different executors', () => {
      const executors: GoalLoopConfig['preferredExecutor'][] = [
        'workbuddy',
        'opencode',
        'auto',
        undefined,
      ];

      for (const exec of executors) {
        const config: GoalLoopConfig = { planId: 'plan-1', preferredExecutor: exec };
        assert.strictEqual(config.preferredExecutor, exec);
      }
    });
  });
});
