# CLI Bridge v2.5 — Read-only Apply-result Presentation — Implementation Handoff

**Status**: IMPLEMENTATION HANDOFF — AUTHORIZED for `EX-2.5-3`
**Date**: 2026-06-12
**Based on**:
- `docs/planning/ADR-0009-read-only-apply-result-presentation.md` (ACCEPTED, with acceptance conditions)
- `docs/planning/ADR-0008-patch-apply-isolated-worktree.md` (ACCEPTED)
- `docs/planning/ADR-0007-workspace-write-expansion.md` (§2 prerequisites)
- `apps/local-server/src/storage/workspace-apply-store.ts` (`WorkspaceApplyStore`, `ApplyRequest`)
- `apps/local-server/src/routes/bridge-api.ts` (`matchTeamApplyPath`, `applyStore` runtime)
- `docs/contracts/bridge-projects-api.md` (Workspace Apply section)
- `tests/workspace-apply.test.mjs`

---

## 0. Purpose

Implement the strictly read-only apply-result presentation layer authorized by
ADR-0009: let a user (or the project console) inspect what an existing isolated
apply produced, using only data the bridge already records. **No new mutation,
no pre-apply baseline, no diff/classification, no main-tree write, no `git`/VCS,
no auto-apply, no parallelism, no autonomy.**

---

## 1. Available data (no new capture)

`ApplyRequest` already records:

```text
applyId, projectKey, teamId, slotId, planStepId, proposedFiles[],
isolatedDirId, isolatedDirPath, status, caps, actor, createdAt,
confirmedAt, fileCount, byteTotal
```

plus the applied files written under `applyRoot/<isolatedDirId>/`.

There is **no pre-apply baseline** stored. Therefore diff, diff-like views, and
modified/unchanged/new classification are OUT of scope and MUST NOT be added;
they require a separate ADR that first authorizes baseline capture.

---

## 2. Scope (read-only presentation)

In scope — three read-only endpoints under the existing apply surface
(`/bridge/projects/:key/teams/:teamId/apply-requests`):

1. **Manifest** — `GET /bridge/projects/:key/teams/:teamId/apply-requests/:applyId`
   - Returns a read-only projection of the `ApplyRequest`: applyId,
     projectKey/teamId/slotId/planStepId, isolatedDirId, status, fileCount,
     byteTotal, caps, createdAt, confirmedAt, actor.
   - Never returns raw file content. Never returns `isolatedDirPath` (an absolute
     host path) — expose `isolatedDirId` only.
   - `200` with `{ apply: ApplyManifest }`; `404` if unknown applyId or wrong
     project/team.

2. **File list** — `GET .../apply-requests/:applyId/files`
   - Returns the repository-relative file paths within the isolated directory and
     each file's byte size: `{ files: [{ path, size }] }`.
   - Read from the isolated directory (status `applied`) and/or `proposedFiles`.
   - Carries **no** modified/unchanged/new classification.
   - `200`; `404` if unknown; `409` if status is not `applied` (e.g. pending,
     discarded, failed → no on-disk result to list).

3. **Per-file preview** — `GET .../apply-requests/:applyId/files/preview?path=<rel>`
   - Returns a size-capped, secret-redacted preview of a single file:
     `{ path, size, truncated, redacted, content }`.
   - `path` is validated with the same containment logic as the apply store
     (`validateAllPaths` / equivalent); reject `..`, absolute, drive-letter, UNC,
     and any selector resolving outside the isolated dir root.
   - Content is capped at a conservative preview byte limit (e.g. 64 KB);
     beyond that, return `truncated: true`. Apply secret redaction before
     returning.
   - `200`; `400` on missing/invalid path; `404` if unknown applyId or file not
     present; `409` if status is not `applied`.

Out of scope (forbidden; separate ADRs):
- Pre-apply baseline capture, diff/diff-like view, modified/unchanged/new
  classification.
- Any write/modify/delete via these endpoints (discard stays the existing
  ADR-0008 `POST .../discard`).
- Any "apply from preview" / promote affordance.
- Main-tree writes, `git`/VCS, commit/push/merge/PR/merge queue.
- Parallel processing, scheduler, daemon, background or model-triggered
  presentation.
- A general command/exec endpoint or new executor authority.

---

## 3. Opt-in, containment, redaction, fail-closed

- **Opt-in**: gate all three endpoints on `Project.workspaceApplyEnabled === true`
  (default false), consistent with the apply endpoints. With apply disabled →
  `409` (or `404`), endpoints inert, non-apply flows unaffected.
- **Containment**: reuse the apply-store path validation; reads confined to the
  isolated dir for the given applyId. Reject-on-escape before any read.
- **Redaction**: previews and manifests must contain no API keys, secrets, or
  raw provider output. Reuse the existing secret-redaction approach used for
  artifacts/audit; never echo `isolatedDirPath`.
- **Fail-closed**: unknown/expired applyId, path escape, status mismatch, or cap
  exceed → clean 4xx, no partial/unsafe disclosure.
- **Read-only**: no endpoint mutates an `ApplyRequest`, writes, or deletes any
  file. Pure reads only.

---

## 4. Allowed modification range

- `apps/local-server/src/routes/bridge-api.ts` — extend `matchTeamApplyPath`
  (or add a sibling read-only matcher) to recognize the GET manifest, files, and
  files/preview subroutes; add read-only handlers that call into the apply store
  / read the isolated dir. No mutation paths.
- `apps/local-server/src/storage/workspace-apply-store.ts` — add **read-only**
  helpers if needed (e.g. `listAppliedFiles(applyId)`, `readFilePreview(applyId,
  relPath, cap)`), implemented as pure `fs` reads with the existing containment
  logic. No `git`, no `child_process`, no spawn.
- `apps/local-server/src/routes/project-console.ts` — read-only display of an
  apply result's manifest, file list, and preview. **No** apply/promote/write
  affordance; keep/discard reuses the existing ADR-0008 controls only.
- `docs/contracts/bridge-projects-api.md` — document the three read-only
  endpoints under the Workspace Apply section.
- `tests/workspace-apply.test.mjs` (or a new `tests/apply-result-presentation.test.mjs`).
- `CHANGELOG.md`.

No `git`, no `child_process`, no spawn, no new dependency anywhere in this slice.

---

## 5. Tests — map to ADR-0009 Acceptance Conditions

1. **Read-only proof**: after manifest/files/preview calls, the `ApplyRequest`
   status and the isolated dir contents are unchanged; no file created/modified/
   deleted by presentation.
2. **Containment**: `preview?path=../escape`, absolute, drive-letter, and UNC
   selectors are rejected with no read outside the isolated root.
3. **No baseline / no diff**: source check asserts no diff/baseline endpoint or
   classification field; file list response has no modified/unchanged/new field.
4. **Redaction + caps**: a file containing a secret-like token is redacted in
   preview; an over-cap file returns `truncated: true`; manifest exposes no
   `isolatedDirPath`, key, or secret.
5. **Fail-closed**: unknown applyId → 404; preview of a non-existent file → 404;
   files/preview on a `pending`/`discarded` apply → 409; no disclosure.
6. **No VCS / no spawn**: source check asserts no `git`/`child_process`/spawn in
   the presentation code paths.
7. **Opt-in default OFF**: with `workspaceApplyEnabled` false, all three
   endpoints reject; non-apply flows unaffected.
8. **No "apply from preview"**: assert no endpoint/console path writes, applies,
   or promotes a previewed result; only manifest/list/preview are exposed.

---

## 6. Verification commands

```text
npm run typecheck
npm run lint
node --experimental-strip-types --test tests/workspace-apply.test.mjs
npm test
git diff --check
```

---

## 7. Closeout checklist (reviewer re-verifies)

- Every ADR-0009 Acceptance Condition (1–8) has a passing test.
- Every ADR-0007 §2 prerequisite is satisfied (reversibility — n/a, no mutation;
  containment; human authority; no autonomy; audit; fail-closed; opt-in).
- No `git`/spawn/exec introduced; no mutation; no pre-apply baseline; no diff;
  no main-tree write; no VCS.
- No "apply from preview" affordance in API or console.
- `git diff --check` clean; full suite green.

---

## 8. Return to review

This is an `EX-*` batch. On completion, return to `REVIEW-*` with changed files,
verification results, and boundary evidence. Any move toward pre-apply baseline
capture, diff/diff-like views, modified/unchanged classification, main-tree
writes, `git`/VCS mutation, parallelism, or merge queue is OUT of scope and
requires a new ADR.
