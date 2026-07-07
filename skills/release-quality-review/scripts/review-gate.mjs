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
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// Use process.cwd() as the reliable project root
const PROJECT_ROOT = process.cwd();
const SKILL_DIR = join(PROJECT_ROOT, 'skills', 'release-quality-review');
const REPORT_DIR = join(PROJECT_ROOT, 'quality-reports');

// Parse arguments
const args = process.argv.slice(2);
let profile = 'release-gate';
let singleReviewer = null;
let checkRedlinesOnly = false;
let roundNumber = 1;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--profile' && args[i + 1]) {
    profile = args[i + 1];
    i++;
  } else if (args[i] === '--reviewer' && args[i + 1]) {
    singleReviewer = args[i + 1];
    i++;
  } else if (args[i] === '--check-redlines') {
    checkRedlinesOnly = true;
  } else if (args[i] === '--round' && args[i + 1]) {
    roundNumber = parseInt(args[i + 1], 10);
    i++;
  }
}

// Reviewer profiles
const PROFILES = {
  'quick': {
    name: 'Quick Review',
    reviewers: ['product-flow', 'architecture-maintainer'],
    description: 'Minimal resident reviewers only'
  },
  'release-gate': {
    name: 'Release Gate Review',
    reviewers: [
      'product-flow',
      'architecture-maintainer',
      'release-verifier',
      'destructive-qa',
      'terminal-veteran'
    ],
    description: 'Full release gate with resident + CLI reviewers'
  },
  'full': {
    name: 'Full Review',
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
    description: 'All reviewers including conditional triggers'
  }
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
  const match = scoreContent.match(/(?:总分|Overall Score|Total Score)[:\s]*(\d+)\/100/i);
  if (match) {
    return parseInt(match[1], 10);
  }
  // Try alternative patterns
  const altMatch = scoreContent.match(/^#+\s+.*?(\d+)\/100$/m);
  if (altMatch) {
    return parseInt(altMatch[1], 10);
  }
  return null;
}

// Parse blockers from review report
function parseBlockers(blockerContent) {
  const lines = blockerContent.split('\n');
  const blockers = [];
  for (const line of lines) {
    if (line.includes('P0') || line.includes('P1') || line.includes('❌') || line.includes('红')) {
      blockers.push(line.trim());
    }
  }
  return blockers;
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
    const scorePath = join(roundDir, reviewer, 'score.md');
    const blockerPath = join(roundDir, reviewer, 'blockers.md');

    if (existsSync(scorePath)) {
      const content = readFileSync(scorePath, 'utf-8');
      results[reviewer] = {
        score: parseScore(content),
        hasReport: true
      };
    } else if (existsSync(blockerPath)) {
      results[reviewer] = {
        score: null,
        hasReport: true
      };
    } else {
      results[reviewer] = {
        score: null,
        hasReport: false
      };
    }
  }
  return results;
}

// Generate summary report
function generateSummary(roundDir, profile, scores, allPassed) {
  const reportPath = join(roundDir, 'summary.md');
  const timestamp = new Date().toISOString();

  let content = `# Quality Review Summary - Round ${roundNumber}\n\n`;
  content += `**Profile:** ${profile}\n`;
  content += `**Generated:** ${timestamp}\n\n`;
  content += `---\n\n`;

  // Score table
  content += `## Scores\n\n`;
  content += `| Reviewer | Score | Status |\n`;
  content += `|----------|-------|--------|\n`;

  let totalPassed = 0;
  let totalReviewed = 0;

  for (const [reviewer, result] of Object.entries(scores)) {
    totalReviewed++;
    if (result.score !== null) {
      const status = result.score >= 90 ? '✅ PASS' : '❌ FAIL';
      content += `| ${reviewer} | ${result.score}/100 | ${status} |\n`;
      if (result.score >= 90) totalPassed++;
    } else {
      content += `| ${reviewer} | N/A | ⏳ PENDING |\n`;
    }
  }

  content += `\n`;
  content += `**Total:** ${totalPassed}/${totalReviewed} passed\n\n`;

  // Overall status
  content += `---\n\n`;
  if (allPassed) {
    content += `## ✅ ALL REVIEWERS PASSED\n\n`;
    content += `This release has passed all quality gates. It is ready to ship.\n`;
  } else {
    content += `## ❌ QUALITY GATE FAILED\n\n`;
    content += `This release has not passed quality gates. Fix the issues below and re-run review.\n\n`;
    content += `**To continue:**\n`;
    content += `\`\`\`bash\n`;
    content += `node skills/release-quality-review/scripts/review-gate.mjs --profile ${profile} --round ${roundNumber + 1}\n`;
    content += `\`\`\`\n`;
  }

  writeFileSync(reportPath, content);
  console.log(`\n📄 Summary written to: ${reportPath}`);
  return allPassed;
}

// Generate final report when all gates pass
function generateFinalReport(scores) {
  const reportPath = join(REPORT_DIR, 'final-report.md');
  const timestamp = new Date().toISOString();

  let content = `# 🎉 RELEASE APPROVED\n\n`;
  content += `**Date:** ${timestamp}\n`;
  content += `**Status:** APPROVED FOR RELEASE\n\n`;
  content += `---\n\n`;
  content += `## Final Scores\n\n`;
  content += `| Reviewer | Score | Gate |\n`;
  content += `|----------|-------|------|\n`;

  for (const [reviewer, result] of Object.entries(scores)) {
    content += `| ${reviewer} | ${result.score}/100 | ✅ |\n`;
  }

  content += `\n---\n\n`;
  content += `## Release Checklist\n\n`;
  content += `- [ ] All reviewers >= 90/100\n`;
  content += `- [ ] No redlines\n`;
  content += `- [ ] Tests passing\n`;
  content += `- [ ] Build successful\n`;
  content += `- [ ] Changelog updated\n`;
  content += `- [ ] Version bumped\n\n`;
  content += `---\n\n`;
  content += `*Generated by Release Quality Review Skill*\n`;

  writeFileSync(reportPath, content);
  console.log(`\n🎉 FINAL REPORT: ${reportPath}`);
}

// Main gate check
async function runGate() {
  console.log('═══════════════════════════════════════════════════');
  console.log('         RELEASE QUALITY GATE');
  console.log('═══════════════════════════════════════════════════\n');

  // Determine reviewers to run
  let reviewers = [];
  if (singleReviewer) {
    reviewers = [singleReviewer];
  } else {
    const profileConfig = PROFILES[profile] || PROFILES['release-gate'];
    reviewers = profileConfig.reviewers;
  }

  console.log(`📋 Profile: ${profile}`);
  console.log(`👥 Reviewers: ${reviewers.join(', ')}\n`);

  // Determine round directory
  let roundDir = join(REPORT_DIR, `round-${String(roundNumber).padStart(3, '0')}`);

  // Check if this is a new round or continuing
  const isNewRound = !existsSync(roundDir);
  if (isNewRound) {
    mkdirSync(roundDir, { recursive: true });
    console.log(`🆕 Starting new round: ${roundDir}\n`);
  } else {
    console.log(`📂 Continuing round: ${roundDir}\n`);
  }

  // Check for existing scores
  const existingScores = loadExistingScores(roundDir, reviewers);
  const pendingReviewers = reviewers.filter(r => !existingScores[r].hasReport);

  if (pendingReviewers.length > 0) {
    console.log('⏳ Pending reviews:\n');
    for (const reviewer of pendingReviewers) {
      console.log(`  - ${reviewer}`);
    }
    console.log('\n📝 To complete this review:\n');
    console.log('   Read the reviewer definition and run the review:\n');
    for (const reviewer of pendingReviewers) {
      const reviewerContent = loadReviewer(reviewer);
      if (reviewerContent) {
        // Create reviewer directory
        const reviewerDir = join(roundDir, reviewer);
        mkdirSync(reviewerDir, { recursive: true });

        // Extract first section for instructions
        console.log(`\n   === ${reviewer} ===`);
        console.log(`   node review-gate.mjs --reviewer ${reviewer}`);
      }
    }
  }

  // Check completed reviews
  const completedReviewers = reviewers.filter(r => existingScores[r].hasReport && existingScores[r].score !== null);
  if (completedReviewers.length > 0) {
    console.log('\n✅ Completed reviews:\n');
    for (const reviewer of completedReviewers) {
      const score = existingScores[reviewer].score;
      const status = score >= 90 ? '✅' : '❌';
      console.log(`   ${status} ${reviewer}: ${score}/100`);
    }
  }

  // Calculate overall status
  const allHaveScores = reviewers.every(r => existingScores[r].score !== null);
  const allPassed = allHaveScores && reviewers.every(r => existingScores[r].score >= 90);

  console.log('\n═══════════════════════════════════════════════════');

  if (allHaveScores) {
    return generateSummary(roundDir, profile, existingScores, allPassed);
  } else {
    console.log('⏳ Review incomplete. Run the pending reviewers and re-run this gate.\n');
    console.log(`📌 To mark this round complete, ensure all reviewers have scores in:`);
    console.log(`   ${roundDir}/<reviewer>/score.md\n`);
    return false;
  }
}

// Run the gate
runGate().then(passed => {
  process.exit(passed ? 0 : 1);
}).catch(err => {
  console.error('❌ Gate error:', err.message);
  process.exit(1);
});
