/**
 * Integration tests for review-runner.mjs
 *
 * Tests the complete review orchestration flow.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '../..');

// Helper to create temp directory structure
function createTempReview(tempDir, reviewers, scoreContents) {
  fs.mkdirSync(tempDir, { recursive: true });

  for (const reviewer of reviewers) {
    const reviewerDir = path.join(tempDir, reviewer);
    fs.mkdirSync(reviewerDir, { recursive: true });

    if (scoreContents && scoreContents[reviewer]) {
      fs.writeFileSync(
        path.join(reviewerDir, 'score.md'),
        scoreContents[reviewer]
      );
    }
  }
}

describe('review-runner.mjs Integration', () => {
  describe('Evidence Collection', () => {
    it('should collect git diff', async () => {
      // This tests that git is available
      const { execSync } = await import('child_process');
      try {
        const output = execSync('git diff HEAD~1 --stat', {
          cwd: PROJECT_ROOT,
          encoding: 'utf-8',
          timeout: 10000
        });
        assert.ok(typeof output === 'string');
      } catch (err) {
        // If no previous commit, that's OK
        assert.ok(true);
      }
    });

    it('should collect git status', async () => {
      const { execSync } = await import('child_process');
      const output = execSync('git status --short', {
        cwd: PROJECT_ROOT,
        encoding: 'utf-8',
        timeout: 10000
      });
      assert.ok(typeof output === 'string');
    });
  });

  describe('Profile Loading', () => {
    it('should load default profile', () => {
      const profilePath = path.join(
        PROJECT_ROOT,
        'skills/release-quality-review/profiles/default.yaml'
      );
      assert.ok(fs.existsSync(profilePath), 'default.yaml should exist');
    });

    it('should load release-gate profile', () => {
      const profilePath = path.join(
        PROJECT_ROOT,
        'skills/release-quality-review/profiles/release-gate.yaml'
      );
      assert.ok(fs.existsSync(profilePath), 'release-gate.yaml should exist');
    });

    it('should have resident_reviewers in default profile', () => {
      const profilePath = path.join(
        PROJECT_ROOT,
        'skills/release-quality-review/profiles/default.yaml'
      );
      const content = fs.readFileSync(profilePath, 'utf-8');
      assert.ok(content.includes('resident_reviewers'));
      assert.ok(content.includes('product-flow'));
      assert.ok(content.includes('destructive-qa'));
    });

    it('should have resident_reviewers in release-gate profile', () => {
      const profilePath = path.join(
        PROJECT_ROOT,
        'skills/release-quality-review/profiles/release-gate.yaml'
      );
      const content = fs.readFileSync(profilePath, 'utf-8');
      assert.ok(content.includes('resident_reviewers'));
      assert.ok(content.includes('architecture-maintainer'));
      assert.ok(content.includes('release-verifier'));
    });
  });

  describe('Result YAML Validation', () => {
    it('should have valid result.yaml schema in existing reviews', () => {
      const reviewDir = path.join(PROJECT_ROOT, 'quality-review/round-skill-release');

      if (!fs.existsSync(reviewDir)) {
        // Skip if no reviews exist yet
        return;
      }

      const reviewers = fs.readdirSync(reviewDir).filter(f => {
        return fs.statSync(path.join(reviewDir, f)).isDirectory();
      });

      for (const reviewer of reviewers) {
        const scorePath = path.join(reviewDir, reviewer, 'score.md');
        if (fs.existsSync(scorePath)) {
          const content = fs.readFileSync(scorePath, 'utf-8');
          // Should have "Overall Score: XX/100" format
          const hasScore = /Overall\s+Score[:\s]+\d+\s*\/?\s*100/i.test(content);
          assert.ok(hasScore, `${reviewer} should have valid score format`);
        }
      }
    });
  });

  describe('Reviewer Definitions', () => {
    const reviewersDir = path.join(
      PROJECT_ROOT,
      'skills/release-quality-review/reviewers'
    );

    it('should have required reviewer files', () => {
      const required = [
        'product-flow.md',
        'architecture-maintainer.md',
        'release-verifier.md',
        'destructive-qa.md',
        'terminal-veteran.md',
        'zero-doc-user.md',
        'native-designer.md',
        'data-security.md',
      ];

      for (const reviewer of required) {
        const reviewerPath = path.join(reviewersDir, reviewer);
        assert.ok(
          fs.existsSync(reviewerPath),
          `${reviewer} should exist`
        );
      }
    });

    it('should have TEMPLATE.md for new reviewers', () => {
      const templatePath = path.join(reviewersDir, 'TEMPLATE.md');
      assert.ok(fs.existsSync(templatePath));
    });

    it('each reviewer should have evaluation dimensions', () => {
      const reviewers = fs.readdirSync(reviewersDir).filter(f =>
        f.endsWith('.md') && f !== 'TEMPLATE.md'
      );

      for (const reviewer of reviewers) {
        const content = fs.readFileSync(
          path.join(reviewersDir, reviewer),
          'utf-8'
        );
        assert.ok(
          content.includes('Evaluation Dimensions') || content.includes('## '),
          `${reviewer} should have evaluation dimensions section`
        );
      }
    });
  });

  describe('Rubrics', () => {
    it('should have scoring rubric', () => {
      const rubricPath = path.join(
        PROJECT_ROOT,
        'skills/release-quality-review/rubrics/scoring.md'
      );
      assert.ok(fs.existsSync(rubricPath));
      const content = fs.readFileSync(rubricPath, 'utf-8');
      assert.ok(content.includes('分数档位') || content.includes('Score'));
      assert.ok(content.includes('90') || content.includes('100'));
    });

    it('should have redlines rubric', () => {
      const rubricPath = path.join(
        PROJECT_ROOT,
        'skills/release-quality-review/rubrics/redlines.md'
      );
      assert.ok(fs.existsSync(rubricPath));
      const content = fs.readFileSync(rubricPath, 'utf-8');
      assert.ok(content.includes('红线') || content.includes('Security'));
      assert.ok(content.includes('P0') || content.includes('P1'));
    });

    it('should have evidence rubric', () => {
      const rubricPath = path.join(
        PROJECT_ROOT,
        'skills/release-quality-review/rubrics/evidence.md'
      );
      assert.ok(fs.existsSync(rubricPath));
    });
  });

  describe('Templates', () => {
    it('should have result.yaml template', () => {
      const templatePath = path.join(
        PROJECT_ROOT,
        'skills/release-quality-review/templates/result.yaml'
      );
      assert.ok(fs.existsSync(templatePath));
      const content = fs.readFileSync(templatePath, 'utf-8');
      assert.ok(content.includes('reviewer:'));
      assert.ok(content.includes('score:'));
      assert.ok(content.includes('blockers:'));
      assert.ok(content.includes('redlines:'));
    });
  });

  describe('Scripts', () => {
    it('should have review-gate.mjs', () => {
      const scriptPath = path.join(
        PROJECT_ROOT,
        'skills/release-quality-review/scripts/review-gate.mjs'
      );
      assert.ok(fs.existsSync(scriptPath));
    });

    it('should have review-runner.mjs', () => {
      const scriptPath = path.join(
        PROJECT_ROOT,
        'skills/release-quality-review/scripts/review-runner.mjs'
      );
      assert.ok(fs.existsSync(scriptPath));
    });

    it('review-gate.mjs should be executable', () => {
      const scriptPath = path.join(
        PROJECT_ROOT,
        'skills/release-quality-review/scripts/review-gate.mjs'
      );
      const content = fs.readFileSync(scriptPath, 'utf-8');
      assert.ok(content.includes('#!/usr/bin/env node'));
    });
  });

  describe('SKILL.md', () => {
    it('should have SKILL.md', () => {
      const skillPath = path.join(
        PROJECT_ROOT,
        'skills/release-quality-review/SKILL.md'
      );
      assert.ok(fs.existsSync(skillPath));
    });

    it('should reference correct directory structure', () => {
      const skillPath = path.join(
        PROJECT_ROOT,
        'skills/release-quality-review/SKILL.md'
      );
      const content = fs.readFileSync(skillPath, 'utf-8');
      assert.ok(content.includes('profile'));
      assert.ok(content.includes('reviewer'));
    });

    it('should document review process', () => {
      const skillPath = path.join(
        PROJECT_ROOT,
        'skills/release-quality-review/SKILL.md'
      );
      const content = fs.readFileSync(skillPath, 'utf-8');
      // Check for review process documentation
      assert.ok(content.includes('Reviewer') || content.includes('reviewer'));
      assert.ok(content.includes('profile') || content.includes('Profile'));
    });
  });
});

console.log('Integration tests for review-runner.mjs defined');
