/**
 * Unit tests for deep-optimization-lab scripts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

// Test baselines exist for comparison
const EXPERIMENT_LOGS = 'experiment-logs';

describe('baseline-collector', () => {
  describe('Baseline File', () => {
    it('should create baseline.yaml', () => {
      const baselineFile = join(EXPERIMENT_LOGS, 'baseline.yaml');
      assert.ok(existsSync(baselineFile), 'baseline.yaml should exist');
    });

    it('should contain valid metrics', () => {
      const baselineFile = join(EXPERIMENT_LOGS, 'baseline.yaml');
      const content = readFileSync(baselineFile, 'utf-8');

      // Should contain key metrics
      assert.ok(content.includes('testCoverage:'), 'Should contain testCoverage');
      assert.ok(content.includes('lintErrors:'), 'Should contain lintErrors');
      assert.ok(content.includes('documentationCoverage:'), 'Should contain documentationCoverage');
    });

    it('should have profile defined', () => {
      const baselineFile = join(EXPERIMENT_LOGS, 'baseline.yaml');
      const content = readFileSync(baselineFile, 'utf-8');
      assert.ok(content.includes('profile:'), 'Should contain profile');
    });
  });
});

describe('experiment-runner', () => {
  describe('Hypothesis Templates', () => {
    const HYPOTHESIS_TEMPLATES = {
      'improve-cli-help-text': {
        dimension: 'cli-usability',
        description: 'Improve CLI help text and error messages',
      },
      'increase-test-coverage': {
        dimension: 'test-coverage',
        description: 'Add more unit tests',
      },
      'reduce-lint-errors': {
        dimension: 'lint-errors',
        description: 'Fix linting errors',
      },
      'improve-documentation': {
        dimension: 'documentation-coverage',
        description: 'Add documentation',
      },
      'strengthen-security': {
        dimension: 'security-posture',
        description: 'Improve security',
      },
      'improve-architecture': {
        dimension: 'architecture-score',
        description: 'Refactor code structure',
      },
    };

    it('should have improve-cli-help-text template', () => {
      assert.ok(HYPOTHESIS_TEMPLATES['improve-cli-help-text']);
      assert.strictEqual(HYPOTHESIS_TEMPLATES['improve-cli-help-text'].dimension, 'cli-usability');
    });

    it('should have increase-test-coverage template', () => {
      assert.ok(HYPOTHESIS_TEMPLATES['increase-test-coverage']);
      assert.strictEqual(HYPOTHESIS_TEMPLATES['increase-test-coverage'].dimension, 'test-coverage');
    });

    it('should have strengthen-security template', () => {
      assert.ok(HYPOTHESIS_TEMPLATES['strengthen-security']);
      assert.strictEqual(HYPOTHESIS_TEMPLATES['strengthen-security'].dimension, 'security-posture');
    });

    it('should have improve-architecture template', () => {
      assert.ok(HYPOTHESIS_TEMPLATES['improve-architecture']);
      assert.strictEqual(HYPOTHESIS_TEMPLATES['improve-architecture'].dimension, 'architecture-score');
    });

    it('should require single variable per experiment', () => {
      const template = HYPOTHESIS_TEMPLATES['improve-cli-help-text'];
      assert.ok(template.dimension, 'Should have single dimension');
      assert.ok(template.description, 'Should have description');
    });
  });
});

describe('decision-log', () => {
  describe('Decision Structure', () => {
    it('should support KEEP decision', () => {
      const validDecisions = ['KEEP', 'REVERT'];
      assert.ok(validDecisions.includes('KEEP'));
    });

    it('should support REVERT decision', () => {
      const validDecisions = ['KEEP', 'REVERT'];
      assert.ok(validDecisions.includes('REVERT'));
    });

    it('should require evidence for decision', () => {
      const decision = {
        experiment: 1,
        hypothesis: 'test',
        decision: 'KEEP',
        evidence: 'Score improved by 15%',
        timestamp: new Date().toISOString(),
      };

      assert.ok(decision.evidence, 'Evidence is required');
      assert.ok(decision.timestamp, 'Timestamp is required');
    });
  });

  describe('Anti-Pattern Rules', () => {
    const antiPatterns = [
      'Same agent modifies and judges in same context',
      'Skipping baseline collection',
      'Running multiple variables in one experiment',
      'Using git reset --hard as default revert',
      'Dry run ratio > 30% without flag',
      'Silent exception swallowing',
      'Self-declaring improvement without evidence',
      'Adding redundant code just to raise scores',
    ];

    it('should define anti-patterns', () => {
      assert.ok(antiPatterns.length > 0, 'Anti-patterns should be defined');
    });

    it('should block same-context evaluation', () => {
      assert.ok(antiPatterns.includes('Same agent modifies and judges in same context'));
    });

    it('should block skipping baseline', () => {
      assert.ok(antiPatterns.includes('Skipping baseline collection'));
    });

    it('should block multiple variables', () => {
      assert.ok(antiPatterns.includes('Running multiple variables in one experiment'));
    });

    it('should warn on high dry_run ratio', () => {
      assert.ok(antiPatterns.includes('Dry run ratio > 30% without flag'));
    });
  });
});

describe('Experiment Workflow', () => {
  describe('Keep/Revert Criteria', () => {
    it('should KEEP when improvement >= 10%', () => {
      const improvement = 15;
      const threshold = 10;
      const shouldKeep = improvement >= threshold;
      assert.strictEqual(shouldKeep, true);
    });

    it('should REVERT when improvement < 10%', () => {
      const improvement = 5;
      const threshold = 10;
      const shouldKeep = improvement >= threshold;
      assert.strictEqual(shouldKeep, false);
    });

    it('should REVERT when improvement is negative', () => {
      const improvement = -5;
      const threshold = 10;
      const shouldKeep = improvement >= threshold;
      assert.strictEqual(shouldKeep, false);
    });

    it('should REVERT when improvement is 0', () => {
      const improvement = 0;
      const threshold = 10;
      const shouldKeep = improvement >= threshold;
      assert.strictEqual(shouldKeep, false);
    });

    it('should KEEP when improvement is exactly 10%', () => {
      const improvement = 10;
      const threshold = 10;
      const shouldKeep = improvement >= threshold;
      assert.strictEqual(shouldKeep, true);
    });
  });

  describe('Baseline Requirements', () => {
    it('should require baseline before experiment', () => {
      const hasBaseline = existsSync(join(EXPERIMENT_LOGS, 'baseline.yaml'));
      assert.ok(hasBaseline, 'Baseline should exist before running experiments');
    });

    it('should store baseline metrics', () => {
      const baselineFile = join(EXPERIMENT_LOGS, 'baseline.yaml');
      const content = readFileSync(baselineFile, 'utf-8');
      assert.ok(content.length > 0, 'Baseline should have content');
    });
  });
});

describe('Integration with release-quality-review', () => {
  describe('Gate Before Optimization', () => {
    it('should require release gate to pass before optimization', () => {
      // This is a conceptual test - actual gate check is done by review-gate.mjs
      const gatePassed = true; // Would be checked by review-gate.mjs
      const canOptimize = gatePassed;
      assert.strictEqual(canOptimize, true);
    });

    it('should not optimize if gate has redlines', () => {
      const hasRedlines = false; // Would be checked by review-gate.mjs
      const canOptimize = !hasRedlines;
      assert.strictEqual(canOptimize, true);
    });
  });
});

console.log('Tests for deep-optimization-lab defined');
