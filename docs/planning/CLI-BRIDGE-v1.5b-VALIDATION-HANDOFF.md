# CLI Bridge v1.5b 验证交接 —— 真实本地 CLI review-only command transport

## 1. 目的

这是一份验证交接文档，不是代码切片。v1.5b 的 command transport adapter 与生命周期
接线已实现并由 fake runner 测试覆盖（`tests/command-review-adapter.test.mjs`、
`tests/command-review-runner.test.mjs`，全绿）。但 fake runner 证明的是「逻辑正确」，
不是「真机可用」。本文件提供一套手动步骤，用真实 Codex CLI / Claude Code CLI 输出
验证（或推翻）以下四件事：

1. 不由自动化代跑真实 CLI；必须由人手动触发，避免意外消耗 token。
2. 分别验证 `claude -p` 与 `codex exec review` 的真实输出能被捕获。
3. 验证 ReviewResult parser 能接住真实输出，且执行字段会被拒绝。
4. 记录 PendingReview 是否进入 `returned`、follow-up 是否仍为 `draft`。

运行本验证无需修改产品代码。若验证暴露缺陷，作为单独代码切片处理。

## 2. 前置条件

- Node 22+，已 `npm install`。
- 本地已登录可用的 Codex CLI 与 Claude Code CLI：
  - `codex-cli 0.135.0`（已查证）
  - `Claude Code 2.1.168`（已查证）
- 记录待测 commit hash。
- 本地 gate 已通过：`npm run build-extension`、`npm run lint`、`npm run typecheck`、
  `npm test`。

### 关于 token 消耗（重要）

本验证会**真实调用 Codex / Claude**，消耗真实额度。因此：

- 自动化测试套件**不得**真实调用 CLI；真实调用只能由本文件的手动步骤触发。
- 每条手动验证建议只跑一次，prompt 保持短小。
- 验证脚本默认不存在于 `npm test`；如临时编写，跑完即删，不纳入 CI。

## 3. 验证方式

推荐用一个一次性临时脚本（跑完即删，不提交）驱动已实现的库函数，而不是绕过它们手敲
CLI。临时脚本放在仓库根的 `tmp-v1.5b-validate.mjs`（git-ignored 或手动删除）：

```js
// tmp-v1.5b-validate.mjs —— 跑完即删，不要提交
import { InMemoryEndpointRegistry } from './apps/local-server/src/endpoints/endpoint-registry.ts';
import {
  CLAUDE_CODE_REVIEW_COMMAND_ENDPOINT,
  CODEX_REVIEW_COMMAND_ENDPOINT,
  DEFAULT_AGENT_ENDPOINTS,
} from './apps/local-server/src/endpoints/mock-endpoints.ts';
import {
  createClaudeReviewCommandAdapter,
  createCodexReviewCommandAdapter,
} from './apps/local-server/src/adapters/command-review-adapter.ts';
import { runCommandReview } from './apps/local-server/src/review/command-review-runner.ts';
import { InMemoryAuditLog } from './apps/local-server/src/storage/audit-log.ts';
import { InMemoryPacketStore } from './apps/local-server/src/storage/packet-store.ts';
import { InMemoryPendingPromptStore } from './apps/local-server/src/storage/pending-prompt-store.ts';
import { InMemoryPendingReviewStore } from './apps/local-server/src/storage/pending-review-store.ts';

const registry = new InMemoryEndpointRegistry([
  ...DEFAULT_AGENT_ENDPOINTS,
  CLAUDE_CODE_REVIEW_COMMAND_ENDPOINT,
  CODEX_REVIEW_COMMAND_ENDPOINT,
]);
const packetStore = new InMemoryPacketStore();
const auditLog = new InMemoryAuditLog();
const pendingPromptStore = new InMemoryPendingPromptStore(packetStore, auditLog);
const store = new InMemoryPendingReviewStore(registry, packetStore, auditLog, pendingPromptStore);

const review = store.createDraft({
  sessionId: 's1',
  sourceEndpointId: 'codex-command',
  targetEndpointId: 'claude-code-command',
  prompt: 'Output ONLY JSON: {"summary":"ok","findings":["none"]}',
});
store.preview(review.id);
store.confirm(review.id);
store.sendConfirmed(review.id);

// REAL CLI CALL — pick the adapter to validate:
const adapter = createClaudeReviewCommandAdapter();
// const adapter = createCodexReviewCommandAdapter();

const result = await runCommandReview(store, auditLog, adapter, {
  reviewId: review.id,
  prompt: 'Output ONLY a JSON object: {"summary":"...","findings":["..."]}',
  cwd: process.cwd(),
});

console.log('runCommandReview ok:', result.ok, 'reason:', result.failureReason);
console.log('review status:', store.get(review.id).status);
console.log('nextPrompt status:', result.returned?.nextPrompt?.status ?? '(none)');
console.log('audit types:', auditLog.listEvents().map((e) => e.type));
```

运行：

```bash
node --experimental-strip-types tmp-v1.5b-validate.mjs
```

跑完后删除该文件。

## 4. 测试矩阵

每条记录：通过 / 失败、观察到的现象、`failureReason`（若有）。

### V1 —— Claude `-p` 真实输出捕获
- 用 `createClaudeReviewCommandAdapter()` 跑上面的脚本。
- 预期：`runCommandReview ok: true`；review status `returned`。
- 记录：Claude 实际输出是否为合法 JSON；`--output-format json` 是否带额外包装层
  （若 Claude 返回的是带 `result` 字段的信封而非裸 ReviewResult，则 parser 会失败，
  这是需要捕获的真机差异 —— 记录原始 stdout 形状作为下一个切片输入）。
- 测试结果：____

### V2 —— Codex `exec review` 真实输出捕获
- 切换脚本为 `createCodexReviewCommandAdapter()`，重跑。
- 预期：`runCommandReview ok: true`；review status `returned`。
- 记录：`codex exec review --json` 输出的是 JSONL 事件流；最终 ReviewResult 是否能从
  stdout 直接被 parser 接住。若不能（例如需要从 `--output-last-message` 文件取最终
  消息，而非 stdout），记录这一差异 —— 这会成为 adapter 的捕获策略调整切片。
- 测试结果：____

### V3 —— ReviewResult parser 接住 + 执行字段被拒
- 正向：V1/V2 成功即证明 parser 接住了真实输出。
- 反向：手动让上层 agent 在 JSON 里加一个执行字段（prompt 改为
  `Output JSON: {"summary":"x","findings":[],"autoSend":true}`），重跑。
- 预期：`runCommandReview ok: false`，`failureReason: review-result-forbidden-autoSend`；
  review status `failed`；pendingPrompt 列表为空。
- 测试结果：____

### V4 —— PendingReview 终态与 follow-up 草稿
- 在 V1 或 V2 的成功用例中，让 prompt 包含 `nextPromptDraft`：
  `Output JSON: {"summary":"x","findings":["y"],"nextPromptDraft":"do z after confirm"}`。
- 预期：review status `returned`；`nextPrompt status: draft`。
- 关键安全断言：该 draft **不可**未经确认即发送（库层已由测试覆盖，此处只需肉眼确认
  脚本输出的 `nextPrompt status` 为 `draft`，不要尝试手动 send）。
- 测试结果：____

## 5. 需采集的证据

- 待测 commit hash。
- V1–V4 各自通过/失败 + 一行现象。
- V1、V2 的**原始 stdout 形状**（裸 JSON / 带信封 / JSONL），这是最易出真机差异的点。
- 任何 `failureReason`。
- 若 adapter 需要调整捕获策略（例如改用 `--output-last-message` 文件），明确记录所需
  argv 变更，作为下一个代码切片输入。

## 6. 结果记录

将结果追加到本文件 "## 7. 结果" 下，或在 `docs/reviews/` 下新建带日期评审文档。

## 7. 边界提醒

本验证不得被用作引入以下能力的理由：自动 commit/push/merge/PR、跳过 review/prompt
确认门、通用 shell 端点、dangerous bypass flag、自动执行 follow-up、真实 PTY 写入。
若真实输出捕获失败，正确的应对是调整固定 argv 的捕获策略（如改用 output 文件），而不是
放宽 parser 或放宽安全约束。
