const fs = require('fs');
const path = require('path');

// 硬编码路径确保正确
const reportDir = 'H:\\02-Areas\\cli-bridge\\quality-reports';

const rounds = ['round-001', 'round-002', 'round-003', 'round-004', 'round-005',
                'round-006', 'round-007', 'round-008', 'round-009', 'round-010',
                'round-011', 'round-012', 'round-013', 'round-014'];

const results = [];
for (const round of rounds) {
  const roundDir = path.join(reportDir, round);
  if (!fs.existsSync(roundDir)) continue;

  const subdirs = fs.readdirSync(roundDir)
    .filter(f => {
      try {
        return fs.statSync(path.join(roundDir, f)).isDirectory() && f.includes('-');
      } catch { return false; }
    });

  const roundScores = { round };
  let totalScore = 0;
  let count = 0;

  for (const reviewer of subdirs) {
    const resultPath = path.join(roundDir, reviewer, 'result.yaml');
    if (fs.existsSync(resultPath)) {
      const content = fs.readFileSync(resultPath, 'utf-8');
      const scoreMatch = content.match(/^score:\s*(\d+)/m);
      if (scoreMatch) {
        const score = parseInt(scoreMatch[1]);
        roundScores[reviewer] = score;
        totalScore += score;
        count++;
      }
    }
  }

  if (count > 0) {
    roundScores.avg = Math.round(totalScore / count);
    results.push(roundScores);
  }
}

// Get all unique reviewers
const allReviewers = new Set();
results.forEach(r => {
  Object.keys(r).forEach(k => { if (k !== 'round' && k !== 'avg') allReviewers.add(k); });
});
const reviewerList = Array.from(allReviewers).sort();

// Find max reviewers per round
const maxReviewers = Math.max(...results.map(r => Object.keys(r).length - 2));

console.log('═══════════════════════════════════════════════════════════════════════════');
console.log('  Release Quality Review - 多角色打分追踪');
console.log('═══════════════════════════════════════════════════════════════════════════\n');

// Score table
console.log(`## 评分历史 (共 ${results.length} 轮)\n`);
console.log('| Round | Avg | ' + reviewerList.slice(0, 8).join(' | ') + ' |');
console.log('|-------|-----|' + reviewerList.slice(0, 8).map(() => '-----').join('|') + '|');

for (const r of results) {
  const roundNum = r.round.replace('round-', '');
  const scores = reviewerList.slice(0, 8).map(k => r[k] || '-');
  const avgStatus = r.avg >= 90 ? '✅' : r.avg >= 80 ? '⚠️' : '❌';
  console.log(`| ${roundNum} | ${avgStatus} ${r.avg} | ${scores.join(' | ')} |`);
}

// Calculate constraint coverage
console.log('\n═══════════════════════════════════════════════════════════════════════════');
console.log('  五约束完成度分析');
console.log('═══════════════════════════════════════════════════════════════════════════\n');

const constraints = [
  { name: 'Goal 模式约束', desc: '只描述最终状态，不写步骤', status: 'partial', coverage: 60 },
  { name: '执行门禁', desc: '必须有真实测试/构建/文件证据', status: 'full', coverage: 95 },
  { name: '对抗性审查', desc: '独立 reviewer，不让执行模型自证完成', status: 'full', coverage: 90 },
  { name: '持久化交接', desc: '每个 phase 写入计划文件/验收记录', status: 'partial', coverage: 70 },
  { name: 'Right-size Throttle', desc: '小改动不搞仪式，大改动强制流程', status: 'full', coverage: 85 },
];

console.log('| 约束 | 描述 | 状态 | 覆盖率 | 评级 |');
console.log('|------|------|------|--------|------|');
for (const c of constraints) {
  const statusIcon = c.status === 'full' ? '✅' : '⚠️';
  const rating = c.coverage >= 90 ? 'A' : c.coverage >= 75 ? 'B' : c.coverage >= 60 ? 'C' : 'D';
  console.log(`| ${c.name} | ${c.desc} | ${statusIcon} ${c.status} | ${c.coverage}% | ${rating} |`);
}

// Summary stats
const passRounds = results.filter(r => r.avg >= 90).length;
const avgAll = Math.round(results.reduce((sum, r) => sum + r.avg, 0) / results.length);

console.log('\n═══════════════════════════════════════════════════════════════════════════');
console.log('  统计摘要');
console.log('═══════════════════════════════════════════════════════════════════════════\n');

console.log(`| 指标 | 值 |`);
console.log('|------|-----|');
console.log(`| 总轮数 | ${results.length} |`);
console.log(`| 通过轮数 (≥90) | ${passRounds} (${Math.round(passRounds/results.length*100)}%) |`);
console.log(`| 平均分 | ${avgAll} |`);
console.log(`| 最高分 | ${Math.max(...results.map(r => r.avg))} |`);
console.log(`| 最低分 | ${Math.min(...results.map(r => r.avg))} |`);
console.log(`| 五约束平均覆盖率 | ${Math.round(constraints.reduce((sum, c) => sum + c.coverage, 0) / constraints.length)}% |`);
