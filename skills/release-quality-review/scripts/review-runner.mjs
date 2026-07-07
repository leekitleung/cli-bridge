#!/usr/bin/env node
/**
 * Review Runner - Orchestrates Multi-Reviewer Quality Reviews
 *
 * This script orchestrates the full review workflow:
 * 1. Load profile configuration
 * 2. Detect conditional reviewers based on changes
 * 3. Collect evidence
 * 4. Run reviewers in sequence or parallel
 * 5. Aggregate results
 * 6. Run gate check
 *
 * Usage:
 *   node review-runner.mjs --profile release-gate
 *   node review-runner.mjs --profile quick --parallel
 *   node review-runner.mjs --dry-run
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

const PROJECT_ROOT = process.cwd();
const SKILL_DIR = join(PROJECT_ROOT, 'skills', 'release-quality-review');
const REPORT_DIR = join(PROJECT_ROOT, 'quality-reports');
const CONFIG_FILE = join(SKILL_DIR, 'review-config.yaml');

// ANSI colors
const c = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
};

const log = {
  info: (msg) => console.log(`${c.blue}ℹ${c.reset} ${msg}`),
  success: (msg) => console.log(`${c.green}✓${c.reset} ${msg}`),
  warn: (msg) => console.log(`${c.yellow}⚠${c.reset} ${msg}`),
  error: (msg) => console.log(`${c.red}✗${c.reset} ${msg}`),
  title: (msg) => console.log(`\n${c.bright}${c.cyan}═══ ${msg} ═══${c.reset}\n`),
};

// Parse arguments
const args = process.argv.slice(2);
let profile = 'release-gate';
let roundNumber = null;
let parallel = false;
let dryRun = false;
let skipEvidence = false;
let reviewerOverride = null;

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--profile' && args[i + 1]) profile = args[++i];
  else if (arg === '--round' && args[i + 1]) roundNumber = parseInt(args[++i], 10);
  else if (arg === '--parallel') parallel = true;
  else if (arg === '--dry-run') dryRun = true;
  else if (arg === '--skip-evidence') skipEvidence = true;
  else if (arg === '--reviewer' && args[i + 1]) reviewerOverride = args[++i];
  else if (arg === '--help' || arg === '-h') {
    printHelp();
    process.exit(0);
  }
}

function printHelp() {
  console.log(`
${c.bright}Review Runner - Quality Review Orchestrator${c.reset}

Usage:
  node review-runner.mjs [options]

Options:
  --profile <name>   Profile: quick, default, release-gate, full (default: release-gate)
  --round <N>        Round number (auto-detected if not specified)
  --parallel         Run reviewers in parallel
  --reviewer <name>  Run only this reviewer
  --skip-evidence    Skip automatic evidence collection
  --dry-run          Validate configuration without running
  --help, -h         Show this help

Profiles:
  quick         Development check (2 reviewers, ~5 min)
  default       Standard PR review (3 reviewers, ~15 min)
  release-gate  Release gate (5 reviewers, ~30 min) ⭐
  full          Complete review (8 reviewers, ~60 min)

Examples:
  node review-runner.mjs --profile release-gate
  node review-runner.mjs --profile default --parallel
  node review-runner.mjs --reviewer destructive-qa --dry-run
  `);
}

// Load YAML profile
function loadProfile(profileName) {
  const profilePath = join(SKILL_DIR, 'profiles', `${profileName}.yaml`);
  if (!existsSync(profilePath)) {
    log.error(`Profile not found: ${profileName}`);
    log.error(`Looking for: ${profilePath}`);
    return null;
  }

  try {
    const content = readFileSync(profilePath, 'utf-8');
    return parseYamlProfile(content, profileName);
  } catch (e) {
    log.error(`Failed to load profile: ${e.message}`);
    return null;
  }
}

// Simple YAML parser for profiles
function parseYamlProfile(content, name) {
  const profile = {
    name,
    description: '',
    estimated_time: '',
    resident_reviewers: [],
    conditional_reviewers: [],
    gate: { min_score: 90, fail_on_redlines: true },
    output: { verbose: false, include_evidence: false },
  };

  const lines = content.split('\n');
  let currentSection = null;
  let inConditional = false;
  let inChecklist = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip comments and empty lines
    if (!trimmed || trimmed.startsWith('#')) continue;

    // Skip Markdown checkboxes (they're not YAML list items)
    if (trimmed.startsWith('- [') || trimmed.startsWith('- [ ]')) continue;

    // Section headers (## xxx)
    if (trimmed.startsWith('## ')) {
      const section = trimmed.slice(3).toLowerCase();
      if (section.includes('conditional')) {
        inConditional = true;
        currentSection = 'conditional';
      } else if (section.includes('reviewer') || section.includes('config')) {
        inConditional = false;
        currentSection = null;
      }
      inChecklist = false;
      continue;
    }

    // Skip code blocks and other non-YAML content
    if (trimmed.startsWith('```') || trimmed.startsWith('|')) continue;

    // Key-value pairs
    if (trimmed.includes(':')) {
      const colonIdx = trimmed.indexOf(':');
      const key = trimmed.slice(0, colonIdx).trim();
      let value = trimmed.slice(colonIdx + 1).trim();

      // Remove inline comments like "# comment"
      value = value.split('#')[0].trim();

      if (key === 'profile') profile.name = value;
      else if (key === 'description') profile.description = value;
      else if (key === 'estimated_time') profile.estimated_time = value;
      else if (key === 'min_score') profile.gate.min_score = parseInt(value) || 90;
      else if (key === 'fail_on_redlines') profile.gate.fail_on_redlines = value === 'true';
      else if (key === 'resident_reviewers' || key === 'required_reviewers') {
        currentSection = 'resident';
        inConditional = false;
      } else if (key === 'conditional_reviewers') {
        currentSection = 'conditional';
        inConditional = true;
      } else if (key === 'verbose') profile.output.verbose = value === 'true';
      else if (key === 'include_evidence') profile.output.include_evidence = value === 'true';
    } else if (trimmed.startsWith('- ')) {
      // YAML list item (but not Markdown checkbox)
      if (inChecklist) continue; // Skip checklist continuation

      let item = trimmed.slice(2).trim();
      // Remove inline comments
      item = item.split('#')[0].trim();

      if (currentSection === 'resident') {
        profile.resident_reviewers.push(item);
      } else if (inConditional) {
        profile.conditional_reviewers.push(item);
      }
    }
  }

  return profile;
}

// Load reviewer definitions
function loadReviewer(name) {
  const path = join(SKILL_DIR, 'reviewers', `${name}.md`);
  if (!existsSync(path)) return null;
  return readFileSync(path, 'utf-8');
}

// Collect evidence
function collectEvidence() {
  log.info('Collecting evidence...');

  const evidence = {
    timestamp: new Date().toISOString(),
    git: {},
    structure: {},
    config: {},
  };

  // Git info
  try {
    evidence.git = {
      branch: execSync('git branch --show-current 2>/dev/null', { encoding: 'utf-8' }).trim(),
      commit: execSync('git rev-parse --short HEAD 2>/dev/null', { encoding: 'utf-8' }).trim(),
      diffStats: execSync('git diff --stat 2>/dev/null', { encoding: 'utf-8' }).trim(),
    };

    evidence.git.changedFiles = execSync('git diff --name-only 2>/dev/null', { encoding: 'utf-8' })
      .trim().split('\n').filter(Boolean);

    evidence.git.diff = execSync('git diff 2>/dev/null', { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }).trim();
  } catch (e) {
    log.warn('Could not collect git info');
  }

  // Project structure
  try {
    if (existsSync(join(PROJECT_ROOT, 'apps'))) {
      evidence.structure.apps = readdirSync(join(PROJECT_ROOT, 'apps')).filter(f => {
        try { return statSync(join(PROJECT_ROOT, 'apps', f)).isDirectory(); } catch { return false; }
      });
    }
    if (existsSync(join(PROJECT_ROOT, 'packages'))) {
      evidence.structure.packages = readdirSync(join(PROJECT_ROOT, 'packages')).filter(f => {
        try { return statSync(join(PROJECT_ROOT, 'packages', f)).isDirectory(); } catch { return false; }
      });
    }
  } catch (e) {
    // Ignore
  }

  log.success(`Git: ${evidence.git.branch || '?'} @ ${evidence.git.commit || '?'}`);
  log.success(`Changed: ${evidence.git.changedFiles?.length || 0} files`);

  return evidence;
}

// Detect conditional reviewers based on changes
function detectConditionalReviewers(profile, evidence) {
  if (!profile.conditional_reviewers.length) return [];

  const triggered = [];
  const changedFiles = evidence.git.changedFiles || [];
  const diff = evidence.git.diff || '';

  for (const reviewer of profile.conditional_reviewers) {
    let shouldTrigger = false;

    switch (reviewer) {
      case 'native-designer':
        shouldTrigger = changedFiles.some(f =>
          /\.(tsx?|jsx?|css|scss)$/.test(f) ||
          f.includes('/ui/') || f.includes('/components/')
        );
        break;

      case 'terminal-veteran':
        shouldTrigger = changedFiles.some(f =>
          f.includes('/cli/') || f.includes('/scripts/') ||
          f.includes('/local-server/') || f.includes('command-backend') ||
          f.includes('contained-process')
        );
        break;

      case 'data-security':
        shouldTrigger = changedFiles.some(f =>
          f.includes('/auth/') || f.includes('/security/') || f.includes('/storage/') ||
          f.includes('pairing') || f.includes('token')
        ) || /token|secret|password|key|credential|auth/.test(diff);
        break;

      case 'zero-doc-user':
        shouldTrigger = changedFiles.some(f =>
          f.includes('README') || f.includes('/docs/') || f === 'package.json'
        );
        break;

      default:
        break;
    }

    if (shouldTrigger) {
      triggered.push(reviewer);
    }
  }

  return triggered;
}

// Load config
function loadConfig() {
  try {
    if (existsSync(CONFIG_FILE)) {
      const content = readFileSync(CONFIG_FILE, 'utf-8');
      const config = {};
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#') && trimmed.includes(':')) {
          const [key, ...valueParts] = trimmed.split(':');
          const value = valueParts.join(':').trim();
          if (value && !key.includes('-')) {
            config[key.trim()] = value.replace(/^["']|["']$/g, '');
          }
        }
      }
      return config;
    }
  } catch (e) {
    // Ignore
  }
  return {};
}

// Generate reviewer prompt
function generateReviewerPrompt(reviewerName) {
  const reviewerContent = loadReviewer(reviewerName);
  if (!reviewerContent) return null;

  // Extract key sections for the prompt
  const prompt = `
# ${reviewerName} Review

请执行 ${reviewerName} 的评审。

## 评审维度
请读取完整定义: ${SKILL_DIR}/reviewers/${reviewerName}.md

## 你的任务
1. 读取相关代码文件
2. 检查每个评审维度
3. 给出具体评分 (0-100)
4. 列出发现的 blocker (P0/P1 必须修复, P2/P3 建议改进)
5. 列出改进建议

## 输出要求
在 ${REPORT_DIR}/round-{N}/${reviewerName}/ 目录下创建:
- result.yaml - 机器可读结果
- score.md - 评分详情
- blockers.md - P0/P1 必须修复的问题
- improvement-list.md - P2/P3 改进建议

## 评分标准
- >= 90: 优秀，可以发布
- 80-89: 良好，建议改进
- 70-79: 及格，必须改进
- < 70: 不及格，需要重构

## 红线规则
如果发现任何红线，必须在 blockers.md 中明确标注为 P0。
`;

  return prompt;
}

// Run gate check
function runGateCheck(roundDir, profileName, round) {
  log.title('GATE CHECK');

  try {
    const gateScript = join(SKILL_DIR, 'scripts', 'review-gate.mjs');
    if (existsSync(gateScript)) {
      const roundName = `round-${String(round).padStart(3, '0')}`;
      execSync(`node "${gateScript}" --profile ${profileName} --round ${roundName}`, {
        stdio: 'inherit',
        cwd: PROJECT_ROOT,
      });
      return true;
    }
  } catch (e) {
    log.error('Gate check failed');
    return false;
  }

  return false;
}

// Main
async function main() {
  console.log(`\n${c.bright}${c.cyan}═══════════════════════════════════════════════════${c.reset}`);
  console.log(`${c.bright}${c.cyan}    Release Quality Review - Orchestrator${c.reset}`);
  console.log(`${c.bright}${c.cyan}═══════════════════════════════════════════════════${c.reset}`);

  // Load profile
  const profileConfig = loadProfile(profile);
  if (!profileConfig) {
    log.error('Failed to load profile, exiting');
    process.exit(1);
  }

  console.log(`\n${c.blue}ℹ${c.reset} Profile: ${profileConfig.name}`);
  console.log(`${c.blue}ℹ${c.reset} ${profileConfig.description || ''}`);
  if (profileConfig.estimated_time) {
    console.log(`${c.blue}ℹ${c.reset} Estimated time: ${profileConfig.estimated_time}`);
  }

  // Dry run mode
  if (dryRun) {
    console.log(`\n${c.yellow}DRY RUN MODE${c.reset}`);

    console.log('\nReviewer definitions:');
    const allReviewers = [...profileConfig.resident_reviewers, ...profileConfig.conditional_reviewers];
    for (const name of allReviewers) {
      const exists = existsSync(join(SKILL_DIR, 'reviewers', `${name}.md`));
      console.log(`  ${exists ? c.green + '✓' : c.red + '✗'} ${name}`);
    }

    console.log(`\n${c.green}Dry run complete${c.reset}`);
    return;
  }

  // Determine round number
  if (roundNumber === null) {
    let maxRound = 0;
    if (existsSync(REPORT_DIR)) {
      const rounds = readdirSync(REPORT_DIR).filter(d => d.startsWith('round-'));
      for (const r of rounds) {
        const num = parseInt(r.replace('round-', ''), 10);
        if (!isNaN(num) && num > maxRound) maxRound = num;
      }
    }
    roundNumber = maxRound + 1;
  }

  const roundDir = join(REPORT_DIR, `round-${String(roundNumber).padStart(3, '0')}`);
  mkdirSync(roundDir, { recursive: true });

  console.log(`\n${c.blue}ℹ${c.reset} Round: ${roundNumber}`);
  console.log(`${c.blue}ℹ${c.reset} Report: ${roundDir}`);

  // Collect evidence
  const evidence = skipEvidence ? { timestamp: new Date().toISOString(), git: {}, structure: {} } : collectEvidence();

  // Detect conditional reviewers
  const triggeredConditional = detectConditionalReviewers(profileConfig, evidence);
  const allReviewers = reviewerOverride
    ? [reviewerOverride]
    : [...profileConfig.resident_reviewers, ...triggeredConditional];

  console.log(`\n${c.cyan}Reviewers:${c.reset}`);
  console.log(`  Resident: ${profileConfig.resident_reviewers.join(', ')}`);
  if (triggeredConditional.length > 0) {
    console.log(`  Triggered: ${triggeredConditional.join(', ')}`);
  }
  if (reviewerOverride) {
    console.log(`  Override: ${reviewerOverride}`);
  }

  // Run reviewers
  console.log(`\n${c.cyan}═══ Running Reviews ═══${c.reset}\n`);

  const results = [];
  for (const reviewer of allReviewers) {
    const reviewerDir = join(roundDir, reviewer);
    mkdirSync(reviewerDir, { recursive: true });

    const prompt = generateReviewerPrompt(reviewer);
    if (prompt) {
      writeFileSync(join(reviewerDir, 'prompt.md'), prompt);
      console.log(`  ${c.green}✓${c.reset} ${reviewer}: prompt written`);
    } else {
      console.log(`  ${c.red}✗${c.reset} ${reviewer}: definition not found`);
    }

    results.push({ name: reviewer, status: 'pending' });
  }

  // Write metadata
  const meta = {
    profile,
    round: roundNumber,
    reviewers: allReviewers,
    triggeredConditional,
    timestamp: new Date().toISOString(),
    gate: profileConfig.gate,
    evidence: {
      git: evidence.git,
      structure: evidence.structure,
    },
  };
  writeFileSync(join(roundDir, 'metadata.json'), JSON.stringify(meta, null, 2));

  console.log(`\n${c.green}✓${c.reset} Metadata written`);

  // Summary
  console.log(`\n${c.cyan}═══ Summary ═══${c.reset}\n`);
  console.log(`  Reviewers: ${results.length}`);
  console.log(`  Status: Awaiting review completion`);

  console.log(`\n${c.yellow}Next steps:${c.reset}`);
  console.log(`  1. Complete reviews by creating result.yaml files`);
  console.log(`  2. Run gate check: node review-gate.mjs --profile ${profile}`);
  console.log(`  3. If all pass, final-report.md will be generated`);
}

main().catch(err => {
  console.error(`\n${c.red}Error:${c.reset}`, err.message);
  process.exit(1);
});
