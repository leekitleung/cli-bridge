# ADR-0015: Project-scoped Opaque `rootRef` Naming (v2.10)

Status: ACCEPTED

Date: 2026-06-13

Accepted: 2026-06-13

## Context

`ApplyManifest.baselineManifest.rootRef` is currently a single hardcoded opaque
constant, `"runtime-baseline-root"`. It is set in exactly one production point
and flows, unchanged, through every downstream surface:

- **Production**: `apps/local-server/src/storage/workspace-apply-store.ts`
  `captureBaseline()` sets `rootRef: 'runtime-baseline-root'`. This is the only
  writer.
- **Manifest projection**: `toApplyManifest()` copies `rootRef` into the
  read-only manifest summary (one of seven baseline summary fields).
- **Audit**: `apps/local-server/src/routes/bridge-api.ts` copies the same value
  into `workspace_apply_result.result.metadata.baseline.rootRef`.
- **Console**: `apps/local-server/src/routes/project-console.ts` renders
  `rootRef` as inert text, sanitizing absolute-looking values (drive letter,
  UNC, POSIX absolute, backslash-containing) to a `—` placeholder.
- **Tests asserting the literal**: `tests/workspace-apply.test.mjs` (store,
  audit metadata, manifest seven-key shape), and
  `tests/project-console-behavior.test.mjs` (fixture, opaque display, absolute
  sanitization, viewer-boundary test).

ADR-0014 introduced server/operator-controlled project workspace roots
(`projectWorkspaceRoots[projectKey] -> trusted root`) for baseline capture, with
resolution order `project root -> runtime baselineRoot -> fail-closed`. ADR-0014
deliberately **froze** the `rootRef` value/format and explicitly deferred
"project-scoped `rootRef` naming" to a separate ADR. This is that ADR.

Today, even when a project-specific root is used, `rootRef` is still the generic
`"runtime-baseline-root"`. An operator inspecting two projects on one bridge
runtime cannot tell from the manifest/audit whether baseline capture used a
project-specific root or the runtime-wide fallback. A project-scoped opaque
reference (for example `project-root:<projectKey>`) would carry that distinction
without exposing any absolute host path.

This ADR proposes the narrowest possible unfreeze: allow `rootRef` to become a
project-scoped **opaque** value, and nothing else. It does not authorize
absolute-path exposure, baseline entries, `sha256`, raw content, diff, a new
endpoint, new console capability, root editing UI, root persistence, or any
write/VCS action.

## Decision

### 0. Decision status

**ACCEPTED**. Explicit review acceptance authorizes the narrow v2.10
`rootRef` value/format change described below. The retroactive execution
handoff is recorded in
`CLI-BRIDGE-v2.10-PROJECT-SCOPED-ROOTREF-HANDOFF.md`.

### 1. Whether project-scoped `rootRef` naming is allowed

**Decision**: PERMIT `rootRef` to change from the single constant
`"runtime-baseline-root"` to a project-scoped **opaque reference** computed
server-side, on the explicit condition that it never contains or encodes an
absolute host path.

Recommended scheme:

- When baseline capture resolves a **project-specific** root
  (`projectWorkspaceRoots[projectKey]`), `rootRef` becomes
  `"project-root:<projectKey>"`, where `<projectKey>` is the already-validated,
  non-sensitive project key (the same value present in the request URL path).
- When baseline capture resolves the **runtime-wide fallback** (`baselineRoot`),
  `rootRef` remains `"runtime-baseline-root"`. Keeping a distinct value honestly
  reflects that no project-specific root was used and avoids implying a
  per-project root that does not exist.

The bridge MUST NOT:

- put an absolute host path, drive letter, UNC path, or any normalized
  filesystem path into `rootRef`;
- derive `rootRef` from the resolved absolute root string (it must be derived
  from `projectKey`, not from the path);
- expose `baselineManifest.entries`, `sha256`, raw baseline content, diff, or
  line-level detail (unchanged from prior ADRs);
- add a new endpoint or new console capability;
- add root editing UI or project-record root input;
- persist absolute roots to the snapshot;
- introduce apply-from-preview, promote, write, `git`/VCS, spawn, or
  scheduler/model-triggered work.

### 2. Scope

In scope for the accepted implementation:

- Change the single production point so `rootRef` is computed from the
  resolution outcome: project key for a project-specific root, constant for the
  runtime fallback.
- Keep `rootRef` opaque and derived from `projectKey` (never from the path).
- Update the contract doc to describe the new `rootRef` value semantics and the
  fallback value.
- Update the audit and manifest expectations and their tests for the new value.
- Update console boundary tests so the existing absolute-path sanitizer is
  proven to leave a legitimate `project-root:<key>` value intact while still
  sanitizing true absolute paths.
- Update CHANGELOG.

Out of scope (unchanged freezes):

- Absolute host path exposure anywhere.
- `baselineManifest.entries`, `sha256`, raw baseline/result content.
- Baseline preview endpoint or UI.
- Textual diff, diff-like output, or line-level detail.
- New backend endpoint or new console capability beyond rendering the opaque
  string.
- Root editing UI, project-record root fields, request-supplied roots.
- Snapshot persistence of absolute roots.
- Main-tree writes, `git`/VCS, apply-from-preview, promote, scheduler/model
  work.
- Manifest shape changes other than the **value** of the existing `rootRef`
  field (the seven-field set stays the same).

### 3. Surface-change boundary (the only unfreeze)

This ADR unfreezes exactly one thing that ADR-0014 froze: the **value/format of
`rootRef`**. It does not change:

- the `ApplyManifest.baselineManifest` field set (still seven fields);
- response shapes or HTTP status semantics;
- console rendering capability (it still renders one opaque inert string with
  the existing sanitizer);
- baseline capture semantics (ADR-0010) — only the label attached to the result
  changes.

Because `rootRef` is consumed by manifest, audit, and console, the
implementation must update all three consistently in one slice.

### 4. Migration and compatibility

- **Old manifests / audit events**: any value captured before this change
  remains `"runtime-baseline-root"`. Persisted audit history is not rewritten.
  Consumers must treat `rootRef` as an opaque string and not assume a fixed
  literal.
- **New captures**: a project-specific root yields `project-root:<projectKey>`;
  the runtime fallback yields `"runtime-baseline-root"`.
- **Console**: must render any opaque value. The existing sanitizer must be
  reviewed so `project-root:<projectKey>` is not falsely treated as an absolute
  path. `validateProjectKey()` already forbids slashes, spaces, and control
  characters, so a project key cannot smuggle a path separator, but the
  acceptance conditions require an explicit test.
- **Tests**: the existing assertions that pin `rootRef === 'runtime-baseline-root'`
  for project-specific captures must be updated to the new value; fallback-path
  assertions keep the constant.

### 5. ADR-0007 prerequisites

| Prerequisite | ADR-0015 position |
|---|---|
| Reversibility | No write capability added; only a read-only label value changes. |
| Containment | `rootRef` is derived from `projectKey`, not from any filesystem path; no new filesystem access. |
| Human authority preserved | Naming change never triggers apply, promote, or write. |
| No autonomy | No scheduler/daemon/model loop; value is computed during the existing human-confirmed capture. |
| Audit completeness | Audit continues to carry only an opaque `rootRef`; still never an absolute path. |
| Fail-closed | If a project key were ever unavailable at capture time, fall back to the runtime constant rather than emit a path. |
| Opt-in and revocable | `workspaceApplyEnabled` / `baselineCaptureEnabled` remain default OFF / independently revocable. |

### 6. Boundary and invariants

| Invariant | ADR-0015 position |
|---|---|
| No absolute path exposure | Preserved; `rootRef` stays opaque and is derived from `projectKey` only. |
| No raw content / entries / sha256 | Preserved; unchanged. |
| No diff / line-level detail | Preserved. |
| No new endpoint / console capability | Preserved; console still renders one inert opaque string. |
| No root editing UI / request roots | Preserved. |
| No snapshot persistence of roots | Preserved. |
| No main-tree write / git / apply-from-preview | Preserved. |
| Manifest field set | Preserved; only the `rootRef` value/format changes. |

## Alternatives Considered

### A. Keep `rootRef` as the single constant (status quo)

Safest and already implemented. But it loses the project/runtime distinction and
leaves ADR-0014's deferred item open. Valid fallback if review prefers to keep
the value frozen.

### B. `project-root:<projectKey>` for project roots, constant for fallback

Recommended. Opaque, derived from already-public `projectKey`, no path content,
honestly distinguishes project vs runtime resolution. Smallest useful change.

### C. Opaque hash of the project key (for example `project-root:<hash>`)

Hides the project key, but the project key is already public in the URL, so the
hash adds indirection without a real confidentiality gain and makes debugging
harder. Not recommended.

### D. Namespace the fallback too (for example `runtime-root`)

Renaming the fallback constant churns more existing tests/manifests for no
boundary benefit. Keep `"runtime-baseline-root"` for backward familiarity.

## Risk Acceptance

- **Project key in `rootRef`**: the project key is already exposed in request
  URLs and is validated to exclude separators/control characters. Mitigation:
  derive `rootRef` from `projectKey` only, never from the path; rely on existing
  `validateProjectKey()` rules; test that no path content can appear.
- **Console false-sanitization**: a legitimate `project-root:<key>` could be
  mis-flagged by the absolute-path sanitizer. Mitigation: acceptance condition
  requires a test proving the opaque value renders intact while true absolute
  paths are still sanitized.
- **Consumer assumptions on the literal**: external readers may have assumed a
  fixed `"runtime-baseline-root"`. Mitigation: document `rootRef` as opaque and
  not a stable literal; update contract.
- **Scope creep to path exposure**: project-scoping could invite "show the real
  root." Mitigation: this ADR forbids any path-derived or absolute value and
  defers preview/diff to separate ADRs.

## Consequences

If accepted and implemented, manifest and audit consumers can distinguish a
project-specific baseline capture from the runtime-wide fallback via an opaque
project-scoped reference, with no new path exposure and no new capability. The
console continues to render a single inert string.

If rejected, `rootRef` remains the single constant; the project/runtime
distinction stays invisible and ADR-0014's deferred item stays open.

## Acceptance Conditions

An `EX-2.10-1` handoff and closeout review MUST verify all of the following:

1. **Opaque only**: `rootRef` never contains an absolute host path, drive
   letter, UNC path, POSIX absolute path, backslash, or any normalized
   filesystem path; it is derived from `projectKey`, not from the resolved root
   string.
2. **Project-scoped value**: a project-specific root yields
   `project-root:<projectKey>`; the runtime fallback yields
   `"runtime-baseline-root"`.
3. **Single production point**: the value is set in the existing
   `captureBaseline` path; no new endpoint, store capability, or schema field is
   added.
4. **Manifest field set unchanged**: `ApplyManifest.baselineManifest` still
   exposes exactly the seven existing fields; only the `rootRef` value/format
   changes.
5. **Audit consistency**: audit `metadata.baseline.rootRef` matches the manifest
   value and still contains no absolute path.
6. **Console renders opaque value intact**: the existing absolute-path sanitizer
   leaves `project-root:<projectKey>` intact while still sanitizing true
   absolute-looking values to the placeholder; a test proves both.
7. **No forbidden disclosure**: no `entries`, `sha256`, raw content, diff, or
   line-level detail appears anywhere as a result of this change.
8. **No new capability**: no new endpoint, no console capability beyond
   rendering the string, no root editing UI, no project-record root field, no
   request-supplied root, no snapshot persistence of roots.
9. **No write/VCS**: no main-tree write, `git`/spawn/VCS, apply-from-preview,
   promote, or scheduler/model-triggered work.
10. **Migration documented**: contract documents `rootRef` as opaque and not a
    fixed literal; old persisted values remain valid and are not rewritten.
11. **Tests updated, not weakened**: assertions pinning the old literal for
    project-specific captures are updated to the new value; fallback assertions
    keep the constant; project-isolation and no-absolute-path coverage remain.
12. **Backward compatibility**: existing apply, baseline, classification,
    presentation, console, project, and persistence tests continue to pass.

## Status / Next

ACCEPTED. The v2.10 implementation is bounded by the retroactive
`CLI-BRIDGE-v2.10-PROJECT-SCOPED-ROOTREF-HANDOFF.md` closeout record.

Baseline preview, raw content, diff/diff-like views, `sha256` exposure, root
editing UI, project-record root fields, snapshot persistence of roots,
main-tree writes, `git`/VCS, and apply-from-preview remain deferred and each
require a separate ADR.
