# CLI Bridge v2.6 — Read-only Apply-result File Classification — Implementation Handoff

**Status**: IMPLEMENTATION HANDOFF — AUTHORIZED for `EX-2.6-1`
**Date**: 2026-06-12
**Based on**:
- `docs/planning/ADR-0011-read-only-apply-result-classification.md` (ACCEPTED, with acceptance conditions)
- `docs/planning/ADR-0010-pre-apply-baseline-manifest-capture.md` (ACCEPTED)
- `docs/planning/ADR-0009-read-only-apply-result-presentation.md` (ACCEPTED)
- `apps/local-server/src/storage/workspace-apply-store.ts` (`ApplyRequest.baselineManifest`, `listAppliedFiles`, `validateAllPaths`)
- `apps/local-server/src/routes/bridge-api.ts` (`matchTeamApplyPath`, `resolveApplyForRead`)
- `docs/contracts/bridge-projects-api.md`
- `tests/workspace-apply.test.mjs`, `tests/apply-result-presentation.test.mjs`

---

## 0. Purpose

Implement the strictly read-only, metadata-only per-file classification
authorized by ADR-0011. For an `applied` request with a captured baseline,
classify each isolated-result file relative to the persisted ADR-0010 baseline
metadata, returning only a coarse label per file. No raw content, no `sha256` in
the response, no textual diff, no main-tree access, no `git`/spawn, no
apply-from-preview.

---

## 1. Endpoint (fixed)

`GET /bridge/projects/:key/teams/:teamId/apply-requests/:applyId/classification`

**Response 200**:
```json
{
  "files": [{ "path": "src/app.ts", "size": 123, "classification": "modified" }],
  "summary": { "new": 1, "modified": 1, "unchanged": 2, "unreadableBaseline": 0, "total": 4 }
}
```

- `classification` ∈ `new | modified | unchanged | unreadable-baseline` (closed enum, fixed by ADR-0011).
- `size` is the isolated-result file size (already available via `listAppliedFiles`).
- The response MUST NOT contain any `sha256` (baseline or result), file content, or absolute host path.

**Fixed error semantics**:
- Opt-in OFF (`workspaceApplyEnabled` false) → `409` (reuse `resolveApplyForRead`).
- Unknown applyId / wrong project/team → `404` (reuse `resolveApplyForRead`).
- Request status not `applied` → `409`.
- **No captured baseline** (`baselineManifest` absent) → `409` with a standard
  error such as `"Baseline manifest not captured for this apply request"`. No
  per-file list. (Fixed by ADR-0011 §3 — do NOT return a placeholder list.)
- Path escape or cap exceed during result hashing → clean `4xx`, no disclosure.

---

## 2. Classification logic (metadata-only)

For each file returned by the existing read-only `listAppliedFiles(applyId)`
(isolated result dir), match it by `path` against `req.baselineManifest.entries`:

- baseline entry `exists === false` (`errorKind:'missing'`) → `new`.
- baseline entry `readable === true` with a `sha256`: compute the result file's
  SHA-256 **in-process** (read the isolated dir file only) and compare:
  - equal → `unchanged`;
  - different → `modified`.
- baseline entry marked unreadable (`errorKind:'unreadable'`) → `unreadable-baseline`
  (reserved; normally unreachable under ADR-0010 fail-closed capture — see §5).

Notes:
- Result-side SHA-256 is used ONLY for the equality comparison and is never
  returned or audited.
- `confirmApply` requires the result file set to exactly match `proposedFiles`,
  and the baseline was captured over the same `proposedFiles`, so every result
  path should have a baseline entry. If a result path has no baseline entry
  (defensive), treat it as `new`.
- Compute the per-classification `summary` counts.

---

## 3. Required implementation shape

### `apps/local-server/src/storage/workspace-apply-store.ts`
- Add a read-only helper, e.g.:
  ```ts
  type ClassifyFailCode = 'not-found' | 'not-applied' | 'no-baseline' | 'path-escape' | 'cap-exceeded';
  type ClassificationLabel = 'new' | 'modified' | 'unchanged' | 'unreadable-baseline';
  classifyResult(applyId: string, caps?: BaselineCaps):
    | { ok: true; files: { path: string; size: number; classification: ClassificationLabel }[];
        summary: { new: number; modified: number; unchanged: number; unreadableBaseline: number; total: number } }
    | { ok: false; code: ClassifyFailCode; error: string };
  ```
- Pure `fs`/`path`/`crypto` only. Reuse `validateAllPaths` + the existing
  isolated-root containment double-check before reading any result file.
- Apply a cap (reuse `baselineCaps`/`DEFAULT_BASELINE_CAPS` or `ApplyCaps`) on
  the number of result files and total bytes hashed; exceed → `cap-exceeded`,
  fail-closed, no partial result.
- Return `no-baseline` when `req.baselineManifest` is absent (route maps to 409).
- Do NOT mutate any `ApplyRequest`. Do NOT read outside the isolated dir.

### `apps/local-server/src/routes/bridge-api.ts`
- Extend `matchTeamApplyPath` to recognize `.../apply-requests/:applyId/classification`
  (a new `sub: 'classification'`, GET-only). Keep all existing subs intact.
- Add `handleApplyClassificationGet` that:
  - reuses `resolveApplyForRead` (opt-in + ownership + 404);
  - returns `409` when status is not `applied`;
  - calls `classifyResult` and maps fail codes: `no-baseline`/`not-applied` → 409,
    `path-escape`/`cap-exceeded` → 400/409, `not-found` → 404;
  - returns `{ files, summary }` on success.
- GET-only dispatch (POST/PUT/DELETE/etc. on this path → existing 405 fallback).
- Do NOT read `baselineRoot`/`cwd`/`root` from request body/query.

### Docs / changelog
- `docs/contracts/bridge-projects-api.md`: document the classification endpoint,
  the closed enum, the no-baseline `409`, and the non-goals (no sha256/content/
  diff in response).
- `CHANGELOG.md`: short v2.6 entry.

---

## 4. Allowed modification range

- `apps/local-server/src/routes/bridge-api.ts`
- `apps/local-server/src/storage/workspace-apply-store.ts`
- `docs/contracts/bridge-projects-api.md`
- `tests/workspace-apply.test.mjs` (and/or `tests/apply-result-presentation.test.mjs` if a presentation-side assertion is clearer)
- `CHANGELOG.md`

Do not modify the console UI. Do not change `captureBaseline` / ADR-0010 capture
behavior. Do not change storage shape beyond adding the read-only helper.

---

## 5. Hard boundaries

- Read-only: no mutation of any `ApplyRequest`, no file write/delete.
- Metadata-only response: `{ path, size, classification }` + summary. No `sha256`
  (baseline or result), no file content, no absolute host path in response or audit.
- No textual/structural diff, diff-like output, or line-level detail.
- Closed enum exactly `new | modified | unchanged | unreadable-baseline`. No
  per-file `missing-baseline`; no-baseline is the request-level `409`.
- No main-tree read at request time: baseline data comes only from persisted
  `baselineManifest`; result hashing reads only the bridge-managed isolated dir.
- No `git`, `child_process`, spawn/exec, VCS action.
- No apply-from-preview / promotion, no scheduler/model-triggered path, no new
  endpoint beyond the single classification GET, no project-level workspace root.
- MUST NOT relax ADR-0010 fail-closed capture to make `unreadable-baseline`
  reachable (ADR-0011 acceptance condition 11).

---

## 6. Tests — map to ADR-0011 Acceptance Conditions

1. **Read-only**: classification reads do not change `ApplyRequest` status or
   isolated dir contents (snapshot before/after).
2. **Metadata-only output**: response items are exactly `{path,size,classification}`;
   assert no `sha256`/content/absolute path in payload or audit.
3. **No diff**: response has no diff/diff-like/line-detail field.
4. **Closed enum**: every label ∈ `new|modified|unchanged|unreadable-baseline`;
   cover `new` (baseline missing entry), `modified` (hash differs), `unchanged`
   (hash equal).
5. **Containment**: a result path that would escape the isolated root is rejected;
   baseline data comes only from `baselineManifest`.
6. **Fail-closed**: unknown applyId → 404; status not `applied` → 409; cap exceed → 4xx.
7. **Opt-in**: `workspaceApplyEnabled` false → 409 on the classification endpoint.
8. **No new capability**: GET-only (POST → 405); no promote/apply route; source
   check for no `child_process`/spawn/`git`.
9. **Backward compatibility**: existing apply/presentation/baseline suites pass;
   endpoint is additive.
10. **No-baseline → 409**: apply confirmed with baseline capture disabled →
    classification returns 409 with standard error and NO file list.
11. **No capture relaxation**: source check that `captureBaseline`/ADR-0010
    fail-closed behavior is unchanged (no new "read unreadable" path).

---

## 7. Verification commands

```text
npm run typecheck
npm run lint
node --test tests/workspace-apply.test.mjs
node --test tests/apply-result-presentation.test.mjs
npm test
git diff --check
```

(If the runner needs TS stripping, use `node --experimental-strip-types --test <file>`.)

---

## 8. Closeout evidence required (return to REVIEW-2.6-1)

- changed files and commit hash (leave tree dirty for review; no push until review);
- verification results;
- a table mapping evidence to all 11 ADR-0011 acceptance conditions;
- boundary evidence: no `sha256`/content/absolute path in response or audit, no
  diff, no main-tree access, no `git`/spawn, no apply-from-preview, no ADR-0010
  capture change;
- the exact classification logic and where result hashing happens (in-process,
  isolated dir only, not returned).

---

## 9. Explicit non-goals

Do not implement: raw baseline/result content persistence or return; any `sha256`
in responses; textual or diff-like views; line-level change detail; per-file
`missing-baseline` label; console baseline/diff/classification UI; main-tree
reads/writes; `git` worktree/diff/apply; commit/push/merge/PR/merge queue;
scheduler/model-triggered work; apply-from-preview; project-level workspace root.
Any one of those requires a separate ADR.
