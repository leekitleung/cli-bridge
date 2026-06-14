# ADR-0021: Goal Plan-Step Verification-Result Presentation (v2.16 planning)

Status: PROPOSED — awaiting explicit acceptance

Date: 2026-06-14
Depends on: ADR-0017 (typed model), ADR-0020 (run-history presentation) — CLOSED
Acceptance: NOT YET ACCEPTED. Strictly read-only, console-only presentation
            increment that surfaces the **already-exposed** per-step typed
            verification `result` in the goal view's plan-step table, by joining
            existing `/verification.records[].stepId` onto the existing plan
            steps. No new endpoint, no new fetch, no execution, no network, no
            credential, no write surface, and **no new run↔step identity
            mapping** (the join key already exists on the records). Crosses no
            capability boundary → light acceptance (no ADR-0007 §2 review).

## Context

ADR-0020 surfaced project-level verification run history. The remaining visible
gap is **per-step**: the goal view's plan-step table (`renderGoalCard`) shows
`# / intent / kind / tier / status` for each plan step but does not show whether
that step has recorded verification evidence or its typed outcome.

The data already exists, sanitized, on the cached `/verification` response:

- `buildHarnessVerification` emits `records[]` of `HarnessVerificationRecord`,
  each carrying `stepId` (`artifact.planStepId` or the done-step `step.id`) and,
  when typed evidence is present, a discrete `result: VerificationResult`
  (ADR-0017). These records are already note-free / sanitized.
- The console already caches this as `store.cache.verification` via `refreshAll`.

So a per-step typed result can be shown by a pure **read-only join** of
`store.cache.verification.records` onto the plan steps by `stepId` — no new
endpoint, no new fetch, and crucially **no new identity mapping**: `stepId` is
already on the record.

Live run records (`liveRunRecords`, ADR-0020) are **project-scoped** and carry
no `stepId`; they are intentionally **out of scope** here (step binding for them
would need the deferred run↔step mapping). They remain the project-level history
list from ADR-0020.

## Decision

### 0. Decision status

**PROPOSED.** No code until explicit acceptance + an `EX-2.16-1` handoff. This is
a console-only read-only change consuming existing cached fields.

### 1. What is permitted

PERMIT adding an inert per-step **verification result** indicator to the goal
plan-step table:

- For each plan step, look up the most relevant `store.cache.verification.records`
  entry by `stepId`; if found and it has a discrete `result`, render an inert
  typed pill (`passed/failed/skipped/errored/unknown`).
- If no matching record or no `result`, render an inert placeholder (e.g. `—`).
- HTML-escape any rendered string; render only the discrete `result` enum.

### 2. What is forbidden

- No new endpoint; no new fetch (consume the already-cached `/verification`).
- No execution, spawn, `git`, network, credential, or provider call.
- No raw output / notes / token / URL / path / hash / branch / owner / repo /
  diff display; only the discrete typed `result`.
- No write/apply/promote/commit/run/discard control, link, or affordance on the
  per-step indicator.
- No pass/fail inference from free text; render only the stored discrete
  `result` (skip steps whose record has only legacy free-text `notes` and no
  typed `result`).
- No new run↔step identity mapping, no new store/field, no `liveRunRecords`
  step-binding, no scheduler/auto-refresh.

### 3. Scope

In scope (for an accepted `EX-2.16-1`):

- `renderGoalCard` plan-step table: an inert per-step typed-result cell/badge
  joined from `store.cache.verification.records` by `stepId`.
- Contract note (if needed) that `records[].stepId`/`result` are consumed by the
  goal view.
- Tests: per-step result renders when a typed record matches by `stepId`; steps
  without a typed record show `—`; escaping; no write control; no extra fetch;
  no raw/notes/token/identity in the step row even if a record carries extra
  fields.
- CHANGELOG.

Out of scope:

- Any backend/endpoint/store change.
- Step-binding `liveRunRecords` (needs deferred run↔step mapping).
- New verification capability, provider, execution, or boundary.

### 4. ADR-0007 prerequisites

| Prerequisite | ADR-0021 position |
|---|---|
| Reversibility | Pure read-only display; no state change. |
| Containment | Consumes existing cached sanitized records; no fs/network/spawn. |
| Human authority | Viewing triggers nothing. |
| No autonomy | No scheduler/auto-refresh. |
| Audit completeness | No new data; nothing to audit. |
| Fail-closed | No matching record / no `result` → inert `—`. |
| Opt-in and revocable | Bound to the existing read-only goal view. |

### 5. Boundary and invariants

| Invariant | ADR-0021 position |
|---|---|
| Read-only presentation | Display only; no new fetch, no mutation. |
| No execution / network / credential | None. |
| No new endpoint / store / field / mapping | Joins existing `records[].stepId`. |
| No raw / notes / token / identity surface | Discrete `result` only; HTML-escaped. |
| No write affordance | Per-step indicator is inert. |
| No pass/fail inference | Renders stored discrete `result` only. |

## Alternatives Considered

### A. Leave per-step result hidden
Zero work; the per-step typed outcome stays invisible though it is already
returned. Rejected — low retained value.

### B. Per-step inert result via existing `records[].stepId` join (this ADR)
Recommended. Smallest read-only step; no new mapping/fetch/endpoint.

### C. Bind project-scoped `liveRunRecords` to steps
Needs a run↔step identity mapping that does not exist today. Deferred to its own
ADR.

## Risk Acceptance

- **Stale display**: reflects the last `/verification` fetch. Mitigation: no
  auto-refresh implied; consistent with the rest of the cached view.
- **Field drift / leakage**: a record could carry extra sensitive fields.
  Mitigation: render only the discrete `result` via an allow-list + escaping;
  tests assert no raw/notes/token/identity appears in the step row.
- **Ambiguous multi-record per step**: more than one record may match a
  `stepId`. Mitigation: deterministic selection (e.g. most recent / first typed
  result) fixed in the handoff; no inference.

## Consequences

If accepted and implemented: the goal plan-step table shows the recorded typed
verification result per step, using data already returned — no new capability or
boundary.

If rejected: per-step typed results stay invisible in the goal view.

## Acceptance Conditions

An `EX-2.16-1` handoff and `REVIEW-2.16-1` closeout MUST verify:

1. **Console-only, no backend change**: no route/endpoint/store/field change;
   consumes the existing cached `/verification.records`.
2. **No new fetch / execution / network / credential**: none added.
3. **Join by existing `stepId`**: per-step result comes from
   `records[].stepId === step.id`; no new identity mapping introduced.
4. **Allow-list render + escaping**: only the discrete `result` enum is shown
   (HTML-escaped); no raw output/notes/token/URL/path/hash/branch/owner/repo/diff.
5. **Fail-closed**: no matching record / no typed `result` → inert `—`.
6. **No affordance**: the per-step indicator has no button/link/input/control.
7. **No pass/fail inference**: steps with only legacy free-text `notes` (no typed
   `result`) show `—`, never an inferred outcome.
8. **Deterministic selection**: a fixed rule when multiple records match a
   `stepId`.
9. **Tests**: per-step render on match, `—` on no-match/no-result, escaping,
   no-control, no-extra-fetch, no raw/notes/token/identity in the step row even
   when a record carries unexpected fields.
10. **Backward compatible**: existing observability/console/persistence tests
    pass; the change is additive goal-view rendering only.

## Allowed files (proposed for EX-2.16-1)

- `apps/local-server/src/routes/project-console.ts` — per-step typed-result
  indicator in `renderGoalCard`.
- `docs/contracts/bridge-projects-api.md` — note `records[].stepId`/`result` are
  consumed by the goal view (if not already documented).
- `CHANGELOG.md` — record `EX-2.16-1`.
- `tests/project-console-behavior.test.mjs` — the §9 tests.

Otherwise STOP and report.

## Handoff prompt sketch (EX-2.16-1)

> Implement only ADR-0021. In `renderGoalCard`'s plan-step table, add an inert
> per-step verification-result indicator joined from
> `store.cache.verification.records` by `stepId === step.id`, rendering only the
> discrete typed `result` as an HTML-escaped pill (fixed selection rule when
> multiple match); no match / no `result` → inert `—`. Add no endpoint, no
> fetch, no execution/network/credential, and no write/execute control. Render
> no raw output/notes/token/identity. Add the §9 tests. Run typecheck, lint, the
> touched node --test suites, npm test, git diff --check. One dedicated
> `EX-2.16-1` diff; do not commit/push until `REVIEW-2.16-1` authorizes.

## Status / Next

PROPOSED. On acceptance, author
`CLI-BRIDGE-v2.16-GOAL-STEP-VERIFICATION-HANDOFF.md` for `EX-2.16-1`, then return
to `REVIEW-2.16-1`.
