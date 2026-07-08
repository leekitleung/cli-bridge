// Unit tests for step-verification module

import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  requiresVerification,
  VERIFICATION_ERROR_KEYWORDS,
} from '../../apps/local-server/src/shared/step-verification.ts';

describe('step-verification module', () => {
  describe('requiresVerification()', () => {
    test('should return true for run-command', () => {
      assert.strictEqual(requiresVerification('run-command'), true);
    });

    test('should return true for apply-patch', () => {
      assert.strictEqual(requiresVerification('apply-patch'), true);
    });

    test('should return true for write-file', () => {
      assert.strictEqual(requiresVerification('write-file'), true);
    });

    test('should return true for execute', () => {
      assert.strictEqual(requiresVerification('execute'), true);
    });

    test('should return false for review', () => {
      assert.strictEqual(requiresVerification('review'), false);
    });

    test('should return false for read', () => {
      assert.strictEqual(requiresVerification('read'), false);
    });

    test('should return false for ask', () => {
      assert.strictEqual(requiresVerification('ask'), false);
    });

    test('should return false for search', () => {
      assert.strictEqual(requiresVerification('search'), false);
    });

    test('should return false for unknown kind', () => {
      assert.strictEqual(requiresVerification('unknown-action'), false);
    });

    test('should return false for empty string', () => {
      assert.strictEqual(requiresVerification(''), false);
    });
  });

  describe('VERIFICATION_ERROR_KEYWORDS', () => {
    test('should contain error keyword', () => {
      assert.ok(VERIFICATION_ERROR_KEYWORDS.includes('error'));
    });

    test('should contain failed keyword', () => {
      assert.ok(VERIFICATION_ERROR_KEYWORDS.includes('failed'));
    });

    test('should contain failure keyword', () => {
      assert.ok(VERIFICATION_ERROR_KEYWORDS.includes('failure'));
    });

    test('should contain security-related keywords', () => {
      assert.ok(VERIFICATION_ERROR_KEYWORDS.includes('permission denied'));
      assert.ok(VERIFICATION_ERROR_KEYWORDS.includes('cannot'));
    });

    test('should contain file-related keywords', () => {
      assert.ok(VERIFICATION_ERROR_KEYWORDS.includes('no such file'));
      assert.ok(VERIFICATION_ERROR_KEYWORDS.includes('command not found'));
      assert.ok(VERIFICATION_ERROR_KEYWORDS.includes('not found'));
    });

    test('should contain critical error keywords', () => {
      assert.ok(VERIFICATION_ERROR_KEYWORDS.includes('panic'));
      assert.ok(VERIFICATION_ERROR_KEYWORDS.includes('exception'));
      assert.ok(VERIFICATION_ERROR_KEYWORDS.includes('fatal'));
      assert.ok(VERIFICATION_ERROR_KEYWORDS.includes('critical'));
    });

    test('should contain inability keywords', () => {
      assert.ok(VERIFICATION_ERROR_KEYWORDS.includes('unable to'));
    });

    test('should be non-empty array', () => {
      assert.ok(Array.isArray(VERIFICATION_ERROR_KEYWORDS));
      assert.ok(VERIFICATION_ERROR_KEYWORDS.length > 0);
    });
  });
});
