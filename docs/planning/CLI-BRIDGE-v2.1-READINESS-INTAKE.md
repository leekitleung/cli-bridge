# CLI Bridge v2.1 — Readiness Intake

**Date**: 2026-06-10 (updated 2026-06-11 — B3 explicit project creation + v2.1.1 hardening delivered)
**Based on**: `docs/reviews/CLI-BRIDGE-v2.0-REAL-USE-VALIDATION.md`
**Status**: B3 RESOLVED — B3 Resolution + v2.1.1 observability hardening implemented

## 0. v2.1 Readiness Verdict

**✅ v2.1 IS READY — all P1 code review blockers fixed.**

5 P1 issues identified in code review have been addressed:
- **P1-1** goal-plan CLI safety args → now uses full `CLAUDE_REVIEW_ARGS` (disabled tools, plan mode, no session persistence)
- **P1-2** cwd from HTTP body → rejected (400), server uses `process.cwd()`
- **P1-3** HTTP step ceiling bypass → enforced at parse time (`DEFAULT_MAX_STEPS = 10`, ADR-0003 hard ceiling)
- **P1-4** implicit project not upserted → upserted in goal/review/prompt creation handlers
- **P1-5** PATCH archived project clears `archivedAt` → preserved in `upsert()`

**408/408 tests pass; typecheck and lint clean.**

v2.0's core architecture is solid and all known blocking issues are resolved.

## 0a. v2.1 Implementation Summary (2026-06-11)

The v2.1 read-only observability baseline has been implemented. All features are
deterministic derived views from existing stores — no new execution authority,
no raw content persistence, no permission expansion.

### Implemented

| Feature | Detail |
|---------|--------|
| `GET /bridge/projects/:key/timeline` | Server-derived conversation timeline from goals, plans, reviews, prompts, audit events |
| `GET /bridge/projects/:key/audit` | Rich audit view with `?limit=` and `?type=` query params |
| `GET /bridge/projects/:key/memory` | Deterministic derived memory facts from project data |
| `GET /bridge/projects/:key/verification` | Harness verification placeholder (status=unavailable) |
| shared DTOs | `ConversationTimelineEntry/View`, `DerivedMemoryEntry/View`, `ProjectAuditEntry/View`, `HarnessVerificationRecord/View` |
| Console sync | Timeline, audit, memory, verification sections consume server-derived views |
| New builder module | `apps/local-server/src/project-observability/builders.ts` — pure functions |
| Tests | 18 new API + isolation + boundary tests in `bridge-project-observability.test.mjs` |

### Placeholder / Unavailable

| Feature | Status |
|---------|--------|
| Harness verification | `status: 'unavailable'` — no real harness integration |
| Derived memory | Deterministic from project metadata only — no long-term MemoryStore, no embeddings |
| Transcript import | NOT in scope — future per `PLAN-PROJECT-CONVERSATION-TIMELINE.md` |
| Real harness results | NOT in scope — needs test runner integration |

### Explicitly NOT in v2.1

| Feature | Reason |
|---------|--------|
| AgentTeam / multi-slot execution | FUTURE — needs feasibility spike |
| Model API / LLM summary | FUTURE — needs ADR-0004 |
| Hard-delete | NOT BASELINE |
| Workspace-write auto-apply | NOT BASELINE |
| New execution endpoints | NOT BASELINE |
| Transcript import | FUTURE |

## 2. Recommended v2.1 Slice: Read-Only Observability

Per `CLI-BRIDGE-v2.1-AGENTTEAM-DIRECTIONAL-REVIEW.md` §3.4, the v2.1 scope
should be **read-only observability only**:

### In Scope

| Feature | Rationale |
|---------|-----------|
| **ConversationTimeline** | Chronological view of all project activity across goals, reviews, prompts, audit events |
| **Derived Memory** | Computed project memory from audit events, goal completions, review findings |
| **Audit View** | Rich, filterable audit event browser (currently only `latestAudit` in status) |
| **Harness Verification Records** | Track what tests/lints/typechecks ran against which plan steps |

### Rationale for Read-Only

These features add **visibility without adding execution authority**. They:
- Don't change the security boundary
- Don't require new CLI/agent integrations
- Build directly on existing data (audit events, goals, plans)
- Make v2.0's data more actionable for daily use
- Can be implemented as pure data views with no mutation endpoints

### Explicitly Out of Scope (Unchanged)

| Feature | Reason |
|---------|--------|
| **AgentTeam** (multi-agent orchestration) | NOT BASELINE; requires feasibility spike per v2.1 directional review |
| **Model API** (PlannerModel, CriticModel, etc.) | NOT BASELINE; requires dedicated ADR-0004 |
| **Hard-delete** (`DELETE /bridge/projects/:key`) | NOT BASELINE; archive-only is sufficient |
| **Execution endpoints** for Claude/Codex | NOT BASELINE; v2.0's review-only transport is the boundary |
| **Workspace-write auto-apply** | NOT BASELINE; needs separate ADR and safety review |
| **Single-provider multi-slot** | NOT BASELINE; needs feasibility spike |
| **Headless HTTP gate** | NOT BASELINE; console-only gate remains the control surface |

### Why Not More?

1. **AgentTeam needs real usage data first**: The directional review explicitly
   requires v2.0 usage feedback before planning AgentTeam. We now have that
   feedback, but AgentTeam still needs a feasibility spike.

2. **Model API is a product-form change**: Adding API keys, billing, vendor
   dependencies, and prompt-injection surfaces requires a dedicated ADR.

3. **Observability is the highest-ROI next step**: The status panel already
   has `memory: "not yet available"` placeholders. Filling these in makes v2.0
   immediately more useful without adding risk.

## 3. Implementation Guidance for v2.1

### Architecture Principle

All v2.1 features should be **read-only data views**. They:
- Query existing stores (goalStore, auditLog, projectStore)
- Compute derived views (timelines, memory summaries, verification maps)
- Expose via GET endpoints (`/bridge/projects/:key/timeline`, etc.)
- Render in the project console status panel and new workspace sections

They must NOT:
- Create new mutation endpoints
- Call CLI agents or external processes
- Modify goal/plan/step state
- Bypass existing auth (pairing token + origin guard)

### Suggested Endpoint Additions

```
GET /bridge/projects/:key/timeline       → ConversationTimeline
GET /bridge/projects/:key/memory          → DerivedMemory
GET /bridge/projects/:key/audit           → Rich audit view (paginated, filterable)
GET /bridge/projects/:key/verification    → Harness verification records
```

All read-only, all project-scoped, all using existing auth.

## 4. Real-Use Evidence Supporting v2.1

| Evidence | Supports |
|----------|----------|
| Goal creation + project scoping works naturally | Timeline grouping by project |
| Audit events carry `projectId` authoritatively | Audit view filtering |
| Status panel has `memory: []` placeholder | Derived memory display |
| 6-step plan with mutating gates verified | Verification records per step |
| `latestAudit` works but is limited | Rich audit browser |

## 5. Next Slice After v2.1

After v2.1 read-only observability is delivered and validated, the next slices
in priority order:

1. **B3 resolution**: `POST /bridge/projects` for explicit project creation
2. **AgentTeam feasibility spike**: Can we do single-provider multi-slot safely?
   (Requires worktree/branch/patch isolation design)
3. **ADR-0004**: Model API decision (if accepted, start with single opt-in PlannerModel)
4. **Workspace-write**: Apply patches to worktree behind gate (separate ADR)

## 6. Kill Gates

Per v2.1 directional review §3.9:

- After v2.1 observability is delivered → review before any execution-layer work
- AgentTeam feasibility spike must complete → review before implementation
- Model API ADR must be accepted → review before any model integration
- Each mutating feature (workspace-write, multi-slot) → separate ADR + gate

---

*This readiness note updates and supersedes no prior document. It is an intake
assessment based on v2.0 real-use validation evidence.*

---

## B3 Resolution + v2.1.1 Hardening (2026-06-11)

B3 (explicit project creation) resolved with the following additions:

| Feature | Detail |
|---------|--------|
| `POST /bridge/projects` | Explicit project creation with `key` (required), `label`, `description` |
| `InMemoryProjectStore.create()` | Strict create — returns null on duplicate (never overwrites) |
| Console "New Project" UI | Minimal key input + "+ New" button in project nav |
| v2.1.1: `ObservabilityInput.reviews.packetId` | Type declaration now includes `packetId: string` |
| v2.1.1: audit `limit=` strictness | Empty string now returns 400; `5abc`/`1.5` already rejected |
| v2.1.1: console `refreshAll()` resilience | Uses `Promise.allSettled` — single fetch failure doesn't block rendering |
| `docs/contracts/bridge-projects-api.md` | Updated with POST /bridge/projects section |
