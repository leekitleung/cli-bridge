# CLI Bridge v0.5 Implementation Handoff

## 1. Verdict

Status: PASS for implementation.

v0.5 implements a mock Agent-to-Agent Review Lifecycle only. It does not connect real Claude Code, WorkBuddy, OpenCode, DeepSeek TUI, MCP, app-prompt, GitHub API, CI readers, or shell execution paths.

v0.5 keeps the v0.3 caveats:

- ChatGPT Web real manual E2E is not validated.
- Codex Managed PTY real delivery remains experimental.

## 2. Baseline

Implementation started from:

- Branch: `main`
- Baseline commit: `2a42a096fcff4511393be15bca3bf12a42383e07`
- v0.4 closeout: completed
- v0.5 planning handoff: completed

## 3. Implemented Scope

v0.5 added:

- `AgentReviewStatus`
- `AgentReviewRequest`
- `AgentReviewResult`
- schema validators for review request and review result
- `mock-review-agent` endpoint metadata
- `InMemoryPendingReviewStore`
- review capability guard through `EndpointRegistry.validateAction`
- review prompt packet/redaction path
- review audit events for create / preview / confirm / send / return
- cancel / fail audit through existing operation audit events
- optional `ReviewResult.nextPromptDraft` to `PendingPrompt` draft
- tests for review validation, capability, lifecycle, redaction, audit, and second confirmation

## 4. Lifecycle

Implemented lifecycle:

```text
draft -> previewed -> confirmed -> sent -> returned
draft / previewed / confirmed -> cancelled
any non-returned -> failed
```

Send rules:

- unconfirmed review cannot be sent.
- returned review cannot be resent.
- cancelled review cannot be sent.
- failed review cannot be sent.
- target endpoint must pass `validateAction(targetEndpointId, 'review')`.

## 5. MockReviewEndpoint

Added endpoint:

```text
id: mock-review-agent
transport: mock
risk: low
canReview: true
canExecute: false
canAcceptPrompt: false
canReturnOutput: true
canSummarize: false
```

No real review endpoints were added.

## 6. ReviewResult Boundary

`AgentReviewResult` is result data only.

Forbidden fields are rejected by schema:

- `executable`
- `autoSend`
- `confirmed`
- `sent`

`nextPromptDraft` can create a `PendingPrompt` draft only. It does not preview, confirm, send, execute, or return anything to the source agent automatically.

## 7. Test Coverage

Added or updated tests cover:

- valid ReviewRequest passes
- invalid status rejected
- missing source / target endpoint rejected
- packetId required
- prompt non-empty
- ReviewResult summary required
- findings must be array
- forbidden executable / autoSend / confirmed / sent fields rejected
- review denied when target cannot review
- MockReviewEndpoint can review but cannot execute
- unconfirmed PendingReview cannot be sent
- confirmed PendingReview can be sent to MockReviewEndpoint
- ReviewResult returned and stored
- ReviewResult never auto-executes
- ReviewResult never auto-sent to source agent
- nextPromptDraft creates only PendingPrompt draft
- PendingPrompt requires second confirmation before delivery
- redaction applies to review request prompt
- audit covers create / preview / confirm / send / return / cancel / fail
- no shell route files
- no real Claude / WorkBuddy / OpenCode / DeepSeek files
- v0.4 endpoint guard tests still pass
- PendingPrompt and bridge loop tests remain in the full test gate
- templates keep `autoSend: false`

## 8. Hard Non-Goals Preserved

v0.5 did not add:

- real Claude Code adapter
- real WorkBuddy integration
- real OpenCode adapter
- real DeepSeek TUI adapter
- MCP tools
- app-prompt integration
- Codex -> Claude real review
- Claude -> Codex real review
- GitHub API / CI automatic reading
- multi-agent selector UI
- shell endpoint
- `/exec`, `/shell`, `/run`, or `/command` endpoint
- stop session / attach existing terminal
- automatic loop
- automatic ChatGPT send
- automatic source-agent feedback
- automatic execution of ReviewResult
- automatic sending ReviewResult back to source agent

## 9. Verification

Required gate:

```text
npm run build-extension
npm run lint
npm run typecheck
npm run test
```

Expected status: PASS.

## 10. Deferred

Deferred to later versions:

- real review adapters
- real TUI bridges
- selector UI
- review lifecycle routes
- review lifecycle browser UI
- severity taxonomy
- inline comments
- reviewer identity beyond endpoint id
- real transport metadata
- PR / GitHub references
- automatic review-result feedback loops
- auto-execution of review suggestions

## 11. Next Action

Run the full gate, then commit and push:

```text
git add packages/shared/src/types.ts packages/shared/src/schemas.ts apps/local-server/src/endpoints apps/local-server/src/storage tests scripts/lint.mjs docs/planning
git commit -m "feat: add mock review lifecycle"
git push
```
