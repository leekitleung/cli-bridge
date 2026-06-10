# ADR: Goal/Plan/Project Snapshot Persistence

**Status**: Proposed | **Date**: 2026-06-10  
**Context**: Steps 1-4 hardening of project/scope/audit entities

---

## Context

The current `JsonSnapshotStore` persists only:
- `packets` (InMemoryPacketStore export)
- `auditEvents` (InMemoryAuditLog export)
- `pendingPrompts` (InMemoryPendingPromptStore export)
- `outboundPrompts` (InMemoryOutboundPromptStore export)

The v2.0 goal-driven execution model introduced (via ADR-0003):
- `InMemoryGoalStore` with goals, plans, plan steps
- `InMemoryProjectStore` with explicit project registry

Neither of these is included in the snapshot. On server restart:
- Goals, plans, and step state are lost
- Project registrations (explicit upserts) are lost
- Only implicit project discovery from records survives (via `buildAllSummaries`)

The current in-memory-only state is acceptable for development but
becomes a regression risk as the console and orchestration grow more
complex. Restarting the server mid-workflow loses all goal/plan state.

---

## Decision

### Goals and plans: persist

**Include goals and plans in the snapshot.**

Rationale:
- Goals and plans are the core workflow state.
- Losing them on restart makes the workflow console unusable across
  server restarts.
- They are already validated by `assertGoal` / `assertPlan` schemas.
- No new schema design is needed.

Implementation:
- Add `goals` and `plans` to `Snapshot` type.
- Export goals from `InMemoryGoalStore.listGoals()` and plans from
  `getPlanByGoal()` for each goal.
- On hydrate, iterate exported goals/plans and re-insert into store.
- Skip invalid records (fail-open — don't block startup).

### Project registry: persist

**Include explicit project registrations in the snapshot.**

Rationale:
- Without persistence, user-created project labels/descriptions are
  lost on restart.
- Implicit projects (derived from record `projectId`) already survive
  via record persistence.
- Persisting the registry makes label/description edits durable.

Implementation:
- Add `projects` to `Snapshot` type.
- Export from `InMemoryProjectStore.list()`.
- On hydrate, `upsert()` each project.
- The default `"cli-bridge"` project always exists; if missing from
  snapshot, the store constructor creates it.

### Implicit projects: derived only

**Do NOT persist implicit project entries.**

Implicit projects (those discovered from record `projectId` values
without an explicit `store.upsert()`) have `createdAt = 0` and
`label = key`. They are re-derived at query time from records.

Saving implicit projects would create noise in the snapshot without
adding value — they are already reconstructable from records.

---

## Implementation plan

### Phase 1: Schema change

Add to `Snapshot` type:
```typescript
goals: Goal[];
plans: Plan[];
projects: Project[];
```

All fields default to `[]` for backward compatibility with old snapshots.

### Phase 2: Export

In `buildSnapshot()`, export:
- `goals` from `goalStore.listGoals()`
- `plans` from iterating goals and calling `goalStore.getPlanByGoal()`
- `projects` from `projectStore.list()`

### Phase 3: Hydrate

In `createBridgeRuntime()`:
```typescript
if (snapshot) {
  // ... existing hydrate calls ...
  
  // Goals/plans — re-insert each goal and its plan.
  for (const goal of snapshot.goals ?? []) {
    try { assertGoal(goal); goalStore.hydrateGoal(goal); } catch { /* skip */ }
  }
  for (const plan of snapshot.plans ?? []) {
    try { assertPlan(plan); goalStore.hydratePlan(plan); } catch { /* skip */ }
  }
  
  // Projects — upsert explicit registrations.
  for (const project of snapshot.projects ?? []) {
    try { assertProject(project); projectStore.upsert(project); } catch { /* skip */ }
  }
}
```

### Phase 4: Tests

- Old snapshot without goals/plans/projects → hydrates without error
- New snapshot with goals/plans/projects → state restored correctly
- Corrupt goal/plan/project → skipped, remaining records still loaded
- Empty arrays in snapshot → no-op (existing behavior preserved)

### Migration risk

Old snapshots without `goals`/`plans`/`projects` fields → these
default to `[]` in destructuring, so existing snapshot files remain
compatible without migration.

---

## Status

**Pending implementation.** This ADR defines the contract; the
implementation should follow the plan above once the console and
API contracts are stable enough that the snapshot schema won't
need further revision.
