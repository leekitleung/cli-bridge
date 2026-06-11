# CLI Bridge v2.3 — Implementation Handoff

**Status**: IMPLEMENTED — v2.3 AgentTeam Sequential MVP Closeout
**Date**: 2026-06-12 (original handoff 2026-06-11)
**Based on**: `CLI-BRIDGE-v2.3-SPIKE-AGENTTEAM-FEASIBILITY.md` (v2.3 spike)
**Spans**: Historical implementation handoff. Implementation evidence now lives in `CLI-BRIDGE-v2.3-CLOSEOUT-REVIEW.md`.

---

## 0. Purpose

This document is the v2.3 implementation handoff. It translates the v2.3 feasibility
spike into a concrete, reviewer-ready blueprint for the v2.3 AgentTeam Sequential MVP.

**Post-closeout note (2026-06-12):** v2.3 has since been implemented and closeout-approved. The design-time wording below is preserved as the original execution contract; use the closeout review and changelog for current implementation evidence.

**It is NOT a code implementation.** No runtime, no store, no HTTP endpoint, no
orchestrator, no provider registry, no model API exists yet.

Before opening `feat/v2.3-agentteam-sequential` as an implementation branch,
this handoff must be reviewed and approved.

---

## 1. Scope & Authorization

### 1.1 What v2.3 Will Implement

| Capability | Detail |
|-----------|--------|
| TeamSpec data model | Schema + validation + in-memory store. Read-only GET and creation POST to be designed. |
| Sequential slot orchestrator | Dispatches logical slots one at a time within an approved plan. |
| Patch-only artifact contract | Structured slot output with file path lists, summaries, and verification notes. |
| Patch conflict detection | Compare file paths across sequential slot outputs; block overlap unless reviewed. |
| Provider capability declaration | Endpoint metadata declares `canExecute`, `isolationModes`, `maxConcurrentBridgeSlots`. |
| PolicyEngine rejection | Reject parallel, worktree, branch, shared-workspace, auto-apply at creation/dispatch time. |
| Per-slot audit | Audit events tagged with `slotId` and `planStepId`. |
| Console TeamSpec view | Read-only display of active team, slot status, provider, mode. |

### 1.2 What v2.3 Will NOT Implement

- Bridge-governed parallel slots (`maxConcurrentBridgeSlots` remains 1).
- Worktree, branch, or shared-workspace isolation.
- Multi-provider teams.
- Provider registry runtime.
- Model API, PlannerModel, CriticModel.
- Workspace-write auto-apply, auto-commit, auto-push, auto-merge.
- WorkBuddy promoted to executor.
- Shell, exec, run, command endpoints.
- Scheduler, queue, daemon, or background dispatch.

### 1.3 Implementation branch

- Branch name: `feat/v2.3-agentteam-sequential`
- Base: `main` at or after `fc8c2ca`.

---

## 2. Provider Evidence Reconciliation

### 2.1 Claude Code

| Attribute | Value |
|-----------|-------|
| `productNativeParallelism` | **reported by official docs, pending citation verification** |
| Evidence tier | Tier 1 (official docs) — citation must be verified before this is treated as confirmed in any runtime decision |
| Action for implementer | Locate and cite the specific Claude Code documentation describing subagent/session parallelism. If unavailable, downgrade to `unknown / requires evidence` in the provider capability declaration |
| Bridge impact | Even if confirmed, cli-bridge v2.3 cannot govern Claude Code's internal parallelism. The bridge gap (§3.1 of spike) is the binding constraint |

### 2.2 Codex CLI

| Attribute | Value |
|-----------|-------|
| `productNativeParallelism` | **unknown / requires evidence** |
| Evidence tier | Tier 4 (unknown) — no official docs or local experiment confirms multi-session parallelism |
| Action for implementer | Do NOT assert Codex supports parallel execution. If evidence emerges during implementation, update this handoff |
| Bridge impact | Same bridge gap as Claude Code; even if Codex supported product-native parallelism, cli-bridge cannot govern it |

### 2.3 WorkBuddy

WorkBuddy remains a non-executing task source/result sink. `canExecute: false`. No change in v2.3.

---

## 3. TeamSpec Schema (Final Draft)

### 3.1 Core types

```typescript
// v2.3 TeamSpec — design draft for implementation handoff.
// NOT a runtime contract. Field names, validators, and store are defined in implementation.

interface TeamSpec {
  /** Unique team identifier. */
  id: string;

  /** Project this team belongs to. */
  projectId: string;

  /** The approved goal this team executes. */
  goalId: string;

  /** The approved plan derived from the goal. */
  planId: string;

  /** Logical roles/tasks in this team. May be >1 (planner, executor, verifier),
   *  but bridge governs only one slot at a time (maxConcurrentBridgeSlots = 1). */
  logicalSlots: AgentSlot[];

  /** Hard ceiling on concurrent bridge-governed slots. v2.3 MVP: 1. */
  maxConcurrentBridgeSlots: 1;

  /** Execution mode. v2.3: only 'sequential'. */
  mode: 'sequential';

  /** File-system isolation strategy. v2.3: only 'patch-only'. */
  isolation: 'patch-only';

  /** Single provider. */
  provider: 'codex' | 'claude';

  /** Registered bridge endpoint id (e.g., 'claude-code-command'). */
  endpointId: string;

  /** Policy requirements this team must satisfy. */
  policyRequirements: PolicyRequirement[];

  /** Overall team status. */
  status: 'pending-approval' | 'approved' | 'executing' | 'done' | 'failed' | 'cancelled';

  createdAt: number;
  updatedAt: number;
  approvedAt?: number;
}

interface AgentSlot {
  /** Unique within this team. */
  id: string;

  /** Role label. */
  role: 'planner' | 'executor' | 'verifier';

  /** Index into the approved plan's steps array. */
  stepIndex: number;

  /** Execution tier for this slot. */
  tier: 'patch-proposal' | 'workspace-write';

  /** v2.3: always 'patch-only'. */
  isolation: 'patch-only';

  /** Current slot status. */
  status: 'pending' | 'ready' | 'executing' | 'blocked-needs-gate' | 'done' | 'failed' | 'cancelled';
}

interface PolicyRequirement {
  kind: 'human-gate' | 'conflict-detection' | 'patch-artifact-required' | 'output-verification';
  detail: string;
}
```

### 3.2 Validation rules

| Rule | Condition | Error |
|------|-----------|-------|
| `projectId` must exist | `projectStore.get(ts.projectId) !== undefined` | Project not found |
| `projectId` must not be archived | `project.archivedAt === undefined` | Project is archived |
| `goalId` must be approved | `goalStore.get(ts.goalId)?.status === 'approved'` | Goal not approved |
| `planId` matches `goalId` | `plan.goalId === ts.goalId` | Plan/goal mismatch |
| `logicalSlots` length 1–10 | `1 <= ts.logicalSlots.length <= 10` | Invalid slot count |
| `maxConcurrentBridgeSlots` = 1 | `ts.maxConcurrentBridgeSlots === 1` | Only 1 concurrent slot allowed in v2.3 |
| `mode` = 'sequential' | `ts.mode === 'sequential'` | Only sequential mode in v2.3 |
| `isolation` = 'patch-only' | `ts.isolation === 'patch-only'` | Only patch-only isolation in v2.3 |
| All `stepIndex` values in plan range | `stepIndex >= 0 && stepIndex < plan.steps.length` | Step index out of range |
| No provider without `canExecute` | Endpoint capability must declare `canExecute: true` | Provider not execution-capable |

### 3.3 Critical note

In v2.3, an AgentTeam **may contain multiple logical slots** (e.g., planner + executor + verifier), but **cli-bridge governs only one slot at a time** (`maxConcurrentBridgeSlots` = 1). This is sequential bridge-governed orchestration. The slot multiplicity is declarative (what roles exist), not concurrent (how many run at once).

---

## 4. Sequential Orchestrator State Machine

### 4.1 Slot lifecycle

```
          ┌──────────┐
          │  pending  │
          └────┬─────┘
               │ slot becomes next in sequence
               ▼
          ┌──────────┐
          │  ready    │
          └────┬─────┘
               │ dispatch (if tier = patch-proposal)
               │ or dispatch → gate (if tier = workspace-write)
               ▼
          ┌──────────────┐
          │  executing    │──────── timeout / error ──►  failed
          └──────┬───────┘
                 │ tier = workspace-write
                 ▼
          ┌────────────────────┐
          │ blocked-needs-gate  │──── user confirms gate ──►  executing (resume)
          └────────┬───────────┘
                   │ user rejects gate
                   ▼
                cancelled
                 │
    ┌────────────┼────────────┐
    ▼            ▼            ▼
  done        failed      cancelled
```

### 4.2 Sequential dispatch rules

1. TeamSpec must be approved (`status: 'approved'`).
2. Slots execute in `stepIndex` order.
3. Only one slot is `executing` at any time.
4. Slot N+1 does not start until slot N reaches `done`, `failed`, or `cancelled`.
5. `failed` on any slot stops the entire team (`status: 'failed'`).
6. `cancelled` stops the team.
7. `blocked-needs-gate` pauses the slot; the team is paused until gate is resolved.

### 4.3 Mapping to existing Goal / Plan / Step

| AgentTeam concept | Existing bridge concept | Notes |
|-------------------|------------------------|-------|
| TeamSpec | New schema | Stored in a new `InMemoryTeamSpecStore` or extended goal store |
| AgentSlot | PlanStep | Slot maps 1:1 to a plan step by `stepIndex` |
| Slot execution | GoalOrchestrator.advance() | Reuse or wrap the existing orchestrator |
| Per-step gate | PlanStep blocked-needs-gate | Existing gate model applies unchanged |
| Step ceiling | ADR-0003 hard 10 | Total steps across all slots; same ceiling |
| Audit | AuditLog.createAndAppend() | Add `slotId` and `teamId` to audit event metadata |

### 4.4 What must NOT happen

- No slot runs concurrently with another.
- No slot starts before plan approval.
- No slot bypasses per-step gate for workspace-write tiers.
- No slot output auto-applied.
- No team dispatch without human approval of the TeamSpec.

---

## 5. Patch-Only Artifact Contract

### 5.1 Slot output artifact

```typescript
interface SlotArtifact {
  /** Which team and slot produced this. */
  teamId: string;
  slotId: string;
  planStepId: string;

  /** Human-readable summary of what was done. */
  summary: string;

  /** List of file paths that were proposed for modification.
   *  Used by conflict detection. */
  proposedFiles: string[];

  /** Verification notes (lint output, test results, manual checks). */
  verificationNotes?: string;

  /** Raw provider output — redaction rules apply before storage. */
  rawProviderOutput?: string;

  /** Whether the raw output was redacted. */
  outputRedacted: boolean;

  /** Unix-ms timestamp. */
  createdAt: number;
}
```

### 5.2 Conflict detection algorithm (design)

```
Input: artifacts: SlotArtifact[] (ordered by stepIndex)

1. Collect all proposedFiles from artifacts[0..N-1].
2. For artifact N, check each path in proposedFiles:
   a. If path appears in any prior artifact → CONFLICT.
   b. If path is a directory prefix of a prior path → CONFLICT.
   c. If path is a file prefix of a prior directory → CONFLICT.
3. If CONFLICT → block apply/merge; flag overlapping slots for human review.
4. If NO CONFLICT → artifacts are clean; human may approve apply/merge.

Output: { clean: boolean, conflicts: { path, slotA, slotB }[] }
```

### 5.3 Fallback rule

If a slot does not produce a machine-readable `SlotArtifact` (no `proposedFiles`, no structured output), the orchestrator must NOT apply or merge its output. The slot result is retained as a review artifact only, and the team status should note the missing artifact boundary.

---

## 6. Provider Capability Declaration Shape

### 6.1 Endpoint capability metadata

```typescript
// Extension to existing endpoint registration metadata.
// v2.3 adds these fields — runtime behavior is gated by PolicyEngine checks.

interface ProviderCapability {
  /** Whether this endpoint can review code/output. */
  canReview: boolean;

  /** Whether this endpoint can propose patches. */
  canProposePatch: boolean;

  /** Whether this endpoint can verify output (lint, test). */
  canVerify: boolean;

  /** Whether this endpoint can execute (propose + apply).
   *  Workspace-write still requires ADR-0003 per-step gate. */
  canExecute: boolean;

  /** Whether the provider product supports internal parallelism.
   *  Evidence tier must be cited. */
  productNativeParallelism: 'confirmed' | 'reported' | 'unknown';

  /** Evidence tier for productNativeParallelism claim. */
  productNativeParallelismEvidenceTier: 1 | 2 | 3 | 4;

  /** Whether cli-bridge can govern parallel slots through this endpoint.
   *  v2.3: always false. */
  bridgeGovernedParallelSlots: false;

  /** Maximum concurrent slots cli-bridge can govern. v2.3: 1. */
  maxConcurrentBridgeSlots: 1;

  /** Available isolation modes through this endpoint. */
  isolationModes: ('patch-only')[];

  /** Supported execution modes. */
  supportedModes: ('review-only' | 'patch-proposal' | 'workspace-write' | 'verify')[];
}
```

### 6.2 Existing endpoints

Current endpoints declare no explicit capability metadata. In v2.3, the Claude Code and Codex command review adapters must declare:

- Claude Code: `canExecute: true`, `productNativeParallelism: 'reported'`, `bridgeGovernedParallelSlots: false`.
- Codex: `canExecute: true`, `productNativeParallelism: 'unknown'`, `bridgeGovernedParallelSlots: false`.

### 6.3 Rules

- Tool/provider names do NOT grant authority. Only declared capability does.
- `canExecute: true` does NOT grant workspace-write. Workspace-write still requires ADR-0003 per-step gate.
- Provider/model output can NEVER authorize execution, gate bypass, or apply/merge.

---

## 7. PolicyEngine Invariants

### 7.1 At TeamSpec creation time

| # | Invariant | Rejection |
|---|-----------|-----------|
| C1 | `projectId` exists and is not archived | 404 / 409 |
| C2 | `goalId` is approved; `planId` matches goal | 400 |
| C3 | `logicalSlots.length >= 1 && <= 10` | 400 |
| C4 | `maxConcurrentBridgeSlots === 1` | 400 — "Only 1 concurrent slot in v2.3" |
| C5 | `mode === 'sequential'` | 400 — "Only sequential mode in v2.3" |
| C6 | `isolation === 'patch-only'` | 400 — "Only patch-only isolation in v2.3" |
| C7 | Endpoint `canExecute === true` | 400 — "Provider not execution-capable" |
| C8 | No `canExecute` without declared capability | 400 |

### 7.2 At dispatch time

| # | Invariant | Rejection |
|---|-----------|-----------|
| D1 | TeamSpec is approved | 409 |
| D2 | Only one slot executing | 409 — "A slot is already executing" |
| D3 | Slot `tier === 'workspace-write'` → must enter gate | Blocked-needs-gate (existing model) |
| D4 | Slot output has machine-readable artifact boundary | Block apply/merge |
| D5 | No overlapping file paths across slot artifacts | Block apply/merge; flag for review |
| D6 | Step ceiling (10) not exceeded | 409 — "Step ceiling reached" |
| D7 | Consecutive failure stops team | Team status → failed |

### 7.3 Explicitly rejected

| Request | Response |
|---------|----------|
| `maxConcurrentBridgeSlots > 1` | 400 — "Bridge-governed parallel slots not available" |
| `mode !== 'sequential'` | 400 — "Only sequential mode in v2.3" |
| `isolation !== 'patch-only'` | 400 |
| Worktree / branch / shared-workspace | 400 |
| Auto-apply / auto-commit / auto-push | 400 |
| WorkBuddy as executor | 400 — "WorkBuddy is a task system, not an executor" |
| Provider without declared capability | 400 |

### 7.4 Error response shape

```json
{
  "message": "Policy violation: maxConcurrentBridgeSlots must be 1 in v2.3",
  "violated": "maxConcurrentBridgeSlots",
  "allowed": ["maxConcurrentBridgeSlots: 1"],
  "remediation": "Set maxConcurrentBridgeSlots to 1 and mode to 'sequential'."
}
```

---

## 8. Audit Requirements

v2.3 audit events must include per-slot metadata:

| Event field | Purpose |
|-------------|---------|
| `teamId` | Which team the event belongs to |
| `slotId` | Which slot is executing |
| `planStepId` | Which plan step is executing |
| `tier` | The execution tier of the slot |
| `event` | `team-created`, `team-approved`, `slot-started`, `slot-gated`, `slot-done`, `slot-failed`, `team-done`, `team-failed` |

Existing audit infrastructure (`InMemoryAuditLog`, `AuditEvent`) supports adding these fields as optional metadata.

---

## 9. Test Plan

### 9.1 TeamSpec validation tests

| Test | Expected |
|------|----------|
| Create valid sequential TeamSpec | 201 |
| Reject `maxConcurrentBridgeSlots > 1` | 400 |
| Reject `mode !== 'sequential'` | 400 |
| Reject `isolation !== 'patch-only'` | 400 |
| Reject unknown project | 404 |
| Reject archived project | 409 |
| Reject unapproved goal | 400 |
| Reject plan/goal mismatch | 400 |
| Reject `logicalSlots` empty or >10 | 400 |
| Reject stepIndex out of plan range | 400 |
| Reject provider without `canExecute` | 400 |
| `logicalSlots.length > 1` with `maxConcurrentBridgeSlots = 1` is accepted | 201 |

### 9.2 Orchestrator tests

| Test | Expected |
|------|----------|
| Sequential execution: 3 slots execute in order | Slot 0 done → slot 1 starts → slot 2 starts |
| Workspace-write slot enters blocked-needs-gate | Slot status = blocked-needs-gate |
| Failed slot stops team | Team status = failed; subsequent slots not started |
| Cancelled slot stops team | Team status = cancelled |
| Step ceiling: plan with 11 steps rejected at parse | 409 (existing ADR-0003) |
| Slot output without artifact boundary → block apply | Apply rejected |
| Patch conflict: two slots touch same file → flag | Conflict detected; apply blocked |

### 9.3 Patch conflict detection tests

| Test | Expected |
|------|----------|
| No overlap → clean | `{ clean: true }` |
| Same file in two slots → conflict | `{ clean: false, conflicts: [...] }` |
| File in dir overlap → conflict | Same |
| Empty proposedFiles in all slots → clean | `{ clean: true }` |
| Overlap across non-adjacent slots → conflict | Conflict detected even if slots are not consecutive |

### 9.4 Audit tests

| Test | Expected |
|------|----------|
| Team creation produces audit event | `team-created` with teamId |
| Slot execution produces audit event | `slot-started` with slotId, planStepId |
| Gate block produces audit event | `slot-gated` |
| Slot done/failed produces audit event | `slot-done` / `slot-failed` |

### 9.5 Security boundary tests

| Test | Expected |
|------|----------|
| No shell/exec/run/command endpoints added | Path allowlist unchanged |
| WorkBuddy cannot be executor | `canExecute` declaration rejected |
| Console has no execute/dispatch/apply buttons for AgentTeam | No button text matches |
| Auto-apply/auto-commit/auto-push rejected | 400 at creation/dispatch |

### 9.6 Console tests

| Test | Expected |
|------|----------|
| TeamSpec section appears in console nav | "Team" or "AgentTeam" nav tab present |
| Team status display | Shows team mode, provider, slot statuses |
| No execute/dispatch/apply buttons | Button count = 0 for execution actions |
| Dynamic text escaped | Slot role, summary, provider name all escaped |

---

## 10. Forbidden Implementation List

The following MUST NOT appear in any v2.3 implementation artifact:

- Bridge-governed parallel slot orchestration.
- Worktree / branch / shared-workspace creation or management.
- Multi-provider team dispatch.
- Provider registry runtime (static capability declaration is fine).
- Model API, PlannerModel, CriticModel, summary agent integration.
- Workspace-write auto-apply, auto-commit, auto-push, auto-merge.
- WorkBuddy promoted to executor (`canExecute: true` for WorkBuddy endpoint).
- Shell, exec, run, command endpoints.
- Scheduler, queue, daemon, background dispatch, cron-based auto-run.
- Silent fake parallelism (sequential disguised as concurrent).
- Claude Code product-native parallelism written as `confirmed` without verified citation.
- Codex product-native parallelism written as `supported` without Tier 1–2 evidence.

---

## 11. Console Impact

The following console sections need updates in v2.3 implementation:

| Element | Content |
|---------|---------|
| Nav tab | "Team" or "AgentTeam" |
| Team view | TeamSpec detail: mode, provider, isolation, slot status table |
| Slot status | Per-slot: role, stepIndex, tier, status, artifact summary |
| Pending gate | Same as existing blocked-needs-gate indicator |
| Conflict indicator | If patch conflict detected: "Review required" badge |

No execute, dispatch, apply, merge, confirm, or send buttons.

---

## 12. Docs Synchronization

### 12.1 Documents updated in this commit

| Document | Change |
|----------|--------|
| `CLI-BRIDGE-v2.3-SPIKE-AGENTTEAM-FEASIBILITY.md` | Status: add reference to this handoff |
| `PLAN-AGENTTEAM-PROJECT-CONTROL-PLANE.md` | Status: add v2.3 handoff reference |

### 12.2 Documents NOT updated

| Document | Reason |
|----------|--------|
| `README.md` | v2.3 is not yet a user-facing capability; roadmap/status update deferred to implementation merge |
| `bridge-projects-api.md` | No project API surface changes in v2.3 |
| `bridge-workbuddy-api.md` | WorkBuddy unchanged |
| Runtime code | Handoff only; no implementation |

---

*This handoff is a decision artifact. Implementation begins only after review approval.*
