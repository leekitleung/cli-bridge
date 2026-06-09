# CLI Bridge v1.7 合并前 Self-Review 清单

## 0. 用途

`feat/v1.7-review-cli-wrapper` 合并进 `main` 前的人工审查清单。范围：
`main` → HEAD(3b1fc45)，2 commit。

切片目标：把 v1.6 的三步 review 流程（create → confirm → dispatch）包成一条本地命令
`npm run review`，仍严格 review-only。并修复真机暴露的两个问题：dispatch 未强制模型
输出 ReviewResult JSON、CLI 难传多段内容。

门禁：build / lint / typecheck / test 全过（175/175）。

## 1. 边界审查（review-only，未跨到执行层）

| 关注点 | 现状 | 证据 |
| --- | --- | --- |
| 仅打 /bridge/reviews* | 是 | review-cli-workflow 测试断言三调用路径全是 /bridge/reviews 开头 |
| canExecute 仍全 false | 是 | 未改 endpoint 能力；未接执行层 |
| follow-up 留 draft | 是 | wrapper 只打印 draft id 并标注 "not executed" |
| 不写文件/不接 WorkBuddy | 是 | 无相关代码 |
| confirm 失败不 dispatch | 是 | 测试 "stops at confirm" 断言 dispatch 未被调用 |
| 无新 shell 端点 | 是 | wrapper 仅 HTTP 客户端 |

## 2. 按 commit 审查

### 2.1 `3dc94f1` Add v1.7 review-only workflow CLI wrapper
- 新增 `cli/review-workflow.ts`（编排 + argv 解析，fetch 可注入）、`cli/review.ts`
  （入口）、`npm run review` 脚本。
- 审查点：fetch 可注入便于测试；token 走 --token/env；目标仅 claude/codex 别名。

### 2.2 `3b1fc45` Wrap dispatch prompt + prompt-file/stdin
- **服务端修复**：`/bridge/reviews/dispatch` 现在用 `buildClaudeReviewPrompt` 把用户
  内容包成 review-only 指令，强制 CLI 输出 ReviewResult JSON。修复真机
  `review-result-invalid-json`。
- **CLI 增强**：`--prompt-file <path>` 与 `--stdin`，解决多段内容传参。
- 审查点：包裹只改送给 CLI 的 prompt，安全校验仍由 parseClaudeReviewResult 执行；
  bridge-reviews-api 测试断言包裹后的 prompt 含 "Review Agent" + 原始内容。

## 3. 已知未覆盖

- `npm run review` 真机未在本切片复跑（HTTP 路径已由 v1.6 真机覆盖；wrapper 编排由
  fake fetch 单测覆盖）。dispatch prompt 包裹由单测断言。
- review 状态仍内存（与 v1.6 一致）。

## 4. 合并建议

- 技术门槛满足（门禁 175/175）。
- 建议 `--no-ff`。
- 与 v1.8 有重叠文件 `scripts/lint.mjs`（两边各加不同 required-path 条目）；建议先合
  v1.7，再把 v1.8 rebase 到新 main 解决该重叠。
- 合并由项目负责人执行。
