# CLI Bridge v2.8 — Console Apply-result Baseline Summary Presentation — Implementation Handoff

**Status**: IMPLEMENTATION HANDOFF — AUTHORIZED for `EX-2.8-1`
**Date**: 2026-06-12
**Based on**:
- `docs/planning/ADR-0013-console-baseline-summary.md` (ACCEPTED, with acceptance conditions)
- `docs/planning/ADR-0012-console-apply-result-classification.md` (ACCEPTED)
- `docs/planning/ADR-0011-read-only-apply-result-classification.md` (ACCEPTED)
- `docs/planning/ADR-0010-pre-apply-baseline-manifest-capture.md` (ACCEPTED)
- `docs/planning/ADR-0009-read-only-apply-result-presentation.md` (ACCEPTED)
- `apps/local-server/src/routes/project-console.ts` (existing Apply Result panel)
- `tests/project-console-ui.test.mjs`
- `tests/project-console-behavior.test.mjs`

---

## 0. Purpose

Expose the already-available ADR-0010 baseline summary metadata in the existing
project console Apply Result panel. This is a strictly read-only UI slice. It
adds no backend endpoint or write path and does not change apply, baseline
capture, preview, or classification semantics.

The console should let a user enter the same team id + apply id, click the
existing "View result" control, and see manifest, baseline summary,
classification, files, and preview controls when available.

---

## 1. Scope

In scope:

- Update the existing Apply Result panel in `apps/local-server/src/routes/project-console.ts`.
- Use only the existing manifest GET response already loaded by `viewApplyResult`.
- Render `manifest.apply.baselineManifest` summary fields when present:
  - `capturedAt`
  - `fileCount`
  - `readableCount`
  - `missingCount`
  - `unreadableCount`
  - `byteTotal`
  - `rootRef`
- Render an inert "baseline not captured" / unavailable state when
  `baselineManifest` is absent.
- Keep existing manifest, classification, files, and redacted preview behavior
  unchanged.
- Add/adjust project-console static and behavior tests.
- Update contract docs and changelog only as needed for console presentation.

Out of scope:

- Any backend route/store/schema/audit change.
- Any new fetch for baseline data.
- Baseline preview endpoint or UI.
- Per-file baseline entry display.
- `sha256` display, persistence, or inference.
- Raw baseline or result content beyond the existing result preview endpoint.
- Textual diff, diff-like UI, line-level detail.
- Main-tree reads/writes.
- `git`, worktree/diff/apply, commit/push/merge/PR/merge queue.
- Apply-from-preview, promote, write, discard, scheduler/model-triggered work.
- Project-level workspace root configuration.

---

## 2. Required UI Behavior

The existing teams-view Apply Result panel currently:

- reads the manifest via `GET .../apply-requests/:applyId`;
- reads classification via `GET .../apply-requests/:applyId/classification`;
- reads files via `GET .../apply-requests/:applyId/files`;
- loads redacted previews via `GET .../files/preview?path=<rel>`.

Extend that flow:

1. Keep the same team id/apply id inputs and `View result` button.
2. Continue loading manifest first.
3. After manifest success, inspect `man.data.apply.baselineManifest`.
4. If baseline summary is present:
   - render only the seven summary fields listed in §1;
   - treat `rootRef` as opaque display text, not a path or link;
   - labels are inert text/badges only.
5. If baseline summary is absent:
   - render a quiet "baseline not captured" or equivalent unavailable state;
   - do not hide manifest/classification/files/preview if those calls succeed.
6. Do not make baseline summary a prerequisite for classification, file list, or
   preview.
7. Malformed or unexpected baseline summary values should render inert
   unavailable/placeholder values and must not trigger fallback reads or new
   endpoint calls.

Suggested DOM shape:

- Add `#apply-view-baseline` near the manifest and classification sections.
- Render a compact table or pill row consistent with the existing Apply Result
  panel.
- Do not add buttons, links, menus, or controls inside the baseline summary.

Exact styling is implementation detail; keep it compact and consistent with the
existing table/pill style.

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
  - classification;
  - files;
  - preview.
- Baseline summary must come only from the existing manifest response.
- No POST/PATCH/PUT/DELETE from the apply-result viewer.
- No new backend endpoint, route match, store helper, schema, or audit type.
- No baseline entries, `sha256`, raw baseline content, absolute host path, diff,
  diff-like output, or line-level detail in HTML source or runtime-rendered
  output.
- `rootRef` is opaque text only. It must not be treated as a filesystem path,
  link, or root selector.
- No apply/promote/write/commit/discard controls in the baseline summary view.
- No main-tree access.
- No `git`, `child_process`, spawn/exec, VCS action.
- No ADR-0010 baseline capture change.
- No ADR-0011 classification backend behavior change.

---

## 5. Tests — Map to ADR-0013 Acceptance Conditions

Add/adjust tests in `tests/project-console-ui.test.mjs` and
`tests/project-console-behavior.test.mjs`.

1. **Read-only UI / GET-only**:
   - Static source test confirms no apply-result viewer code calls
     POST/PATCH/PUT/DELETE.
   - Behavior test confirms `View result` issues only GET calls for manifest,
     classification, files, and preview. There must be no separate baseline
     endpoint call.
2. **Existing manifest response only**:
   - Behavior test seeds `baselineManifest` in the manifest fixture and confirms
     it renders without any extra baseline fetch.
   - Diff evidence shows no backend files changed.
3. **Summary-only display**:
   - Behavior test renders `capturedAt`, `fileCount`, `readableCount`,
     `missingCount`, `unreadableCount`, `byteTotal`, and `rootRef`.
4. **No baseline entries / hashes**:
   - Runtime output assertion confirms no `baselineManifest.entries`, `entries`,
     `sha256`, raw content fields, diff/line detail, or absolute host path.
   - Include a fixture whose `rootRef` is an opaque value and separately include
     an absolute-looking path elsewhere in non-rendered fixture data; assert the
     absolute path does not appear in the rendered viewer.
5. **Graceful absent-baseline state**:
   - Behavior test: manifest omits `baselineManifest`; console shows inert
     unavailable/not-captured baseline state while manifest, classification, and
     files still render.
6. **Fail-closed malformed summary**:
   - Behavior test or static evidence shows malformed baseline summary does not
     trigger fallback filesystem/main-tree reads or unsafe endpoint calls.
7. **No apply/promote/write affordance**:
   - Static and/or behavior test asserts the baseline section has no
     apply/promote/commit/write/discard controls or forbidden endpoint calls.
8. **Preview and classification unchanged**:
   - Existing v2.7 preview/classification behavior tests remain green. If needed,
     extend the existing preview regression to include a baseline summary fixture.
9. **No ADR-0010/0011 semantic changes**:
   - Diff evidence: no route/store backend files modified.
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

On Windows, `npm.cmd` is acceptable if PowerShell execution policy blocks
`npm.ps1`.

---

## 7. Closeout Evidence Required

Return to `REVIEW-2.8-1` with:

- changed files;
- verification results;
- table mapping evidence to all 11 ADR-0013 acceptance conditions;
- explicit boundary evidence:
  - no backend route/store/schema/audit change;
  - no new baseline endpoint or fetch;
  - baseline summary comes only from manifest GET;
  - no baseline entries / `sha256` / raw baseline content / diff / absolute
    host path display;
  - `rootRef` treated as opaque text;
  - no apply/promote/write controls;
  - apply-result viewer GET-only;
  - preview and classification behavior unchanged;
  - no ADR-0010/ADR-0011 semantic changes;
- screenshots are optional, but if a local server is started, include the URL
  and stop/leave no unmanaged background process unless explicitly requested.

Leave the tree dirty for review. Do not commit or push from the EX batch.

---

## 8. Explicit Non-goals

Do not implement: backend routes, backend baseline/schema/store changes,
baseline preview, per-file baseline entry display, raw baseline/result content,
hash display, textual diff, line-level detail, main-tree access, git/VCS,
apply-from-preview, promote/write/discard UI, scheduler/model-triggered work,
or project-level workspace root.

Any one of those requires a separate ADR.
