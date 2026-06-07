# CLI Bridge v0.2 Planning Handoff

## Handoff Status

v0.2 可以进入首个受限 slice。v0.1 remote review 已完成；真实 Codex Managed PTY 手动验证尚未完成，因此 Managed PTY 在进入 v0.2-1 时保持 experimental。

进入 v0.2-1 前已完成：

1. 配置 GitHub remote/upstream。
2. push 当前 `main`。
3. ChatGPT 阶段评审读取 GitHub 远程状态。
4. 核对远程 commit 与本地报告一致。
5. 如存在 GitHub Actions，确认 CI 通过。
6. 明确将 Managed PTY 标记为 experimental，等待后续真实手动验证。

## v0.1 Learnings

- DOM 适配必须保留 clipboard fallback。
- Bridge Panel 只能展示真实可执行动作，避免提前暴露 Agent/Packet 入口。
- Local Server 安全边界必须先于业务 endpoint。
- rawContent 默认 memory-only 是必要边界。
- Pending Prompt 确认链路是 ChatGPT -> Agent 的核心安全门。
- Managed PTY 必须保持 managed-only，不得扩展为任意 shell。
- Remote Review Gate 是阶段门禁，不应做成产品功能或自动 GitHub 集成。

## v0.2 Candidate Routes

### Route A：Metrics and Review Hardening

目标：把 v0.1 已产生的 packet/audit 数据整理成更可复盘的本地报告。

候选任务：

- metrics aggregation
- closeout report generation
- packet/audit export
- redaction hit summary
- DOM fallback rate summary

禁止范围：

- 不接 WorkBuddy
- 不接 MCP
- 不做 GitHub API client
- 不做自动 CI 读取
- 不开放 shell endpoint

推荐度：高。原因是风险低，直接增强 v0.1 的可评审性。

### Route B：Template Layer

目标：为 CLI output review 和 Codex prompt generation 加最小模板层。

候选任务：

- Review CLI Output template
- Generate Codex Prompt template
- template schema
- template preview

禁止范围：

- 不读取 app-prompt
- 不做 template registry
- 不做多 Agent selector
- 不自动发送

推荐度：中。原因是能提升可用性，但可能引入产品复杂度。

### Route C：Clipboard-first Codex Delivery Stabilization

目标：在 Managed PTY 真实验证不足时，把 clipboard delivery 做成稳定主路径。

候选任务：

- Pending Prompt copy handoff
- delivery status audit
- manual paste checklist
- fallback reason tracking

禁止范围：

- 不 attach existing terminal
- 不模拟键盘输入
- 不 stop session
- 不 shell endpoint

推荐度：高，前提是真实 Managed PTY 不稳定。

## Recommended First v0.2 Slice

推荐首个 v0.2 slice：

```text
完成 v0.2-1 Metrics and Review Hardening：基于现有 packet-store / audit-log / Pending Prompt 状态，生成最小本地 metrics summary；覆盖 packetCreatedCount、packetSentCount、packetCancelledCount、packetFailedCount、fallbackToClipboardCount、redactionHitCount、confirmRate、cancelRate；只新增本地内存统计和测试，不实现 UI dashboard、GitHub API、MCP、WorkBuddy、Claude Code、app-prompt 或 shell endpoint。
```

理由：

- 直接使用 v0.1 已有数据模型。
- 不需要新外部依赖。
- 不扩大 agent/control 面。
- 能让阶段评审更客观。

## v0.2-1 Execution Prompt

```text
你是 CLI Bridge 项目的执行 Agent。

任务：只做 v0.2-1 Metrics and Review Hardening。

目标：
1. 基于现有 packet-store / audit-log / Pending Prompt 状态生成最小 metrics summary。
2. 覆盖 packetCreatedCount、packetSentCount、packetCancelledCount、packetFailedCount。
3. 覆盖 fallbackToClipboardCount、redactionHitCount。
4. 计算 confirmRate 和 cancelRate。
5. 增加自动测试。
6. 跑本地 gate。
7. 按 Repository Sync Gate 完成 commit / push；如无 remote/upstream，明确报告建议 push 命令。

允许修改文件：
- apps/local-server/src/storage/*
- packages/shared/src/types.ts
- tests/*
- docs/planning/*，仅限同步说明
- scripts/lint.mjs，仅限结构检查必需项

禁止修改或新增：
- apps/local-server/src/routes/packets.ts，除非只读 metrics endpoint 被明确批准
- apps/local-server/src/adapters/*
- apps/extension/src/content/*
- apps/extension/src/ui/*
- GitHub API client
- MCP
- WorkBuddy
- Claude Code
- app-prompt
- 任意 shell endpoint
- stop session
- attach existing terminal
- 自动循环

验收标准：
1. metrics summary 可自动测试。
2. 不读取 rawContent。
3. 不新增外部网络依赖。
4. 不新增 agent 投递能力。
5. `npm run build-extension` / `npm run lint` / `npm run typecheck` / `npm run test` 通过。
6. 输出 branch / commit / pushed / remote / PR / Actions / remote verified。
```

## Deferred List for v0.2 First Slice

以下内容不得进入 v0.2 首个 slice：

- WorkBuddy UI
- MCP tools
- Claude Code Adapter
- app-prompt template registry
- GitHub API integration
- automated remote review
- CI integration
- multi-agent selector
- stop session
- attach existing terminal
- arbitrary shell endpoint
- automatic agent loop

## v0.2-1 Implementation Status

已完成最小 Metrics and Review Hardening：

- 新增本地 `createMetricsSummary`。
- 覆盖 `packetCreatedCount`、`packetSentCount`、`packetCancelledCount`、`packetFailedCount`。
- 覆盖 `fallbackToClipboardCount`、`redactionHitCount`。
- 覆盖 `confirmRate`、`cancelRate`。
- 测试确认 metrics summary 不读取 `rawContent`。

未新增：

- UI dashboard
- GitHub API client
- MCP
- WorkBuddy
- Claude Code
- app-prompt
- shell endpoint
- automatic agent loop

## Remote Review Requirement

v0.2 开发开始前必须完成 remote review：

- 远程分支存在
- 远程最新 commit 等于执行端报告 commit
- 本地无未提交变更
- 本地无 ahead 未 push
- PR diff 如存在必须符合范围
- GitHub Actions 如存在必须通过

如果 remote review 不通过，不得开始 v0.2 实现。

当前 remote review 状态：

- branch: `main`
- remote: `origin https://github.com/leekitleung/cli-bridge.git`
- local commit: `ac2a9e9d4d62f007dbd9129ccb17fbcb89fc6848`
- remote commit: `ac2a9e9d4d62f007dbd9129ccb17fbcb89fc6848`
- remote verified: yes
