# ADR-0010: Pre-apply Baseline Manifest Capture (v2.5 follow-up)

Status: ACCEPTED

Date: 2026-06-12
Acceptance: Senior review passed (2026-06-12), accepted with conditions on the
            `EX-2.5-5` implementation handoff (see "Acceptance Conditions"
            below). This authorizes metadata-only pre-apply baseline manifest
            capture for proposed file paths from a server-controlled trusted
            root, default OFF, fail-closed before any isolated apply write, with
            no raw baseline content, no diff/classification, no main-tree write,
            no `git`/VCS, no spawn, no apply-from-preview, no parallelism, and
            no autonomy. No implementation is authorized until the handoff is
            created.

## Context

ADR-0008 authorized human-gated apply into a bridge-managed isolated scratch
directory. ADR-0009 authorized a strictly read-only presentation layer over the
resulting isolated apply output: manifest, file list, and size-capped redacted
preview.

ADR-0009 deliberately did not authorize pre-apply baseline capture, diff views,
or new/modified/unchanged classification. That boundary was necessary because
the implemented `WorkspaceApplyStore.ApplyRequest` records only:

```text
applyId, projectKey, teamId, slotId, planStepId, proposedFiles[],
isolatedDirId, isolatedDirPath, status, caps, actor, createdAt,
confirmedAt, fileCount, byteTotal
```

plus the applied output files in the isolated directory. It does not record what
the user's workspace looked like before apply. Without a baseline, the bridge
cannot truthfully compute changed-vs-unchanged classification or any diff.

This ADR proposes the smallest next step: capture a **pre-apply baseline
manifest** for the artifact's proposed file paths before writing the isolated
apply result. The manifest is metadata-only: path, existence, readable status,
size, and content hash. It does not persist raw baseline content and does not
authorize a diff view.

## Decision

### 1. Whether baseline manifest capture is allowed

**Decision**: PERMIT, but only as metadata-only, opt-in, read-only
capture of the proposed file paths before an ADR-0008 apply write.

The bridge MAY capture a pre-apply baseline manifest when all of the following
are true:

- workspace apply is enabled for the project;
- a separate baseline capture opt-in is enabled for the project or runtime;
- a trusted workspace root has been configured by the server/operator, not by an
  arbitrary request body;
- the apply request is still pending and the human is explicitly confirming the
  apply;
- every captured path is in the artifact's `proposedFiles[]` and passes the same
  path containment checks used by apply.

The bridge MUST NOT:

- store raw baseline file content;
- return the trusted workspace root or absolute host paths in API responses;
- capture files outside `proposedFiles[]`;
- infer or capture a baseline after the isolated apply write has occurred;
- use `git`, spawn a process, or perform any VCS action;
- write to the user's main working tree.

### 2. Scope

In scope:

- A baseline manifest attached to an `ApplyRequest`, captured immediately before
  the isolated apply write.
- Manifest entries for each proposed file:

```text
path, exists, readable, size?, sha256?, errorKind?
```

- A capture summary:

```text
capturedAt, fileCount, readableCount, missingCount, unreadableCount,
byteTotal, rootRef
```

`rootRef` is an opaque label or id. It is not an absolute path.

- Fail-closed path containment: invalid, absolute, traversal, drive-letter, UNC,
  or backslash-escaping paths abort capture and apply.
- Caps on number of files and total baseline bytes read. Cap exceed aborts
  capture and apply before any isolated-directory write.
- Typed audit metadata describing capture status, counts, caps, and failure
  kind, with no raw content and no absolute host paths.
- Contract docs and tests for the capture boundary.

Deferred and not authorized by this ADR:

- Persisting raw baseline content.
- Returning baseline content or a baseline preview.
- Diff or diff-like views.
- New/modified/unchanged classification in API or console.
- Applying from a diff or preview.
- Main-tree writes, `git` worktree, `git diff`, `git apply`, commit, push,
  merge, PR, merge queue, parallel apply, scheduler/model-triggered apply.

### 3. Baseline root source

The initial implementation MUST NOT accept an arbitrary `baselineRoot`, `cwd`,
or filesystem root from an HTTP request body.

A future `EX-*` handoff may choose one of these server-controlled sources:

1. A runtime option such as `createBridgeRuntime({ baselineRoot })`, default
   absent.
2. A per-project workspace root configured through a separate accepted ADR.

For this ADR's first implementation, the recommended shape is a runtime option
with default OFF/absent. If no trusted root is configured, baseline capture is
unavailable and apply must either proceed without baseline only if the baseline
feature is disabled, or fail closed if baseline capture was required.

Execution agents must not invent a broader root-selection mechanism.

### 4. ADR-0007 prerequisites

| Prerequisite | This slice |
|---|---|
| Reversibility | Baseline capture writes only metadata attached to the apply record; no main-tree mutation. Isolated apply discard remains unchanged. |
| Containment | Reads are confined to a trusted configured root and only to contained `proposedFiles[]` paths. |
| Human authority preserved | Capture occurs only as part of the existing per-apply human confirmation path. |
| No autonomy | No scheduler, daemon, model loop, or background process may trigger capture. |
| Audit completeness | Capture request/result audit uses typed metadata: applyId, counts, caps, status, failure kind, actor. No raw content or absolute root. |
| Fail-closed | Path escape, unreadable required file policy, cap exceed, missing trusted root, or ambiguous state aborts before any write. |
| Opt-in and revocable | Baseline capture is default OFF and independently revocable from the existing workspace apply opt-in. |

### 5. Boundary and invariants

This ADR does not weaken any prior invariant.

| Invariant | ADR-0010 position |
|---|---|
| Plan approval before execution | Unchanged. |
| Per-step and per-apply gates | Unchanged; capture happens only inside the human-confirmed apply flow. |
| Step ceiling hard 10 | Unchanged. |
| Sequential / concurrency 1 | Unchanged. |
| Apply target = isolated directory only | Unchanged; no main-tree write. |
| Read-only presentation boundary | Unchanged; no diff/classification is authorized here. |
| No raw content persistence | Preserved for baseline content; only size/hash/existence metadata may persist. |
| No shell/exec/run/command endpoint | Unchanged. |
| No `git` / VCS action | Unchanged. |
| No auto-apply/commit/push/merge | Unchanged. |

### 6. Risk acceptance

- **Sensitive content inference through hashes**: hashes are less sensitive than
  raw content but can still reveal equality across files. Mitigation: capture
  only proposed files, never expose absolute paths, audit access, and keep the
  manifest scoped to the apply result.
- **Root confusion**: reading from the wrong workspace root would make the
  baseline misleading. Mitigation: root must be server-controlled and explicit;
  request-supplied roots are forbidden.
- **Resource cost**: hashing large files can be expensive. Mitigation: file and
  byte caps with fail-closed behavior.
- **Pressure to add diff**: baseline manifest makes future diff requests more
  likely. Mitigation: this ADR explicitly does not authorize raw baseline
  content or diff; those require a separate ADR.

## Consequences

If accepted and implemented, CLI Bridge would have a safe metadata baseline for
future read-only classification work. A later ADR could decide whether to expose
new/modified/unchanged classification by comparing baseline hashes with isolated
apply result hashes.

This ADR alone does not authorize any diff view and does not authorize storing
baseline content. If full textual diffs are desired later, a separate ADR must
decide whether baseline content can be stored, read on demand, or avoided.

## Acceptance Conditions

An implementation handoff and closeout review MUST verify all of the following:

1. **Trusted root only**: the first implementation uses a server/runtime-provided
   trusted root (for example `createBridgeRuntime({ baselineRoot })`) with
   default absent/OFF. It MUST NOT accept `baselineRoot`, `cwd`, or any filesystem
   root from HTTP request bodies, query strings, model output, or artifact data.
2. **Separate opt-in**: baseline capture has an independent default-OFF opt-in
   in addition to `workspaceApplyEnabled`. With baseline disabled, existing
   apply/presentation behavior remains compatible; with baseline required but no
   trusted root, confirm fails closed before any write.
3. **Metadata only**: persisted baseline entries contain only path, existence,
   readable status, size, SHA-256 hash for readable files, and error kind. No raw
   baseline content, absolute root path, API key, secret, or full file preview is
   persisted or returned.
4. **Path and root containment**: capture reads only `proposedFiles[]` paths and
   only under the trusted root. Traversal, absolute paths, drive letters, UNC,
   backslash escapes, symlink/root escape, or any resolved path outside the root
   abort capture and apply.
5. **Fail-closed before write**: invalid paths, cap exceed, missing trusted root
   when capture is required, and unreadable-file policy failures abort before any
   isolated apply write. Missing files are represented as `exists:false` and are
   not failures by themselves because they may be new files.
6. **Caps**: file count and total baseline bytes read are capped with tests for
   exceed paths. Cap exceed produces a clean 4xx and no write.
7. **Audit metadata**: baseline capture request/result events use typed
   `result.metadata` only; audit includes applyId, counts, caps, status, actor,
   rootRef, and failure kind, but no raw content or absolute host paths.
8. **No new presentation capability**: this slice may expose the stored baseline
   manifest only as metadata if needed for inspection, but MUST NOT expose diff,
   diff-like views, baseline previews, or new/modified/unchanged classification.
9. **No VCS / spawn / autonomy**: no `git`, `child_process`, spawn/exec, VCS
   operation, scheduler/model-triggered capture, or apply-from-preview is added.
10. **Backward compatibility**: existing apply and presentation tests continue to
    pass when baseline capture is disabled by default.

## Status / Next

ACCEPTED with the conditions above. No implementation is authorized until a
separate `EX-2.5-5` handoff is created.

Next:

1. Draft the `EX-2.5-5` implementation handoff fixing the trusted root source,
   opt-in flag shape, caps, schema, audit metadata, tests, and closeout
   checklist.
2. Execution agents must not implement beyond that handoff.
3. Diff/diff-like views, modified/unchanged/new classification, baseline content
   persistence, main-tree writes, `git`/VCS, and apply-from-preview remain
   deferred and require their own ADRs.
