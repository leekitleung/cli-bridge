# CLI Bridge Week 1 + Week 2 Spike Agent Prompts

## 使用方式

这些提示词用于交给开发执行 Agent。每个提示词只允许完成一个 Spike 子任务，不允许进入 Week 3+ 范围。

全局禁止范围：

- 不实现 BridgePacket
- 不实现 Redaction
- 不实现 Audit
- 不实现 MockAgentAdapter
- 不实现 Pending Prompt
- 不实现 Codex Managed PTY
- 不实现 WorkBuddy
- 不实现 MCP
- 不实现 Claude Code
- 不实现 app-prompt
- 不实现多 Agent
- 不实现自动循环
- 不实现 stop session
- 不实现 attach 现有终端
- 不新增任意 shell endpoint

全局交付格式：

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

说明：

- 对于纯 Spike 或未要求提交的中间任务，可以填写 `提交：not required for this task`。
- 对于 Week Final Review、Spike Final Review、阶段收束或进入下一阶段前，必须要求执行端完成 commit + push。
- 如果由于策略不能 push，必须明确写 `pushed: no` 和原因，不能模糊处理。

## Repository Sync and Remote Review Gate

CLI Bridge 项目允许 ChatGPT 在关键阶段读取 GitHub 仓库状态，但不要求每轮任务都读取远程仓库。

触发时机：

- 每个 Week 开始前
- 每个 Week 完成后
- Spike Final Review 前
- 执行端 commit + push 后
- 进入下一阶段前
- v0.1 closeout 前

执行端职责：

1. 完成代码修改。
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
5. 如存在 PR，检查 PR diff 是否符合本阶段范围。
6. 如存在 GitHub Actions，检查 CI 状态。
7. 判断是否允许进入下一阶段。

禁止：

- 未 push 的开发结果作为阶段完成依据。
- 只根据执行 Agent 文字报告通过 Final Review。
- CI 失败时进入下一阶段。
- 远程 branch / commit 与执行报告不一致时进入下一阶段。
- 为了该 gate 在 v0.1 提前实现 GitHub API、GitHub connector、MCP、自动读取 GitHub、自动 push、自动 PR 或 CI 集成。
- 把这些 gate 要求实现为 W1/W2 DOM 或 Local Server 功能代码。

## Prompt W1-1：Local Server 安全骨架

```text
你是 CLI Bridge 项目的执行 Agent。

任务：只做 Week 1 Local Server Security Spike 的最小服务骨架。

目标：
1. 建立 local-server 的最小启动入口。
2. 服务只监听 127.0.0.1。
3. 暴露 GET /health。
4. 不实现任何 shell、command、agent、packet、pending prompt、Codex 接口。

允许修改文件：
- apps/local-server/src/server.ts
- apps/local-server/src/routes/health.ts
- packages/shared/src/constants.ts
- package.json / workspace 配置 / tsconfig / 测试配置，只限项目启动和测试必需项

禁止修改或新增：
- apps/local-server/src/routes/packets.ts
- apps/local-server/src/routes/pending-prompts.ts
- apps/local-server/src/routes/sessions.ts
- apps/local-server/src/adapters/*
- apps/local-server/src/storage/*
- apps/local-server/src/security/redaction.ts
- 任何 WorkBuddy / MCP / Claude Code / Codex Managed PTY 相关文件

实现步骤：
1. 检查现有项目结构和脚本。
2. 建立最小 HTTP server。
3. 将 host 固定为 127.0.0.1，不允许 0.0.0.0。
4. 实现 GET /health，返回服务状态和本地监听信息。
5. 加最小测试或验证脚本，证明服务没有监听 0.0.0.0。

测试项：
1. server 可启动。
2. GET /health 返回成功。
3. server host 是 127.0.0.1。
4. 仓库中不存在 shell / command / agent 执行 endpoint。

验收标准：
1. Local Server 安全边界可验证。
2. health check 可用。
3. 没有任何执行本地命令的入口。

输出要求：
按以下格式回复：
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

## Prompt W1-2：Pairing Token

```text
你是 CLI Bridge 项目的执行 Agent。

任务：只在 Week 1 Local Server Security Spike 中加入 pairing token 校验。

前置假设：
Local Server 已有 127.0.0.1 only 的启动入口和 GET /health。

目标：
1. 服务启动时生成 pairing token。
2. 受保护接口要求请求携带 token。
3. 未 pairing / 缺失 token / 错误 token 请求被拒绝。
4. 不引入用户账号、cookie、localStorage 或浏览器 token 读取。

允许修改文件：
- apps/local-server/src/server.ts
- apps/local-server/src/routes/health.ts
- apps/local-server/src/security/pairing.ts
- packages/shared/src/constants.ts
- 相关测试文件

禁止修改或新增：
- apps/local-server/src/routes/packets.ts
- apps/local-server/src/routes/pending-prompts.ts
- apps/local-server/src/adapters/*
- apps/local-server/src/storage/*
- apps/local-server/src/security/redaction.ts
- 任何 Codex / MockAgent / Packet / Audit 相关实现

实现步骤：
1. 定义 pairing token 的生成、校验和错误响应。
2. 明确哪些端点需要 pairing，至少 health 的 protected 变体要可验证。
3. token 只保存在本地 server 进程内存中。
4. 错误 token 和缺失 token 返回 401 或 403。
5. 加测试覆盖成功和失败路径。

测试项：
1. 缺失 token 被拒绝。
2. 错误 token 被拒绝。
3. 正确 token 请求成功。
4. token 不写入仓库文件。

验收标准：
1. pairing 边界可自动验证。
2. pairing 不依赖 ChatGPT 账号状态。
3. 没有扩大到 Packet、MockAgent 或 Codex 接入。

输出要求：
按以下格式回复：
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

## Prompt W1-3：Origin Guard

```text
你是 CLI Bridge 项目的执行 Agent。

任务：只为 Week 1 Local Server Security Spike 增加 origin guard。

目标：
1. 只允许预期来源调用 Local Server。
2. 非允许 origin 被拒绝。
3. pairing token 与 origin guard 同时生效。
4. 不实现任何业务数据传输。

允许修改文件：
- apps/local-server/src/server.ts
- apps/local-server/src/security/origin-guard.ts
- apps/local-server/src/security/pairing.ts
- packages/shared/src/constants.ts
- 相关测试文件

允许 origin：
- Chrome extension origin，使用常量占位或配置白名单。
- ChatGPT Web 页面来源，只限 Spike 验证所需。
- 本地测试来源，只限测试环境明确开启。

禁止修改或新增：
- apps/local-server/src/routes/packets.ts
- apps/local-server/src/routes/pending-prompts.ts
- apps/local-server/src/adapters/*
- apps/local-server/src/storage/*
- 任何 shell endpoint

实现步骤：
1. 定义允许 origin 常量。
2. 实现请求 origin 检查。
3. 对无 origin 的本地测试请求制定明确策略。
4. 将 origin guard 接入 server。
5. 测试错误 origin、允许 origin、pairing + origin 同时校验。

测试项：
1. 错误 origin 被拒绝。
2. 允许 origin 可继续进入 pairing 校验。
3. pairing 正确且 origin 正确时请求成功。
4. pairing 错误即使 origin 正确也被拒绝。

验收标准：
1. origin guard 可验证。
2. pairing 和 origin guard 不是二选一。
3. 没有任何命令执行或 agent 接口。

输出要求：
按以下格式回复：
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

## Prompt W1-4：Extension Health Check

```text
你是 CLI Bridge 项目的执行 Agent。

任务：只做 Week 1 extension 到 Local Server 的 health check 连通 Spike。

目标：
1. extension background 能调用 Local Server /health。
2. 请求携带 pairing token。
3. 请求带上符合 origin guard 的来源约束。
4. UI 不做 Packet、Pending Prompt、Agent 或 Codex 功能。

允许修改文件：
- apps/extension/manifest.json
- apps/extension/src/background/index.ts
- packages/shared/src/constants.ts
- 相关测试或手动验证说明

禁止修改或新增：
- apps/extension/src/content/chatgpt-dom.ts
- apps/extension/src/content/extraction.ts
- apps/extension/src/ui/bridge-panel.tsx，除非只放一个连接状态占位
- apps/local-server/src/routes/packets.ts
- apps/local-server/src/routes/pending-prompts.ts
- apps/local-server/src/adapters/*

实现步骤：
1. 检查 extension manifest 权限是否最小。
2. 在 background 中实现 health check 请求。
3. 处理连接成功、pairing 失败、origin 失败、server 不可用。
4. 加最小验证方式，允许手动或自动测试。
5. 不读取 ChatGPT 页面 DOM。

测试项：
1. server 可用且 token 正确时 health check 成功。
2. server 不可用时返回明确失败。
3. token 错误时返回 pairing 失败。
4. 不需要读取 cookie / localStorage。

验收标准：
1. extension 与 Local Server 可连通。
2. 连接路径受 pairing 和 origin guard 保护。
3. 没有进入 Week 2 DOM，也没有进入 Week 3+ 范围。

输出要求：
按以下格式回复：
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

## Prompt W2-1：ChatGPT 输入框填入 Spike

```text
你是 CLI Bridge 项目的执行 Agent。

任务：只做 Week 2 ChatGPT DOM Spike 的输入框识别和填入能力。

目标：
1. 在 ChatGPT Web 页面识别当前可输入的 prompt 输入框。
2. 将给定文本填入输入框。
3. 不自动点击发送。
4. 输入框识别失败时走 clipboard fallback。

允许修改文件：
- apps/extension/src/content/chatgpt-dom.ts
- apps/extension/src/content/clipboard.ts
- apps/extension/src/ui/bridge-panel.tsx
- apps/extension/src/ui/state.ts
- apps/extension/manifest.json，只有 host permission 必需时才改
- 相关测试文件

禁止修改或新增：
- apps/local-server/src/routes/packets.ts
- apps/local-server/src/routes/pending-prompts.ts
- apps/local-server/src/adapters/*
- apps/local-server/src/storage/*
- apps/local-server/src/security/redaction.ts
- 任何 Codex / MockAgent / Packet / Audit 实现

实现步骤：
1. 调研当前 ChatGPT 输入框 DOM，但不要依赖单一 selector。
2. 实现 findComposerInput。
3. 实现 fillComposerText。
4. 触发 input/change 事件，保证页面感知内容变化。
5. 填入失败时复制待填文本到剪贴板。
6. 面板只提供填入动作和结果状态。

测试项：
1. 输入框存在时可填入文本。
2. 输入框不存在时复制到剪贴板。
3. 不点击发送按钮。
4. 不读取 cookie / token / localStorage。

验收标准：
1. ChatGPT 输入框填入可手动验证。
2. DOM 失败有稳定 clipboard fallback。
3. 没有提取逻辑、Pending Prompt 或 Agent 逻辑。

输出要求：
按以下格式回复：
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

## Prompt W2-2：用户选区与标记区块提取 Spike

```text
你是 CLI Bridge 项目的执行 Agent。

任务：只做 Week 2 ChatGPT DOM Spike 的文本提取能力，限定为用户选区和标记区块。

目标：
1. 优先提取用户当前选中的文本。
2. 没有选区时，提取明确标记区块，例如 ## Next Prompt for Codex。
3. 不提取完整聊天历史。
4. 提取失败时提示用户选中文本或使用剪贴板手动模式。

允许修改文件：
- apps/extension/src/content/extraction.ts
- apps/extension/src/content/chatgpt-dom.ts
- apps/extension/src/content/clipboard.ts
- apps/extension/src/ui/bridge-panel.tsx
- apps/extension/src/ui/state.ts
- 相关测试文件

禁止修改或新增：
- apps/local-server/src/routes/packets.ts
- apps/local-server/src/routes/pending-prompts.ts
- apps/local-server/src/adapters/*
- apps/local-server/src/storage/*
- 任何 Pending Prompt / MockAgent / Codex 接入

实现步骤：
1. 实现 getUserSelectionText。
2. 实现 extractMarkedBlock，默认 marker 为 ## Next Prompt for Codex。
3. 限制提取范围为可见 assistant 内容或用户选区。
4. 明确失败返回，不静默读取更多历史。
5. 面板提供提取动作和结果预览。

测试项：
1. 有用户选区时返回选区文本。
2. 无选区但有 marker 时返回 marker 区块。
3. 无选区且无 marker 时返回失败状态。
4. 不混入隐藏历史。
5. 不读取 cookie / token / localStorage。

验收标准：
1. 选区优先级高于 marker。
2. marker 提取可手动验证。
3. 失败时不扩大读取范围。

输出要求：
按以下格式回复：
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

## Prompt W2-3：最后完整回复与 Streaming Guard Spike

```text
你是 CLI Bridge 项目的执行 Agent。

任务：只做 Week 2 ChatGPT DOM Spike 的 fallback 提取和 streaming guard。

目标：
1. 在没有选区和 marker 时，提取最后一条完整 assistant 回复作为 fallback。
2. 如果 ChatGPT 正在 streaming，禁止提取。
3. 不读取完整历史。
4. 不自动点击发送。

允许修改文件：
- apps/extension/src/content/extraction.ts
- apps/extension/src/content/chatgpt-dom.ts
- apps/extension/src/ui/bridge-panel.tsx
- apps/extension/src/ui/state.ts
- 相关测试文件

禁止修改或新增：
- apps/local-server/src/routes/packets.ts
- apps/local-server/src/routes/pending-prompts.ts
- apps/local-server/src/adapters/*
- apps/local-server/src/storage/*
- 任何 Agent / Codex / Packet / Audit 实现

实现步骤：
1. 实现 detectStreamingState。
2. 实现 extractLastCompleteAssistantMessage。
3. 在 streaming 状态下返回 blocked 状态。
4. fallback 只取最后一条完整 assistant 回复。
5. 在 UI 中清楚展示 blocked / success / failed。

测试项：
1. streaming 时禁止提取。
2. 非 streaming 时可提取最后完整 assistant 回复。
3. 有选区或 marker 的逻辑不被破坏。
4. 不读取完整历史。

验收标准：
1. streaming guard 生效。
2. fallback 提取可手动验证。
3. 不进入 Pending Prompt 或 Agent 投递。

输出要求：
按以下格式回复：
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

## Prompt W2-4：Clipboard Fallback 与最小 Bridge Panel

```text
你是 CLI Bridge 项目的执行 Agent。

任务：只做 Week 2 ChatGPT DOM Spike 的 clipboard fallback 和最小 Bridge Panel。

目标：
1. Bridge Panel 只暴露三个动作：填入、提取、复制。
2. DOM 填入失败时复制待填文本到剪贴板。
3. DOM 提取失败时提示用户选中文本或手动复制。
4. 不实现 Pending Prompt，不发送到 Agent。

允许修改文件：
- apps/extension/src/content/clipboard.ts
- apps/extension/src/ui/bridge-panel.tsx
- apps/extension/src/ui/state.ts
- apps/extension/src/content/chatgpt-dom.ts
- apps/extension/src/content/extraction.ts
- 相关测试文件

禁止修改或新增：
- apps/local-server/src/routes/packets.ts
- apps/local-server/src/routes/pending-prompts.ts
- apps/local-server/src/adapters/*
- apps/local-server/src/storage/*
- 任何 MockAgent / Codex / Audit / Redaction 实现

实现步骤：
1. 实现 copyTextToClipboard。
2. 将填入失败路径接到 clipboard fallback。
3. 将提取失败路径接到手动模式提示。
4. Bridge Panel 显示最近一次动作状态。
5. 保持 UI 最小，不做工作流编排。

测试项：
1. 复制动作可用。
2. 填入失败会触发复制。
3. 提取失败不会读取更多历史。
4. 面板没有发送到 Codex / Agent 的按钮。

验收标准：
1. clipboard fallback 是一等路径。
2. Panel 只做 DOM Spike 所需动作。
3. 没有 Week 3+ 范围泄漏。

输出要求：
按以下格式回复：
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

## Prompt W1/W2 Final Review：Spike 边界验收

```text
你是 CLI Bridge 项目的评审 Agent。

任务：只评审 Week 1 + Week 2 Spike 是否符合边界，不写功能代码。

评审范围：
1. Local Server Security Spike。
2. ChatGPT DOM Spike。

重点检查：
1. server 是否只监听 127.0.0.1。
2. pairing token 是否生效。
3. origin guard 是否生效。
4. /health 是否可验证。
5. extension 是否只做 health check 和 DOM Spike。
6. DOM 是否支持填入、选区提取、marker 提取、最后完整回复 fallback。
7. streaming 状态是否禁止提取。
8. clipboard fallback 是否可用。
9. 是否没有自动点击发送。
10. 是否没有读取 token / cookie / localStorage。
11. 执行端是否报告 branch / commit hash / push 状态。
12. 当前远程分支是否存在。
13. 远程最新 commit 是否等于执行端报告的 commit。
14. 是否存在本地未提交变更。
15. 是否存在本地 ahead 但未 push。
16. PR 是否存在；如存在，PR diff 是否符合 W1/W2 范围。
17. GitHub Actions / CI 是否通过；如失败，不允许进入下一阶段。
18. 是否存在范围泄漏文件已经被 push。
19. 是否可以进入下一阶段。

必须判定为失败的范围泄漏：
1. 出现 BridgePacket 实现。
2. 出现 Redaction / Audit 实现。
3. 出现 MockAgentAdapter。
4. 出现 Pending Prompt。
5. 出现 CodexManagedPtyAdapter。
6. 出现 WorkBuddy / MCP / Claude Code / app-prompt。
7. 出现任意 shell endpoint。
8. 出现 stop session 或 attach existing terminal。
9. 出现自动循环。
10. Panel 出现“发送到 Codex / Agent”按钮。
11. Panel 出现“保存 Packet / Pending Prompt”入口。
12. Extension 读取 cookie / localStorage / 页面 token。
13. 未 push 的开发结果被作为阶段完成依据。
14. 远程 branch / commit 与执行端报告不一致。
15. GitHub Actions / CI 失败但仍尝试进入下一阶段。

输出要求：
按以下格式回复：
Findings：
Open Questions：
Verification：
Manual Validation：
Remote Review：
Scope Leakage：
Decision：
```
