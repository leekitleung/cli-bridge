# ADR-0021: Goal Plan-Step Verification-Result Presentation (v2.16 planning)

Status: ACCEPTED

Date: 2026-06-14
Depends on: ADR-0017 (typed model), ADR-0020 (run-history presentation) — CLOSED
Acceptance: ACCEPTED (2026-06-14) by `REVIEW-ADR-0021` after RP-2.16-a fixed the
            deterministic multi-record selection + enum fail-closed rule.
            Strictly read-only, console-only presentation that surfaces the **already-exposed** per-step typed
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

**ACCEPTED** (2026-06-14, `REVIEW-ADR-0021`). No code until an `EX-2.16-1`
handoff is authored; implementation proceeds in `EX-2.16-1` and returns to
`REVIEW-2.16-1`. This is a console-only read-only change consuming an existing
cached response field.

### 1. What is permitted

PERMIT adding an inert per-step **verification result** indicator to the goal
plan-step table, using a single fixed selection rule (RP-2.16-a):

- **Candidate set**: records where `record.stepId === step.id` AND
  `record.result` is in the closed enum `passed | failed | skipped | errored |
  unknown`. Records with no `result`, or a `result` outside the enum, are
  **not** candidates.
- **Selection (deterministic)**: among candidates, pick the one with the
  greatest `createdAt`; if `createdAt` is missing or tied, pick the one that
  appears **earlier** in the `/verification.records[]` array order.
- **Render**: the selected record's discrete `result` as an inert HTML-escaped
  typed pill.
- **Fail-closed**: no candidate (no match / no typed `result` / non-enum
  `result`) → inert placeholder `—`. A non-enum/invalid `result` is treated as
  fail-closed `—`, never shown (not merely HTML-escaped), so only discrete enum
  values ever render and no pass/fail is inferred.

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
  `stepId`. Mitigation: the deterministic selection rule is fixed at the ADR
  level (RP-2.16-a) — greatest `createdAt`, then earliest array position — so the
  execution agent makes no selection judgment.
- **Non-enum / invalid result**: a record could carry an unexpected `result`
  value. Mitigation: only the closed enum renders; anything else is fail-closed
  `—`, never displayed.

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
4. **Allow-list render + escaping + enum fail-closed**: only a `result` value in
   the closed enum is shown (HTML-escaped); a non-enum/invalid `result` is
   fail-closed `—`, never rendered; no raw output/notes/token/URL/path/hash/
   branch/owner/repo/diff.
5. **Fail-closed**: no matching record / no typed `result` / non-enum `result` →
   inert `—`.
6. **No affordance**: the per-step indicator has no button/link/input/control.
7. **No pass/fail inference**: steps with only legacy free-text `notes` (no typed
   `result`) show `—`, never an inferred outcome.
8. **Deterministic selection (fixed)**: among records with
   `stepId === step.id` and an enum `result`, select greatest `createdAt`; on
   missing/tied `createdAt`, the earliest in `/verification.records[]` order.
9. **Tests**: per-step render on match; `—` on no-match / no-`result` /
   non-enum `result`; deterministic pick across multiple matches (greatest
   `createdAt`, then array order); escaping; no-control; no-extra-fetch; no
   raw/notes/token/identity in the step row even when a record carries
   unexpected fields.
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
> `store.cache.verification.records` by `stepId === step.id`. Selection is fixed:
> candidates are records whose `result` is in the closed enum
> `passed|failed|skipped|errored|unknown`; among candidates pick the greatest
> `createdAt`, and on missing/tied `createdAt` the earliest in the
> `/verification.records[]` array; render that discrete `result` as an
> HTML-escaped pill. No candidate (no match / no `result` / non-enum `result`) →
> inert `—` (non-enum is fail-closed, never shown). Add no endpoint, no fetch, no
> execution/network/credential, and no write/execute control. Render no raw
> output/notes/token/identity. Add the §9 tests. Run typecheck, lint, the touched
> node --test suites, npm test, git diff --check. One dedicated `EX-2.16-1` diff;
> do not commit/push until `REVIEW-2.16-1` authorizes.

## Status / Next

ACCEPTED (2026-06-14). Handoff `CLI-BRIDGE-v2.16-GOAL-STEP-VERIFICATION-HANDOFF.md`
authored and dispatchable on a human trigger for `EX-2.16-1`; implementation
returns to `REVIEW-2.16-1` before closeout.
