# /bridge/projects/:key/workbuddy API Contract

**Status**: Implemented (v2.2) | **Version**: v2.2 (feat/v2.2-workbuddy-surface)
**Source**: `apps/local-server/src/routes/bridge-api.ts`
**Tests**: `tests/bridge-workbuddy-api.test.mjs`

---

## Overview

The `/bridge/projects/:key/workbuddy` endpoint provides a non-executing task system
surface for WorkBuddy. It records external task state — task references, review
result sinks, prompt draft sinks, and execution ledger events — scoped to a project.

**All mutations are strictly non-executing**: they only write WorkBuddy state.
They do NOT confirm reviews, send prompts, dispatch commands, spawn processes,
or trigger any execution lifecycle.

All endpoints are protected by the existing `/bridge/*` token + origin gate.

---

## Security Boundary

- No CLI invocation, no shell, no process spawn.
- No auto-confirm, no auto-send, no auto-dispatch.
- Recorded data is summaries and structured metadata — not raw content.
- Prompt draft sinks are always `status: "draft"` and never transition to
  any other status.
- Review result sinks do NOT create pending reviews or trigger review lifecycle.
- Execution ledger events record only external/manual action status.
- Forbidden execution fields (`command`, `executable`, `autoExecute`, `autoSend`,
  `confirmed`, `sent`, `confirmedAuto`) are rejected by schema validators at
  the store level.

---

## GET /bridge/projects/:key/workbuddy

Returns all WorkBuddy state scoped to the project.

### Response (200)

```json
{
  "projectId": "my-project",
  "tasks": [...WorkBuddyTaskReference],
  "reviewResultSinks": [...WorkBuddyReviewResultSink],
  "promptDraftSinks": [...WorkBuddyPromptDraftSink],
  "executionLedgerEvents": [...WorkBuddyExecutionLedgerEvent]
}
```

### Error cases

| Status | Condition |
|--------|-----------|
| 400 | Invalid project key |
| 404 | Project not found |
| 405 | Non-GET method (on GET path) |

---

## POST /bridge/projects/:key/workbuddy

Records a single WorkBuddy state entry. The request body must include an `action`
field to determine which record type is being created.

### Common fields

| Field | Required | Type | Description |
|-------|----------|------|-------------|
| `action` | **Yes** | string | One of: `record-task`, `record-review-result`, `record-prompt-draft`, `record-ledger` |
| `id` | **Yes** | string | Unique identifier for the record |
| `projectId` | No | string | Must match URL key if present; otherwise injected from URL |

### Action: `record-task`

Creates a `WorkBuddyTaskReference`.

Additional required fields: `title` (string), `status` (one of `open`, `in-progress`, `blocked`, `done`), `createdAt` (number), `updatedAt` (number).

Response (201): `{ task: WorkBuddyTaskReference }`

### Action: `record-review-result`

Creates a `WorkBuddyReviewResultSink`.

Additional required fields: `reviewResultId` (string), `summary` (string), `findings` (string[]), `createdAt` (number).
Optional: `taskId` (string).

Response (201): `{ reviewResultSink: WorkBuddyReviewResultSink }`

### Action: `record-prompt-draft`

Creates a `WorkBuddyPromptDraftSink`. Status is always forced to `"draft"`.

Additional required fields: `promptDraft` (string), `createdAt` (number).
Optional: `taskId` (string).

Response (201): `{ promptDraftSink: WorkBuddyPromptDraftSink }`

### Action: `record-ledger`

Creates a `WorkBuddyExecutionLedgerEvent`.

Additional required fields: `kind` (one of `manual-delivery-recorded`, `manual-review-recorded`, `external-status-recorded`), `summary` (string), `createdAt` (number).
Optional: `taskId` (string).

Response (201): `{ executionLedgerEvent: WorkBuddyExecutionLedgerEvent }`

### Error cases

| Status | Condition |
|--------|-----------|
| 400 | Missing `action` |
| 400 | Unknown `action` value |
| 400 | `body.projectId` does not match URL key |
| 400 | Schema validation failure (missing required fields, invalid types) |
| 404 | Project not found |
| 409 | Project is archived (mutation blocked) |
| 405 | Non-POST/GET method |

---

## Project Isolation

- All records carry `projectId` (injected from URL key or validated against body).
- GET returns only records where `resolveProjectKey(record.projectId) === key`.
- Records from one project are never visible in another project's GET.

## Persistence

WorkBuddy state is included in the JSON snapshot (`CLI_BRIDGE_DATA_DIR`).
On hydration, invalid records are silently skipped (fail-open) — the server
starts with only valid state.

## Console Dashboard

`/console/project` includes a Tasks/WorkBuddy view ("Tasks" nav tab) that displays
project-scoped task references, review results, prompt drafts, and execution
ledger events. All text is HTML-escaped. No execute/dispatch/confirm buttons.

## Non-Goals (explicitly not in v2.2)

- AgentTeam, multi-slot execution, ExecutionProvider registry.
- Model API, PlannerModel, CriticModel.
- Task state triggering code execution, confirm, send, or dispatch.
- Workspace-write, automatic commit/push/merge.
- Hard-delete of WorkBuddy records.
- Transcript import or shell history capture.
