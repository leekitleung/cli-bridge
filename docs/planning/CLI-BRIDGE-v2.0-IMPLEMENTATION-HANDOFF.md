# CLI Bridge v2.0 实现交接 —— Goal-driven Console MVP

## 0. 状态

Status: IMPLEMENTATION HANDOFF（待审）。依据 ADR-0003（Accepted, 2026-06-09）的
受控执行层决策。未审通过前不写执行代码。

落实 ADR-0003 的 5 项已决策：
1. 默认 patch-proposal；workspace-write 逐 plan 显式开启。
2. 步数上限默认 1、硬顶 10。
3. 连续失败 2 次停。
4. 首个执行端点：仅 Codex `exec` patch-proposal（Claude 暂仍 review-only）。
5. 状态变更 gate：仅 console UI 确认，暂无 headless HTTP gate。

目标流程：

```text
Goal -> Plan -> Approve Plan -> Auto-run non-mutating steps
     -> Gate state-changing steps (console confirm) -> Audit -> Done
```

## 1. 范围（本切片做什么）

- 数据模型 + 内存 store：Goal / Plan / PlanStep。
- 计划生成：用已批准的 review-only 上层（Codex/Claude command transport）把 Goal
  分解为 Plan（PlanStep 列表）。计划生成本身是 review-only（不改文件）。
- 计划级审批：用户批准 Goal+Plan 后方可执行。
- 编排器：在已批准计划内自动派发**非状态变更**步骤；状态变更步骤进
  `blocked-needs-gate`。带步数上限、连续失败停、中断。
- 首个执行端点：Codex `exec` patch-proposal（read-only sandbox，产出 diff，不应用）。
- HTTP 端点：`/bridge/goals*`（创建 goal、生成 plan、批准、运行下一步、gate 确认、
  列表/状态、中断）。沿用 pairing token + origin guard。
- Console UI：Goal 输入区、Plan 审批区、自动执行控制台（每步显示 agent/endpoint/
  status/output/next + stop）、状态变更 gate 弹窗、结果审计区。
- 审计：每步记录 assigned agent、tier、endpoint、tool、status、exit、耗时、是否命中
  gate；不落原始内容。

## 2. 硬非目标（本切片不做）

- 不启用 workspace-write 自动写文件（仅 patch-proposal；应用 patch = 状态变更，走
  gate，但**实际写盘的实现**留待显式后续切片，本切片 gate 通过后只“标记已批准应用”
  并展示 diff，不自动 `git apply`）。
- 不接 Claude 执行（Claude 仍 review-only）。
- 不接 WorkBuddy / qclaw / openclaw / hermes 执行端点；这些属于后续 AgentTeam /
  project-control-plane 规划，详见 `PLAN-AGENTTEAM-PROJECT-CONTROL-PLANE.md`。
- 无 headless HTTP gate。
- 无自动 commit/push/merge/PR、无 shell 端点、无 attach 终端、无 dangerous bypass。
- 不做无界 agent loop（步数硬顶 10）。

> 说明：本切片把“受控执行”落到**最小可验证形态**——能自动推进 plan、能产出 patch
> 提案、状态变更必须人工 gate，但暂不真正写盘。真正应用 patch 到工作树是下一个更高
> 风险切片，单独审批。这样 v2.0 能验证 Goal→Plan→自动推进→gate 的**编排与安全骨架**，
> 而不立即承担写盘风险。

## 3. 数据模型（草案）

```text
Goal      { id, sessionId, description, status, createdAt, updatedAt }
Plan      { id, goalId, steps: PlanStep[], status, approvedAt?, createdAt }
PlanStep  { id, planId, index, intent, kind, targetEndpointId, tier,
            isStateMutating, status, output?, failureReason? }
```

状态机：

```text
Goal:  draft -> planned -> approved -> executing -> done | cancelled | failed
Plan:  draft -> awaiting-approval -> approved -> executing -> done | cancelled
Step:  pending -> running -> done | failed | blocked-needs-gate | gated-approved
```

约束：
- Plan 必须 `approved` 才能 executing。
- `isStateMutating` 步骤进 `blocked-needs-gate`，需 console 单独确认 -> `gated-approved`。
- 非状态变更步骤（review/summarize/propose-patch）可自动 `running -> done`。
- 所有产出脱敏 + 审计；raw 内容 memory-only。

## 4. HTTP 端点（草案，全部 token+origin gated）

```text
POST /bridge/goals                 创建 goal { sessionId, description }
POST /bridge/goals/plan            为 goal 生成 plan（调 review-only 上层分解）
POST /bridge/goals/approve         批准 plan { goalId }
POST /bridge/goals/step            运行下一个就绪步骤（非状态变更自动跑；状态变更返回 blocked）
POST /bridge/goals/gate            确认一个 blocked 状态变更步骤 { stepId }
POST /bridge/goals/cancel          中断 { goalId }
GET  /bridge/goals                 列表 + 状态
```

路径命名避开 `/exec` `/run` `/command` `/shell`（沿用 v1.6 的安全测试约束）。

## 5. 安全骨架（必须落实）

- 编排器：步数上限（默认 1、硬顶 10）、连续失败 2 次停、中断信号即停。
- 状态变更步骤永远 gate；计划级批准与预批 scope 都不能覆盖 gate。
- 执行端点经 command-runner allowlist + shell:false；Codex `exec` 用 read-only
  sandbox 产出 patch，不写盘。
- 失败 fail-closed；不自动重试轰炸。
- adapter / 编排器可注入，测试用 fake，不 spawn 真实 CLI、不真写文件。

## 6. 验收门禁

- 创建 goal -> 生成 plan -> 批准 -> 自动跑非状态变更步 -> 状态变更步进 blocked ->
  console gate 确认 -> 继续，全链路测试覆盖（fake adapter）。
- 断言：未批准 plan 不能跑步骤。
- 断言：状态变更步骤未经 gate 不会 done。
- 断言：步数达上限即停；连续失败 2 次即停；中断即停。
- 断言：无 shell 端点、无 dangerous flag、无原始内容落盘、Claude 未获执行能力。
- console 页面无 auto-execute-without-gate 路径。
- 本地 gate 全过：build + lint + typecheck + test。

## 7. 切片拆分建议（v2.0 内部，逐个 commit）

1. 数据模型 + 内存 store（Goal/Plan/PlanStep）+ 测试。
2. 计划生成（复用 review-only 上层把 Goal -> Plan）+ 测试。
3. 编排器（步数上限/失败停/中断/gate 分流）+ 测试，纯库层。
4. HTTP `/bridge/goals*` 端点 + 测试。
5. Console Goal-driven 视图（输入/审批/执行台/gate 弹窗/审计）+ 测试。
6. 真机验证交接（手动跑一个真实 Goal -> patch 提案）。

## 8. 立即下一步

审本 handoff。审通过后从 §7.1（数据模型）开始实现，保持每步门禁绿、独立 commit。
v2.1+ 继续推进前，必须先读取并核对：

- `PLAN-AGENTTEAM-PROJECT-CONTROL-PLANE.md`
- `CLI-BRIDGE-v2.1-AGENTTEAM-DISCUSSION-RAW.md`

这两份文档记录 WorkBuddy/qclaw/openclaw/hermes 可作为受治理执行端点、AgentTeam 默认
单 provider 多槽位、执行层能力检测、中间层模型 API、harness、memory、project control
plane UI 等后续边界。旧的 "WorkBuddy task/result 接入" 只能视为其中一个最小身份，不得
覆盖 AgentTeam 规划。

未审通过前不写执行代码。
