# ADR-0018: Local Live Verification Execution (v2.13 planning)

Status: PROPOSED — DEFERRED until ADR-0017 is accepted and `EX-2.12-1` closes

Date: 2026-06-13
Bundle: RP-2.12 Planning Bundle (ADR-0017 → ADR-0018 → ADR-0019)
Depends on: ADR-0017 (typed verification result model) — accepted AND implemented
Blocks: ADR-0019 (Git/CI/GitHub provider integration)
Acceptance: NOT YET ACCEPTED. This ADR crosses the long-standing **no
            execution** boundary. It proposes a bounded, explicitly configured,
            human-gated **local** verification command run whose exit status is
            mapped to the typed `VerificationResult` from ADR-0017. It does NOT
            authorize `git`/CI/GitHub/provider integration (ADR-0019), arbitrary
            shell/exec endpoints, auto-apply/commit/push/merge, autonomy/
            scheduler, or raw output display. Network isolation for the child
            process is a pre-acceptance blocker: this ADR cannot be accepted
            until the acceptance decision fixes how an execution batch proves or
            enforces that the configured command is offline.

## Context

This is Alternative **C** deferred by ADR-0016:

> **C. Real harness/test execution and live pass/fail** — High value but high
> risk: requires spawning processes, capturing output, and trust boundaries far
> beyond the current read-only posture. Explicitly deferred; needs its own ADR
> with a much stronger sandbox/authority story.

Through ADR-0017, the bridge can *store and display* a typed verification result
but cannot *produce* one from a real run — the typed field is set only by the
manual/provider artifact path and is treated as untrusted. To make the result
machine-grounded, the bridge must actually execute a verification command and
derive the typed outcome from it.

This is the first member of the bundle that crosses the hard boundary held since
ADR-0003: **no shell/exec/run/command endpoint, no spawn/exec**. Every prior ADR
(0003 execution layer, 0004/0005 advisory models, 0006 patch-only AgentTeam,
0007 workspace-write skeleton) preserved that line. ADR-0018 therefore must
satisfy the full ADR-0007 §2 prerequisite checklist before it can be accepted,
because it introduces real process execution.

## Decision

### 0. Decision status

**PROPOSED — DEFERRED.** No code, and no acceptance, until BOTH:

1. ADR-0017 is accepted and `EX-2.12-1` has closed through `REVIEW-2.12-1`
   (a typed result sink exists), and
2. this ADR receives its own explicit senior acceptance with a satisfied
   ADR-0007 §2 prerequisite review.

Implementation, if accepted, proceeds in `EX-2.13-1` and returns to
`REVIEW-2.13-1`. Acceptance does not imply acceptance of ADR-0019.

### 1. What is proposed (bounded local execution)

PERMIT a single, narrow capability: running **one explicitly configured
verification command per project**, locally, under a per-run human gate, and
mapping its exit code to a typed `VerificationResult`:

- The command is **not** arbitrary. It is a project-scoped, opt-in, pre-declared
  verification command (e.g. a configured `verifyCommand` such as `npm test`),
  stored on the project model behind an explicit opt-in flag (mirroring the
  existing `workspaceApplyEnabled` opt-in pattern). The console/API exposes no
  free-form shell entry point.
- Execution is **human-gated per run** (an explicit per-action gate, consistent
  with ADR-0003) — never triggered by a scheduler, plan advance, or model.
- The run is contained: confined to the authorized project workspace root
  (ADR-0014/0015 project-scoped root), with bounded timeout and bounded output
  capture. It must use an explicit working directory, an explicit env policy,
  no-shell argv execution unless a later acceptance review justifies otherwise,
  and a single-run lock. Network isolation/proof is unresolved here and is a
  blocker for acceptance, not an execution-agent judgment call.
- The result mapping is typed only: exit code 0 → `passed`, non-zero → `failed`,
  timeout/spawn error → `errored`, not-run → `unknown`. The stored evidence is
  the typed `VerificationEvidence` (ADR-0017) — counts/result/recency — **not**
  raw stdout/stderr.
- Raw output is redacted/non-surfaced, matching the existing
  `rawProviderOutput` / `outputRedacted` posture; at most a bounded, sanitized,
  non-displayed capture for audit, never rendered in the console.

### 2. What remains forbidden

- `git` (status/diff/commit/push/merge/PR), CI reads, GitHub or any provider
  API, and any bridge-initiated outbound network request (that is ADR-0019).
- Any **arbitrary** shell/exec/run/command endpoint or free-form command input;
  only the pre-declared, opt-in `verifyCommand` may run.
- Auto-apply/auto-commit/auto-push/auto-merge or any workspace/VCS mutation
  (ADR-0007 line held).
- Autonomy: no scheduler/daemon/queue/background loop and no model-triggered
  run; every run needs a human gate at the point of execution.
- Running anything outside the authorized project workspace root.
- Accepting this ADR before a concrete offline-execution proof is written into
  the handoff.
- Surfacing raw stdout/stderr, environment, absolute paths, or `sha256` in any
  read surface.
- Inferring results from free text (the typed result comes from the exit code,
  not from parsing output).

### 3. Scope

In scope (for an accepted `EX-2.13-1`):

- Project-scoped opt-in `verifyCommand` config (additive, default off), with the
  command represented as a structured argv vector plus sanitized label, not as a
  shell string. A string form may be reconsidered only by the acceptance review
  and must not silently become a general shell endpoint.
- A contained executor that runs the configured command with bounded
  timeout/output, under a per-run human gate, within the project root.
- Exit-code → typed `VerificationResult` mapping stored as ADR-0017 evidence.
- Audit event for each run (actor, project, command label, result, timing) with
  redaction; no raw output in audit display.
- Console affordance limited to: show the configured command label, a
  human-gated "run verification" action, and the resulting typed status. No
  arbitrary input field.
- Tests proving containment, the per-run gate, fail-closed, redaction, no
  bridge-initiated network/`git`, no autonomy, and the offline-execution proof
  chosen at acceptance.

Out of scope:

- `git`/CI/GitHub/network/credentials (ADR-0019).
- Arbitrary command/shell endpoint.
- Workspace-write/apply/commit/push/merge (ADR-0007).
- Parallel execution / concurrency > 1.
- Scheduler/model-triggered runs.

### 4. ADR-0007 §2 prerequisites (MUST all be satisfied to accept)

| Prerequisite | ADR-0018 position |
|---|---|
| Reversibility | A verification run is intended to be read-only from the bridge's perspective, but arbitrary commands may mutate. Acceptance MUST either restrict the configured command to an allowlisted verification profile or document how mutation risk is surfaced to the user before the gate. No bridge-driven write/commit is authorized. |
| Containment | Runs only the pre-declared structured `verifyCommand`, inside the authorized project root, with bounded timeout/output caps, explicit cwd/env, no-shell argv by default, and single-run locking. Network isolation/proof MUST be specified before acceptance. |
| Human authority preserved | ADR-0003 gate model holds; each run requires an explicit per-action human gate. No run on plan advance or by a model. |
| No autonomy | No scheduler/daemon/queue/background/model trigger. |
| Audit completeness | Each run emits an audit event (actor, project, command label, typed result, timing) with secret/raw-output redaction. |
| Fail-closed | Missing config, gate denial, timeout, spawn error, or non-project path → no run or aborted run with typed `errored`/`unknown`; no partial side effect surfaced as success. |
| Opt-in and revocable | `verifyCommand` is opt-in per project and can be disabled; the no-execution flow remains fully functional when off. |

### 5. Pre-acceptance blockers the next planning review must resolve

These are not execution-agent design choices. ADR-0018 must not be promoted to
ACCEPTED until a planning/review batch fixes each item below and carries the
chosen answers into the `EX-2.13-1` handoff.

- **Executor sandbox**: child-process spawn details, no-shell argv requirement,
  command allowlist/profile model, env scrubbing, cwd containment, and single-run
  lock.
- **Offline proof**: whether network is prevented by sandboxing, prohibited by
  command allowlist, or verified by source/static checks. This must be resolved
  before acceptance; otherwise "no network" is not enforceable.
- **Workspace mutation risk**: whether configured commands are restricted to
  known read-only test profiles or merely user-gated. This must be explicit in
  the acceptance decision.
- **Output handling**: max captured bytes, truncation, where (if anywhere) a
  redacted capture is stored, and confirmation it is never rendered.
- **Timeout/limits**: default timeout, kill behavior, concurrency lock
  (single run at a time per project).
- **Result mapping edge cases**: signals, non-standard exit codes, partial runs.
- **Console UX**: how the gate is presented; ensuring no free-form input leaks a
  general shell.
- **Interaction with patch-only boundary**: confirm a verify run cannot become
  an apply path.

## Alternatives Considered

### A. Stay non-executing (status quo after ADR-0017)
Typed results remain manual/advisory only; no machine-grounded verification.
Lower risk but leaves the core value (real pass/fail) unrealized.

### B. Bounded, opt-in, human-gated local command (this ADR)
Recommended path to machine-grounded results with the smallest viable execution
surface and the full ADR-0007 prerequisite set.

### C. General executor / shell endpoint
Rejected. A free-form command/exec endpoint is exactly the boundary every prior
ADR forbade; far too large a blast radius.

## Risk Acceptance

- **Execution blast radius**: an arbitrary command could do anything. Mitigation:
  only a pre-declared structured `verifyCommand`, no free-form input, contained
  to project root, bounded, human-gated, with an offline proof required before
  acceptance.
- **Boundary erosion to apply/commit**: a runner invites "also commit it".
  Mitigation: ADR-0007 line explicitly held; no VCS/write authorized; ADR-0019
  is separate.
- **Autonomy creep**: a runner invites scheduling. Mitigation: explicit
  no-autonomy prerequisite; per-run human gate mandatory.
- **Output leakage**: stdout/stderr may contain secrets/paths. Mitigation:
  redaction posture preserved; typed result only; raw output never rendered.
- **Injection**: shell string interpolation risk. Mitigation: prefer argv/no-shell
  spawn; env scrubbing; resolved in EX review.

## Consequences

If accepted and implemented: the bridge can produce a machine-grounded typed
verification result from a bounded, opt-in, human-gated local command, stored as
ADR-0017 evidence, with no `git`/CI/network and no write/commit.

If rejected/deferred: typed results stay manual/advisory; live verification waits.

## Acceptance Conditions

An `EX-2.13-1` handoff and `REVIEW-2.13-1` closeout MUST verify:

1. **ADR-0017 prerequisite met**: a typed result sink exists and is the storage
   target; this ADR populates it from execution.
2. **No arbitrary command**: only the project-scoped, opt-in, pre-declared
   structured `verifyCommand` can run; no free-form shell/exec/run endpoint or
   input.
3. **Per-run human gate**: every execution requires an explicit human gate; no
   plan-advance/scheduler/model trigger.
4. **Containment**: runs inside the authorized project root only; bounded
   timeout and output caps; explicit cwd/env; no-shell argv unless separately
   accepted; no path traversal.
5. **No `git`/CI/GitHub/provider integration; offline proof**: none authorized
   or present in bridge code, and the handoff/review includes the accepted proof
   that configured verification runs cannot become bridge-authorized network
   activity.
6. **No write/apply/commit/push/merge**: ADR-0007 line held; verify cannot
   become apply.
7. **Typed mapping only**: exit code → typed `VerificationResult`; no free-text
   inference; raw stdout/stderr never rendered.
8. **Audit + redaction**: each run audited with redaction; no raw output/secret/
   absolute path in any read surface.
9. **Fail-closed**: missing config / gate denial / timeout / spawn error / wrong
   path → no run or aborted with typed `errored`/`unknown`, no false success.
10. **No autonomy**: no scheduler/daemon/queue/background/model trigger.
11. **Opt-in revocable + backward compatible**: off by default; disabling
    restores the full no-execution flow; existing tests pass.
12. **Tests**: containment, gate, fail-closed, redaction, offline proof/no-`git`,
    no-autonomy, and typed-mapping behavior.

## Allowed files (proposed for EX-2.13-1, to be finalized at acceptance)

- `packages/shared/src/types.ts` — additive opt-in structured `verifyCommand`
  config on `Project` and any execution-result DTO (reusing ADR-0017 evidence
  types).
- A new contained executor module under
  `apps/local-server/src/` (e.g. `verification/local-runner.ts`) — spawn,
  timeout, output cap, exit→typed mapping. New file, narrowly scoped.
- `apps/local-server/src/routes/bridge-api.ts` and/or
  `apps/local-server/src/routes/project-console.ts` — the human-gated run
  affordance and typed-result surfacing only (no free-form input).
- Audit/observability wiring for the run event (redacted).
- `docs/contracts/bridge-projects-api.md`, `CHANGELOG.md`, and the relevant
  `tests/*.mjs` suites.

Exact file list is fixed in the `EX-2.13-1` handoff after acceptance; anything
outside it requires STOP-and-report.

## Handoff prompt sketch (EX-2.13-1)

> Implement only ADR-0018, and only after ADR-0017/`EX-2.12-1` has closed.
> Add an opt-in, project-scoped structured `verifyCommand`; a contained executor
> that runs ONLY that command inside the project root with bounded timeout/output
> under a per-run human gate; map exit code to the typed `VerificationResult` and
> store it as ADR-0017 evidence; audit each run with redaction. Do NOT add a
> free-form shell endpoint, touch `git`/CI/provider integration, write/commit/
> apply, schedule runs, or render raw output. Implement the offline-execution
> proof fixed by the acceptance review. Run the full verification command set and
> report containment evidence. Prepare one dedicated `EX-2.13-1` diff; do not
> commit/push until `REVIEW-2.13-1` authorizes the closeout commit.

## Status / Next

PROPOSED — DEFERRED. Acceptance requires ADR-0017 closed plus an explicit
ADR-0007 §2 prerequisite review for this ADR. ADR-0019 remains PROPOSED/DEFERRED
behind this one.
