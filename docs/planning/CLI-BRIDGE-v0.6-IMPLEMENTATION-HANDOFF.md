# CLI Bridge v0.6 Implementation Handoff

## 1. Verdict

Status: PASS for implementation.

v0.6 implements the minimum safe Codex -> Claude Code review-only handoff path. It does not implement a Claude Code execution adapter, command transport, managed PTY transport, shell endpoint, route, browser UI, or automatic feedback loop.

## 2. Baseline

Implementation started from:

- Branch: `main`
- Baseline commit: `c58fe51c3f57a60eabc37bf015d68d8a5bca86b6`
- v0.5 closeout: completed
- v0.6 planning handoff and planning patch: completed

v0.3 caveats remain:

- ChatGPT Web real manual E2E is not validated.
- Codex Managed PTY real delivery remains experimental.

## 3. Implemented Scope

v0.6 added:

- `claude-code` review endpoint metadata.
- Claude Code review-only prompt builder.
- clipboard-only Claude review handoff helper.
- ReviewResult parser / capture helper.
- Codex output -> Claude AgentReviewRequest draft helper.
- tests for endpoint capability, review-only prompt contract, clipboard handoff, parser rejection, and draft-only nextPrompt handling.

## 4. Review-Only Path

Implemented path:

```text
Codex output -> AgentReviewRequest -> Claude Code clipboard handoff -> AgentReviewResult capture -> optional PendingPrompt draft
```

The `claude-code` endpoint uses:

```text
transport: clipboard
risk: medium
canReview: true
canExecute: false
canAcceptPrompt: false
canReturnOutput: true
canSummarize: false
```

## 5. Prompt Contract

The Claude Code prompt states:

- You are a Review Agent, not an Execution Agent.
- Do not call tools.
- Do not apply patches.
- Do not write files.
- Do not run commands.
- Do not modify files.
- Do not modify repository state.
- Do not send anything back to Codex automatically.
- Do not continue an agent loop.
- Output only ReviewResult-shaped JSON.

ReviewResult-shaped output:

```json
{
  "summary": "string",
  "findings": ["string"],
  "nextPromptDraft": "optional string"
}
```

## 6. Result Capture Boundary

ReviewResult capture is non-executing.

The parser rejects:

- `executable`
- `autoSend`
- `confirmed`
- `sent`

`nextPromptDraft` remains an unconfirmed PendingPrompt draft only. PendingPrompt still requires a second confirmation before delivery.

## 7. Handoff Boundary

Clipboard handoff:

- produces copy-ready text only.
- does not call Claude Code.
- does not execute commands.
- does not write files.
- does not modify repository state.
- adds audit through the existing clipboard audit event path.

## 8. Tests

Coverage includes:

- `claude-code` endpoint can review but cannot execute.
- Claude review prompt includes no-tools / no-patch / no-write / no-command / no repo modification instructions.
- prompt requests ReviewResult-shaped output.
- handoff produces clipboard draft only, no execution.
- ReviewResult parser accepts valid summary / findings / nextPromptDraft.
- parser rejects executable / autoSend / confirmed / sent.
- ReviewResult never auto-executes.
- ReviewResult never auto-sent to source agent.
- nextPromptDraft creates PendingPrompt draft only.
- PendingPrompt still requires second confirmation.
- no shell endpoint.
- no command transport or managed PTY transport added for Claude handoff.
- no WorkBuddy / OpenCode / DeepSeek / MCP files.
- v0.5 pending review tests still pass.
- v0.4 endpoint guard tests still pass.
- templates keep `autoSend: false`.

## 9. Hard Non-Goals Preserved

v0.6 did not add:

- Claude Code adapter automatic execution.
- Claude command transport.
- Claude managed PTY transport.
- Claude tool calling.
- apply patch.
- file writes.
- command execution.
- repository state mutation.
- automatic ReviewResult feedback to Codex.
- automatic execution of `nextPromptDraft`.
- automatic confirm/send of PendingPrompt.
- review lifecycle routes.
- browser UI.
- multi-agent selector UI.
- shell endpoint.
- `/exec`, `/shell`, `/run`, or `/command` endpoint.
- GitHub API / CI automatic reading.
- WorkBuddy / OpenCode / DeepSeek / MCP / app-prompt.
- stop session / attach terminal.
- auto loop / auto ChatGPT send.

## 10. Verification

Required gate:

```text
npm run build-extension
npm run lint
npm run typecheck
npm run test
```

Expected status: PASS.

## 11. Next Action

Run the full gate, then commit and push:

```text
git add packages/shared/src/types.ts packages/shared/src/schemas.ts apps/local-server/src/endpoints apps/local-server/src/review apps/local-server/src/storage tests scripts/lint.mjs docs/planning
git commit -m "feat: add claude review handoff"
git push
```
