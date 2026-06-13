# CLI Bridge v2.9 — Project-level Workspace Root Resolution — Implementation Handoff

**Status**: IMPLEMENTATION HANDOFF — AUTHORIZED for `EX-2.9-1`
**Date**: 2026-06-13
**Based on**:
- `docs/planning/ADR-0014-project-level-workspace-root.md` (ACCEPTED, with acceptance conditions)
- `docs/planning/ADR-0010-pre-apply-baseline-manifest-capture.md` (ACCEPTED)
- `docs/planning/ADR-0007-workspace-write-expansion.md` (prerequisites)
- `apps/local-server/src/routes/bridge-api.ts` (`createBridgeRuntime`, `BridgeRuntimeOptions`, apply route wiring)
- `apps/local-server/src/storage/workspace-apply-store.ts` (`WorkspaceApplyStore`, `baselineRoot`, `captureBaseline`)
- `apps/local-server/src/storage/project-store.ts` (`validateProjectKey`)
- `docs/contracts/bridge-projects-api.md`
- `tests/workspace-apply.test.mjs`, `tests/bridge-projects-api.test.mjs`, `tests/json-persistence.test.mjs`

---

## 0. Purpose

Implement only the root-selection step authorized by ADR-0014: let baseline
capture choose a trusted workspace root **per project** from a
server/operator-controlled registry, falling back to the existing runtime-wide
`baselineRoot`. This is an internal routing detail. It adds **no** new user
capability, **no** new endpoint, and **no** change to any response surface.

Out of scope, do NOT implement: project PATCH/POST root fields, console root
UI, snapshot persistence of roots, baseline preview, per-file entries, `sha256`
exposure, raw content, diff/line-level detail, main-tree writes, `git`/VCS,
apply-from-preview, and any change to `rootRef` value/format or to the
`ApplyManifest.baselineManifest` / project-console response surface.

---

## 1. Allowed files

Modify only:

- `apps/local-server/src/routes/bridge-api.ts` — add `projectWorkspaceRoots` to
  the runtime options; resolve the per-project root and pass it into the apply
  store / baseline capture path. No route body/query change.
- `apps/local-server/src/storage/workspace-apply-store.ts` — accept a resolved
  trusted root for a given apply (per project) without changing capture
  semantics or `rootRef`.
- `docs/contracts/bridge-projects-api.md` — document the root authority model
  and configuration limits (no response-shape change).
- `CHANGELOG.md` — record the `EX-2.9-1` implementation.
- `tests/workspace-apply.test.mjs` and/or `tests/bridge-projects-api.test.mjs`
  — add the boundary/behavior tests in §4.

Do NOT modify `project-store.ts` schema, project routes' writable-field
whitelist, console code, or any manifest/classification projection. If a
blocking bug forces a change outside this list, STOP and report it; do not
expand scope.

---

## 2. Configuration shape (server/operator only)

Extend the runtime options (illustrative; exact typing is the implementer's):

```ts
createBridgeRuntime({
  // existing:
  baselineRoot?: string,
  baselineCaptureEnabled?: boolean,
  // new (v2.9, ADR-0014):
  projectWorkspaceRoots?: Record<string /* projectKey */, string /* absolute root */>,
})
```

Rules:

- Source of truth is runtime/server config only. No HTTP body, query string,
  project create/PATCH, console input, model output, or artifact data may set
  or override it.
- Keys MUST pass the existing `validateProjectKey()` semantics; an invalid key
  fails closed at runtime construction (reject/throw or drop-with-error — choose
  fail-closed, never silently map to a wrong root).
- Values are normalized server-side with `path.resolve` and treated as trusted
  roots, exactly like the existing `baselineRoot`.

---

## 3. Resolution order (fixed by ADR-0014 §2)

For a given apply request's `projectKey`:

```text
1. projectWorkspaceRoots[projectKey]  (if configured and valid)
2. else existing runtime baselineRoot (unchanged behavior)
3. else no trusted root -> baseline capture fails closed when required
```

- When no registry is configured, behavior is byte-for-byte the existing
  runtime-wide `baselineRoot` behavior (backward compatible).
- `rootRef` stays the existing opaque constant `"runtime-baseline-root"`. Do not
  namespace it by project in this slice.
- The selected absolute root is never returned, audited, persisted to snapshot,
  or rendered. Capture remains metadata-only per ADR-0010.

---

## 4. Required tests

Add tests proving the boundary (acceptance conditions 1-10):

1. **Server-only config**: a project root configured via runtime options is used
   for that project's baseline capture; no request body/query/PATCH field can
   set or change it.
2. **Project-key validation**: an invalid registry key fails closed at runtime
   construction; it never maps to a different project's root.
3. **Resolution order**: project-specific root wins when configured; otherwise
   the existing `baselineRoot` is used; otherwise capture fails closed when
   required.
4. **No absolute path exposure**: with a project root configured, the apply
   manifest / files / classification responses and audit metadata contain no
   absolute host path; `rootRef` is still `"runtime-baseline-root"`.
5. **No snapshot persistence**: the JSON snapshot does not contain the
   configured absolute root after capture.
6. **No PATCH/POST root mutation**: `POST /bridge/projects` and
   `PATCH /bridge/projects/:key` reject or ignore `workspaceRoot`,
   `baselineRoot`, `cwd`, and equivalents (assert the existing whitelist still
   holds and these fields do not take effect).
7. **Project isolation**: project `alpha` with its own root cannot read project
   `beta`'s root via apply requests or team ids.
8. **Backward compatibility**: with no `projectWorkspaceRoots` configured, all
   existing apply/baseline/classification/presentation/console/project/
   persistence tests still pass.
9. **No surface change**: assert `ApplyManifest.baselineManifest` field
   values/shape are unchanged (the EX-2.8-2 contract and v2.8 boundary test
   remain valid).

---

## 5. Verification commands

Run and report all:

- `npm run typecheck`
- `npm run lint`
- `node --test tests/workspace-apply.test.mjs`
- `node --test tests/bridge-projects-api.test.mjs`
- `node --test tests/json-persistence.test.mjs`
- `node --test tests/project-console-behavior.test.mjs`
- `node --test tests/apply-result-presentation.test.mjs`
- `npm test`
- `git diff --check`

---

## 6. Boundary checklist (must all hold at closeout)

- [ ] Root source is server/operator config only; no HTTP/console/model/artifact path.
- [ ] Resolution order is project root -> runtime `baselineRoot` -> fail-closed.
- [ ] `rootRef` unchanged (`"runtime-baseline-root"`); no project namespacing.
- [ ] No absolute host path in responses, audit, snapshot, console, or docs response examples.
- [ ] No snapshot persistence of absolute roots.
- [ ] No project PATCH/POST root field accepted.
- [ ] No `ApplyManifest.baselineManifest` / manifest / console response-surface change.
- [ ] No baseline preview, entries, `sha256`, raw content, diff, line-level detail.
- [ ] No main-tree write, `git`/spawn/VCS, apply-from-preview, scheduler/model trigger.
- [ ] ADR-0010 capture semantics unchanged (metadata-only, fail-closed).
- [ ] Backward compatible with no registry configured.

---

## 7. Closeout

- One dedicated `EX-2.9-1` commit carrying only the files in §1.
- Do not commit/push from the EX batch unless the closeout review authorizes it;
  control returns to `REVIEW-2.9-1` first.
- Report changed files, test results, boundary evidence, and any unresolved
  questions. Do not continue into another slice without returning to a
  review/planning batch.

---

## 8. Deferred (separate ADRs required)

Project-scoped `rootRef` naming, snapshot persistence of roots, project record
root fields beyond an optional `workspaceRootConfigured` boolean, baseline
preview, diff/diff-like views, `sha256`/raw content exposure, main-tree writes,
`git`/VCS, apply-from-preview, and any root editing UI.
