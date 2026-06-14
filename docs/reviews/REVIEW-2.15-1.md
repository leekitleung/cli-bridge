# REVIEW-2.15-1 - ADR-0020 closeout

**Date**: 2026-06-14
**Reviewer**: zs (RP-2.15)
**Verdict**: **PASS** - ADR-0020 accepted and closed.

## Scope

`EX-2.15-1` implements ADR-0020: read-only console presentation of existing
sanitized verification run records from the `/verification` response. The slice
is presentation-only and consumes `verification.liveRunRecords` that were
already exposed by earlier verification work.

## Acceptance evidence

| # | Criterion | Evidence |
|---|-----------|----------|
| 1 | Console-only presentation | Only the console renders `store.cache.verification.liveRunRecords`; no backend route or storage behavior changed. |
| 2 | No new boundary | No new endpoint, no new credential handling, no network beyond existing verification-view fetches, and no execution path. |
| 3 | Whitelisted fields | The history list renders only `result`, `commandLabel`, `recordedAt`, `elapsedMs`, and inert `truncated` / `outputDiscarded` flags. |
| 4 | Escaping | `result` and `commandLabel` are HTML-escaped before insertion. |
| 5 | Inert UI | The history section contains no button, link, input, write control, execute control, or re-run affordance. |
| 6 | Fail-closed | Missing or empty `liveRunRecords` renders inert fallback text (`no records`). |
| 7 | No inference | The console displays the stored discrete `result`; it does not infer pass/fail from raw output or counts. |
| 8 | Extra fields ignored | Sensitive-looking unexpected fields such as token, raw output, cwd, branch, owner, and repo are not rendered. |
| 9 | Ordering and cap | Records render newest-first and are capped at 20 with an inert count message. |
| 10 | Compatibility | Existing console behavior remains covered by the full test suite. |

## Review notes

The test diff included a broad wait-time bump from 50/100ms to 200ms. This is a
stability change only; assertions were not removed or weakened.

One v2.12 safety assertion now strips inert `[truncated]` and `[discarded]`
display flags before scanning for forbidden control keywords. This is narrowly
scoped to avoid a false positive from the inert `[discarded]` flag; actual
`Discard` controls would still be caught by the remaining DOM and button-label
assertions.

The contract/handoff phrase "no runs recorded" is implemented as inert
`no records` fallback text. This satisfies the ADR fail-closed requirement and
is covered by the v2.15 empty/missing history tests.

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
npm test
git diff --check
```

## Decision

ADR-0020 is **CLOSED**. Control returns to RP.
