# Plan: 分层编排模型 + 中间层控制台（构想，机制验证后启动）

## 0. 状态

Status: PLAN（构想记录，非活跃切片）。

本文件记录两件相关的产品方向构想：(1) planner/executor 双层编排模型；(2) 中间层
控制台 UI。两者都**不是**当前要实现的代码切片。当前活跃推进仍是：安全地基 ->
轨道 A（command transport）-> 轨道 B（web-dom 自动模式），见 ADR-0001 / ADR-0002 /
v1.5b 实现交接。

控制台 UI 的实现时机明确推迟到「双轨机制 + 确认门在真实使用中被验证有价值」之后。

## 1. 分层编排模型（核心架构原则）

参与者按**在回路里的角色/能力**分层，而不是按工具名分层。同一个工具可以根据调用
方式出现在不同层。

### 上层 —— 规划 / 管理 / 评审（planner-reviewer）

- 成员（当前）：Codex、Claude Code、ChatGPT。未来可扩展。
- 职责：规划、审阅、总结、产出下一步 prompt 草稿。
- 不直接修改用户的代码或项目状态。
- 能力约束：`canReview` / `canSummarize` = true，`canExecute` = false。
- 典型调用：`claude -p ... --tools ""`（review-only）、`codex exec review`、ChatGPT
  Web review。

### 下层 —— 执行（executor）

- 成员（当前/计划）：WorkBuddy、Codex CLI（第三方 API）、Claude Code（第三方 API）、
  OpenCode 等。未来可扩展。
- 职责：真正动手——改文件、出 diff、推进任务状态、归档结果。
- 能力约束：`canExecute` / `canAcceptPrompt` = true。

### 关键原则：同一工具可跨层，按能力区分

- 例：Claude Code 以 `-p --tools ""` 调用时属上层（review-only）；以带执行权限的
  方式调用时属下层（executor）。
- 因此 EndpointRegistry 的分层依据是 endpoint 的 `capabilities`，不是工具名。每个
  注册的 endpoint 显式声明它这次扮演哪一层。

### 分层与安全闸门的关系

```text
上层（规划/评审）产出 follow-up 草稿
        |  <-- 用户确认门（"不自动执行 follow-up" 的边界就在这里）
下层（执行）才动手
```

- 上层 -> 下层之间**永远**隔着用户确认门（PendingReview / PendingPrompt 的
  confirm + send）。
- WorkBuddy 在下层只作为 task source + result sink，**不得**成为在回路内自行触发
  执行的控制器（沿用 v0.8 WorkBuddy 硬边界）。
- 这条原则把先前的安全规则（不自动 agent loop、不自动执行 follow-up）升级为明确的
  架构边界：跨层执行必须经过人。

### 1.1 延伸：tier × role 双轴与目标驱动工作流

本分层模型进一步延伸为「目标驱动的动态工作流 + 分层编排引擎」，其中上层/下层的默认
依据是模型等级（tier）以提升 token 经济性，但 tier 与 role 是两条独立轴。详见
`docs/planning/PLAN-GOAL-DRIVEN-DYNAMIC-WORKFLOW.md`。该文档记录了已决策的计划级
人类确认门（方案 A + 状态变更步骤强制单独 gate）。

## 2. 中间层控制台 UI（构想）

### 2.1 动机

当前用户的注意力被分散在多处：WorkBuddy（任务）、Codex 终端（执行）、Claude/ChatGPT
（评审）、本地 server（闸门/审计）、浏览器面板。用户脑内充当窗口路由器，这是体验
割裂的根源。

### 2.2 重要澄清：中间层已存在

中间层不是要新建的架构层——**本地 server 已经是中间层**，已持有队列、PendingReview、
PendingPrompt、审计、指标。缺的不是新层，而是这一层的**一扇窗**：一个能看见状态并在
其上确认/取消的界面。

因此控制台 UI 的定位是「薄视图层」：

- 只做两件事：展示 server 状态 + 把用户确认动作回传给 server 现有闸门。
- 不持有业务逻辑，不自行调用 CLI，不自行驱动 ChatGPT，不自行触发执行。
- 所有安全边界（脱敏、确认门、不自动执行 follow-up、capability gating）仍由 server
  层守护，UI 无法绕过。

### 2.3 渐进实现路径（UI 放最后，且要薄）

```text
第一步（当前）：双轨 transport + 确认门跑通，界面用最简陋的
   （CLI 输出 + 现有浏览器面板）。目标：验证机制对不对。

第二步（机制验证后）：只读 dashboard
   本地网页，展示待确认的 review/prompt、审计流、指标。
   无操作能力。光"在一处看全"已解决大部分割裂感。

第三步（顺手之后）：dashboard 加 确认/取消/发送 按钮
   按钮只调 server 已有的 confirm/cancel/send 闸门，不新增逻辑。
   此时它成为真正的"中间层管理台"。
```

WorkBuddy 接入排在这条线之后：dashboard 成形后，WorkBuddy 作为任务来源 + 结果归档
接入同一界面，形成"一处管全部"的体验。仍受 §1 下层执行边界约束。

## 3. 为什么现在不做 UI（PM 判断）

- UI 是最贵、最易推倒重来的一层；当前 loop 机制尚未在真实使用中验证，过早固化会
  导致流程一改、UI 全废。
- loop 是否好用（review 是否啰嗦、确认点是否过多、是否常想跳过 review）只有真用过
  才知道；UI 应长在已验证有价值的流程上。
- "汇总到中间层管理"的范围可无限膨胀（看板/多 agent 编排/历史回放），现在投入会拖慢
  核心机制。

## 4. 现有 roadmap 关联

本构想与既有 deferred 项一致，非凭空新增：

- "panel surfacing of live metrics / pending-prompt list"（v1.2 deferred）。
- "a proper pairing popup UI"（v1.2 deferred）。
- WorkBuddy 作为 task source / result sink（v0.8 已建库契约）。

## 5. 启动条件（何时把本构想转为活跃切片）

满足以下后再考虑把控制台从 PLAN 升级为实现交接：

- 轨道 A（command transport review-only）已实现并在真实使用中跑过若干轮。
- 轨道 B（web-dom 自动模式）已实现且其确认门体验被验证。
- 用户确认当前 loop 的流程形态基本稳定、值得固化成界面。

在此之前，本文件仅作为方向记录，不驱动实现。
