# CLI Bridge v2.15 — Verification Run-History Console Presentation — Implementation Handoff

**Status**: HANDOFF AUTHORIZED — DISPATCHABLE for `EX-2.15-1`
**Date**: 2026-06-14
**Batch**: `EX-2.15-1` (execution) → returns to `REVIEW-2.15-1`
**Based on**:
- `docs/planning/ADR-0020-console-verification-run-history-presentation.md`
  (ACCEPTED)

---

## 0. Scope note

Implement only ADR-0020: a read-only console presentation of the existing
`/bridge/projects/:key/verification.liveRunRecords` history. This is display
only. Add no endpoint, no fetch, no execution, no network, no credential handling,
and no write/control affordance.

## 1. Goal

In the project console verification view, show the already-returned sanitized
verification run history so ADR-0018 local live verification and ADR-0019-b
GitHub checks results are visible beyond the summary counts.

## 2. Required behavior

1. Render `store.cache.verification.liveRunRecords` in the verification view as
   an inert, most-recent-first list capped to 20 records.
2. For each record, render only:
   - stored discrete `result`;
   - HTML-escaped `commandLabel`;
   - `recordedAt` as inert relative/ISO time;
   - `elapsedMs`;
   - inert `truncated` / `outputDiscarded` flags.
3. Missing, non-array, empty, or malformed history renders inert "no runs
   recorded".
4. Extra record fields must be ignored. Do not render raw output, token, URL,
   path, hash, branch, owner, repo, ref, identity, or payload fields even if they
   appear unexpectedly.
5. Add no button, link, input, or write/execute/re-run control in the history
   list.

## 3. Allowed files

- `apps/local-server/src/routes/project-console.ts`
- `docs/contracts/bridge-projects-api.md`
- `CHANGELOG.md`
- `tests/project-console-behavior.test.mjs`

Anything else requires STOP-and-report.

## 4. Forbidden

- No backend route, store, schema, type, provider, or persistence changes.
- No new endpoint and no additional fetch beyond the existing `/verification`
  fetch.
- No execution/spawn/`git`/network/credential/provider call.
- No write/apply/promote/commit/run/discard affordance.
- No pass/fail inference from text; render only the stored `result`.
- No scheduler/poller/auto-refresh loop.

## 5. Tests

Add focused console behavior tests proving:

- sanitized run history renders with result, command label, recorded time,
  elapsed time, and inert flags;
- command labels are HTML-escaped;
- empty/missing/malformed `liveRunRecords` renders inert "no runs recorded";
- extra sensitive-looking fields in a record do not appear in the DOM;
- the history list contains no button/link/input/write/execute control;
- opening the verification view performs no extra fetch beyond the existing
  verification/profiles/git-status calls already expected for the view.

## 6. Verification commands

Run and report:

- `node --test tests/project-console-behavior.test.mjs`
- `npm run typecheck`
- `npm run lint`
- `npm test`
- `git diff --check`

## 7. Report / closeout material

Report changed files, tests run, boundary evidence, and any unresolved questions.
Do not commit/push until `REVIEW-2.15-1` authorizes closeout.
