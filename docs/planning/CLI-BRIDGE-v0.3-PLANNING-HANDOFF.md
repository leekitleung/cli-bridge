# CLI Bridge v0.3 Planning Handoff

## Handoff Status

v0.3 已进入首个受限 slice：Bidirectional Loop Orchestration。

v0.3 的目标不是取消人工确认，也不是实现自动 agent loop。当前阶段只把 Codex -> ChatGPT -> Codex 的双向步骤状态化、可审计、可取消、可 fallback。

## v0.3 Guardrails

必须保留：

- 不自动点击 ChatGPT 发送。
- 不绕过 Pending Prompt 用户确认。
- 不开放任意 shell endpoint。
- 不 attach existing terminal。
- 不 stop session。
- 不模拟键盘输入。
- 不接 WorkBuddy。
- 不接 MCP。
- 不接 Claude Code。
- 不读取 app-prompt。
- 不做 GitHub API / CI 自动读取。
- 不做 automatic agent loop。

## v0.3-1 Implementation Status

已完成最小双向闭环编排层：

- 新增 `InMemoryBridgeLoopStore`。
- Codex output 可进入 `BridgePacket`，形成 `codex-output-ready` loop。
- ChatGPT 填入动作可记录为 `fill_chatgpt` audit event。
- ChatGPT extraction 可转为 Pending Prompt。
- Pending Prompt 必须确认后才能投递。
- 确认后的 prompt 可通过既有 `AgentAdapter` 投递。
- 自动测试覆盖未确认 prompt 不会投递。

当前仍未实现：

- Browser/extension UI 对 loop store 的真实调用。
- ChatGPT Web 真实页面端到端验证。
- 真实 Codex Managed PTY 手动投递验证。
- 自动发送 ChatGPT。
- 自动 agent loop。

## Verification

v0.3-1 完成前必须通过：

- `npm run build-extension`
- `npm run lint`
- `npm run typecheck`
- `npm run test`

最终执行报告必须包含：

- branch
- commit
- pushed
- remote
- PR
- Actions
- remote verified
- known risks
