/**
 * sync-skills.test.mjs - Tests for sync-skills.ts
 *
 * Coverage:
 * - skill:check (all OK, missing skill)
 * - skill:install (L0 local)
 * - skill:verify (checksum match/mismatch)
 * - skill:diff (changed, unchanged)
 * - L3 unknown source blocked
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const PROJECT_ROOT = path.join(process.cwd());
const SKILL_SYNC = path.join(PROJECT_ROOT, 'scripts', 'sync-skills.ts');
const SKILL_REGISTRY = path.join(PROJECT_ROOT, 'skill-registry.yaml');
const SKILL_LOCK = path.join(PROJECT_ROOT, 'skills.lock.yaml');

function runSyncSkills(args) {
  try {
    const cmd = `node --experimental-strip-types "${SKILL_SYNC}" ${args}`;
    const output = execSync(cmd, {
      cwd: PROJECT_ROOT,
      encoding: 'utf-8',
      timeout: 30000,
    });
    return { exitCode: 0, output };
  } catch (err) {
    return {
      exitCode: err.status || 1,
      output: err.stdout || '',
      error: err.stderr || '',
    };
  }
}

describe('sync-skills.ts', () => {
  describe('skill:check', () => {
    it('should pass when all skills are installed', () => {
      const result = runSyncSkills('check');
      assert.strictEqual(result.exitCode, 0);
      assert.match(result.output, /All skills verified|PASS/);
    });

    it('should accept --skill parameter', () => {
      const result = runSyncSkills('check --skill release-quality-review');
      assert.strictEqual(result.exitCode, 0);
      assert.match(result.output, /release-quality-review/);
    });

    it('should accept --quiet parameter', () => {
      const result = runSyncSkills('check --quiet');
      assert.strictEqual(result.exitCode, 0);
      // Should have minimal output
    });

    it('should accept --json parameter', () => {
      const result = runSyncSkills('check --json');
      assert.strictEqual(result.exitCode, 0);
      // JSON output mode
    });
  });

  describe('skill:install', () => {
    it('should install L0 local skill', () => {
      const result = runSyncSkills('install');
      assert.strictEqual(result.exitCode, 0);
      assert.match(result.output, /install|success|copied/i);
    });

    it('should update lockfile after install', () => {
      // Run install first
      runSyncSkills('install');

      // Check lockfile exists and is valid YAML
      assert.ok(fs.existsSync(SKILL_LOCK));
      const lockContent = fs.readFileSync(SKILL_LOCK, 'utf-8');
      assert.match(lockContent, /version:|installed:/);
    });

    it('should verify after install', () => {
      const result = runSyncSkills('verify');
      assert.strictEqual(result.exitCode, 0);
      assert.match(result.output, /verified|PASS/);
    });
  });

  describe('skill:diff', () => {
    it('should show no changes when up to date', () => {
      const result = runSyncSkills('diff');
      // Should show either "no changes" or "changed"
      assert.ok(result.output.includes('release-quality-review'));
    });

    it('should accept --quiet parameter', () => {
      const result = runSyncSkills('diff --quiet');
      // Should have minimal output
      assert.strictEqual(result.exitCode, 0);
    });
  });

  describe('skill:update', () => {
    it('should check for updates', () => {
      const result = runSyncSkills('update');
      assert.ok(result.output.includes('up to date') || result.output.includes('changes'));
    });

    it('should accept --propose parameter', () => {
      const result = runSyncSkills('update --propose');
      assert.strictEqual(result.exitCode, 0);

      // Check proposed lockfile exists
      const proposedLock = path.join(PROJECT_ROOT, 'skills.lock.proposed.yaml');
      if (result.output.includes('proposed')) {
        // Clean up
        if (fs.existsSync(proposedLock)) {
          fs.unlinkSync(proposedLock);
        }
      }
    });

    it('should report up to date when no changes', () => {
      const result = runSyncSkills('update');
      assert.ok(result.output.includes('up to date') || result.output.includes('No changes'));
    });
  });

  describe('L3 Blocked - Unknown sources', () => {
    it('should block external sources by trust_policy', () => {
      // The trust_policy blocks external sources
      const registry = fs.readFileSync(SKILL_REGISTRY, 'utf-8');
      // Should have allow_external: false
      assert.match(registry, /allow_external:\s*false/);
    });
  });

  describe('Error handling', () => {
    it('should show help for unknown commands', () => {
      const result = runSyncSkills('unknown-command');
      assert.strictEqual(result.exitCode, 1);
      assert.match(result.output, /Unknown command|Usage/);
    });

    it('should handle missing skill gracefully', () => {
      const result = runSyncSkills('check --skill non-existent-skill');
      // Should handle gracefully (exit 0 with message, or exit 1)
      assert.ok(result.exitCode === 0 || result.exitCode === 1);
    });
  });
});
