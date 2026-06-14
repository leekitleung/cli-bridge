# REVIEW-2.16-1 - ADR-0021 closeout

**Date**: 2026-06-14
**Reviewer**: zs (RP-2.16)
**Verdict**: **PASS** - ADR-0021 accepted and closed.

## Scope

`EX-2.16-1` implements ADR-0021: a read-only, console-only per-step verification
result indicator in the goal plan-step table. The slice joins existing cached
`/verification.records[]` onto plan steps by `stepId` and renders only the
stored typed `result`.

## Acceptance evidence

| # | Criterion | Evidence |
|---|-----------|----------|
| 1 | Console-only, no backend change | Only `project-console.ts` rendering changed; no route, endpoint, store, field, or schema behavior changed. |
| 2 | No new fetch / execution / credential | The indicator consumes `store.cache.verification.records`; no new fetch, spawn, network, credential, or provider call was added. |
| 3 | Join by existing `stepId` | Candidates require `record.stepId === step.id`; no new run-to-step identity mapping exists. |
| 4 | Allow-list render + enum fail-closed | Candidates must have `result` in `passed|failed|skipped|errored|unknown`; non-enum values render `—` and are never displayed. |
| 5 | Fail-closed | No match, no typed result, and non-enum result all render inert `—`. |
| 6 | No affordance | The verify column is inert text/span only, with no button, link, input, or control. |
| 7 | No pass/fail inference | Legacy notes or other free text do not contribute to the displayed result. |
| 8 | Deterministic selection | Multiple candidates select greatest `createdAt`; strict `>` preserves earliest array order for ties or missing timestamps. |
| 9 | No sensitive/raw leakage | Tests inject notes, raw output, token, branch, owner, and repo; none appear in the step row. |
| 10 | Backward compatible | Console, UI, and full repository tests pass. |

## Review notes

The implementation exactly follows the RP-2.16-a fixed rule: candidate records
must match `stepId` and closed-enum `result`, then the greatest `createdAt` wins.
Because the comparison is strict `>`, tied or missing timestamps keep the first
matching candidate in `/verification.records[]` order.

The test diff is additive. Seven v2.16 console tests cover enum rendering,
no-match fallback, non-enum fallback, greatest-`createdAt` selection, array-order
tiebreak, sensitive-field non-rendering, and no controls/no extra fetch.

## Files

- `apps/local-server/src/routes/project-console.ts`
- `docs/contracts/bridge-projects-api.md`
- `CHANGELOG.md`
- `tests/project-console-behavior.test.mjs`

## Verification

```
npm run typecheck
npm run lint
node --test tests/project-console-behavior.test.mjs
node --test tests/console-goals-ui.test.mjs
npm test
git diff --check
```

## Decision

ADR-0021 is **CLOSED**. Control returns to RP.
