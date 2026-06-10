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
    "memory": []
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
| `auditEvents` | AuditEvent[] | Filtered by packetIds of all scoped records. Events without a matching `packetId` are excluded. |
| `status.progress` | object? | Step completion ratio (completed / total). Null if no active plan. |
| `status.activeGoal` | object? | The first active goal (not done/cancelled/failed). Null if none. |
| `status.goalsSummary` | object[] | All goals with id, description, status. |
| `status.blockedGate` | object? | First blocked-needs-gate step across all goals. Null if none. |
| `status.latestAudit` | AuditEvent \| null | Most recent audit event within project scope. Null if no events. |
| `status.memory` | [] | Reserved. |

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

- `tests/bridge-projects-api.test.mjs` — endpoint contract tests
  - Default project exists with no records
  - Explicit grouping and unscoped backfill
  - Project detail with scoped data and derived status
  - Audit isolation via packetId (including same-session cross-project)
  - Unknown project → 404
  - Invalid project key → 404/405
  - POST → 405; invalid projectId → 400
- `tests/project-store.test.mjs` — store unit tests
  - upsert, get, list, buildSummary, buildAllSummaries
  - resolveProjectKey backfill
  - validateProjectKey accept/reject rules
