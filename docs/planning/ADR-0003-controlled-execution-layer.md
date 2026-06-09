# ADR-0003: Controlled Execution Layer

Status: Accepted

Date: 2026-06-09

Sign-off: Project owner accepted the Decision and Risk Acceptance on 2026-06-09.

## Context

Through v1.8 the project deliberately stayed review-only: every endpoint has
`canExecute: false`. Claude/Codex can review and propose, but cannot change files
or repository state. The human gate is per-action (confirm a review, copy a
draft).

The product goal is now explicit: move from "review + manual paste" to a
goal-driven, semi-autonomous loop:

```text
Goal -> Plan -> Approve Plan -> Auto-run Steps -> Gate state-changing steps -> Audit -> Done
```

This requires a real execution layer: agents that can actually edit files, run
tests/builds, and inspect git state — bounded by visible, auditable, interruptible,
gated controls. This ADR defines that boundary before any execution code is
written. It is the third boundary reversal (ADR-0001 unfroze automation;
ADR-0002 chose command transport for review; ADR-0003 adds controlled execution).

This is the highest-risk change so far: review-only could never damage the
working tree; execution can. The boundary must be precise.

## Decision (proposed)

Introduce a Controlled Execution Layer with the following hard contract.

### 1. Which agents may execute

- Execution-capable endpoints are explicitly registered with `canExecute: true`.
- Initial candidates: Codex CLI (`codex exec` with a bounded sandbox) and
  Claude Code (`claude` with an allowlisted tool set). Both already verified as
  local, authorized CLIs (no account/ToS risk; this is their intended use).
- An endpoint is execution-capable ONLY in an explicit execution invocation;
  the same tool keeps a separate review-only endpoint (capability, not tool,
  determines the layer — per the layered orchestration model).

### 2. Execution permission tiers

Two modes, chosen per plan (default = the safer one):

- **patch-proposal (default)**: the agent runs read-only and emits a proposed
  diff/patch. The patch is NOT applied automatically; applying it is a
  state-changing step that must pass the gate (§4).
- **workspace-write (opt-in)**: the agent may write within the workspace root
  only. Never outside the workspace. Never `danger-full-access`. Never the
  dangerous bypass flags already forbidden by the command-runner.

### 3. Allowed tools / operations

- Allowed under execution: edit files (within workspace), run tests, run builds,
  read git status/diff.
- Forbidden without a dedicated per-step gate: any state-changing git operation
  (commit, push, merge, branch mutation), file deletion, and any command with
  side effects outside the workspace.
- Hard-forbidden entirely (unchanged): generic shell endpoint, attach-to-terminal,
  stop-session-for-control, network exfiltration of repo content, auto
  commit/push/merge/PR, reading browser secrets, persisting raw unredacted content.

### 4. State-changing gate

- A `PlanStep` is flagged `isStateMutating` when it writes files, deletes,
  commits, pushes, or runs a side-effecting command.
- Plan-level approval (§5) does NOT cover state-changing steps. Each such step
  enters `blocked-needs-gate` and requires a separate, explicit confirmation.
- A user-pre-approved scope may only decide whether a step is *allowed to request*
  the gate; it never replaces the gate.
- Non-state-changing steps (review, summarize, read, propose-patch) may run
  automatically within an approved plan.

### 5. Plan-level approval and the auto-run loop

- A Goal is decomposed into a Plan (ordered PlanSteps) by an upper-tier planner.
- The user approves the Goal + Plan once. Only an approved plan may execute.
- Within an approved plan the orchestrator auto-dispatches non-state-changing
  steps, subject to:
  - a hard maximum step count per run (proposed default 1, hard ceiling 10);
  - an interrupt: a stop control halts the loop immediately;
  - per-step audit (see §6);
  - failure backoff: after N consecutive step failures (proposed N=2) the loop
    stops and surfaces to the user.
- Re-planning that exceeds the original Goal scope re-triggers plan-level approval.

### 6. Observability, audit, interrupt

Every step records and surfaces: assigned agent, tier, endpoint/transport, tool
used, status, exit code, duration, output summary (redacted), whether it hit the
gate, and next action. A stop button cancels the in-flight loop. Raw content and
raw CLI output are never persisted; only redacted summaries.

### 7. WorkBuddy role

- WorkBuddy remains a task/context source and a result/ledger sink only.
- WorkBuddy MUST NOT trigger execution, MUST NOT bypass plan approval or the
  state-changing gate, and MUST NOT become a controller (unchanged v0.8 boundary).

## Risk Acceptance (requires sign-off)

- The working tree can be modified by an agent. Mitigations: patch-proposal
  default, workspace-write confinement, state-changing gate, step ceiling,
  interrupt, full audit, no dangerous bypass flags.
- The owner accepts that workspace-write mode lets an approved plan modify files
  automatically between gates, and that this risk is bounded — not zero — by the
  controls above.
- Execution still runs only local, authorized CLIs; there is no account/ToS risk
  and no generic shell surface.

## Consequences

- New concepts: execution-capable endpoints, permission tiers, Goal/Plan/PlanStep,
  orchestrator with step ceiling + interrupt, state-changing gate.
- README/roadmap must describe execution as bounded/gated, not forbidden.
- Tests must prove: non-state-changing steps auto-run; state-changing steps block
  for a gate; step ceiling and interrupt stop the loop; no dangerous flags; no
  shell endpoint; WorkBuddy cannot trigger execution.
- Sequencing after this ADR is accepted:
  - **v2.0 Goal-driven Console MVP** — Goal input, Plan approval, auto-run with
    visible per-step state, state-changing gate, stop button, result audit.
  - **v2.1 WorkBuddy task/result integration** — as source/sink only.
- Each of v2.0 / v2.1 needs its own implementation handoff before code.

## Resolved Decisions (2026-06-09 sign-off)

1. Default tier = **patch-proposal**. `workspace-write` must be explicitly opted
   in per plan.
2. Step ceiling default = **1**; hard ceiling = **10**.
3. Consecutive-failure stop threshold = **2**.
4. First execution endpoint = **Codex `exec` patch-proposal only**. Claude
   execution is NOT enabled initially (Claude stays review-only for now).
5. State-changing gate confirms in the **console UI only**. No headless HTTP gate
   in the first iteration.

## Status / Next

Accepted. Decisions above are binding for v2.0. Implementation still pending the
v2.0 implementation handoff review; no execution code is written by this ADR.
Next: draft `CLI-BRIDGE-v2.0-IMPLEMENTATION-HANDOFF.md` (Goal-driven Console MVP),
then implement after that handoff is reviewed.
