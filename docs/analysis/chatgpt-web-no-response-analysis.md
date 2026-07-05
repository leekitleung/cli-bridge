# ChatGPT Web 策略端无响应根因分析报告

**日期**: 2026-07-04
**问题**: 对话时 ChatGPT Web 策略端未能得到响应，一直处于等待中
**模式**: 分析 / 文档更新 + 代码修复
**修订**:
- 2026-07-04 23:42 — 根据现场证据补充"offline 直接原因"章节（见下文 P0）
- 2026-07-05 — 修正 P0 证据强度、扩展 reload 后的 session 重建步骤，以及 P1 超时阶段描述
- 2026-07-05 06:10 — 执行 P1 根因 #1 和 #2 的代码修复（见下文"已执行修复"章节）

---

## P0 · offline 的直接原因（文档初版遗漏，现场证据补充）

初版文档的五个根因解释的是"连上后等不到回复"，**不能解释当前的 `source relay offline`**。
现场 live 证据：

- server 有 pending `hi`，但 `connected: false`。
- `isExtensionConnected()` 只看 heartbeat（`chatgpt-web-source-adapter.ts:64-67`：`heartbeat` 为 null 或距 `lastHeartbeatAt` 超过 60s 即判定 offline）。
- 心跳路由 `bridge-api.ts:3711-3724` 记录心跳，状态查询 `bridge-api.ts:3777` 读 `isExtensionConnected()`。
- **结论**：当前没有心跳打到 `/bridge/source/chatgpt-web/heartbeat`。

直接原因有两层：

1. **Chrome 仍在跑旧扩展脚本**（最直接现场证据）
   - Chrome telemetry 里 content hash 是 `20E900...`，与当前 `apps/extension/dist/content/index.js` 的 `shasum` 不一致。
   - background / popup hash 也不一致。
   - 说明"刷新页面"没有让 unpacked extension 重新加载新 dist。必须在
     `chrome://extensions/?id=fhchgdnhoghcjnlajjhejikndobkenmi` 点扩展卡片的 reload 按钮，或重启 Chrome。

2. **streaming 误判可能阻塞 heartbeat**（已在源码修复，但 Chrome 未加载当前 dist）
   - `source-relay-poller.ts:102-128` 当前已改为先 heartbeat（行 104-123），再判断 streaming（行 125-128）。
   - 若运行中的旧脚本仍是先 streaming 后 heartbeat，ChatGPT 页面一旦被误判 streaming，就永远不发心跳，Console 一直 offline。
   - 目前 hash 不一致只能证明 Chrome 没加载当前 dist；除非反查旧 bundle 内容，不能把"旧脚本一定是旧顺序"当作已证实事实。
   - 因此这条是合理候选根因：源码修复必须先通过 extension reload 进入 Chrome，现场现象才可能改变。

**修复动作（用户侧，不涉及代码）**：
1. 在 `chrome://extensions/?id=fhchgdnhoghcjnlajjhejikndobkenmi` 点 reload，或重启 Chrome。
2. 用 `shasum -a 256 apps/extension/dist/content/index.js apps/extension/dist/background/index.js apps/extension/dist/popup/index.js` 计算当前 dist hash，并确认 Chrome telemetry 中对应 hash 已更新为同一组值。不要写死某一次 build 的 hash。
3. extension reload 会清空 `chrome.storage.session`；server 重启也会清空本地 auto-pair session store。reload 后必须重新打开/刷新 Project Console 触发 auto-pair，再刷新 ChatGPT 页面，让 content script 重新读取 token 并发送 heartbeat。
4. 再查 `/bridge/source/chatgpt-web/status`，确认 `connected: true`。
5. server 侧 `127.0.0.1:31337/health` 已返回 ok；只要 health 正常，offline 的直接排查重点不在 server 启动状态。

---

## P1 · 连上后等不到回复的根因（按概率排序）

---

## 问题现象

CLI Bridge 在对话流程中，将 prompt 发送到 ChatGPT Web 策略端后，响应迟迟不返回，
调用方一直处于等待状态。

## 架构背景

项目存在 **两条并行的 relay 路径**，把 prompt 发到 ChatGPT Web 并等待回复：

| 路径 | 入口 | 扩展轮询器 | 结果回传 |
|------|------|-----------|---------|
| **Source Relay (ADR-0035)** | `plan()` → `queue.enqueue()` | `source-relay-poller.ts` | `POST /bridge/source/chatgpt-web/results` |
| **Outbound Prompt (v0.2)** | `POST /bridge/outbound` | `outbound-poller.ts` | `POST /bridge/extract-return` |

两条路径共享相同的 DOM 操作代码（`extraction.ts`、`chatgpt-dom.ts`）。

---

## 五个根因（按概率排序）

### 根因 #1（最高概率）: 服务端与扩展端超时严重不匹配

**文件**:
- `apps/local-server/src/conversation/chatgpt-web-source-adapter.ts:215` — 服务端 `resultTimeoutMs = 15_000`（15 秒）
- `apps/extension/src/content/extraction.ts:262` — 扩展端 `waitForStableAssistantResponse` 默认 `timeoutMs = 60_000`（60 秒）

**问题**:
- 服务端 `plan()` enqueue source request 后立刻调用 `waitForResult(queue, requestId, 15000)`，只等 15 秒。这个等待阶段不要求 source relay 已经 online，也不要求 task 已经被 extension claim；因此它解释"等待结果超时"，但不决定 `connected:true/false`。
- 扩展端 `source-relay-poller.ts:166` 调用 `waitForStableAssistantResponse` 未传 `timeoutMs`，等 60 秒。
- 当 ChatGPT 回复超过 15 秒时：
  1. 服务端 15 秒后超时返回 `intent: 'blocked'`，visibleText: "ChatGPT Web did not respond in time."
  2. 扩展端仍在 60 秒 poll 循环中等待。
  3. 扩展端最终拿到响应并 POST 回服务端，但调用方早已放弃。
- **初始化点确认**: `bridge-api.ts:1600` 调用 `createChatGptWebSourceAdapter({ queue: chatGptWebQueue })` 未传 `config`，`resultTimeoutMs` 无任何配置覆盖入口。

**最新提交矛盾**: HEAD commit `4b6bbad` 标题 "make chatgpt source replies asynchronous"，但 `plan()` 仍然是同步 `await waitForResult()`，并没有变成真正的异步（fire-and-forget + later pickup）。

---

### 根因 #2（高概率）: activeRelaySession 失败时不清理，阻塞后续 10 分钟

**文件**:
- `apps/extension/src/content/outbound-poller.ts:89-92, 148-215`
- `apps/extension/src/content/active-relay-session.ts:53` — `ACTIVE_RELAY_SESSION_TTL_MS = 600_000`（10 分钟）

**问题**:
- `outbound-poller.ts:89-92`: 如果 `getActiveRelaySession()` 返回非 null，tick 直接 `return null`，跳过所有新 prompt。
- auto-relay 流程（行 142-218）是串行 `await` 链，任何中间步骤失败都执行 `markOutboundPromptStage(id, 'failed', ...)` 然后 `return fillResult`。
- **关键缺陷**: 所有失败分支（行 148-156, 159-163, 171-175, 178-188, 190-194, 201-208, 211-215）都**不调用 `cancelActiveRelaySession()`**。
- 只有成功走到行 217 才清理。失败后 session 残留 10 分钟，期间所有新 prompt 被标记 `waiting: active-session` 跳过。

**触发条件**: submit 失败、stage ack 409、response 超时、extract-return 409 中的任一情况。

---

### 根因 #3（中概率）: DOM 选择器失效导致流式检测永远返回 false

**文件**: `apps/extension/src/content/extraction.ts:40-45, 188-196`

**选择器**:
```
STREAMING_SELECTORS = [
  '[data-testid="stop-button"]',
  'button[aria-label*="Stop"]',
  '[aria-busy="true"]',
  '[data-is-streaming="true"]',
]
```

**问题**:
- 如果 ChatGPT Web 更新 DOM 结构（移除或改名 `stop-button`），`detectStreamingState` 永远返回 false。
- 此时 `waitForStableAssistantResponse`:
  - 如果页面上有旧 assistant 消息 → 立即返回**错误的旧回复**（不会挂起但返回错误内容）。
  - 如果是新会话无 assistant 消息 → poll 到 60 秒超时返回 `not-found`。
- `extractLastCompleteAssistantMessage` 依赖 `[data-message-author-role="assistant"]`，若属性名变更同样失效。

---

### 根因 #4（中概率）: MV3 service worker 休眠导致 background proxy 失效

**文件**: `apps/extension/src/content/bridge-client.ts:44-46, 72-103`

**问题**:
- `canUseBackgroundProxy()` 检测 `chrome.runtime.sendMessage` 存在即返回 true。
- MV3 下 service worker 30 秒不活动会被休眠，`sendMessage` 可能长时间不回调。
- 虽有 10 秒 timeout 兜底（`BRIDGE_FETCH_TIMEOUT_MS = 10_000`），但 timeout 后请求已失败，扩展的 stage/ack/extract-return 全部 `network-error` → 触发根因 #2 的 session 残留。
- timeout 触发后不 abort `chrome.runtime.sendMessage`，回调仍可能在之后触发产生竞态。

---

### 根因 #5（低概率）: 状态机严格前置条件 + 网络乱序导致 409 级联失败

**文件**: `apps/local-server/src/storage/outbound-prompt-store.ts:197-276`

**状态机**:
```
queued → claimed → waiting_manual_send → submitted → responding → response_ready → returned
                                                              ↘ failed/expired/cancelled
```

**问题**:
- `markResponding` 要求 `submitted`，`markResponseReady` 要求 `responding`，`markReturned` 要求 `response_ready`。
- 如果 stage 请求因网络抖动乱序或丢失，后续全部 409。
- 扩展拿到 409 后标记 `failed` 但不清理 `activeRelaySession`（叠加根因 #2）。
- `recoverStaleClaims` 行 182-193: `claimed` 状态超过 60 秒自动 `failed`，页面加载慢时 claim lease 可能在 ack 前过期。

---

## 超时值汇总

| 位置 | 超时 | 默认值 | 备注 |
|------|------|--------|------|
| `extraction.ts:262` | 响应稳定检测 | 60,000ms | 扩展端 |
| `chatgpt-web-source-adapter.ts:215` | **服务端等结果** | **15,000ms** | **与扩展端严重不匹配** |
| `chatgpt-dom.ts:70` | 提交确认 | 5,000ms | |
| `bridge-client.ts:19` | HTTP 请求 | 10,000ms | |
| `outbound-prompt-store.ts:51` | claim 租约 | 60,000ms | |
| `active-relay-session.ts:53` | 活跃 session | 600,000ms | 10 分钟，失败不清理 |
| `outbound-poller.ts:60` | 轮询间隔 | 3,000ms | |

---

## 修复建议（按优先级）

1. **根因 #1**: 将服务端 `resultTimeoutMs` 从 15s 提至 90s（覆盖 ChatGPT 长回复场景），或在 `bridge-api.ts:1600` 传入 `config: { resultTimeoutMs: 90_000 }`。
2. **根因 #1 补充**: `source-relay-poller.ts:166` 的 `waitForAssistantResponse` 应显式传 `timeoutMs`，与服务端 `resultTimeoutMs` 协调（扩展端应略大于服务端）。
3. **根因 #2**: `outbound-poller.ts` 所有失败分支（行 148-215）补加 `cancelActiveRelaySession('failed')` 调用。
4. **根因 #3**: 增加 fallback DOM 选择器，考虑用 `data-message-id` 或新增的 ChatGPT DOM 属性检测流式状态；增加选择器失效的日志告警。
5. **根因 #4**: `bridgeFetch` timeout 后应主动 abort；考虑 content script 直接 fetch 作为 fallback（CORS 允许时）。
6. **根因 #5**: 状态机可考虑允许从 `submitted` 直接到 `response_ready` 的跳跃转换，或对 409 做有限重试。

---

## 受影响文件清单

| 文件 | 关键行 | 角色 |
|------|--------|------|
| `apps/local-server/src/conversation/chatgpt-web-source-adapter.ts` | 215, 239, 266-281 | 服务端等待逻辑 |
| `apps/local-server/src/routes/bridge-api.ts` | 1600 | adapter 初始化 |
| `apps/extension/src/content/outbound-poller.ts` | 89-92, 142-218 | outbound 轮询+session 管理 |
| `apps/extension/src/content/source-relay-poller.ts` | 166 | source relay 轮询 |
| `apps/extension/src/content/extraction.ts` | 40-45, 188-301 | DOM 检测+等待稳定 |
| `apps/extension/src/content/active-relay-session.ts` | 53, 125-130, 169-172 | session 生命周期 |
| `apps/extension/src/content/bridge-client.ts` | 19, 44-46, 72-103 | HTTP 代理 |
| `apps/extension/src/content/chatgpt-dom.ts` | 380-405, 451-495 | 提交+确认 |
| `apps/local-server/src/storage/outbound-prompt-store.ts` | 168-276 | 状态机 |

---

## 已执行修复（2026-07-05 06:10）

### 修复 1: 服务端 resultTimeoutMs 15s → 90s

**文件**:
- `apps/local-server/src/conversation/chatgpt-web-source-adapter.ts:215` — 默认值从 `15_000` 改为 `90_000`
- `apps/local-server/src/routes/bridge-api.ts:1600` — 初始化时显式传入 `config: { resultTimeoutMs: 90_000 }`

**效果**: ChatGPT 回复超过 15 秒时，服务端不再先于扩展端放弃。覆盖绝大多数长回复场景。

### 修复 2: source-relay-poller 显式传 timeoutMs

**文件**: `apps/extension/src/content/source-relay-poller.ts`
- 新增 `DEFAULT_RESPONSE_TIMEOUT_MS = 100_000`（100s，略大于服务端 90s）
- 新增 `responseTimeoutMs` 可注入选项
- 默认 `waitForAssistantResponse` 实现现在传 `timeoutMs: responseTimeoutMs`

**效果**: 扩展端等待 100s，服务端等 90s。扩展端永远比服务端多等 10s，确保扩展端不会在服务端还没放弃时就超时返回 `not-found`。

### 修复 3: outbound-poller 失败分支清理 activeRelaySession

**文件**: `apps/extension/src/content/outbound-poller.ts`
- 7 个失败分支（submit-failed / submitted-ack-failed / responding-ack-failed / response-not-ready / response-ready-ack-failed / return-failed / returned-ack-failed）全部补加 `cancelActiveRelaySession()` 调用

**效果**: auto-relay 流程中任何步骤失败后立即清理 session，不再残留 10 分钟阻塞后续 prompt。

### 验证

- `npm run typecheck` — 通过
- `tests/outbound-poller.test.mjs` — 12/12 通过
- `tests/source-relay-poller.test.mjs` — 3/3 通过
- `tests/extension-loop-panel.test.mjs` 有 1 个 pre-existing failure（工作区其他未提交改动导致，与本次修复无关——已通过二分法确认：还原本次 3 处改动后该测试仍失败）
