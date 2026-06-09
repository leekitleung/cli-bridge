# Plan: 目标驱动的动态工作流 + 分层编排引擎（构想）

## 0. 状态

Status: PLAN（构想记录，非活跃切片）。

本文件把先前"安全中继"的目标抬升为"分层编排引擎"：给一个 goal，由高等级模型动态
分解为计划，再由编排器把计划步骤派发给合适等级的执行端点完成。它与
`PLAN-LAYERED-ORCHESTRATION-AND-CONSOLE.md` 互补：那份定义分层与控制台视图，本份
定义 goal → plan → step 的执行引擎。

后续 AgentTeam、单 provider 多槽位、WorkBuddy/qclaw/openclaw/hermes 执行端点、
中间层模型 API、harness、memory、项目级控制台等扩展，必须同时参考
`PLAN-AGENTTEAM-PROJECT-CONTROL-PLANE.md`。该规划的原始讨论记录保存在
`CLI-BRIDGE-v2.1-AGENTTEAM-DISCUSSION-RAW.md`，两者均为 lint 必检 canonical/context
文档，后续开发不得遗漏。

当前活跃推进不变：安全地基（已完成）-> 轨道 A（command transport review-only）。
web-dom 自动发送/提取（曾称"轨道 B"）已由 ADR-0002 标记为 superseded/deferred，除非
后续 ADR 重新批准，否则不作为活跃路线。本引擎在轨道 A 机制验证后才考虑转为实现切片。

## 1. 能力目标

实现类似 Claude Code 的 dynamic workflow / goal 能力，但有一个根本区别：

- 规划由上层（高等级模型）完成；
- **执行不由规划者自己做**，而是派发给执行层（低等级模型 / WorkBuddy / CLI 等）；
- 目的：token 与上下文经济性 —— 让昂贵的脑子只做少量高价值的"想"，把大量重复的
  "做"压到便宜模型上。

## 2. 双轴模型：tier（等级） × role（能力）

关键架构原则：**等级和角色是两条相关但独立的轴，不得焊成一根。**

- `tier`：模型等级 / 成本（如 `high` / `low`，可扩展为具体模型标识）。
- `capabilities`：能做什么（`canReview` / `canExecute` / `canAcceptPrompt` / ...，已
  存在于 EndpointRegistry）。

默认策略：

```text
高 tier  -> 规划 / 评审（canReview，canExecute=false 默认）
低 tier  -> 执行（canExecute=true）
```

但必须保留升级逃生口：

- 某执行步骤低 tier 做不动时，编排器可**临时把该步升级给高 tier 执行**。
- 因此"执行层 = 低等级"只是**默认路由策略**，不是**架构硬约束**。一个弱模型反复失败
  重试的 token，常常超过让强模型一次做对的成本；丢掉升级杠杆会更贵也更慢。

落地方式：

- 每个注册 endpoint 同时声明 `tier` 与 `capabilities`。
- 一个**编排路由策略**把每个计划步骤映射到"能做这步的最便宜 tier"，失败时按策略升级。
- token 经济性成为**默认行为**，而非不可逾越的约束。

### 2.1 额外的上下文经济性

- 上层持有完整 goal 与大上下文；
- 执行层每步只接收**被裁剪过的该步上下文**；
- 因此执行调用不仅单价便宜，**单次还更小** —— 双重节省 token。

## 3. 安全模型：人类闸门上移到计划层（已决策）

dynamic workflow 的"目标自动分解 -> 自动派发执行"在机制上**就是**先前禁止的
automatic agent loop。调和方式不是放弃安全，而是把人类确认门**从每一步上移到计划
层**。

项目负责人已决策采用 **方案 A + 状态变更步骤强制单独 gate**：

```text
用户给 goal
  -> 上层（高 tier）分解出 Plan（PlanStep 列表）
  -> ✋ 用户审批 "goal + plan"（唯一强制的计划级人类闸门）
  -> 编排器在已批准计划内自动执行步骤，带：
       - 步数上限（硬上限）
       - 随时中断
       - 每步审计
  -> 高风险步骤（写文件 / commit / push / 删除 / 其它状态变更）即使在已批准计划内，
     也必须进入 blocked-needs-gate 并单独确认。用户预批的 scope 只用于判定"是否允许
     该步请求 gate"，绝不替代 gate 本身。
  -> 步骤失败时上层可 re-plan；若 re-plan 超出原 goal 范围 -> 重新触发计划级审批
```

边界总结：

- **无界自动 loop：仍禁止。**
- **有界、在已批准计划内的自动执行：这是本引擎新解锁的能力。**
- 状态变更（执行副作用）永远是强制 gate 点，不被计划级批准覆盖，预批 scope 也不能
  覆盖。
- "不自动执行 follow-up" 在本模型下精确化为两条并存：(1) 不自动执行**任何未被计划
  批准**的 follow-up；(2) 状态变更类 follow-up 即使已在已批准计划内，仍必须单独 gate。

## 4. 数据模型（草案）

新增概念（最终以实现切片为准）：

```text
Goal      { id, description, status, createdAt }
Plan      { id, goalId, steps: PlanStep[], status, approvedAt? }
PlanStep  { id, planId, intent, requiredCapability, riskLevel, assignedTier?,
            status, isStateMutating, result? }
```

状态机（草案）：

```text
Goal:  draft -> planned -> approved -> executing -> done | cancelled | failed
Plan:  draft -> awaiting-approval -> approved -> executing -> done | cancelled
Step:  pending -> assigned -> running -> done | failed | blocked-needs-gate
```

约束：

- `Plan` 必须经用户 `approved` 才能进入 `executing`。
- `PlanStep.isStateMutating === true` 的步骤进入 `blocked-needs-gate`，需单独确认。
- 所有步骤产出经脱敏与审计；raw 内容 memory-only。

## 5. 编排器职责

- 接收已批准 Plan，按步顺序/依赖驱动执行。
- 对每步：用路由策略选 endpoint（tier × capability），裁剪该步上下文，调用，捕获结果。
- 维护步数上限、超时、中断信号。
- 失败处理：重试策略 / tier 升级 / re-plan 触发。
- 全程写审计：步骤、所选 tier、耗时、退出状态、是否命中 gate。
- 不持有任何 shell 通用执行权；执行端点仍受 command-runner allowlist 与 capability
  gating 约束。

## 6. 与现有资产的关系

- `command-runner.ts`（已实现）：执行层调用本地 CLI 的安全闸门，编排器复用它。
- EndpointRegistry + capabilities（已存在）：扩展加入 `tier` 字段即可承载路由。
- PendingReview / PendingPrompt（已存在）：计划级审批与 gate 步骤复用其确认机制。
- WorkBuddy（v0.8 库契约）：作为执行层的 task source / result sink，**不得**成为在
  回路内自行触发执行的控制器。
- `PLAN-AGENTTEAM-PROJECT-CONTROL-PLANE.md`：修正并扩展本条边界。WorkBuddy 当前实现
  身份仍是 task source / result sink；但 WorkBuddy、qclaw、openclaw、hermes 等工具
  可在后续以**单独注册的执行端点身份**进入 AgentTeam，前提是声明 capability、scope、
  isolation、gate、audit，并不得由任务状态变化绕过中间层触发执行。
- 控制台 UI（见 console plan）：goal/plan 审批与中断的天然界面归宿。

## 7. 为什么现在不实现

- 依赖轨道 A/B 的真实 transport 先跑通；编排器没有真实执行端点就是空壳。
- 计划级审批的体验需在简单形态下先验证，再固化成引擎与 UI。
- 数据模型（Goal/Plan/PlanStep）应在真实用过 1–2 个 goal 后再定稿，避免过早抽象。

## 8. 启动条件

- 轨道 A 已实现并在真实使用中产出过可用 review。
- 至少手动走通过一次 "goal -> 人工分解的计划 -> 分步派发" 的流程，确认形态值得固化。
- （web-dom 自动发送/提取为 deferred；非启动前提，除非后续 ADR 重新批准。）

满足后再把本构想拆为带 ADR 的实现切片（预计从 Goal/Plan 数据模型 + 计划级审批门
开始，再做编排器，最后做 tier-aware 路由与升级策略）。
