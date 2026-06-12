# ADR-0008: Patch Apply to Isolated Worktree (v2.5 — first workspace-write slice)

Status: PROPOSED

Date: 2026-06-12

## Context

ADR-0007 deferred all v2.5+ workspace-write capabilities and required that each
capability be decided by its own focused ADR satisfying the ADR-0007 §2
prerequisites and answering the relevant §3 questions.

Through v2.4b, an approved, conflict-checked plan produces patch-only
`SlotArtifact` records that propose file changes. The bridge never writes them
to disk. The only way a user can use a proposed patch today is to copy it out
manually.

This ADR decides the **smallest possible** first workspace-write capability:
applying an already-approved, conflict-checked patch into a **dedicated isolated
worktree** that is NOT the user's main working tree, behind an explicit
per-apply human gate, fully reversible, and with no VCS mutation
(no commit/push/merge/PR) and no autonomy.

This ADR does NOT authorize: writing to the user's main tree, commit/push/merge/
PR, merge queue, parallel slots, scheduler/daemon, or model-driven apply. Those
remain deferred under ADR-0007 and require their own ADRs.

## Decision

### 1. Whether patch-apply-to-isolated-worktree is allowed

**Proposed decision**: PERMIT, only into a bridge-managed isolated worktree,
behind a per-apply human gate, reversible, with no VCS mutation.

A user MAY request that an approved SlotArtifact patch be applied into a
dedicated isolated worktree so they can inspect a real on-disk result. The
bridge:

- never writes to the user's main working tree;
- never commits, pushes, merges, opens a PR, or runs a merge queue;
- never applies without an explicit per-apply human gate;
- always produces a reversible, auditable result;
- fails closed on any conflict, validation failure, or path-escape.

### 2. Scope (the smallest first slice)

In scope:

- A new **opt-in, per-project** apply capability, default OFF.
- Apply target is a **bridge-managed isolated worktree** under a dedicated,
  contained location (e.g., a `git worktree` of the project, or a fresh scratch
  checkout). Never the user's main tree.
- Apply input is a single approved, conflict-checked `SlotArtifact` whose
  `proposedFiles` and patch content already passed schema, redaction, and
  conflict checks.
- A mandatory **per-apply gate**: the human must explicitly confirm the specific
  artifact + target worktree before any write.
- Apply is **reversible**: the isolated worktree can be discarded/reset without
  affecting the main tree; the pre-apply state is recorded.
- Full **audit**: an `workspace_apply_request` / `workspace_apply_result` pair
  with artifact id, target worktree id, file list, byte/file caps, status, and
  actor identity — no secrets, no raw file content.

Out of scope (still forbidden; require separate ADRs):

- Writing to the user's main working tree.
- `git commit` / `push` / `merge` / PR creation / merge queue.
- Applying multiple artifacts atomically / cross-artifact merge.
- Parallel apply, scheduler, daemon, background apply.
- Model-driven or automatic apply (apply is always human-gated and manual).
- Advanced tool executors or shell/exec/run/command endpoints.

### 3. ADR-0007 §2 prerequisites — how this slice satisfies them

| Prerequisite | This slice |
|---|---|
| Reversibility | Apply lands only in an isolated worktree that can be discarded/reset; main tree untouched; pre-apply ref recorded. |
| Containment | Writes confined to the dedicated worktree path; path normalization rejects any file escaping the worktree root. |
| Human authority preserved | ADR-0003 plan approval unchanged; a new explicit per-apply gate is required at the moment of write. |
| No autonomy | No scheduler/daemon/model loop may trigger apply; apply is a discrete human-initiated action. |
| Audit completeness | apply request/result events with artifact id, worktree id, file list, caps, status, actor; secrets/raw content redacted. |
| Fail-closed | Any conflict, schema/redaction failure, path escape, cap exceed, or missing gate aborts with no partial write. |
| Opt-in and revocable | Capability is per-project opt-in, default OFF, and disabling it leaves all non-apply flows fully functional. |

### 4. §3 open questions this slice answers

- **Apply boundary**: a dedicated bridge-managed isolated worktree only; never
  the main tree.
- **Isolation model**: one isolated worktree per apply target; explicit cleanup;
  orphaned worktrees are listed and reclaimable; a max-worktree cap applies.
- **Concurrency**: apply remains sequential; no parallelism is unlocked here.
- **VCS actions**: none. commit/push/merge/PR are explicitly out of scope.
- **Credentials**: none required (no remote/VCS network action), so no new
  credential class is introduced by this slice.
- **Rollback UX**: the user can inspect the applied worktree, then keep or
  discard it; discarding is a clean reset with audit.
- **Blast radius limits**: per-apply caps on file count and total bytes; exceed
  → fail-closed.

### 5. Boundary / non-authorization

This ADR does NOT weaken any prior invariant and does NOT authorize anything
beyond §2 "in scope". The ADR-0007 §4 forbidden list remains in force for every
item not explicitly permitted here.

| Invariant | ADR-0008 position |
|---|---|
| Plan approval before execution | Unchanged. |
| Per-step gate for state-changing steps | Unchanged; apply adds an additional explicit per-apply gate. |
| Step ceiling hard 10 | Unchanged. |
| Sequential / concurrency 1 | Unchanged; no parallel apply. |
| Patch-only AgentTeam artifacts | Unchanged; apply consumes an already-approved patch, it does not change how artifacts are produced. |
| Conflict reports read-only | Unchanged; apply requires a clean/explicitly-resolved conflict state and never auto-resolves. |
| Model roles advisory-only | Unchanged; models cannot trigger apply. |
| WorkBuddy non-executing | Unchanged. |
| No shell/exec/run/command endpoint | Unchanged; apply uses controlled file/worktree operations, not a general command endpoint. |
| No auto-apply/commit/push/merge | Apply is never automatic; commit/push/merge stay forbidden. |

## Risk Acceptance

- **Disk write is a real mutation**: even in an isolated worktree, files land on
  disk. Mitigation: containment to a dedicated path, reversibility, per-apply
  gate, fail-closed, caps.
- **Path traversal**: a malicious/incorrect file path could escape the worktree.
  Mitigation: strict path normalization + reject-on-escape, validated before any
  write.
- **Worktree sprawl**: many isolated worktrees could accumulate. Mitigation:
  max-worktree cap, listing, and explicit cleanup.
- **Scope creep to main tree / VCS**: pressure to "just commit it". Mitigation:
  commit/push/merge/PR explicitly out of scope and require separate ADRs.
- **Perceived autonomy**: users may expect auto-apply. Mitigation: apply is
  always a discrete human-gated action; no scheduler/model path.

## Consequences

If accepted:

- v2.5 may implement a single, opt-in, human-gated, reversible
  apply-to-isolated-worktree capability with full audit and fail-closed behavior.
- A separate implementation handoff must define exact file changes, request/
  response shapes, the gate flow, worktree lifecycle, caps, tests, verification,
  and closeout criteria.
- commit/push/merge/PR, main-tree writes, parallel apply, and merge queue remain
  deferred (separate ADRs).

If rejected:

- AgentTeam artifacts remain proposal-only; users continue to apply patches
  manually outside the bridge.
- A narrower or different first workspace-write capability can be proposed
  instead.

## Status / Next

PROPOSED. No implementation is authorized while this ADR is PROPOSED.

Before execution can start:

1. A reviewer must explicitly accept or reject ADR-0008. Because this is the
   first workspace-write capability, acceptance requires an explicit human
   go-ahead, not an automated decision.
2. If accepted, create a v2.5 implementation handoff with allowed modification
   range, forbidden list, the per-apply gate flow, worktree lifecycle and caps,
   tests, and a closeout checklist that re-verifies every ADR-0007 §2
   prerequisite.
3. Execution must remain in an `EX-*` batch and return to review before any
   expansion toward main-tree writes, VCS mutation, parallelism, or merge queue.
