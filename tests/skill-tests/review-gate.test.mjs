/**
 * review-gate.test.mjs - Tests for review-gate.mjs
 *
 * Coverage:
 * - Pass scenarios
 * - Fail scenarios (score < 90, redlines, blockers)
 * - Missing reviewer result.yaml
 * - Invalid YAML
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const PROJECT_ROOT = path.join(process.cwd());
const GATE_SCRIPT = path.join(PROJECT_ROOT, 'skills', 'release-quality-review', 'scripts', 'review-gate.mjs');
const QUALITY_REPORTS_DIR = path.join(PROJECT_ROOT, 'quality-reports');

function runGate(roundName, profile = 'default') {
  try {
    const output = execSync(`node "${GATE_SCRIPT}" --round ${roundName} --profile ${profile}`, {
      cwd: PROJECT_ROOT,
      encoding: 'utf-8',
      timeout: 30000,
    });
    return { exitCode: 0, output };
  } catch (err) {
    return { exitCode: err.status || 1, output: err.stdout || '', error: err.stderr || '' };
  }
}

function createRound(roundName, reviewers = ['product-flow', 'destructive-qa', 'terminal-veteran']) {
  const roundDir = path.join(QUALITY_REPORTS_DIR, roundName);
  fs.mkdirSync(path.join(roundDir, 'evidence'), { recursive: true });
  fs.writeFileSync(path.join(roundDir, 'evidence', 'manifest.yaml'),
    `round: ${roundName}\nprofile: default\nreviewers: []\nevidence: []`);

  for (const reviewer of reviewers) {
    fs.mkdirSync(path.join(roundDir, reviewer), { recursive: true });
  }
  return roundDir;
}

function createResult(roundName, reviewer, score, blockers = [], redlines = []) {
  const result = {
    reviewer,
    score,
    dimension_scores: { test: 90 },
    blockers,
    redlines,
    recommendation: score >= 90 && blockers.length === 0 ? 'pass' : 'fail',
  };
  const resultPath = path.join(QUALITY_REPORTS_DIR, roundName, reviewer, 'result.yaml');
  fs.writeFileSync(resultPath, `reviewer: ${reviewer}\nscore: ${score}\nblockers: ${JSON.stringify(blockers)}\nredlines: ${JSON.stringify(redlines)}\nrecommendation: ${result.recommendation}`);
  return resultPath;
}

describe('review-gate.mjs', () => {
  // Clean up after tests
  after(() => {
    const testRounds = ['test-pass', 'test-fail-score', 'test-fail-redline', 'test-fail-blocker', 'test-missing-reviewer'];
    for (const round of testRounds) {
      const roundDir = path.join(QUALITY_REPORTS_DIR, round);
      if (fs.existsSync(roundDir)) {
        fs.rmSync(roundDir, { recursive: true, force: true });
      }
    }
  });

  describe('PASS scenarios', () => {
    it('should pass when all reviewers score >= 90 with no blockers', () => {
      createRound('test-pass');
      createResult('test-pass', 'product-flow', 95);
      createResult('test-pass', 'destructive-qa', 92);
      createResult('test-pass', 'terminal-veteran', 90);

      const result = runGate('test-pass');
      assert.strictEqual(result.exitCode, 0, 'Gate should pass');
      assert.match(result.output, /PASSED|All gates cleared/);
    });

    it('should pass with edge case: minimum score exactly 90', () => {
      createRound('test-pass-edge');
      createResult('test-pass-edge', 'product-flow', 90);
      createResult('test-pass-edge', 'destructive-qa', 90);
      createResult('test-pass-edge', 'terminal-veteran', 90);

      const result = runGate('test-pass-edge');
      assert.strictEqual(result.exitCode, 0, 'Gate should pass at exactly 90');

      // Cleanup
      fs.rmSync(path.join(QUALITY_REPORTS_DIR, 'test-pass-edge'), { recursive: true, force: true });
    });
  });

  describe('FAIL scenarios - Score below threshold', () => {
    it('should fail when any reviewer scores below 90', () => {
      createRound('test-fail-score');
      createResult('test-fail-score', 'product-flow', 89);
      createResult('test-fail-score', 'destructive-qa', 95);
      createResult('test-fail-score', 'terminal-veteran', 92);

      const result = runGate('test-fail-score');
      assert.strictEqual(result.exitCode, 1, 'Gate should fail');
      assert.match(result.output, /FAILED|Minimum score.*<.*90/);
    });

    it('should fail when multiple reviewers score below 90', () => {
      createRound('test-fail-multiple');
      createResult('test-fail-multiple', 'product-flow', 85);
      createResult('test-fail-multiple', 'destructive-qa', 82);
      createResult('test-fail-multiple', 'terminal-veteran', 88);

      const result = runGate('test-fail-multiple');
      assert.strictEqual(result.exitCode, 1, 'Gate should fail');
      assert.match(result.output, /Minimum Score: 82/i);

      fs.rmSync(path.join(QUALITY_REPORTS_DIR, 'test-fail-multiple'), { recursive: true, force: true });
    });
  });

  describe('FAIL scenarios - Redlines', () => {
    it('should fail when reviewer has redlines', () => {
      createRound('test-fail-redline');
      createResult('test-fail-redline', 'product-flow', 95);
      createResult('test-fail-redline', 'destructive-qa', 92);
      // terminal-veteran has redline
      fs.writeFileSync(
        path.join(QUALITY_REPORTS_DIR, 'test-fail-redline', 'terminal-veteran', 'result.yaml'),
        'reviewer: terminal-veteran\nscore: 95\nblockers: []\nredlines:\n  - id: RL-001\n    severity: P0\n    description: Critical security issue\nrecommendation: fail'
      );

      const result = runGate('test-fail-redline');
      assert.strictEqual(result.exitCode, 1, 'Gate should fail');
      assert.match(result.output, /Redlines.*FOUND/);
    });
  });

  describe('FAIL scenarios - Blockers', () => {
    it('should fail when reviewer has P0 blocker', () => {
      createRound('test-fail-blocker');
      createResult('test-fail-blocker', 'product-flow', 95);
      createResult('test-fail-blocker', 'destructive-qa', 92);
      fs.writeFileSync(
        path.join(QUALITY_REPORTS_DIR, 'test-fail-blocker', 'terminal-veteran', 'result.yaml'),
        'reviewer: terminal-veteran\nscore: 95\nblockers:\n  - id: BLK-001\n    severity: P0\n    description: Critical issue\nredlines: []\nrecommendation: fail'
      );

      const result = runGate('test-fail-blocker');
      assert.strictEqual(result.exitCode, 1, 'Gate should fail');
      assert.match(result.output, /P0.*Blockers.*FOUND/);
    });

    it('should fail when reviewer has P1 blocker', () => {
      createRound('test-fail-p1-blocker');
      createResult('test-fail-p1-blocker', 'product-flow', 95);
      createResult('test-fail-p1-blocker', 'destructive-qa', 92);
      fs.writeFileSync(
        path.join(QUALITY_REPORTS_DIR, 'test-fail-p1-blocker', 'terminal-veteran', 'result.yaml'),
        'reviewer: terminal-veteran\nscore: 95\nblockers:\n  - id: BLK-001\n    severity: P1\n    description: Important issue\nredlines: []\nrecommendation: fail'
      );

      const result = runGate('test-fail-p1-blocker');
      assert.strictEqual(result.exitCode, 1, 'Gate should fail with P1 blocker');

      fs.rmSync(path.join(QUALITY_REPORTS_DIR, 'test-fail-p1-blocker'), { recursive: true, force: true });
    });
  });

  describe('FAIL scenarios - Missing reviewer', () => {
    it('should fail when required reviewer result.yaml is missing', () => {
      createRound('test-missing-reviewer');
      createResult('test-missing-reviewer', 'product-flow', 95);
      createResult('test-missing-reviewer', 'terminal-veteran', 92);
      // Note: destructive-qa result.yaml is NOT created

      const result = runGate('test-missing-reviewer');
      assert.strictEqual(result.exitCode, 1, 'Gate should fail');
      assert.match(result.output, /Missing result\.yaml|Missing.*destructive-qa/i);

      // Cleanup
      fs.rmSync(path.join(QUALITY_REPORTS_DIR, 'test-missing-reviewer'), { recursive: true, force: true });
    });
  });

  describe('Error handling', () => {
    it('should fail for non-existent round', () => {
      const result = runGate('non-existent-round');
      // Gate should exit with non-zero for errors
      assert.ok(result.exitCode !== 0, 'Should exit with non-zero for non-existent round');
    });
  });
});
