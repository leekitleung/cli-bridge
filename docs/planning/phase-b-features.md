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
Label and description can be updated via `PATCH /bridge/projects/:key`.
Console inline edit UI is implemented (click project label in top bar).

### Target

- `PATCH /bridge/projects/:key` — update `label` and/or `description`
- Console UI: inline edit of project label in left nav
- Validation: same `validateProjectKey()` rules for the URL segment

### Constraints

- Requires snapshot persistence to survive restarts
- Metadata-only — does not delete records or move them between projects
- Does not modify `project.key` (key is immutable after creation)

### Implementation order

1. Add `PATCH /bridge/projects/:key` endpoint (with auth gate)
2. Add inline edit affordance in console left nav
3. Persist via snapshot

---

## 2. Archive / unarchive (partial implementation)

### Current state (implemented 2026-06-10)

Archive is implemented as soft-delete via `POST /bridge/projects/:key/archive`
and `POST /bridge/projects/:key/unarchive`. Archived projects:
- Are excluded from `GET /bridge/projects` by default
- Can be included with `?includeArchived=true`
- Block new goal/review/prompt creation (409)
- Remain readable via `GET /bridge/projects/:key`
- Persist across restarts via v2 snapshot

### Remaining work

- **Delete**: hard-delete a project and all its records. Requires
  explicit confirmation gate (console UI with double-confirm).
- **Console UI**: archive/unarchive affordance and filtered views.

### Constraints

- Delete is irreversible — must have a confirmation gate
- Archive must not affect existing record scoping
- Archived projects still appear in record-level queries
  (goals/reviews/prompts still carry their `projectId`)

### Completed implementation

1. Add archive state to `Project`
2. Add `POST /bridge/projects/:key/archive` and `/unarchive`
3. Hide archived projects by default and expose `?includeArchived=true`
4. Block new goal/review/prompt creation in archived projects

### Remaining implementation order

1. Design delete semantics and confirmation UX
2. Add `DELETE /bridge/projects/:key`
3. Console UI: archive/delete affordance with confirmation

---

## 3. Audit event with projectId (implemented)

### Current state

`AuditEvent` has an optional `projectId?: string` field, validated by
`validateAuditEvent()`. All project-scoped records (PendingPrompt,
PendingReview, goal-plan generation, command review runner) propagate
their `projectId` to audit events at creation time.

In `/bridge/projects/:key`, audit filtering uses a two-tier strategy:
- **projectId authoritative**: if `event.projectId` is present, match
  is by exact `projectId === key`. No fallback to packetId.
- **legacy packetId fallback**: if `event.projectId` is absent, match
  by scoped record `packetId` (goal.id, review.packetId, prompt.packetId).

Non-project-scoped audit events (bridge-loop, outbound, handoffs)
remain unchanged and carry no `projectId`.

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

The `ProjectDerivedStatus.latestAudit` returns the most recent project audit event. The `memory` field remains `[]`.

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

| Priority | Feature | Status |
|----------|---------|--------|
| P1 | Snapshot persistence | ✅ Implemented (goals/plans/projects in v2 snapshot) |
| P2 | Project metadata editing | ✅ Implemented (PATCH /bridge/projects/:key) |
| P2 | Archive / unarchive | ✅ Implemented (archive/unarchive + guards + includeArchived) |
| P3 | Audit event projectId | ✅ Implemented (type + schema + call-site propagation) |
| P3 | Status panel real sources | ⬜ Pending individual source integrations |
