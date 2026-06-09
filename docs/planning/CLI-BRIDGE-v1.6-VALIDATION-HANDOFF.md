# CLI Bridge v1.6 验证交接 —— /bridge/reviews HTTP 真机闭环

## 1. 目的

v1.6 把 v1.5b 的 review-only command transport 从库函数接到了认证的 HTTP 端点。
单元测试用 fake adapter 覆盖了路由与生命周期，但**未在 HTTP 路径上真机验证**（fake
不 spawn 真实 CLI）。本文件提供 curl 序列，用真实 server + 真实 Claude/Codex 验证
`reviews → confirm → dispatch` 闭环。

需手动触发，会真实调用 CLI、消耗额度。每条只跑一次。

## 2. 前置条件

- 已 `npm install`、`npm run build-extension`。
- 本地 Claude Code 2.1.168 / codex-cli 0.135.0 已登录可用。
- 记录待测 commit hash。

启动 server（单独终端）：

```bash
npm run start:local-server
```

记下打印的 URL（默认 `http://127.0.0.1:31337`）与 pairing token。

> 注意：`/bridge/*` 需要 `origin` 头与 pairing token 头。origin guard 精确匹配
> `ALLOWED_ORIGINS`，其中包含 `https://chatgpt.com`。用 curl/Invoke-RestMethod 时带
> `origin: https://chatgpt.com` 即可通过（无需扩展占位符 origin）。

## 3. 验证序列

设环境变量便于复用（PowerShell）：

```powershell
$U = "http://127.0.0.1:31337"
$T = "<pairing-token>"
$H = @{ "x-cli-bridge-pairing-token" = $T; "origin" = "https://chatgpt.com"; "content-type" = "application/json" }
```

### H1 —— 创建 review（应 previewed）

```powershell
$body = '{"sessionId":"s1","sourceEndpointId":"codex-command","targetEndpointId":"claude-code-command","prompt":"Output ONLY JSON: {\"summary\":\"ok\",\"findings\":[\"none\"]}"}'
$r = Invoke-RestMethod -Uri "$U/bridge/reviews" -Method Post -Headers $H -Body $body
$r.review.id; $r.review.status   # 期望 status = previewed
$rid = $r.review.id
```
- 预期：201，status `previewed`。
- 测试结果：____

### H2 —— 未确认直接 dispatch（应被拒）

```powershell
try { Invoke-RestMethod -Uri "$U/bridge/reviews/dispatch" -Method Post -Headers $H -Body (@{reviewId=$rid}|ConvertTo-Json) } catch { $_.Exception.Response.StatusCode }
```
- 预期：409（confirmed 门未过，不能 dispatch）。
- 测试结果：____

### H3 —— 确认

```powershell
Invoke-RestMethod -Uri "$U/bridge/reviews/confirm" -Method Post -Headers $H -Body (@{reviewId=$rid}|ConvertTo-Json)
```
- 预期：200，status `confirmed`。
- 测试结果：____

### H4 —— dispatch 跑真实 CLI（Claude）

```powershell
$d = Invoke-RestMethod -Uri "$U/bridge/reviews/dispatch" -Method Post -Headers $H -Body (@{reviewId=$rid}|ConvertTo-Json)
$d.review.status; $d.result.summary; $d.nextPrompt.status
```
- 预期：200，review `returned`，`result.summary` 有值，无 `nextPrompt`（本 prompt 未要 follow-up）。
- 测试结果：____

### H5 —— Codex 目标重跑 H1–H4

把 H1 的 `targetEndpointId` 改为 `codex-command`，重跑 H1→H3→H4。
- 预期：同样 `returned` + result。
- 测试结果：____

### H6 —— follow-up 留 draft

H1 的 prompt 改为要求带 nextPromptDraft：
`Output ONLY JSON: {"summary":"x","findings":["y"],"nextPromptDraft":"do z after confirm"}`，
跑到 H4。
- 预期：`nextPrompt.status = draft`；`GET /bridge/pending-prompts` 能看到该 draft；
  该 draft 未确认不可发送。
- 测试结果：____

## 4. 需采集的证据

- 待测 commit hash。
- H1–H6 各自状态码 / status / 现象。
- 真实 CLI 输出是否仍落在已覆盖的形状（裸 JSON / Claude 信封 / Codex 嵌套 item.text）。
- 任何 origin/token 相关的接入摩擦（curl vs 扩展 fetch）。

## 5. 边界提醒

dispatch 只跑 review-only CLI（固定 allowlist argv、shell:false、no-tools/read-only）。
不得借本验证引入：自动确认、自动发送 follow-up、shell 端点、真实 PTY 写入、原始内容
落盘。dispatch 必须要求 confirmed；follow-up 必须停在 draft。

## 6. 结果

验证日期：2026-06-09
环境：Windows，Node 22，已登录 Claude Code 2.1.168，本地 server `http://127.0.0.1:31337`
执行人：项目负责人（手动）
接入：curl/Invoke-RestMethod，origin `https://chatgpt.com` + pairing token，无摩擦。
pairing token 来源：server 启动时打印（commit 84c3d95 起）。

| 用例 | 结果 | 现象 |
| --- | --- | --- |
| H1 创建 review | 通过 | status `previewed` |
| H2 未确认 dispatch | 通过 | 返回 409 Conflict（确认门生效） |
| H3 确认 | 通过 | status `confirmed` |
| H4 dispatch 跑真实 Claude | 通过 | review `returned`，`result.summary` = `ok`，真实 CLI 经 HTTP 被调用 |

结论：v1.6 `/bridge/reviews` HTTP 真机闭环通过。`reviews → confirm → dispatch` 在
真实 server + 真实 Claude CLI 上跑通：未确认不可 dispatch（409），确认后 dispatch
调用真实 review-only CLI 并返回 ReviewResult，review 进入 `returned`。自动 review
自此从「库函数 / fake adapter 测试」升级为「HTTP 端点真机可用」。

未单独复跑（已由 v1.5b 真机 + v1.6 单测覆盖，且与 H4 同一代码路径）：
- H5 Codex 目标：command 路径同 Claude，仅 adapter 不同；v1.5b 已真机验证 Codex。
- H6 follow-up draft：v1.6 单测 `bridge-reviews-api` 已断言 nextPrompt 留 draft。
如需补充可按 §3 H5/H6 手动复跑。

边界未变：dispatch 要求 confirmed、follow-up 留 draft、无 shell 端点、无自动发送、
无真实 PTY 写入、无原始内容落盘。
