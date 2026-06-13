# ADR-0018: Local Live Verification Execution (v2.13 planning)

Status: PROPOSED — PRE-ACCEPTANCE DESIGN FIXED (revised by RP-2.13-a, RP-2.13-b);
        awaiting `REVIEW-ADR-0018-b` (ADR-0007 §2 prerequisite review)

Date: 2026-06-13 (revised 2026-06-13: RP-2.13-a, then RP-2.13-b)
Bundle: RP-2.12 Planning Bundle (ADR-0017 → ADR-0018 → ADR-0019)
Depends on: ADR-0017 (typed verification result model) — ACCEPTED and CLOSED
            (`EX-2.12-1` / `REVIEW-2.12-1`, commit `cfce284`)
Blocks: ADR-0019 (Git/CI/GitHub provider integration)
Acceptance: NOT YET ACCEPTED. This ADR crosses the long-standing **no
            execution** boundary. RP-2.13-a has converted the prior open
            blockers into fixed design decisions (§5) so the ADR is now a
            *pre-acceptance design*, not an executable-direction draft. It
            proposes running an **operator-configured verification profile**
            (structured argv, no shell, no project-supplied command) under a
            per-run human gate, mapping exit status to the typed
            `VerificationResult` (ADR-0017). It does NOT authorize `git`/CI/
            GitHub/provider integration (ADR-0019), any free-form command/shell
            endpoint, auto-apply/commit/push/merge, autonomy/scheduler, or raw
            output display. **Network honesty**: the bridge initiates no network
            and adds no network client; it does NOT and cannot claim OS-level
            network isolation of the spawned child (this repo has no sandbox/
            container), so each profile carries a `networkRisk` label that the
            gate must display. **Run root resolution (RP-2.13-b)**: a verify run
            executes ONLY in the operator-configured
            `projectWorkspaceRoots[projectKey]` trusted root; if that
            project-specific root is absent the run is fail-closed (409 /
            unavailable, no spawn) and MUST NOT fall back to the runtime
            `baselineRoot`.

## Context

This is Alternative **C** deferred by ADR-0016:

> **C. Real harness/test execution and live pass/fail** — High value but high
> risk: requires spawning processes, capturing output, and trust boundaries far
> beyond the current read-only posture. Explicitly deferred; needs its own ADR
> with a much stronger sandbox/authority story.

Through ADR-0017 (now closed), the bridge can *store and display* a typed
verification result but cannot *produce* one from a real run — the typed field
is set only by the manual/provider artifact path and is treated as untrusted. To
make the result machine-grounded, the bridge must actually execute a
verification command and derive the typed outcome from it.

This is the first member of the bundle that crosses the hard boundary held since
ADR-0003: **no shell/exec/run/command endpoint, no spawn/exec**. Every prior ADR
(0003 execution layer, 0004/0005 advisory models, 0006 patch-only AgentTeam,
0007 workspace-write skeleton) preserved that line. ADR-0018 therefore must
satisfy the full ADR-0007 §2 prerequisite checklist before it can be accepted.

The original draft left the sandbox/offline/output/UX questions open and pushed
them to the execution agent. RP-2.13-a rejects that: these are
authority-boundary decisions, not execution choices. §5 now fixes them.

## Decision

### 0. Decision status

**PROPOSED — PRE-ACCEPTANCE DESIGN.** No code and no acceptance yet. ADR-0017 is
closed (prerequisite met). The remaining gate is an explicit `REVIEW-ADR-0018-b`
that evaluates the ADR-0007 §2 prerequisites against the now-fixed §5 design and
returns an accept / revise / reject decision. Only on acceptance is an
`EX-2.13-1` handoff authored; implementation then runs in `EX-2.13-1` and
returns to `REVIEW-2.13-1`. Acceptance does not imply acceptance of ADR-0019.

### 1. What is proposed (operator-configured verification profile)

PERMIT one narrow capability: running an **operator/server-configured
verification profile**, locally, under a per-run human gate, mapping its exit
status to a typed `VerificationResult`. The defining property is that **neither
the project record, the bridge API, nor the console can define or supply a
command** — they may only *select and trigger* a profile that an operator
configured out-of-band.

- **Verify profile (allowlist)**: a named, server/operator-configured entry. Not
  editable through any bridge endpoint or the console. Each profile fixes:
  - `id` and sanitized `label` (label is the only command-identifying text ever
    surfaced or stored);
  - `argv: string[]` — a **structured argument vector executed with no shell**
    (`shell: false`); never a shell string, never interpolated from
    project/user input;
  - `cwdPolicy` — resolved strictly within the authorized project root
    (ADR-0014/0015); no traversal outside it;
  - `env` — an explicit **allowlist** of environment variable names passed
    through (default minimal/empty); no blanket inheritance of the host
    environment;
  - `timeoutMs` (bounded by a hard server cap) and `outputCapBytes`;
  - `networkRisk: 'unknown' | 'declared-offline' | 'may-network'` — a **label**,
    not an enforcement;
  - `mutationRisk: 'read-only' | 'may-mutate'` — a label.
- **Project opt-in by reference only**: a project opts in by referencing an
  allowlisted `verifyProfileId` (additive, default off, mirroring the
  `workspaceApplyEnabled` opt-in posture). The project record stores only the
  referenced id, never argv/env/cwd.
- **Run root resolution by project-specific root only (no fallback)**: the verify
  run's working directory is derived ONLY from the operator-configured
  `projectWorkspaceRoots[projectKey]` trusted root (ADR-0014, "never set by
  HTTP"). If that project-specific root is absent, the run endpoint is
  **fail-closed** (HTTP 409 / unavailable) and **no process is spawned**. It MUST
  NOT fall back to the runtime `baselineRoot` — unlike
  `resolveBaselineRootForProject(projectKey)` used for read-only baseline
  capture, which is permitted to fall back. Rationale: local execution has a
  materially higher blast radius than baseline capture, so a runtime-wide
  fallback root must never be silently promoted into an executable cwd. The
  profile `cwdPolicy` then resolves to a subdirectory strictly within that
  project-specific root (no traversal/escape), and runs of one project's profile
  never execute in another project's root.
- **Human-gated per run**: an explicit per-action gate (consistent with
  ADR-0003). The gate displays the profile `label`, `networkRisk`, and
  `mutationRisk` before the human confirms. Never triggered by a scheduler, plan
  advance, or model.
- **Typed mapping only**: exit 0 → `passed`; finite non-zero exit → `failed`;
  spawn error / timeout-kill / termination signal → `errored`; no profile /
  not-run → `unknown`. Stored evidence is typed `VerificationEvidence`
  (ADR-0017) — `result`, profile `commandLabel`, timing, and boolean flags only.
- **No raw output**: stdout/stderr are captured transiently in memory solely to
  determine the exit result, capped at `outputCapBytes` and discarded; they are
  **never persisted and never rendered**. Stored/displayed fields are limited to
  typed `result`, `commandLabel`, timing (`startedAt`, `durationMs`), and flags
  (`truncated`, `outputDiscarded`). No stdout/stderr/env/path/`sha256`/diff.

### 2. What remains forbidden

- `git` (status/diff/commit/push/merge/PR), CI reads, GitHub or any provider
  API, and any **bridge-initiated** outbound network request or network client
  (that is ADR-0019).
- Any free-form command/shell/exec/run endpoint or input; any project- or
  console-supplied command, argv, cwd, or env. Only operator-configured profiles
  run.
- Shell execution (`shell: true`) or string-interpolated commands.
- Auto-apply/auto-commit/auto-push/auto-merge or any bridge-driven workspace/VCS
  mutation (ADR-0007 line held).
- Autonomy: no scheduler/daemon/queue/background loop and no model-triggered
  run; every run needs a human gate at the point of execution.
- Running anything outside the authorized project workspace root.
- Falling back to the runtime `baselineRoot` (or any non-project-specific root)
  for a verify run, or spawning at all when `projectWorkspaceRoots[projectKey]`
  is absent.
- Persisting or rendering raw stdout/stderr, environment, absolute paths, or
  `sha256`.
- Inferring results from free text (the typed result comes from exit status, not
  from parsing output).
- **Claiming a "no-network" guarantee.** The bridge does not isolate the child
  at the OS level; only the `networkRisk` label + bridge-initiates-no-network
  property may be asserted.

### 3. Scope

In scope (for an accepted `EX-2.13-1`):

- Operator/server-configured verify-profile allowlist (structured argv, cwd
  policy, env allowlist, timeout, output cap, `networkRisk`/`mutationRisk`
  labels); not editable via any bridge endpoint/console.
- Additive opt-in `verifyProfileId` reference on the project (default off).
- A contained executor (`shell: false`, explicit cwd resolved within the
  project-specific `projectWorkspaceRoots[projectKey]` root with no `baselineRoot`
  fallback, env allowlist, bounded timeout with kill, output cap + discard,
  single-run lock).
- Exit-status → typed `VerificationResult` mapping stored as ADR-0017 evidence
  (label/timing/flags only).
- Per-run human gate UX that displays label + `networkRisk` + `mutationRisk`,
  with confirm/cancel and **no free-form input**.
- Audit event per run (actor, project, profile label, typed result, timing) with
  redaction; no raw output.
- Tests for: profile-only execution, no project/console command path, `shell:
  false`, run-root resolution (project-specific root only; missing root → 409 /
  no spawn; one project's profile cannot run in another project's root), cwd
  containment + traversal rejection, env allowlist, single-run lock,
  timeout/kill, fail-closed, no-raw-output, no bridge-initiated network/`git`, no
  autonomy, typed mapping, gate risk-label display, and audit excluding absolute
  cwd.

Out of scope:

- `git`/CI/GitHub/provider integration / credentials / network client (ADR-0019).
- Any free-form command/shell endpoint or project/console-defined command.
- OS/container network or filesystem sandboxing (separate future ADR).
- Workspace-write/apply/commit/push/merge (ADR-0007).
- Parallel execution / concurrency > 1.
- Scheduler/model-triggered runs.

### 4. ADR-0007 §2 prerequisites (positions after RP-2.13-a)

| Prerequisite | ADR-0018 position |
|---|---|
| Reversibility | The bridge performs no write/commit. A profiled command may itself mutate the workspace; this is bounded by the operator's profile choice and surfaced via `mutationRisk` at the gate. The bridge neither auto-cleans nor claims reversibility it cannot provide; `read-only` profiles are the recommended default. |
| Containment | Operator-configured profiles only; `shell: false` structured argv; cwd resolved **only** within the project-specific `projectWorkspaceRoots[projectKey]` root (no `baselineRoot` fallback; absent root → 409 / no spawn); env allowlist (no blanket inheritance); bounded timeout + kill; output cap + discard; single-run lock. No project/console-supplied command. |
| Human authority preserved | ADR-0003 gate holds; each run needs an explicit per-action human confirm that displays `networkRisk` and `mutationRisk`. No plan-advance/model trigger. |
| No autonomy | No scheduler/daemon/queue/background/model trigger. |
| Audit completeness | Each run emits an audit event (actor, project, profile label, typed result, timing) with redaction; no raw output. |
| Fail-closed | Missing/disabled profile, gate denial, lock contention, timeout, spawn error, or non-project cwd → no run or aborted run with typed `errored`/`unknown`; no partial side effect surfaced as success. |
| Opt-in and revocable | `verifyProfileId` is opt-in per project, default off, and removable; the no-execution flow remains fully functional when off. |
| Network honesty (addendum) | The bridge initiates no network and adds no network client (enforceable/testable). It does NOT claim OS-level isolation of the child; `networkRisk` is a declared label shown at the gate. True offline enforcement requires an OS/container sandbox absent from this repo and is a separate future ADR. |

### 5. Resolved pre-acceptance design decisions (RP-2.13-a, RP-2.13-b)

The previously-open blockers are now fixed. `REVIEW-ADR-0018-b` evaluates these;
it does not re-delegate them to the execution agent.

- **Run root resolution — FIXED (RP-2.13-b)**: the verify run's cwd derives ONLY
  from the operator-configured `projectWorkspaceRoots[projectKey]` trusted root.
  If that project-specific root is absent, the run endpoint is fail-closed (HTTP
  409 / unavailable) and no process is spawned; it MUST NOT fall back to the
  runtime `baselineRoot`. (Baseline capture's `resolveBaselineRootForProject`
  fallback is deliberately NOT reused for execution.) The profile `cwdPolicy`
  resolves to a subdirectory strictly inside that root with traversal rejected,
  and a profile bound to project A can never execute in project B's root. The
  absolute cwd is never returned, audited, or rendered (only opaque
  project/profile identifiers).

- **Executor model — FIXED**: operator-configured verify-profile allowlist;
  `shell: false` structured argv; explicit cwd within project root; env
  allowlist; single-run lock per project. No project/console-defined command.
- **Offline proof / network stance — FIXED (honest)**: the assertable property
  is "the bridge initiates no network and contains no network/`git`/provider
  client", proven by source/test inspection of the new code. The bridge does
  **not** guarantee the child is offline (no OS sandbox in this repo). Each
  profile declares `networkRisk`, displayed at the gate. A hard offline
  guarantee is explicitly deferred to a future sandbox ADR.
- **Workspace mutation risk — FIXED**: no bridge-driven write/commit; child
  mutation is bounded by operator profile choice and surfaced via `mutationRisk`
  at the gate; `read-only` profiles recommended as default. ADR-0007 line held.
- **Output handling — FIXED**: transient in-memory capture capped at
  `outputCapBytes`, used only for exit determination, then discarded. Never
  persisted, never rendered. Stored fields: typed `result`, `commandLabel`,
  timing, `truncated`/`outputDiscarded` flags only.
- **Timeout / kill / lock — FIXED**: per-profile `timeoutMs` bounded by a hard
  server cap; on timeout the process (tree) is killed and the result is
  `errored`; a single in-flight run per project (lock) — a second trigger while
  running is rejected fail-closed.
- **Result mapping — FIXED**: exit 0 → `passed`; finite non-zero → `failed`;
  spawn error / timeout-kill / signal → `errored`; no profile / not-run →
  `unknown`. No free-text inference.
- **Console gate UX — FIXED**: the gate shows profile label + `networkRisk` +
  `mutationRisk` with confirm/cancel only; there is **no** text/command input
  field anywhere; the UI can only select an allowlisted profile and trigger it.
- **Patch-only interaction — FIXED**: a verify run has no apply/commit path; it
  cannot write artifacts to the main tree or trigger ADR-0007 workspace-write.

## Alternatives Considered

### A. Stay non-executing (status quo after ADR-0017)
Typed results remain manual/advisory only; no machine-grounded verification.
Lower risk but leaves the core value (real pass/fail) unrealized.

### B. Operator-configured verify-profile, opt-in, human-gated (this ADR)
Recommended. Smallest viable execution surface: no project/console-defined
command, structured argv, honest network labeling, no raw output.

### C. Project/console-defined `verifyCommand` (the original draft shape)
Weakened to a reference-only model. A project-editable command string risks
sliding into a general shell and puts command definition on the wrong side of
the trust boundary. Superseded by the operator-profile model.

### D. General executor / shell endpoint
Rejected. A free-form command/exec endpoint is exactly the boundary every prior
ADR forbade; far too large a blast radius.

## Risk Acceptance

- **Execution blast radius**: a profiled command could still do significant work.
  Mitigation: operator-only profiles, `shell: false` structured argv, cwd
  containment, env allowlist, bounded timeout/kill, single-run lock, human gate.
- **False sense of isolation**: claiming "no network" without an OS sandbox would
  be dishonest. Mitigation: assert only "bridge initiates no network"; label
  per-profile `networkRisk`; display it at the gate; defer real isolation to a
  sandbox ADR.
- **Workspace mutation**: a command may write caches/artifacts. Mitigation:
  `mutationRisk` label at the gate; `read-only` default recommended; no
  bridge-driven write/commit; ADR-0007 held.
- **Boundary erosion to apply/commit**: Mitigation: ADR-0007 line explicit; no
  VCS/write authorized; ADR-0019 separate.
- **Autonomy creep**: Mitigation: explicit no-autonomy prerequisite; per-run
  human gate mandatory.
- **Output leakage**: Mitigation: transient capture, discarded; typed result
  only; raw output never persisted or rendered.

## Consequences

If accepted and implemented: the bridge can produce a machine-grounded typed
verification result from an operator-configured, opt-in, human-gated local
profile, stored as ADR-0017 evidence (label/timing/flags only), with no
bridge-initiated network, no `git`/CI/provider client, and no write/commit — and
with honest `networkRisk`/`mutationRisk` disclosure at the gate.

If rejected/deferred: typed results stay manual/advisory; live verification
waits, or a sandbox ADR is required first for a hard offline guarantee.

## Acceptance Conditions

An `EX-2.13-1` handoff and `REVIEW-2.13-1` closeout MUST verify:

1. **ADR-0017 prerequisite met**: the typed result sink exists and is the storage
   target (satisfied; `cfce284`).
2. **Profiles only, no defined command**: only operator/server-configured verify
   profiles run; the project record / bridge API / console cannot define or
   supply a command, argv, cwd, or env — they reference and trigger a profile id
   only. No free-form shell/exec/run endpoint or input.
3. **No shell**: execution uses `shell: false` structured argv; no string
   interpolation.
4. **Per-run human gate with risk disclosure**: every run needs an explicit human
   confirm that displays the profile `label`, `networkRisk`, and `mutationRisk`;
   no plan-advance/scheduler/model trigger.
5. **Containment**: cwd resolved within the project root only; env allowlist (no
   blanket inheritance); no path traversal; single-run lock per project.
6. **Network honesty**: no bridge-initiated network and no `git`/CI/GitHub/
   provider/network client in the new code (proven by source/tests). No
   "no-network" guarantee is asserted; only the labeled posture.
7. **No write/apply/commit/push/merge**: ADR-0007 line held; verify cannot become
   apply.
8. **Typed mapping only**: exit status → typed `VerificationResult` per §5; no
   free-text inference.
9. **No raw output**: stdout/stderr captured transiently, capped, discarded;
   never persisted, never rendered. Stored/displayed = typed result +
   commandLabel + timing + flags only; no env/path/`sha256`/diff.
10. **Audit + redaction**: each run audited (profile label, typed result, timing)
    with redaction.
11. **Fail-closed**: missing/disabled profile, gate denial, lock contention,
    timeout/kill, spawn error, or non-project cwd → no run or `errored`/`unknown`,
    no false success.
12. **No autonomy**: no scheduler/daemon/queue/background/model trigger.
13. **Opt-in revocable + backward compatible**: off by default; removing
    `verifyProfileId` restores the full no-execution flow; existing tests pass.
14. **Tests**: profile-only/no-defined-command, `shell: false`, gate risk
    display, cwd/env containment, single-run lock, timeout/kill, fail-closed,
    no-raw-output, no bridge network/`git`, no-autonomy, typed mapping, and the
    run-root tests in #15.
15. **Run root resolution (no fallback)**: the run cwd derives only from
    `projectWorkspaceRoots[projectKey]`; a missing project-specific root returns
    409 / unavailable with no runner invoked and no `baselineRoot` fallback; a
    profile of project B cannot run in project A's root; configured/`cwdPolicy`
    subpath traversal is rejected; and the run response/audit/console expose only
    opaque project/profile/timing, never the absolute cwd. Tests cover: missing
    root → 409 + no spawn, cross-project root isolation, traversal rejection, and
    audit-without-cwd.

## Allowed files (proposed for EX-2.13-1, to be finalized at acceptance)

- `packages/shared/src/types.ts` — additive `VerifyProfile` shape, opt-in
  `verifyProfileId` on `Project`, and any execution-result DTO (reusing ADR-0017
  evidence types).
- `packages/shared/src/schemas.ts` — validation for `verifyProfileId` reference
  and profile shape; reject project/console-supplied argv/cwd/env/command.
- A new contained executor module under `apps/local-server/src/` (e.g.
  `verification/profile-runner.ts`) — `shell:false` spawn, project-specific root
  resolution (no `baselineRoot` fallback; absent → 409/no spawn), cwd/env
  containment, timeout/kill, output cap + discard, exit→typed mapping, single-run
  lock.
- Operator profile configuration loading (server/operator config source only,
  not a bridge-editable surface).
- `apps/local-server/src/routes/bridge-api.ts` and/or
  `apps/local-server/src/routes/project-console.ts` — the human-gated trigger +
  risk-label gate + typed-result surfacing only (no free-form input).
- Audit/observability wiring for the run event (redacted).
- `docs/contracts/bridge-projects-api.md`, `CHANGELOG.md`, and the relevant
  `tests/*.mjs` suites.

Exact file list is fixed in the `EX-2.13-1` handoff after acceptance; anything
outside it requires STOP-and-report.

## Handoff prompt sketch (EX-2.13-1) — only after acceptance

> Implement only ADR-0018 as revised by RP-2.13-a. Add an operator-configured
> verify-profile allowlist (structured argv, cwd-in-project-root, env allowlist,
> timeout, output cap, `networkRisk`/`mutationRisk` labels), an opt-in
> project-level `verifyProfileId` reference (default off), and a contained
> executor that runs ONLY a referenced profile with `shell: false`, resolving cwd
> only from `projectWorkspaceRoots[projectKey]` (no `baselineRoot` fallback;
> missing root → 409 / no spawn), bounded timeout/kill, output cap + discard, and
> a single-run lock. Map exit status to
> the typed `VerificationResult` and store typed evidence (label/timing/flags
> only). Gate every run behind an explicit human confirm that displays the
> profile label, `networkRisk`, and `mutationRisk`; expose no free-form input.
> Do NOT add a network/`git`/provider client, write/commit/apply, schedule runs,
> persist or render raw output, or claim OS-level network isolation. Run the full
> verification command set and report containment/network-honesty evidence.
> Prepare one dedicated `EX-2.13-1` diff; do not commit/push until `REVIEW-2.13-1`
> authorizes the closeout commit.

## Status / Next

PROPOSED — PRE-ACCEPTANCE DESIGN FIXED. Next is `REVIEW-ADR-0018-b`: an
ADR-0007 §2 prerequisite review of the §5 decisions (now including the RP-2.13-b
run-root resolution rule) returning accept / revise / reject. No `EX-2.13-1`
handoff and no development execution agent may be dispatched before that
acceptance. ADR-0019 remains PROPOSED — DEFERRED behind ADR-0018 closeout and
must not start early.
