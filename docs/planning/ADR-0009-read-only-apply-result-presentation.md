# ADR-0009: Read-only Apply-result Export / Presentation (v2.5 follow-up)

Status: PROPOSED — awaiting senior accept/reject

Date: 2026-06-12

## Context

ADR-0008 (ACCEPTED) authorized the smallest first workspace-write capability:
applying an approved, conflict-checked `SlotArtifact` into a bridge-managed
**isolated location** (Approach A scratch directory, never the user's main
tree), opt-in (default OFF), behind a per-apply human gate, reversible,
fail-closed, audited, with **no VCS mutation, no parallelism, no autonomy**. The
`CLI-BRIDGE-v2.5-WORKSPACE-APPLY-HANDOFF.md` authorized `EX-2.5-1` to implement
that apply path.

The implemented `WorkspaceApplyStore` (`apps/local-server/src/storage/
workspace-apply-store.ts`) records, per apply, only:

```text
applyId, projectKey, teamId, slotId, planStepId, proposedFiles[],
isolatedDirId, isolatedDirPath, status, caps, actor, createdAt,
confirmedAt, fileCount, byteTotal
```

plus the applied file content written into the isolated directory. **It does NOT
record any pre-apply baseline or original file content.** There is no stored
"before" state to compare against.

After an apply lands, the only way to understand the result today is the audit
metadata above plus manual inspection of the on-disk scratch directory. There is
no governed, read-only way for a user or console to **see** what an apply
produced.

This ADR decides whether the bridge may expose a **strictly read-only**
presentation of an existing isolated apply result, bounded to data the bridge
already has: the apply manifest, the isolated-directory file list, and a
size-capped, redacted per-file content preview. It introduces **no new
mutation**, touches **no main tree**, performs **no git or VCS action**, and
grants **no autonomy**.

Because no pre-apply baseline is captured, any **diff against an original /
baseline**, and any **modified-vs-unchanged classification**, are NOT
implementable from current data and are explicitly **deferred** to a future ADR
(see §2 "Deferred"). This ADR does not authorize capturing such a baseline.

This ADR does NOT authorize: any write to the user's main working tree, any
`git`/VCS action (commit/push/merge/PR/merge queue), pre-apply baseline capture,
diff/baseline comparison, auto-apply, parallel apply, scheduler/daemon/
background loops, model-driven apply or model-triggered presentation, or any new
shell/exec/run/command capability. Those remain deferred under ADR-0007 and
ADR-0008 and require their own ADRs.

## Decision

### 0. Decision status

**PROPOSED.** No implementation is authorized until this ADR is explicitly
accepted by senior review and a v2.5 follow-up execution handoff (`EX-2.5-3`) is
created.

### 1. Whether read-only apply-result presentation is allowed

**Proposed decision**: PERMIT, strictly read-only, over apply results that
already exist in a bridge-managed isolated location, using only data the bridge
already records, with no new mutation, no baseline capture, and no new execution
authority.

A user (or the project console) MAY request a read-only view of an existing
isolated apply result so they can inspect what an apply produced before deciding
to keep or discard it. The bridge:

- only reads the existing `ApplyRequest` record and the files already written
  into the bridge-managed isolated directory;
- never writes, modifies, or deletes any file as part of presentation
  (discard/cleanup remains the separate, already-authorized ADR-0008 operation);
- never reads or writes outside the isolated apply root;
- never captures, stores, or infers a pre-apply baseline;
- never invokes `git`, spawns a process, or performs any VCS action;
- redacts secrets and enforces preview size caps;
- fails closed on path escape, missing/unknown apply id, or cap exceed.

### 2. Scope (the smallest read-only slice)

In scope:

- A **read-only apply manifest** for an existing apply id, projected from the
  stored `ApplyRequest`: applyId, source artifact correlation
  (projectKey/teamId/slotId/planStepId), isolatedDirId, status, fileCount,
  byteTotal, caps, createdAt, confirmedAt, and actor. No secrets.
- A **read-only file list** for the applied result: the repository-relative
  paths within the isolated directory and each file's size. The list is read
  from the isolated directory (and/or `proposedFiles`); it carries **no**
  modified/unchanged/new classification (there is no baseline to classify
  against).
- A **read-only per-file content preview**, size-capped and secret-redacted,
  for a single requested file within the isolated directory.
- Read-only API contract documentation and tests.

Deferred (NOT authorized by this ADR; require a separate ADR, and most require
first capturing a pre-apply baseline):

- Pre-apply baseline / original-content capture at apply time.
- Any diff or diff-like view between an original/baseline and the applied
  content.
- Any new-vs-modified-vs-unchanged file classification.

Out of scope (still forbidden; require separate ADRs):

- Any write/modify/delete of files as part of presentation (cleanup/discard
  stays the existing ADR-0008 gated operation, not a presentation action).
- Any write to the user's main working tree.
- `git` invocation, `git diff`/`git apply`, worktree, commit, push, merge, PR,
  merge queue.
- Promoting/applying the previewed result anywhere (no "apply from preview").
- Parallel processing, scheduler, daemon, background or model-triggered
  presentation.
- A general command/exec endpoint or any new executor authority.

### 3. ADR-0007 §2 prerequisites — how this slice satisfies them

| Prerequisite | This slice |
|---|---|
| Reversibility | No mutation occurs; presentation is read-only, so there is nothing to reverse. |
| Containment | Reads confined to the isolated apply directory for the given apply id; path normalization rejects any read path escaping the root. |
| Human authority preserved | ADR-0003 plan approval and the ADR-0008 per-apply gate are unchanged; viewing a result never triggers a new apply or any write. |
| No autonomy | No scheduler/daemon/model loop may drive presentation; each view is a discrete human-initiated read. |
| Audit completeness | Optional read access events may be recorded with applyId and actor; no secrets or raw secret content in audit. |
| Fail-closed | Path escape, missing/unknown applyId, or cap exceed aborts the read with no partial/unsafe disclosure. |
| Opt-in and revocable | Bound to the existing per-project apply opt-in (default OFF); with apply disabled there are no results to present and the endpoints stay inert. |

### 4. §3 open questions this slice answers

- **Apply boundary**: unchanged — reads only the existing bridge-managed
  isolated directory; never the main tree, never writable.
- **Isolation model**: unchanged — presentation operates per existing isolated
  apply id; it creates no new isolated locations and captures no baseline.
- **Concurrency**: unchanged — reads are sequential and stateless; no
  parallelism unlocked.
- **VCS actions**: none — no `git`, no diff tooling; presentation reads stored
  records and applied files only.
- **Credentials**: none — no remote/VCS network action, so no new credential
  class is introduced.
- **Rollback UX**: this slice improves inspection ahead of the existing
  keep/discard decision; it does not change how discard works.
- **Blast radius limits**: per-request preview size and file caps; exceed →
  fail-closed.

### 5. Boundary / non-authorization

This ADR does NOT weaken any prior invariant and does NOT authorize anything
beyond §2 "in scope". The ADR-0007 §4 forbidden list and the ADR-0008 out-of-
scope list remain in force for every item not explicitly permitted here.

| Invariant | ADR-0009 position |
|---|---|
| Plan approval before execution | Unchanged. |
| Per-apply human gate (ADR-0008) | Unchanged; presentation never triggers an apply or a write. |
| Step ceiling hard 10 | Unchanged. |
| Sequential / concurrency 1 | Unchanged; no parallel presentation. |
| Patch-only AgentTeam artifacts | Unchanged. |
| Conflict reports read-only | Unchanged. |
| Model roles advisory-only | Unchanged; models cannot trigger presentation or apply. |
| WorkBuddy non-executing | Unchanged. |
| No shell/exec/run/command endpoint | Unchanged; presentation uses contained read-only fs operations only. |
| No auto-apply/commit/push/merge | Unchanged; presentation performs none of these. |
| No pre-apply baseline capture | Unchanged; this ADR does not capture or store any baseline. |
| Apply target = isolated location only | Unchanged; presentation reads it, never the main tree. |

## Risk Acceptance

- **Information disclosure**: previews could surface secrets present in applied
  content. Mitigation: secret redaction on preview, size caps, and reuse of the
  existing redaction utilities.
- **Path traversal on read**: a crafted file selector could try to read outside
  the isolated root. Mitigation: strict path normalization + reject-on-escape
  before any read (reuse the apply-store containment logic).
- **Perceived mutation / scope creep to "apply from preview"**: users may expect
  a button to promote a previewed result. Mitigation: presentation is strictly
  read-only; promotion/apply stays the separate ADR-0008 gated path; no "apply
  from preview" affordance.
- **Pressure to add a diff view**: a file list without diff may feel
  incomplete. Mitigation: diff and baseline classification are explicitly
  deferred and require a separate ADR that first authorizes baseline capture;
  this slice ships the manifest + file list + preview only.
- **Resource cost**: large results could make previews expensive. Mitigation:
  caps and fail-closed on exceed.

## Consequences

If accepted:

- A v2.5 follow-up execution handoff (`EX-2.5-3`) may authorize a single,
  opt-in, read-only apply-result presentation slice: manifest, file list, and
  size-capped redacted content preview, with path containment and fail-closed
  behavior.
- The handoff must define exact endpoints/request-response shapes, the read-only
  console affordances, caps/redaction, the no-mutation/no-spawn/no-baseline
  boundary, tests, verification commands, and a closeout checklist re-verifying
  every ADR-0007 §2 prerequisite and the no-VCS/no-spawn/no-main-tree boundary.
- Pre-apply baseline capture, diff/diff-like views, modified/unchanged
  classification, main-tree writes, VCS mutation, auto-apply, parallel apply,
  merge queue, and "apply from preview" remain deferred and require separate
  ADRs.

If rejected:

- Apply results remain inspectable only via existing audit metadata and manual
  on-disk inspection of the isolated directory.
- A narrower or different presentation slice may be proposed instead.

## Status / Next

PROPOSED — awaiting senior accept/reject. No implementation and no capability
are authorized by this document.

Next:

1. Senior review records an explicit accept or reject decision on this ADR.
2. If ACCEPTED, author `CLI-BRIDGE-v2.5-APPLY-RESULT-PRESENTATION-HANDOFF.md`
   (`EX-2.5-3`) with the allowed modification range, forbidden list, read-only
   endpoint/console design, redaction/caps, tests mapped to the prerequisites,
   verification commands, and a closeout checklist; then proceed in an `EX-*`
   batch and return to `REVIEW-*`. The execution agent may implement only the
   read-only presentation chain and MUST NOT add pre-apply baseline capture,
   diff, main-tree writes, `git`, commit/push/merge, or scheduler/model-triggered
   presentation.
3. If REJECTED, record the decision and rationale; no presentation endpoints are
   added.
