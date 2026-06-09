# Project Workspace Console — Spec 评审记录

## 0. 用途

对 `.kiro/specs/project-workspace-console/`（requirements / design / tasks）这套「项目驾驶舱
对话式工作流」UI/UX 重构 spec 的实质性评审记录。评审对象是文档本身，不是已实现代码。

- 评审范围：将中间层 console 的顶层实体从 Conversation/Goal 改为 **Project** 的信息架构、
  三栏驾驶舱布局、项目级时间线、状态面板、受控 goal/review 工作流、命令栏、安全保证、可扩展性。
- 评审依据：直接阅读 `apps/local-server/src/routes/console.ts`、`console-goals.ts`、
  `routes/bridge-api.ts`、`storage/goal-store.ts`、`packages/shared/src/types.ts`、
  `storage/metrics-summary.ts` 后端现状。
- 结论：spec 方向正确（薄客户端 + 分期），但初版**高估了 Phase A 能呈现的内容**。已就发现项
  修订 requirements / design / tasks 三份文档。

## 1. 主要发现（已修订）

### 1.1 状态面板大部分字段后端无数据源
原型右栏的 `v2.0`、`4/6 slices`、`tests 297/297`、`ahead 4 commits`、memory 列表，在当前
后端**均无数据来源**。`BridgeMetricsSummary` 只有 packet 计数与 confirm/cancel 比率，没有
版本、切片、测试、git 领先提交、记忆等概念。

- 处置：R4 按字段标注 Phase A/Phase B 与数据来源；design 新增「Data Availability」对照表；
  Phase A 这些字段一律渲染「unavailable / 空」；新增 task 17 在 Phase B 补后端源。

### 1.2 没有对话/消息存储，时间线无法是真正的聊天记录
R3 把「Conversation Timeline」作为核心区，但后端只有 goals/reviews/prompts/packets/audit，
**没有 message 存储**。原设计用「合成时间线」掩盖了这一点。

- 处置：R3 重命名为「Activity Timeline」，Phase A 明确定义为由真实记录派生的**活动流**
  （非聊天气泡）；真正的对话日志推迟到 Phase B（新增 R3.6 与 task 17）。

## 2. 次要发现（已修订）

| 项 | 问题 | 处置 |
| --- | --- | --- |
| R1.4 | 「within a session」与 design 用 `localStorage`（跨会话）矛盾 | 统一为：本地仅存非敏感的 active-project key，token 仅驻内存 |
| R8 | 命令栏 "generate plan" 会触发服务端真实 CLI（`claude -p`），非瞬时本地动作 | 新增 R8.6：必须显式展示 in-progress 指示 |
| R2.4 | 顶栏 branch 来自 `packet.context.branch`，常为空 | design「Data Availability」标注为 `A*`（有 packet 上下文时才有） |
| 多项目 UX | Phase A 全部数据归入单一隐式 `"cli-bridge"` 项目，项目列表/切换在 Phase A 实为占位 | design Open Decisions 第 5 条显式说明 |

## 3. 维持正确的部分（无需改）

- 薄客户端安全模型保留正确：所有变更经现有受控 `/bridge/*` 端点，未新增业务逻辑/网关绕过。
- 受控流程映射正确：create→confirm→dispatch、plan→approve→step→gate 与现有端点一一对应。
- design「Correctness Properties」对 thin-client、不可绕过网关、不自动推进、计划先审批等
  不变量的表述与 `goal-store.ts` 的结构性约束一致。
- 分期策略（Phase A 投影 / Phase B 实体）合理，避免大爆炸式替换；保留 `/console` 与
  `/console/goals` 两个旧视图。

## 4. 评审后文档改动清单

- requirements.md：信息架构块与术语表（Conversation→Activity Timeline，Memory 标 Phase B）；
  R1.4、R3（重定义 + 新增 R3.6）、R4（逐字段分期）、R6.4、R8（新增 R8.6）。
- design.md：新增「Data Availability」对照表、修正 Phase A 能力表述、`ProjectStatus` 接口注释
  与字段对齐、Open Decisions 增补第 4/5 条。
- tasks.md：task 4（活动流）、task 6（仅可派生字段）措辞收敛；新增 task 17（Phase B 状态/记忆/
  对话数据源），依赖图与 wave 同步更新。

## 5. 仍未覆盖 / 待办

- 真实 WCAG 合规需人工辅助技术测试，超出本 spec 设计范围（design 已注明）。
- Phase B 的状态/记忆/对话后端源属新后端能力，需各自的 canonical doc 与验证证据落地后再实现。
- 命令栏 "search history" 意图在 Phase A 仅能搜索已加载的派生记录，全文/跨项目搜索待 Phase B。
