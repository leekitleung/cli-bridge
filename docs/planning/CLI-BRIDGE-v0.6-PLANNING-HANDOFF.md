# CLI Bridge v0.6 Planning Handoff

## 1. Verdict

Status: PASS for planning handoff.

v0.6 may enter planning after v0.5 closeout. v0.6 implementation has not started and must not start without a separate implementation goal.

## 2. Baseline

Current baseline:

- v0.5 closeout: PASS.
- v0.5 implemented mock Agent-to-Agent Review Lifecycle only.
- Review lifecycle remains separated from PendingPrompt execution lifecycle.
- ReviewResult cannot auto-execute.
- `nextPromptDraft` creates only a PendingPrompt draft.
- PendingPrompt still requires second confirmation before delivery.

v0.3 caveats remain active:

- ChatGPT Web real manual E2E is not validated.
- Codex Managed PTY real delivery remains experimental.

## 3. v0.6 Planning Goal

v0.6 planning is limited to Codex -> Claude Code real review path planning.

The purpose is to define a safe review-only path before any real Claude Code adapter or transport code is written.

Proposed path:

```text
Codex output -> AgentReviewRequest -> Claude Code review target -> AgentReviewResult -> optional PendingPrompt draft
```

## 4. Planning Scope

v0.6 planning may define:

- Codex -> Claude Code real review path.
- transport comparison.
- review-only prompt contract.
- result capture contract.
- redaction and audit requirements.
- second confirmation preservation.
- manual fallback expectations.
- acceptance gates for a later implementation goal.

## 5. Transport Comparison Scope

Transport options to compare in planning:

- clipboard handoff.
- controlled file-protocol handoff.
- managed PTY handoff.
- command transport only if Claude Code exposes a stable non-interactive review mode.

Planning must compare:

- user confirmation points.
- auditability.
- raw secret exposure risk.
- ability to capture ReviewResult without execution.
- failure and cancellation behavior.
- compatibility with v0.3 caveats.

## 6. Review-Only Prompt Contract

The future Claude Code review prompt must be review-only.

It must ask for:

- summary.
- findings.
- optional next prompt draft.

It must not ask Claude Code to:

- execute changes.
- run shell commands.
- modify files.
- send output back to Codex automatically.
- continue an agent loop.

## 7. Second Confirmation Preservation

v0.6 planning must preserve the v0.5 boundary:

- ReviewResult cannot auto-execute.
- ReviewResult cannot be automatically sent back to the source agent.
- `nextPromptDraft` can only create a PendingPrompt draft.
- PendingPrompt delivery requires a second confirmation.

## 8. Hard Non-Goals

v0.6 planning must not include:

- direct Claude Code adapter implementation.
- real WorkBuddy integration.
- real OpenCode adapter.
- real DeepSeek TUI adapter.
- MCP tools.
- app-prompt integration.
- review lifecycle routes.
- review lifecycle browser UI.
- GitHub API / CI automatic reading inside the product.
- shell endpoint.
- `/exec`, `/shell`, `/run`, or `/command` endpoint.
- automatic source-agent feedback.
- automatic execution.
- automatic ChatGPT send.
- automatic agent loop.
- stop session / attach existing terminal.

## 9. Planning Deliverables

Expected v0.6 planning deliverables:

- transport decision matrix.
- Claude Code review-only prompt contract draft.
- AgentReviewRequest input shape for Codex output.
- AgentReviewResult capture requirements.
- redaction and audit requirements.
- manual confirmation points.
- acceptance gates for a separate v0.6 implementation goal.

## 10. Acceptance Gates for Planning

Planning is acceptable only if it:

- keeps v0.5 mock lifecycle intact.
- preserves second confirmation.
- forbids auto execution.
- forbids source-agent auto feedback.
- forbids shell endpoints.
- documents v0.3 caveats.
- does not create implementation code.

## 11. Next Action

Start v0.6 planning review only.

Do not implement Claude Code transport until a separate v0.6 implementation goal is approved.
