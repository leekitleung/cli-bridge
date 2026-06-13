# CLI Bridge v2.13 — REVIEW-ADR-0018-b — Local Live Verification Acceptance

**Batch**: `REVIEW-ADR-0018-b` (review/planning batch)
**Decision**: **PASS — ADR-0018 accepted**
**Date**: 2026-06-13
**Reviews**: `docs/planning/ADR-0018-local-live-verification-execution.md`

**Baseline**: after `RP-2.13-a` and `RP-2.13-b`

**Governing contracts**:
- `docs/planning/ADR-0007-workspace-write-expansion.md`
- `docs/planning/ADR-0017-typed-verification-result-model.md`
- `docs/planning/ADR-0018-local-live-verification-execution.md`

---

## 1. Review Scope

This review evaluates ADR-0018 as a pre-implementation architecture decision.
It does not review an implementation diff and does not authorize ADR-0019.

The review focuses on whether ADR-0018 now resolves the pre-acceptance blockers
instead of delegating them to an execution agent:

- command authority and profile configuration;
- project root resolution and no-root behavior;
- cwd/env containment;
- raw-output handling;
- network-honesty wording;
- human gate and no-autonomy requirements;
- ADR-0007 §2 prerequisite alignment.

## 2. Findings

No remaining blocking findings.

The blocker from `REVIEW-ADR-0018` is closed: a local verify run now derives its
cwd only from `projectWorkspaceRoots[projectKey]`, which is operator/runtime
configuration never set by HTTP. A missing project-specific root is fail-closed
with 409/unavailable and no spawn. The ADR explicitly forbids reusing
`resolveBaselineRootForProject()`'s runtime `baselineRoot` fallback, which is
valid for read-only baseline capture but not for executable verification.

## 3. ADR-0007 Prerequisite Verdict

| Prerequisite | Verdict |
|---|---|
| Reversibility | PASS. The bridge adds no apply/commit/push/merge behavior. A profiled command may mutate the workspace, but that risk is declared through `mutationRisk` and remains an operator-profile responsibility. |
| Containment | PASS. Operator profiles only, `shell: false` structured argv, cwd strictly inside the project-specific trusted root, no `baselineRoot` fallback, env allowlist, output cap, timeout/kill, and single-run lock. |
| Human authority | PASS. Every run requires an explicit human gate displaying profile label, `networkRisk`, and `mutationRisk`. |
| No autonomy | PASS. No scheduler, daemon, queue, background trigger, webhook, or model-triggered run. |
| Audit completeness | PASS. The ADR requires redacted audit metadata only: project/profile label, typed result, and timing. |
| Fail-closed | PASS. Missing profile, disabled project reference, missing project-specific root, cwd traversal, lock contention, timeout, spawn error, or gate denial do not produce a false success. |
| Opt-in / revocable | PASS. `verifyProfileId` is project-scoped, additive, default off, and removable. |
| Network honesty | PASS. The ADR asserts only that the bridge adds no network client and initiates no network itself; it does not claim OS-level child-process network isolation. |

## 4. Boundary Confirmation

- No project/console/API-supplied command, argv, cwd, or env is authorized.
- No free-form `/exec`, `/shell`, `/run`, or `/command` endpoint is authorized.
- No `git`, CI, GitHub, provider API, credential handling, or bridge-initiated
  network client is authorized.
- No raw stdout/stderr, env, absolute cwd, path, `sha256`, raw notes, or diff is
  persisted, returned, audited, or rendered.
- No workspace apply, commit, push, merge, PR, or apply-from-preview behavior is
  authorized.
- ADR-0019 remains PROPOSED — DEFERRED behind ADR-0018 closeout.

## 5. Decision

**PASS.** ADR-0018 is accepted as revised by `RP-2.13-a` and `RP-2.13-b`.

Acceptance authorizes an `EX-2.13-1` implementation handoff for the bounded
operator-profile local verification slice only. It does not authorize ADR-0019,
any provider/network integration, or any generalized command runner surface.

## 6. Next

Author `docs/planning/CLI-BRIDGE-v2.13-LOCAL-LIVE-VERIFICATION-HANDOFF.md`,
then dispatch `EX-2.13-1` to an execution agent. The implementation must return
to `REVIEW-2.13-1` before any closeout commit.
