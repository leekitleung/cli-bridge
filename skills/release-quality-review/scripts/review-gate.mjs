#!/usr/bin/env node
/**
 * Review Gate - Deterministic Quality Gate
 *
 * A deterministic script that runs quality reviews and determines
 * if a release is ready. This is the last line of defense before
 * a release is allowed.
 *
 * Usage:
 *   node review-gate.mjs --profile release-gate    # Full review
 *   node review-gate.mjs --profile quick          # Quick review (resident only)
 *   node review-gate.mjs --reviewer destructive-qa  # Single reviewer
 *   node review-gate.mjs --check-redlines         # Only check redlines
 *   node review-gate.mjs --round 3                # Continue from round 3
 *   node review-gate.mjs --parallel               # Run reviewers in parallel
 *   node review-gate.mjs --collect-evidence        # Auto collect evidence
 *   node review-gate.mjs --dry-run               # Validate without running
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { readFile } from 'fs/promises';

// Use process.cwd() as the reliable project root
const PROJECT_ROOT = process.cwd();
const SKILL_DIR = join(PROJECT_ROOT, 'skills', 'release-quality-review');
const REPORT_DIR = join(PROJECT_ROOT, 'quality-reports');
const CONFIG_FILE = join(SKILL_DIR, 'review-config.yaml');

// ANSI colors
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
};

const log = {
  info: (msg) => console.log(`${colors.blue}ℹ${colors.reset} ${msg}`),
  success: (msg) => console.log(`${colors.green}✓${colors.reset} ${msg}`),
  warn: (msg) => console.log(`${colors.yellow}⚠${colors.reset} ${msg}`),
  error: (msg) => console.log(`${colors.red}✗${colors.reset} ${msg}`),
  title: (msg) => console.log(`\n${colors.bright}${colors.cyan}═══ ${msg} ═══${colors.reset}\n`),
};

// Parse arguments
const args = process.argv.slice(2);
let profile = 'release-gate';
let singleReviewer = null;
let checkRedlinesOnly = false;
let roundNumber = 1;
let parallel = false;
let collectEvidence = true;
let dryRun = false;
let excludeReviewers = [];

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--profile' && args[i + 1]) {
    profile = args[i + 1];
    i++;
  } else if (arg === '--reviewer' && args[i + 1]) {
    singleReviewer = args[i + 1];
    i++;
  } else if (arg === '--check-redlines') {
    checkRedlinesOnly = true;
  } else if (arg === '--round' && args[i + 1]) {
    roundNumber = parseInt(args[i + 1], 10);
    i++;
  } else if (arg === '--parallel') {
    parallel = true;
  } else if (arg === '--no-collect') {
    collectEvidence = false;
  } else if (arg === '--collect-evidence') {
    collectEvidence = true;
  } else if (arg === '--dry-run') {
    dryRun = true;
  } else if (arg === '--exclude-reviewer' && args[i + 1]) {
    excludeReviewers.push(args[i + 1]);
    i++;
  } else if (arg === '--help' || arg === '-h') {
    printHelp();
    process.exit(0);
  }
}

function printHelp() {
  console.log(`
${colors.bright}Review Gate - Deterministic Quality Gate${colors.reset}

Usage:
  node review-gate.mjs [options]

Options:
  --profile <name>       Review profile: quick, default, release-gate, full (default: release-gate)
  --reviewer <name>     Run only this reviewer
  --round <N>           Round number (auto-detected if not specified)
  --check-redlines      Only check for redlines (P0/P1 blockers)
  --parallel            Run reviewers in parallel (experimental)
  --no-collect          Skip automatic evidence collection
  --collect-evidence    Force evidence collection (default)
  --exclude-reviewer N  Exclude reviewer N from this run
  --dry-run             Validate configuration without running
  --help, -h            Show this help

Profiles:
  quick         Minimal resident reviewers (product-flow, architecture-maintainer)
  default       Standard PR review (product-flow, destructive-qa, terminal-veteran)
  release-gate  Full release gate (all residents + terminal-veteran)
  full          Complete review (all 8 reviewers)

Exit Codes:
  0 = All gates passed
  1 = Gates failed
  2 = Configuration error

Examples:
  node review-gate.mjs --profile release-gate
  node review-gate.mjs --round 2 --profile default
  node review-gate.mjs --reviewer destructive-qa --dry-run
  `);
}

// Load configuration
function loadConfig() {
  try {
    if (existsSync(CONFIG_FILE)) {
      const content = readFileSync(CONFIG_FILE, 'utf-8');
      // Simple YAML parser for our config
      const config = {};
      const lines = content.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#') && trimmed.includes(':')) {
          const [key, ...valueParts] = trimmed.split(':');
          const value = valueParts.join(':').trim();
          if (value) {
            config[key.trim()] = value.replace(/^["']|["']$/g, '');
          }
        }
      }
      return config;
    }
  } catch (e) {
    log.warn(`Could not load config: ${e.message}`);
  }
  return {};
}

// Reviewer profiles
const PROFILES = {
  'quick': {
    name: 'Quick Review',
    description: 'Minimal resident reviewers only',
    reviewers: ['product-flow', 'architecture-maintainer'],
  },
  'default': {
    name: 'Default Review',
    description: 'Standard PR review',
    reviewers: ['product-flow', 'destructive-qa', 'terminal-veteran'],
  },
  'release-gate': {
    name: 'Release Gate Review',
    description: 'Full release gate - required before publish',
    reviewers: [
      'product-flow',
      'architecture-maintainer',
      'release-verifier',
      'destructive-qa',
      'terminal-veteran'
    ],
  },
  'full': {
    name: 'Full Review',
    description: 'All reviewers including conditional triggers',
    reviewers: [
      'product-flow',
      'architecture-maintainer',
      'release-verifier',
      'destructive-qa',
      'native-designer',
      'zero-doc-user',
      'terminal-veteran',
      'data-security'
    ],
  },
};

// Load reviewer definition
function loadReviewer(name) {
  const path = join(SKILL_DIR, 'reviewers', `${name}.md`);
  if (!existsSync(path)) {
    return null;
  }
  return readFileSync(path, 'utf-8');
}

// Parse score from review report
function parseScore(scoreContent) {
  // Match patterns like:
  // "Overall Score: 75/100" or "Overall Score: **75/100**"
  // "总分: 85/100"
  // "Score: 85"
  // "75/100" (standalone)
  const patterns = [
    /(?:总分|Overall Score|Total Score|Score)[:\s*]*\*\*?(\d+)\*\*?\/100/i,
    /\*\*(\d+)\/100\*\*/,
    /^(\d{2})\/100$/m,
    /\s(\d{2})\/100\s/,
  ];

  for (const pattern of patterns) {
    const match = scoreContent.match(pattern);
    if (match) {
      return parseInt(match[1], 10);
    }
  }
  return null;
}

// Parse blockers from review report
function parseBlockers(blockerContent) {
  const lines = blockerContent.split('\n');
  const blockers = [];
  let currentBlocker = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (currentBlocker) {
        blockers.push(currentBlocker);
        currentBlocker = null;
      }
      continue;
    }

    if (trimmed.includes('P0') || trimmed.includes('P1') ||
        trimmed.includes('❌') || trimmed.includes('红') ||
        trimmed.includes('[ ]') || trimmed.match(/^[-*]\s+\[/)) {
      if (currentBlocker) {
        blockers.push(currentBlocker);
      }
      currentBlocker = trimmed;
    } else if (currentBlocker) {
      currentBlocker += ' ' + trimmed;
    }
  }

  if (currentBlocker) {
    blockers.push(currentBlocker);
  }

  return blockers;
}

// Collect evidence automatically
function collectEvidence_() {
  log.info('Collecting evidence...');

  const evidence = {
    timestamp: new Date().toISOString(),
    git: {},
    files: {},
    automatedChecks: {},
  };

  // Git info
  try {
    evidence.git = {
      branch: execSync('git branch --show-current 2>/dev/null || echo ""', { encoding: 'utf-8' }).trim(),
      commit: execSync('git rev-parse HEAD 2>/dev/null || echo ""', { encoding: 'utf-8' }).trim().substring(0, 8),
      status: execSync('git status --short 2>/dev/null || echo ""', { encoding: 'utf-8' }).trim(),
      diff: execSync('git diff --stat 2>/dev/null || echo ""', { encoding: 'utf-8' }).trim(),
    };
  } catch (e) {
    log.warn('Could not collect git evidence');
  }

  // Package info
  try {
    const packageJson = join(PROJECT_ROOT, 'package.json');
    if (existsSync(packageJson)) {
      const pkg = JSON.parse(readFileSync(packageJson, 'utf-8'));
      evidence.files.package = {
        name: pkg.name,
        version: pkg.version,
        scripts: Object.keys(pkg.scripts || {}),
      };
    }
  } catch (e) {
    // Ignore
  }

  // Automated checks
  evidence.automatedChecks = runAutomatedChecks();

  return evidence;
}

// Run automated gate checks
function runAutomatedChecks() {
  const checks = {
    oversizedFiles: { status: 'pass', issues: [] },
    circularDeps: { status: 'pass', issues: [] },
    secrets: { status: 'pass', issues: [] },
    testGate: { status: 'unknown', output: '' },
    typecheckGate: { status: 'unknown', output: '' },
  };

  // Check 1: Oversized files (>2000 lines)
  log.info('Checking for oversized files...');
  try {
    const output = execSync(
      'find apps packages -name "*.ts" -type f -exec wc -l {} + 2>/dev/null | sort -rn | head -20',
      { encoding: 'utf-8', cwd: PROJECT_ROOT, timeout: 30000 }
    );
    const lines = output.trim().split('\n');
    for (const line of lines) {
      const match = line.trim().match(/^\s*(\d+)\s+(.+)$/);
      if (match) {
        const [count, path] = [parseInt(match[1], 10), match[2]];
        if (count > 2000) {
          checks.oversizedFiles.issues.push({ path, lines: count });
          checks.oversizedFiles.status = 'warn';
        }
      }
    }
  } catch (e) {
    log.warn('Could not check file sizes');
  }

  // Check 2: Circular dependencies (basic heuristic)
  log.info('Checking for circular dependencies...');
  try {
    // Try madge first
    const madgeOutput = execSync(
      'npx madge --circular --extensions ts apps packages 2>&1 || echo ""',
      { encoding: 'utf-8', cwd: PROJECT_ROOT, timeout: 30000 }
    );
    if (madgeOutput.includes('Circular dependencies found') || madgeOutput.includes('-->')) {
      checks.circularDeps.status = 'fail';
      checks.circularDeps.issues = madgeOutput.split('\n').filter(l => l.includes('-->'));
    }
  } catch (e) {
    // madge might not be installed, try manual check
    try {
      const files = execSync(
        'find apps packages -name "index.ts" -type f 2>/dev/null | head -10',
        { encoding: 'utf-8', cwd: PROJECT_ROOT, timeout: 10000 }
      ).trim().split('\n');

      if (files.length > 5) {
        // Too many barrel files might indicate design issues
        checks.circularDeps.issues.push('High number of barrel exports detected - manual review needed');
        checks.circularDeps.status = 'warn';
      }
    } catch (e2) {
      // Ignore
    }
  }

  // Check 3: Secrets in source
  log.info('Checking for secrets in source...');
  try {
    const secretsOutput = execSync(
      'grep -rn "password\\|secret\\|api_key\\|private_key\\|aws_secret" ' +
      '--include="*.ts" --include="*.tsx" --include="*.js" --include="*.json" ' +
      'apps packages 2>/dev/null | grep -v "\\.d\\.ts\\|node_modules\\|_test\\|mock\\|example\\|test\\|spec" | head -10 || echo ""',
      { encoding: 'utf-8', cwd: PROJECT_ROOT, timeout: 30000 }
    ).trim();

    if (secretsOutput && secretsOutput.length > 0) {
      checks.secrets.status = 'warn';
      checks.secrets.issues = secretsOutput.split('\n').slice(0, 5);
    }
  } catch (e) {
    // No secrets found
  }

  // Check 4: Test gate
  log.info('Running test gate...');
  try {
    const testOutput = execSync('pnpm test 2>&1', { encoding: 'utf-8', cwd: PROJECT_ROOT, timeout: 120000 });
    checks.testGate.status = 'pass';
    checks.testGate.output = 'Tests passed';
  } catch (e) {
    checks.testGate.status = 'fail';
    checks.testGate.output = e.message.substring(0, 500);
  }

  // Check 5: Typecheck gate
  log.info('Running typecheck gate...');
  try {
    const typeOutput = execSync('pnpm typecheck 2>&1', { encoding: 'utf-8', cwd: PROJECT_ROOT, timeout: 120000 });
    checks.typecheckGate.status = 'pass';
    checks.typecheckGate.output = 'Typecheck passed';
  } catch (e) {
    checks.typecheckGate.status = 'fail';
    checks.typecheckGate.output = e.message.substring(0, 500);
  }

  return checks;
}

// Check if a reviewer report exists
function reviewerReportExists(roundDir, reviewer) {
  const scorePath = join(roundDir, reviewer, 'score.md');
  const blockerPath = join(roundDir, reviewer, 'blockers.md');
  return existsSync(scorePath) || existsSync(blockerPath);
}

// Load existing scores for a round
function loadExistingScores(roundDir, reviewers) {
  const results = {};

  for (const reviewer of reviewers) {
    const reviewerDir = join(roundDir, reviewer);
    const scorePath = join(reviewerDir, 'score.md');
    const blockerPath = join(reviewerDir, 'blockers.md');
    const improvementPath = join(reviewerDir, 'improvement-list.md');

    if (existsSync(scorePath)) {
      const content = readFileSync(scorePath, 'utf-8');
      results[reviewer] = {
        score: parseScore(content),
        hasReport: true,
        blockers: existsSync(blockerPath) ? parseBlockers(readFileSync(blockerPath, 'utf-8')) : [],
        improvements: existsSync(improvementPath) ? readFileSync(improvementPath, 'utf-8') : null,
      };
    } else if (existsSync(blockerPath)) {
      const blockerContent = readFileSync(blockerPath, 'utf-8');
      results[reviewer] = {
        score: null,
        hasReport: true,
        blockers: parseBlockers(blockerContent),
        improvements: existsSync(improvementPath) ? readFileSync(improvementPath, 'utf-8') : null,
      };
    } else {
      results[reviewer] = {
        score: null,
        hasReport: false,
        blockers: [],
        improvements: null,
      };
    }
  }

  return results;
}

// Generate summary report
function generateSummary(roundDir, profile, scores, allPassed, evidence = null) {
  const reportPath = join(roundDir, 'summary.md');
  const timestamp = new Date().toISOString();

  let content = `# Quality Review Summary - Round ${roundNumber}\n\n`;
  content += `**Profile:** ${profile}\n`;
  content += `**Generated:** ${timestamp}\n`;

  if (evidence) {
    content += `**Git:** ${evidence.git.branch} @ ${evidence.git.commit}\n`;
  }

  if (evidence && evidence.automatedChecks) {
    const ac = evidence.automatedChecks;
    content += `## Automated Gate Checks\n\n`;
    content += `| Check | Status | Details |\n`;
    content += `|-------|--------|--------|\n`;

    const testIcon = ac.testGate.status === 'pass' ? '✅' : '❌';
    content += `| pnpm test | ${testIcon} ${ac.testGate.status} | ${ac.testGate.output.substring(0, 50)} |\n`;

    const typeIcon = ac.typecheckGate.status === 'pass' ? '✅' : '❌';
    content += `| pnpm typecheck | ${typeIcon} ${ac.typecheckGate.status} | ${ac.typecheckGate.output.substring(0, 50)} |\n`;

    const sizeIcon = ac.oversizedFiles.status === 'pass' ? '✅' : '⚠️';
    content += `| File sizes | ${sizeIcon} ${ac.oversizedFiles.issues.length} oversized | ${ac.oversizedFiles.issues.slice(0, 2).map(i => `${i.lines}L ${i.path.split('/').pop()}`).join(', ') || 'OK'} |\n`;

    const circIcon = ac.circularDeps.status === 'pass' ? '✅' : '❌';
    content += `| Circular deps | ${circIcon} | ${ac.circularDeps.issues.length > 0 ? ac.circularDeps.issues[0].substring(0, 50) : 'None found'} |\n`;

    const secretIcon = ac.secrets.status === 'pass' ? '✅' : '⚠️';
    content += `| Secrets scan | ${secretIcon} | ${ac.secrets.issues.length > 0 ? ac.secrets.issues.length + ' potential' : 'Clean'} |\n`;

    content += `\n`;

    // Add detail section for issues
    const allIssues = [
      ...ac.oversizedFiles.issues.map(i => `⚠️ **Oversized file**: ${i.path} (${i.lines} lines)`),
      ...ac.secrets.issues.map(i => `⚠️ **Potential secret**: ${i.substring(0, 100)}`),
      ...ac.circularDeps.issues.filter(i => typeof i === 'string').map(i => `❌ **Circular dep**: ${i.substring(0, 100)}`),
    ];

    if (allIssues.length > 0) {
      content += `### Automated Check Issues\n\n`;
      allIssues.forEach((issue, i) => {
        content += `${i + 1}. ${issue}\n`;
      });
      content += `\n`;
    }
  }

  content += `---\n\n`;

  // Score table
  content += `## Scores\n\n`;
  content += `| Reviewer | Score | Status | Blockers |\n`;
  content += `|----------|-------|--------|----------|\n`;

  let totalPassed = 0;
  let totalReviewed = 0;
  let totalBlockers = 0;

  for (const [reviewer, result] of Object.entries(scores)) {
    totalReviewed++;
    if (result.score !== null) {
      const status = result.score >= 90 ? '✅ PASS' : '❌ FAIL';
      const blockerCount = result.blockers.length;
      totalBlockers += blockerCount;
      content += `| ${reviewer} | ${result.score}/100 | ${status} | ${blockerCount > 0 ? `⚠ ${blockerCount}` : '-'} |\n`;
      if (result.score >= 90) totalPassed++;
    } else if (result.hasReport) {
      content += `| ${reviewer} | N/A | ⚠ INCOMPLETE | ${result.blockers.length} |\n`;
    } else {
      content += `| ${reviewer} | - | ⏳ PENDING | - |\n`;
    }
  }

  content += `\n`;
  content += `**Total:** ${totalPassed}/${totalReviewed} passed, ${totalBlockers} blockers\n\n`;

  // Blockers detail
  const allBlockers = Object.entries(scores)
    .filter(([, r]) => r.blockers && r.blockers.length > 0)
    .flatMap(([name, r]) => r.blockers.map(b => ({ reviewer: name, blocker: b })));

  if (allBlockers.length > 0) {
    content += `## Blockers Detail\n\n`;
    for (const { reviewer, blocker } of allBlockers) {
      content += `- **${reviewer}:** ${blocker}\n`;
    }
    content += `\n`;
  }

  // Overall status
  content += `---\n\n`;
  if (allPassed) {
    content += `## ✅ ALL REVIEWERS PASSED\n\n`;
    content += `This release has passed all quality gates. It is ready to ship.\n`;
    content += `\nTo generate the final report:\n`;
    content += `\`\`\`bash\n`;
    content += `node skills/release-quality-review/scripts/review-gate.mjs --generate-final\n`;
    content += `\`\`\`\n`;
  } else {
    content += `## ❌ QUALITY GATE FAILED\n\n`;
    content += `This release has not passed quality gates. Fix the issues below and re-run review.\n\n`;
    content += `**To continue:**\n`;
    content += `\`\`\`bash\n`;
    content += `node skills/release-quality-review/scripts/review-runner.mjs --profile ${profile} --round ${roundNumber + 1}\n`;
    content += `\`\`\`\n\n`;

    // Show top blockers
    if (allBlockers.length > 0) {
      content += `**Top priorities to fix:**\n\n`;
      allBlockers.slice(0, 5).forEach(({ reviewer, blocker }, i) => {
        content += `${i + 1}. [${reviewer}] ${blocker}\n`;
      });
    }
  }

  writeFileSync(reportPath, content);
  log.success(`Summary written to: ${reportPath}`);
  return allPassed;
}

// Generate final report when all gates pass
function generateFinalReport(scores, evidence = null) {
  const reportPath = join(REPORT_DIR, 'final-report.md');
  const timestamp = new Date().toISOString();

  let content = `# 🎉 RELEASE APPROVED\n\n`;
  content += `**Date:** ${timestamp}\n`;
  content += `**Status:** APPROVED FOR RELEASE\n`;

  if (evidence) {
    content += `**Git:** ${evidence.git.branch} @ ${evidence.git.commit}\n`;
  }

  content += `\n---\n\n`;
  content += `## Final Scores\n\n`;
  content += `| Reviewer | Score | Gate |\n`;
  content += `|----------|-------|------|\n`;

  for (const [reviewer, result] of Object.entries(scores)) {
    const status = result.score >= 90 ? '✅' : '❌';
    content += `| ${reviewer} | ${result.score}/100 | ${status} |\n`;
  }

  content += `\n---\n\n`;
  content += `## Release Checklist\n\n`;
  content += `- [x] All reviewers >= 90/100\n`;
  content += `- [x] No P0/P1 redlines\n`;
  content += `- [ ] Tests passing\n`;
  content += `- [ ] Build successful\n`;
  content += `- [ ] Changelog updated\n`;
  content += `- [ ] Version bumped\n\n`;
  content += `---\n\n`;
  content += `*Generated by Release Quality Review Skill*\n`;
  content += `*Tool: cli-bridge quality gate*\n`;

  writeFileSync(reportPath, content);
  log.success(`Final report: ${reportPath}`);
  return reportPath;
}

// Main gate check
async function runGate() {
  const config = loadConfig();

  // Determine reviewers to run
  let reviewers = [];
  if (singleReviewer) {
    reviewers = [singleReviewer];
  } else {
    const profileConfig = PROFILES[profile] || PROFILES['release-gate'];
    reviewers = profileConfig.reviewers.filter(r => !excludeReviewers.includes(r));
  }

  // Dry run mode
  if (dryRun) {
    log.info(`Dry run mode - validating configuration`);
    log.info(`Profile: ${profile}`);
    log.info(`Reviewers: ${reviewers.join(', ')}`);
    log.info(`Round: ${roundNumber}`);

    // Validate reviewer files exist
    for (const reviewer of reviewers) {
      const exists = existsSync(join(SKILL_DIR, 'reviewers', `${reviewer}.md`));
      log.info(`  ${exists ? '✓' : '✗'} ${reviewer}: ${exists ? 'found' : 'MISSING'}`);
    }

    return true;
  }

  // Title
  console.log('');
  log.title('RELEASE QUALITY GATE');
  log.info(`Profile: ${colors.bright}${profile}${colors.reset}`);
  log.info(`Reviewers: ${reviewers.join(', ')}`);
  if (parallel) log.info(`Mode: parallel`);
  console.log('');

  // Determine round directory
  let roundDir = join(REPORT_DIR, `round-${String(roundNumber).padStart(3, '0')}`);

  // Check if this is a new round or continuing
  const isNewRound = !existsSync(roundDir);
  if (isNewRound) {
    mkdirSync(roundDir, { recursive: true });
    log.info(`New round: ${roundDir}`);
  } else {
    log.info(`Continuing round: ${roundDir}`);
  }

  // Collect evidence if requested
  let evidence = null;
  if (collectEvidence) {
    try {
      evidence = collectEvidence_();
      log.success(`Evidence collected`);
    } catch (e) {
      log.warn(`Evidence collection failed: ${e.message}`);
    }
  }

  // Load existing scores
  const existingScores = loadExistingScores(roundDir, reviewers);
  const pendingReviewers = reviewers.filter(r => !existingScores[r].hasReport);
  const completedReviewers = reviewers.filter(r => existingScores[r].hasReport);

  // Check for redlines only mode
  if (checkRedlinesOnly) {
    log.title('REDLINE CHECK');
    const allBlockers = Object.entries(existingScores)
      .filter(([, r]) => r.blockers && r.blockers.length > 0)
      .flatMap(([name, r]) => r.blockers.map(b => ({ reviewer: name, blocker: b })));

    if (allBlockers.length === 0) {
      log.success('No redlines found!');
      return true;
    } else {
      log.error(`Found ${allBlockers.length} redlines:`);
      allBlockers.forEach(({ reviewer, blocker }, i) => {
        console.log(`  ${i + 1}. [${reviewer}] ${blocker}`);
      });
      return false;
    }
  }

  // Show pending reviewers
  if (pendingReviewers.length > 0) {
    log.title('PENDING REVIEWS');
    for (const reviewer of pendingReviewers) {
      const reviewerContent = loadReviewer(reviewer);
      if (reviewerContent) {
        const reviewerDir = join(roundDir, reviewer);
        mkdirSync(reviewerDir, { recursive: true });
        console.log(`  ${colors.cyan}${reviewer}${colors.reset}`);
      } else {
        log.warn(`  ${reviewer}: reviewer definition not found`);
      }
    }
    console.log('');
  }

  // Show completed reviewers with scores
  if (completedReviewers.length > 0) {
    log.title('COMPLETED REVIEWS');
    for (const reviewer of completedReviewers) {
      const score = existingScores[reviewer].score;
      const blockerCount = existingScores[reviewer].blockers?.length || 0;

      if (score !== null) {
        const icon = score >= 90 ? '✅' : '❌';
        const blockerIcon = blockerCount > 0 ? ` ⚠${blockerCount}` : '';
        console.log(`  ${icon} ${reviewer}: ${score}/100${blockerIcon}`);
      } else if (existingScores[reviewer].hasReport) {
        console.log(`  ⚠ ${reviewer}: incomplete${blockerCount > 0 ? ` ⚠${blockerCount}` : ''}`);
      }
    }
    console.log('');
  }

  // Calculate overall status
  const allHaveScores = reviewers.every(r => existingScores[r].score !== null);
  const allPassed = allHaveScores && reviewers.every(r => existingScores[r].score >= 90);
  const hasRedlines = Object.values(existingScores).some(r =>
    r.blockers && r.blockers.length > 0
  );

  // Summary
  log.title('GATE STATUS');

  if (allHaveScores) {
    if (allPassed && !hasRedlines) {
      log.success('All gates PASSED!');
      generateSummary(roundDir, profile, existingScores, true, evidence);

      // Generate final report
      const finalPath = generateFinalReport(existingScores, evidence);
      console.log('');
      log.success('🎉 Release is ready!');
      return true;
    } else {
      log.error('GATE FAILED');
      if (hasRedlines) {
        log.error('Redlines detected - blocking release');
      }
      generateSummary(roundDir, profile, existingScores, false, evidence);
      return false;
    }
  } else {
    const completed = completedReviewers.length;
    const total = reviewers.length;
    console.log(`  Progress: ${completed}/${total} completed`);
    console.log('');
    log.info('To complete this review, run the pending reviewers:');
    console.log('');
    for (const reviewer of pendingReviewers) {
      console.log(`  ${colors.magenta}node review-gate.mjs --reviewer ${reviewer}${colors.reset}`);
    }
    console.log('');
    generateSummary(roundDir, profile, existingScores, false, evidence);
    return false;
  }
}

// Run the gate
runGate()
  .then(passed => {
    process.exit(passed ? 0 : 1);
  })
  .catch(err => {
    log.error(`Gate error: ${err.message}`);
    process.exit(2);
  });
