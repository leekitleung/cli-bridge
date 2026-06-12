# ADR-0007: Workspace-write Expansion (v2.5+)

Status: PROPOSED — SKELETON / DEFERRED

Date: 2026-06-12

## Context

Through v2.4b, CLI Bridge remains non-mutating with respect to the user's
workspace and version control:

```text
Goal -> Plan -> human approval -> sequential patch-only slot ->
SlotArtifact (proposed files only) -> read-only conflict report -> audit
```

Every accepted ADR so far has held the same hard boundary:

- ADR-0003: controlled execution layer, plan approval, step ceiling, per-step
  gate, failure-stop.
- ADR-0004 / ADR-0005: model roles (PlannerModel, CriticModel) are advisory-only
  and `canExecute=false`.
- ADR-0006: multi-provider AgentTeam stays sequential, concurrency 1,
  patch-only, with read-only cross-provider conflict reports.

Across all of these, the following remain forbidden until separately approved:
bridge-governed parallel slots, worktree / branch / shared-workspace isolation,
workspace-write auto-apply, auto-commit, auto-push, auto-merge, PR creation,
merge queue, scheduler / queue / daemon, and any shell/exec/run/command
endpoint.

The roadmap places "governed workspace-write expansion, worktree isolation,
merge queue, advanced tool executors" at **v2.5+** and explicitly defers it.

This ADR exists to **scope the decision space** for that future work. It is a
skeleton: it records the open questions, prerequisites, and risks that a future
real decision must resolve. It does **not** decide whether workspace-write is
permitted, and it does **not** authorize any implementation.

## Decision

### 0. Decision status

**No decision is made by this ADR.** ADR-0007 is intentionally deferred. It
neither permits nor designs workspace-write. It only catalogs what a future
accepted ADR (or set of ADRs) would have to settle before any code.

Any actual permission requires a separate, explicitly accepted ADR with a
senior review decision. Until then, all v2.5+ capabilities below remain
forbidden exactly as they are today.

### 1. Capabilities in scope for a future decision

The v2.5+ expansion space includes, each requiring its own decision and likely
its own ADR:

- **Workspace-write apply**: turning an approved, conflict-checked SlotArtifact
  patch into an actual change on disk in a controlled location.
- **Worktree / branch isolation**: per-slot or per-team isolated working trees
  so concurrent or sequential work does not corrupt the user's main tree.
- **Merge queue / conflict resolution**: an ordered, gated process to combine
  multiple artifacts, still requiring human authority for resolution.
- **Auto-commit / auto-push / auto-merge / PR creation**: VCS-affecting actions.
- **Advanced tool executors**: any executor beyond the current review-only
  command transport (e.g., real CLI dispatch as an execution provider).

Each item above is independently gated. Accepting one does not imply accepting
any other.

### 2. Hard prerequisites before ANY workspace-write acceptance

A future ADR may only be considered for acceptance if it first establishes:

1. **Reversibility**: every workspace-write action is reversible or produces an
   auditable, restorable pre-state (e.g., isolated worktree, stashed baseline,
   or commit boundary the user can reset).
2. **Containment**: writes are confined to an explicitly authorized location and
   cannot touch paths outside the approved project workspace.
3. **Human authority preserved**: ADR-0003 plan approval, per-step gate, and
   failure-stop remain binding; no workspace-write occurs without an explicit
   per-action human gate.
4. **No autonomy**: no scheduler, queue, daemon, background loop, or model-driven
   action may trigger a write without human approval at the point of write.
5. **Audit completeness**: every write/commit/push/merge produces an audit event
   with before/after references, actor identity (provider/endpoint/run), and
   redaction of secrets and raw content.
6. **Fail-closed**: any ambiguity, conflict, validation failure, or missing
   approval aborts the write with no partial mutation.
7. **Opt-in and revocable**: workspace-write is opt-in per project/run and can be
   disabled, with the non-write flow remaining fully functional.

### 3. Open questions a future decision must answer

- **Apply boundary**: which location is writable (main tree vs dedicated
  worktree vs scratch dir)? Is the user's working tree ever written directly?
- **Isolation model**: per-slot worktrees vs per-team branch vs single shared
  tree; cleanup and orphan policy; disk and lifecycle limits.
- **Concurrency**: does workspace-write stay sequential (concurrency 1), or does
  it unlock bridge-governed parallel slots? (The latter is a separate, larger
  decision and currently forbidden.)
- **Merge authority**: who resolves conflicts — human only, or human-confirmed
  assisted resolution? Is a merge queue needed, and what gates it?
- **VCS actions**: are commit/push/merge/PR in scope at all? If so, to which
  branches, under what credentials, and with what human confirmation per action?
- **Credential handling**: how are VCS credentials supplied, scoped, stored
  (memory-only?), and never persisted/audited in plaintext?
- **Executor authority**: does any tool gain real execution authority beyond the
  review-only command transport? If so, how is it sandboxed and gated?
- **Rollback UX**: how does a user inspect, approve, reject, and revert a
  proposed write before and after it lands?
- **Blast radius limits**: caps on files/bytes/commits per action; behavior on
  exceeding them.

### 4. Explicit non-authorization

While ADR-0007 is PROPOSED/DEFERRED (and unless a separate ADR explicitly
permits otherwise), the following remain FORBIDDEN:

- Any workspace-write / apply of a patch to disk.
- Worktree / branch / shared-workspace isolation.
- Auto-apply, auto-commit, auto-push, auto-merge, PR creation, merge queue.
- Scheduler, queue, daemon, background dispatch, autonomous loops.
- Bridge-governed parallel slots and provider-native parallel execution
  controlled by the bridge.
- ArbiterModel, ReplannerModel, SummarizerModel, bounded self-iteration, or
  model-driven conflict resolution / model-driven writes.
- WorkBuddy executor promotion.
- Shell / exec / run / command endpoints, or real CLI dispatch as an executor.
- Any bypass of ADR-0003 plan approval, step ceiling, per-step gate, audit, or
  failure-stop behavior.

### 5. Invariants to preserve

| Invariant | ADR-0007 position |
|---|---|
| Plan approval required before execution | Must remain binding in any v2.5+ ADR. |
| Step ceiling hard 10 | Must remain binding. |
| Per-step gate for state-changing steps | Must remain binding; writes need an explicit per-action gate. |
| Sequential slot advance / concurrency 1 | Unchanged here; any parallelism is a separate decision. |
| Patch-only AgentTeam boundary | Unchanged here; apply-to-disk is the very thing this ADR defers. |
| Conflict reports read-only | Unchanged here; assisted/auto resolution is deferred. |
| Model roles advisory-only | Unchanged for PlannerModel and CriticModel. |
| WorkBuddy non-executing | Unchanged. |
| No shell/exec/run/command endpoint | Unchanged. |
| No auto-apply/commit/push/merge | Unchanged. |

## Risk Acceptance

This ADR accepts no new risk because it authorizes nothing. It records the risks
a future decision must weigh:

- **Irreversible mutation**: writes/commits/pushes/merges can damage the user's
  repository. Mitigation requirement: reversibility + containment + per-action
  gate before any acceptance.
- **Credential exposure**: VCS credentials would be a new secret class.
  Mitigation requirement: memory-only handling, never persisted or audited.
- **Autonomy creep**: workspace-write plus any scheduler/model loop could enable
  unattended mutation. Mitigation requirement: explicit no-autonomy prerequisite.
- **Blast radius**: bulk writes/merges could affect many files. Mitigation
  requirement: explicit caps and fail-closed on exceed.
- **Boundary erosion**: incremental features could quietly cross the patch-only
  line. Mitigation: each capability needs its own accepted ADR; this skeleton
  keeps them individually gated.

## Consequences

While PROPOSED/DEFERRED:

- Nothing changes in runtime behavior or boundaries.
- v2.5+ capabilities remain forbidden as listed in §4.
- This document serves as the intake checklist for any future workspace-write
  ADR.

If a future ADR is later accepted (per-capability):

- It must satisfy the §2 prerequisites and answer the relevant §3 questions.
- It must preserve the §5 invariants unless it explicitly and narrowly amends a
  named one with senior review.
- It must come with its own implementation handoff, tests, verification, and
  closeout review.

## Status / Next

PROPOSED — SKELETON / DEFERRED. No implementation and no capability are
authorized by this document.

Next:

1. No action is required to keep the boundary as-is; v2.5+ stays deferred.
2. When (and only when) workspace-write becomes a real goal, author a focused,
   per-capability ADR (e.g., ADR-0008 "Patch apply to isolated worktree") that
   satisfies §2 and answers the relevant §3 questions, then take it through
   senior review for an explicit accept/reject decision.
3. Until such an ADR is accepted, any execution batch attempting workspace-write,
   isolation, merge, or VCS mutation must be rejected.
