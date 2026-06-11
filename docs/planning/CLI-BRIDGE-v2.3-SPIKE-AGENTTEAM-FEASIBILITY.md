# CLI Bridge v2.3 Spike — Single-Provider Multi-Slot Feasibility

**Status**: SPIKE COMPLETE — Implementation Handoff Allowed (with constraints)
**Date**: 2026-06-11
**Branch**: feat/v2.3-spike-agentteam-feasibility
**Spans**: PLANS only. No implementation code.

---

## 0. Scope & Authorization

### What This Spike Covers

- Feasibility of single-provider, multi-slot AgentTeam execution via Codex or Claude Code CLI.
- Isolation strategy comparison: patch-only, worktree, branch, shared-workspace.
- Minimum policy invariants required for v2.3 implementation.
- Draft TeamSpec schema (design artifact, not runtime contract).
- Console impact assessment for future UI requirements.
- Kill-gate decision: whether to proceed to implementation handoff.

### What This Spike Does NOT Cover

- AgentTeam runtime implementation.
- TeamSpec HTTP endpoint or store.
- Execution provider registry code.
- Model API integration, PlannerModel, CriticModel.
- WorkBuddy promoted to executor (remains task source / result sink).
- Shell/exec/run/command endpoint additions.
- Workspace-write auto-apply, auto-commit, auto-push, auto-merge.
- Real CLI spawn in spike documents.

### Reference Documents

| Document | Role |
|----------|------|
| `PLAN-AGENTTEAM-PROJECT-CONTROL-PLANE.md` | AgentTeam architecture, capability model, PolicyEngine invariants |
| `PLAN-LAYERED-ORCHESTRATION-AND-CONSOLE.md` | Console layering, orchestration flow |
| `ADR-0003-controlled-execution-layer.md` | Execution tiering, gate requirements, step ceiling |
| `README.md` | Current security boundaries |
| `bridge-workbuddy-api.md` | WorkBuddy non-executing contract |

---

## 1. Provider Capability Feasibility Matrix

### 1.1 Codex CLI

| Capability | Supported? | Evidence |
|-----------|-----------|----------|
| `canReview` | ✅ Yes | v1.6-v1.7 review endpoint, Claude review args |
| `canProposePatch` | ✅ Yes | v2.0 plan-step patch-proposal tier |
| `canVerify` | ⚠️ Partial | Can run lint/test, but output is unstructured; no formal harness integration |
| `canExecute` | ✅ Yes (gated) | ADR-0003 workspace-write tier; per-step gate required |
| `canWriteFile` | ✅ Yes (gated) | workspace-write tier only, behind gate confirm |
| `supportsParallelSlots` | ❌ No | Codex CLI is a single interactive session. Cannot run multiple concurrent `codex exec` instances in the same worktree without file conflicts |
| `maxSlots` | 1 | Single process, single worktree |
| `isolationModes` | `patch-only` (current), `worktree` (future, needs ADR) | Current bridge only uses patch-proposal; worktree writes are not implemented |

**Verdict**: Codex CLI cannot support true parallel multi-slot execution in its current form. It can serve as the single provider for a team, but all slots must execute sequentially or in isolated worktrees.

### 1.2 Claude Code CLI

| Capability | Supported? | Evidence |
|-----------|-----------|----------|
| `canReview` | ✅ Yes | Review endpoint adapters (claude-code-command) |
| `canProposePatch` | ✅ Yes | v2.0 plan-step patch-proposal tier |
| `canVerify` | ⚠️ Partial | Same as Codex — unstructured output |
| `canExecute` | ✅ Yes (gated) | workspace-write tier, per-step gate |
| `supportsParallelSlots` | ❌ No | Same single-session limitation as Codex |
| `maxSlots` | 1 | Single process |
| `isolationModes` | `patch-only` (current), `worktree` (future) | Same as Codex |

**Verdict**: Same single-slot limitation. No real provider-level parallelism.

### 1.3 WorkBuddy (as executor endpoint)

| Capability | Supported? | Evidence |
|-----------|-----------|----------|
| `canExecute` | ❌ Not in scope | v2.2 explicitly positions WorkBuddy as non-executing task source/result sink |
| `supportsParallelSlots` | ❌ Not applicable | Task system only; no execution authority |

**Verdict**: WorkBuddy remains a task system, not an executor. Promoting it to `canExecute: true` requires a separate ADR.

### 1.4 Combined Feasibility

**Key finding**: Neither Codex CLI nor Claude Code CLI supports native parallel slots in a single worktree. Both are single-process, interactive CLI tools.

**Implication**: Multi-slot AgentTeam execution cannot rely on provider-native parallelism. It MUST use one of:
- Sequential execution (single provider, ordered slots).
- Worktree/branch isolation (one worktree per slot, provider instances in separate processes).
- Multiple provider instances in separate directories.

---

## 2. Multi-Slot Feasibility Assessment

### 2.1 Sequential Execution (Minimum Viable)

**How it works**: A single provider instance executes slots one at a time. Planner → Executor-A → Executor-B → Verifier, in order. State from slot N is committed before slot N+1 starts.

**Feasibility**: ✅ Immediately feasible with current bridge architecture.

**Constraints**:
- Not "parallel" in the traditional sense.
- Slot output must be committed or clearly delineated before next slot runs.
- Race conditions still possible if two slots write overlapping files in sequence.
- Step ceiling (ADR-0003 hard 10) limits total plan steps, not per-slot steps.

**Recommended for**: v2.3 minimum viable implementation.

### 2.2 Worktree Isolation (Multi-Process)

**How it works**: `git worktree add` creates an isolated working directory per slot. Each slot has its own Codex/Claude process. Slots truly run concurrently in separate directories.

**Feasibility**: ⚠️ Requires ADR on git worktree creation authority. Current bridge has no `git worktree` or `git branch` endpoint.

**Risks**:
- Worktree creation/cleanup must be audited and bounded.
- Overlapping file patches require merge reconciliation.
- Provider processes in different worktrees can still affect shared `.git` directory.

**Recommended for**: v2.4+ advanced mode, after sequential mode is stable.

### 2.3 Branch Isolation

**How it works**: Each slot operates on a dedicated git branch. Merges happen after per-slot gate approval.

**Feasibility**: ⚠️ Higher complexity than worktree. Requires merge conflict detection, branch lifecycle management, and explicit merge gates.

**Recommended for**: POST-v2.3; needs dedicated ADR.

### 2.4 Shared Workspace (DANGEROUS)

**How it works**: Multiple slots write to the same working directory concurrently.

**Feasibility**: ❌ Explicitly unsafe. Current bridge has no file locking, no merge conflict detection, and no concurrent-write safety.

**Verdict**: MUST BE REJECTED for v2.3. If ever considered, requires its own ADR with safety constraints, merge conflict detection, and post-write verification.

### 2.5 Recommended v2.3 Minimum Viable Isolation

```
Sequential, single-provider, patch-only (no workspace-write auto-apply).
Each slot runs to completion before the next starts.
Overlapping file writes within a single sequential execution must be flagged as conflict.
```

---

## 3. Isolation Strategy Recommendation

| Strategy | v2.3 | Rationale |
|----------|------|-----------|
| Sequential, patch-only | ✅ Recommended | Safe, auditable, minimal new surface. Uses existing patch-proposal tier. |
| Worktree isolation | ❌ Deferred | Requires git worktree ADR. Too complex for minimum viable. |
| Branch isolation | ❌ Deferred | Requires merge gate ADR. |
| Shared workspace | ❌ Blocked | Inherently unsafe. May require separate ADR with file locking if ever considered. |

---

## 4. Policy Invariants (v2.3 Required)

These invariants must be enforced by the v2.3 implementation. They build on ADR-0003 and the AgentTeam control plane plan.

| # | Invariant | Source |
|---|-----------|--------|
| P1 | Plan must be approved before dispatch | ADR-0003 §7.3 |
| P2 | State-mutating step requires per-step gate confirm | ADR-0003 §7.3 |
| P3 | Provider capability must be explicitly declared; tool names do not grant authority | AgentTeam Plan §4 |
| P4 | Parallel execution requires `supportsParallelSlots=true` AND `maxSlots >= 2` | AgentTeam Plan §4 |
| P5 | If parallel is unavailable, fallback must be explicit (sequential or rejected), never silently faked | AgentTeam Plan §4 |
| P6 | Step ceiling (hard 10) applies to total plan steps across all slots | ADR-0003 |
| P7 | Model/provider output cannot authorize execution, gate bypass, or workspace-write | ADR-0003, AgentTeam Plan §4.1 |
| P8 | Overlapping file patches across slots require conflict detection | This spike |
| P9 | Execution provider registry is future; v2.3 may hardcode a single known provider | This spike |
| P10 | WorkBuddy remains task source/result sink; NOT promoted to executor | v2.2 contract |

---

## 5. Minimal TeamSpec Schema (Draft)

This is a design artifact, not an implementation contract. It informs the v2.3 implementation handoff.

```text
TeamSpec {
  id: string;                    // unique team id
  projectId: string;             // scoped to a project
  goalId: string;                // the goal this team executes
  planId: string;                // the approved plan

  slots: AgentSlot[];            // 1-10 slots (ceiling from ADR-0003)
  mode: 'sequential';            // only sequential in v2.3
  isolation: 'patch-only';       // only patch-only in v2.3

  provider: 'codex' | 'claude';  // single provider
  endpointId: string;            // registered bridge endpoint id

  maxSlots: 1;                   // hard ceiling from provider capability
  policyRequirements: PolicyRequirement[];
  createdAt: number;
}

AgentSlot {
  id: string;                    // slot-unique id
  role: 'planner' | 'executor' | 'verifier';
  stepIndex: number;             // plan step this slot maps to
  tier: ExecutionTier;           // patch-proposal | workspace-write
  isolationHint: 'patch-only';   // provisional; worktree later
}

PolicyRequirement {
  kind: 'human-gate' | 'conflict-detection' | 'output-verification';
  detail: string;
}
```

**Notes**:
- `maxSlots: 1` is intentional for v2.3. It reflects the single-provider, sequential reality.
- `mode: 'sequential'` is the only allowed value until worktree isolation is available.
- `isolation: 'patch-only'` enforces the current safety boundary.
- This schema adds NO execution authority — it's a metadata declaration consumed by the orchestrator.

---

## 6. Console Impact Assessment

Project console will need to display AgentTeam state in v2.3+. **No UI changes in this spike.** Below is the assessed future UI surface:

| UI Element | Data Source | Notes |
|-----------|-------------|-------|
| Active team indicator | TeamSpec GET / project detail | Shows team name, provider, mode |
| Slot status table | Goal/plan step status per slot | Planner → executing, Executor-A → done, etc. |
| Pending approvals | Blocked-needs-gate steps | Same as current gate model |
| Patch queue | Derived from plan steps with patch-proposal | Preview patches before apply |
| Blocked capability indicator | Provider capability mismatch | "Parallel requested but provider supports only sequential" |
| Isolation mode badge | TeamSpec.isolation | "patch-only" / "worktree" |
| Verification result | Plan step output | Placeholder until real harness integration |

Existing console sections (timeline, audit, memory, verification, tasks) are untouched.

---

## 7. Existing Bridge State Model Assessment

### What v2.0-v2.2 already provides

| Capability | Status | Relevance to AgentTeam |
|-----------|--------|----------------------|
| Goal → Plan → Step progression | ✅ v2.0 | Team executes a plan; existing model maps 1:1 |
| Step ceiling (10) | ✅ ADR-0003 | Applies to total plan steps across all slots |
| Tier enforcement (patch-proposal / workspace-write) | ✅ v2.0 | Same tiers for AgentTeam slots |
| Per-step gate (blocked-needs-gate) | ✅ v2.0 | Same gate model for mutating steps |
| Project scoping + isolation | ✅ v2.1 | TeamSpec scoped to projectId |
| Audit + observability | ✅ v2.1 | Timeline/audit view covers team dispatch events |
| WorkBuddy task surface | ✅ v2.2 | Tasks can be linked to goals; results flow back |
| Explicit project creation | ✅ B3 | AgentTeam operates on existing projects |

### What v2.3 must add (minimal)

| Addition | Type | Notes |
|----------|------|-------|
| TeamSpec data model | Schema + store | Draft above; no HTTP endpoint in spike |
| Provider capability declaration | Endpoint config addition | `canExecute`, `supportsParallelSlots`, `maxSlots`, `isolationModes` |
| Sequential slot orchestrator | Runtime logic | Dispatches slots one at a time using existing plan step infrastructure |
| Patch conflict detection | Policy check | Compare file paths across slot outputs before sequential execution |
| TeamSpec console view | UI | Read-only display of active team/slots |

### What is explicitly NOT needed for v2.3

- Multiple provider support (Codex + Claude simultaneously).
- Worktree/branch management.
- Model API / PlannerModel / CriticModel integration.
- Parallel execution.
- WorkBuddy promoted to executor.
- Auto-apply or auto-merge of patches.

---

## 8. Risk / Kill-Gate Report

### Decision: v2.3 implementation handoff is ALLOWED

**Reason**: The provider limitation (no native parallelism) does NOT block AgentTeam. It constrains the implementation to sequential, single-provider mode — which is the safest starting point and aligns with ADR-0003's existing gated execution model.

### Conditions for implementation handoff

1. `TeamSpec` data model must be finalized (draft in §5).
2. Provider capability declaration must be implemented as endpoint config (no new endpoint; extend existing adapter metadata).
3. Sequential slot dispatch must use existing plan step infrastructure — no new execution paths.
4. Patch conflict detection must exist before any slot execution that writes overlapping files.
5. `mode`, `isolation`, `maxSlots` fields must be enforced by PolicyEngine at dispatch time.

### Kill gates (blocks implementation)

| Gate | Condition |
|------|-----------|
| Provider capability not declared | If the selected Codex/Claude endpoint does not declare `canExecute` and `isolationModes`, reject the team at creation |
| Parallel requested, provider does not support | Reject with explicit "sequential only" fallback |
| `mode !== 'sequential'` | Block; only sequential supported in v2.3 |
| `isolation !== 'patch-only'` | Block; worktree/branch are future |
| `maxSlots > 1` (v2.3) | Block; provider supports only 1 slot |
| Workspace-write auto-apply requested | Block; per-step gate required |
| Overlapping patches detected | Block; conflict must be surfaced for review |

### If kills gates fire

The system should return a structured error indicating:
- Which invariant was violated.
- What the allowed alternatives are.
- That the team creation / team dispatch was rejected.

---

## 9. Safe-to-Proceed

### Summary

| Question | Answer |
|----------|--------|
| Can we enter AgentTeam implementation handoff? | ✅ Yes, with constraints |
| What is the minimum safe scope? | Sequential, single-provider, patch-only, 1 slot |
| Is parallel execution available? | ❌ No (provider limitation) |
| Is worktree isolation available? | ❌ Not yet (needs git worktree ADR) |
| Does WorkBuddy become an executor? | ❌ No |
| Are new execution surfaces needed? | ❌ No (reuse existing plan step + gate) |
| What invariants must code review enforce? | Policy invariants in §4 |
| What still needs a separate ADR? | Worktree isolation, branch isolation, Model API |

### Recommended next step

Write a `v2.3-implementation-handoff.md` based on this spike, detailing:
- TeamSpec schema (from §5 draft).
- Sequential slot orchestrator design.
- Patch conflict detection algorithm.
- Endpoint capability declaration format.
- Test plan for sequential execution, conflict detection, gate enforcement.

Then open `feat/v2.3-agentteam-sequential` as an implementation branch.

---

*This spike is complete. It is a decision artifact, not an implementation. Merge it as a planning document.*
