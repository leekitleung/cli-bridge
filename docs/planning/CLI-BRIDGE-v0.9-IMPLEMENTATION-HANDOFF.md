# CLI Bridge v0.9 Implementation Handoff

## 1. Verdict

Status: PASS.

v0.9 completed the approved minimal scope as planning deliverables only. No Additional TUI Agent adapter was implemented.

## 2. Baseline

Baseline:

- v0.8 closeout: PASS.
- v0.9 planning review: PATCH REQUIRED, then patched.
- v0.9 planning patch review: PASS.
- active route: `docs/planning/CLI-BRIDGE-ROADMAP-AFTER-v0.3.md`.

Residual risks remain:

- ChatGPT Web real manual E2E is not validated.
- Codex Managed PTY real delivery remains experimental.
- Current Claude clipboard handoff does not prove real Claude Code interaction E2E.
- Current Codex feasibility clipboard handoff does not prove real reverse review E2E.
- v0.8 does not validate real WorkBuddy integration.

## 3. Implemented Scope

v0.9 implemented planning artifacts only:

- candidate agent matrix.
- endpoint metadata draft.
- transport risk matrix.
- review-only prompt contract draft.
- result capture contract draft.
- acceptance gates for a future separately approved v0.9 adapter implementation.

No code, route, endpoint implementation, adapter implementation, browser UI, or transport implementation was added.

## 4. Candidate Agent Matrix

| Candidate | Role | Default transport | Implementation status | v0.9 decision |
| --- | --- | --- | --- | --- |
| OpenCode | local TUI review target | clipboard | not implemented | eligible for future planning only |
| DeepSeek TUI | local TUI review target | clipboard | not implemented | eligible for future planning only |
| other local TUI agent | local review target | clipboard | not implemented | requires separate candidate review |

Candidate acceptance requirements:

- The agent must be usable through a review-only boundary.
- Clipboard must remain the default transport.
- The agent must not require source-agent auto feedback.
- The agent must not require automatic execution.
- The agent must not require a shell endpoint.
- The agent must not bypass PendingReview or PendingPrompt.

## 5. Endpoint Metadata Draft

Future Additional TUI Agent endpoints may use this draft shape only after a separate implementation goal:

```text
id: <agent-id>
type: tui-review-agent
transport: clipboard
risk: medium
capabilities:
  canReview: true
  canExecute: false
  canAcceptPrompt: false
  canReturnOutput: true
  canSummarize: false
```

Required metadata:

- `id`
- `label`
- `agentName`
- `transport`
- `risk`
- `capabilities`
- `redactionPolicy`
- `auditPolicy`

Forbidden metadata behavior:

- no execution target registration.
- no command transport by default.
- no managed PTY by default.
- no source-agent auto feedback.
- no automatic send.

## 6. Transport Risk Matrix

| Transport | v0.9 status | Risk | Decision |
| --- | --- | --- | --- |
| clipboard | preferred | low to medium | allowed for future implementation planning |
| controlled file-protocol | deferred | medium | requires separate approval and path controls |
| command transport | deferred | high | allowed only with stable non-interactive review-only mode and separate approval |
| managed PTY | fallback only | high | not default while v0.3 Managed PTY caveat remains active |
| web-dom | not applicable | high | not planned for Additional TUI Agents |

Clipboard requirements:

- produce copy-ready payload only.
- preserve human paste boundary.
- record audit metadata.
- never invoke the target agent automatically.

## 7. Review-Only Prompt Contract Draft

Future Additional TUI Agent review prompts must say:

```text
You are a Review Agent, not an Execution Agent.
Do not call tools.
Do not apply patches.
Do not write files.
Do not run commands.
Do not modify repository state.
Do not send anything back to the source agent automatically.
Return only ReviewResult-shaped data:
summary
findings[]
nextPromptDraft?
```

`nextPromptDraft` rules:

- it is optional.
- it is draft-only.
- it must not be treated as confirmed.
- it must not be sent automatically.
- it must require PendingPrompt second confirmation before any delivery.

## 8. Result Capture Contract Draft

Captured Additional TUI Agent output must be treated as review data only.

Allowed fields:

- `summary`
- `findings[]`
- `nextPromptDraft?`

Forbidden fields:

- `executable`
- `autoExecute`
- `autoSend`
- `confirmed`
- `sent`
- `command`

Capture behavior:

- parse or reject into ReviewResult-shaped data.
- never convert review output into executed work.
- never send review output back to the source agent automatically.
- if `nextPromptDraft` exists, create only a PendingPrompt draft.
- require second confirmation before any PendingPrompt delivery.

## 9. Redaction and Audit Requirements

Redaction must run before any handoff payload is generated.

Audit must cover:

- handoff payload creation.
- manual copy boundary.
- result capture.
- result rejection.
- nextPromptDraft draft creation.

Audit must not claim:

- target agent invocation.
- command execution.
- delivery to source agent.
- confirmed PendingPrompt state.

## 10. Acceptance Gates for Future Implementation

A separate implementation goal is required before any Additional TUI Agent adapter work.

Future implementation acceptance gates:

- endpoint has `canReview: true`.
- endpoint has `canExecute: false`.
- endpoint is not registered as an execution target.
- transport is clipboard unless separately approved.
- no command transport without stable non-interactive review-only mode and separate approval.
- no managed PTY default path.
- no shell endpoint.
- no automatic execution.
- no source-agent auto feedback.
- no automatic ChatGPT send.
- no automatic agent loop.
- ReviewResult parser rejects execution flags.
- `nextPromptDraft` remains PendingPrompt draft-only.
- second confirmation remains required.
- full local gate passes.
- remote branch matches reported commit.

## 11. Confirmed Non-Goals

v0.9 did not add:

- OpenCode adapter implementation.
- DeepSeek TUI adapter implementation.
- other local TUI adapter implementation.
- command transport implementation.
- managed PTY transport implementation.
- controlled file-protocol implementation.
- review lifecycle routes.
- browser UI.
- shell endpoint.
- `/exec`, `/shell`, `/run`, or `/command` endpoint.
- automatic source-agent feedback.
- automatic execution.
- automatic ChatGPT send.
- automatic agent loop.
- GitHub API / CI automatic reader.
- MCP tools.
- app-prompt integration.

## 12. Verification

Required gate:

```text
npm run build-extension
npm run lint
npm run typecheck
npm run test
```

## 13. Next Action

Run v0.9 implementation review.

Do not start any Additional TUI Agent adapter implementation without a separate approved goal.
