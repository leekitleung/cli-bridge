# ADR-0013: Console Apply-result Baseline Summary Presentation (read-only, v2.8)

Status: ACCEPTED

Date: 2026-06-12
Acceptance: Senior review passed (2026-06-12), accepted with conditions on the
            `EX-2.8-1` implementation handoff (see "Acceptance Conditions"
            below). This authorizes a strictly read-only project-console
            presentation of the existing `ApplyManifest.baselineManifest`
            summary fields (`capturedAt`, counts, `byteTotal`, opaque
            `rootRef`) from the existing manifest GET response. No backend
            endpoint, no baseline entries, no `sha256`/raw content/baseline
            preview/diff display, no main-tree access, no `git`/spawn/VCS, no
            apply-from-preview, no write/promote controls, and no ADR-0010 /
            ADR-0011 semantic changes.

## Context

The v2.5-v2.7 apply-result line now exposes a strictly read-only inspection
chain:

- ADR-0009: read-only apply-result manifest, file list, and redacted preview.
- ADR-0010: metadata-only pre-apply baseline manifest capture.
- ADR-0011: metadata-only per-file classification endpoint.
- ADR-0012: console presentation of classification labels and summary.

ADR-0010 already allows `ApplyManifest.baselineManifest` to expose summary
metadata only: `capturedAt`, `fileCount`, `readableCount`, `missingCount`,
`unreadableCount`, `byteTotal`, and `rootRef`. The manifest projection does not
return per-file baseline entries, `sha256`, raw baseline content, or absolute
host paths.

The project console Apply Result panel currently shows the manifest, isolated
result files, preview, and classification labels. It does not yet surface the
already-safe baseline summary from the manifest response. Users can therefore
see classification labels without seeing the high-level baseline capture state
that explains whether a baseline was captured and how many proposed files were
readable, missing, or unavailable at capture time.

This ADR proposes the smallest UI follow-up: display the existing
`baselineManifest` summary from the existing manifest GET response. It does not
authorize a baseline viewer, baseline preview, per-file baseline entries, hash
display, diff, main-tree access, or backend changes.

## Decision

### 0. Decision status

**ACCEPTED** (2026-06-12, senior review, with the Acceptance Conditions below).
No implementation is authorized until the `EX-2.8-1` handoff
(`CLI-BRIDGE-v2.8-CONSOLE-BASELINE-SUMMARY-HANDOFF.md`) is created and
satisfies every Acceptance Condition.

### 1. Whether console baseline summary presentation is allowed

**Decision**: PERMIT, but only as a strictly read-only project-console
presentation of the summary already present in the existing apply manifest
response.

The console MAY display these fields from `ApplyManifest.baselineManifest` when
present:

- `capturedAt`
- `fileCount`
- `readableCount`
- `missingCount`
- `unreadableCount`
- `byteTotal`
- `rootRef`

The console MAY render an inert "baseline not captured" or "baseline summary
unavailable" state when `baselineManifest` is absent.

The console MUST NOT:

- call a new backend endpoint for baseline data;
- display `baselineManifest.entries`;
- display or infer any `sha256`;
- display raw baseline content or a baseline preview;
- produce textual diff, diff-like output, or line-level detail;
- read the user's main tree;
- expose an absolute host path or trusted root;
- add apply/promote/commit/write/discard controls;
- call `POST`, `PATCH`, `PUT`, or `DELETE` from the Apply Result viewer;
- change ADR-0010 baseline capture or ADR-0011 classification semantics.

### 2. Scope

In scope:

- Update the existing project console Apply Result panel in the teams view.
- Use only the existing manifest GET response already fetched by the panel.
- Render a compact baseline summary when `baselineManifest` is present.
- Render an inert unavailable/not-captured state when `baselineManifest` is
  absent.
- Keep manifest, files, preview, and classification behavior unchanged.
- Add project-console static and behavior tests proving the boundary.
- Update CHANGELOG and contract docs only as needed for console presentation.

Out of scope:

- New backend routes or response fields.
- Baseline preview endpoint or UI.
- Per-file baseline entry display.
- Returning or displaying `sha256`.
- Raw baseline/result content beyond the existing redacted result preview.
- Textual/structural diff, diff-like view, or line-level detail.
- Main-tree reads/writes.
- `git`, worktree, diff/apply, commit, push, merge, PR, merge queue.
- Apply-from-preview, promote, scheduler/model-triggered work.
- Project-level workspace root configuration.

### 3. UI behavior

The Apply Result panel should remain a thin, read-only inspector.

Recommended shape:

- Keep the same team id/apply id inputs and "View result" button.
- Continue loading manifest first.
- If `manifest.apply.baselineManifest` is present, show a compact baseline
  summary using only summary fields, including `capturedAt` if present.
- If no baseline was captured, show an inert unavailable/not-captured message.
- Continue loading classification and file list as before.
- Keep existing preview behavior unchanged.

The baseline summary display must be inert text/badges only. It must not add
buttons, links, or commands.

### 4. ADR-0007 prerequisites

| Prerequisite | This slice |
|---|---|
| Reversibility | No mutation occurs; console display is read-only. |
| Containment | Console reads only an existing bridge API response; no filesystem access. |
| Human authority preserved | Viewing baseline summary never triggers apply, promote, write, commit, or discard. |
| No autonomy | No scheduler/model/background loop drives baseline summary display; user clicks the existing view button. |
| Audit completeness | No new audit class required; displayed data is already in the manifest response and must contain no content, hashes, or absolute paths. |
| Fail-closed | Missing/malformed baseline summary is rendered as inert unavailable state with no fallback reads. |
| Opt-in and revocable | Bound to existing `workspaceApplyEnabled`; apply-disabled manifest access remains inert. |

### 5. Boundary and invariants

This ADR does not weaken prior invariants.

| Invariant | ADR-0013 position |
|---|---|
| Read-only presentation | Console display only; no write request or mutation. |
| Existing backend capability | Uses existing manifest GET only; no new backend endpoint. |
| No `sha256` exposure | Console must not display or persist hashes. |
| No raw baseline content | Unchanged; no baseline content view or preview. |
| No baseline entries | Console displays only manifest summary fields, never per-file entries. |
| No diff / line-level detail | Baseline summary only. |
| No main-tree access | Console calls bridge API only; no filesystem access. |
| No apply-from-preview / promote | No buttons, commands, or API calls for promotion/write. |
| No `git`/spawn/VCS | Unchanged. |

## Risk acceptance

- **Scope creep from summary to baseline preview**: Showing summary counts may
  invite requests to inspect original file content. Mitigation: this ADR only
  permits summary fields already exposed by the manifest projection; previewing
  baseline content remains a separate ADR.
- **Hash leakage pressure**: Operators may ask why modified/unchanged labels do
  not expose hashes. Mitigation: `sha256` remains internal metadata and must not
  appear in console runtime output.
- **Root confusion**: `rootRef` is an opaque reference, not an absolute host
  path. Mitigation: tests must assert no absolute path or baseline root is
  displayed.
- **UI affordance creep**: Baseline summary beside classification could invite
  "compare" or "apply" buttons. Mitigation: acceptance conditions require inert
  text only and GET-only viewer behavior.

## Consequences

If accepted, the console can explain the baseline capture state behind existing
classification labels without exposing content, hashes, per-file baseline
metadata, or new backend capability.

If rejected, baseline summary remains available only in the manifest API
response and the console continues to show manifest/files/preview/classification
without baseline capture context.

## Acceptance Conditions

An `EX-2.8-1` handoff and closeout review MUST verify all of the following:

1. **Read-only UI**: the Apply Result panel issues only GET requests for the
   existing manifest, files, preview, and classification endpoints. No
   POST/PATCH/PUT/DELETE.
2. **Existing manifest response only**: console baseline summary uses only
   `manifest.apply.baselineManifest` from the existing manifest GET response. No
   new backend route, store capability, schema field, or audit type is added.
3. **Summary-only display**: UI displays only `capturedAt`, `fileCount`,
   `readableCount`, `missingCount`, `unreadableCount`, `byteTotal`, and
   `rootRef` when present.
4. **No baseline entries / hashes**: no `baselineManifest.entries`, `sha256`,
   raw baseline content, absolute host path, diff, or line-level detail appears
   in HTML or runtime-rendered output. Tests MUST specifically assert that
   `rootRef` is treated as an opaque reference and that no absolute host path is
   displayed.
5. **Graceful absent-baseline state**: a manifest without `baselineManifest`
   renders an inert unavailable/not-captured state and does not block
   manifest/files/preview/classification display.
6. **Fail-closed malformed summary**: malformed or unexpected baseline summary
   data does not trigger fallback filesystem reads, new endpoint calls, or unsafe
   disclosure.
7. **No apply/promote/write affordance**: no button, link, command, or API call
   can apply, promote, commit, discard, or write from the baseline summary view.
8. **Preview and classification unchanged**: existing redacted preview behavior
   and ADR-0011/ADR-0012 classification presentation remain unchanged.
9. **No ADR-0010/0011 semantic changes**: no baseline capture behavior change
   and no classification backend behavior change.
10. **Tests**: project-console static and behavior tests cover summary render,
    absent-baseline render, forbidden fields, forbidden affordances, and GET-only
    viewer behavior.
11. **Backward compatibility**: existing apply, presentation, classification,
    and project-console tests continue to pass.

## Status / Next

ACCEPTED (2026-06-12, senior review, with the Acceptance Conditions above).

Next:

1. `CLI-BRIDGE-v2.8-CONSOLE-BASELINE-SUMMARY-HANDOFF.md` authorizes
   `EX-2.8-1` with exact allowed files, UI behavior, tests, verification, and
   closeout checklist.
2. Execution proceeds in an `EX-*` batch and returns to `REVIEW-2.8-1`.
3. Baseline preview, raw baseline/result content persistence, textual diff,
   hash exposure, main-tree reads/writes, `git`/VCS, and apply-from-preview
   remain deferred and require separate ADRs.
