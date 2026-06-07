# CLI Bridge v0.7 Planning Handoff

## 1. Verdict

Status: PASS for planning handoff.

v0.7 may enter planning after v0.6 closeout. v0.7 implementation has not started and must not start without a separate implementation goal.

## 2. Baseline

Current baseline:

- v0.6 closeout: PASS.
- v0.6 implemented clipboard-based Codex -> Claude Code review-only handoff.
- Claude Code is not automatically called.
- no command transport or managed PTY transport was added.
- ReviewResult cannot auto-execute.
- ReviewResult cannot automatically send anything back to Codex.
- `nextPromptDraft` creates only a PendingPrompt draft.
- PendingPrompt still requires second confirmation before delivery.

Residual risks remain:

- ChatGPT Web real manual E2E is not validated.
- Codex Managed PTY real delivery remains experimental.
- Current clipboard handoff does not prove real Claude Code interaction E2E.

## 3. v0.7 Planning Goal

v0.7 planning is limited to Claude Code output / plan -> Codex feasibility review.

The purpose is to define a reverse review path that asks Codex to assess feasibility, minimum patch scope, and next execution prompt options without executing anything.

Proposed path:

```text
Claude Code output / plan -> AgentReviewRequest -> Codex feasibility review -> ReviewResult -> optional PendingPrompt draft
```

## 4. Planning Scope

v0.7 planning may define:

- Claude Code output / plan input shape.
- Codex feasibility review request shape.
- feasibility-only prompt contract.
- result capture contract.
- redaction and audit requirements.
- manual confirmation points.
- acceptance gates for a later implementation goal.

## 5. Feasibility-Only Prompt Contract

The future Codex feasibility prompt must be review-only / feasibility-only.

It may ask Codex to assess:

- whether the proposed change is feasible.
- minimum patch scope.
- major risks.
- optional next prompt draft.

It must not ask Codex to:

- execute changes.
- modify files.
- run commands.
- apply patches.
- send output back to Claude Code automatically.
- continue an agent loop.

## 6. Second Confirmation Preservation

v0.7 planning must preserve:

- ReviewResult cannot auto-execute.
- ReviewResult cannot be automatically sent back to the source agent.
- `nextPromptDraft` can only create a PendingPrompt draft.
- PendingPrompt delivery requires a second confirmation.

## 7. Transport Boundary

v0.7 planning must not assume command transport or managed PTY expansion.

Allowed planning options:

- clipboard handoff.
- controlled file-protocol handoff.

Not allowed without separate approval:

- command transport.
- managed PTY expansion.
- shell endpoint.
- attach existing terminal.
- stop session behavior.

## 8. Hard Non-Goals

v0.7 planning must not include:

- implementation code.
- Claude -> Codex review implementation.
- command transport implementation.
- managed PTY transport implementation.
- WorkBuddy integration.
- OpenCode adapter.
- DeepSeek adapter.
- MCP tools.
- app-prompt integration.
- review lifecycle routes.
- browser UI.
- shell endpoint.
- `/exec`, `/shell`, `/run`, or `/command` endpoint.
- automatic source-agent feedback.
- automatic execution.
- automatic ChatGPT send.
- automatic agent loop.
- GitHub API / CI automatic reader.

## 9. Planning Deliverables

Expected v0.7 planning deliverables:

- Claude output / plan input contract.
- Codex feasibility-only prompt contract.
- ReviewResult capture requirements.
- second-confirmation requirements.
- transport decision notes.
- residual risk list.
- acceptance gates for a separate v0.7 implementation goal.

## 10. Acceptance Gates for Planning

Planning is acceptable only if it:

- preserves v0.6 clipboard review-only handoff boundary.
- forbids execution.
- forbids source-agent auto feedback.
- forbids shell endpoints.
- avoids command transport unless separately approved.
- avoids managed PTY expansion.
- documents residual v0.3 and v0.6 risks.
- does not create implementation code.

## 11. Next Action

Start v0.7 planning review only.

Do not implement Claude -> Codex feasibility review until a separate v0.7 implementation goal is approved.
