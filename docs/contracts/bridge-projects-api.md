# /bridge/projects API Contract

**Status**: Implemented | **Version**: v2.0 (feat/v2.0-goal-data-model)  
**Source**: `apps/local-server/src/routes/bridge-api.ts`  
**Tests**: `tests/bridge-projects-api.test.mjs`

---

## Overview

The `/bridge/projects*` endpoints provide project aggregation views and limited
project metadata/archive controls over the existing bridge stores (goals,
reviews, pending prompts, audit events). Aggregation views group records by
`projectId`, backfill records without an explicit `projectId` to the default
`"cli-bridge"` project, and compute derived status.

Project mutations are limited to documented metadata updates and
archive/unarchive state changes. These endpoints create no new execution paths
and never bypass existing gates.

---

## projectId — key rules and validation

Any record (Goal, AgentReviewRequest, PendingPrompt) may carry an optional
`projectId` (provided in the request body of the respective POST endpoint).

### Validation rules

`projectId` values are validated by `validateProjectKey()`:

| Rule | Detail |
|------|--------|
| Length | 1–64 characters |
| First character | Must be `a-z` or `0-9` |
| Allowed characters | `a-z`, `0-9`, `-`, `_` only |
| Forbidden | No slashes, spaces, control characters, upper-case, or leading hyphens |

### Error responses

- `projectId` absent, null, or empty → records get no explicit `projectId`
  and are backfilled to `"cli-bridge"` at query time.
- `projectId` present but fails validation → **400** `"projectId is invalid"`.
- `projectId` passes validation → the value is trimmed and stored as the
  record's `projectId`.

### URL path keys (`:key` in `/bridge/projects/:key`)

The `:key` segment is validated identically:
- Invalid detail keys (slash, space, too long) → **404** or **405**
- Malformed or invalid archive/unarchive keys → **400**
- URL-encoded keys are decoded before validation

### Implicit project discovery

Projects are created implicitly when a record first references a new
`projectId` key. The `buildAllSummaries()` method discovers projects from
both the explicitly-registered store and from record `projectId` fields.
An implicit project has `project.label = key` and `project.createdAt = 0`
until explicitly registered via `store.upsert()`.

### Default project backfill

Records without `projectId` are assigned to `"cli-bridge"` by
`resolveProjectKey()`. This means all existing data without explicit project
scoping is automatically visible under the default project.

### Audit event filtering

Audit events in `/bridge/projects/:key` are filtered using a two-tier strategy:

1. **projectId-first** (v2): Events with `event.projectId === key` are
   directly included. All project-scoped audit events created by
   pending prompts, reviews, and goal-plan generators carry their
   parent record's `projectId`.

2. **packetId fallback** (v1/legacy): Events without a `projectId`
   are included if their `packetId` matches any scoped record identifier:
   - Goal → `goal.id`
   - AgentReviewRequest → `review.packetId`
   - PendingPrompt → `prompt.packetId`

Events without either `projectId` or a matching `packetId` are excluded.

Events without a `packetId` field, or whose `packetId` does not match any
scoped record, are excluded (fail-closed).

---

## GET /bridge/projects

Lists all known projects with summary statistics.

### Response (200)

```json
{
  "projects": [
    {
      "project": {
        "key": "string",
        "label": "string",
        "description": "string | undefined",
        "createdAt": 1234567890
      },
      "goalCount": 5,
      "activeGoalCount": 2,
      "reviewCount": 3,
      "promptCount": 1,
      "status": "active"
    }
  ]
}
```

### Fields

| Field | Type | Description |
|-------|------|-------------|
| `project.key` | string | Unique project identifier. Default is `"cli-bridge"`. |
| `project.label` | string | Human-readable label. |
| `project.description` | string? | Optional longer description. |
| `goalCount` | number | Total goals scoped to this project. |
| `activeGoalCount` | number | Goals with status not in {done, cancelled, failed}. |
| `reviewCount` | number | Review requests scoped to this project. |
| `promptCount` | number | Pending prompts scoped to this project. |
| `status` | enum | Derived status: `"active"` (has active goals), `"idle"` (has goals, all done), `"unknown"` (no goals). |

---

## GET /bridge/projects/:key

Returns detailed data for a single project.

### Response (200)

```json
{
  "project": { "key": "string", "label": "string", ... },
  "summary": { "project": {...}, "goalCount": 5, ... },
  "goals": [
    {
      "goal": { "id": "...", "description": "...", "status": "executing", ... },
      "plan": { "id": "...", "steps": [...], "status": "executing", ... } | null
    }
  ],
  "reviews": [
    { "id": "...", "status": "returned", "targetEndpointId": "...", ... }
  ],
  "pendingPrompts": [
    { "id": "...", "status": "draft", "prompt": "...", ... }
  ],
  "auditEvents": [
    { "id": "...", "type": "send_review", "timestamp": ..., ... }
  ],
  "status": {
    "progress": { "completed": 3, "total": 5 } | null,
    "activeGoal": { "id": "...", "description": "...", "status": "executing" } | null,
    "goalsSummary": [{ "id": "...", "description": "...", "status": "done" }],
    "blockedGate": { "goalId": "...", "stepId": "...", "stepIndex": 2 } | null,
    "latestAudit": { "id": "...", "type": "create_pending_review", "timestamp": ... } | null,
    "memory": [
      { "sourceKind": "goal", "sourceId": "project-summary", "timestamp": ..., "fact": "2 active goal(s) in this project" }
    ]
  }
}
```

### Response (404)

Returned when the project key is unknown AND no records reference it.

```json
{ "status": "error", "message": "Project not found" }
```

### Fields

| Field | Type | Description |
|-------|------|-------------|
| `goals` | GoalWithPlan[] | All goals scoped to this project, each with its plan (or null). |
| `reviews` | AgentReviewRequest[] | Reviews scoped to this project. |
| `pendingPrompts` | PendingPrompt[] | Pending prompts scoped to this project. |
| `auditEvents` | AuditEvent[] | Filtered by authoritative `projectId` when present; legacy events without `projectId` fall back to scoped record packetId. |
| `status.progress` | object? | Step completion ratio (completed / total). Null if no active plan. |
| `status.activeGoal` | object? | The first active goal (not done/cancelled/failed). Null if none. |
| `status.goalsSummary` | object[] | All goals with id, description, status. |
| `status.blockedGate` | object? | First blocked-needs-gate step across all goals. Null if none. |
| `status.latestAudit` | AuditEvent \| null | Most recent audit event within project scope. Null if no events. |
| `status.memory` | DerivedMemoryEntry[] | Compact project-scoped derived memory (same source as `GET .../memory`), capped to the most recent 8 entries. Empty array when no records exist. |

---

## POST /bridge/projects

Create a project explicitly (B3). Only project metadata is created — no goals,
reviews, or execution artifacts are created.

### Request body

```json
{
  "key": "my-project",
  "label": "My Project",
  "description": "Optional description"
}
```

| Field | Required | Type | Constraints |
|-------|----------|------|-------------|
| `key` | **Yes** | string | Must pass `validateProjectKey()`: 1-64 chars, lowercase alphanumeric/hyphen/underscore, starts with a-z0-9 |
| `label` | No | string | Non-empty; defaults to `key` if omitted |
| `description` | No | string | Any string; defaults to undefined |

Disallowed fields: `createdAt`, `archivedAt`.

### Response (201)

```json
{
  "project": {
    "key": "my-project",
    "label": "My Project",
    "description": "Optional description",
    "createdAt": 1234567890
  }
}
```

### Error cases

| Status | Condition |
|--------|-----------|
| 400 | Missing or invalid `key` |
| 400 | Disallowed fields present (`createdAt`, `archivedAt`) |
| 409 | Project key already exists (including archived projects — never implicitly unarchives) |
| 405 | Non-POST/GET method |

### Behavior

- `key` is immutable after creation.
- Duplicate create returns 409 and does **not** overwrite existing metadata.
- Archived duplicate create returns 409 and does **not** unarchive.
- Default project `"cli-bridge"` already exists; POST returns 409.
- On success, `runtime.persist()` is called.
- The created project appears in `GET /bridge/projects` immediately.

---

## PATCH /bridge/projects/:key

Update a project's `label` and/or `description`.

### Request body
```json
{ "label": "New Label", "description": "Updated description" }
```

### Response (200)
```json
{ "project": { "key": "...", "label": "New Label", ... } }
```

### Constraints
- Only `label` and `description` are writable.
- Fields `key`, `createdAt`, `archivedAt` are rejected with 400.
- Repeated PATCH with the same body is idempotent.

---

## POST /bridge/projects/:key/archive

Soft-archives a project. Archived projects are excluded from
default listing and block new record creation.

### Response (200)
```json
{ "project": { "key": "...", "archivedAt": 1793000000000, ... } }
```

### Constraints
- Default project `"cli-bridge"` cannot be archived (409).
- Already-archived projects return 409.
- Archived projects still appear in `GET /bridge/projects/:key`.

---

## POST /bridge/projects/:key/unarchive

Restores an archived project.

### Response (200)
```json
{ "project": { "key": "...", "archivedAt": undefined, ... } }
```

### Constraints
- Non-archived projects return 409.

---

## includeArchived query parameter

The default project listing `GET /bridge/projects` hides archived
projects. To include them:

```
GET /bridge/projects?includeArchived=true
```

Filters archived projects when the parameter is absent or any value
other than `"true"`.

---

## Archived project creation guard

POST to `/bridge/goals`, `/bridge/reviews`, or `/bridge/pending-prompts`
with a `projectId` pointing to an archived project returns **409**
`"Cannot create ... in archived project"`.

This guard applies only when a `projectId` is explicitly provided.
Records without `projectId` (backfilled to `"cli-bridge"`) are never
blocked because the default project cannot be archived.

---

## GET /bridge/projects/:key/memory

Returns a read-only derived memory view for a project. Entries are computed from
already-persisted records (goals, plan steps, gates, reviews, and verified
artifact evidence). The endpoint runs nothing, spawns nothing, and writes
nothing.

### Response (200)

```json
{
  "projectId": "alpha",
  "entries": [
    { "sourceKind": "goal", "sourceId": "project-summary", "timestamp": 1234567890, "fact": "2 active goal(s) in this project" },
    { "sourceKind": "verification", "sourceId": "team-1:slot-verify", "timestamp": 1234567000, "fact": "Verification evidence recorded for step 1a2b3c4d (team team-1)" }
  ]
}
```

Projects with no records return `{ "projectId": "...", "entries": [] }`.

### Entry source kinds

| `sourceKind` | Derived from |
|--------------|--------------|
| `goal` | Active and completed goal counts. |
| `plan-step` | Completed steps per plan. |
| `gate` | Steps waiting for gate approval. |
| `review` | Review request counts (including returned). |
| `verification` | One entry per `SlotArtifact` with non-blank `verificationNotes`. |

### Verification-evidence source and isolation

- A `verification` entry is derived only when `SlotArtifact.verificationNotes`
  is a non-empty string after trimming; blank notes are ignored.
- Artifacts are included only when their parent team is within the requested
  project scope (`TeamSpec.projectId` matches the project key).
- The derived `fact` reports only that evidence was recorded; it never infers
  pass/fail from the notes and never echoes the raw note text.
- `verification` entries are sorted newest first by `timestamp`
  (`SlotArtifact.createdAt`), with deterministic fallback ordering by
  `teamId:slotId`.
- Mutation methods on this path return 405.

---

## GET /bridge/projects/:key/verification

Returns a read-only verification evidence view for a project. The endpoint does
not run a harness, spawn a process, or infer pass/fail from free text.

### Response with artifact-backed records (200)

```json
{
  "projectId": "alpha",
  "status": "recorded",
  "records": [
    {
      "stepId": "step-2",
      "stepIndex": 1,
      "stepIntent": "Verify task",
      "stepStatus": "pending",
      "harnessStatus": "recorded",
      "notes": "npm test passed",
      "teamId": "team-1",
      "slotId": "slot-verify",
      "createdAt": 1234567890
    }
  ]
}
```

### Response without verification evidence (200)

```json
{
  "projectId": "alpha",
  "status": "unavailable",
  "records": []
}
```

Projects with completed plan steps but no artifact notes may include legacy
placeholder records with `harnessStatus: "unavailable"`.

### Source and isolation

- Records are derived only from existing `SlotArtifact.verificationNotes`.
- Blank or whitespace-only notes are ignored.
- Artifacts are included only when their parent `TeamSpec.projectId` matches
  the requested project key.
- Records are sorted newest first by `createdAt`.
- Mutation methods on this path return 405.

---

## Auth

All `/bridge/projects*` paths require origin + pairing token authentication
(same as all other `/bridge/*` endpoints). Unauthenticated → 401 or 403.

---

## Non-goals

These endpoints do **not**:

- Accept mutations beyond the documented PATCH (metadata), POST .../archive,
  and POST .../unarchive. Unlisted mutation paths return 405.
- Modify goal/review/prompt records, spawn any process, or bypass any gate
- Auto-execute, auto-approve, or auto-send anything

---

## Testing

- `tests/bridge-projects-api.test.mjs` — endpoint contract tests (31 tests)
  - Default project exists with no records
  - Explicit grouping and unscoped backfill
  - Project detail with scoped data and derived status
  - Audit isolation: authoritative projectId + legacy packetId fallback
    (including same-session cross-project and mismatched projectId regression)
  - PATCH contract: label/description update, disallowed fields rejection,
    unknown project 404, idempotency
  - Archive/unarchive: archivedAt set/cleared, default project guard,
    creation guards (409), includeArchived toggle
  - Malformed percent-encoding rejection, traversal key rejection
- `tests/bridge-project-observability.test.mjs` — read-only project
  timeline/audit/memory/verification views, including artifact-backed
  verification evidence and project isolation
- `tests/project-console-ui.test.mjs` — static HTML allowlist and safety
- `tests/project-console-behavior.test.mjs` — jsdom UI interaction tests
  (project switch, command bar, management UI)
- `tests/json-persistence.test.mjs` — snapshot round-trip:
  metadata, archivedAt, AuditEvent.projectId, legacy audit fallback
  - Unknown project → 404
  - Invalid project key → 404/405
  - POST → 405; invalid projectId → 400
- `tests/project-store.test.mjs` — store unit tests
  - upsert, get, list, buildSummary, buildAllSummaries
  - resolveProjectKey backfill
  - validateProjectKey accept/reject rules

---

## Workspace Apply (v2.5, Approach A)

**Status**: Implemented | **ADR**: `docs/planning/ADR-0008-patch-apply-isolated-worktree.md`
**Handoff**: `docs/planning/CLI-BRIDGE-v2.5-WORKSPACE-APPLY-HANDOFF.md`
**Source**: `apps/local-server/src/storage/workspace-apply-store.ts`, `apps/local-server/src/routes/bridge-api.ts`
**Tests**: `tests/workspace-apply.test.mjs`

### Design constraints

- **Opt-in**: `Project.workspaceApplyEnabled` must be `true` (default `false`). Set via `PATCH /bridge/projects/:key`.
- **Approach A**: content is supplied in the confirm request body at gate time, written into a bridge-managed isolated scratch directory via contained Node `fs` ops. **No git, no spawn, no child_process, no VCS mutation.**
- **Per-apply human gate**: apply requires an explicit `{ confirmed: true }` with the file content map. No scheduler, daemon, or model-driven apply.
- **Isolation**: writes go to a dedicated subdirectory under the configured apply root, never the user's main working tree.
- **Path containment**: every target path is normalized and validated; `..`, absolute paths, backslash escapes, and drive letters are rejected.
- **Caps**: `maxFiles` (default 200) and `maxTotalBytes` (default 5 MB). Exceeding either fails closed.
- **Reversible**: `POST .../discard` removes the isolated directory. Main tree is never affected.
- **No raw content persistence**: audit metadata carries typed metadata (applyId, fileList, caps, status, etc.) only — never raw file content, API keys, or secrets.

### POST /bridge/projects/:key/teams/:teamId/apply-requests

Create a pending apply request. No filesystem writes.

**Body**:
```json
{
  "slotId": "string (required)",
  "planStepId": "string (required)",
  "proposedFiles": ["string array (optional, defaults to artifact proposedFiles)"],
  "actor": "string (optional)"
}
```

**Preconditions**:
- Project exists, not archived, `workspaceApplyEnabled: true`
- Team exists for the project
- Artifact (`slotId` + `planStepId`) exists in the team
- Team conflict report is clean (no file conflicts)

**Returns**: `201 Created` with `{ apply: ApplyRequest }` (status: `pending`).

**Audit**: `workspace_apply_request` with typed `result.metadata`.

### GET /bridge/projects/:key/teams/:teamId/apply-requests

List apply requests for the team. Never returns raw file content.

Each item is projected through the same safe manifest projection as the
single-item manifest GET: the absolute `isolatedDirPath` is omitted (only the
opaque `isolatedDirId` is exposed) and `baselineManifest` is reduced to its
summary (no per-file `entries`/`sha256`).

**Returns**: `200` with `{ applies: ApplyManifest[] }` (projected; not raw `ApplyRequest` objects).

### POST /bridge/projects/:key/teams/:teamId/apply-requests/:applyId/confirm

Human-gated write: confirms the pending apply and writes files to an isolated directory.

**Body**:
```json
{
  "confirmed": true,
  "files": { "relative/path": "file content string" },
  "actor": "string (optional)"
}
```

**Preconditions**:
- Apply request exists and is `pending`
- `confirmed` is exactly `true`
- `files` is a plain object mapping relative paths to string content
- File keys exactly match the request's `proposedFiles`
- All paths pass containment validation
- Caps not exceeded (maxFiles, maxTotalBytes)
- Project `workspaceApplyEnabled` still `true`

**On success**: writes files atomically (staging → publish) into `applyRoot/<isolatedDirId>/`. Updates request status to `applied` with `isolatedDirPath`, `fileCount`, `byteTotal`.

**On failure**: all validation failures return clean 4xx errors (400 or 409) with no files written. Request status may be updated to `failed`.

**Audit**: `workspace_apply_result` with typed `result.metadata`.

### POST /bridge/projects/:key/teams/:teamId/apply-requests/:applyId/discard

Reversibly remove the isolated directory. No effect on the main working tree.

**Returns**: `200` with `{ apply: ApplyRequest }` (status: `discarded`).

**Audit**: `workspace_apply_result` with typed `result.metadata`.

## Read-only Apply-result Presentation (v2.5, ADR-0009)

**Status**: Implemented | **ADR**: `docs/planning/ADR-0009-read-only-apply-result-presentation.md`
**Handoff**: `docs/planning/CLI-BRIDGE-v2.5-APPLY-RESULT-PRESENTATION-HANDOFF.md`
**Source**: `apps/local-server/src/storage/workspace-apply-store.ts` (`listAppliedFiles`, `readFilePreview`, `toApplyManifest`), `apps/local-server/src/routes/bridge-api.ts`
**Tests**: `tests/apply-result-presentation.test.mjs`

Strictly read-only inspection of an existing isolated apply result, using only
data the bridge already records. **No mutation, no pre-apply baseline, no diff
or diff-like view, no modified/unchanged/new classification, no main-tree write,
no `git`/VCS, no spawn, no "apply from preview".** All three endpoints are
opt-in gated on `Project.workspaceApplyEnabled === true` (default `false`); with
apply disabled they return `409` and stay inert.

### GET /bridge/projects/:key/teams/:teamId/apply-requests/:applyId

Read-only manifest projection of an `ApplyRequest`. Never returns raw file
content, secrets, or `isolatedDirPath` (an absolute host path) — exposes
`isolatedDirId` only.

**Returns**: `200` with `{ apply: ApplyManifest }` where `ApplyManifest` =
`{ applyId, projectKey, teamId, slotId, planStepId, isolatedDirId, status, fileCount, byteTotal, caps, actor, createdAt, confirmedAt }`.

**Fail-closed**: `404` if unknown applyId or wrong project/team; `409` if apply not enabled.

### GET /bridge/projects/:key/teams/:teamId/apply-requests/:applyId/files

Read-only list of the repository-relative file paths within the isolated
directory and each file's byte size. Carries **no** modified/unchanged/new
classification (there is no baseline to classify against).

**Returns**: `200` with `{ files: [{ path, size }] }`.

**Fail-closed**: `404` if unknown applyId; `409` if status is not `applied`
(pending/discarded/failed → no on-disk result to list); `409` if apply not enabled.

### GET /bridge/projects/:key/teams/:teamId/apply-requests/:applyId/files/preview?path=&lt;rel&gt;

Read-only, size-capped (64 KB → `truncated: true`), secret-redacted preview of a
single file within the isolated directory. `path` is validated with the same
containment logic as apply (`validateAllPaths`); `..`, absolute, drive-letter,
UNC, and any selector resolving outside the isolated root are rejected before any
read. Redaction reuses `redactSensitiveContent`.

**Returns**: `200` with `{ path, size, truncated, redacted, content }`.

**Fail-closed**: `400` on missing/invalid/escaping `path`; `404` if unknown
applyId or file not present; `409` if status is not `applied`; `409` if apply not
enabled.

### Non-goals

- No write to the user's main working tree
- No git worktree, git apply, commit, push, merge, PR, or merge queue
- No parallel apply, scheduler, daemon, background apply, or model-driven apply
- No shell/exec/run/command endpoint
- No persistence of raw file content in audit, snapshot, or metadata
- No pre-apply baseline capture, diff, or diff-like view (presentation)
- No modified/unchanged/new file classification (presentation)
- No "apply from preview" / promote affordance in API or console

### Pre-apply Baseline Manifest (v2.5, ADR-0010)

**Status**: Implemented | **ADR**: `docs/planning/ADR-0010-pre-apply-baseline-manifest-capture.md`
**Handoff**: `docs/planning/CLI-BRIDGE-v2.5-PRE-APPLY-BASELINE-MANIFEST-HANDOFF.md`

Metadata-only capture of proposed file states before an isolated apply write. No
raw content, no diff, no classification. Trusted root from server config only.

**Trusted root resolution (v2.9, ADR-0014)**: baseline capture can resolve the
trusted root from server/operator runtime configuration in this order:

1. `projectWorkspaceRoots[projectKey]` when configured for the apply request's
   project;
2. otherwise the existing runtime-wide `baselineRoot`;
3. otherwise no trusted root, which fails closed when baseline capture is
   enabled.

Project workspace roots are never set from HTTP request bodies, query strings,
project create/PATCH payloads, console input, model output, or artifact data.
They are normalized server-side, are not persisted to snapshots, and are never
returned or audited as absolute host paths. v2.9 does not change response
shapes, console output, or `rootRef`; the manifest summary still uses the
existing opaque `"runtime-baseline-root"` value.

**ApplyManifest extension**: `ApplyManifest.baselineManifest` exposes summary
metadata **only** — exactly seven fields:
- `capturedAt` (number, Unix ms timestamp)
- `fileCount` (number)
- `readableCount` (number)
- `missingCount` (number)
- `unreadableCount` (number)
- `byteTotal` (number)
- `rootRef` (string, opaque — `"project-root:<projectKey>"` when a project-specific
  workspace root is configured, or `"runtime-baseline-root"` for the runtime-wide
  fallback. Never an absolute host path.)

Never exposed via `ApplyManifest`: `entries` (per-file list), per-file `sha256`,
raw baseline content, absolute host path, isolated directory path.

**Audit**: `workspace_apply_result.result.metadata.baseline` with summary
metadata. No raw content or absolute host path.

**Non-goals**: diff/diff-like view, new/modified/unchanged classification,
baseline preview endpoint, raw baseline content persistence.

### Apply-result File Classification (v2.6, ADR-0011)

**Status**: Implemented | **ADR**: `docs/planning/ADR-0011-read-only-apply-result-classification.md`
**Handoff**: `docs/planning/CLI-BRIDGE-v2.6-APPLY-RESULT-CLASSIFICATION-HANDOFF.md`

Read-only, metadata-only per-file classification comparing persisted ADR-0010
baseline metadata against the isolated apply result. No raw content, no diff,
no sha256 in response.

### GET .../apply-requests/:applyId/classification

**Response 200**:
```json
{
  "files": [{ "path": "src/app.ts", "size": 123, "classification": "modified" }],
  "summary": { "new": 1, "modified": 1, "unchanged": 2, "unreadableBaseline": 0, "total": 4 }
}
```

`classification` ∈ `new | modified | unchanged | unreadable-baseline` (closed enum).

**Fixed error semantics**:
- workspaceApplyEnabled false → 409
- Unknown applyId / wrong project/team → 404
- Status not `applied` → 409
- No baseline manifest → 409 (`"Baseline manifest not captured for this apply request"`), no per-file list
- Path escape / cap exceed → 400/409

**Non-goals**: sha256 in response, diff/diff-like view, raw content, main-tree access,
git/spawn/VCS, apply-from-preview.

### Project Console Apply-result Viewer (v2.7-v2.8, ADR-0012/ADR-0013)

The project console's Apply Result (read-only) panel displays the full apply-result
surface in the browser, using only GET requests:

| Section | Source | Endpoint |
|---------|--------|----------|
| Manifest | `man.data.apply` | `GET .../apply-requests/:applyId` |
| Baseline summary | `man.data.apply.baselineManifest` | (from manifest — no extra fetch) |
| Classification | separate fetch (non-blocking) | `GET .../apply-requests/:applyId/classification` |
| File list | separate fetch | `GET .../apply-requests/:applyId/files` |
| File preview | on-demand per file | `GET .../apply-requests/:applyId/files/preview?path=...` |

**Baseline summary display**:
- Shows 7 fields from `baselineManifest`: capturedAt, fileCount, readableCount,
  missingCount (including 0), unreadableCount (including 0), byteTotal, rootRef.
- rootRef is rendered as inert text only; absolute-looking values (drive letter,
  UNC, POSIX absolute, backslash-containing) are sanitized to a placeholder (`—`).
- Malformed baseline summary fails closed — shows "unavailable" without blocking
  classification/files/preview rendering.
- Absent baselineManifest shows "Baseline not captured".

**Classification display**: per-file labels in file table, summary counts. 409
no-baseline shows "unavailable" without blocking files/preview.

**Hard boundary**: all calls are GET-only. No POST/PUT/DELETE/PATCH. No
apply/promote/commit/discard/write controls. No sha256/entries/raw content/diff/
line detail/absolute host path in rendered output.
