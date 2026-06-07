# CLI Bridge Planning Spec v0.1 Revised

## 1. 修订结论

CLI Bridge 方向成立，但 v0.1 必须大幅收敛。

v0.1 的目标不是建立完整 AI Agent 工作台，而是验证一个最小、安全、可追踪的桥接闭环：

```text
CLI 输出 -> 本地整理 -> 填入 ChatGPT Web
ChatGPT 回复 -> 提取执行区块 -> Pending Prompt -> 用户确认 -> 投递给 Codex
```

v0.1 必须坚持：

- Bridge 是中继工具，不是终端控制器。
- Bridge 可以整理、预览、记录和投递 prompt。
- Bridge 不直接执行 shell。
- Bridge 不绕过 Codex 自身权限模式。
- Bridge 不做无人值守自动循环。

## 2. v0.1 收敛后的产品边界

### 2.1 v0.1 做什么

v0.1 只做五类能力：

1. ChatGPT Web 最小 DOM 适配
   - 填入输入框
   - 提取用户选区
   - 提取明确标记区块
   - 失败时复制到剪贴板
2. Local Bridge Server
   - 127.0.0.1 only
   - pairing token
   - origin guard
   - health check
3. BridgePacket + Redaction + Audit
   - 只持久化脱敏后的 processedContent
   - 默认不持久化 rawContent
   - 记录 packet、确认、失败和发送状态
4. MockAgentAdapter + Pending Prompt
   - 不依赖真实 Codex 完成核心流程测试
   - 所有 ChatGPT -> CLI 内容先进入 Pending Prompt
   - 用户确认后才投递
5. Codex Prompt Delivery
   - 真实 Codex 仅做“人工确认后投递 prompt”
   - 不做 stop session
   - 不接管终端
   - 不直接执行 shell command

### 2.2 v0.1 不做什么

以下全部延后：

1. WorkBuddy UI
2. WorkBuddy 深度写回
3. app-prompt 模板读取
4. MCP tools
5. Claude Code Adapter
6. 多 Agent selector
7. stop session
8. 自动运行测试
9. 自动安装依赖
10. 自动继续 agent loop
11. 完整项目上下文导入
12. 深度研究触发
13. AI Processed Relay
14. release ledger 写回
15. Skill effectiveness metrics

WorkBuddy、app-prompt、MCP、Claude Code 在 v0.1 只保留架构位置，不进入验收。

### 2.3 Repository Sync and Remote Review Gate

CLI Bridge 项目允许 ChatGPT 在关键阶段读取 GitHub 仓库状态，但不要求每轮任务都读取远程仓库。该机制是阶段门禁，不是产品功能。

触发时机：

- 每个 Week 开始前
- 每个 Week 完成后
- Spike Final Review 前
- 执行端 commit + push 后
- 进入下一阶段前
- v0.1 closeout 前

执行端职责：

1. 完成代码或文档修改。
2. 运行本地 gate。
3. 检查 `git status`。
4. 查看 `git diff --stat`。
5. commit。
6. push。
7. 输出 branch、commit hash、pushed remote、gate result、changed files、known risks。

ChatGPT 评审职责：

1. 阶段性读取 GitHub 远程分支。
2. 核对执行端报告的 commit hash。
3. 核对远程分支是否存在。
4. 核对本地报告的变更文件是否与远程 diff 一致。
5. 如果有 PR，检查 PR diff。
6. 如果有 GitHub Actions，检查 CI 状态。
7. 判断是否允许进入下一阶段。

禁止：

- 未 push 的开发结果作为阶段完成依据。
- 只根据执行 Agent 文字报告通过 Final Review。
- CI 失败时进入下一阶段。
- 远程 branch / commit 与执行报告不一致时进入下一阶段。
- 为了该 gate 在 v0.1 提前实现 GitHub API、GitHub connector、MCP、自动 push 脚本、自动 PR 或 CI 集成。

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

这些要求不进入 W1/W2 DOM 或 Local Server 功能实现，不引入 GitHub API 功能代码，不要求自动读取 GitHub。

当前流程特别说明：

1. 先完成 W2-FIX。
2. 真实 ChatGPT 页面手动验证通过。
3. 本地 gate 通过。
4. commit + push。
5. ChatGPT 读取 GitHub 远程状态复核。
6. W1/W2 Final Review 通过。
7. 才允许进入 Week 3。

## 3. 核心风险修正

### 3.1 中继器与终端控制器边界

v0.1 明确：

- CLI Bridge 不拥有终端执行权。
- CLI Bridge 不提供 exec_shell / run_command / stop_session。
- CLI Bridge 只负责把确认后的 prompt 投递到目标 agent。
- 真正是否改文件、跑测试、安装依赖，由 Codex 自身执行环境和权限模式决定。

因此，v0.1 中“发送到 Codex”的语义改为：

```text
投递 Prompt 到 Codex 输入通道
```

而不是：

```text
执行本地命令
控制 Codex session
强制 Codex 开始/停止
```

### 3.2 权限模型修正

原规划中的 Level 3/4/5 存在歧义，因为 prompt 投递后 Codex 可能执行文件修改或测试命令。

修订后权限分为两层。

Bridge 权限层：

- B0：只读本地状态
- B1：填入 ChatGPT
- B2：创建 Pending Prompt
- B3：投递 Prompt 到 Agent

v0.1 只支持到 B3。

Agent 执行层：

- A0：agent 只分析
- A1：agent 可建议修改
- A2：agent 可修改文件
- A3：agent 可运行测试
- A4：agent 可安装依赖 / 执行高风险命令

Agent 执行层不由 Bridge 直接控制，Bridge 只在投递前展示风险提示。

v0.1 发送前必须提示：

```text
该 Prompt 可能导致 Codex 修改文件或运行测试。
Bridge 只负责投递，不负责执行授权。
请确认当前 Codex 权限模式是否符合预期。
```

## 4. v0.1 Transport 决策

v0.1 不支持多 transport。只定义一个可测路径，避免实现分裂。

### 4.1 首选路径：Managed PTY Session

v0.1 中 CodexAdapter 只支持由 Bridge 启动和管理的 Codex session：

```text
Bridge Local Server
  ↓
Managed PTY
  ↓
codex process
```

支持：

- start managed Codex session
- send prompt to managed session
- read recent stdout buffer
- get session status

不支持：

- attach existing terminal
- stop arbitrary existing session
- read external terminal history
- control user's independent shell

### 4.2 降级路径：Clipboard Delivery

如果 Managed PTY 不稳定，降级为：

```text
把 Pending Prompt 复制到剪贴板
用户手动粘贴到 Codex CLI
```

该降级路径必须是一等功能，不是失败后的临时提示。

### 4.3 v0.1 不做

- 不读取 Codex 内部日志
- 不 attach 现有终端
- 不模拟用户键盘输入到任意窗口
- 不做 stop session
- 不做 resume session

## 5. ChatGPT Web DOM 策略

ChatGPT Web DOM 是高脆弱依赖，必须单独 Spike。

### 5.1 v0.1 支持的能力

1. 填入 ChatGPT 输入框
2. 提取用户选中的内容
3. 提取明确标记区块
4. 提取最后一条完整 assistant 回复：作为 fallback
5. streaming 状态下禁止提取

### 5.2 提取优先级

```text
用户选中内容
  ↓
明确标记区块，例如 “## Next Prompt for Codex”
  ↓
最后一条完整 assistant 回复
  ↓
失败则复制/粘贴手动模式
```

### 5.3 降级策略

任何 DOM 识别失败时，直接降级：

- 填入失败 -> 复制到剪贴板
- 提取失败 -> 要求用户选中文本
- streaming 未完成 -> 禁止提取并提示等待

v0.1 不做：

- 不自动点击发送
- 不读取完整聊天历史
- 不读取隐藏分支
- 不依赖单一 DOM selector

## 6. BridgePacket 修订

### 6.1 默认不持久化 rawContent

原规划中 rawContent 存在安全风险。v0.1 修订为：

- rawContent 只在内存中短暂存在
- processedContent 经脱敏后才允许持久化
- 如需保存 rawContent，必须显式开启 debug mode，并设置 TTL

### 6.2 Revised BridgePacket

```ts
type BridgePacket = {
  id: string
  sessionId: string
  source: 'codex' | 'chatgpt-web' | 'user-selection' | 'clipboard'
  target: 'codex' | 'chatgpt-web' | 'clipboard'
  kind:
    | 'cli-output-review'
    | 'pending-prompt'
    | 'manual-transfer'
    | 'failure-report'
  processedContent: string
  rawContentRef?: {
    storage: 'memory-only' | 'debug-ttl'
    expiresAt?: number
  }
  safety: {
    redactionApplied: boolean
    redactionSummary: string[]
    blocked: boolean
    blockReasons: string[]
    contentHash: string
  }
  context: {
    cwd?: string
    branch?: string
    dirty?: boolean
    agent?: 'codex'
    transport?: 'managed-pty' | 'clipboard'
  }
  metrics: {
    rawLength?: number
    processedLength: number
    rawTokenEstimate?: number
    processedTokenEstimate?: number
    compressionRatio?: number
  }
  status: 'draft' | 'previewed' | 'confirmed' | 'sent' | 'failed' | 'cancelled'
  createdAt: number
  updatedAt: number
}
```

## 7. AuditEvent 修订

审计日志必须支持追责、复盘和失败恢复。

```ts
type AuditEvent = {
  id: string
  sessionId: string
  packetId?: string
  approvalId?: string
  type:
    | 'read_cli_output'
    | 'process_content'
    | 'redact_sensitive'
    | 'fill_chatgpt'
    | 'extract_chatgpt'
    | 'create_pending_prompt'
    | 'confirm_prompt'
    | 'send_to_agent'
    | 'copy_to_clipboard'
    | 'operation_failed'
    | 'operation_cancelled'
  source: string
  target: string
  snapshot: {
    cwd?: string
    branch?: string
    dirty?: boolean
    agent?: string
    transport?: string
  }
  safety: {
    contentHash?: string
    redactionSummary?: string[]
    riskLevel?: 'low' | 'medium' | 'high'
  }
  result: {
    ok: boolean
    failureReason?: string
  }
  timestamp: number
}
```

v0.1 要求：

每次 packet 创建、脱敏、预览、确认、发送、失败都必须记录 audit event。

## 8. v0.1 指标前置

效果分析不能放到 v0.6。v0.1 必须记录最小价值指标。

### 8.1 必须记录的指标

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

### 8.2 v0.1 判断是否值得继续的指标

v0.1 完成后必须能回答：

- 是否减少复制粘贴？
- CLI 输出压缩比是否明显？
- 用户是否频繁取消发送？
- ChatGPT DOM 是否稳定到可用？
- Managed PTY 是否比 Clipboard 明显更好？
- 真实 Codex 投递是否安全可控？

如果这些指标不成立，不进入 MCP / WorkBuddy / Claude Code 扩展。

## 9. v0.1 UI 收敛

v0.1 不做三种完整工作流，只保留两个核心流程。

### 9.1 Flow A：CLI -> ChatGPT Review

```text
读取 Codex 输出
  ↓
本地整理 / 脱敏
  ↓
预览 BridgePacket
  ↓
填入 ChatGPT
  ↓
失败则复制到剪贴板
```

### 9.2 Flow B：ChatGPT -> Codex Pending Prompt

```text
提取选区 / 标记区块 / 最后回复
  ↓
生成 Pending Prompt
  ↓
展示 cwd / branch / dirty / transport
  ↓
用户确认
  ↓
投递到 Managed PTY
  ↓
失败则复制到剪贴板
```

### 9.3 v0.1 UI 不做

- WorkBuddy -> ChatGPT 规划
- ChatGPT -> WorkBuddy 保存
- 多 Agent 选择
- MCP tool 面板
- Skill 管理界面
- Prompt 模板库界面

## 10. Revised Milestones

### BRIDGE-SPIKE-1：ChatGPT DOM Spike

目标：

- 验证填入输入框
- 验证用户选区提取
- 验证标记区块提取
- 验证最后完整回复提取
- 验证 streaming 判断
- 失败时复制到剪贴板

验收：

- DOM 成功时可自动填入/提取
- DOM 失败时可稳定降级到剪贴板
- 不自动点击发送
- 不读取完整历史

### BRIDGE-SPIKE-2：Local Server Security Spike

目标：

- 127.0.0.1 only
- pairing token
- origin guard
- health check
- extension pairing

验收：

- 未 pairing 请求被拒绝
- 非允许 origin 被拒绝
- pairing 后 extension 可调用 health check

### BRIDGE-1：Packet + Redaction + Audit

目标：

- 创建 BridgePacket
- 只保存 processedContent
- rawContent 默认 memory-only
- 敏感信息脱敏
- 记录 audit event
- 记录基础指标

验收：

- 明显 secret 不会进入持久化历史
- packet 可追踪 source / target / session / status
- audit event 包含 approvalId / contentHash / redactionSummary / failureReason

### BRIDGE-2：MockAgentAdapter + Pending Prompt

目标：

- 实现 MockAgentAdapter
- 实现 Pending Prompt 状态
- 实现确认 / 取消 / 失败流程
- 实现 clipboard fallback

验收：

- 不依赖真实 Codex 也能跑完整 ChatGPT -> Agent 流程
- 取消发送不会触发任何 agent 投递
- 失败后可复制到剪贴板

### BRIDGE-3：Codex Managed PTY Prompt Delivery

目标：

- Bridge 启动 managed Codex session
- 读取最近 stdout buffer
- 用户确认后投递 prompt
- 不做 stop session
- 不 attach 现有终端

验收：

- 可完成 Codex -> ChatGPT -> Codex 一轮闭环
- Bridge 不提供任意 shell endpoint
- Bridge 不自动执行循环
- 发送前展示 cwd / branch / dirty / transport
- 失败时 fallback 到剪贴板

## 11. Revised v0.1 Acceptance Criteria

v0.1 完成标准：

1. Browser Extension 可以连接 Local Bridge Server
2. Local Server 只监听 127.0.0.1
3. pairing token 与 origin guard 生效
4. ChatGPT 输入框填入可用
5. 用户选区提取可用
6. 标记区块提取可用
7. DOM 失败可降级到剪贴板
8. MockAgentAdapter 可完成完整 Pending Prompt 流程
9. BridgePacket 默认不持久化 rawContent
10. processedContent 脱敏后才保存
11. audit event 记录关键操作、确认、失败和取消
12. 基础指标从 v0.1 开始记录
13. Codex 只支持 Managed PTY Prompt Delivery
14. 不支持 stop session
15. 不 attach 用户现有终端
16. 不开放任意 shell endpoint
17. 不自动点击 ChatGPT 发送
18. 不自动循环
19. WorkBuddy 不进入 v0.1 UI
20. MCP、app-prompt、Claude Code 不进入 v0.1 验收

## 12. Deferred Items

### v0.2 候选

- Skill 模板系统
- Review CLI Output template
- Generate Codex Prompt template
- Context Budget
- 更完整 metrics dashboard
- WorkBuddy 只读 context

### v0.3 候选

- MCP read-only tools
- get_git_status
- get_recent_cli_output
- get_project_context_light
- save_packet_draft
- tool cost / risk metadata

### v0.4 候选

- Claude Code Adapter
- command transport
- agent capability matrix
- agent selector

### v0.5 候选

- WorkBuddy 深度接入
- 任务关联
- review saveback
- next prompt saveback
- release ledger saveback

### v0.6 候选

- app-prompt 模板读取
- Skill template registry
- Prompt candidate saveback

## 13. 最终修订原则

v0.1 的正确目标是验证：

- Bridge 是否能安全地减少复制粘贴？
- Bridge 是否能稳定完成 ChatGPT Web <-> Codex 的人工确认闭环？
- Bridge 是否能在不接管终端的前提下提供足够价值？
- Bridge 是否能避免把密钥和敏感内容写入历史？
- Bridge 是否值得进入 MCP / WorkBuddy / Claude Code 扩展阶段？

如果 v0.1 做不到这些，就不应该继续扩展。

因此，v0.1 必须从原来的“大而全桥接平台”收敛为：

```text
安全可验证的半自动上下文中继器。
```

核心修订是：v0.1 不再证明“多端协作平台可行”，只证明“安全半自动中继闭环值得继续做”。

这个版本比上一版更适合交给执行 Agent，因为边界更窄、风险更低、验收更明确。
