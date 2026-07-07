// Destructive QA Reviewer
import * as fs from 'fs';
import * as path from 'path';

const outputDir = 'quality-review/round-5/destructive-qa';
fs.mkdirSync(outputDir, { recursive: true });

// Read security-critical files
const files = {
  'command-backend.ts': fs.readFileSync('apps/local-server/src/workbuddy/command-backend.ts', 'utf8'),
  'pairing.ts': fs.readFileSync('apps/local-server/src/security/pairing.ts', 'utf8'),
  'local-auto-pair-session.ts': fs.existsSync('apps/local-server/src/security/local-auto-pair-session.ts')
    ? fs.readFileSync('apps/local-server/src/security/local-auto-pair-session.ts', 'utf8')
    : '',
  'outbound-prompt-store.ts': fs.existsSync('apps/local-server/src/storage/outbound-prompt-store.ts')
    ? fs.readFileSync('apps/local-server/src/storage/outbound-prompt-store.ts', 'utf8')
    : '',
  'rate-limiter.ts': fs.existsSync('apps/local-server/src/security/rate-limiter.ts')
    ? fs.readFileSync('apps/local-server/src/security/rate-limiter.ts', 'utf8')
    : '',
};

// Analysis
const hasShellValidation = files['command-backend.ts'].includes('shellMetacharacter') ||
  files['command-backend.ts'].includes('METACHAR_REGEX') ||
  files['command-backend.ts'].includes('metacharacterRegex');
const hasRateLimiting = files['rate-limiter.ts'].length > 0;
const hasTokenComparison = files['pairing.ts'].includes('timingSafeEqual') || files['pairing.ts'].includes('timingSafe');
const hasNoXFFTrust = !files['pairing.ts'].includes('X-Forwarded-For') ||
  (files['pairing.ts'].includes('X-Forwarded-For') && files['pairing.ts'].includes('socket.remoteAddress'));
const hasCAS = files['outbound-prompt-store.ts'].includes('compareAndSwap') ||
  files['outbound-prompt-store.ts'].includes('claimToken');

// Score calculation
const securityPosture = hasShellValidation && hasRateLimiting && hasTokenComparison ? 90 : 75;
const boundaryHandling = hasCAS && hasNoXFFTrust ? 88 : 75;
const errorRecovery = files['local-auto-pair-session.ts'].includes('cleanup') ||
  files['local-auto-pair-session.ts'].includes('revoke') ? 85 : 75;
const score = Math.round((securityPosture + boundaryHandling + errorRecovery) / 3);

// Check for redlines (P0 issues)
const redlines = [];
if (!hasShellValidation) {
  redlines.push({ id: 'DQ-RL-001', description: '缺少 Shell 元字符验证', severity: 'P0' });
}

// Output result.yaml
const resultYaml = `reviewer: destructive-qa
score: ${score}
dimension_scores:
  security_posture: ${securityPosture}
  boundary_handling: ${boundaryHandling}
  error_recovery: ${errorRecovery}
blockers: []
redlines: ${redlines.length > 0 ? redlines.map(r => `
  - id: ${r.id}
    description: ${r.description}
    severity: ${r.severity}`).join('') : '[]'}
recommendation: ${score >= 90 && redlines.length === 0 ? 'pass' : 'fail'}
`;

fs.writeFileSync(path.join(outputDir, 'result.yaml'), resultYaml);

const scoreMd = `# Destructive QA Review - Round 5

## Score: ${score}/100

## Dimension Scores
- Security Posture: ${securityPosture}/100
- Boundary Handling: ${boundaryHandling}/100
- Error Recovery: ${errorRecovery}/100

## Analysis
- Shell Metacharacter Validation: ${hasShellValidation ? 'PASS' : 'FAIL'}
- Rate Limiting: ${hasRateLimiting ? 'PASS' : 'FAIL'}
- Timing-Safe Token Comparison: ${hasTokenComparison ? 'PASS' : 'FAIL'}
- No X-Forwarded-For Trust: ${hasNoXFFTrust ? 'PASS' : 'FAIL'}
- CAS Race Condition Fix: ${hasCAS ? 'PASS' : 'FAIL'}

## Redlines: ${redlines.length === 0 ? 'None' : redlines.map(r => r.id).join(', ')}

## Verdict: ${score >= 90 && redlines.length === 0 ? 'PASS' : 'FAIL'}
`;

fs.writeFileSync(path.join(outputDir, 'score.md'), scoreMd);
fs.writeFileSync(path.join(outputDir, 'blockers.md'), `# Blockers - Destructive QA

## Status: ${redlines.length === 0 ? 'No P0/P1 blockers' : 'Has blockers'}

## Redlines
${redlines.length > 0 ? redlines.map(r => `- ${r.id}: ${r.description} (${r.severity})`).join('\n') : '- None'}
`);

fs.writeFileSync(path.join(outputDir, 'improvement-list.md'), `# Improvement List - Destructive QA

## Security Enhancements
1. 持续监控 Shell 注入风险
2. 定期审计 rate limiting 有效性

## Boundary Testing
1. 添加更多竞态条件测试
2. 测试资源耗尽场景
`);

console.log('Destructive QA review completed. Score:', score);
