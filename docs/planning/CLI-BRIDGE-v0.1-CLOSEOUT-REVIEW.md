# CLI Bridge v0.1 Closeout Review

## Decision

Status: pass with Managed PTY experimental caveat.

v0.1 已完成最小、安全、可追踪、人工确认的半自动中继闭环骨架。Repository Sync / Remote Review Gate 已完成远程复核；Codex Managed PTY 已有 mockable adapter 和自动测试，但真实 Codex CLI managed session 尚未完成手动验证，因此 Managed PTY 在 v0.1 中标记为 experimental。

## Verified Scope

### Week 1：Local Server Security Spike

- Local Server 固定监听 `127.0.0.1`。
- `GET /health` 公开可用。
- `GET /health/private` 同时受 pairing token 与 origin guard 保护。
- Extension background 只做 public/protected health helper。
- 未开放任意 shell / command / exec / run endpoint。

### Week 2：ChatGPT DOM Spike

- Extension 可 build 到 Chrome 可加载的 `dist`。
- Content script 会挂载 Bridge Panel。
- Bridge Panel 只保留 `填入 / 提取 / 复制`。
- ChatGPT composer 填入已在真实页面修复并确认可用。
- 支持用户选区、marker 区块、最后完整 assistant 回复 fallback。
- Streaming 状态禁止最后回复 fallback。
- Clipboard fallback 是显式状态。
- 不自动点击 ChatGPT 发送。
- 不读取 cookie / localStorage / 页面 token。

### Week 3：BridgePacket + Redaction + Audit

- BridgePacket schema 已定义。
- AuditEvent schema 已定义。
- contentHash 使用稳定 `sha256:` 格式。
- token estimate、length、compressionRatio 可计算。
- redaction rules 覆盖 Bearer/OpenAI/GitHub token、私钥块、`.env` secret assignment。
- packet-store 默认只持久化 processedContent。
- rawContent 默认 memory-only。
- audit-log 支持 append/list/listByPacket。
- 明显 secret 不进入持久化 packet。

### Week 4：MockAgentAdapter + Pending Prompt

- MockAgentAdapter 可接收确认后的 prompt。
- Pending Prompt 创建、预览、确认、取消、失败路径可测试。
- 未确认 prompt 不会发送。
- 取消 prompt 不会触发 adapter delivery。
- 发送失败返回 clipboard fallback 内容。
- 状态变化写入 audit event。

### Week 5：Codex Managed PTY Prompt Delivery

- CodexManagedPtyAdapter 只支持 managed `codex` process。
- 固定使用 `spawn('codex', [], { shell: false })`。
- 支持 start、send prompt、read recent output、status。
- 不支持 stop session。
- 不支持 attach existing terminal。
- 不开放任意 shell endpoint。
- 自动测试使用注入 spawn mock，不依赖真实 Codex CLI。

## Local Gate

Last verified local gate:

- `npm run build-extension`: passed
- `npm run lint`: passed
- `npm run typecheck`: passed
- `npm run test`: passed, 57/57

## Manual Validation

已手动验证：

- Chrome 可加载 extension dist。
- ChatGPT 页面 Bridge Panel 可见。
- `填入` 可把文本写入 ChatGPT composer，且不会自动发送。
- `提取` 可获取信息。
- `复制` 可复制信息。

仍需手动验证或保留为 experimental：

- streaming 中点击 `提取` 必须返回 blocked。
- 无选区、无 marker、生成完成后提取最后完整 assistant 回复。
- 输入框不可用时 fallback 到剪贴板。
- 真实 Codex CLI managed PTY 一轮投递。

## Metrics Readiness

v0.1 已具备以下指标字段或可计算基础：

- rawLength
- processedLength
- compressionRatio
- processedTokenEstimate
- packetCreatedCount
- packetSentCount
- packetCancelledCount
- packetFailedCount
- fallbackToClipboardCount
- domFailureCount
- redactionHitCount

当前未实现 dashboard 或持久化 metrics aggregation；这是 v0.2+ 候选，不阻塞 v0.1 conditional pass。

## Scope Audit

未发现以下范围泄漏：

- 任意 shell endpoint
- 自动循环
- stop session
- attach existing terminal
- WorkBuddy UI / integration
- MCP
- Claude Code Adapter
- app-prompt integration
- 多 Agent selector
- GitHub API / connector / CI integration

注意：Week 5 存在 managed Codex process adapter，但它只投递 prompt 到 managed session，不提供通用命令执行入口。

## Repository Sync Status

- branch: `main`
- latest local commit at review start: `ac2a9e9d4d62f007dbd9129ccb17fbcb89fc6848`
- remote: `origin https://github.com/leekitleung/cli-bridge.git`
- upstream: `origin/main`
- pushed: yes
- remote verified: yes
- remote commit verified: `ac2a9e9d4d62f007dbd9129ccb17fbcb89fc6848`

Repository Sync Gate 已通过。本地 `HEAD` 与远程 `refs/heads/main` 均为 `ac2a9e9d4d62f007dbd9129ccb17fbcb89fc6848`。

## Decision Detail

允许进入 v0.2-1 Metrics and Review Hardening。Managed PTY 在真实手动投递验证完成前保持 experimental，不作为 v0.2 首个 slice 的稳定依赖。
