#!/usr/bin/env node
/**
 * Review Runner - Orchestrates Multi-Reviewer Quality Reviews
 *
 * This script orchestrates the full review workflow:
 * 1. Collect evidence
 * 2. Run reviewers in sequence or parallel
 * 3. Aggregate results
 * 4. Run gate check
 *
 * Usage:
 *   node review-runner.mjs --profile release-gate
 *   node review-runner.mjs --profile quick --parallel
 *   node review-runner.mjs --dry-run
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

// Use process.cwd() as the reliable project root
const PROJECT_ROOT = process.cwd();
const SKILL_DIR = join(PROJECT_ROOT, 'skills', 'release-quality-review');
const REPORT_DIR = join(PROJECT_ROOT, 'quality-reports');

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

// Parse arguments
const args = process.argv.slice(2);
let profile = 'release-gate';
let roundNumber = null;
let parallel = false;
let dryRun = false;
let skipEvidence = false;

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--profile' && args[i + 1]) profile = args[++i];
  else if (arg === '--round' && args[i + 1]) roundNumber = parseInt(args[++i], 10);
  else if (arg === '--parallel') parallel = true;
  else if (arg === '--dry-run') dryRun = true;
  else if (arg === '--skip-evidence') skipEvidence = true;
}

// Load reviewer definitions
function loadReviewer(name) {
  const path = join(SKILL_DIR, 'reviewers', `${name}.md`);
  if (!existsSync(path)) return null;
  return readFileSync(path, 'utf-8');
}

// Load reviewer instructions
function getReviewerInstructions(name) {
  const content = loadReviewer(name);
  if (!content) return null;

  // Extract key sections
  const instructions = {
    name,
    dimensions: [],
    redlines: [],
    checklist: [],
  };

  // Parse dimensions from markdown
  const dimensionMatch = content.match(/##\s+Review\s+Dimensions[\s\S]*?(?=##|$)/i);
  if (dimensionMatch) {
    const lines = dimensionMatch[0].split('\n');
    for (const line of lines) {
      if (line.includes('**') || line.includes('|')) {
        instructions.checklist.push(line.replace(/[#*|]/g, '').trim());
      }
    }
  }

  return instructions;
}

// Profiles
const PROFILES = {
  quick: {
    name: 'Quick Review',
    reviewers: ['product-flow', 'architecture-maintainer'],
  },
  default: {
    name: 'Default Review',
    reviewers: ['product-flow', 'destructive-qa', 'terminal-veteran'],
  },
  'release-gate': {
    name: 'Release Gate',
    reviewers: ['product-flow', 'architecture-maintainer', 'release-verifier', 'destructive-qa', 'terminal-veteran'],
  },
  full: {
    name: 'Full Review',
    reviewers: ['product-flow', 'architecture-maintainer', 'release-verifier', 'destructive-qa', 'native-designer', 'zero-doc-user', 'terminal-veteran', 'data-security'],
  },
};

// Collect evidence
function collectEvidence() {
  console.log(`\n${c.cyan}═══ Collecting Evidence ═══${c.reset}\n`);

  const evidence = {
    timestamp: new Date().toISOString(),
    git: {},
    structure: {},
  };

  // Git info
  try {
    evidence.git = {
      branch: execSync('git branch --show-current 2>/dev/null', { encoding: 'utf-8' }).trim(),
      commit: execSync('git rev-parse --short HEAD 2>/dev/null', { encoding: 'utf-8' }).trim(),
      diffStats: execSync('git diff --stat 2>/dev/null', { encoding: 'utf-8' }).trim(),
    };

    // Get changed files
    evidence.git.changedFiles = execSync('git diff --name-only 2>/dev/null', { encoding: 'utf-8' })
      .trim().split('\n').filter(Boolean);
  } catch (e) {
    console.log(`  ${c.yellow}⚠ Could not collect git info${c.reset}`);
  }

  // Project structure
  try {
    const apps = readdirSync(join(PROJECT_ROOT, 'apps')).filter(f => {
      try {
        return statSync(join(PROJECT_ROOT, 'apps', f)).isDirectory();
      } catch { return false; }
    });
    evidence.structure.apps = apps;

    const packages = existsSync(join(PROJECT_ROOT, 'packages')) ?
      readdirSync(join(PROJECT_ROOT, 'packages')).filter(f => {
        try {
          return statSync(join(PROJECT_ROOT, 'packages', f)).isDirectory();
        } catch { return false; }
      }) : [];
    evidence.structure.packages = packages;
  } catch (e) {
    // Ignore
  }

  console.log(`  ${c.green}✓${c.reset} Git: ${evidence.git.branch || '?'} @ ${evidence.git.commit || '?'}`);
  console.log(`  ${c.green}✓${c.reset} Apps: ${evidence.structure.apps?.join(', ') || 'none'}`);

  return evidence;
}

// Detect conditional reviewers
function detectConditionalReviewers(reviewers, evidence) {
  const conditionalReviewers = [];

  for (const reviewer of reviewers) {
    switch (reviewer) {
      case 'native-designer':
        // Check for UI changes
        const hasUIChanges = evidence.git.changedFiles?.some(f =>
          /\.(tsx?|jsx?|css|scss)$/.test(f) || f.includes('ui') || f.includes('components')
        );
        if (hasUIChanges) conditionalReviewers.push(reviewer);
        break;

      case 'terminal-veteran':
        // Check for CLI/script changes
        const hasCLChanges = evidence.git.changedFiles?.some(f =>
          f.includes('cli') || f.includes('scripts') || f.includes('local-server')
        );
        if (hasCLChanges) conditionalReviewers.push(reviewer);
        break;

      case 'data-security':
        // Check for security-related changes
        const hasSecurityChanges = evidence.git.changedFiles?.some(f =>
          f.includes('auth') || f.includes('security') || f.includes('storage')
        );
        if (hasSecurityChanges) conditionalReviewers.push(reviewer);
        break;

      default:
        // Not conditional
        break;
    }
  }

  return conditionalReviewers;
}

// Generate reviewer prompt
function generateReviewerPrompt(reviewerName, instructions) {
  return `
## ${instructions.name} Review

请执行 ${instructions.name} 的评审。

### 评审维度
${instructions.checklist.slice(0, 10).map((item, i) => `${i + 1}. ${item}`).join('\n')}

### 你的任务
1. 读取相关代码文件
2. 检查每个评审维度
3. 给出具体评分 (每项满分 100，最后加权平均)
4. 列出发现的 blocker (P0/P1)
5. 列出改进建议 (P2/P3)

### 输出要求
在 ${REPORT_DIR}/round-{N}/${reviewerName}/ 目录下创建:
- score.md - 评分详情
- blockers.md - P0/P1 必须修复的问题
- improvement-list.md - P2/P3 改进建议

### 评分标准
- >= 90: 优秀，可以发布
- 80-89: 良好，建议改进
- 70-79: 及格，必须改进
- < 70: 不及格，需要重构

### 红线规则
如果发现任何红线，必须在 blockers.md 中明确标注为 P0。
`;
}

// Run a single reviewer (simulated - in real use, this would spawn a subagent)
async function runReviewer(reviewerName, roundDir) {
  const instructions = getReviewerInstructions(reviewerName);
  if (!instructions) {
    console.log(`  ${c.red}✗${c.reset} ${reviewerName}: definition not found`);
    return { name: reviewerName, status: 'error', error: 'Definition not found' };
  }

  console.log(`\n${c.cyan}─── ${reviewerName} ───${c.reset}`);

  // Create reviewer directory
  const reviewerDir = join(roundDir, reviewerName);
  mkdirSync(reviewerDir, { recursive: true });

  // Generate prompt
  const prompt = generateReviewerPrompt(reviewerName, instructions);

  // Write prompt to reviewer directory (for manual review)
  const promptPath = join(reviewerDir, 'prompt.md');
  writeFileSync(promptPath, prompt);

  console.log(`  ${c.green}✓${c.reset} Review prompt written to: ${promptPath}`);
  console.log(`  ${c.yellow}⚠${c.reset} Manual review required - running ${reviewerName} assessment`);

  return {
    name: reviewerName,
    status: 'pending',
    promptPath,
  };
}

// Run gate check
function runGateCheck(roundDir, profile) {
  console.log(`\n${c.cyan}═══ Gate Check ═══${c.reset}\n`);

  // Run the gate script
  try {
    const gateScript = join(SKILL_DIR, 'scripts', 'review-gate.mjs');
    if (existsSync(gateScript)) {
      execSync(`node "${gateScript}" --profile ${profile} --round ${roundDir.split('round-').pop()}`, {
        stdio: 'inherit',
        cwd: PROJECT_ROOT,
      });
    }
  } catch (e) {
    console.log(`  ${c.red}✗${c.reset} Gate check failed`);
    return false;
  }

  return true;
}

// Main
async function main() {
  console.log(`\n${c.bright}${c.cyan}═══════════════════════════════════════════════════${c.reset}`);
  console.log(`${c.bright}${c.cyan}    Release Quality Review - Orchestrator${c.reset}`);
  console.log(`${c.bright}${c.cyan}═══════════════════════════════════════════════════${c.reset}`);

  const profileConfig = PROFILES[profile] || PROFILES['release-gate'];

  // Dry run mode
  if (dryRun) {
    console.log(`\n${c.yellow}DRY RUN MODE${c.reset}`);
    console.log(`  Profile: ${profile}`);
    console.log(`  Reviewers: ${profileConfig.reviewers.join(', ')}`);
    console.log(`  Parallel: ${parallel}`);

    // Validate reviewer definitions
    console.log('\nReviewer definitions:');
    for (const name of profileConfig.reviewers) {
      const exists = existsSync(join(SKILL_DIR, 'reviewers', `${name}.md`));
      console.log(`  ${exists ? c.green + '✓' : c.red + '✗'} ${name}`);
    }

    return;
  }

  // Determine round number
  if (roundNumber === null) {
    // Find next round
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

  console.log(`\n${c.blue}ℹ${c.reset} Profile: ${profileConfig.name}`);
  console.log(`${c.blue}ℹ${c.reset} Round: ${roundNumber}`);
  console.log(`${c.blue}ℹ${c.reset} Report: ${roundDir}`);

  // Collect evidence
  const evidence = skipEvidence ? {} : collectEvidence();

  // Detect conditional reviewers
  const requiredReviewers = profileConfig.reviewers.filter(r =>
    !['native-designer', 'zero-doc-user', 'terminal-veteran', 'data-security'].includes(r)
  );
  const conditionalReviewers = profileConfig.reviewers.filter(r =>
    ['native-designer', 'zero-doc-user', 'terminal-veteran', 'data-security'].includes(r)
  );

  const triggeredConditional = detectConditionalReviewers(conditionalReviewers, evidence);
  const allReviewers = [...requiredReviewers, ...triggeredConditional];

  if (triggeredConditional.length > 0) {
    console.log(`\n${c.green}✓${c.reset} Conditional reviewers triggered: ${triggeredConditional.join(', ')}`);
  }

  // Run reviewers
  console.log(`\n${c.cyan}═══ Running Reviews ═══${c.reset}\n`);

  const results = [];
  for (const reviewer of allReviewers) {
    const result = await runReviewer(reviewer, roundDir);
    results.push(result);
  }

  // Summary
  console.log(`\n${c.cyan}═══ Summary ═══${c.reset}\n`);
  console.log(`  Reviewers: ${results.length}`);
  console.log(`  Status: ${results.filter(r => r.status === 'pending').length} pending review`);

  console.log(`\n${c.yellow}Next steps:${c.reset}`);
  console.log(`  1. Complete reviews manually or via subagents`);
  console.log(`  2. Run gate check: node review-gate.mjs --profile ${profile}`);
  console.log(`  3. If all pass, final-report.md will be generated`);

  // Write metadata
  const meta = {
    profile,
    round: roundNumber,
    reviewers: allReviewers,
    triggeredConditional,
    timestamp: new Date().toISOString(),
    evidence: {
      git: evidence.git,
      structure: evidence.structure,
    },
  };
  writeFileSync(join(roundDir, 'metadata.json'), JSON.stringify(meta, null, 2));

  console.log(`\n${c.green}✓${c.reset} Metadata written to: ${join(roundDir, 'metadata.json')}`);
}

main().catch(err => {
  console.error(`\n${c.red}Error:${c.reset}`, err.message);
  process.exit(1);
});
