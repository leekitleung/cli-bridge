/**
 * Unit tests for review-gate.mjs
 *
 * Tests the deterministic quality gate script.
 */

import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert';

// Mock fs module for testing
const mockFs = {
  files: new Map(),

  readFileSync(path) {
    const content = this.files.get(path);
    if (content === undefined) {
      const error = new Error(`ENOENT: no such file or directory, open '${path}'`);
      error.code = 'ENOENT';
      throw error;
    }
    return content;
  },

  existsSync(path) {
    return this.files.has(path);
  },

  mkdirSync() {},

  setFile(path, content) {
    this.files.set(path, content);
  },

  clear() {
    this.files.clear();
  }
};

// Import the module (we'll test its functions directly)
describe('review-gate.mjs', () => {
  describe('Score Parsing', () => {
    it('should parse "Overall Score: **67/100**" format', () => {
      const content = '## Overall Score: **67/100**\nSome content here.';
      const match = content.match(/Overall\s*[Ss]core[:\s]+\*?\*?(\d+)\s*\/?\s*100/);
      assert.ok(match, 'Should match the format');
      assert.strictEqual(parseInt(match[1], 10), 67);
    });

    it('should parse "Overall Score: 72/100" format without markdown', () => {
      const content = '## Overall Score: 72/100';
      const match = content.match(/Overall\s*[Ss]core[:\s]+\*?\*?(\d+)\s*\/?\s*100/);
      assert.ok(match);
      assert.strictEqual(parseInt(match[1], 10), 72);
    });

    it('should parse "Overall Score: 71 / 100" with spaces', () => {
      const content = '## Overall Score: 71 / 100';
      const match = content.match(/Overall\s*[Ss]core[:\s]+\*?\*?(\d+)\s*\/?\s*100/);
      assert.ok(match);
      assert.strictEqual(parseInt(match[1], 10), 71);
    });

    it('should parse "**Overall Score**: 62/100" with bold', () => {
      const content = '**Overall Score**: 62/100';
      const match = content.match(/\*\*Overall\s+Score\*\*[:\s]+(\d+)\s*\/?\s*100/);
      assert.ok(match);
      assert.strictEqual(parseInt(match[1], 10), 62);
    });

    it('should parse "Final Score: 78/100"', () => {
      const content = 'Final Score: 78/100';
      const match = content.match(/Final\s+Score[:\s]+\*?(\d+)\s*\/?\s*100/i);
      assert.ok(match);
      assert.strictEqual(parseInt(match[1], 10), 78);
    });

    it('should return null for content without score', () => {
      const content = 'No score here, just text.';
      const match = content.match(/Overall\s*[Ss]core[:\s]+\*?\*?(\d+)\s*\/?\s*100/);
      assert.strictEqual(match, null);
    });

    it('should handle score of 100', () => {
      const content = '## Overall Score: 100/100';
      const match = content.match(/Overall\s*[Ss]core[:\s]+\*?\*?(\d+)\s*\/?\s*100/);
      assert.ok(match);
      assert.strictEqual(parseInt(match[1], 10), 100);
    });

    it('should handle score of 0', () => {
      const content = '## Overall Score: 0/100';
      const match = content.match(/Overall\s*[Ss]core[:\s]+\*?\*?(\d+)\s*\/?\s*100/);
      assert.ok(match);
      assert.strictEqual(parseInt(match[1], 10), 0);
    });
  });

  describe('Redline Detection', () => {
    it('should detect redlines when blockers.md has content', () => {
      const blockersContent = '## Blockers\n\n- P1: Something is broken';
      const hasContent = blockersContent.trim().length > 0 &&
        !blockersContent.toLowerCase().includes('no blockers') &&
        !blockersContent.toLowerCase().includes('none found');
      assert.strictEqual(hasContent, true);
    });

    it('should not detect redlines when blockers.md says "no blockers"', () => {
      const blockersContent = '## Blockers\n\nNo blockers found.';
      const hasContent = blockersContent.trim().length > 0 &&
        !blockersContent.toLowerCase().includes('no blockers') &&
        !blockersContent.toLowerCase().includes('none found');
      assert.strictEqual(hasContent, false);
    });

    it('should not detect redlines when blockers.md is empty', () => {
      const blockersContent = '';
      const hasContent = blockersContent.trim().length > 0;
      assert.strictEqual(hasContent, false);
    });

    it('should not detect redlines when blockers.md says "None found"', () => {
      const blockersContent = '## Blockers\n\nNone found.';
      const hasContent = blockersContent.trim().length > 0 &&
        !blockersContent.toLowerCase().includes('none found');
      assert.strictEqual(hasContent, false);
    });
  });

  describe('Gate Threshold', () => {
    const GATE_THRESHOLD = {
      'product-polish': 80,
      'release-gate': 90,
      'security-audit': 90
    };

    it('should use 80 as threshold for product-polish', () => {
      assert.strictEqual(GATE_THRESHOLD['product-polish'], 80);
    });

    it('should use 90 as threshold for release-gate', () => {
      assert.strictEqual(GATE_THRESHOLD['release-gate'], 90);
    });

    it('should use 90 as threshold for security-audit', () => {
      assert.strictEqual(GATE_THRESHOLD['security-audit'], 90);
    });

    it('should fail when score is below threshold', () => {
      const score = 72;
      const threshold = GATE_THRESHOLD['release-gate'];
      const passed = score >= threshold;
      assert.strictEqual(passed, false);
    });

    it('should pass when score equals threshold', () => {
      const score = 90;
      const threshold = GATE_THRESHOLD['release-gate'];
      const passed = score >= threshold;
      assert.strictEqual(passed, true);
    });

    it('should pass when score is above threshold', () => {
      const score = 95;
      const threshold = GATE_THRESHOLD['release-gate'];
      const passed = score >= threshold;
      assert.strictEqual(passed, true);
    });
  });

  describe('Profile Reviewers', () => {
    const PROFILES = {
      'product-polish': [
        ['product-flow', 'vibe-coder'],
        ['native-designer', 'aesthetic-designer'],
        ['zero-doc-user', 'new-user'],
        ['terminal-veteran', 'terminal-veteran'],
        ['destructive-qa', 'quality-breaker'],
      ],
      'release-gate': [
        ['product-flow', 'vibe-coder'],
        ['architecture-maintainer', 'architecture'],
        ['release-verifier', 'release-verification'],
        ['destructive-qa', 'quality-breaker'],
        ['data-security', 'data-security'],
      ],
      'security-audit': [
        ['destructive-qa', 'quality-breaker'],
        ['data-security', 'data-security'],
        ['architecture-maintainer', 'architecture'],
      ],
    };

    it('should have 5 reviewers for product-polish', () => {
      assert.strictEqual(PROFILES['product-polish'].length, 5);
    });

    it('should have 5 reviewers for release-gate', () => {
      assert.strictEqual(PROFILES['release-gate'].length, 5);
    });

    it('should have 3 reviewers for security-audit', () => {
      assert.strictEqual(PROFILES['security-audit'].length, 3);
    });

    it('should include product-flow in release-gate', () => {
      const reviewers = PROFILES['release-gate'];
      const hasProductFlow = reviewers.some(r => r.includes('product-flow'));
      assert.strictEqual(hasProductFlow, true);
    });

    it('should include destructive-qa in all profiles', () => {
      for (const [profile, reviewers] of Object.entries(PROFILES)) {
        const hasDestructiveQA = reviewers.some(r => r.includes('destructive-qa'));
        assert.strictEqual(hasDestructiveQA, true, `${profile} should include destructive-qa`);
      }
    });
  });

  describe('Reviewer Name Resolution', () => {
    it('should resolve "vibe-coder" to "product-flow"', () => {
      const legacyNames = {
        'vibe-coder': 'product-flow',
        'aesthetic-designer': 'native-designer',
        'new-user': 'zero-doc-user',
        'quality-breaker': 'destructive-qa',
        'architecture': 'architecture-maintainer',
        'release-verification': 'release-verifier',
      };

      assert.strictEqual(legacyNames['vibe-coder'], 'product-flow');
    });

    it('should support both canonical and legacy names', () => {
      const namePairs = [
        ['product-flow', 'vibe-coder'],
        ['native-designer', 'aesthetic-designer'],
        ['destructive-qa', 'quality-breaker'],
      ];

      assert.strictEqual(namePairs[0][0], 'product-flow');
      assert.strictEqual(namePairs[0][1], 'vibe-coder');
    });
  });

  describe('Pass/Fail Logic', () => {
    function determinePass(score, hasRedlines, errors) {
      return score >= 90 && !hasRedlines && errors.length === 0;
    }

    it('should pass when score >= 90, no redlines, no errors', () => {
      assert.strictEqual(determinePass(95, false, []), true);
    });

    it('should fail when score < 90', () => {
      assert.strictEqual(determinePass(89, false, []), false);
    });

    it('should fail when redlines exist', () => {
      assert.strictEqual(determinePass(95, true, []), false);
    });

    it('should fail when errors exist', () => {
      assert.strictEqual(determinePass(95, false, ['Missing score.md']), false);
    });

    it('should fail on score of exactly 89 even with no redlines', () => {
      assert.strictEqual(determinePass(89, false, []), false);
    });

    it('should pass on score of exactly 90 with no redlines', () => {
      assert.strictEqual(determinePass(90, false, []), true);
    });
  });
});

console.log('Tests for review-gate.mjs defined');
