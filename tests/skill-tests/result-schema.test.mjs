/**
 * result-schema.test.mjs - Tests for result.yaml schema validation
 *
 * Coverage:
 * - Valid result.yaml files
 * - Missing required fields
 * - Invalid score range
 * - Invalid blocker severity
 * - Invalid redline severity
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import * as yaml from 'js-yaml';
const { load: yamlLoad } = yaml;

const PROJECT_ROOT = path.join(process.cwd());

// Inline validation logic (same as in review-runner.mjs)
function validateResultYaml(data) {
  const errors = [];

  if (!data.reviewer) errors.push('Missing required field: reviewer');
  if (typeof data.score !== 'number' && data.score === undefined) errors.push('Missing required field: score');
  if (!Array.isArray(data.blockers)) errors.push('Missing required field: blockers (must be array)');
  if (!Array.isArray(data.redlines)) errors.push('Missing required field: redlines (must be array)');

  const score = Number(data.score);
  if (isNaN(score) || score < 0 || score > 100) {
    errors.push('score must be a number between 0 and 100');
  }

  if (Array.isArray(data.blockers)) {
    for (const blocker of data.blockers) {
      if (typeof blocker === 'object' && blocker.severity) {
        if (!['P0', 'P1', 'P2', 'P3'].includes(blocker.severity)) {
          errors.push(`Invalid blocker severity: ${blocker.severity}`);
        }
      }
    }
  }

  if (Array.isArray(data.redlines)) {
    for (const redline of data.redlines) {
      if (typeof redline === 'object' && redline.severity) {
        if (!['P0', 'P1'].includes(redline.severity)) {
          errors.push(`Redline severity must be P0 or P1, got: ${redline.severity}`);
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

describe('result.yaml Schema Validation', () => {
  describe('Valid result.yaml', () => {
    it('should validate a complete valid result.yaml', () => {
      const validResult = {
        reviewer: 'product-flow',
        score: 92,
        dimension_scores: { completeness: 90, path_closure: 95 },
        blockers: [],
        redlines: [],
        recommendation: 'pass',
      };

      const validation = validateResultYaml(validResult);
      assert.strictEqual(validation.valid, true);
      assert.strictEqual(validation.errors.length, 0);
    });

    it('should validate result with blockers', () => {
      const resultWithBlockers = {
        reviewer: 'product-flow',
        score: 85,
        dimension_scores: { completeness: 85 },
        blockers: [
          { id: 'BLK-001', severity: 'P2', description: 'Minor issue' },
          { id: 'BLK-002', severity: 'P3', description: 'Cosmetic issue' },
        ],
        redlines: [],
        recommendation: 'fail',
      };

      const validation = validateResultYaml(resultWithBlockers);
      assert.strictEqual(validation.valid, true);
    });

    it('should validate result with P0 redline', () => {
      const resultWithRedline = {
        reviewer: 'destructive-qa',
        score: 95,
        dimension_scores: { security: 95 },
        blockers: [],
        redlines: [
          { id: 'RL-001', severity: 'P0', description: 'Critical security issue' },
        ],
        recommendation: 'fail',
      };

      const validation = validateResultYaml(resultWithRedline);
      assert.strictEqual(validation.valid, true);
    });
  });

  describe('Invalid result.yaml - Missing fields', () => {
    it('should fail when reviewer is missing', () => {
      const invalidResult = {
        score: 92,
        blockers: [],
        redlines: [],
      };

      const validation = validateResultYaml(invalidResult);
      assert.strictEqual(validation.valid, false);
      assert.ok(validation.errors.some(e => e.includes('reviewer')));
    });

    it('should fail when score is missing', () => {
      const invalidResult = {
        reviewer: 'product-flow',
        blockers: [],
        redlines: [],
      };

      const validation = validateResultYaml(invalidResult);
      assert.strictEqual(validation.valid, false);
      assert.ok(validation.errors.some(e => e.includes('score')));
    });

    it('should fail when blockers is missing', () => {
      const invalidResult = {
        reviewer: 'product-flow',
        score: 92,
        redlines: [],
      };

      const validation = validateResultYaml(invalidResult);
      assert.strictEqual(validation.valid, false);
      assert.ok(validation.errors.some(e => e.includes('blockers')));
    });

    it('should fail when redlines is missing', () => {
      const invalidResult = {
        reviewer: 'product-flow',
        score: 92,
        blockers: [],
      };

      const validation = validateResultYaml(invalidResult);
      assert.strictEqual(validation.valid, false);
      assert.ok(validation.errors.some(e => e.includes('redlines')));
    });
  });

  describe('Invalid result.yaml - Score range', () => {
    it('should fail when score is negative', () => {
      const invalidResult = {
        reviewer: 'product-flow',
        score: -5,
        blockers: [],
        redlines: [],
      };

      const validation = validateResultYaml(invalidResult);
      assert.strictEqual(validation.valid, false);
      assert.ok(validation.errors.some(e => e.includes('0 and 100')));
    });

    it('should fail when score is over 100', () => {
      const invalidResult = {
        reviewer: 'product-flow',
        score: 150,
        blockers: [],
        redlines: [],
      };

      const validation = validateResultYaml(invalidResult);
      assert.strictEqual(validation.valid, false);
      assert.ok(validation.errors.some(e => e.includes('0 and 100')));
    });

    it('should fail when score is not a number', () => {
      const invalidResult = {
        reviewer: 'product-flow',
        score: 'ninety',
        blockers: [],
        redlines: [],
      };

      const validation = validateResultYaml(invalidResult);
      assert.strictEqual(validation.valid, false);
    });
  });

  describe('Invalid result.yaml - Blocker severity', () => {
    it('should fail when blocker severity is invalid', () => {
      const invalidResult = {
        reviewer: 'product-flow',
        score: 85,
        blockers: [{ id: 'BLK-001', severity: 'P5', description: 'Invalid severity' }],
        redlines: [],
      };

      const validation = validateResultYaml(invalidResult);
      assert.strictEqual(validation.valid, false);
      assert.ok(validation.errors.some(e => e.includes('P5')));
    });

    it('should accept P0, P1, P2, P3 severities for blockers', () => {
      const validSeverities = ['P0', 'P1', 'P2', 'P3'];
      for (const sev of validSeverities) {
        const result = {
          reviewer: 'product-flow',
          score: 85,
          blockers: [{ id: 'BLK-001', severity: sev, description: 'Test' }],
          redlines: [],
        };
        const validation = validateResultYaml(result);
        assert.strictEqual(validation.valid, true, `Severity ${sev} should be valid`);
      }
    });
  });

  describe('Invalid result.yaml - Redline severity', () => {
    it('should fail when redline severity is P2', () => {
      const invalidResult = {
        reviewer: 'destructive-qa',
        score: 95,
        blockers: [],
        redlines: [{ id: 'RL-001', severity: 'P2', description: 'P2 is invalid for redline' }],
      };

      const validation = validateResultYaml(invalidResult);
      assert.strictEqual(validation.valid, false);
      assert.ok(validation.errors.some(e => e.includes('P0 or P1')));
    });

    it('should only accept P0 and P1 for redlines', () => {
      const validResult = {
        reviewer: 'destructive-qa',
        score: 95,
        blockers: [],
        redlines: [
          { id: 'RL-001', severity: 'P0', description: 'Critical' },
          { id: 'RL-002', severity: 'P1', description: 'High' },
        ],
      };

      const validation = validateResultYaml(validResult);
      assert.strictEqual(validation.valid, true);
    });
  });

  describe('Round 1 results validation', () => {
    it('should validate existing round-001 results', () => {
      const roundDir = path.join(PROJECT_ROOT, 'quality-reports', 'round-001');
      const reviewers = ['product-flow', 'destructive-qa', 'terminal-veteran'];

      for (const reviewer of reviewers) {
        const resultPath = path.join(roundDir, reviewer, 'result.yaml');
        if (fs.existsSync(resultPath)) {
          const content = fs.readFileSync(resultPath, 'utf-8');
          const data = yamlLoad(content);
          const validation = validateResultYaml(data);

          assert.strictEqual(
            validation.valid,
            true,
            `Round-001 ${reviewer} should be valid: ${validation.errors.join(', ')}`
          );
        }
      }
    });
  });
});
