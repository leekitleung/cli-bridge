# CLI Bridge v1.0 Planning Handoff

## 1. Verdict

Status: PASS for planning handoff.

v1.0 may enter planning after v0.9 closeout. v1.0 implementation has not started and must not start until v1.0 planning review passes.

## 2. Baseline

Current baseline:

- v0.9 closeout: PASS.
- Additional TUI Agents remain planning-only.
- no OpenCode / DeepSeek TUI adapter implementation exists.
- no command transport or managed PTY expansion was added in v0.9.
- PendingReview and PendingPrompt gates remain intact.

Residual risks remain:

- ChatGPT Web real manual E2E is not validated.
- Codex Managed PTY real delivery remains experimental.
- Current Claude clipboard handoff does not prove real Claude Code interaction E2E.
- Current Codex feasibility clipboard handoff does not prove real reverse review E2E.
- v0.8 does not validate real WorkBuddy integration.
- v0.9 does not validate real Additional TUI Agent behavior.

## 3. v1.0 Planning Goal

v1.0 planning is limited to Remote Review Gate Hardening.

The goal is to make phase transitions harder to misreport by defining a local verification gate that checks remote repository state against the local report before the next phase can proceed.

## 4. Problem Statement

Current handoffs report local commit, push, and remote verification manually. That is useful but weak:

- the report can omit remote mismatch details.
- the report can skip PR / CI state when present.
- the report can fail to compare local and remote diff scope.
- the next phase can proceed even when remote verification evidence is incomplete.

v1.0 should define a minimal gate that makes remote evidence explicit and repeatable without adding product runtime GitHub automation.

## 5. Scope

Allowed v1.0 implementation scope after planning review:

- local remote verification helper or script.
- documentation for the remote review gate.
- tests for parsing local git / remote evidence.
- explicit pass/fail output for:
  - local branch.
  - local HEAD.
  - upstream remote branch.
  - remote branch HEAD.
  - local/remote match.
  - pushed status.
  - PR status if available through local tooling.
  - CI / Actions status if available through local tooling.
  - remote diff scope summary if available.
- acceptance gates for future version transitions.

## 6. Hard Non-Goals

v1.0 must not add:

- product runtime GitHub API reader.
- product runtime CI / Actions reader.
- automatic PR creation.
- automatic merge.
- automatic push from product runtime.
- automatic branch switching.
- automatic agent execution.
- automatic source-agent feedback.
- automatic ChatGPT send.
- automatic agent loop.
- shell endpoint.
- `/exec`, `/shell`, `/run`, or `/command` endpoint.
- OpenCode adapter.
- DeepSeek TUI adapter.
- WorkBuddy real integration.
- MCP tools.
- app-prompt integration.

## 7. Remote Review Gate Draft

The gate should verify:

```text
branch: current local branch
localHead: current local HEAD commit
upstream: configured upstream branch
remoteHead: remote upstream HEAD commit
remoteMatchesLocal: true only when localHead equals remoteHead
workingTreeClean: true only when no uncommitted changes exist
pr: present / absent / unavailable
ci: pass / fail / pending / absent / unavailable
remoteDiffScope: summarized / unavailable
verdict: pass / fail
```

Hard failures:

- working tree is dirty when the stage expects a clean tree.
- local branch has no upstream for a transition that requires push verification.
- remote HEAD does not match local HEAD.
- CI is present and failing.
- remote diff scope contradicts reported changed files.

Soft unavailable states:

- PR unavailable because no PR exists.
- CI unavailable because no CI is configured.
- remote diff unavailable because local tooling cannot fetch it.

Soft unavailable states must be reported, not silently treated as pass evidence.

## 8. Tooling Boundary

Preferred implementation:

- local script using existing git CLI evidence.

Allowed only if available locally and read-only:

- GitHub CLI read commands for PR / Actions lookup.

Forbidden:

- product runtime GitHub API client.
- product runtime CI reader.
- write operations to GitHub.
- automatic PR creation.
- automatic merge.
- automatic push.

## 9. Test Strategy

v1.0 tests should cover:

- clean local/remote match passes.
- remote mismatch fails.
- dirty working tree fails when clean is required.
- missing upstream fails or reports unavailable according to mode.
- absent PR is reported as absent, not failure.
- unavailable CI is reported as unavailable, not pass evidence.
- failing CI blocks when CI evidence is present.
- remote diff scope summary is included when available.

Tests should use fixture outputs or pure parsing helpers where possible.

## 10. Acceptance Gates

v1.0 implementation can close only if:

- remote verification gate exists.
- gate can prove local HEAD equals remote HEAD.
- gate reports dirty tree state.
- gate reports PR / CI absent or unavailable states explicitly.
- gate blocks on remote mismatch.
- gate blocks on present failing CI.
- no product runtime GitHub API / CI reader was added.
- no shell endpoint was added.
- no automatic execution or source-agent feedback was added.
- full local gate passes.
- remote branch matches the reported commit after push.

## 11. Risks

Risks:

- GitHub CLI may be unavailable or unauthenticated.
- CI may be absent, pending, or unavailable.
- remote diff scope may require network access.
- local git output parsing can be brittle if over-scoped.
- remote verification can prove repository state, but not real ChatGPT Web E2E.

## 12. Deferred List

Deferred:

- automatic PR creation.
- automatic merge.
- product runtime GitHub API / CI reader.
- persistent release dashboard.
- GitHub app integration.
- real ChatGPT Web manual E2E validation.
- Codex Managed PTY promotion from experimental.
- OpenCode / DeepSeek TUI adapter implementation.
- real WorkBuddy integration.

## 13. Next Action

Run v1.0 planning review.

Do not implement the remote review gate until the planning review passes.
