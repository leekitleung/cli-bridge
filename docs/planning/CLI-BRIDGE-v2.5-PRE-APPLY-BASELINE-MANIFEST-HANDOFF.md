# CLI Bridge v2.5 — Pre-apply Baseline Manifest Capture — Implementation Handoff

**Status**: IMPLEMENTATION HANDOFF — AUTHORIZED for `EX-2.5-5`
**Date**: 2026-06-12
**Based on**:
- `docs/planning/ADR-0010-pre-apply-baseline-manifest-capture.md` (ACCEPTED, with acceptance conditions)
- `docs/planning/ADR-0009-read-only-apply-result-presentation.md` (ACCEPTED)
- `docs/planning/ADR-0008-patch-apply-isolated-worktree.md` (ACCEPTED)
- `docs/planning/ADR-0007-workspace-write-expansion.md` (§2 prerequisites)
- `apps/local-server/src/storage/workspace-apply-store.ts`
- `apps/local-server/src/routes/bridge-api.ts`
- `docs/contracts/bridge-projects-api.md`
- `tests/workspace-apply.test.mjs`
- `tests/apply-result-presentation.test.mjs`

---

## 0. Purpose

Implement the metadata-only pre-apply baseline manifest capture authorized by
ADR-0010. Capture happens immediately before the ADR-0008 isolated apply write
and records only metadata for the artifact's `proposedFiles[]`: path, existence,
readable status, size, SHA-256 hash, and error kind.

This handoff does **not** authorize raw baseline content persistence, diff,
diff-like views, new/modified/unchanged classification, main-tree writes,
`git`/VCS, spawn/exec, apply-from-preview, parallelism, scheduler/model-triggered
capture, or any new executor authority.

---

## 1. Required implementation shape

### Trusted root

- Add a server/runtime-controlled `baselineRoot` option, for example
  `createBridgeRuntime({ baselineRoot })`.
- Default: absent/OFF. Do not infer a root from request input.
- The HTTP API MUST reject or ignore any `baselineRoot`, `cwd`, or filesystem
  root in request bodies/query strings. Execution agents must not add a
  per-project root field in this slice.
- Responses and audit MUST NOT expose the absolute `baselineRoot`; use an opaque
  `rootRef` such as `runtime-baseline-root`.

### Opt-in

- Add an independent default-OFF opt-in for baseline capture, separate from
  `workspaceApplyEnabled`. Recommended runtime option:
  `baselineCaptureEnabled?: boolean`.
- Runtime-only opt-in is preferred for this slice. Do not expand project PATCH
  semantics unless strictly necessary.
- With baseline disabled, existing apply and presentation behavior must remain
  compatible and all current tests must pass.
- With baseline enabled but no trusted root, confirm fails closed before any
  isolated apply write.

### Manifest model

Attach the captured manifest to `ApplyRequest` as metadata-only fields. Suggested
shape:

```ts
interface BaselineManifestEntry {
  path: string;
  exists: boolean;
  readable: boolean;
  size?: number;
  sha256?: string;
  errorKind?: 'missing' | 'unreadable' | 'not-file' | 'cap-exceeded' | 'path-escape';
}

interface BaselineManifest {
  capturedAt: number;
  rootRef: string;
  fileCount: number;
  readableCount: number;
  missingCount: number;
  unreadableCount: number;
  byteTotal: number;
  entries: BaselineManifestEntry[];
}
```

Do not store raw baseline content. Do not store absolute host paths.

### Capture timing

- Capture immediately inside `confirmApply`, before any staging directory or
  isolated apply write is created.
- If capture fails, return a clean error and perform no write.
- Missing proposed files are not failures by themselves; represent them as
  `exists:false`, `readable:false`, `errorKind:'missing'`, because they may be
  new files.
- Unreadable existing files, non-regular files, path escape, cap exceed, or
  missing trusted root when capture is enabled are fail-closed.

---

## 2. Allowed modification range

- `apps/local-server/src/routes/bridge-api.ts`
  - Add runtime options for trusted `baselineRoot` and baseline opt-in.
  - Pass baseline capture config into `WorkspaceApplyStore`.
  - Keep rejecting request-supplied `cwd`/root fields. Do not add new mutation
    endpoints.
- `apps/local-server/src/storage/workspace-apply-store.ts`
  - Add baseline manifest types, capture helper, caps, and attach metadata to
    `ApplyRequest`.
  - Use only Node `fs`, `path`, and `crypto` hashing. No `git`, no spawn.
  - Preserve existing apply behavior when baseline capture is disabled.
- `docs/contracts/bridge-projects-api.md`
  - Document baseline manifest metadata on apply requests, default-off behavior,
    error semantics, and non-goals.
- `tests/workspace-apply.test.mjs`
  - Add baseline capture tests mapped to ADR-0010 acceptance conditions.
- `tests/apply-result-presentation.test.mjs`
  - Update only if manifest projection exposes baseline metadata; no diff or
    classification tests should be added.
- `CHANGELOG.md`

Do not modify console UI unless strictly necessary to avoid broken rendering.
Do not add a baseline viewer, diff viewer, or classification UI in this slice.

---

## 3. Tests — map to ADR-0010 Acceptance Conditions

1. **Trusted root only**: request body `baselineRoot`/`cwd` does not influence
   capture; root comes only from runtime option. No absolute root appears in
   response or audit.
2. **Separate opt-in**: default disabled leaves existing apply behavior
   unchanged; enabled without trusted root fails closed before write.
3. **Metadata only**: manifest stores path/existence/readable/size/sha256/
   errorKind only; assert no raw content or secret appears in request records,
   audit, snapshot, or responses.
4. **Containment**: traversal/absolute/drive-letter/UNC/backslash escape and
   symlink/root escape abort capture and apply with no write.
5. **Fail-closed before write**: unreadable existing file, non-regular file, cap
   exceed, invalid path, or missing root produces clean 4xx/no write; missing
   file records `exists:false` and does not fail.
6. **Caps**: max files and max baseline bytes read are enforced with tests.
7. **Audit metadata**: baseline capture audit events use typed
   `result.metadata`; no raw content, no absolute host paths.
8. **No new presentation capability**: no diff, no baseline preview, no
   new/modified/unchanged classification fields or endpoints.
9. **No VCS/spawn/autonomy**: source check for no `child_process`, spawn/exec,
   `git diff`, `git apply`, `git worktree`, commit, push, merge.
10. **Backward compatibility**: `tests/workspace-apply.test.mjs`,
    `tests/apply-result-presentation.test.mjs`, and full suite pass with
    baseline disabled by default.

---

## 4. Verification commands

```text
npm run typecheck
npm run lint
node --test tests/workspace-apply.test.mjs
node --test tests/apply-result-presentation.test.mjs
npm test
git diff --check
```

---

## 5. Closeout evidence required

Return to `REVIEW-2.5-5` with:

- changed files and commit hash;
- verification results;
- a table mapping implementation evidence to all 10 ADR-0010 acceptance
  conditions;
- boundary grep showing no raw baseline content persistence, no diff/
  classification endpoint, no main-tree write, no `git`/spawn/VCS, and no
  apply-from-preview;
- audit evidence showing typed `result.metadata` and no absolute host paths or
  raw content.

---

## 6. Explicit non-goals

Do not implement:

- raw baseline content persistence;
- baseline preview;
- diff or diff-like view;
- new/modified/unchanged classification;
- console baseline/diff UI;
- main-tree writes;
- `git` worktree / `git diff` / `git apply`;
- commit, push, merge, PR, merge queue;
- scheduler/model-triggered capture or apply;
- apply-from-preview;
- project-level workspace root configuration.

Any one of those requires a separate ADR.
