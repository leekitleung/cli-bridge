# Phase B Feature Planning

**Status**: Proposed | **Date**: 2026-06-10  
**Dependencies**: Step 5 (snapshot persistence ADR)

---

## Overview

This document catalogues the remaining Phase B features that depend on
the persistence layer (see `docs/adr/snapshot-persistence-for-goals-plans-projects.md`).
Each feature is described with its current state, target behavior, and
implementation constraints.

---

## 1. Project metadata editing

### Current state

Projects are created implicitly on first record reference.
The only way to set a `label` or `description` is via `store.upsert()`,
which has no HTTP endpoint or console UI.

### Target

- `PUT /bridge/projects/:key` — update `label` and/or `description`
- Console UI: inline edit of project label in left nav
- Validation: same `validateProjectKey()` rules for the URL segment

### Constraints

- Requires snapshot persistence to survive restarts
- Read-only — does not delete records or move them between projects
- Does not modify `project.key` (key is immutable after creation)

### Implementation order

1. Add `PUT /bridge/projects/:key` endpoint (with auth gate)
2. Add inline edit affordance in console left nav
3. Persist via snapshot

---

## 2. Archive / delete strategy

### Current state

No archive or delete mechanism exists. Records are in-memory and
lost on restart (until persistence is implemented).

### Target

- **Archive**: soft-delete a project. Records remain but the project
  is excluded from `/bridge/projects` listing. A `GET /bridge/projects?showArchived=true`
  flag exposes archived projects.
- **Delete**: hard-delete a project and all its records. Requires
  explicit confirmation gate (console UI with double-confirm).

### Constraints

- Delete is irreversible — must have a confirmation gate
- Archive must not affect existing record scoping
- Archived projects still appear in record-level queries
  (goals/reviews/prompts still carry their `projectId`)

### Implementation order

1. Design archive/delete semantics and confirmation UX
2. Add `archived` field to `Project` type
3. Add `DELETE /bridge/projects/:key` and `POST /bridge/projects/:key/archive`
4. Console UI: archive/delete affordance with confirmation

---

## 3. Audit event with projectId

### Current state

`AuditEvent` has no `projectId` field. Audit events are filtered by
matching `packetId` against scoped records in `/bridge/projects/:key`.

### Target

Add optional `projectId?: string` to `AuditEvent`. When an audit event
is created, if the associated record has a `projectId`, copy it to the
audit event.

### Benefits

- Direct project-scoped audit queries without walking packetId mappings
- Audit events persist their project scope even after record deletion
- Simplifies `/bridge/projects/:key` filtering (direct field match)

### Constraints

- Must be backward-compatible (existing `projectId`-less audit events
  still filtered by packetId as today)
- Requires updating all call sites that create audit events
  (audit-log.ts, goal-store.ts, pending-review-store.ts, etc.)

### Implementation order

1. Add `projectId?: string` to `AuditEvent` type + schema
2. Update `createAndAppend` to accept optional `projectId`
3. Update all call sites (goals, reviews, prompts store layers)
4. Update `/bridge/projects/:key` filtering to prefer `projectId`, fall back to `packetId`

---

## 4. Status panel — real data sources

### Current state

The right status panel in the Project Workspace Console shows:
- **Progress**: step completion (from `ProjectDerivedStatus.progress`)
- **Active Goal**: from `ProjectDerivedStatus.activeGoal`
- **Goals**: grouped by active/completed
- **Audit**: count of audit events (or "No audit events recorded yet")
- **Memory**: "not yet available"

The `ProjectDerivedStatus.latestAudit` and `.memory` fields are `null`/`[]`.

### Target

- **Version/milestones**: read from a project metadata store (future)
- **Tests**: read from a test-run output source (future)
- **Commits ahead**: read from git status API (future)
- **Memory**: read from a project-scoped memory/knowledge store (future)

### Constraints

- Each data source requires its own backend integration
- None should block the console from loading
- All sources are read-only — no mutation from the console
- "Unavailable" state must remain for missing sources

### Implementation order

1. Design each data source's API contract
2. Implement one source at a time as independent slices
3. Console UI already supports per-section conditional rendering

---

## Implementation priority

| Priority | Feature | Depends on |
|----------|---------|------------|
| P1 | Snapshot persistence | ADR approved |
| P2 | Project metadata editing | Snapshot persistence |
| P2 | Archive / delete | Snapshot persistence |
| P3 | Audit event projectId | None (standalone) |
| P3 | Status panel real sources | Individual source integrations |
