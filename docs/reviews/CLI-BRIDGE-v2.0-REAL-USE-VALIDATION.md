# CLI Bridge v2.0 — Real-Use Validation

**Date**: 2026-06-10 (updated 2026-06-11 with P1 fixes)
**Branch**: `feat/v2.0-goal-data-model`
**Validator**: Senior Developer Agent
**Review Verdict**: Request Changes → P1 fixes applied

## 0. PR/CI Status

| Check | Result |
|-------|--------|
| Branch pushed to origin | ✅ `origin/feat/v2.0-goal-data-model` |
| `npm run typecheck` | ✅ pass |
| `npm run lint` | ✅ pass |
| `npm test` | ✅ 383/383 pass |
| `git diff --check` | ✅ pass |
| Local server start | ✅ listening on :31337 |

## 1. Validation Scope

Real-use validation exercised the v2.0 Goal-driven Console and Project Workspace
through:

- **API-level contract tests**: All `/bridge/goals*` and `/bridge/projects*` endpoints
- **Internal store-level flow**: Goal → Plan → Approve → Step → Gate → Audit
  (via direct `InMemoryGoalStore` + `GoalOrchestrator`, matching test architecture)
- **Console HTML rendering**: `/console/project`, `/console/goals` pages verified
  served with correct content

Plan generation through the live `/bridge/goals/plan` endpoint was **not
exercised** because no `claude` CLI is available in the validation environment.
The plan generation pipeline is fully covered by `tests/goal-plan-generator.test.mjs`
which injects fake command runners.

## 2. Core Flow Verification

### 2.1 Goal Creation with Project Scope

```
POST /bridge/goals { sessionId, description, projectId }
```

| Assertion | Result |
|-----------|--------|
| Goal created with `projectId` field | ✅ |
| Goal starts as `draft` | ✅ |
| Multiple goals can share a project | ✅ |
| Cross-project isolation works | ✅ |

### 2.2 Plan Attachment (Simulated Generation)

```
store.attachPlan({ goalId, steps, permittedTiers })
```

| Assertion | Result |
|-----------|--------|
| Plan enters `awaiting-approval` | ✅ |
| Goal transitions to `planned` | ✅ |
| All PlanStep fields populated correctly (intent, kind, tier, isStateMutating) | ✅ |
| `permittedTiers` carried through to plan | ✅ |

### 2.3 Plan Approval (Human Gate)

| Assertion | Result |
|-----------|--------|
| Plan transitions to `approved` | ✅ |
| Goal transitions to `approved` | ✅ |
| `approvedAt` timestamp recorded | ✅ |
| Cannot approve non-`awaiting-approval` plan | ✅ |

### 2.4 Step-by-Step Advancement (Orchestrator)

Tested with a 6-step plan containing: 2× review, 2× propose-patch, 1× apply-patch, 1× write-file.

| Assertion | Result |
|-----------|--------|
| Non-mutating steps auto-complete (review, propose-patch) | ✅ |
| Mutating steps (apply-patch, write-file) blocked at gate | ✅ |
| `step-gated` result returned with correct step index | ✅ |
| Gate approval moves step to `gated-approved` | ✅ |
| Gate-approved steps can then be run | ✅ |
| Plan completes when all steps done | ✅ |
| Goal status reaches `done` | ✅ |

### 2.5 Tier Violation (Fail-Closed)

Tested: workspace-write step on patch-proposal-only plan.

| Assertion | Result |
|-----------|--------|
| `tier-violation` result returned | ✅ |
| Step NOT executed | ✅ |
| Clear reason message in result | ✅ |

### 2.6 Step Ceiling Enforcement

Tested: `stepCeiling: 2` on a 3-step plan.

| Assertion | Result |
|-----------|--------|
| First 2 steps complete normally | ✅ |
| 3rd advance returns `ceiling-reached` | ✅ |
| Ceiling value in result matches config | ✅ |

### 2.7 Cancellation Flow

| Assertion | Result |
|-----------|--------|
| Goal transitions to `cancelled` | ✅ |
| Plan transitions to `cancelled` | ✅ |
| `advance()` on cancelled goal returns `noop` with reason `goal-cancelled` | ✅ |
| Already-done goals reject cancellation | ✅ |

### 2.8 Fail-Stop on Step Failure

| Assertion | Result |
|-----------|--------|
| Orchestrator refuses to advance after any step failed | ✅ (covered by `goal-orchestrator.test.mjs`) |

## 3. Project Workspace UI

### 3.1 Console Pages

| Page | Served | Content |
|------|--------|---------|
| `/console/project` | ✅ 200 | 3-region layout (nav, workspace, status panel) |
| `/console/goals` | ✅ 200 | 2-column layout (goal create, active goal + steps) |
| `/console` | ✅ 200 | Review console |

### 3.2 GET `/bridge/projects`

| Feature | Result |
|---------|--------|
| Lists all projects with stats (goalCount, activeGoalCount, status) | ✅ |
| `?includeArchived=true` toggle | ✅ (tested in `bridge-projects-api.test.mjs`) |
| Default `cli-bridge` project always present | ✅ |

### 3.3 GET `/bridge/projects/:key` (Project Detail)

| Feature | Result |
|---------|--------|
| Returns project metadata | ✅ |
| Returns scoped goals with plans | ✅ |
| Returns derived status (progress, activeGoal, goalsSummary, blockedGate, latestAudit) | ✅ |
| Audit events filtered by projectId (authoritative) → packetId (legacy fallback) | ✅ |
| Memory field present (empty — not yet available) | ✅ |

### 3.4 Status Panel Fields

| Field | Status |
|-------|--------|
| `progress` (completed/total steps) | ✅ Working when active plan exists |
| `activeGoal` | ✅ Shows current active goal |
| `goalsSummary` | ✅ Lists all goals with status |
| `blockedGate` | ✅ Shows when a step is at gate |
| `latestAudit` | ✅ Shows most recent audit event |
| `memory` | ⚠️ Always empty `[]` — "not yet available" |
| `version`, `milestone`, `tests`, `commits` | ⚠️ Not present in status model — future |

## 4. Bugs & Friction Found

### B1 [P1 — FIXED 2026-06-11] ProjectStore not upserted on goal/review/prompt creation

**Impact**: `PATCH /bridge/projects/:key`, `POST .../archive`, `POST .../unarchive`
all returned 404 for projects created implicitly via goal/review/prompt creation.

**Fix**: `bridge-api.ts` now calls `runtime.projectStore.upsert({ key: projectId })`
after successful creation in all three handlers (goal, review, prompt).

**Test**: 4 regression tests added in `bridge-projects-api.test.mjs`:
- Implicit project via goal → PATCH + archive + unarchive work
- Implicit project via review → PATCH works
- Implicit project via prompt → PATCH works
- PATCH archived project preserves archivedAt

### B2 [P2 — FIXED] `createdAt: 0` for auto-created projects

Fixed by B1 — proper upsert uses `Date.now()`.

### B3 [P3] No endpoint to explicitly create a project

Still by design for v2.0. May want reconsideration for v2.1.

### F1 No plan generation without external CLI

**Impact**: The live `/bridge/goals/plan` endpoint requires a `claude` CLI
to be installed and on PATH. Without it, plan generation times out.

**Root cause**: By design — the plan generator calls `runAllowlistedCommand` with
`claude -p --output-format json`. Tests inject a fake runner; production needs a
real CLI.

**Note**: This is expected for v2.0. The plan generation contract is fully tested
via `goal-plan-generator.test.mjs`.

### F2 In-memory state lost on server restart

**Impact**: All goals, plans, and projects are lost when the server restarts.

**Note**: Snapshot persistence is available via `CLI_BRIDGE_DATA_DIR` env var.
The `JsonSnapshotStore` serializes all state and hydrates on restart. This was
not tested in this validation because we used a fresh server each time.

## 4c. Code Review P1 Fixes (2026-06-11)

Additional P1 issues caught during code review and now fixed:

### P1-1 [FIXED] goal-plan CLI safety boundary

`DEFAULT_GOAL_PLAN_COMMAND_CONFIG` now uses `[...CLAUDE_REVIEW_ARGS]` (disabled tools,
plan permission mode, no session persistence) instead of bare `['-p', '--output-format', 'json']`.
Tested in `bridge-goals-api.test.mjs` via captured execution args assertion.

### P1-2 [FIXED] cwd from HTTP body to command runner

`POST /bridge/goals/plan` now rejects `cwd` in the request body (400). Server uses
`process.cwd()` per command-runner safety contract. Tested in `bridge-goals-api.test.mjs`.

### P1-3 [FIXED] HTTP step ceiling bypass

Step ceiling now enforced at parse time in `goal-plan-parser.ts` (`DEFAULT_MAX_STEPS = 10`, per ADR-0003 hard ceiling).
Orchestrator default ceiling also `10`. Plans exceeding 10 steps are rejected before entering the store.
Tested in `bridge-goals-api.test.mjs` with an 11-step plan asserting `plan-step-ceiling-exceeded`.
Orchestrator test updated in `goal-orchestrator.test.mjs` (10-step completion + ceiling-reached on 11th).

### P1-4 [FIXED] PATCH archived project clears archivedAt

`projectStore.upsert()` preserves `existing.archivedAt`. Tested in
`bridge-projects-api.test.mjs` with PATCH-after-archive preserving archivedAt
and default listing exclusion.

## 5. Real-Use Experience Summary

### What Works Well

1. **Goal scoping is clear**: Creating a goal with a project scope feels natural.
   The `projectId` field on goals is visible and meaningful.

2. **Plan approval gate is solid**: The `awaiting-approval → approved` transition
   is a clear, auditable single-gate. The orchestrator refuses to advance before
   approval.

3. **Mutating-step gate is effective**: State-changing steps reliably enter
   `blocked-needs-gate`. The separate gate approval step is a strong safety
   invariant — no plan-level approval can bypass it.

4. **Tier enforcement works**: `workspace-write` steps on `patch-proposal` plans
   are correctly blocked with clear error messages.

5. **Orchestrator is well-structured**: Clean separation from HTTP layer.
   Every state transition is explicit. No hidden side effects.

6. **Status panel provides good visibility**: When a goal is active, the status
   panel shows progress, blocked gates, and goal summaries clearly.

### What Could Be Better

1. **Project scoping needs the upsert fix (B1)**: Without it, PATCH/archive/unarchive
   are broken for real use. This is the single highest-priority fix.

2. **Status panel gaps**: `memory`, `version`, `milestone`, `tests`, `commits`
   are all "not yet available." For real project use, at least `memory` would
   be valuable. These are v2.1 observability targets.

3. **No progress bar without active plan**: The progress bar only appears when
   a plan is executing. For projects with draft goals only, there's no visual
   indication of "work to be planned."

4. **Console UI is functional but utilitarian**: The dark theme CSS is clean but
   basic. For a "project workspace" used daily, more polish would improve
   usability (though this is explicitly not a v2.0 concern).

## 6. Security Verification

| Check | Result |
|-------|--------|
| No `shell/exec/spawn` in console or new endpoints | ✅ |
| `escapeHtml()` on all server-derived values in console HTML | ✅ (19 call sites) |
| Archive guards: default project not archivable | ✅ (HTTP 409 + UI guard) |
| `projectId` authoritative audit filtering | ✅ |
| PATCH only accepts `label`/`description`; rejects `key`/`createdAt`/`archivedAt` | ✅ |
| No hard-delete endpoint | ✅ |
| No AgentTeam, Model API, or execution endpoints | ✅ |

## 7. Conclusion

v2.0's core architecture — the Goal → Plan → Approve → Step → Gate → Audit flow —
is **solid and working correctly**. The orchestrator's safety invariants (tier
enforcement, step ceiling, fail-stop, gate blocking) are all verified. The
project workspace provides useful scoping and visibility.

The one blocking issue is **B1** (projectStore not upserted), which prevents
PATCH/archive/unarchive from working on implicitly-created projects. This should
be fixed before v2.1 begins.

Overall: **v2.0 is functionally sound, needs the B1 fix, and provides sufficient
real-use evidence for v2.1 readiness.**

---

*Validation run: `node --experimental-strip-types tests/validate-real-use.mjs` — all checks pass*
*Live server: `npm run start:local-server` on port 31337*
