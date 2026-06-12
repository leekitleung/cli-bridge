# CLI Bridge v2.5 — Workspace Apply to Isolated Worktree — Implementation Handoff

**Status**: IMPLEMENTATION HANDOFF (DRAFT) — authorized by ADR-0008 (ACCEPTED), pending design confirmation
**Date**: 2026-06-12
**Based on**:
- `ADR-0008-patch-apply-isolated-worktree.md` (ACCEPTED, with acceptance conditions)
- `ADR-0007-workspace-write-expansion.md` (§2 prerequisites)
- `packages/shared/src/types.ts` (`SlotArtifact`)
- `apps/local-server/src/routes/bridge-api.ts` (`handleArtifactPost`, teams routing)
- `apps/local-server/src/storage/team-store.ts`

---

## 0. Purpose

Implement the smallest first workspace-write capability authorized by ADR-0008:
apply an approved artifact into a **bridge-managed isolated location** (never the
user's main working tree), opt-in (default OFF), behind an explicit per-apply
human gate, reversible, fail-closed, audited, with **no VCS mutation, no
parallelism, no autonomy**.

---

## 1. BLOCKING DESIGN DECISION — patch content source

`SlotArtifact` currently stores only `proposedFiles: string[]` (paths), plus
`summary`, `verificationNotes`, and optional redacted `rawProviderOutput`. **It
does NOT store applicable patch content or new file contents.** There is nothing
concrete to "apply" today. This must be resolved before implementation.

Two candidate approaches (the handoff must pick ONE; recommendation below):

### Approach A (RECOMMENDED) — content supplied at gated apply-time, no spawn
- The apply request itself carries the file contents to write (a map of
  `{ path -> newContent }`), provided at the moment of the human gate.
- The isolated target is a **bridge-managed scratch directory** (a plain
  directory under a dedicated apply root), NOT a git worktree.
- Apply = controlled Node `fs` writes into the scratch dir, with strict path
  containment and caps. **No `git`, no process spawn, no diff library.**
- Pros: no new executor, no git invocation, smallest security surface, fully
  satisfies ADR-0008 §5 "controlled file operations, not a command endpoint".
- Cons: caller must provide full content; no in-repo diff semantics (acceptable
  for a first slice — the goal is a reviewable on-disk result).

### Approach B (DEFERRED) — git worktree + `git apply`
- Use `git worktree add` and `git apply <unified-diff>` against the project.
- Requires spawning `git` (a real executor) under tightly controlled argv.
- This escalates the security surface (process spawn, git) and SHOULD be a
  separate ADR/handoff, not the first slice. Do NOT implement B here.

**Recommendation: implement Approach A.** Confirm with the reviewer before coding.

---

## 2. Scope (Approach A)

In scope:
- New **opt-in, per-project** apply capability, default OFF (a project flag,
  e.g. `workspaceApplyEnabled`, default false; never written to main tree).
- A bridge-managed **apply root** (dedicated dir; each apply gets its own
  isolated subdirectory = the "isolated worktree" in ADR-0008 terms).
- A gated apply operation that writes a provided `{ path -> content }` map into
  the isolated dir, with path containment + caps + fail-closed.
- Reversibility: the isolated dir can be discarded; a pre-apply manifest is
  recorded; discarding never touches the main tree.
- Audit: `workspace_apply_request` / `workspace_apply_result` with typed
  `result.metadata` (artifact correlation id, applyId, isolated dir id, file
  count, byte total, caps, status, actor) — no secrets, no raw file content.

Out of scope (still forbidden; separate ADRs):
- Any write to the user's main working tree.
- `git` invocation, worktree, `git apply`, commit, push, merge, PR, merge queue.
- Parallel apply, scheduler, daemon, background/model-triggered apply.
- A general command/exec endpoint.

---

## 3. Per-apply human gate (non-negotiable)

- Apply MUST require a distinct, explicit human confirmation referencing the
  exact artifact correlation + target isolated dir + file list, at the moment of
  write. Reuse the existing approval/gate pattern; do NOT auto-confirm.
- No model output, scheduler, or background path may trigger apply.
- Without a satisfied gate, the apply request is rejected (no write).

---

## 4. Containment, caps, fail-closed

- Path containment: normalize every target path and reject anything resolving
  outside the isolated dir root (`..`, absolute paths, symlink escape). Reject
  before any write.
- Caps: enforce per-apply `maxFiles` and `maxTotalBytes` (pick conservative
  defaults, e.g. 200 files / 5 MB); exceed → fail-closed, no partial write.
- Fail-closed: on any validation failure, path escape, cap exceed, missing gate,
  or disabled flag → abort with no files written and an audit result event.
- Atomicity: prefer writing to a temp staging dir then moving into place, so a
  mid-failure leaves no partial isolated dir; or clean up on failure.

---

## 5. Allowed modification range

- `packages/shared/src/types.ts` — add `workspace_apply_request` /
  `workspace_apply_result` to `AuditEventType`; add the project opt-in flag type
  if needed; (NO patch field added to `SlotArtifact` under Approach A).
- `packages/shared/src/schemas.ts` — validate the apply request shape and the
  new audit event types.
- `apps/local-server/src/storage/` — a new `workspace-apply-store.ts` (or
  similar) managing the apply root, isolated dir lifecycle, manifests, caps,
  path containment. Pure, contained fs operations; no spawn.
- `apps/local-server/src/routes/bridge-api.ts` — a new gated route under the
  existing project/teams surface for apply request + confirm; read-only status
  for listing/discarding isolated dirs. Extend audit writing.
- `apps/local-server/src/routes/project-console.ts` — read-only display of
  isolated apply results and a gated confirm affordance ONLY (no auto-apply).
- `docs/contracts/bridge-projects-api.md` — document the apply endpoints/flow.
- `tests/` — new test file (e.g. `tests/workspace-apply.test.mjs`).
- `CHANGELOG.md`.

No `git`, no `child_process`, no spawn anywhere in this slice.

---

## 6. Tests — map to ADR-0008 Acceptance Conditions

1. Containment: paths escaping the isolated root (`../`, absolute, traversal) are
   rejected with no write.
2. Main tree untouched: an apply never modifies any path outside the apply root;
   assert the project/main tree is unchanged.
3. Per-apply gate: apply without an explicit confirmation is rejected; only an
   explicit human-confirmed request writes.
4. Reversibility: discarding an isolated dir removes it cleanly; pre-apply
   manifest recorded; main tree unaffected.
5. Fail-closed: conflict / invalid request / cap exceed / disabled flag → abort,
   no partial write, audit result recorded.
6. No VCS / no spawn: assert no commit/push/merge path; (source check) no
   `child_process`/`git` usage introduced.
7. Audit: `workspace_apply_request`/`result` use typed `result.metadata`; assert
   no API key, no raw file content, no secrets in audit.
8. Opt-in default OFF: with the flag off, apply is rejected; non-apply flows
   unaffected.

---

## 7. Verification commands

```text
npm run typecheck
npm run lint
node --experimental-strip-types --test tests/workspace-apply.test.mjs
npm test
git diff --check
```

---

## 8. Closeout checklist (reviewer re-verifies)

- Every ADR-0008 Acceptance Condition (1–8) has a passing test.
- Every ADR-0007 §2 prerequisite is satisfied (reversibility, containment, human
  authority, no autonomy, audit, fail-closed, opt-in).
- No `git`/spawn/exec introduced; no main-tree write; no VCS mutation.
- Boundary evidence: no new general command endpoint; apply is gated and opt-in.
- `git diff --check` clean; full suite green.

---

## 9. Return to review

This is an `EX-*` batch. On completion, return to `REVIEW-*` with changed files,
verification results, and boundary evidence. Any move toward git worktrees,
`git apply`, main-tree writes, VCS mutation, parallelism, or merge queue is OUT
of scope and requires a new ADR.
