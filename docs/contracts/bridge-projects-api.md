# /bridge/projects API Contract

**Status**: Implemented | **Version**: v2.0 (feat/v2.0-goal-data-model)  
**Source**: `apps/local-server/src/routes/bridge-api.ts`  
**Tests**: `tests/bridge-projects-api.test.mjs`

---

## Overview

The `/bridge/projects*` endpoints provide read-only project aggregation views
over the existing bridge stores (goals, reviews, pending prompts, audit events).
They group records by `projectId`, backfill records without an explicit
`projectId` to the default `"cli-bridge"` project, and compute derived status.

These endpoints are **read-only projections** — they add no mutation authority,
create no new execution paths, and never bypass existing gates.

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

### Backfill rule

Records without `projectId` are assigned to `"cli-bridge"` at query time.
This means all existing data without explicit project scoping is automatically
visible under the default project.

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
    "latestAudit": null,
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
| `auditEvents` | AuditEvent[] | Audit events from sessions associated with this project's records. |
| `status.progress` | object? | Step completion ratio for the active plan (completed / total). Null if no active plan. |
| `status.activeGoal` | object? | The first active goal (not done/cancelled/failed). Null if none. |
| `status.goalsSummary` | object[] | All goals with id, description, status (for the status panel). |
| `status.blockedGate` | object? | First blocked-needs-gate step across all goals in this project. Null if none. |
| `status.latestAudit` | null | Reserved. Always null in current implementation. |
| `status.memory` | [] | Reserved. Always empty in current implementation. |

---

## Auth

All `/bridge/projects*` paths are registered in `isBridgePath()` and
require origin + pairing token authentication (same as all other `/bridge/*`
endpoints). Unauthenticated requests return 401 or 403.

---

## Non-goals

These endpoints do **not**:

- Accept POST, PUT, PATCH, or DELETE (only GET; any other method → 405)
- Accept a `:key` of `"run"`, `"exec"`, `"shell"`, `"command"` — those paths return 404
- Modify any store, spawn any process, or bypass any gate
- Auto-execute, auto-approve, or auto-send anything

---

## Testing

- `tests/bridge-projects-api.test.mjs` — endpoint contract tests
  - Default project exists even with no records
  - Explicit project grouping and unscoped record backfill
  - `/bridge/projects/:key` returns scoped data and derived status
  - Project detail scopes audit events
  - Unknown project returns 404
  - POST /bridge/projects returns 405
- `tests/project-store.test.mjs` — store unit tests
  - upsert, get, list, buildSummary, buildAllSummaries
  - resolveProjectKey backfill
