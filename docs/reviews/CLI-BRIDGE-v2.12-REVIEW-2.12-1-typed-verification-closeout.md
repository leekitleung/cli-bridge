# CLI Bridge v2.12 — REVIEW-2.12-1 — Typed Verification Result Model Closeout

**Batch**: `REVIEW-2.12-1` (reviewing batch — owned by the reviewing agent)
**Decision**: **PASS — closeout authorized**
**Date**: 2026-06-13
**Reviews**: `EX-2.12-1` implementation of ADR-0017 (typed verification result model)

**Baseline**: `cb0fa49` (accept ADR-0017 + author EX-2.12-1 handoff);
`main ≡ origin/main` at review start, EX dirty tree uncommitted as required.

**Governing contracts**:
- `docs/planning/ADR-0017-typed-verification-result-model.md` (ACCEPTED)
- `docs/planning/CLI-BRIDGE-v2.12-TYPED-VERIFICATION-MODEL-HANDOFF.md`

---

## 1. Scope / allowed-files check — PASS

10 files changed (+424 / −13). All within the ADR-0017 / handoff allowed-files
list:

| File | Allowed | Notes |
|---|---|---|
| `packages/shared/src/types.ts` | yes | closed `VERIFICATION_RESULTS` tuple, `VerificationEvidence`, additive optional fields |
| `packages/shared/src/schemas.ts` | yes | runtime validation; rejects extra/raw-ish fields + command-line `commandLabel` |
| `apps/local-server/src/project-observability/builders.ts` | yes | pure typed counts/record derivation |
| `apps/local-server/src/routes/bridge-api.ts` | yes | wiring-only (4 lines) artifact field pass-through |
| `apps/local-server/src/routes/project-console.ts` | yes | inert typed pill/counts rendering |
| `docs/contracts/bridge-projects-api.md` | yes | documents additive typed fields |
| `CHANGELOG.md` | yes | `EX-2.12-1` entry |
| `tests/bridge-project-observability.test.mjs` | yes | boundary tests |
| `tests/bridge-teams-api.test.mjs` | yes | artifact accept/reject coverage |
| `tests/project-console-behavior.test.mjs` | yes | inert-render / no-affordance tests |

No file outside the ratified allowed-files. No new route, no provider/execution
module. `git diff --check` clean (LF→CRLF warnings only).

## 2. Acceptance-condition verdicts (ADR-0017) — all PASS

1. **No product execution / no network** — PASS. No spawn/exec/runner, no
   `git`/CI/GitHub/provider/network in product code. The new code is type
   definitions, pure validation, pure builder derivation, and inert rendering.
   Reviewer-run verification commands (below) are review-only, not bridge
   behavior.
2. **Additive & backward compatible** — PASS. `verificationNotes`, `notes`,
   `harnessStatus`, and the v2.11 `VerificationStatusSummary` fields are
   unchanged; every new field (`result?`, `verificationEvidence?`,
   `resultCounts?`) is optional. Confirmed by the "legacy records still carry
   notes" assertions.
3. **Typed, closed result set** — PASS. `VERIFICATION_RESULTS =
   ['passed','failed','skipped','errored','unknown'] as const`; no free-text
   outcome field. `schemas.ts` rejects any `result` outside the set (test:
   `result: 'maybe'` / `'passed-by-notes'` → 400).
4. **No inference** — PASS. Typed `result` is sourced only from
   `artifact.verificationEvidence` via `validVerificationEvidence`; free-text
   `verificationNotes` ("npm test passed") yields `record.result === undefined`
   and no `resultCounts` (dedicated test asserts this).
5. **No raw surface** — PASS. Summary/record/console expose only typed
   result + counts + recency. `commandLabel` is constrained to
   `/^[A-Za-z0-9_.:-]{1,80}$/` (rejects command lines / spaces / paths). Tests
   assert no `sha256`/`stdout`/`stderr`/`diff`/raw notes appear in the
   `/verification` payload or console DOM; extra fields (`stdout`, `sha256`,
   `output`) on evidence are rejected at recording.
6. **Inert display** — PASS. Console renders typed counts (`typed: passed: N…`)
   and a per-record pill or `unknown`; no button, no `[href]`, no
   run/execute/apply/promote/commit/discard affordance (asserted). Missing/
   malformed → fail-closed "unknown"/"not yet available". Uses the existing
   GET `/verification` fetch only (asserted GET-only, single call).
7. **Determinism** — PASS. `buildVerificationStatusSummary` /
   `buildHarnessVerification` remain pure functions of `ObservabilityInput`;
   `resultCounts` attached only when typed evidence exists; ordering unchanged.
8. **Tests** — PASS. Typed-result render, no-inference, no-raw-surface,
   malformed-rejection, backward-compat, and fail-closed all covered across the
   three test files.

## 3. Independent verification (re-run by reviewer)

| Command | Result |
|---|---|
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `node --test tests/bridge-project-observability.test.mjs` | included below |
| `node --test tests/project-console-behavior.test.mjs` | included below |
| `node --test tests/bridge-teams-api.test.mjs` | included below |
| `node --test tests/project-console-ui.test.mjs` | included below |
| 4 suites combined | **138 / 138 pass, 0 fail** (33+23+65+17) |
| `git diff --check` | clean (LF→CRLF warnings only) |

EX-reported `npm test` 631/631 accepted; reviewer independently re-confirmed
typecheck, lint, and the four boundary-bearing suites.

## 4. Boundary confirmation (bundle invariants held)

- ADR-0018/ADR-0019 NOT implemented; no `verifyCommand`, no runner, no provider.
- No product-side execution / spawn / exec / `git` / CI / GitHub / network.
- No pass/fail inference from free text.
- No raw notes / output / content / path / hash / diff surfaced.
- No run / apply / promote / write / discard / commit affordance.
- ADR-0007 patch-only / no-workspace-write / no-VCS-mutation line held.

## 5. Findings

None blocking. No change requests. The implementation is faithful to ADR-0017
and the EX-2.12-1 handoff, with strong boundary test coverage.

## 6. Decision & closeout authorization

**PASS.** `REVIEW-2.12-1` authorizes the dedicated `EX-2.12-1` closeout commit
carrying exactly the 10 allowed files. This review record is committed
separately as the `REVIEW-2.12-1` artifact.

## 7. Next

- ADR-0017 line is complete and closed.
- ADR-0018 (local live verification execution) remains **PROPOSED — DEFERRED**;
  its acceptance requires this closeout (done after the commit below) plus a
  dedicated ADR-0007 §2 prerequisite review. Do not begin `EX-2.13-1` without
  returning to an `RP`/acceptance batch first.
