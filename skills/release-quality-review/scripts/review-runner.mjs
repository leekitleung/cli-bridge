#!/usr/bin/env node
/**
 * review-runner.mjs - Orchestrates the complete quality review process
 *
 * Workflow:
 * 1. Create/update round directory
 * 2. Collect evidence (git diff, test, build, typecheck)
 * 3. Determine required reviewers from profile
 * 4. Create reviewer task directories
 * 5. Run reviewers (or spawn subagents)
 * 6. Validate result.yaml files
 * 7. Run review-gate
 * 8. Output summary
 *
 * Exit codes:
 * 0 = pass
 * 1 = fail (gate failed)
 * 2 = error
 */

import fs from 'fs';
import path from 'path';
import { parseArgs } from 'util';
import { execSync } from 'child_process';
import * as yaml from 'js-yaml';
const { load: yamlLoad } = yaml;

const PROJECT_ROOT = process.cwd();
const SKILL_DIR = path.join(PROJECT_ROOT, 'skills', 'release-quality-review');
const QUALITY_REPORTS_DIR = path.join(PROJECT_ROOT, 'quality-reports');

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
  const color = { info: 'blue', pass: 'green', fail: 'red', warn: 'yellow' }[level] || 'blue';
  console.log(`${C[color]}[${icons[level]}]${C.reset} ${msg}`);
}

function error(msg) {
  console.error(`${C.red}[ERROR]${C.reset} ${msg}`);
}

function loadYaml(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return yamlLoad(content);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

function loadProfile(profileName) {
  const profilePath = path.join(SKILL_DIR, 'profiles', `${profileName}.yaml`);
  const data = loadYaml(profilePath);
  if (!data) return null;

  return {
    name: data.name,
    description: data.description,
    required_reviewers: data.required_reviewers || [],
    conditional_reviewers: data.conditional_reviewers || {},
    thresholds: {
      min_score: data.thresholds?.min_score || 90,
      fail_on_redlines: data.thresholds?.fail_on_redlines !== false,
      fail_on_p0_p1_blockers: data.thresholds?.fail_on_p0_p1_blockers !== false,
    },
    commands: data.commands || {},
  };
}

function execCommand(cmd, options = {}) {
  try {
    const output = execSync(cmd, {
      cwd: PROJECT_ROOT,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: options.timeout || 120000,
      ...options,
    });
    return { success: true, output };
  } catch (err) {
    return {
      success: false,
      output: err.stdout || '',
      error: err.stderr || err.message,
      exitCode: err.status || 1,
    };
  }
}

async function createRound(roundName, profile) {
  const roundDir = path.join(QUALITY_REPORTS_DIR, roundName);
  const evidenceDir = path.join(roundDir, 'evidence');

  // Create directories
  fs.mkdirSync(evidenceDir, { recursive: true });
  for (const reviewer of profile.required_reviewers) {
    fs.mkdirSync(path.join(roundDir, reviewer), { recursive: true });
  }

  log(`Created round directory: ${roundDir}`);
  return roundDir;
}

async function collectEvidence(roundDir, profile) {
  const evidenceDir = path.join(roundDir, 'evidence');
  const manifest = {
    round: roundDir.split('/').pop(),
    profile: profile.name,
    timestamp: new Date().toISOString(),
    reviewers: profile.required_reviewers,
    evidence: [],
    commands_run: {},
  };

  log('Collecting evidence...');

  // Git diff
  const diffResult = execCommand('git diff HEAD~1', { timeout: 10000 });
  if (diffResult.success) {
    fs.writeFileSync(path.join(evidenceDir, 'git-diff.patch'), diffResult.output);
    manifest.evidence.push({ name: 'git-diff.patch', type: 'diff' });
    log('Git diff collected');
  }

  // Git status
  const statusResult = execCommand('git status --short');
  if (statusResult.success) {
    fs.writeFileSync(path.join(evidenceDir, 'git-status.txt'), statusResult.output);
    manifest.evidence.push({ name: 'git-status.txt', type: 'status' });
  }

  // Run tests
  if (profile.commands.test) {
    const testResult = execCommand(profile.commands.test, { timeout: 120000 });
    fs.writeFileSync(path.join(evidenceDir, 'test.log'), testResult.output + (testResult.error || ''));
    manifest.evidence.push({ name: 'test.log', type: 'log', exit_code: testResult.exitCode });
    manifest.commands_run.test = { exit_code: testResult.exitCode, passed: testResult.success };
    log(`Tests: ${testResult.success ? C.green + 'PASSED' + C.reset : C.red + 'FAILED' + C.reset}`);
  }

  // Run typecheck
  if (profile.commands.typecheck) {
    const typeResult = execCommand(profile.commands.typecheck, { timeout: 60000 });
    fs.writeFileSync(path.join(evidenceDir, 'typecheck.log'), typeResult.output);
    manifest.evidence.push({ name: 'typecheck.log', type: 'log', exit_code: typeResult.exitCode });
    manifest.commands_run.typecheck = { exit_code: typeResult.exitCode, passed: typeResult.success };
  }

  // Save manifest
  fs.writeFileSync(path.join(evidenceDir, 'manifest.yaml'),
    yaml.dump(manifest, { indent: 2, lineWidth: 120 }));

  log('Evidence collection complete');
  return manifest;
}

function validateResultYaml(resultPath, reviewer) {
  const data = loadYaml(resultPath);
  if (!data) {
    return { valid: false, error: 'File not found or invalid YAML' };
  }

  const errors = [];

  // Required fields
  if (!data.reviewer) errors.push('Missing required field: reviewer');
  if (typeof data.score !== 'number' && !data.score) errors.push('Missing required field: score');
  if (!Array.isArray(data.blockers)) errors.push('Missing required field: blockers (must be array)');
  if (!Array.isArray(data.redlines)) errors.push('Missing required field: redlines (must be array)');

  // Score range
  const score = Number(data.score);
  if (isNaN(score) || score < 0 || score > 100) {
    errors.push('score must be a number between 0 and 100');
  }

  // Blocker severity validation
  if (Array.isArray(data.blockers)) {
    for (const blocker of data.blockers) {
      if (typeof blocker === 'object' && blocker.severity) {
        if (!['P0', 'P1', 'P2', 'P3'].includes(blocker.severity)) {
          errors.push(`Invalid blocker severity: ${blocker.severity}`);
        }
      }
    }
  }

  // Redline severity validation
  if (Array.isArray(data.redlines)) {
    for (const redline of data.redlines) {
      if (typeof redline === 'object' && redline.severity) {
        if (!['P0', 'P1'].includes(redline.severity)) {
          errors.push(`Redline severity must be P0 or P1, got: ${redline.severity}`);
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    data,
  };
}

async function validateResults(roundDir, profile) {
  log('Validating reviewer results...');

  const results = {};
  let allValid = true;

  for (const reviewer of profile.required_reviewers) {
    const resultPath = path.join(roundDir, reviewer, 'result.yaml');
    const validation = validateResultYaml(resultPath, reviewer);

    results[reviewer] = {
      exists: fs.existsSync(resultPath),
      ...validation,
    };

    if (!results[reviewer].exists) {
      error(`${reviewer}: result.yaml not found`);
      allValid = false;
    } else if (!validation.valid) {
      error(`${reviewer}: Invalid result.yaml`);
      for (const err of validation.errors) {
        console.log(`  - ${err}`);
      }
      allValid = false;
    } else {
      log(`${reviewer}: result.yaml valid (score: ${validation.data.score})`, 'pass');
    }
  }

  return { allValid, results };
}

async function runGate(roundName, profileName) {
  log('Running quality gate...');

  const gateScript = path.join(SKILL_DIR, 'scripts', 'review-gate.mjs');
  const result = execCommand(`node "${gateScript}" --round ${roundName} --profile ${profileName}`, {
    timeout: 30000,
  });

  console.log(result.output);

  // Parse gate result
  const gateResultPath = path.join(QUALITY_REPORTS_DIR, roundName, 'gate-result.json');
  const gateResult = loadYaml(gateResultPath);

  return {
    passed: result.exitCode === 0,
    exitCode: result.exitCode,
    result: gateResult,
  };
}

async function generateSummary(roundDir, profile, gateResult, validation) {
  const summaryPath = path.join(roundDir, 'summary.md');

  const lines = [
    `# Quality Review Summary - ${profile.name}`,
    '',
    `**Profile**: ${profile.name}`,
    `**Date**: ${new Date().toISOString()}`,
    `**Gate Status**: ${gateResult.passed ? '✅ PASSED' : '❌ FAILED'}`,
    '',
    '## Reviewer Results',
    '',
    '| Reviewer | Score | Status |',
    '|----------|-------|--------|',
  ];

  for (const [reviewer, data] of Object.entries(validation.results)) {
    if (data.data) {
      const score = data.data.score;
      const status = score >= profile.thresholds.min_score ? '✅' : '❌';
      lines.push(`| ${reviewer} | ${score}/100 | ${status} |`);
    } else {
      lines.push(`| ${reviewer} | N/A | ❌ |`);
    }
  }

  lines.push('');
  lines.push('## Gate Result');
  lines.push('');
  lines.push('```json');
  lines.push(JSON.stringify(gateResult, null, 2));
  lines.push('```');

  fs.writeFileSync(summaryPath, lines.join('\n'));
  log(`Summary written to: ${summaryPath}`);
}

async function main() {
  const { values, positionals } = parseArgs({
    options: {
      round: { type: 'string' },
      profile: { type: 'string', default: 'default' },
      collect: { type: 'boolean', default: true },
      dryRun: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
  });

  if (values.help) {
    console.log(`
${C.blue}Review Runner - Automated Quality Review${C.reset}

Usage:
  node review-runner.mjs [options]

Options:
  --round <name>    Round name (auto-generated if not specified)
  --profile <name>  Review profile: default, release-gate (default: default)
  --collect         Collect evidence (default: true)
  --dry-run         Validate without running gate
  --help            Show this help

Examples:
  node review-runner.mjs --profile default
  node review-runner.mjs --round round-002 --profile release-gate
  node review-runner.mjs --dry-run

Exit codes:
  0 = All gates passed
  1 = Gates failed
  2 = Error
`);
    process.exit(0);
  }

  // Load profile
  const profileName = values.profile || 'default';
  const profile = loadProfile(profileName);

  if (!profile) {
    error(`Profile not found: ${profileName}`);
    error(`Available profiles in: ${path.join(SKILL_DIR, 'profiles')}`);
    process.exit(2);
  }

  log(`${C.blue}Review Profile: ${profile.name}${C.reset}`);
  log(`Description: ${profile.description}`);
  log(`Required reviewers: ${profile.required_reviewers.join(', ')}`);

  // Determine round name
  const roundName = values.round || `round-${Date.now()}`;
  const roundDir = path.join(QUALITY_REPORTS_DIR, roundName);

  console.log('');

  // Create round
  await createRound(roundName, profile);

  // Collect evidence
  if (values.collect) {
    await collectEvidence(roundDir, profile);
  }

  // Validate results
  const validation = await validateResults(roundDir, profile);

  if (!validation.allValid) {
    error('Result validation failed');
    process.exit(2);
  }

  if (values.dryRun) {
    log('Dry run complete', 'pass');
    process.exit(0);
  }

  // Run gate
  const gateResult = await runGate(roundName, profileName);

  // Generate summary
  await generateSummary(roundDir, profile, gateResult.result, validation);

  console.log('');
  if (gateResult.passed) {
    log('✅ REVIEW PASSED', 'pass');
    process.exit(0);
  } else {
    error('❌ REVIEW FAILED');
    console.log('');
    console.log('Failed reviewers:');
    for (const [reviewer, data] of Object.entries(validation.results)) {
      if (data.data && data.data.score < profile.thresholds.min_score) {
        console.log(`  - ${reviewer}: ${data.data.score}/100`);
      }
    }
    if (gateResult.result?.reasons) {
      console.log('');
      console.log('Reasons:');
      for (const reason of gateResult.result.reasons) {
        console.log(`  - ${reason}`);
      }
    }
    process.exit(1);
  }
}

main().catch(err => {
  error(`Unexpected error: ${err.message}`);
  process.exit(2);
});
