# CLI Bridge v1.5 合并前 Self-Review 清单

## 0. 用途

本文件是 `feat/v1.5a-outbound-fill-queue` 合并进 `main` 前的人工审查清单，不是
requirements/canonical doc。当前范围：`origin/main`(5124065) → HEAD(22e07ba)，共
14 个 commit、30 个文件、+3239/−11。

门禁客观结果（合并前实测）：

- 本地：build / lint / typecheck / test 全过（161/161）。
- remote-review-gate：verdict `pass`（local==remote HEAD、已推送、worktree 干净、
  diff scope 无矛盾）。warning：`pr-unavailable` / `ci-unavailable`（本机未装 gh，读不到
  PR/CI，不是失败）。

Reviewer 重点：门禁证明「客观正确性」，本清单要人把关的是「判断性问题」——尤其是**安全
边界反转**。

## 1. 必须重点审的安全边界反转

这条分支反转了项目长期的「禁止一切自动化」边界。审查时确认每条都仍受控：

| 反转项 | 现状 | 守住边界的机制 | 证据 |
| --- | --- | --- | --- |
| 允许自动填入 ChatGPT composer | v1.5a 开启 | 停在发送前，无 requestSubmit/click/键盘模拟 | outbound-poller 测试 + grep 无自动发送 |
| 允许调用本地 CLI | v1.5b 开启 | 固定 allowlist(仅 claude/codex)、shell:false、禁危险 flag、fail-closed | command-runner 测试 12 项 |
| 允许 agent review 自动往返 | v1.5b 开启 | 只到 ReviewResult；follow-up 留 draft，需二次确认 | runner 测试 + 真机 V4 |
| web-dom 自动发送 | **仍禁止** | ADR-0002 superseded/deferred，需新 ADR 才能解冻 | ADR-0002 + roadmap overlay |
| 真实 PTY 写入 / shell 端点 | **仍禁止** | 无对应代码；command-runner 不接受任意命令 | 无 shell 端点测试 |

## 2. 按切片审查（commit 顺序）

### 2.1 v1.5a 出站填入（83295ae 之后的起点已在 main）
- 本分支起点 `5aa2b9b` 起为 v1.5b 转向；v1.5a 主体已在 main。

### 2.2 文档转向 — `5aa2b9b` Pivot v1.5b to command-transport
- 改：ADR-0002 + roadmap overlay，把 v1.5b 从 web-dom 自动发送改为 command transport。
- 安全：降风险（high 账号风险 → medium 本地执行风险）。
- 审查点：确认 web-dom 自动发送在所有文档中标为 superseded/deferred，无活跃指向。

### 2.3 规划文档 — `0ca03db` / `2d0a3fd` / `017e7d8`
- 改：分层编排 + goal-driven workflow 的 PLAN 文档；`017e7d8` 修了上一轮 review 抓出的
  4 处 canonical 安全语义冲突。
- 安全：纯文档，无运行时影响。标记为 PLAN（非活跃切片）。
- 审查点：确认状态变更步骤强制单独 gate、follow-up 两条并存定义、WorkBuddy 非 executor
  这三处措辞已修正（即上一轮 P1/P2 的修复）。

### 2.4 安全地基 — `3a5293c` command-runner allowlist
- 改：`command-runner.ts`（allowlist + shell:false + 禁危险 flag + 超时 + 输出上限 +
  全 fail-closed），可注入 runner。
- 审查点：`ALLOWED_COMMANDS` 仅 `codex`/`claude`；`FORBIDDEN_ARG_PATTERNS` 覆盖
  dangerous bypass；任何失败路径都返回结构化 failureReason 且不抛。

### 2.5 轨道 A adapters — `11a47ae`
- 改：Claude/Codex review-only adapter + 两个 command endpoint（canExecute:false）。
- 审查点：argv 固定、prompt 走 stdin、输出过 parseClaudeReviewResult（执行字段拒绝继承）。

### 2.6 接线 — `f020b3d` command-review-runner
- 改：把 adapter 接进 PendingReview，只接已 sent 的 review，失败 fail-closed。
- 审查点：runner 不替用户 confirm/send；成功记 send_review 审计、原始内容不落审计；
  失败由 store.fail 记录，不重复。

### 2.7 真机修复 — `aa6e320` / `7fb7132` / `5f94c31` / `7ae4323` / `51ddc0c`
- 改：验证交接文档 + 输出形状加固（裸/信封/JSONL/Codex 嵌套 item.text）+ Windows
  launcher 解析（真实入口，保持 shell:false，fail-closed）+ Codex argv 修正
  （exec -s read-only，非 exec review）。
- 审查点：launcher 解析失败返回 `launcher-not-resolved`，绝不回退 .cmd/shell；
  输出提取只定位文本，安全校验仍在 parser。

## 3. 真机验证证据（2026-06-09）

见 `docs/planning/CLI-BRIDGE-v1.5b-VALIDATION-HANDOFF.md` §7。V0–V4 全过：

- V1 Claude / V2 Codex：真机调用成功，review → returned。
- V3：执行字段 `autoSend` 被拒，review failed，0 pending prompt。
- V4：follow-up 停在 draft，未确认不可发送。

## 4. 已知未覆盖 / 合并后仍需注意

- command transport 仍是 library/store 层，**未暴露 HTTP**（设计如此，下一切片再定）。
- PR/CI 状态本机读不到（gh 未装）；若远端有 CI，合并前在网页确认绿。
- goal-driven 编排引擎仅为 PLAN，未实现。
- 分支较长、混合多类改动；建议 `--no-ff` 合并以保留切片历史，不要 squash。

## 5. 合并建议

- 技术门槛：满足（门禁 pass + 真机验证通过）。
- 建议合并方式：`--no-ff`，保留 14 个治理切片的边界历史。
- 合并前：确认 main 无落后；若网页有 PR/CI，确认 CI 绿。
- 合并动作由项目负责人执行（影响共享基线）。
