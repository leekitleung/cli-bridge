# CLI Bridge v2.7 — Console Apply-result Classification Presentation — Implementation Handoff

**Status**: IMPLEMENTATION HANDOFF — AUTHORIZED for `EX-2.7-1`
**Date**: 2026-06-12
**Based on**:
- `docs/planning/ADR-0012-console-apply-result-classification.md` (ACCEPTED, with acceptance conditions)
- `docs/planning/ADR-0011-read-only-apply-result-classification.md` (ACCEPTED)
- `docs/planning/ADR-0009-read-only-apply-result-presentation.md` (ACCEPTED)
- `apps/local-server/src/routes/project-console.ts` (existing Apply Result panel)
- `tests/project-console-ui.test.mjs`
- `tests/project-console-behavior.test.mjs`

---

## 0. Purpose

Expose the already-implemented ADR-0011 classification data in the existing
project console Apply Result panel. This is a strictly read-only UI slice. It
adds no backend endpoint or write path and does not change apply, baseline
capture, preview, or classification backend semantics.

The console should let a user enter the same team id + apply id, click the
existing "View result" control, and see manifest, files, preview controls, and
classification labels/summary when available.

---

## 1. Scope

In scope:

- Update the existing Apply Result panel in `apps/local-server/src/routes/project-console.ts`.
- Add a classification display region for summary counts and per-file labels.
- Fetch classification from the existing endpoint:

```text
GET /bridge/projects/:key/teams/:teamId/apply-requests/:applyId/classification
```

- Merge classification labels into the existing file table when the
  classification request succeeds.
- Render classification `409` no-baseline as an inert unavailable state while
  keeping successful manifest/files/preview output visible.
- Keep existing redacted preview behavior unchanged.
- Add/adjust project-console static and behavior tests.
- Update contract docs and changelog only as needed for console presentation.

Out of scope:

- Any backend route/store/schema change.
- Raw baseline or result content beyond the existing preview endpoint.
- `sha256` display, persistence, or inference.
- Textual diff, diff-like UI, line-level detail, baseline preview.
- Main-tree reads/writes.
- `git`, worktree/diff/apply, commit/push/merge/PR/merge queue.
- Apply-from-preview, promote, write, discard, scheduler/model-triggered work.
- Project-level workspace root configuration.

---

## 2. Required UI Behavior

The existing teams-view Apply Result panel currently:

- reads the manifest via `GET .../apply-requests/:applyId`;
- reads files via `GET .../apply-requests/:applyId/files`;
- loads redacted previews via `GET .../files/preview?path=<rel>`.

Extend that flow:

1. Keep the same team id/apply id inputs and `View result` button.
2. Continue loading manifest first.
3. Continue loading file list and preview controls.
4. Add a classification request after manifest succeeds:
   - `200`: render summary counts and attach each file's classification label to
     the file table;
   - `409` no-baseline: render a quiet "classification unavailable" state; do
     not hide manifest/files/preview if those calls succeed;
   - other `409`/`404`: preserve fail-closed messaging without unsafe fallback;
   - any malformed/empty response: inert unavailable state.
5. Labels are inert text/badges only, not buttons or links.
6. Do not make classification a prerequisite for existing file list or preview.

Suggested DOM shape:

- Add `#apply-view-classification` for summary/unavailable state.
- Add a `classification` column to the file table only when labels are
  available, or show an inert unavailable cell when classification was not
  available.

Exact CSS/styling is implementation detail, but keep it consistent with the
existing compact table/pill style and avoid adding decorative UI.

---

## 3. Allowed Modification Range

- `apps/local-server/src/routes/project-console.ts`
- `tests/project-console-ui.test.mjs`
- `tests/project-console-behavior.test.mjs`
- `docs/contracts/bridge-projects-api.md`
- `CHANGELOG.md`

Do not modify:

- `apps/local-server/src/routes/bridge-api.ts`
- `apps/local-server/src/storage/workspace-apply-store.ts`
- `tests/workspace-apply.test.mjs`
- `tests/apply-result-presentation.test.mjs`

unless a test-only assertion in those files is strictly required by a failing
existing test. No backend behavior changes are authorized.

---

## 4. Hard Boundaries

- Read-only UI only.
- The Apply Result panel may issue only GET requests for:
  - manifest;
  - files;
  - preview;
  - classification.
- No POST/PATCH/PUT/DELETE from the apply-result viewer.
- No new backend endpoint, route match, store helper, schema, or audit type.
- No `sha256`, raw baseline content, absolute host path, diff, diff-like output,
  or line-level detail in HTML source or runtime-rendered output.
- No apply/promote/write/commit/discard controls in the classification view.
- No main-tree access.
- No `git`, `child_process`, spawn/exec, VCS action.
- No ADR-0010 baseline capture change.
- No ADR-0011 classification backend behavior change.

---

## 5. Tests — Map to ADR-0012 Acceptance Conditions

Add/adjust tests in `tests/project-console-ui.test.mjs` and
`tests/project-console-behavior.test.mjs`.

1. **Read-only UI / GET-only**:
   - Static source test confirms no apply-result viewer code calls
     POST/PATCH/PUT/DELETE.
   - Behavior test confirms `View result` issues GET calls only for manifest,
     classification, files, and preview.
2. **Existing endpoint only**:
   - Static allowlist includes the dynamic classification path pattern or checks
     that the generated path suffix is `/classification`.
   - No backend files changed.
3. **Metadata-only display**:
   - Behavior test renders classification labels and summary.
   - Assert runtime output does not include `sha256`, `content`, `diff`,
     `lineDetail`, baseline entries, or an absolute host path.
4. **No apply/promote/write affordance**:
   - Static test asserts classification section has no apply/promote/commit/write
     controls or forbidden endpoint calls.
5. **Graceful no-baseline state**:
   - Behavior test: classification endpoint returns 409 while manifest/files
     succeed; console still shows manifest/files and an inert classification
     unavailable message.
6. **Fail-closed errors**:
   - Behavior test or static evidence shows failed classification response does
     not trigger fallback filesystem/main-tree reads or unsafe endpoint calls.
7. **Preview unchanged**:
   - Existing preview test behavior remains; if no direct test exists, add a
     light regression that preview still calls `/files/preview?path=...` and
     displays redacted/truncated metadata as before.
8. **No ADR-0010/0011 semantic changes**:
   - Diff evidence: no route/store files modified.
9. **Tests**:
   - Static + behavior coverage exists for render, no-baseline render, and
     forbidden fields/affordances.
10. **Backward compatibility**:
    - Existing project-console, apply, presentation, and classification tests
      pass.

---

## 6. Verification Commands

```text
npm run typecheck
npm run lint
node --test tests/project-console-ui.test.mjs
node --test tests/project-console-behavior.test.mjs
node --test tests/workspace-apply.test.mjs
node --test tests/apply-result-presentation.test.mjs
npm test
git diff --check
```

---

## 7. Closeout Evidence Required

Return to `REVIEW-2.7-1` with:

- changed files;
- verification results;
- table mapping evidence to all 10 ADR-0012 acceptance conditions;
- explicit boundary evidence:
  - no backend route/store change;
  - no `sha256`/raw baseline content/diff/absolute path display;
  - no apply/promote/write controls;
  - apply-result viewer GET-only;
  - preview behavior unchanged;
  - no ADR-0010/ADR-0011 semantic changes;
- screenshots are optional, but if a local server is started, include the URL
  and stop/leave no unmanaged background process unless explicitly requested.

Leave the tree dirty for review. Do not commit or push from the EX batch.

---

## 8. Explicit Non-goals

Do not implement: backend routes, backend classification changes, baseline
viewer, raw baseline/result content, hash display, textual diff, line-level
detail, main-tree access, git/VCS, apply-from-preview, promote/write/discard UI,
scheduler/model-triggered work, or project-level workspace root.

Any one of those requires a separate ADR.
