# CLI Bridge v0.8 Planning Handoff

## 1. Verdict

Status: PASS for planning handoff.

v0.8 may enter planning after v0.7 closeout. v0.8 implementation has not started and must not start without a separate implementation goal.

## 2. Baseline

Current baseline:

- v0.7 closeout: PASS.
- v0.7 implemented clipboard-based Claude Code output / plan -> Codex feasibility review.
- ReviewResult cannot auto-execute.
- `nextPromptDraft` creates only a PendingPrompt draft.
- PendingPrompt still requires second confirmation before delivery.

Residual risks remain:

- ChatGPT Web real manual E2E is not validated.
- Codex Managed PTY real delivery remains experimental.
- Current Claude clipboard handoff does not prove real Claude Code interaction E2E.
- Current Codex feasibility clipboard handoff does not prove real reverse review E2E.

## 3. v0.8 Planning Goal

v0.8 planning is limited to WorkBuddy State Integration.

The purpose is to define WorkBuddy as a project/task context source and review/result sink without making WorkBuddy an execution agent.

## 4. Planning Scope

v0.8 planning may define WorkBuddy as:

- project state source.
- task source.
- prompt draft source.
- review result sink.
- execution ledger sink.
- next prompt draft sink.

## 5. Hard Boundary

WorkBuddy must not:

- become an execution agent.
- trigger Codex automatically.
- trigger Claude Code automatically.
- bypass PendingReview.
- bypass PendingPrompt.
- become a terminal controller.
- introduce shell endpoints.
- introduce command transport.
- introduce managed PTY expansion.

## 6. Data Contract Planning

v0.8 planning should define:

- WorkBuddy project snapshot shape.
- WorkBuddy task reference shape.
- review result sink shape.
- prompt draft sink shape.
- execution ledger event shape.
- audit event requirements.
- redaction requirements.

## 7. Confirmation Boundary

v0.8 planning must preserve:

- ReviewResult cannot auto-execute.
- WorkBuddy cannot auto-send ReviewResult to any source agent.
- WorkBuddy cannot confirm or send PendingPrompt.
- `nextPromptDraft` can only become a draft.
- PendingPrompt delivery requires second confirmation.

## 8. Hard Non-Goals

v0.8 planning must not include:

- implementation code.
- WorkBuddy execution integration.
- WorkBuddy-triggered Codex or Claude actions.
- command transport.
- managed PTY expansion.
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

Expected v0.8 planning deliverables:

- WorkBuddy role matrix.
- WorkBuddy data contract draft.
- source/sink boundary diagram.
- no-execution safety boundary.
- audit and redaction requirements.
- acceptance gates for a separate v0.8 implementation goal.

## 10. Acceptance Gates for Planning

Planning is acceptable only if it:

- keeps WorkBuddy non-executing.
- forbids WorkBuddy-triggered agent actions.
- preserves PendingReview and PendingPrompt gates.
- forbids shell endpoints.
- avoids command transport unless separately approved.
- avoids managed PTY expansion.
- documents residual risks.
- does not create implementation code.

## 11. Next Action

Start v0.8 planning review only.

Do not implement WorkBuddy state integration until a separate v0.8 implementation goal is approved.
