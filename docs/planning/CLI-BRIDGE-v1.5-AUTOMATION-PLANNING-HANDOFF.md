# CLI Bridge v1.5 规划交接 —— 解冻自动化 / 两端数据自动贯通

## 0. 状态

Status: SUPERSEDED IN PART.

本文件记录 v1.5 初始方向 B 与 v1.5a 出站填入切片。v1.5b 的 web-dom 自动发送路线已由
`docs/planning/ADR-0002-v1.5b-command-transport.md` supersede；活跃 v1.5b 路线改为
本地 Codex CLI / Claude Code CLI 的 review-only command transport。

历史状态：PLANNING（需求优先）+ 安全边界反转决策待批。

本文件**不是**代码切片。它记录一次产品方向的根本性转变，并把它拆成可逐个审批的
受限切片。在你（项目负责人）对 §3 的安全边界反转明确签字之前，不得编写任何
自动发送 / 自动驱动登录态 ChatGPT 网页 / 真实 PTY 投递的代码。

## 1. 背景与触发

v1.4 验证后得出的诚实判断：在 clipboard-first + 全部自动化被禁的护栏下，浏览器
插件是**负价值**的——它把"选中→复制→粘贴"这套零依赖、永不损坏的系统级动作，换成
了一个随 ChatGPT 改版即碎、需要构建/加载/配对的脆弱中间层，却**没有消除任何一次手
动操作**（仍需手动发送、手动切窗口、手动粘回终端）。

项目负责人据此选择方向 B：**解冻自动化，让一端的数据自动联通另一端**，而不是继续
维护半自动插件，也不是退回纯 CLI + 剪贴板。

关键认知修正：插件之前"失败"不是因为它是插件，而是因为护栏禁掉了它唯一能省事的能
力。登录态的 ChatGPT 网页**没有本地 API**，能程序化驱动它（自动注入 + 自动发送 +
流结束后自动提取）的唯一现实载体就是浏览器扩展。解冻后，插件正是 ChatGPT 端的自动
适配器；它从"多余的剪贴板替身"变成"不可替代的自动化端点"。

## 2. 目标数据回路

```text
Codex 输出
  -> 本地 server 出站队列（脱敏 + 审计）
  -> 插件轮询取走
  -> 自动注入 ChatGPT 输入框
  -> 自动点击发送            (新增，高风险)
  -> 等待流式结束           (新增)
  -> 自动提取完整回复        (新增，自动触发)
  -> 回传 server（脱敏 + 审计）
  -> 自动投递回 Codex（真实 PTY / stdin）  (新增，高风险)
```

今天已具备：脱敏、审计、BridgePacket、PendingPrompt 生命周期、loop store、
`/bridge` HTTP 端点、插件的 Fill/Extract/Copy DOM 能力、JSON 持久化。

今天**缺**的三块，正是 v1.5 要建的：

1. 插件侧：出站队列轮询 + 自动注入 + **自动发送**。
2. 插件侧：流式结束探测 + **自动提取**并回传。
3. server/CLI 侧：**真实 Codex 投递适配器**（替换 MockAgentAdapter 的空壳 PTY）。

## 3. 安全边界反转（需签字）

以下条目在 README「Security boundaries」与 ROADMAP §6 中目前是**硬禁止**。方向 B
要求把它们从「禁止」改为「受限开启」。这是本文件的核心待批项：

| 原护栏 | v1.5 提议状态 | 约束条件 |
| --- | --- | --- |
| 不得自动点击 ChatGPT 发送 | 受限开启 | 仅在用户显式启用「自动模式」开关时；默认关闭 |
| 不得自动 agent loop | 受限开启 | 每回合有最大轮次上限 + 随时可中断 |
| 不得真实 PTY 投递 | 受限开启 | 仅投递到用户指定的本地 Codex 会话；不附加任意 shell |
| Pending 确认门 | 可选跳过 | 仅自动模式下；默认仍保留人工确认 |

**未变、仍为硬禁止**：任意 `/exec` `/shell` `/run` 通用 shell 端点；attach 到任意
已存在终端；自动 commit/push/merge/PR；读取页面密钥（cookie/localStorage）；把原始
未脱敏内容写盘或外传。

### 3.1 必须正视的现实风险

- **账号风险**：程序化驱动登录态 ChatGPT 网页、自动点发送，属于 OpenAI ToS 灰区，
  可能触发风控、限流或封号。这是不可由代码消除的风险，只能由你知情后承担。
- **失控风险**：自动 loop 若提取到错误内容（v1.4 的 T4/T6 已暴露 DOM selector 抓错
  "ChatGPT 也可能会犯错"那行提示）会把垃圾自动喂回 Codex。必须有轮次上限 + 中断 +
  每轮可见日志。
- **可逆性**：PTY 自动 stdin 写入是真实副作用。必须限定到用户显式选定的会话，且写入
  前留审计。

### 3.2 替代方案对比（供决策记录）

- **官方 ChatGPT API**：合规、稳定，但需 API key、计费，且不是你登录态网页里的会话/
  上下文。若可接受，则插件这一端可整体废弃，风险最低。**强烈建议优先评估这条。**
- **网页自动化（本方案 B）**：复用你现有登录态与上下文，零额外计费，但承担上述账号
  风险与 DOM 脆弱性。
- 这两者不互斥：可先用 API 把"自动贯通"跑通验证价值，再决定是否需要网页态。

## 4. 切片拆分（每片独立审批 + 独立 gate）

- **v1.5a 出站队列 + 自动注入（不含自动发送）**：server 增加出站 prompt 队列与
  `GET /bridge/outbound` 拉取端点；插件轮询并自动注入输入框，但**停在发送前**，由人点
  发送。低风险，可先验证"自动到达"链路。
- **v1.5b command transport review-only adapters（活跃路线，见 ADR-0002）**：不做
  web-dom 自动发送；改为固定 allowlist argv 调用本地 Codex CLI / Claude Code CLI 的
  非交互 review-only 模式，捕获 ReviewResult，保持 follow-up 为 draft。
- **v1.5b 自动发送 + 自动提取（superseded/deferred）**：原设想为插件加「自动模式」
  开关，注入后自动 `requestSubmit`，探测流式结束后自动提取并回传。此路线因账号/ToS
  风险和 command transport 可行性，已不作为 v1.5b 活跃路线。
- **v1.5c 真实 Codex 投递适配器（高风险）**：实现 `CodexPtyAdapter`（替换 mock），
  通过 PTY/stdin 把确认/自动通过的 prompt 写入用户指定的本地 Codex 会话。
- **v1.5d 端到端 loop 编排**：把 a/b/c 串成可中断、有上限、全程审计的自动回路。

每片 gate 不变：`build-extension` + `lint` + `typecheck` + `test` 全过，且不得引入
任何 §3「仍为硬禁止」条目。

## 5. 立即下一步

1. 你对 §3 安全边界反转签字（或先要求评估 §3.2 的官方 API 路线）。
2. 我据此把本反转写入一份 ADR 落入 canonical（README/ROADMAP 同步更新护栏措辞）。
3. 然后从 v1.5a（最低风险的"自动注入但不自动发送"）开始实现。

在签字前，我不编写任何自动发送 / 自动驱动网页 / 真实 PTY 写入的代码。
