# ADR-0012: Console Apply-result Classification Presentation (read-only, v2.7)

Status: PROPOSED -- awaiting senior accept/reject

Date: 2026-06-12

## Context

The v2.5/v2.6 apply-result line now has a complete read-only API chain:

- ADR-0009: read-only apply-result presentation via manifest, file list, and
  size-capped redacted preview.
- ADR-0010: metadata-only pre-apply baseline manifest capture.
- ADR-0011: read-only, metadata-only file classification endpoint:
  `GET /bridge/projects/:key/teams/:teamId/apply-requests/:applyId/classification`.

The project console (`GET /console/project`) already includes an Apply Result
panel in the teams view. That panel is a thin client over existing GET endpoints
and currently lets a user inspect an apply manifest, list isolated-result files,
and preview a single file. It intentionally exposes no write/apply/promote
affordance.

After ADR-0011, the console still does not surface the classification endpoint.
Users can inspect classification only by calling the API directly. This ADR
proposes the smallest UI follow-up: display the existing classification summary
and per-file labels in the existing Apply Result panel.

This ADR does not authorize any new backend endpoint, diff, raw content, hash
exposure, main-tree read/write, VCS action, apply-from-preview, or console write
control.

## Decision

### 0. Decision status

**PROPOSED.** No implementation is authorized until this ADR is explicitly
accepted by senior review and an `EX-2.7-1` handoff is created.

### 1. Whether console classification presentation is allowed

**Proposed decision**: PERMIT, but only as a strictly read-only console
presentation of the already-implemented ADR-0011 classification endpoint.

The console MAY call:

```text
GET /bridge/projects/:key/teams/:teamId/apply-requests/:applyId/classification
```

after the user enters a team id and apply id in the existing Apply Result
viewer. It MAY display:

- the classification summary counts;
- each file path, size, and classification label;
- inert unavailable/error states for no-baseline, not-applied, not-found, or
  apply-disabled responses.

The console MUST NOT:

- display or infer any `sha256`;
- display raw baseline content;
- produce textual diff, diff-like, or line-level detail;
- read the user's main tree;
- add backend endpoints;
- add apply/promote/commit/write controls;
- call `POST`, `PATCH`, `PUT`, or `DELETE` from the apply-result viewer;
- change ADR-0010 baseline capture or ADR-0011 classification semantics.

### 2. Scope

In scope:

- Update the existing project console Apply Result panel in the teams view.
- Fetch classification from the existing ADR-0011 endpoint, using the same
  team id/apply id entered for manifest/files/preview.
- Render a compact summary and per-file classification labels.
- Merge classification labels into the displayed file list when available.
- Handle `409` no-baseline as an inert "classification unavailable" state, not
  as a failure that hides manifest/files/preview.
- Keep preview behavior unchanged.
- Static/behavior tests proving the console only uses allowlisted GET endpoints
  and exposes no apply/promote/write affordance.
- Contract/changelog updates if needed.

Out of scope:

- New backend routes or response fields.
- Console baseline viewer.
- Textual/structural diff, diff-like view, or line-level detail.
- Returning or displaying `sha256`.
- Raw baseline/result content beyond the already-authorized redacted preview.
- Main-tree reads/writes.
- `git`, worktree, diff/apply, commit, push, merge, PR, merge queue.
- Apply-from-preview, promote, scheduler/model-triggered apply.
- Project-level workspace root configuration.

### 3. UI behavior

The existing Apply Result panel should remain a thin, read-only inspector.

Recommended shape:

- Keep the existing team id/apply id inputs and "View result" button.
- Continue loading manifest first.
- Continue loading file list and preview as today.
- Add a classification request to the existing load flow:
  - if `200`, render summary counts and labels;
  - if `409` because no baseline was captured, show a quiet unavailable state
    and keep manifest/files/preview visible;
  - if `409` because not applied or apply disabled, follow the existing
    fail-closed status messaging;
  - if `404`, show not found/wrong team/project as today.
- Classification display must be inert text/badges only. Labels are not buttons.

The console must not make classification a prerequisite for manifest/file
inspection. A request without baseline should still allow the already-authorized
manifest/files/preview path to work when those endpoints succeed.

### 4. ADR-0007 prerequisites

| Prerequisite | This slice |
|---|---|
| Reversibility | No mutation occurs; console display is read-only. |
| Containment | Console reads only existing bridge API responses; classification endpoint already confines result hashing to isolated dir. |
| Human authority preserved | Viewing labels never triggers apply, promote, write, commit, or discard. |
| No autonomy | No scheduler/model/background loop drives classification; user clicks the existing view button. |
| Audit completeness | No new audit class required; if existing request logging/audit is present, it must not include content, hashes, or absolute paths. |
| Fail-closed | API errors are rendered as inert unavailable/error states with no unsafe fallback. |
| Opt-in and revocable | Bound to existing `workspaceApplyEnabled`; apply-disabled classification remains inert. |

### 5. Boundary and invariants

This ADR does not weaken prior invariants.

| Invariant | ADR-0012 position |
|---|---|
| Read-only presentation | Console display only; no write request or mutation. |
| Existing backend capability | Uses ADR-0011 endpoint only; no new backend endpoint. |
| No `sha256` exposure | Console must not display or persist hashes. |
| No raw baseline content | Unchanged; no baseline content view. |
| No diff / line-level detail | Classification labels only. |
| No main-tree access | Console calls bridge API only; no filesystem access. |
| No apply-from-preview / promote | No buttons, commands, or API calls for promotion/write. |
| No `git`/spawn/VCS | Unchanged. |

## Risk acceptance

- **Scope creep from labels to diff**: Once labels are visible, users may ask
  for textual diff. Mitigation: this ADR only permits labels and summary; diff
  remains a separate ADR.
- **Misleading unavailable states**: No-baseline classification should not hide
  otherwise valid manifest/files/preview data. Mitigation: render it as an
  inert classification-unavailable state.
- **UI affordance creep**: A table of changed files can invite "apply" or
  "promote" buttons. Mitigation: acceptance conditions require no write controls
  and GET-only API usage.

## Consequences

If accepted, the existing project console can present the safe classification
data already available through ADR-0011, reducing direct API usage while keeping
the same security boundary.

If rejected, classification remains API-only and the console continues to show
manifest/files/preview.

## Acceptance Conditions

An `EX-2.7-1` handoff and closeout review MUST verify all of the following:

1. **Read-only UI**: the Apply Result panel issues only GET requests for
   manifest, files, preview, and classification. No POST/PATCH/PUT/DELETE.
2. **Existing endpoint only**: console uses the existing ADR-0011 classification
   endpoint; no backend route or store capability is added.
3. **Metadata-only display**: UI displays only path, size, classification label,
   and summary counts. No `sha256`, raw baseline content, absolute host path,
   diff, or line-level detail appears in HTML or runtime-rendered output.
4. **No apply/promote/write affordance**: no button, link, command, or API call
   can apply, promote, commit, discard, or write from the classification view.
5. **Graceful no-baseline state**: classification `409` for missing baseline is
   rendered as inert unavailable classification, while successful manifest/files
   display remains available.
6. **Fail-closed errors**: not-found, not-applied, apply-disabled, malformed, or
   classification errors do not trigger fallback reads or unsafe disclosure.
7. **Preview unchanged**: existing redacted preview behavior remains size-capped
   and unchanged; classification labels do not alter preview content.
8. **No ADR-0010/0011 semantic changes**: no baseline capture change, no
   classification backend behavior change.
9. **Tests**: project-console static and behavior tests cover GET-only endpoint
   usage, no forbidden affordances, classification render, no-baseline render,
   and no forbidden fields.
10. **Backward compatibility**: existing apply, presentation, classification,
    and project-console tests continue to pass.

## Status / Next

PROPOSED -- awaiting senior accept/reject. No implementation and no capability
are authorized by this document.

Next:

1. Senior review records an explicit accept or reject decision.
2. If ACCEPTED, author
   `CLI-BRIDGE-v2.7-CONSOLE-APPLY-RESULT-CLASSIFICATION-HANDOFF.md`
   (`EX-2.7-1`) with exact allowed files, UI behavior, tests, verification, and
   closeout checklist.
3. If REJECTED, record the rationale; console classification remains API-only.
4. Diff, hash exposure, raw baseline/result content persistence, main-tree
   reads/writes, `git`/VCS, and apply-from-preview remain deferred and require
   separate ADRs.
