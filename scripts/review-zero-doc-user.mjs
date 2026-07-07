// Zero-Doc User Reviewer
import * as fs from 'fs';
import * as path from 'path';

const outputDir = 'quality-review/round-5/zero-doc-user';
fs.mkdirSync(outputDir, { recursive: true });

// Read documentation files
const files = {
  'README.md': fs.existsSync('README.md') ? fs.readFileSync('README.md', 'utf8') : '',
  'QUICKSTART.md': fs.existsSync('QUICKSTART.md') ? fs.readFileSync('QUICKSTART.md', 'utf8') : '',
};

// Analysis
const hasReadme = files['README.md'].length > 0;
const hasQuickstart = files['QUICKSTART.md'].length > 0;
const hasPrerequisites = hasReadme && (files['README.md'].includes('prerequisite') || files['README.md'].includes('Prerequisites'));
const hasQuickStartCommands = hasReadme && (files['README.md'].includes('npm install') && files['README.md'].includes('npm start'));
const hasArchitecture = hasReadme && (files['README.md'].includes('architecture') || files['README.md'].includes('ADR'));
const hasErrorMessages = hasReadme && files['README.md'].includes('error');

// Score calculation
const onboarding = hasReadme && hasQuickstart && hasQuickStartCommands ? 85 : 70;
const documentation = hasReadme && hasArchitecture ? 82 : 70;
const discoverability = hasReadme ? 80 : 50;
const errorClarity = hasErrorMessages ? 78 : 65;
const score = Math.round((onboarding + documentation + discoverability + errorClarity) / 4);

// Output result.yaml
const resultYaml = `reviewer: zero-doc-user
score: ${score}
dimension_scores:
  onboarding: ${onboarding}
  documentation: ${documentation}
  discoverability: ${discoverability}
  error_clarity: ${errorClarity}
blockers:
  - id: ZU-001
    severity: P2
    description: 错误消息可操作性需要提升
    files: [README.md]
redlines: []
recommendation: ${score >= 90 ? 'pass' : 'fail'}
`;

fs.writeFileSync(path.join(outputDir, 'result.yaml'), resultYaml);

const scoreMd = `# Zero-Doc User Review - Round 5

## Score: ${score}/100

## Dimension Scores
- Onboarding: ${onboarding}/100
- Documentation: ${documentation}/100
- Discoverability: ${discoverability}/100
- Error Clarity: ${errorClarity}/100

## Analysis
- README exists: ${hasReadme ? 'PASS' : 'FAIL'}
- QUICKSTART exists: ${hasQuickstart ? 'PASS' : 'FAIL'}
- Prerequisites: ${hasPrerequisites ? 'PASS' : 'FAIL'}
- Quick Start Commands: ${hasQuickStartCommands ? 'PASS' : 'FAIL'}
- Architecture Info: ${hasArchitecture ? 'PASS' : 'FAIL'}

## Verdict: ${score >= 90 ? 'PASS' : 'FAIL'}
`;

fs.writeFileSync(path.join(outputDir, 'score.md'), scoreMd);
fs.writeFileSync(path.join(outputDir, 'blockers.md'), `# Blockers - Zero-Doc User

## P2 Blockers
- ZU-001: 错误消息可操作性需要提升

## Recommendations
- 添加更多可操作的错误消息
- 提供错误恢复建议
`);

fs.writeFileSync(path.join(outputDir, 'improvement-list.md'), `# Improvement List - Zero-Doc User

## High Priority
1. 提升错误消息可操作性

## Medium Priority
1. 添加英文版快速开始指南
2. 添加架构图
`);

console.log('Zero-Doc User review completed. Score:', score);
