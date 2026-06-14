# CLI Bridge v2.16 — Goal Plan-Step Verification-Result Presentation — Implementation Handoff (ADR-0021)

**Status**: HANDOFF AUTHORIZED — **DISPATCHABLE**. ADR-0021 is ACCEPTED
(`REVIEW-ADR-0021`, 2026-06-14). `EX-2.16-1` may run on a human dispatch trigger
and returns to `REVIEW-2.16-1` before closeout.
**Date**: 2026-06-14
**Batch**: `EX-2.16-1` (execution) → returns to `REVIEW-2.16-1`
**Based on**:
- `docs/planning/ADR-0021-goal-plan-step-verification-result-presentation.md`
- Reuse: `apps/local-server/src/routes/project-console.ts` `renderGoalCard`
  (plan-step table) and the cached `store.cache.verification` (`/verification`
  response: `records[]` with `stepId` + optional typed `result`).

---

## 0. Scope note

Implement **only ADR-0021**: a strictly read-only, console-only per-step typed
verification-result indicator in the goal plan-step table. No backend/endpoint/
store change, no new fetch, no execution/network/credential, no write surface.

## 1. Goal

In `renderGoalCard`'s plan-step table, show each step's typed verification
`result` (when one exists) as an inert pill, joined from the already-cached
`/verification.records[]` by `stepId`.

## 2. Fixed behavior (no execution-agent decisions)

- **Candidate set**: records where `record.stepId === step.id` AND
  `record.result` is in the closed enum
  `passed | failed | skipped | errored | unknown`.
- **Selection (deterministic)**: greatest `record.createdAt`; on missing/tied
  `createdAt`, the earliest in the `/verification.records[]` array order.
- **Render**: the selected `result` as an inert, HTML-escaped typed pill in a new
  per-step cell/badge.
- **Fail-closed**: no candidate (no match / no `result` / non-enum `result`) →
  inert `—`. A non-enum/invalid `result` is never rendered (not merely escaped).
- Reuse the existing pill styling; the indicator is display-only.

## 3. Allowed files

- `apps/local-server/src/routes/project-console.ts` — per-step indicator in
  `renderGoalCard`.
- `docs/contracts/bridge-projects-api.md` — note `records[].stepId`/`result` are
  consumed by the goal view (if not already documented).
- `CHANGELOG.md` — record `EX-2.16-1`.
- `tests/project-console-behavior.test.mjs` — the §5 tests.

Anything outside → STOP and report.

## 4. Forbidden

- No new endpoint / fetch / store / field / run↔step mapping.
- No execution, spawn, `git`, network, credential, provider call.
- No raw output / notes / token / URL / path / hash / branch / owner / repo /
  diff in the step row; only the discrete enum `result`.
- No write/apply/promote/commit/run/discard control, link, or input on the
  indicator.
- No pass/fail inference (steps with only legacy free-text `notes` and no typed
  `result` → `—`).
- No scheduler/auto-refresh; no `liveRunRecords` step-binding (out of scope).
- Do NOT use a `div`/element id containing the substring "run" (existing console
  safety test asserts no `run`/`execute`/… control text in the verification view;
  keep the same discipline in the goal view).

## 5. Required tests (`tests/project-console-behavior.test.mjs`)

Map to ADR-0021 acceptance #9:

1. Step with a matching enum record → renders the typed pill in that step row.
2. Step with no matching record / record without `result` → `—`.
3. Record with a non-enum `result` (e.g. `"weird"`) → `—` (never rendered).
4. Multiple records match one `stepId` → deterministic pick: greatest
   `createdAt`; and a tie/missing-`createdAt` case → earliest array order.
5. `commandLabel`/string fields HTML-escaped; no raw notes/output/token/owner/
   repo/branch/sha in the step row even when a record carries extra fields.
6. No write/execute control/button/link added to the step row; no extra fetch
   (the goal view uses the already-cached `/verification`).

## 6. Verification commands (run and report all)

- `npm run typecheck`
- `npm run lint`
- `node --test tests/project-console-behavior.test.mjs`
- `node --test tests/project-console-ui.test.mjs`
- `npm test`
- `git diff --check`

## 7. Report / pre-review material

- Changed files; the join/selection implementation; suite pass counts + `npm
  test` total; typecheck/lint/diff-check;
- Boundary evidence: no backend/endpoint/fetch; deterministic selection; enum
  fail-closed `—`; no raw/notes/token/identity in step row; no write control;
- Confirm not committed/pushed; dirty tree left for `REVIEW-2.16-1`.

## 8. Closeout

One dedicated `EX-2.16-1` commit of the allowed files; do not commit/push until
`REVIEW-2.16-1` authorizes. Control returns to RP afterward.
