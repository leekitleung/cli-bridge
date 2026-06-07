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

## v0.3-2 Implementation Status

已完成 Extension / Local Server Loop Bridge：

- Bridge Panel 保留 `填入 / 提取 / 复制` 三个动作。
- Bridge Panel 新增 loop 状态显示。
- `填入` 成功后 loop UI 状态进入 `awaiting-user-send`。
- `提取` 成功后 loop UI 状态进入 `pending-confirmation`。
- 新增受控 route helper：`apps/local-server/src/routes/bridge-loop.ts`。
- Route helper 只包装既有 loop store 步骤，不新增 HTTP endpoint。
- 自动测试覆盖 route helper 可完成受控 loop 步骤。

未新增：

- 自动点击 ChatGPT 发送。
- 任意 shell endpoint。
- keyboard simulation。
- attach existing terminal。
- automatic agent loop。

## v0.3-3 ChatGPT Web Manual E2E Status

Status: blocked in current execution environment.

已验证：

- `npm run build-extension` 可生成 Chrome extension dist。
- Local Server 可启动，`GET /health` 返回 `200`。
- Extension 代码仍不包含自动发送路径。

未能完成真实 ChatGPT Web 手动 E2E：

- 当前执行环境不能代替用户在已登录 Chrome/ChatGPT 页面中完成手动发送。
- 未执行真实页面链路：Codex output 填入 ChatGPT -> 用户手动发送 -> ChatGPT 输出提取为 Pending Prompt。

降级路径：

- 保留 clipboard-first handoff。
- 保留 manual paste checklist。
- 保留 Pending Prompt 用户确认 gate。

仍需人工验证：

- streaming blocked。
- 无选区 fallback 到最后完整 assistant 回复。
- 输入框不可用时 clipboard fallback。
- Bridge Panel loop 状态在真实 ChatGPT 页面中按步骤变化。

## v0.3-4 Managed PTY Manual Delivery Status

Status: blocked; Managed PTY remains experimental.

已验证：

- `codex` CLI 存在，版本为 `codex-cli 0.130.0`。
- 自动测试仍覆盖 mock managed process 的 start / write / recent output。

未能完成真实 Managed PTY 手动投递：

- 当前非交互执行环境不能安全完成真实 managed session 人工验证。
- `CodexManagedPtyAdapter` 当前不支持 stop session；按 guardrail 不应为了验证新增 stop session 或任意 shell 控制。

降级路径：

- Managed PTY 继续保持 experimental。
- clipboard-first handoff 保持主路径。

## v0.3 Closeout

Status: completed with real E2E blocked caveat.

已完成：

- v0.3-1 Bidirectional Loop Orchestration。
- v0.3-2 Extension / Local Server Loop Bridge。
- 自动测试覆盖 loop 编排、受控 route helper、extension loop 状态显示。
- Local Server health smoke 验证。
- Extension build 验证。

未完成 / blocked：

- ChatGPT Web 真实手动 E2E。
- 真实 Codex Managed PTY 手动投递。

禁止范围审计：

- 未接 WorkBuddy。
- 未接 MCP。
- 未接 Claude Code。
- 未读取 app-prompt。
- 未接 GitHub API / CI 自动读取。
- 未做 multi-agent selector。
- 未做 stop session。
- 未做 attach existing terminal。
- 未开放任意 shell endpoint。
- 未做自动点击 ChatGPT 发送。
- 未做 automatic agent loop。

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
