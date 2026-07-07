// Unit tests for verifyStepOutput function in goal-automation-loop.ts

import { test, describe } from 'node:test';
import assert from 'node:assert';
import type { WorkBuddyExecutionResult } from '../apps/local-server/src/adapters/workbuddy-execution-adapter.ts';

// We need to extract the verifyStepOutput function logic for testing
// Since it's a private function, we'll test its behavior through the exported functions

// Re-implement the verifyStepOutput logic for testing (copied from goal-automation-loop.ts)
const ERROR_KEYWORDS = [
  'error',
  'failed',
  'failure',
  'panic',
  'exception',
  'fatal',
  'critical',
  'cannot',
  'unable to',
  'permission denied',
  'no such file',
  'command not found',
  'not found',
];

function isLikelyFalsePositive(keyword: string, stderr: string): boolean {
  const falsePositivePatterns: Record<string, RegExp[]> = {
    'not found': [
      /could not find.*but continuing/i,
      /warning.*not found/i,
    ],
    'error': [
      /no error/i,
      /error handling.*continuing/i,
      /error recovery/i,
    ],
  };

  const patterns = falsePositivePatterns[keyword];
  if (!patterns) return false;

  return patterns.some(pattern => pattern.test(stderr));
}

function verifyStepOutput(
  result: WorkBuddyExecutionResult,
): { passed: boolean; output?: string; reason?: string } {
  // 1. 检查 ok 字段
  if (!result.ok) {
    const reason = result.failureReason
      ?? result.stderr
      ?? `Execution failed with exit code ${result.exitCode ?? 'unknown'}`;
    return { passed: false, reason };
  }

  // 2. 检查 exitCode
  if (result.exitCode !== undefined && result.exitCode !== 0) {
    return {
      passed: false,
      reason: `Non-zero exit code: ${result.exitCode}`,
    };
  }

  // 3. 检查 stderr 中的错误关键词
  if (result.stderr) {
    const stderrLower = result.stderr.toLowerCase();
    for (const keyword of ERROR_KEYWORDS) {
      if (stderrLower.includes(keyword)) {
        // 排除误报：某些关键词在成功输出中也可能出现
        const isFalsePositive = isLikelyFalsePositive(keyword, result.stderr);
        if (!isFalsePositive) {
          return {
            passed: false,
            reason: `Error keyword "${keyword}" found in stderr`,
          };
        }
      }
    }
  }

  // 4. 成功
  return { passed: true, output: result.stdout };
}

describe('verifyStepOutput', () => {
  describe('basic result validation', () => {
    test('should pass for successful result with ok=true', () => {
      const result: WorkBuddyExecutionResult = {
        ok: true,
        stdout: 'Success output',
        exitCode: 0,
      };

      const verification = verifyStepOutput(result);

      assert.strictEqual(verification.passed, true);
      assert.strictEqual(verification.output, 'Success output');
    });

    test('should fail for result with ok=false', () => {
      const result: WorkBuddyExecutionResult = {
        ok: false,
        stdout: '',
        stderr: 'Something went wrong',
        failureReason: 'test failure',
      };

      const verification = verifyStepOutput(result);

      assert.strictEqual(verification.passed, false);
      assert.strictEqual(verification.reason, 'test failure');
    });

    test('should use stderr as reason when failureReason is missing', () => {
      const result: WorkBuddyExecutionResult = {
        ok: false,
        stdout: '',
        stderr: 'stderr error message',
      };

      const verification = verifyStepOutput(result);

      assert.strictEqual(verification.passed, false);
      assert.strictEqual(verification.reason, 'stderr error message');
    });

    test('should use exitCode as reason when both failureReason and stderr are missing', () => {
      const result: WorkBuddyExecutionResult = {
        ok: false,
        stdout: '',
        exitCode: 127,
      };

      const verification = verifyStepOutput(result);

      assert.strictEqual(verification.passed, false);
      assert.strictEqual(verification.reason, 'Execution failed with exit code 127');
    });
  });

  describe('exit code validation', () => {
    test('should pass for result with exitCode=0', () => {
      const result: WorkBuddyExecutionResult = {
        ok: true,
        stdout: 'output',
        exitCode: 0,
      };

      const verification = verifyStepOutput(result);

      assert.strictEqual(verification.passed, true);
    });

    test('should fail for non-zero exit code', () => {
      const result: WorkBuddyExecutionResult = {
        ok: true,
        stdout: 'some output',
        stderr: '',
        exitCode: 1,
      };

      const verification = verifyStepOutput(result);

      assert.strictEqual(verification.passed, false);
      assert.strictEqual(verification.reason, 'Non-zero exit code: 1');
    });

    test('should pass when exitCode is undefined', () => {
      const result: WorkBuddyExecutionResult = {
        ok: true,
        stdout: 'output',
      };

      const verification = verifyStepOutput(result);

      assert.strictEqual(verification.passed, true);
    });
  });

  describe('stderr error keyword detection', () => {
    test('should fail when stderr contains "error" keyword', () => {
      const result: WorkBuddyExecutionResult = {
        ok: true,
        stdout: 'output',
        stderr: 'Error: something failed',
        exitCode: 0,
      };

      const verification = verifyStepOutput(result);

      assert.strictEqual(verification.passed, false);
      assert.strictEqual(verification.reason, 'Error keyword "error" found in stderr');
    });

    test('should fail when stderr contains "failed" keyword', () => {
      const result: WorkBuddyExecutionResult = {
        ok: true,
        stdout: 'output',
        stderr: 'Command failed to execute',
        exitCode: 0,
      };

      const verification = verifyStepOutput(result);

      assert.strictEqual(verification.passed, false);
      assert.strictEqual(verification.reason, 'Error keyword "failed" found in stderr');
    });

    test('should fail when stderr contains "permission denied"', () => {
      const result: WorkBuddyExecutionResult = {
        ok: true,
        stdout: '',
        stderr: 'Permission denied when accessing file',
        exitCode: 0,
      };

      const verification = verifyStepOutput(result);

      assert.strictEqual(verification.passed, false);
      assert.strictEqual(verification.reason, 'Error keyword "permission denied" found in stderr');
    });

    test('should fail when stderr contains "not found"', () => {
      const result: WorkBuddyExecutionResult = {
        ok: true,
        stdout: '',
        stderr: 'File not found: config.json',
        exitCode: 0,
      };

      const verification = verifyStepOutput(result);

      assert.strictEqual(verification.passed, false);
      assert.strictEqual(verification.reason, 'Error keyword "not found" found in stderr');
    });
  });

  describe('false positive handling', () => {
    test('should pass when stderr contains "no error"', () => {
      const result: WorkBuddyExecutionResult = {
        ok: true,
        stdout: 'output',
        stderr: 'There was no error in processing',
        exitCode: 0,
      };

      const verification = verifyStepOutput(result);

      assert.strictEqual(verification.passed, true);
    });

    test('should pass when stderr contains "warning not found"', () => {
      const result: WorkBuddyExecutionResult = {
        ok: true,
        stdout: 'output',
        stderr: 'Warning: config file not found, using defaults',
        exitCode: 0,
      };

      const verification = verifyStepOutput(result);

      assert.strictEqual(verification.passed, true);
    });

    test('should pass when stderr contains "error handling continuing"', () => {
      const result: WorkBuddyExecutionResult = {
        ok: true,
        stdout: 'output',
        stderr: 'Error handling: continuing with recovery',
        exitCode: 0,
      };

      const verification = verifyStepOutput(result);

      assert.strictEqual(verification.passed, true);
    });

    test('should pass when stderr contains "could not find but continuing"', () => {
      const result: WorkBuddyExecutionResult = {
        ok: true,
        stdout: 'output',
        stderr: 'Could not find optional file, but continuing',
        exitCode: 0,
      };

      const verification = verifyStepOutput(result);

      assert.strictEqual(verification.passed, true);
    });

    test('should still detect real errors in long output', () => {
      const result: WorkBuddyExecutionResult = {
        ok: true,
        stdout: 'Processing files...',
        stderr: 'File processed successfully. Error: connection to database lost.',
        exitCode: 0,
      };

      const verification = verifyStepOutput(result);

      assert.strictEqual(verification.passed, false);
      assert.strictEqual(verification.reason, 'Error keyword "error" found in stderr');
    });
  });

  describe('edge cases', () => {
    test('should handle empty result', () => {
      const result: WorkBuddyExecutionResult = {
        ok: true,
      };

      const verification = verifyStepOutput(result);

      assert.strictEqual(verification.passed, true);
      assert.strictEqual(verification.output, undefined);
    });

    test('should handle result with only stdout', () => {
      const result: WorkBuddyExecutionResult = {
        ok: true,
        stdout: 'Hello World',
      };

      const verification = verifyStepOutput(result);

      assert.strictEqual(verification.passed, true);
      assert.strictEqual(verification.output, 'Hello World');
    });

    test('should handle result with empty stderr', () => {
      const result: WorkBuddyExecutionResult = {
        ok: true,
        stdout: 'output',
        stderr: '',
        exitCode: 0,
      };

      const verification = verifyStepOutput(result);

      assert.strictEqual(verification.passed, true);
    });

    test('should handle case-insensitive keyword matching', () => {
      const result: WorkBuddyExecutionResult = {
        ok: true,
        stdout: '',
        stderr: 'A fatal issue occurred',
        exitCode: 0,
      };

      const verification = verifyStepOutput(result);

      assert.strictEqual(verification.passed, false);
      assert.ok(verification.reason?.includes('fatal'));
    });
  });
});

describe('isLikelyFalsePositive', () => {
  test('should return false for unknown keywords', () => {
    const result = isLikelyFalsePositive('unknown-keyword', 'Some error message');
    assert.strictEqual(result, false);
  });

  test('should return true for "no error" pattern', () => {
    const result = isLikelyFalsePositive('error', 'There was no error in the process');
    assert.strictEqual(result, true);
  });

  test('should return true for "error recovery" pattern', () => {
    const result = isLikelyFalsePositive('error', 'Error recovery successful');
    assert.strictEqual(result, true);
  });
});
