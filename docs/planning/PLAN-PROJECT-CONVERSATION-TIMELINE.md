# Plan: Project Conversation Timeline（构想）

## 0. 状态

Status: PLAN（构想记录，非活跃切片）。

为每个项目维护一条统一的对话/事件时间线，把分散在各端发生过的开发上下文收拢到项目
视图里。**目标不是控制终端，而是 observability** —— 让上下文可被看见、可延续，无论
开发发生在哪个端。

本功能独立于受控执行层（ADR-0003 / v2.0）：它是只读的上下文聚合，不持有任何执行
权限。可与执行层并行规划。

## 1. 核心定位

- 这是一条**可观测时间线**，不是执行控制面。
- 它**不**驱动 agent、不触发执行、不改任何状态；它只记录与展示已经发生的事。
- 跨端延续：在 console 做的 review、未来 CLI wrapper 的 stdout 摘要、ChatGPT Web 的
  填入/提取、手动导入的终端 transcript，都汇到同一项目时间线，使“换个端继续开发”时
  上下文不丢。

## 2. 数据模型（草案）

```text
Project
  -> ConversationThread[]
      -> TimelineEvent[]
```

```text
Project          { id, name, createdAt, updatedAt }
ConversationThread { id, projectId, title, source, createdAt, updatedAt }
TimelineEvent    {
  id,
  projectId,
  threadId,
  source,            // console | codex | claude | chatgpt-web | terminal-import
  sessionId,
  kind,              // user_prompt | agent_response | review_result | audit_event | draft | failure
  content,           // redacted/processed only
  redactionSummary,
  createdAt,
  linkedReviewId?,
  linkedPromptId?,
  linkedPlanStepId?, // links to v2.0 execution step log when present
}
```

## 3. 记录来源（按可行性分期）

现可接（已有数据）：
- CLI Bridge console 的 review 对话。
- `/bridge/reviews*` 的 create / confirm / dispatch / returned 记录。
- Claude/Codex ReviewResult。
- follow-up draft（PendingPrompt draft）。
- ChatGPT Web 填入/提取记录（v1.5a outbound + extract，已有审计）。

未来（需各自前置切片）：
- Codex/Claude CLI wrapper 的 stdout 摘要（v1.7 wrapper 产出）。
- 用户**手动导入**的终端 transcript（显式导入，绝不自动抓取）。
- 受控执行层的 step log（v2.0 PlanStep 输出，经 linkedPlanStepId 关联）。

## 4. 采集方式：从现有审计派生，不新增侦听

- 时间线**不**新增任何对外部进程的侦听/抓取。它从已有的 audit log、packet、
  pending-prompt、pending-review、（未来）plan step 派生事件。
- 也就是说：来源数据本就经过脱敏 + 审计的现有管线；时间线只是把它们按 project/thread
  重新组织成可读视图。
- 项目归属：事件通过 sessionId / 显式 projectId 关联到 Project。Project 与 session
  的映射由用户在 console 指定或按约定推断（草案，实现时定）。

## 5. 安全边界（硬约束）

- 不自动 attach 任意终端。
- 不偷读 shell 历史 / 环境 / 进程列表。
- 不读取 Claude/Codex 私有会话文件，除非用户**显式导入**某个 transcript。
- raw content 默认 memory-only；持久化前必须脱敏（复用现有 redaction）；可配置是否
  持久化（沿用 CLI_BRIDGE_DATA_DIR 模式）。
- 时间线是 observability，**不是 execution authority**：它不能触发 review/dispatch/
  执行，不能确认 gate，不能改任何状态。
- 导入的 transcript 同样先脱敏再入库；导入是显式用户动作，带来源标记 terminal-import。

## 6. HTTP / UI（草案）

只读为主的端点（token + origin gated）：

```text
GET  /bridge/projects                 列出项目
GET  /bridge/projects/{id}/timeline   读某项目的合并时间线
POST /bridge/projects                 创建项目 { name }
POST /bridge/projects/import          显式导入 transcript { projectId, source, content }
```

导入是唯一的写入；其余是只读聚合。所有写入先脱敏。

UI 三栏：
- 左：Project list
- 中：Conversation timeline（按时间合并各 source 的事件，带 source/kind 标记）
- 右：选中事件详情（ReviewResult / Draft / Audit / 原始处理后内容）

## 7. 与现有资产的关系

- 复用现有 audit log / packet / pending-review / pending-prompt store 作为事件源。
- 复用 redaction：任何入时间线的内容都走脱敏。
- 与 v2.0 执行层解耦：执行层产出 step log，时间线通过 linkedPlanStepId 引用，但
  时间线自身无执行权。
- 与 console（v1.8）同源 UI，可作为 console 的新视图或独立页。

## 8. 为什么现在不实现

- 价值依赖“多端”真实使用积累（现在主要是 console + CLI）；过早做会基于想象的来源。
- Project↔session 归属模型需要真实用例打磨，避免过早抽象。
- 应在 v2.0 执行层骨架成形后，使 step log 成为时间线的一类来源，再统一设计持久化。

## 9. 启动条件

- v2.0 Goal-driven console 跑顺，且出现真实“跨端/跨 session 上下文断裂”的痛点。
- 至少两类来源（如 console review + CLI wrapper stdout）可稳定产出事件。
- 用户确认 project↔session 归属方式。

满足后拆为带实现交接的切片（预计：数据模型 + 从现有审计派生时间线 -> 只读端点 ->
三栏 UI -> 显式 transcript 导入）。
