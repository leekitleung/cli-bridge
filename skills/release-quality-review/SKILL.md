# Release Quality Review Skill

跨 Agent 工具的质量评审框架，基于 4 个常驻 Reviewer + 条件触发 Reviewer 的设计。

## 快速开始

```bash
# 1. 运行完整评审 (推荐)
node skills/release-quality-review/scripts/review-runner.mjs --profile release-gate

# 2. 查看结果
cat quality-reports/round-001/summary.md

# 3. 修复问题后继续评审
node skills/release-quality-review/scripts/review-runner.mjs --profile release-gate --round 2
```

## 工作流程

```
┌─────────────────────────────────────────────────────────────────────┐
│                        评审工作流                                    │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   ┌──────────────┐    ┌──────────────┐    ┌──────────────┐         │
│   │  1. 收集证据  │ -> │  2. 选择Profile │ -> │  3. 启动Reviewer │     │
│   └──────────────┘    └──────────────┘    └──────────────┘         │
│         │                                       │                    │
│         v                                       v                    │
│   ┌──────────────┐                      ┌──────────────┐            │
│   │ git diff     │                      │ 并行执行评审  │            │
│   │ 截图/日志    │                      │ 产出评分文件  │            │
│   │ 测试结果     │                      │              │            │
│   └──────────────┘                      └──────────────┘            │
│                                               │                      │
│                                               v                      │
│   ┌──────────────────────────────────────────────────────────┐      │
│   │                    4. 门禁检查                            │      │
│   │                                                          │      │
│   │   所有 Reviewer >= 90?  ───── NO ──>  修复问题 ──┐       │      │
│   │        │                                  │      │       │      │
│   │       YES                                 │      │       │      │
│   │        │                                  └──────┘       │      │
│   │        v                                          ^      │      │
│   │   存在红线?                                        │      │      │
│   │        │                                          │      │      │
│   │       NO                                         │      │      │
│   │        v                                          │      │      │
│   │   ┌────────────────┐                              │      │      │
│   │   │  5. 生成报告   │ ─────────────────────────────┘      │      │
│   │   └────────────────┘                                    │      │
│   └──────────────────────────────────────────────────────────┘      │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
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

| Reviewer | 触发条件 | 检查什么 |
|----------|----------|----------|
| 原生审美设计师 | 有 UI、截图、视觉交付 | 视觉层级、间距、色彩、状态反馈 |
| 零文档新用户 | 面向新用户、开箱即用 | 首次使用链路、引导清晰度 |
| 终端十年老兵 | 有 CLI、本地服务 | 错误处理、日志、边界健壮性 |
| 数据安全审查官 | 有 token、用户数据 | 数据加密、传输安全、隐私合规 |

## Profile 配置

### quick (快速评审)
- 适用: 开发中快速检查
- Reviewers: product-flow, architecture-maintainer
- 运行时间: ~5 分钟

### default (默认评审)
- 适用: PR 合并前
- Reviewers: product-flow, destructive-qa, terminal-veteran
- 运行时间: ~15 分钟

### release-gate (发布门禁) ⭐推荐
- 适用: 发布前必须通过
- Reviewers: product-flow, architecture-maintainer, release-verifier, destructive-qa, terminal-veteran
- 运行时间: ~30 分钟

### full (完整评审)
- 适用: 重大版本发布
- Reviewers: 所有 8 个 Reviewer
- 运行时间: ~60 分钟

## 评分标准

| 档位 | 分数 | 含义 | 行动 |
|------|------|------|------|
| A | 90-100 | 优秀 | 可以发布 |
| B | 80-89 | 良好 | 建议改进 |
| C | 70-79 | 及格 | 必须改进 |
| D | 60-69 | 不及格 | 需要重构 |
| F | <60 | 不可接受 | 打回重做 |

### 通过条件
1. **所有 Reviewer >= 90/100**
2. **无 P0 红线**
3. **有实际证据支撑评分**

## 触发方式

```bash
# 完整评审 (所有常驻 + 按类型触发)
node skills/release-quality-review/scripts/review-runner.mjs --profile release-gate

# 快速评审 (只常驻 Reviewers)
node skills/release-quality-review/scripts/review-gate.mjs --profile quick

# 单维度评审
node skills/release-quality-review/scripts/review-gate.mjs --reviewer destructive-qa

# 只检查红线
node skills/release-quality-review/scripts/review-gate.mjs --check-redlines

# 继续上轮评审
node skills/release-quality-review/scripts/review-runner.mjs --profile release-gate --round 2

# 干跑模式 (不修改文件)
node skills/release-quality-review/scripts/review-runner.mjs --dry-run
```

## 输出格式

```
quality-reports/
├── round-001/
│   ├── summary.md              # 本轮汇总
│   ├── product-flow/
│   │   ├── score.md            # 评分详情
│   │   ├── blockers.md         # P0/P1 必须修复
│   │   └── improvement-list.md # P2/P3 建议改进
│   ├── architecture-maintainer/
│   │   └── ...
│   └── ...
├── round-002/
│   └── ...
└── final-report.md             # 所有 >= 90 且无红线时生成
```

## Claude Code 集成

在 Claude Code 中使用：

```
/review --profile release-gate
```

或直接在对话中：

```
请运行 release-quality-review skill，profile 为 release-gate，直到所有 Reviewer >= 90 且无红线。
```

## Codex 集成

在 Codex 中使用：

```
请读取 AGENTS.md 中的 release-quality-review 规则，
然后运行 node skills/release-quality-review/scripts/review-runner.mjs --profile release-gate
```

## 目录结构

```
skills/release-quality-review/
├── SKILL.md                           # 本文件
├── review-config.yaml                 # 项目级评审配置
├── profiles/
│   ├── default.yaml                   # 默认 profile
│   └── release-gate.yaml              # 发布门禁 profile
├── reviewers/
│   ├── TEMPLATE.md                    # Reviewer 模板
│   ├── product-flow.md                # 产品闭环审查官
│   ├── architecture-maintainer.md     # 工程架构审查官
│   ├── release-verifier.md            # 验收发布审查官
│   ├── destructive-qa.md              # 破坏性质量官
│   ├── native-designer.md             # 原生审美设计师
│   ├── zero-doc-user.md               # 零文档新用户
│   ├── terminal-veteran.md            # 终端十年老兵
│   └── data-security.md               # 数据安全审查官
├── rubrics/
│   ├── scoring.md                     # 评分标准
│   ├── redlines.md                    # 红线规则
│   └── evidence.md                    # 证据收集指南
├── scripts/
│   ├── review-gate.mjs                # 门禁脚本
│   └── review-runner.mjs              # 编排器
└── templates/
    └── result.yaml                    # 结构化结果模板
```

## 添加新 Reviewer

1. 复制 `reviewers/TEMPLATE.md` 为新 reviewer 名称
2. 定义评审维度和权重
3. 定义红线规则
4. 添加到 `profiles/*.yaml` 的 `required_reviewers` 或 `conditional_reviewers`

## 常见问题

**Q: 某个 Reviewer 一直不通过怎么办？**
A: 检查该 Reviewer 的 blockers.md，优先修复 P0/P1 问题。每轮只聚焦 2-3 个最高优先级问题。

**Q: 可以跳过某些 Reviewer 吗？**
A: 可以用 `--exclude-reviewer` 排除，但强烈不推荐。发布前必须通过 release-gate profile。

**Q: 评分有争议怎么办？**
A: 以实际证据为准。要求 Reviewer 引用具体代码/截图/测试结果。争议点记录到 improvement-list.md。

## 参考资源

- Superpowers 框架: https://github.com/obra/superpowers
- Claude Code Code Review 插件: https://pluginmarketplace.ai/plugin/code-review
- PR-Agent: https://github.com/The-PR-Agent/pr-agent
