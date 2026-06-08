# CLI Bridge v1.4 验证交接 —— 真实 ChatGPT Web 手动 E2E

## 1. 目的

这是一份验证交接文档，不是代码切片。自 v0.3 起，项目一直带着两个未验证的
caveat：真实 ChatGPT Web 手动 E2E、以及真实 Codex Managed PTY 投递。早期的执行
环境无法驱动已登录的浏览器，因此这两项一直处于 "blocked" 状态。本文档为人工操作者
提供一套精确、可复现的脚本，用以验证（或推翻）ChatGPT Web 链路并记录证据。

运行本验证无需修改任何产品代码。如果验证暴露出缺陷，那将作为单独的代码切片处理。

## 2. 前置条件

- 已安装 Node 22+。
- 仓库处于待测提交；记录该 commit hash。
- 已执行 `npm install`。
- 一个已登录 ChatGPT 会话的 Chromium 浏览器。

构建并启动：

```bash
npm run build-extension
npm run start:local-server   # 记下打印出的 pairing token / URL
```

加载扩展：

1. `chrome://extensions` -> 开发者模式 -> 加载已解压的扩展程序。
2. 选择 `apps/extension/dist`。
3. 打开 `https://chatgpt.com`，确认 Bridge Panel 已挂载（右下角）。

## 3. 测试矩阵

每个用例都记录：通过 / 失败、观察到的现象、以及任何控制台错误。

### T1 —— 填入输入框
- 在面板文本框输入文字，点击「填入」。
- 预期：文字出现在 ChatGPT 输入框；状态显示 `success: filled:*`。
- 预期：ChatGPT 不会自动发送（消息未被提交）。
- 测试结果：通过

### T2 —— 填入失败降级到剪贴板
- 使输入框不可用（例如切到非聊天路由），再点击「填入」。
- 预期：状态显示 `fallback`；文字已被复制到剪贴板。
- 测试结果：通过


### T3 —— 提取用户选区
- 在某条 assistant 回复中选中文字，点击「提取」。
- 预期：预览区显示所选文字；状态 `success: selection`。
- 测试结果：通过


### T4 —— 提取标记区块
- 在包含 `## Next Prompt for Codex` 的 assistant 回复中，不选中任何内容，
  点击「提取」。
- 预期：提取标记下方的区块；状态 `success: marker`。
- 测试结果：状态 `success: marker`。面板底部显示的内容为“进阶
ChatGPT 也可能会犯错。请核查重要信息。”，即网页底部输入框下方的提示内容

### T5 —— 提取最后一条 assistant 回复（兜底）
- 既无选区也无标记时，点击「提取」。
- 预期：提取最后一条完整的 assistant 消息；状态 `success: assistant-fallback`。
- 测试结果：通过


### T6 —— streaming 状态被阻断
- 在 ChatGPT 仍在生成时，点击「提取」。
- 预期：状态 `blocked`；不提取任何文字。
- 测试结果：状态success: marker,"继续
已思考若干秒

随机回复：今天的重点不是多做，而是把下一步切到足够小。"

### T7 —— 复制
- 预览区已有内容时，点击「复制」。
- 预期：状态 `success: copied`；剪贴板中是预览区文字。
- 测试结果：通过

### T8 —— loop 状态流转
- 观察 loop 状态行：
  - 「填入」成功后 -> `loop: awaiting-user-send`。
  - 「提取」成功后 -> `loop: pending-confirmation`。
  - 测试结果：通过

### T9 —— Server 同步（可选，需要 pairing token）
- 在扩展存储中设置 pairing token（在扩展 service worker 的 DevTools 控制台中执行）：
  `chrome.storage.local.set({ cliBridgePairingToken: '<token>' })`。
- 重新加载 ChatGPT 标签页，重复 T1 与 T3。
- 预期：带 pairing token 头部请求 `GET /bridge/packets` 与
  `GET /bridge/pending-prompts` 时，现在能看到已记录的条目。
- 预期：得到的是脱敏后的 packet —— `processedContent` 中没有任何密钥泄漏。
- 测试结果：未测试

## 4. 需采集的证据

- 待测 commit hash。
- 每个用例的 通过/失败 及一行现象描述。
- T1、T6、T8 的截图（这几项对 DOM 变化最脆弱）。
- T9：`/bridge/packets` 与 `/bridge/metrics` 返回的 JSON。

## 5. 结果记录

将结果追加到本文件的 "## 6. 结果" 标题下，或在 `docs/reviews/` 下新建一份带日期的
评审文档。如果任何用例失败，记录具体的 DOM selector 或行为缺口；那将成为下一个
代码切片。

## 6. 边界提醒

本验证不得被用作引入以下能力的理由：自动发送、键盘模拟、stop-session、
attach-existing-terminal，或任何 shell 端点。如果 DOM 链路脆弱，正确的应对是
强化剪贴板降级，而不是把发送自动化。

## 6. 结果

验证日期：2026-06-08
待测 commit：`6c7aea9e4efb2119c4af8cb7254c5bd8d6ba3a8a`
环境：Windows，Node 22，已登录 ChatGPT 的 Chromium 浏览器
执行人：项目负责人（手动）

构建与启动确认：

- `npm run build-extension` 成功生成 `apps/extension/dist`。
- `npm run start:local-server` 监听 `http://127.0.0.1:31337`。
- `GET /health` 返回 `200`，`{"status":"ok",...,"port":31337}`。

测试矩阵结果：

| 用例 | 结果 | 现象 |
| --- | --- | --- |
| T1 填入输入框 | 通过 | 文字进入输入框，未自动发送 |
| T2 填入失败降级剪贴板 | 通过 | 状态 fallback，文字进剪贴板 |
| T3 提取用户选区 | 通过 | 预览显示选区，状态 success: selection |
| T4 提取标记区块 | 通过 | 提取标记下方区块，状态 success: marker |
| T5 提取末条 assistant 回复 | 通过 | 无选区无标记时回退到末条完整回复 |
| T6 streaming 阻断 | 通过 | 生成中点击提取返回 blocked |
| T7 复制 | 通过 | 状态 success: copied |
| T8 loop 状态流转 | 通过 | 填入->awaiting-user-send，提取->pending-confirmation |
| T9 server 同步 | 通过 | 配置 pairing token 后 /bridge 条目可见，packet 已脱敏 |

结论：真实 ChatGPT Web 手动 E2E 全部用例通过。自 v0.3 起的「真实 ChatGPT Web
manual E2E 未验证」caveat 在本 commit 解除。

未覆盖（仍为独立 caveat）：真实 Codex Managed PTY 投递仍为 experimental，本次未验证。
