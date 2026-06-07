# CLI Bridge v0.1 Weekly Milestone Plan

## 总目标

v0.1 只验证一个安全、可追踪、人工确认的半自动中继闭环：

```text
Codex CLI 输出
  -> Bridge 本地整理
  -> 填入 ChatGPT Web
  -> ChatGPT 生成执行 Prompt
  -> Bridge 提取为 Pending Prompt
  -> 用户确认
  -> 投递到 Codex Managed PTY
```

v0.1 不验证 MCP、WorkBuddy UI、Claude Code、app-prompt、多 Agent、自动循环、stop session、attach existing terminal、任意 shell endpoint。

Week 1 + Week 2 的执行 Agent 提示词见 `docs/planning/CLI-BRIDGE-WEEK1-WEEK2-SPIKE-AGENT-PROMPTS.md`。

## Repository Sync and Remote Review Gate

CLI Bridge 项目允许 ChatGPT 在关键阶段读取 GitHub 仓库状态，但不要求每轮任务都读取远程仓库。该机制是阶段门禁，不是 W1/W2 DOM、Local Server 或 GitHub 功能实现。

触发时机：

- 每个 Week 开始前
- 每个 Week 完成后
- Spike Final Review 前
- 执行端 commit + push 后
- 进入下一阶段前
- v0.1 closeout 前

执行端标准收尾：

1. 跑本地 gate。
2. 查看 `git status`。
3. 查看 `git diff --stat`。
4. commit。
5. push。
6. 输出 branch、commit hash、remote、push 状态、gate 结果、changed files、known risks。

ChatGPT 阶段评审职责：

1. 阶段性读取 GitHub 远程分支。
2. 核对执行端报告的 commit hash。
3. 核对远程分支是否存在。
4. 核对本地报告的变更文件是否与远程 diff 一致。
5. 如存在 PR，检查 PR diff 是否符合本阶段范围。
6. 如存在 GitHub Actions，检查 CI 状态。
7. 判断是否允许进入下一阶段。

禁止：

- 未 push 的开发结果作为阶段完成依据。
- 只根据执行 Agent 文字报告通过 Final Review。
- CI 失败时进入下一阶段。
- 远程 branch / commit 与执行报告不一致时进入下一阶段。
- 为了该 gate 在 v0.1 提前实现 GitHub API、MCP、自动读取 GitHub、自动 push、自动 PR 或 CI 集成。

执行 Agent 阶段收尾输出格式：

```text
结果：
变更文件：
验证：
提交：
* branch:
* commit:
* pushed:
* remote:
GitHub / CI：
* PR:
* Actions:
* remote verified:
未做范围：
风险：
```

纯 Spike 或未要求提交的中间任务可以填写 `提交：not required for this task`。Week Final Review、Spike Final Review、阶段收束和进入下一阶段前，必须要求 commit + push。如果由于策略不能 push，必须明确写 `pushed: no` 和原因。

当前 W1/W2 流程不得因为新增 GitHub gate 跳过 runtime gate。顺序必须是：完成 W2-FIX、真实 ChatGPT 页面手动验证通过、本地 gate 通过、commit + push、ChatGPT 读取 GitHub 远程状态复核、W1/W2 Final Review 通过，然后才允许进入 Week 3。

## Week 0：项目初始化与边界冻结

目标：建立单仓库骨架，冻结 v0.1 范围，避免后续实现膨胀。

任务：

- W0-1：初始化 monorepo
- W0-2：加入 `apps/extension`、`apps/local-server`、`packages/shared`
- W0-3：写入 `CLI-BRIDGE-PLANNING-SPEC-v0.1-revised.md`
- W0-4：建立 deferred list
- W0-5：建立最小测试框架
- W0-6：建立 lint / typecheck / test 脚本

最小文件：

- `docs/planning/CLI-BRIDGE-PLANNING-SPEC-v0.1-revised.md`
- `packages/shared/src/types.ts`
- `packages/shared/src/schemas.ts`
- `packages/shared/src/constants.ts`
- `apps/extension/manifest.json`
- `apps/local-server/src/server.ts`

验收标准：

- 项目可安装依赖
- `typecheck` 可运行
- `test` 可运行
- v0.1 deferred list 写入文档
- 没有 WorkBuddy / MCP / Claude Code 实现入口

## Week 1：Local Server Security Spike

目标：先定住本地服务信任边界。Bridge 不能成为本地任意执行入口。

任务：

- S1-1：Local Server 只监听 `127.0.0.1`
- S1-2：启动时生成 pairing token
- S1-3：实现 `/health`
- S1-4：实现 pairing 校验
- S1-5：实现 origin guard
- S1-6：extension 可调用 health check
- S1-7：拒绝未 pairing / 错误 token / 错误 origin 请求

最小文件：

- `apps/local-server/src/server.ts`
- `apps/local-server/src/routes/health.ts`
- `apps/local-server/src/security/pairing.ts`
- `apps/local-server/src/security/origin-guard.ts`
- `packages/shared/src/constants.ts`
- `apps/extension/src/background/index.ts`

测试项：

- 服务没有监听 `0.0.0.0`
- 未 pairing 请求被拒绝
- 错误 token 请求被拒绝
- 错误 origin 请求被拒绝
- pairing 后 `/health` 成功

验收标准：

- 本地服务安全边界可验证
- extension 与 local server 可连通
- 没有任何 shell / command / agent 执行接口

## Week 2：ChatGPT DOM Spike

目标：验证 ChatGPT Web 端的最小可用能力，并把手动降级路径作为一等能力。

任务：

- S2-1：识别 ChatGPT 输入框
- S2-2：实现填入输入框
- S2-3：实现用户选区提取
- S2-4：实现标记区块提取，例如 `## Next Prompt for Codex`
- S2-5：实现最后完整 assistant 回复提取 fallback
- S2-6：实现 streaming 检测，生成中禁止提取
- S2-7：实现 clipboard fallback
- S2-8：Bridge Panel 只暴露填入、提取、复制三个动作

最小文件：

- `apps/extension/src/content/chatgpt-dom.ts`
- `apps/extension/src/content/extraction.ts`
- `apps/extension/src/content/clipboard.ts`
- `apps/extension/src/ui/bridge-panel.tsx`
- `apps/extension/src/ui/state.ts`
- `packages/shared/src/schemas.ts`

测试项：

- 能填入 ChatGPT 输入框
- 能提取用户选区
- 能提取标记区块
- streaming 未完成时不提取
- DOM 失败时复制到剪贴板
- 提取结果不混入隐藏历史
- 不自动点击发送

验收标准：

- ChatGPT Web 可完成最小填入 / 提取闭环
- DOM 失败时有稳定降级路径
- 不依赖完整聊天历史
- 不触碰 token / cookie / localStorage

## Week 3：BridgePacket + Redaction + Audit

目标：在接入真实 Agent 前，先建立安全的数据载体、脱敏规则和审计链路。

任务：

- B1-1：定义 BridgePacket schema
- B1-2：定义 AuditEvent schema
- B1-3：实现 contentHash
- B1-4：实现 token estimate
- B1-5：实现 redaction rules
- B1-6：packet 默认只持久化 processedContent
- B1-7：rawContent 默认 memory-only
- B1-8：实现 packet-store
- B1-9：实现 audit-log
- B1-10：记录基础 metrics

最小文件：

- `packages/shared/src/types.ts`
- `packages/shared/src/schemas.ts`
- `packages/shared/src/utils/hash.ts`
- `packages/shared/src/utils/token-estimate.ts`
- `apps/local-server/src/security/redaction.ts`
- `apps/local-server/src/storage/packet-store.ts`
- `apps/local-server/src/storage/audit-log.ts`
- `apps/local-server/src/routes/packets.ts`

测试项：

- packet 字段符合 schema
- rawContent 不进入持久化
- 明显 secret 被脱敏
- 私钥 / `.env` 片段被阻止或标记
- audit event 覆盖 create / redact / preview / confirm / send / fail / cancel
- token 估算稳定输出
- compressionRatio 可计算

验收标准：

- 任何持久化 packet 都是脱敏后的
- 关键操作可追踪
- packet 可复盘 source / target / session / status / redactionSummary / contentHash
- 基础指标从这一周开始产生

## Week 4：MockAgentAdapter + Pending Prompt

目标：在不依赖真实 Codex 的情况下，先跑通 ChatGPT -> Agent 的人工确认流程。

任务：

- B2-1：定义 AgentAdapter 最小接口
- B2-2：实现 MockAgentAdapter
- B2-3：实现 Pending Prompt 创建
- B2-4：实现 Pending Prompt 预览
- B2-5：实现确认 / 取消 / 失败状态
- B2-6：确认后发送到 MockAgent
- B2-7：取消不触发发送
- B2-8：失败后 clipboard fallback
- B2-9：所有状态变化写入 audit

最小文件：

- `apps/local-server/src/adapters/AgentAdapter.ts`
- `apps/local-server/src/adapters/MockAgentAdapter.ts`
- `apps/local-server/src/routes/pending-prompts.ts`
- `apps/local-server/src/routes/sessions.ts`
- `apps/local-server/src/context/command-buffer.ts`
- `apps/extension/src/ui/bridge-panel.tsx`

测试项：

- pending prompt 可创建
- pending prompt 可预览
- pending prompt 可确认
- pending prompt 可取消
- 取消不会触发发送
- 失败状态被记录
- mock adapter 可读最近输出
- clipboard fallback 可用

验收标准：

- 不依赖真实 Codex 也能跑通 ChatGPT -> Pending Prompt -> Confirm -> Agent 的完整流程
- 确认、取消、失败路径均可审计
- 没有自动执行路径

## Week 5：Codex Managed PTY Prompt Delivery

目标：接入真实 Codex，但只做 managed session 的 prompt 投递，不接管用户现有终端。

任务：

- B3-1：实现 CodexManagedPtyAdapter
- B3-2：Bridge 启动 managed Codex session
- B3-3：读取 stdout buffer
- B3-4：确认后投递 prompt
- B3-5：发送前展示 cwd / branch / dirty / transport
- B3-6：失败后 clipboard fallback
- B3-7：记录投递状态和失败原因
- B3-8：完成一轮 Codex -> ChatGPT -> Codex 手动验证

最小文件：

- `apps/local-server/src/adapters/CodexManagedPtyAdapter.ts`
- `apps/local-server/src/adapters/AgentAdapter.ts`
- `apps/local-server/src/routes/sessions.ts`
- `apps/local-server/src/routes/pending-prompts.ts`
- `apps/local-server/src/context/command-buffer.ts`

测试项：

- managed session 能启动
- 能读取 stdout buffer
- 能投递 prompt
- 不 attach 现有终端
- 不支持 stop session
- 不开放 shell endpoint
- 发送前 cwd / branch / dirty 可见
- 失败时 fallback clipboard

验收标准：

- 能完成一轮 Codex -> ChatGPT -> Codex 的人工确认闭环
- Bridge 不接管终端
- Bridge 不执行 shell
- Bridge 不自动循环
- Bridge 不提供 stop session
- 失败不会导致不可恢复状态

## Week 6：v0.1 Stabilization & Review

目标：冻结 v0.1，评估是否值得进入 v0.2。

任务：

- R1-1：跑完整 gate
- R1-2：整理 v0.1 使用记录
- R1-3：统计基础指标
- R1-4：审查安全边界
- R1-5：审查 DOM 稳定性
- R1-6：审查 Managed PTY 是否值得保留
- R1-7：列出 v0.2 候选任务
- R1-8：写 v0.1 closeout review

必看指标：

- rawLength
- processedLength
- compressionRatio
- processedTokenEstimate
- packetCreatedCount
- packetSentCount
- packetCancelledCount
- packetFailedCount
- confirmRate
- cancelRate
- fallbackToClipboardCount
- domFailureCount
- redactionHitCount

v0.1 通过标准：

- ChatGPT DOM 可用，且失败可降级
- Local Server 信任边界清晰
- 持久化内容默认脱敏
- Pending Prompt 确认链路稳定
- MockAgent 流程完整
- Codex Managed PTY 能完成一轮真实闭环
- 没有任意 shell endpoint
- 没有自动循环
- 没有 WorkBuddy / MCP / Claude Code 范围泄漏

v0.1 不通过条件：

- ChatGPT DOM 经常失败且选区 / 剪贴板无法补足
- Managed PTY 不稳定且 clipboard delivery 也不好用
- rawContent 意外进入持久化
- 确认链路可被绕过
- Bridge 实际变成终端控制器
- 实现中出现 WorkBuddy / MCP / Claude Code 范围膨胀

## Week 7：v0.2 Planning Handoff

目标：基于 v0.1 closeout 结果，整理 v0.2 方向、风险和执行提示词，但不新增业务功能。

任务：

- R2-1：读取 v0.1 closeout review
- R2-2：整理 v0.1 已验证项、未验证项和阻塞项
- R2-3：复核 deferred list，确认哪些仍不得进入 v0.2 首轮
- R2-4：整理 v0.2 候选路线
- R2-5：给出 v0.2 推荐首个执行 slice
- R2-6：产出 v0.2 handoff prompt
- R2-7：执行本地 gate
- R2-8：按 Repository Sync Gate 完成 commit / push / remote review 准备

最小文件：

- `docs/planning/CLI-BRIDGE-v0.1-CLOSEOUT-REVIEW.md`
- `docs/planning/CLI-BRIDGE-v0.2-PLANNING-HANDOFF.md`

验收标准：

- v0.1 closeout review 明确通过、未通过或 conditional pass
- v0.2 handoff 不要求实现 WorkBuddy / MCP / Claude Code / app-prompt
- v0.2 首个 slice 有明确边界、测试项和禁止范围
- 未新增业务功能代码
- 本地 gate 通过
- 如存在 remote/upstream，完成 push；否则明确报告建议 push 命令

## v0.2 候选，但不得提前实现

- Skill 模板系统
- Review CLI Output template
- Generate Codex Prompt template
- Context Budget
- 更完整 metrics dashboard
- WorkBuddy 只读 context

## v0.3 候选，但不得提前实现

- MCP read-only tools
- get_git_status
- get_recent_cli_output
- get_project_context_light
- save_packet_draft
- tool cost / risk metadata

## v0.4 候选，但不得提前实现

- Claude Code Adapter
- command transport
- agent capability matrix
- agent selector

## v0.5 候选，但不得提前实现

- WorkBuddy 深度接入
- 任务关联
- review saveback
- next prompt saveback
- release ledger saveback

## v0.6 候选，但不得提前实现

- app-prompt 模板读取
- Skill template registry
- Prompt candidate saveback

## 执行原则

1. 先验证信任边界，再验证网页 DOM，再接真实 Agent。
2. 先用 MockAgent 跑通流程，再接 Codex。
3. 先保证脱敏和审计，再保存任何内容。
4. 所有 ChatGPT -> Codex 内容必须进入 Pending Prompt。
5. 所有 Codex 投递必须用户确认。
6. DOM 失败必须能降级到剪贴板。
7. Managed PTY 失败不得自动重试。
8. v0.1 不得实现 deferred list 中的功能。
