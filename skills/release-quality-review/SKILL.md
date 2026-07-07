# Release Quality Review Skill

跨 Agent 工具的质量评审框架，基于 4 个常驻 Reviewer + 条件触发 Reviewer 的设计。

## 目录结构

```
skills/release-quality-review/
├── SKILL.md                           # 本文件 - 工作流入口
├── reviewers/
│   ├── product-flow.md                 # 产品闭环审查官 (常驻)
│   ├── architecture-maintainer.md       # 工程架构审查官 (常驻)
│   ├── release-verifier.md             # 验收发布审查官 (常驻)
│   ├── destructive-qa.md                # 破坏性质量官 (常驻)
│   ├── native-designer.md              # 原生审美设计师 (UI 触发)
│   ├── zero-doc-user.md                # 零文档新用户 (首次使用触发)
│   ├── terminal-veteran.md             # 终端十年老兵 (CLI 触发)
│   └── data-security.md                # 数据安全审查官 (数据触发)
├── rubrics/
│   ├── scoring.md                      # 评分标准
│   ├── redlines.md                    # 红线规则
│   └── evidence.md                    # 证据收集指南
└── scripts/
    └── review-gate.mjs                # 确定性验收门禁
```

## 评审维度定义

### 常驻 Reviewers (每次评审必运行)

| Reviewer | 职责 | 核心问题 |
|----------|------|----------|
| 产品闭环审查官 | 功能完成度、用户路径闭环 | "这个功能真的做完了吗？用户能用它完成任务吗？" |
| 工程架构审查官 | 模块职责、边界、可维护性、SRP/OCP | "代码结构会腐化吗？改一处会破坏多处吗？" |
| 验收发布审查官 | 测试覆盖、构建验证、发布证据 | "有测试吗？构建能过吗？能安全发布吗？" |
| 破坏性质量官 | 安全、异常路径、权限、边界破坏 | "能被人玩坏吗？有哪些攻击面？" |

### 条件触发 Reviewers (按需启用)

| Reviewer | 触发条件 |
|----------|----------|
| 原生审美设计师 | 有 UI、截图、视觉交付、宣传页、插件面板 |
| 零文档新用户 | 面向新用户、开箱即用、复杂配置 |
| 终端十年老兵 | 有 CLI、本地服务、脚本、安装命令 |
| 数据安全审查官 | 有 token、localStorage、API key、用户数据、云端同步 |

## 评分标准

- **目标分数**: 每项 >= 90/100
- **红线规则**: 存在任何红线则打回，不允许合并
- **每轮评审**: 最多 5-7 个 Reviewer
- **后续轮次**: 只复查失败者 + 相关者 + 破坏性质量官 sanity check

## 触发方式

```bash
# 完整评审 (所有常驻 + 按类型触发)
node skills/release-quality-review/scripts/review-gate.mjs --profile release-gate

# 快速评审 (只常驻 Reviewers)
node skills/release-quality-review/scripts/review-gate.mjs --profile quick

# 单维度评审
node skills/release-quality-review/scripts/review-gate.mjs --reviewer destructive-qa
```

## 输出格式

评审结果写入 `quality-reports/round-{N}/` 目录：

```
quality-reports/
├── round-1/
│   ├── product-flow/score.md
│   ├── product-flow/blockers.md
│   ├── architecture-maintainer/score.md
│   └── summary.md
├── round-2/
│   └── ...
└── final-report.md           # 所有 Reviewer >= 90 且无红线时生成
```

## Reviewer 输出模板

每个 Reviewer 输出三个文件：

1. `score.md` - 评分 + 分项得分
2. `blockers.md` - 必须修复的问题 (P0/P1)
3. `improvement-list.md` - 建议改进 (P2/P3)

## 跨工具适配

本 Skill 兼容 Claude Code 和 Codex：

- Claude Code: 使用 `.claude/agents/` 下的 subagent 定义
- Codex: 读取 `AGENTS.md` 并显式 spawn subagents

详见 `rubrics/evidence.md`。
