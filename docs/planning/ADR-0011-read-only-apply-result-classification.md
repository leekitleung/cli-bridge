# ADR-0011: Read-only Apply-result File Classification (metadata-only, v2.6)

Status: ACCEPTED

Date: 2026-06-12
Acceptance: Senior review passed (2026-06-12), accepted with conditions on the
            `EX-2.6-1` implementation handoff (see "Acceptance Conditions"
            below). This authorizes a strictly read-only, metadata-only per-file
            classification for an applied request, derived from the persisted
            ADR-0010 baseline metadata and an in-process hash of the isolated
            apply result. No raw content, no `sha256` in responses, no textual
            diff, no main-tree read/write, no `git`/spawn/VCS, no
            apply-from-preview. No implementation is authorized until the
            `EX-2.6-1` handoff is created.

Revision: 2026-06-12 (RP-2.6 revise, pre-acceptance). Fixed two product/API
semantics at the ADR level so they are not left to the execution batch:
(1) when no baseline manifest exists for the request, the endpoint fails closed
with `409` (request-level), not a per-file placeholder label; (2) the closed
classification enum is narrowed to `new | modified | unchanged |
unreadable-baseline` (the former `missing-baseline` per-file label is removed —
the no-baseline case is the request-level `409`). `unreadable-baseline` is
retained as a defensive/forward-compatible label but is normally unreachable
under ADR-0010's fail-closed capture, and the execution batch MUST NOT relax
ADR-0010 capture behavior to make it reachable.

## Context

The v2.5 line established, in sequence:

- ADR-0008: human-gated apply into a bridge-managed isolated scratch directory
  (never the main tree), opt-in, reversible, no VCS, no autonomy.
- ADR-0009: strictly read-only presentation over the isolated apply result —
  manifest, file list (`{path,size}`, no classification), and size-capped,
  redacted per-file preview.
- ADR-0010: metadata-only pre-apply baseline manifest capture before the apply
  write. `ApplyRequest.baselineManifest` records per-file
  `{ path, exists, readable, size?, sha256?, errorKind? }` plus a summary. No
  raw baseline content is stored; no diff and no classification were authorized.

ADR-0009 deliberately deferred new/modified/unchanged classification because no
baseline existed. ADR-0010 captured a baseline but explicitly did **not**
authorize classification or diff. The data needed to classify now exists:

- baseline per-file `sha256` (for readable files) is already persisted in
  `baselineManifest.entries`;
- the isolated apply result files are already readable via the ADR-0009 read-only
  path (`listAppliedFiles`), and a result-side `sha256` can be computed in-process
  from the isolated directory (never the main tree).

This ADR proposes the smallest next step: a **strictly read-only, metadata-only
file classification** for an applied request, derived purely by comparing the
existing baseline metadata against the isolated apply result. It returns a
coarse per-file label only. It does **not** persist raw baseline content, does
**not** return any `sha256`, does **not** produce a textual diff, and does
**not** introduce any write/VCS/autonomy capability.

## Decision

### 0. Decision status

**ACCEPTED** (2026-06-12, senior review, with the Acceptance Conditions below).
No implementation is authorized until the `EX-2.6-1` handoff
(`CLI-BRIDGE-v2.6-APPLY-RESULT-CLASSIFICATION-HANDOFF.md`) is created and
satisfies every Acceptance Condition.

### 1. Whether read-only classification is allowed

**Proposed decision**: PERMIT, strictly read-only and metadata-only, computed
from (a) the already-persisted ADR-0010 baseline manifest entries and (b) an
in-process hash of the existing isolated apply result files, exposing only a
coarse per-file classification label.

The bridge MAY, for an `applied` request that has a captured baseline, return a
per-file classification. The bridge MUST NOT:

- persist or return raw baseline or result file content;
- return any `sha256` (baseline or result) in the classification response;
- produce a textual or structural diff / diff-like output;
- read or write the user's main working tree (result hashing reads only the
  bridge-managed isolated directory; baseline hashes are already persisted);
- use `git`, spawn a process, or perform any VCS action;
- add any apply/promote/"apply from preview" affordance.

### 2. Scope

In scope:

- One read-only endpoint, e.g.
  `GET /bridge/projects/:key/teams/:teamId/apply-requests/:applyId/classification`,
  returning `{ files: [{ path, size, classification }], summary }`.
- `classification` is a closed enum of metadata-only labels:
  - `new` — baseline entry has `exists:false` (`errorKind:'missing'`) and the
    isolated result contains the file.
  - `modified` — baseline entry is readable with a `sha256`, the result file
    exists, and the result hash differs from the baseline hash.
  - `unchanged` — baseline readable `sha256` equals the result hash.
  - `unreadable-baseline` — baseline entry exists but is marked unreadable.
    Reserved/defensive: under ADR-0010's current fail-closed capture an
    unreadable existing file aborts apply, so this label is normally unreachable
    on an `applied` request. It is kept explicit for completeness and future
    capture semantics; the execution batch MUST NOT relax ADR-0010 capture to
    make it reachable.
- The request-level "no baseline captured" case is NOT a per-file label; it is a
  request-level `409` (see §3). `missing-baseline` is intentionally excluded from
  the per-file enum.
- A summary of counts per classification label.
- Result-side hashing is computed in-process over the isolated directory only,
  reusing the ADR-0009 containment, and is never returned.
- Contract docs and tests.

Deferred and NOT authorized by this ADR:

- Persisting or returning raw baseline/result content.
- Returning any `sha256` value.
- Textual or structural diff / diff-like views.
- Line-level change detail.
- Any classification that requires reading the user's main working tree at
  request time.
- Main-tree writes, `git` worktree/diff/apply, commit/push/merge/PR/merge queue,
  parallel apply, scheduler/model-triggered work, apply-from-preview.

### 3. Inputs and computation boundary

- **Baseline side**: read only from `ApplyRequest.baselineManifest.entries`
  (already persisted metadata: existence + `sha256` for readable files). No
  re-read of the trusted baseline root is required or authorized by this ADR.
- **Result side**: read only from the bridge-managed isolated apply directory
  for the request (the same source ADR-0009 already reads), computing a SHA-256
  per result file in-process for the equality comparison.
- Classification compares the two hashes for equality only; neither hash is
  returned. No content is compared byte-by-byte in the response, and no diff is
  produced.
- **No-baseline behavior (fixed at ADR level)**: when the request has no captured
  baseline (`baselineManifest` absent — e.g. baseline capture was disabled at
  apply time), the endpoint MUST fail closed with `409` and a standard error such
  as `"Baseline manifest not captured for this apply request"`. It MUST NOT
  return a per-file classification list with placeholder labels. Rationale: the
  endpoint's semantics are "classify relative to the captured baseline"; with no
  baseline, returning a labelled file list would misrepresent a bare file list as
  a completed classification. This is decided here and is NOT an execution-batch
  decision.

### 4. ADR-0007 §2 prerequisites

| Prerequisite | This slice |
|---|---|
| Reversibility | No mutation; classification is a pure read over existing metadata + isolated result. |
| Containment | Reads only persisted baseline metadata and the isolated apply directory; same path containment as ADR-0009. Never the main tree. |
| Human authority preserved | Classification is a discrete human-initiated read; it triggers no apply or write. |
| No autonomy | No scheduler/daemon/model loop may drive classification. |
| Audit completeness | Optional read access events use typed metadata (applyId, counts, status); no content, no hashes, no absolute paths. |
| Fail-closed | Unknown/expired applyId, not-applied status, path escape, or missing isolated result aborts with a clean 4xx and no disclosure. |
| Opt-in and revocable | Bound to the existing `workspaceApplyEnabled` opt-in; with apply disabled the endpoint is inert. |

### 5. Boundary and invariants

This ADR does not weaken any prior invariant.

| Invariant | ADR-0011 position |
|---|---|
| Apply target = isolated directory only | Unchanged; no main-tree read/write. |
| Read-only presentation boundary | Extended only to a coarse metadata label; still no content, no diff, no hashes returned. |
| No raw content persistence | Unchanged; no baseline/result content is stored or returned. |
| No `sha256` exposure | New explicit invariant: hashes are used internally for equality only and never returned. |
| No diff / diff-like view | Unchanged; classification is a single enum label, not a diff. |
| No-baseline = request-level `409` | New: with no captured baseline the endpoint fails closed; no per-file placeholder labels. |
| No shell/exec/run/command, no `git`/VCS | Unchanged. |
| No auto-apply/commit/push/merge, no apply-from-preview | Unchanged. |
| Per-apply human gate (ADR-0008) | Unchanged; classification never triggers apply. |

## Risk acceptance

- **Inference from labels**: `modified`/`unchanged` reveals equality state per
  file. This is strictly less than a hash or content disclosure and is scoped to
  files the user already proposed and applied. Mitigation: labels only, no
  hashes, no content, opt-in, audited.
- **Result re-hashing cost**: hashing isolated result files repeatedly could be
  costly. Mitigation: reuse the existing apply caps as bounds; consider an
  in-process per-request memoization in the handoff; fail-closed on cap exceed.
- **Pressure toward textual diff**: a classification makes diff requests more
  likely. Mitigation: this ADR explicitly forbids diff and hash exposure; a
  textual diff requires a separate ADR (and likely baseline content persistence,
  which remains deferred).
- **Stale baseline semantics**: the baseline reflects pre-apply state at capture
  time; classification is only as truthful as that snapshot. Mitigation: clearly
  label the source and keep classification scoped to the request's own baseline.

## Consequences

If accepted, CLI Bridge gains a safe, coarse, read-only view of which proposed
files the apply result changed relative to the captured baseline, without any
content, hashes, or diff. A later ADR could decide whether to expose richer
detail (per-hunk diff, content), which would require revisiting the no-content /
no-hash invariants under fresh senior review.

If rejected, the baseline manifest remains an internal metadata artifact and
clients continue to use the existing manifest/file-list/preview endpoints.

## Acceptance Conditions

An `EX-2.6-1` handoff and closeout review MUST verify all of the following:

1. **Read-only**: classification performs no mutation of any `ApplyRequest`, no
   write/delete of any file; pure reads only.
2. **Metadata-only output**: the response contains only `path`, `size`, and a
   `classification` enum per file, plus count summary. No content, no `sha256`
   (baseline or result), no absolute host path appears in response or audit.
3. **No diff**: no textual/structural diff, diff-like output, or line-level
   change detail is produced or exposed.
4. **Closed enum**: `classification` is exactly one of
   `new | modified | unchanged | unreadable-baseline`. `missing-baseline` is NOT
   a per-file label; the no-baseline case is the request-level `409` (condition
   10).
5. **Containment**: result hashing reads only the bridge-managed isolated
   directory with the existing ADR-0009 containment; baseline data comes only
   from persisted `baselineManifest`. No main-tree read at request time.
6. **Fail-closed**: unknown/expired applyId → 404; status not `applied` → 409;
   path escape or cap exceed → clean 4xx; no partial/unsafe disclosure.
7. **Opt-in**: bound to `workspaceApplyEnabled` (default OFF); with apply
   disabled the endpoint is inert; non-apply flows unaffected.
8. **No new capability beyond classification**: no apply-from-preview, no
   promotion, no `git`/spawn/VCS, no main-tree write, no scheduler/model-triggered
   path, no project-level workspace root.
9. **Backward compatibility**: existing apply / presentation / baseline tests
   continue to pass; the new endpoint is additive.
10. **No-baseline behavior is request-level `409`**: a request without a captured
    baseline returns `409` with a standard error and NO per-file list; tested.
    This is fixed by this ADR, not chosen by the execution batch.
11. **No capture-relaxation for `unreadable-baseline`**: the execution batch MUST
    NOT change ADR-0010's fail-closed capture (unreadable/non-regular files still
    abort apply); `unreadable-baseline` remains a reserved/normally-unreachable
    label.

## Status / Next

ACCEPTED (2026-06-12, senior review, with the Acceptance Conditions above).

Next:

1. Author `CLI-BRIDGE-v2.6-APPLY-RESULT-CLASSIFICATION-HANDOFF.md` (`EX-2.6-1`)
   fixing the endpoint shape, result hashing/caps, audit metadata, tests mapped
   to the acceptance conditions, and a closeout checklist. The no-baseline
   behavior (`409`) and the closed enum are already fixed by this ADR and must
   not be re-decided by the execution batch.
2. Execution proceeds in an `EX-*` batch and returns to `REVIEW-2.6-1`.
3. Textual diff, hash exposure, raw baseline/result content persistence,
   main-tree reads/writes, `git`/VCS, and apply-from-preview remain deferred and
   require their own ADRs.
