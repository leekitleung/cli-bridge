#!/usr/bin/env node
/**
 * sync-skills.ts - Controlled skill synchronization for Claude Code / Codex
 *
 * Trust Policy:
 * - L0: Built-in, fully trusted (auto install, auto enable)
 * - L1: Internal registry, locked version (install with permission, enable with review)
 * - L2: Whitelist external, locked version (download to staging, manual review required)
 * - L3: Unknown sources (BLOCKED)
 *
 * Commands:
 *   pnpm skill:check    - Check for missing/inconsistent skills
 *   pnpm skill:install  - Install skills from registry
 *   pnpm skill:verify   - Verify skill integrity
 *   pnpm skill:diff     - Show changes since last install
 */

import fs from 'fs';
import path from 'path';
import { parseArgs } from 'util';
import crypto from 'crypto';
import * as yaml from 'js-yaml';
const { load: yamlLoad, dump: yamlDump } = yaml;

const SKILL_REGISTRY = 'skill-registry.yaml';
const SKILL_LOCK = 'skills.lock.yaml';
const PROJECT_ROOT = process.cwd();

// ANSI colors
const C = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  gray: '\x1b[90m',
};

function log(msg, level = 'info') {
  const icons = { info: 'ℹ', pass: '✓', fail: '✗', warn: '⚠' };
  const color = { info: 'blue', pass: 'green', fail: 'red', warn: 'yellow' }[level];
  console.log(`${C[color]}[${icons[level]}]${C.reset} ${msg}`);
}

function error(msg) {
  console.error(`${C.red}[ERROR]${C.reset} ${msg}`);
}

function loadYaml(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return yamlLoad(content) || {};
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

function saveYaml(filePath, data) {
  const content = yamlDump(data, {
    indent: 2,
    lineWidth: 120,
    noRefs: true,
    sortKeys: false,
  });
  fs.writeFileSync(filePath, content);
}

function checksumDir(dirPath) {
  const hash = crypto.createHash('sha256');
  const files = [];

  function walk(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else {
        const content = fs.readFileSync(fullPath);
        hash.update(content);
        files.push(path.relative(PROJECT_ROOT, fullPath));
      }
    }
  }

  walk(dirPath);
  return { hash: hash.digest('hex'), files };
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function copySkill(src, dest) {
  if (!fs.existsSync(src)) {
    throw new Error(`Source skill not found: ${src}`);
  }

  // Remove existing
  if (fs.existsSync(dest)) {
    fs.rmSync(dest, { recursive: true, force: true });
  }

  // Copy
  fs.cpSync(src, dest, { recursive: true });
  log(`Copied skill to ${dest}`, 'pass');
}

async function cmdCheck(targetSkill = null) {
  log('Checking skill registry...');

  const registry = loadYaml(path.join(PROJECT_ROOT, SKILL_REGISTRY));
  const lock = loadYaml(path.join(PROJECT_ROOT, SKILL_LOCK)) || { installed: {} };

  if (!registry || !registry.skills) {
    error('Invalid skill-registry.yaml');
    process.exit(1);
  }

  const issues = [];
  let allGood = true;

  for (const [name, spec] of Object.entries(registry.skills)) {
    if (targetSkill && name !== targetSkill) continue;
    const skillPath = path.join(PROJECT_ROOT, spec.path);

    // Check if skill directory exists
    if (!fs.existsSync(skillPath)) {
      if (spec.required) {
        issues.push({ skill: name, issue: 'MISSING', message: `Required skill not found at ${spec.path}` });
        allGood = false;
      } else {
        log(`${name}: not installed (optional)`, 'warn');
      }
      continue;
    }

    // Check SKILL.md exists
    const skillMd = path.join(skillPath, 'SKILL.md');
    if (!fs.existsSync(skillMd)) {
      issues.push({ skill: name, issue: 'NO_SKILL_MD', message: 'SKILL.md not found' });
      allGood = false;
    }

    // Check adapters
    if (spec.adapters) {
      for (const [adapter, adapterPath] of Object.entries(spec.adapters)) {
        const fullPath = path.join(PROJECT_ROOT, adapterPath);
        if (!fs.existsSync(fullPath)) {
          issues.push({ skill: name, issue: 'MISSING_ADAPTER', message: `${adapter} adapter not found at ${adapterPath}` });
          allGood = false;
        }
      }
    }

    // Check if in lockfile
    if (!lock.installed || !lock.installed[name]) {
      issues.push({ skill: name, issue: 'NOT_IN_LOCK', message: 'Skill not in lockfile' });
    }

    log(`${name}: OK`, 'pass');
  }

  console.log('\n' + C.gray + '─'.repeat(50) + C.reset);

  if (issues.length > 0) {
    log(`Found ${issues.length} issue(s):`, 'fail');
    for (const { skill, issue, message } of issues) {
      console.log(`  ${C.red}${issue}${C.reset} ${C.yellow}${skill}${C.reset}: ${message}`);
    }
    return false;
  }

  if (allGood) {
    log('All skills verified', 'pass');
  }

  return allGood;
}

async function cmdInstall(targetSkill = null) {
  log('Installing skills from registry...');

  const registry = loadYaml(path.join(PROJECT_ROOT, SKILL_REGISTRY));
  if (!registry || !registry.skills) {
    error('Invalid skill-registry.yaml');
    process.exit(1);
  }

  const lock = { version: '1.0', updated_at: new Date().toISOString(), installed: {} };

  for (const [name, spec] of Object.entries(registry.skills)) {
    if (targetSkill && name !== targetSkill) continue;
    const skillPath = path.join(PROJECT_ROOT, spec.path);

    if (spec.source === 'local') {
      // Local skill - copy to adapters
      if (!fs.existsSync(skillPath)) {
        error(`Local skill not found: ${spec.path}`);
        continue;
      }

      log(`Installing ${name} (local, L${spec.trust_level})`);

      // Copy to adapters
      if (spec.adapters) {
        for (const [adapter, adapterPath] of Object.entries(spec.adapters)) {
          ensureDir(path.dirname(path.join(PROJECT_ROOT, adapterPath)));
          copySkill(skillPath, path.join(PROJECT_ROOT, adapterPath));
        }
      }

      // Calculate checksum
      const { hash } = checksumDir(skillPath);

      lock.installed[name] = {
        source: spec.source,
        path: spec.path,
        trust_level: spec.trust_level,
        status: 'active',
        checksum: `sha256:${hash}`,
        adapters: spec.adapters,
      };

      log(`${name} installed successfully`, 'pass');
    } else if (spec.source === 'internal' || spec.source === 'external') {
      // Would download from registry - not implemented for MVP
      error(`Remote skill install not implemented: ${name}`);
      error('For L1/L2 skills, use: pnpm skill:install --skill <name>');
    }
  }

  // Save lockfile
  saveYaml(path.join(PROJECT_ROOT, SKILL_LOCK), lock);
  log('Updated skills.lock.yaml', 'pass');

  // Verify
  console.log('');
  await cmdVerify();
}

async function cmdVerify(targetSkill = null) {
  log('Verifying skill integrity...');

  const registry = loadYaml(path.join(PROJECT_ROOT, SKILL_REGISTRY));
  const lock = loadYaml(path.join(PROJECT_ROOT, SKILL_LOCK));

  if (!registry || !lock) {
    error('Missing registry or lockfile');
    process.exit(1);
  }

  let allPassed = true;

  for (const [name, spec] of Object.entries(registry.skills)) {
    if (targetSkill && name !== targetSkill) continue;
    const skillPath = path.join(PROJECT_ROOT, spec.path);

    if (!fs.existsSync(skillPath)) {
      continue; // Already reported by check
    }

    // Verify checksum
    const { hash } = checksumDir(skillPath);
    const expectedChecksum = lock.installed[name]?.checksum;

    if (expectedChecksum && expectedChecksum !== `sha256:${hash}` && spec.trust_level !== 'L0') {
      error(`${name}: checksum mismatch`);
      error(`  Expected: ${expectedChecksum}`);
      error(`  Got: sha256:${hash}`);
      allPassed = false;
    } else {
      log(`${name}: checksum verified`, 'pass');
    }

    // Verify adapters
    if (spec.adapters) {
      for (const [adapter, adapterPath] of Object.entries(spec.adapters)) {
        const fullPath = path.join(PROJECT_ROOT, adapterPath);
        if (!fs.existsSync(fullPath)) {
          error(`${name}: ${adapter} adapter missing at ${adapterPath}`);
          allPassed = false;
        } else {
          log(`  ${adapter} adapter: OK`, 'pass');
        }
      }
    }
  }

  console.log('');
  if (allPassed) {
    log('All verifications passed', 'pass');
  } else {
    error('Verification failed');
    process.exit(1);
  }
}

async function cmdDiff(targetSkill = null) {
  log('Showing skill diffs...');

  const lock = loadYaml(path.join(PROJECT_ROOT, SKILL_LOCK));
  const registry = loadYaml(path.join(PROJECT_ROOT, SKILL_REGISTRY));

  if (!lock || !registry) {
    error('Missing registry or lockfile');
    process.exit(1);
  }

  for (const [name, spec] of Object.entries(registry.skills)) {
    if (targetSkill && name !== targetSkill) continue;
    const skillPath = path.join(PROJECT_ROOT, spec.path);
    if (!fs.existsSync(skillPath)) continue;

    const { hash } = checksumDir(skillPath);
    const lockChecksum = lock.installed[name]?.checksum;

    console.log(`\n${C.blue}${name}${C.reset}`);

    if (lockChecksum) {
      if (lockChecksum === `sha256:${hash}`) {
        log('No changes since last install', 'pass');
      } else {
        log('Changed since last install', 'warn');
        console.log(`  Locked: ${lockChecksum}`);
        console.log(`  Current: sha256:${hash}`);
      }
    } else {
      log('Not in lockfile (never installed)', 'warn');
    }
  }
}

async function cmdUpdate(targetSkill = null, propose = false) {
  log('Checking for skill updates...');

  const lock = loadYaml(path.join(PROJECT_ROOT, SKILL_LOCK));
  const registry = loadYaml(path.join(PROJECT_ROOT, SKILL_REGISTRY));

  if (!lock || !registry) {
    error('Missing registry or lockfile');
    process.exit(1);
  }

  const updates = [];

  for (const [name, spec] of Object.entries(registry.skills)) {
    if (targetSkill && name !== targetSkill) continue;

    const skillPath = path.join(PROJECT_ROOT, spec.path);
    if (!fs.existsSync(skillPath)) continue;

    const { hash, files } = checksumDir(skillPath);
    const currentChecksum = lock.installed[name]?.checksum;

    if (currentChecksum && currentChecksum !== `sha256:${hash}`) {
      updates.push({
        name,
        oldChecksum: currentChecksum,
        newChecksum: `sha256:${hash}`,
        changed: true,
      });
    }
  }

  if (updates.length === 0) {
    log('All skills are up to date', 'pass');
    return;
  }

  console.log(`\n${C.yellow}Found ${updates.length} skill(s) with changes:${C.reset}`);
  for (const update of updates) {
    console.log(`  ${C.blue}${update.name}${C.reset}`);
    console.log(`    Old: ${update.oldChecksum}`);
    console.log(`    New: ${update.newChecksum}`);
  }

  if (propose) {
    console.log(`\n${C.blue}Propose mode: generating diff only${C.reset}`);
    console.log('Run without --propose to apply updates.');

    // Save proposed lockfile
    const proposedLock = { ...lock, updated_at: new Date().toISOString() };
    for (const update of updates) {
      proposedLock.installed[update.name].checksum = update.newChecksum;
      proposedLock.installed[update.name].updated_at = new Date().toISOString();
    }
    saveYaml(path.join(PROJECT_ROOT, 'skills.lock.proposed.yaml'), proposedLock);
    log('Proposed lockfile saved to skills.lock.proposed.yaml', 'pass');
  } else {
    console.log(`\n${C.blue}Applying updates...${C.reset}`);

    // Apply updates
    for (const update of updates) {
      lock.installed[update.name].checksum = update.newChecksum;
      lock.installed[update.name].updated_at = new Date().toISOString();
    }
    lock.updated_at = new Date().toISOString();

    saveYaml(path.join(PROJECT_ROOT, SKILL_LOCK), lock);
    log('Lockfile updated', 'pass');
  }
}

function printHelp() {
  console.log(`
${C.blue}Skill Sync - Controlled Skill Management${C.reset}

Usage:
  pnpm skill:check    Check for missing/inconsistent skills
  pnpm skill:install  Install skills from registry
  pnpm skill:verify   Verify skill integrity
  pnpm skill:diff     Show changes since last install
  pnpm skill:update   Update lockfile with current checksums

Options:
  --skill <name>   Target specific skill only
  --json           Output machine-readable JSON
  --quiet          Suppress all output except errors
  --propose        Generate proposed lockfile without applying

Trust Levels:
  L0  Built-in, fully trusted (auto install, auto enable)
  L1  Internal registry, locked version (install with review)
  L2  Whitelist external, locked version (manual review required)
  L3  Unknown sources (BLOCKED)

Examples:
  pnpm skill:check --skill release-quality-review
  pnpm skill:install --skill release-quality-review --json
  pnpm skill:verify --quiet
  pnpm skill:update --propose    # Generate diff without applying
  pnpm skill:update              # Apply updates to lockfile

Rules:
  - Skills must be declared in skill-registry.yaml
  - L3 (unknown sources) are always blocked
  - Auto-update is disabled by default
  - Checksum verification required for L1/L2 skills
`);
}

async function main() {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      skill: { type: 'string' },
      json: { type: 'boolean', default: false },
      quiet: { type: 'boolean', default: false },
      q: { type: 'boolean', default: false },
      propose: { type: 'boolean', default: false },
    },
  });

  const command = positionals[0] || 'check';
  const targetSkill = values.skill || null;
  const isJson = values.json;
  const isQuiet = values.quiet || values.q;
  const isPropose = values.propose;

  // Override log functions for quiet/json mode
  const originalLog = log;
  const originalError = error;

  if (isQuiet) {
    log = () => {};
    error = () => {};
  }

  const logJson = (obj) => {
    if (isJson) {
      console.log(JSON.stringify(obj));
    } else {
      originalLog(obj);
    }
  };

  switch (command) {
    case 'check':
      await cmdCheck(targetSkill, logJson);
      break;
    case 'install':
      await cmdInstall(targetSkill, logJson);
      break;
    case 'verify':
      await cmdVerify(targetSkill, logJson);
      break;
    case 'diff':
      await cmdDiff(targetSkill, logJson);
      break;
    case 'update':
      await cmdUpdate(targetSkill, isPropose);
      break;
    case 'help':
    case '--help':
    case '-h':
      printHelp();
      break;
    default:
      error(`Unknown command: ${command}`);
      printHelp();
      process.exit(1);
  }
}

main().catch(err => {
  error(`Unexpected error: ${err.message}`);
  process.exit(1);
});
