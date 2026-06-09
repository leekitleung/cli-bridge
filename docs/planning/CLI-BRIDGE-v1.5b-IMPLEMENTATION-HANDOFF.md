# CLI Bridge v1.5b 实现交接 —— Command Transport Review-Only Adapters

## 0. 状态

Status: IMPLEMENTATION HANDOFF（待批准本地 CLI review-only 调用）。

本文件 supersedes 早先的 v1.5b web-dom 自动发送草案。v1.5a 已实现：

```text
server outbound queue -> extension polling -> ChatGPT composer fill -> ack
```

v1.5b 不继续扩展登录态 ChatGPT Web 自动发送。新的实现方向是：用本地已授权 CLI 的
稳定非交互模式实现 review-only command transport，优先接入 Codex CLI 与 Claude Code
CLI。这样满足 roadmap 对 command transport 的前置条件，同时规避 web-dom 自动点击
ChatGPT 发送带来的账号/ToS 风险。

## 1. 本地 CLI 查证结果

查证日期：2026-06-08。

### Codex CLI

版本：

```text
codex-cli 0.135.0
```

已验证能力：

- `codex exec`: help 标题为 `Run Codex non-interactively`。
- prompt 可来自参数、`-` 或 stdin；若参数和 piped stdin 同时存在，stdin 会追加为
  `<stdin>` block。
- `codex exec -s read-only`: 支持 read-only sandbox。
- `codex exec --json`: JSONL event stream。
- `codex exec -o, --output-last-message <FILE>`: 把最终回复写入文件。
- `codex exec --output-schema <FILE>`: 可约束最终回复 shape。
- `codex exec review`: 专用非交互 code review 子命令，支持 `--uncommitted`、`--base`、
  `--commit`，也支持 `--json`、`--output-last-message`、`--output-schema`。

注意：顶层 `codex review --help` 未显示 `-s read-only`、`--json`、`-o` 等 exec 捕获
参数；因此 v1.5b 的可自动捕获路径优先使用 `codex exec ...` / `codex exec review ...`。

### Claude Code

版本：

```text
2.1.168 (Claude Code)
```

已验证能力：

- `claude -p, --print`: 非交互模式，help 明确标注 `Print response and exit (useful for pipes)`。
- `--output-format json`: 单条结构化结果输出。
- `--output-format stream-json`: 流式 JSON 输出。
- `--json-schema <schema>`: 结构化输出校验。
- `--tools ""`: 禁用所有工具。
- `--disallowed-tools` / `--disallowedTools`: 显式拒绝工具。
- `--no-session-persistence`: 非交互下不保存会话。
- `--permission-mode plan`: 可作为只规划/不执行的附加约束。

## 2. 目标

把现有 mock/clipboard review lifecycle 升级为真实本地 CLI review-only transport：

```text
AgentReviewRequest
  -> CommandTransportAdapter
  -> Codex CLI 或 Claude Code CLI 非交互 review-only 调用
  -> stdout / output file / JSON 捕获
  -> ReviewResult parser
  -> PendingReview returned
  -> optional nextPromptDraft remains draft-only
```

v1.5b 的核心价值是“真实 agent review 可自动往返”，不是“自动驱动网页发送”。本切片
不把结果自动送回源 agent，也不执行 next prompt。

## 3. 范围

允许实现：

- `CommandTransportAdapter` 基类/工具函数：只允许固定 allowlist 命令，不接受任意 shell
  string。
- `ClaudeCodeReviewCommandAdapter`：调用 `claude -p`，输出 `json`，禁用所有工具，要求
  ReviewResult JSON shape。
- `CodexReviewCommandAdapter`：调用 `codex exec review` 或 `codex exec`，使用 read-only
  sandbox、JSON/last-message 捕获、ReviewResult schema。
- EndpointRegistry 更新：把真实 CLI review endpoint 标记为 `transport: command`、
  `canReview: true`、`canExecute: false`、`risk: medium`。
- 审计：记录 command transport invocation 的工具名、版本、固定 argv 摘要、cwd、退出码、
  耗时、是否通过 schema/parser；不得记录原始未脱敏内容。
- 超时和输出上限：防止 CLI 卡住或输出爆量。
- 单元测试：用 fake process runner，不在测试里真实调用 Codex/Claude。

## 4. 硬非目标

- 不实现 web-dom 自动发送、`requestSubmit`、`.submit()`、button click 或 keyboard
  simulation。
- 不实现 ChatGPT streaming 等待或自动提取。
- 不实现真实 Codex PTY/stdin 写入。
- 不暴露任何 `/exec`、`/shell`、`/run`、`/command` HTTP endpoint。
- 不接受用户提供的任意命令、任意 argv、任意 cwd。
- 不允许 `danger-full-access`、`--dangerously-bypass-approvals-and-sandbox`、
  `--dangerously-skip-permissions`、`bypassPermissions`。
- 不自动 commit / push / merge / PR。
- 不跳过 ReviewResult / PendingPrompt 的确认门。
- 不把 raw prompt、raw CLI output、API keys、private keys 写入持久化快照。

## 5. 固定命令约束

### Claude review command

推荐 argv 形态：

```text
claude -p
  --output-format json
  --json-schema <ReviewResult.schema.json>
  --tools ""
  --disallowed-tools "Bash,Edit,Write,Read,WebFetch,WebSearch"
  --permission-mode plan
  --no-session-persistence
```

实现要求：

- prompt 通过 stdin 传入，不拼接 shell string。
- adapter 必须用 `spawn`/`spawnSync` 的 argv 数组形式，`shell: false`。
- 如 `--tools ""` 与当前 CLI 版本行为不兼容，必须 fail closed，不得回退为默认工具集。

### Codex review command

推荐 argv 形态：

```text
codex exec review
  --uncommitted
  --json
  --output-last-message <temp-file>
  --output-schema <ReviewResult.schema.json>
  --ephemeral
```

或在需要显式 sandbox 时：

```text
codex exec
  -s read-only
  --json
  --output-last-message <temp-file>
  --output-schema <ReviewResult.schema.json>
  --ephemeral
  -
```

实现要求：

- 优先验证 `codex exec review` 是否能在当前版本下满足捕获和 schema 约束。
- 如果使用通用 `codex exec`，prompt 必须明确 review-only，且 sandbox 必须为
  `read-only`。
- 禁止任何 dangerously bypass flag。

## 6. 安全模型

command transport 的风险等级为 medium：

- 账号/ToS 风险：无。调用本地授权 CLI 的非交互模式是工具预期用法。
- 执行风险：存在，但通过固定 argv allowlist、read-only/plan/no-tools、`shell: false`、
  超时、输出上限、parser/schema、人工确认门压住。
- 数据风险：输入输出都先脱敏；raw 输入只保留 memory-only；持久化只存 processed
  content 和审计摘要。

必须 fail closed 的情况：

- CLI 不存在或版本低于已验证版本。
- CLI help 不含所需非交互 flag。
- schema 文件不可读。
- CLI 退出非 0。
- 输出不是合法 JSON / ReviewResult。
- 输出包含被 parser 拒绝的执行字段：`executable`、`autoSend`、`confirmed`、`sent`。
- 运行超时或超过输出大小限制。

## 7. 数据流

```text
PendingReview confirmed
  -> CommandReviewAdapter.sendReview()
  -> fixed argv process runner
  -> capture JSON / last message
  -> parseClaudeReviewResult-compatible parser
  -> pendingReviewStore.returnResult()
  -> optional nextPromptDraft remains PendingPrompt draft
```

不新增通用 HTTP execution surface。若后续需要 HTTP route，只能是固定 review action，如
`POST /bridge/reviews/send-command`, 且仍必须走 pairing token、origin guard、endpoint
capability gating 和 confirmed review gate。本切片优先保持 library/store 层实现，不急
着暴露 HTTP。

## 8. 验收门禁

- `CommandTransportAdapter` 使用 argv 数组 + `shell: false`，测试覆盖。
- adapter 拒绝未知 command、未知 endpoint、危险 flag、非 review capability。
- Claude adapter argv 包含 `-p`、`--output-format json`、工具禁用约束。
- Codex adapter argv 包含非交互调用、JSON/last-message 捕获、schema 或 read-only 约束。
- fake runner 返回合法 ReviewResult 时，PendingReview 进入 `returned`。
- fake runner 返回执行字段、坏 JSON、非 0 exit、超时、超大输出时，review 进入失败路径。
- nextPromptDraft 仍是 draft，不能自动 confirm/send。
- 全仓仍无 web-dom auto-send：无 `requestSubmit`、`.submit(`、发送 button click、全局
  KeyboardEvent。
- 仍无 shell-style HTTP endpoint。
- 本地 gate 全过：

```text
npm run build-extension
npm run lint
npm run typecheck
npm test
```

## 9. 文档同步要求

实现前必须同步：

- 新增 ADR-0002：记录 v1.5b 从 web-dom 自动发送改为 command transport。
- 更新 ADR-0001 或 roadmap overlay：标记 web-dom 自动发送为 superseded/deferred。
- 保留 v1.5a outbound fill queue；它仍可作为手动 ChatGPT Web 辅助路径。

## 10. 立即下一步

1. 项目负责人批准：允许本地 Codex CLI / Claude Code CLI 以固定 review-only 非交互模式
   被 CLI Bridge 调用。
2. 先实现 process runner allowlist + tests。
3. 再实现 Claude adapter、Codex adapter。
4. 最后接入 EndpointRegistry / PendingReview lifecycle，保持所有结果为 review result，
   不自动执行 follow-up。

未批准前，不编写 command transport 调用代码。
