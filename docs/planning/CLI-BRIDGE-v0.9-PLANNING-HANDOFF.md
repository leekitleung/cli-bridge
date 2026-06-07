# CLI Bridge v0.9 Planning Handoff

## 1. Verdict

Status: PASS for planning handoff.

v0.9 may enter planning after v0.8 closeout. v0.9 implementation has not started and must not start without a separate implementation goal.

## 2. Baseline

Current baseline:

- v0.8 closeout: PASS.
- v0.8 implemented data-only WorkBuddy state contract and in-memory store.
- WorkBuddy remains non-executing.
- PendingReview and PendingPrompt gates remain intact.

Residual risks remain:

- ChatGPT Web real manual E2E is not validated.
- Codex Managed PTY real delivery remains experimental.
- Current Claude clipboard handoff does not prove real Claude Code interaction E2E.
- Current Codex feasibility clipboard handoff does not prove real reverse review E2E.
- v0.8 does not validate real WorkBuddy integration.

## 3. v0.9 Planning Goal

v0.9 planning is limited to Additional TUI Agents.

Candidate agents:

- OpenCode.
- DeepSeek TUI.
- other local TUI agents.

## 4. Entry Conditions

v0.9 planning starts from:

- stable EndpointRegistry.
- stable mock review lifecycle.
- stable Codex -> Claude review handoff.
- stable Claude -> Codex feasibility handoff.
- stable WorkBuddy state contract.

## 5. Transport Planning Boundary

Preferred transport:

- clipboard.

Possible transport only with separate approval:

- managed PTY.

Command transport is allowed only if the target tool has a stable non-interactive review-only CLI mode and receives separate approval.

## 6. Review-Only Contract

Any additional TUI agent must be planned as review-only by default.

Planning must define:

- endpoint metadata.
- transport risk.
- review-only prompt contract.
- result capture contract.
- redaction requirements.
- audit requirements.
- second confirmation preservation.

## 7. Hard Non-Goals

v0.9 planning must not include:

- implementation code.
- OpenCode adapter implementation.
- DeepSeek adapter implementation.
- command transport implementation.
- managed PTY transport implementation.
- shell endpoint.
- `/exec`, `/shell`, `/run`, or `/command` endpoint.
- automatic source-agent feedback.
- automatic execution.
- automatic ChatGPT send.
- automatic agent loop.
- GitHub API / CI automatic reader.
- MCP tools.
- app-prompt integration.

## 8. Acceptance Gates for Planning

Planning is acceptable only if it:

- keeps additional TUI agents review-only by default.
- preserves PendingReview and PendingPrompt gates.
- forbids shell endpoints.
- forbids automatic execution.
- forbids source-agent auto feedback.
- avoids command transport unless separately approved.
- avoids managed PTY expansion unless separately approved.
- documents residual risks.
- does not create implementation code.

## 9. Planning Deliverables

Expected v0.9 planning deliverables:

- candidate agent matrix.
- endpoint metadata draft.
- transport risk matrix.
- review-only prompt contract draft.
- result capture contract draft.
- acceptance gates for a separate v0.9 implementation goal.

## 10. Next Action

Start v0.9 planning review only.

Do not implement additional TUI agent support until a separate v0.9 implementation goal is approved.
