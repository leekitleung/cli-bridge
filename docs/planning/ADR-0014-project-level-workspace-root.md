# ADR-0014: Project-level Workspace Root Configuration (v2.9 planning)

Status: ACCEPTED

Date: 2026-06-13
Acceptance: Senior review passed (2026-06-13) after a bounded revision that
            fixed the `rootRef` boundary. Accepted with conditions on the
            `EX-2.9-1` implementation handoff (see "Acceptance Conditions").
            This authorizes only a server/operator-controlled `projectKey ->
            trusted workspace root` resolution for ADR-0010 baseline capture.
            It does NOT change the `rootRef`/manifest/console response surface,
            and does NOT authorize baseline preview, diff, raw content, hash
            exposure, main-tree writes, `git`/VCS, apply-from-preview, root
            editing UI, request-supplied roots, or persisted absolute roots.

## Context

The v2.5-v2.8 apply-result line now has a complete read-only inspection chain:

- ADR-0008: human-gated apply into a bridge-managed isolated scratch directory.
- ADR-0009: read-only manifest, file list, and redacted result preview.
- ADR-0010: metadata-only pre-apply baseline manifest capture.
- ADR-0011: metadata-only apply-result classification.
- ADR-0012 / ADR-0013: project-console presentation of classification and
  baseline summary.

Today, ADR-0010 baseline capture uses a runtime-level trusted root:
`createBridgeRuntime({ baselineRoot, baselineCaptureEnabled })`. That root is
server/operator supplied, never accepted from HTTP request bodies or query
strings, and never exposed as an absolute path in responses, audit, or console.

This has kept the boundary safe, but it is coarse once multiple projects exist.
`Project.workspaceApplyEnabled` is already project-scoped and default OFF, while
`baselineRoot` is runtime-scoped. If one bridge runtime serves more than one
project, there is no first-class way to bind project `alpha` to one trusted
workspace root and project `beta` to another. Future baseline preview or diff
ADRs would be harder to reason about without a stable project-root authority
model.

This ADR proposes the narrowest root-selection step: allow a project-scoped,
server/operator-controlled trusted workspace root mapping. It does not authorize
baseline preview, diff, raw content exposure, main-tree writes, VCS actions, or
request-supplied filesystem roots.

## Decision

### 0. Decision status

**ACCEPTED** (2026-06-13). Senior review passed after the bounded `rootRef`
boundary revision. This decision authorizes the scope in §1-§6 and the
"Acceptance Conditions" only. No code may be written until the `EX-2.9-1`
implementation handoff is created; implementation proceeds in an `EX-*` batch
and returns to a `REVIEW-2.9-1` batch for closeout.

### 1. Whether project-level workspace roots are allowed

**Proposed decision**: PERMIT, but only as a server/operator-controlled mapping
from validated project key to trusted workspace root, used by baseline capture
as an alternative to the existing runtime-wide root.

The bridge MAY support:

```text
createBridgeRuntime({
  projectWorkspaceRoots: {
    "alpha": "H:/work/alpha",
    "beta": "H:/work/beta"
  }
})
```

or an equivalent server-side configuration object. The exact implementation
shape belongs in the implementation handoff, but the source of truth must be
runtime/server configuration, not untrusted HTTP input.

The bridge MUST NOT:

- accept `workspaceRoot`, `baselineRoot`, `cwd`, or any filesystem root from
  project create/PATCH bodies, apply request bodies, query strings, model
  output, artifact data, or console input;
- expose absolute host paths in API responses, audit metadata, manifests,
  summaries, or console output;
- persist absolute roots in the JSON snapshot unless a later ADR explicitly
  accepts that storage boundary;
- read arbitrary project files outside the ADR-0010 proposed-file baseline
  capture path;
- add baseline preview, diff, line-level detail, hash exposure, main-tree write,
  git/VCS actions, apply-from-preview, scheduler/model-triggered work, or any
  new mutation.

### 2. Scope

In scope for a future accepted implementation:

- Runtime/server configuration for `projectKey -> trusted root`.
- Project-key validation using the existing `validateProjectKey()` rules.
- Root normalization and containment checks before use.
- Baseline capture root resolution order:

```text
projectWorkspaceRoots[projectKey] if configured
else existing runtime baselineRoot if configured
else no trusted root
```

- Preserve `baselineCaptureEnabled` as a separate default-OFF opt-in.
- Preserve `workspaceApplyEnabled` as the project-level apply opt-in.
- Preserve `rootRef` as the existing opaque constant
  `"runtime-baseline-root"` in v2.9. Project-scoped `rootRef` naming is
  deferred to a separate ADR.
- Tests proving request bodies cannot set or override roots.
- Tests proving absolute roots do not appear in responses, audit, snapshots, or
  console output.
- Contract and changelog updates.

Out of scope:

- Project PATCH/POST accepting a filesystem root.
- Console UI for selecting or editing roots.
- Snapshot persistence of absolute roots.
- Any change to `rootRef` value/format or to the manifest/console response
  surface.
- Baseline preview endpoint or UI.
- Per-file baseline entries in responses or console.
- Returning or displaying `sha256`.
- Raw baseline/result content beyond the existing redacted result preview.
- Textual diff, diff-like output, or line-level detail.
- Main-tree writes.
- `git`, worktree, branch, commit, push, merge, PR, merge queue.
- Apply-from-preview, promote, scheduler/model-triggered work.

### 3. Root authority model

The root authority must be one-way and server-controlled:

```text
operator config -> runtime root registry -> baseline capture
```

No HTTP route may mutate or override that registry in this ADR. This is stricter
than normal project metadata because absolute filesystem paths are more
sensitive than labels or booleans.

Project records may expose only a non-sensitive capability summary, if needed,
such as:

```json
{
  "workspaceRootConfigured": true
}
```

Those fields are optional and must be carefully reviewed in the implementation
handoff. They must not be accepted from create/PATCH bodies unless the ADR is
revised and accepted with a stronger persistence and authorization story. This
v2.9 ADR does not authorize any new root reference format in project records,
apply manifests, audit metadata, or console output.

### 4. Interaction with ADR-0010 baseline capture

This ADR does not change what ADR-0010 captures. It only changes how the trusted
root may be selected.

ADR-0010 invariants remain:

- capture occurs only inside the existing human-confirmed apply flow;
- capture reads only `proposedFiles[]`;
- capture is metadata-only: path, exists/readable, size, sha256, error kind;
- capture fails closed on containment escape, cap exceed, unreadable required
  file, non-regular file, or missing required trusted root;
- missing proposed files are represented as `exists:false`;
- raw baseline content is never stored or returned.

An implementation may need to pass `projectKey` into the baseline root resolver
or apply store. That is an internal routing detail, not a new user capability.

### 5. ADR-0007 prerequisites

| Prerequisite | ADR-0014 position |
|---|---|
| Reversibility | No write capability is added. Root mapping affects only read-only baseline metadata capture before isolated apply. |
| Containment | Roots are normalized server-side; reads remain confined to proposed paths under the selected trusted root. |
| Human authority preserved | Root selection does not trigger apply; capture still occurs only during existing human-confirmed apply. |
| No autonomy | No scheduler, daemon, model loop, or background root discovery. |
| Audit completeness | Audit may include opaque rootRef only; never absolute root. |
| Fail-closed | Missing project root when capture is required, invalid project key, invalid root config, or containment ambiguity aborts before write. |
| Opt-in and revocable | `workspaceApplyEnabled` and `baselineCaptureEnabled` remain default OFF / independently revocable. |

### 6. Boundary and invariants

This ADR does not weaken prior invariants.

| Invariant | ADR-0014 position |
|---|---|
| Runtime/server root authority | Preserved; project roots are configured by the operator, not by request input. |
| No absolute path exposure | Preserved; existing rootRef format remains unchanged and responses/audit/console must not leak roots. |
| No raw content persistence | Preserved; root mapping does not authorize content persistence. |
| No diff / line-level detail | Preserved. |
| No main-tree write | Preserved; root may be read for baseline metadata only. |
| No `git` / VCS | Preserved. |
| No apply-from-preview / promote | Preserved. |
| Existing apply-result APIs | Backward compatible; no manifest or console response-surface change in v2.9. |

## Alternatives Considered

### A. Keep only runtime-wide `baselineRoot`

Safest and already implemented, but weak for multi-project use. It forces every
project to share the same root and makes future baseline/diff planning
ambiguous. This remains a valid fallback but does not solve the project-scope
gap.

### B. Allow project PATCH to store `workspaceRoot`

Convenient, but too broad for the current boundary. It would persist absolute
host paths, expose a new mutation surface, and require a stronger authorization
and redaction model. This ADR rejects that approach for v2.9.

### C. Server/operator-controlled project root registry

Recommended. It keeps root authority outside untrusted HTTP input, supports
multi-project baseline capture, and preserves the no-absolute-path response
boundary. It is the smallest useful step.

## Risk Acceptance

- **Absolute path leakage**: project roots are sensitive host details.
  Mitigation: never return, audit, persist, or render absolute roots; keep the
  existing opaque rootRef surface unchanged in v2.9.
- **Wrong-root capture**: a misconfigured mapping could compare against the
  wrong workspace. Mitigation: explicit project-key mapping, fail-closed
  validation, tests for project isolation, and clear operator configuration.
- **Configuration drift**: runtime-only roots may not survive restart unless
  configured consistently by the operator. Mitigation: document that root
  mapping is server config, not snapshot state, unless a future ADR changes it.
- **Scope creep toward preview/diff**: root selection makes richer inspection
  easier to request. Mitigation: this ADR explicitly authorizes only metadata
  baseline capture root selection.

## Consequences

If accepted and implemented, CLI Bridge can choose the correct trusted baseline
root per project while keeping the existing read-only/no-absolute-path boundary.
This would make future baseline preview or diff ADRs easier to evaluate, but it
does not authorize those features.

If rejected, baseline capture remains runtime-wide. Multi-project bridge
instances must either share one baseline root or disable baseline capture where
that is unsafe.

## Acceptance Conditions

An `EX-2.9-1` handoff and closeout review MUST verify all of the following:

1. **Server-controlled only**: project root mapping is supplied only via runtime
   or server/operator configuration. No HTTP request body/query/console/model/
   artifact field can set or override it.
2. **Project-key validation**: mapping keys use existing `validateProjectKey()`
   semantics; invalid keys fail closed at startup or runtime construction.
3. **Root normalization and containment**: configured roots are resolved
   server-side; baseline reads remain contained under the selected root.
4. **Resolution order fixed**: project-specific root wins when configured;
   otherwise existing runtime `baselineRoot` behavior remains backward
   compatible; otherwise capture has no trusted root and fails closed when
   required.
5. **No absolute path exposure / no response-surface change**: API responses,
   manifests, audit metadata, snapshots, docs examples for responses, and
   console output never contain absolute host paths. v2.9 MUST NOT change
   `ApplyManifest.baselineManifest` field values/shape or project-console
   output; the existing `"runtime-baseline-root"` rootRef surface remains valid.
6. **No snapshot persistence of roots**: absolute roots are not written to the
   JSON snapshot in this slice.
7. **No project PATCH/root mutation**: `POST /bridge/projects` and
   `PATCH /bridge/projects/:key` reject or ignore `workspaceRoot`,
   `baselineRoot`, `cwd`, and equivalent root fields; tests must prove this.
8. **Baseline metadata and presentation semantics unchanged**: no raw baseline
   content, no baseline preview, no diff, no line-level detail, no sha256
   response exposure, no main-tree write, no ADR-0010 capture relaxation, and
   no manifest/console surface change.
9. **Project isolation**: a project with a configured root uses its own root and
   cannot read another project's root through apply requests or team ids.
10. **Backward compatibility**: existing apply, baseline, classification,
    presentation, console, project, and persistence tests continue to pass with
    no project root registry configured.
11. **Docs and changelog**: contract docs explain the root authority model,
    response redaction, non-goals, and configuration limits without implying
    preview/diff/write capability.

## Status / Next

ACCEPTED (2026-06-13). Proceed to the implementation handoff.

Next:

1. Author `CLI-BRIDGE-v2.9-PROJECT-WORKSPACE-ROOT-HANDOFF.md` for `EX-2.9-1`.
2. Keep implementation bounded to runtime/server project root resolution,
   baseline capture integration, tests, docs, and changelog.
3. Baseline preview, raw content, diff/diff-like views, hash exposure,
   main-tree writes, `git`/VCS, apply-from-preview, root editing UI, persisted
   absolute roots, and any `rootRef`/manifest/console response-surface change
   remain deferred and require separate ADRs.
