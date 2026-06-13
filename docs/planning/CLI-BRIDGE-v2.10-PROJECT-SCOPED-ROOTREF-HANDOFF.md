# CLI Bridge v2.10 — Project-scoped `rootRef` Naming — Retroactive Handoff

**Status**: RETROACTIVE IMPLEMENTATION HANDOFF / CLOSEOUT for `EX-2.10-1`
**Date**: 2026-06-13
**Based on**:
- `docs/planning/ADR-0015-project-scoped-rootref-naming.md` (ACCEPTED)
- `docs/planning/ADR-0014-project-level-workspace-root.md` (ACCEPTED)
- `docs/planning/ADR-0010-pre-apply-baseline-manifest-capture.md` (ACCEPTED)
- `apps/local-server/src/storage/workspace-apply-store.ts`
- `docs/contracts/bridge-projects-api.md`
- `tests/workspace-apply.test.mjs`
- `tests/project-console-behavior.test.mjs`

---

## 0. Purpose

Close the governance gap for the already-bounded v2.10 implementation of
ADR-0015: when baseline capture uses a server/operator configured project root,
the existing opaque `baselineManifest.rootRef` value identifies that project
root as `project-root:<projectKey>`. Runtime fallback remains
`runtime-baseline-root`.

This handoff is retroactive because implementation was already present in the
worktree before ADR acceptance closeout. It does not authorize any expansion.

---

## 1. Authorized files

The `EX-2.10-1` implementation/closeout is bounded to:

- `apps/local-server/src/storage/workspace-apply-store.ts`
- `docs/contracts/bridge-projects-api.md`
- `docs/planning/ADR-0015-project-scoped-rootref-naming.md`
- `docs/planning/CLI-BRIDGE-v2.10-PROJECT-SCOPED-ROOTREF-HANDOFF.md`
- `CHANGELOG.md`
- `tests/workspace-apply.test.mjs`
- `tests/project-console-behavior.test.mjs`

No route, schema, endpoint, project store, snapshot persistence, console
capability, write path, VCS path, or apply promotion path is authorized.

---

## 2. Implemented behavior

- Project-specific baseline root resolution produces
  `rootRef: "project-root:<projectKey>"`.
- Runtime-wide fallback baseline root resolution still produces
  `rootRef: "runtime-baseline-root"`.
- `rootRef` is derived from the validated project key and the root-resolution
  outcome, never from the resolved absolute filesystem path.
- `ApplyManifest.baselineManifest` keeps the existing seven-field shape.
- Audit baseline metadata carries the same opaque `rootRef` summary value as the
  manifest.
- The console treats `project-root:<key>` as inert opaque text while continuing
  to sanitize absolute-looking `rootRef` values.

---

## 3. Explicit non-goals

Not authorized and not included:

- absolute host path exposure in responses, audit, snapshots, docs examples, or
  console rendering;
- baseline entries, `sha256`, raw baseline/result content, diff, diff-like
  output, or line-level detail;
- a new endpoint, new schema field, new console capability, root editing UI, or
  project-record root field;
- request-supplied roots, model-supplied roots, artifact-supplied roots, or
  console-supplied roots;
- snapshot persistence of configured absolute roots;
- main-tree writes, `git`/spawn/VCS, apply-from-preview, promote, scheduler, or
  model-triggered work.

---

## 4. Verification commands

Run before publishing:

- `npm run typecheck`
- `npm run lint`
- `node --test tests/workspace-apply.test.mjs`
- `node --test tests/project-console-behavior.test.mjs`
- `node --test tests/bridge-projects-api.test.mjs`
- `node --test tests/json-persistence.test.mjs`
- `node --test tests/apply-result-presentation.test.mjs`
- `npm test`
- `git diff --check`

---

## 5. Closeout checklist

- [x] ADR-0015 accepted explicitly before closeout.
- [x] `rootRef` remains opaque and path-free.
- [x] Project root and runtime fallback values are distinct.
- [x] Manifest field set remains unchanged.
- [x] Audit baseline metadata matches manifest `rootRef`.
- [x] Console renders `project-root:<key>` intact and sanitizes absolute-looking
  values.
- [x] No new endpoint, schema field, root editing UI, snapshot persistence,
  write path, VCS path, or apply-from-preview behavior.
- [x] CHANGELOG documents the accepted implementation and boundary.

