# CLI Bridge v2.14 — Read-only Local Git Status Provider — Implementation Handoff (ADR-0019-a)

**Status**: HANDOFF AUTHORED — **NOT YET DISPATCHABLE**. `EX-2.14-1` may run
only after `REVIEW-ADR-0019-a` accepts ADR-0019-a (ADR-0007 §2). Until then this
is a pre-written, gated handoff.
**Date**: 2026-06-13
**Batch**: `EX-2.14-1` (execution) → returns to `REVIEW-2.14-1`
**Based on**:
- `docs/planning/ADR-0019-git-ci-github-provider-integration.md` — "RP-2.14
  split decision (a/b) and ADR-0019-a fixed design"
- `docs/planning/ADR-0018-local-live-verification-execution.md` (root resolution,
  `shell:false` runner pattern)
- `apps/local-server/src/verification/profile-runner.ts` (spawn/cwd/timeout/
  injectable-spawn reference)

---

## 0. Scope note

Implement **only ADR-0019-a**: an opt-in, human-triggered, **read-only, offline**
local `git` status context provider. **Do NOT** implement ADR-0019-b (remote
CI/GitHub, network, credentials). git status is **context only** and is NOT
mapped to `VerificationResult` pass/fail.

---

## 1. Background

- RP/EX/REVIEW batch flow; this batch returns to `REVIEW-2.14-1` and must not
  continue into ADR-0019-b.
- Closed predecessors: ADR-0017 typed model (`cfce284`), ADR-0018 local live
  execution (`b87b622`).
- Reuse: `projectWorkspaceRoots[projectKey]` root resolution (operator-config,
  never HTTP; absent → 409/no spawn; no `baselineRoot` fallback); the
  `shell:false` + structured argv + timeout + output-cap + injectable-spawn
  pattern from `profile-runner.ts`; redaction/audit patterns already in the
  codebase.

## 2. Goal

Provide a sanitized, read-only local git status context for an opt-in project,
displayed inertly in the console verification view, with a redacted audit event.

## 3. Subtasks (suggested order)

1. **Types + opt-in** — `packages/shared/src/types.ts`: add `GitStatusView`
   (`branch: string|null`, `dirty: boolean`, `aheadCount: number|null`,
   `behindCount: number|null`, `isGitRepo: boolean`, `fetchedAt: number`,
   `available: boolean`); add `Project.gitStatusEnabled?: boolean` (default off).
2. **Schema** — `packages/shared/src/schemas.ts`: accept PATCH `gitStatusEnabled`
   (boolean; non-boolean → 400); reject any command/argv/cwd/env/root/remote/
   token-like fields.
3. **Reader module** — `apps/local-server/src/verification/git-status-reader.ts`
   (new): `shell:false` structured argv, the four read-only commands only, cwd
   only from `projectWorkspaceRoots[key]` (no fallback; absent → not available,
   no spawn), bounded timeout + output cap + discard raw output, export
   `gitSpawnFn` injection point.
4. **Parse → sanitized view** — porcelain/rev-parse/rev-list → `GitStatusView`;
   non-repo → `isGitRepo:false`; spawn/timeout/parse error → fail-closed
   unavailable.
5. **Route** — `GET /bridge/projects/:key/verification/git-status` (human
   triggered, read-only). Not enabled → 409; no project root → 409 (no spawn);
   archived → 409; success → sanitized view; failure fail-closed (no raw output).
6. **Audit** — redacted fetch event (project, isGitRepo, dirty, ahead/behind,
   timing); no absolute cwd/root, remote URL, commit hash, token, raw output.
7. **Console** — inert git status context in the verification view (branch /
   dirty / ahead-behind / isGitRepo). GET-only; no mutate/run controls; missing
   → inert "unavailable".
8. **Contract** — `docs/contracts/bridge-projects-api.md`: document the endpoint,
   the sanitized fields, and the read-only/offline guarantee.
9. **Tests** — `tests/git-status-reader.test.mjs` (new, injected fake spawn) +
   route test + console test, mapped to §6 acceptance.
10. **CHANGELOG** — record `EX-2.14-1` (ADR-0019-a).

## 4. Allowed view / modify range

See ADR-0019-a "allowed files". Modify only:
`packages/shared/src/types.ts`, `packages/shared/src/schemas.ts`,
`apps/local-server/src/verification/git-status-reader.ts` (new),
`apps/local-server/src/routes/bridge-api.ts`,
`apps/local-server/src/routes/project-console.ts`,
`apps/local-server/src/storage/project-store.ts`,
`apps/local-server/src/storage/json-snapshot-store.ts` (only if opt-in
persistence requires it), `docs/contracts/bridge-projects-api.md`,
`CHANGELOG.md`, `tests/git-status-reader.test.mjs` (new),
`tests/bridge-projects-api.test.mjs`, `tests/project-console-behavior.test.mjs`,
`tests/json-persistence.test.mjs` (only if persistence requires it).
Anything outside → STOP and report.

## 5. Forbidden

- No network / remote: CI, GitHub, any provider API, any outbound request or
  network client (ADR-0019-b).
- No credentials/token read/store/passthrough/display (ADR-0019-b).
- No git write: commit/push/merge/rebase/tag/checkout/branch-mutation/`fetch`/
  `pull`. Read-only queries only.
- No exposure of absolute cwd/root, remote URL, commit hash/SHA, raw git output,
  token, or diff.
- No mapping git status to `VerificationResult` pass/fail.
- No `shell:true` / string interpolation.
- No `baselineRoot` fallback; missing project root → fail-closed, no spawn.
- No poller/scheduler/webhook/model trigger; human-triggered GET only.
- No write/apply/commit/promote/discard control.
- No ADR-0019-b code; no product/architecture decisions (all fixed here).

## 6. Acceptance criteria

The 11 ADR-0019-a acceptance conditions in
`docs/planning/ADR-0019-git-ci-github-provider-integration.md`.

## 7. Verification commands (run and report all)

- `npm run typecheck`
- `npm run lint`
- `node --test tests/git-status-reader.test.mjs`
- `node --test tests/bridge-projects-api.test.mjs`
- `node --test tests/project-console-behavior.test.mjs`
- `node --test tests/json-persistence.test.mjs`
- `npm test`
- `git diff --check`

## 8. Report format

- Changed files (new vs modified);
- Per-subtask implementation notes;
- Targeted suite pass counts + `npm test` total;
- typecheck/lint/diff-check results;
- Boundary evidence: read-only git argv list, no network/credentials, no
  sensitive fields in response/audit/console, root no-fallback, missing-root 409
  with no spawn;
- Confirm ADR-0019-b not implemented, not committed, not pushed; leave dirty
  tree for `REVIEW-2.14-1`.

## 9. Pre-review material

- Changed files + diff summary;
- The read-only git command list (why each is read-only);
- Acceptance-condition-by-condition evidence;
- Full verification output;
- Explicit statement that ADR-0019-b (remote CI/GitHub + credentials) is
  untouched.

## 10. Closeout

One dedicated `EX-2.14-1` commit carrying only the allowed files; do not
commit/push until `REVIEW-2.14-1` authorizes. Control returns to RP before any
next slice; ADR-0019-b stays deferred.
