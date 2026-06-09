# CLI Bridge v1.6 合并前 Self-Review 清单

## 0. 用途

`feat/v1.6-review-http-endpoints` 合并进 `main` 前的人工审查清单。范围：
`main` → HEAD(84c3d95)，3 commit、7 文件。

切片目标：把 v1.5b 的 review-only command transport 从库函数接到认证的 HTTP 端点
（`/bridge/reviews*`），使「自动 review」成为用户可运行路径。

门禁客观结果（合并前实测）：
- build / lint / typecheck / test 全过（167/167，含 6 个新 review HTTP 测试）。
- 真机 HTTP 闭环验证通过（见 `docs/planning/CLI-BRIDGE-v1.6-VALIDATION-HANDOFF.md` §6）。

## 1. 安全边界审查（重点）

| 关注点 | 现状 | 机制 | 证据 |
| --- | --- | --- | --- |
| dispatch 执行真实 CLI | 受控开启 | 仅 review-only command endpoint 可 dispatch；走 command-runner allowlist + shell:false | bridge-reviews-api 测试 + 真机 H4 |
| 人工确认门 | 保留 | dispatch 要求 review 已 `confirmed`，否则 409 | 真机 H2（未确认→409） |
| 不自动执行 follow-up | 保留 | nextPromptDraft 落为 draft pending prompt，需另行确认 | v1.6 单测断言 draft |
| 目标端点限制 | 受控 | 非 review-only command endpoint 创建即 400 | 单测「rejects non-runnable target」 |
| 无 shell 端点 | 保留 | dispatch 路径命名避开 /run/exec/command/shell；safety 测试收紧为路由字面量匹配 | local-server forbidden-pattern 测试 |
| 凭据可见性 | 新增 | server 启动打印 pairing token 到本地终端（127.0.0.1 only） | server.ts |

## 2. 按 commit 审查

### 2.1 `2bbaa28` Expose review-only command transport over /bridge/reviews
- 改：bridge-api 加 review store + registry + 命令 adapter 到 runtime；新增
  `GET/POST /bridge/reviews`、`/confirm`、`/dispatch`、`/cancel`。adapter 可注入
  （`reviewAdapterFor`）供测试用 fake，不 spawn 真实 CLI。
- 审查点：
  - dispatch 前强制 confirmed（sendConfirmed 失败即 409）。
  - 仅 `REVIEW_COMMAND_ADAPTERS` 内的 target 可创建/运行。
  - 成功只返回 ReviewResult + draft follow-up；失败 fail-closed，不建 prompt。
- 附带安全测试调整：`local-server.test.mjs` 的 forbidden-pattern 检查从「裸子串
  includes」收紧为「路由字面量正则」。**审查重点**：确认它仍拦真实 `/exec` `/shell`
  `/run` `/command` 端点，只是不再误伤 `command-review-adapter.ts` 这类文件名。

### 2.2 `edc770b` Add v1.6 review HTTP validation handoff
- 改：纯文档，curl 验证序列。origin 用 `https://chatgpt.com`（在 ALLOWED_ORIGINS 内）。

### 2.3 `84c3d95` Print pairing token on local server startup
- 改：启动脚本多打印一行 pairing token（仅 isMainModule 路径，不影响请求处理）。
- 审查点：token 是本地认证凭据，打印到本地终端是预期用法（用户需它配对）；server 仅绑
  127.0.0.1，未扩大暴露面。

## 3. 真机验证证据（2026-06-09）

见 v1.6 验证交接 §6。H1–H4 全过：previewed → 未确认 dispatch 409 → confirmed →
dispatch 调真实 Claude CLI → returned + result.summary。H5（Codex）/H6（draft）由
v1.5b 真机 + v1.6 单测覆盖。

## 4. 已知未覆盖 / 注意

- H5/H6 未在 HTTP 路径单独复跑（同代码路径，已由单测 + v1.5b 真机覆盖）。
- review 状态仍在内存（除非配置 CLI_BRIDGE_DATA_DIR；review 未纳入 snapshot 持久化，
  与 v1.5b 一致——若需要 review 跨重启，是后续切片）。
- 浏览器面板未接 review 端点（命令行/HTTP 可用即可，UI 是后续）。

## 5. 合并建议

- 技术门槛：满足（门禁 167/167 + 真机 HTTP 闭环通过）。
- 建议方式：`--no-ff`，保留 3 个 commit 边界。
- 合并前确认 main 无落后；网页有 CI 则确认绿。
- 合并由项目负责人执行。
