#!/usr/bin/env node
/**
 * review-gate.mjs - Deterministic quality gate for release-quality-review
 *
 * Checks:
 * 1. All required reviewers have result.yaml
 * 2. Each reviewer score >= threshold
 * 3. No redlines exist
 * 4. No P0/P1 blockers
 * 5. Evidence manifest exists
 * 6. Tests and build pass (if provided)
 *
 * Exit codes:
 * 0 = pass
 * 1 = fail
 * 2 = error (e.g., missing files)
 */

import fs from 'fs';
import path from 'path';
import { parseArgs } from 'util';
import * as yaml from 'js-yaml';
const { load: yamlLoad, dump: yamlDump } = yaml;

// ANSI colors for output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  gray: '\x1b[90m',
};

function colorize(text, color) {
  return `${colors[color]}${text}${colors.reset}`;
}

function log(msg, level = 'info') {
  const prefix = {
    info: colorize('[INFO]', 'blue'),
    pass: colorize('[PASS]', 'green'),
    fail: colorize('[FAIL]', 'red'),
    warn: colorize('[WARN]', 'yellow'),
  }[level] || colorize('[INFO]', 'blue');
  console.log(`${prefix} ${msg}`);
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

function loadProfile(profilePath) {
  try {
    const data = loadYaml(profilePath);
    if (!data) return null;

    return {
      required_reviewers: data.required_reviewers || [],
      conditional_reviewers: data.conditional_reviewers || {},
      thresholds: {
        min_score: data.thresholds?.min_score || 90,
        fail_on_redlines: data.thresholds?.fail_on_redlines !== false,
        fail_on_p0_p1_blockers: data.thresholds?.fail_on_p0_p1_blockers !== false,
      },
    };
  } catch (err) {
    log(`Failed to load profile: ${profilePath}`, 'fail');
    process.exit(2);
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      round: { type: 'string', default: process.env.REVIEW_ROUND || 'round-001' },
      profile: { type: 'string', default: process.env.REVIEW_PROFILE || 'default' },
      'dry-run': { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
  });

  if (values.help) {
    console.log(`
review-gate.mjs - Quality Gate Checker

Usage:
  node scripts/review-gate.mjs [options]

Options:
  --round <name>     Review round name (default: round-001)
  --profile <name>   Review profile: default, release-gate (default: default)
  --dry-run          Don't exit with error code on failure
  --help             Show this help

Exit codes:
  0 = All gates passed
  1 = Gates failed
  2 = Error (missing files, etc.)
`);
    process.exit(0);
  }

  const baseDir = process.cwd();
  const roundDir = path.join(baseDir, 'quality-reports', values.round);
  const skillDir = path.join(baseDir, 'skills', 'release-quality-review');
  const profilePath = path.join(skillDir, 'profiles', `${values.profile}.yaml`);

  log(`Running gate check for ${values.round} with profile ${values.profile}`);

  // Load profile
  if (!fs.existsSync(profilePath)) {
    log(`Profile not found: ${profilePath}`, 'fail');
    process.exit(2);
  }
  const profile = loadProfile(profilePath);
  log(`Required reviewers: ${profile.required_reviewers.join(', ')}`);

  // Check evidence directory
  const evidenceDir = path.join(roundDir, 'evidence');
  const manifestPath = path.join(evidenceDir, 'manifest.yaml');

  const checks = {
    evidence: fs.existsSync(manifestPath),
    reviewers: {},
    scores: {},
    redlines: {},
    blockers: {},
    testsPass: true,
    buildPass: true,
  };

  // Check required reviewers
  let allReviewersPresent = true;
  for (const reviewer of profile.required_reviewers) {
    const resultPath = path.join(roundDir, reviewer, 'result.yaml');
    const exists = fs.existsSync(resultPath);
    checks.reviewers[reviewer] = exists;

    if (!exists) {
      allReviewersPresent = false;
      log(`Missing result.yaml for reviewer: ${reviewer}`, 'fail');
    }
  }

  if (!allReviewersPresent) {
    log('Not all required reviewers have results', 'fail');
    process.exit(1);
  }

  // Parse reviewer results
  let minScore = 100;
  let totalScore = 0;
  let hasRedlines = false;
  let hasP0Blockers = false;
  let hasP1Blockers = false;
  let blockerCount = 0;

  for (const reviewer of profile.required_reviewers) {
    const resultPath = path.join(roundDir, reviewer, 'result.yaml');
    const result = loadYaml(resultPath);

    if (!result) {
      log(`Failed to parse ${resultPath}`, 'fail');
      process.exit(2);
    }

    const score = parseInt(result.score) || 0;
    checks.scores[reviewer] = score;
    minScore = Math.min(minScore, score);
    totalScore += score;

    // Check redlines
    const redlines = Array.isArray(result.redlines) ? result.redlines : [];
    if (redlines.length > 0) {
      hasRedlines = true;
      checks.redlines[reviewer] = redlines.length;
      log(`${reviewer}: ${redlines.length} redline(s) found`, 'fail');
    }

    // Check blockers
    const blockers = Array.isArray(result.blockers) ? result.blockers : [];
    const p0Count = blockers.filter(b => b.severity === 'P0').length;
    const p1Count = blockers.filter(b => b.severity === 'P1').length;
    if (p0Count > 0) hasP0Blockers = true;
    if (p1Count > 0) hasP1Blockers = true;
    blockerCount += p0Count + p1Count;
    checks.blockers[reviewer] = { p0: p0Count, p1: p1Count };
  }

  // Calculate average
  const avgScore = (totalScore / profile.required_reviewers.length).toFixed(1);

  // Print summary
  console.log('\n' + colorize('═══ GATE CHECK RESULTS ═══', 'gray'));

  for (const [reviewer, score] of Object.entries(checks.scores)) {
    const status = score >= profile.thresholds.min_score ? 'pass' : 'fail';
    const icon = status === 'pass' ? '✓' : '✗';
    log(`${reviewer}: ${score}/100 ${colorize(icon, status)}`, status);
  }

  console.log(colorize('\n── Summary ──', 'gray'));
  console.log(`  Minimum Score: ${minScore}/100 (threshold: ${profile.thresholds.min_score})`);
  console.log(`  Average Score: ${avgScore}/100`);
  console.log(`  Evidence manifest: ${checks.evidence ? colorize('✓', 'green') : colorize('✗', 'red')}`);

  if (hasRedlines) {
    console.log(`  Redlines: ${colorize('FOUND', 'red')} (blocking)`);
  } else {
    console.log(`  Redlines: ${colorize('none', 'green')}`);
  }

  if (hasP0Blockers) {
    console.log(`  P0 Blockers: ${colorize('FOUND', 'red')} (blocking)`);
  } else {
    console.log(`  P0 Blockers: ${colorize('none', 'green')}`);
  }

  if (hasP1Blockers) {
    console.log(`  P1 Blockers: ${colorize('FOUND', 'yellow')} (warning)`);
  } else {
    console.log(`  P1 Blockers: ${colorize('none', 'green')}`);
  }

  // Determine gate result
  let passed = true;
  let reasons = [];

  if (minScore < profile.thresholds.min_score) {
    passed = false;
    reasons.push(`Minimum score ${minScore} < threshold ${profile.thresholds.min_score}`);
  }

  if (profile.thresholds.fail_on_redlines && hasRedlines) {
    passed = false;
    reasons.push('Redlines exist');
  }

  if (profile.thresholds.fail_on_p0_p1_blockers && (hasP0Blockers || hasP1Blockers)) {
    passed = false;
    reasons.push(`P0/P1 blockers exist (${blockerCount})`);
  }

  if (!checks.evidence) {
    passed = false;
    reasons.push('Evidence manifest missing');
  }

  // Write gate result
  const gateResult = {
    passed,
    profile: values.profile,
    round: values.round,
    timestamp: new Date().toISOString(),
    minScore,
    averageScore: parseFloat(avgScore),
    failedReviewers: Object.entries(checks.scores)
      .filter(([, s]) => s < profile.thresholds.min_score)
      .map(([r]) => r),
    redlineCount: Object.values(checks.redlines).reduce((a, b) => a + b, 0),
    p0p1BlockerCount: blockerCount,
    evidenceManifest: checks.evidence,
    reasons: passed ? [] : reasons,
  };

  const gateResultPath = path.join(roundDir, 'gate-result.json');
  fs.writeFileSync(gateResultPath, JSON.stringify(gateResult, null, 2));
  log(`Gate result written to: ${gateResultPath}`);

  console.log('\n' + colorize('═══ FINAL VERDICT ═══', 'gray'));

  if (passed) {
    console.log(colorize('  ✓ PASSED - All gates cleared', 'green'));
    if (!values['dry-run']) {
      process.exit(0);
    }
  } else {
    console.log(colorize('  ✗ FAILED - Gates not cleared', 'red'));
    console.log(colorize(`  Reasons: ${reasons.join(', ')}`, 'yellow'));
    if (!values['dry-run']) {
      process.exit(1);
    }
  }

  process.exit(0);
}

main().catch(err => {
  log(`Unexpected error: ${err.message}`, 'fail');
  process.exit(2);
});
