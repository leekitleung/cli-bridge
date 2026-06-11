# CLI Bridge v2.3 Spike — Single-Provider Multi-Slot Feasibility

**Status**: SPIKE COMPLETE — Implementation handoff created (2026-06-11)
**Date**: 2026-06-11
**Handoff**: `CLI-BRIDGE-v2.3-IMPLEMENTATION-HANDOFF.md`
**Spans**: PLANS only. No implementation code.

---

## 0. Scope & Authorization

### What This Spike Covers

- Feasibility of single-provider, multi-slot AgentTeam execution via Codex or Claude Code CLI.
- Provider-native parallelism vs bridge-governed parallelism distinction.
- Evidence tiers for provider capability claims.
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

### Evidence Rules

Claims about provider capabilities must cite one of these evidence sources:

| Tier | Label | Source |
|------|-------|--------|
| 1 | official docs | Provider product documentation, CLI help output, or published capability matrix |
| 2 | local experiment | Verifiable CLI behavior observed in the project environment |
| 3 | reported | Third-party documentation or community reports — treated as indicative but not confirmed |
| 4 | unknown | No evidence available — must not be asserted as confirmed |

Without Tier 1–2 evidence, a capability is marked `unknown / requires evidence`. Blog posts, hearsay, competitive analysis, and unverifiable anecdotes do not constitute evidence for this spike.

### Reference Documents

| Document | Role |
|----------|------|
| `PLAN-AGENTTEAM-PROJECT-CONTROL-PLANE.md` | AgentTeam architecture, capability model, PolicyEngine invariants |
| `PLAN-LAYERED-ORCHESTRATION-AND-CONSOLE.md` | Console layering, orchestration flow |
| `ADR-0003-controlled-execution-layer.md` | Execution tiering, gate requirements, step ceiling |
| `README.md` | Current security boundaries |
| `bridge-workbuddy-api.md` | WorkBuddy non-executing contract |

---

## 1. Terminology — Capability Levels

This spike introduces a critical distinction between two kinds of parallelism that were conflated in earlier drafts.

### 1.1 Product-native parallelism

The external provider's own ability to manage agents, subagents, sessions, teams, or dynamic workflows internally.

- Claude Code may support internal subagent/session parallelism (reported by official docs — see §2.2).
- Codex's product-native parallelism is `unknown / requires evidence` (see §2.1).
- cli-bridge has no control over, and no visibility into, provider-internal parallelism.

### 1.2 Bridge-governed parallel slots

cli-bridge's own ability to model, authorize, audit, isolate, cancel, recover, and merge parallel execution slots.

- Bridge-governed parallel slots require all of: slot identity, session identity, per-slot audit, per-slot isolation, machine-readable patch artifacts, conflict detection, cancellation/retry, merge protocol, per-slot gate state.
- **None of these exist in current cli-bridge.** This is a bridge-side gap, not a provider-side gap.

### 1.3 External-managed team run

A mode where the external tool manages its own team/subagents independently, and cli-bridge only records summary results, artifacts, and ledger events.

- This is close to the existing v2.2 WorkBuddy record surface (non-executing, import/record only).
- cli-bridge must NOT start, dispatch, spawn, apply, merge, or approve anything in this mode.

### 1.4 Additional terms

| Term | Definition |
|------|-----------|
| `logicalSlots` | Roles or task slots in TeamSpec (planner, executor, verifier). Can be more than 1. |
| `maxConcurrentBridgeSlots` | Maximum concurrent slots cli-bridge can govern. v2.3 MVP: **1**. |
| `provider session` | A provider-side identifiable session or execution context. |
| `workspace / worktree isolation` | File-system isolation strategies. v2.3 MVP does NOT enable worktree, branch, or shared-workspace writes. |

---

## 2. Provider Capability Feasibility Matrix

Each capability is split into two layers: **provider-native** and **bridge-governed**.

### 2.1 Codex CLI

#### Provider-native capabilities

| Capability | Status | Evidence tier | Notes |
|-----------|--------|---------------|-------|
| `canReview` | ✅ Yes | Tier 2 (local) | v1.6-v1.7 review endpoint, Claude review args |
| `canProposePatch` | ✅ Yes | Tier 2 (local) | v2.0 plan-step patch-proposal tier |
| `canVerify` | ⚠️ Partial | Tier 2 (local) | Can run lint/test; output is unstructured |
| `canExecute` | ✅ Yes (gated) | Tier 2 (local) | ADR-0003 workspace-write tier; per-step gate |
| `productNativeParallelism` | unknown / requires evidence | Tier 4 (unknown) | No official docs or local experiment confirming multi-session parallelism |

#### Bridge-governed capabilities

| Capability | Status | Notes |
|-----------|--------|-------|
| `bridgeGovernedParallelSlots` | ❌ Not supported | cli-bridge has no parallel slot contract (§3.1 gap list) |
| `maxConcurrentBridgeSlots` | 1 (v2.3 MVP) | Hard limit by bridge policy |
| `bridgeIsolationModes` | `patch-only` (current) | Worktree/branch are future |

### 2.2 Claude Code CLI

#### Provider-native capabilities

| Capability | Status | Evidence tier | Notes |
|-----------|--------|---------------|-------|
| `canReview` | ✅ Yes | Tier 2 (local) | Review endpoint adapters |
| `canProposePatch` | ✅ Yes | Tier 2 (local) | v2.0 plan-step patch-proposal tier |
| `canVerify` | ⚠️ Partial | Tier 2 (local) | Same as Codex |
| `canExecute` | ✅ Yes (gated) | Tier 2 (local) | workspace-write tier, per-step gate |
| `productNativeParallelism` | supported (reported by official docs pending citation) | Tier 1 (official docs) | Claude Code documentation describes internal subagent/session management. Citation must be verified in implementation handoff before this is treated as confirmed. |

#### Bridge-governed capabilities

| Capability | Status | Notes |
|-----------|--------|-------|
| `bridgeGovernedParallelSlots` | ❌ Not supported | Same bridge gap as Codex |
| `maxConcurrentBridgeSlots` | 1 (v2.3 MVP) | Hard limit by bridge policy |
| `bridgeIsolationModes` | `patch-only` (current) | Same as Codex |

### 2.3 WorkBuddy

| Capability | Status | Evidence |
|-----------|--------|----------|
| `canExecute` | ❌ Not in scope | v2.2: non-executing task source/result sink |
| `productNativeParallelism` | ❌ Not applicable | Task system only |
| `bridgeGovernedParallelSlots` | ❌ Not applicable | No execution authority |

**Verdict**: WorkBuddy remains a task system. Promoting to executor requires separate ADR.

### 2.4 Key Asymmetry

- Claude Code has **product-native parallelism** (Tier 1 evidence, citation pending).
- Codex's product-native parallelism is **unknown** (Tier 4 — no evidence).
- **Neither** has bridge-governed parallel slots — because cli-bridge has not implemented the slot governance contract.

This means: even if a provider supports internal parallelism, cli-bridge v2.3 cannot govern it. The bridge gap is the binding constraint for v2.3.

---

## 3. Multi-Slot Feasibility Assessment

### 3.1 Bridge Gap Analysis — Why Bridge-Governed Parallel Slots Are Not Feasible in v2.3

The following capabilities are required for bridge-governed parallel slots and are **all absent** from current cli-bridge:

| # | Gap | Impact |
|---|-----|--------|
| 1 | Slot identity | No way to tag which provider output belongs to which slot |
| 2 | Provider session identity | No way to correlate provider sessions to bridge slots |
| 3 | Per-slot audit | Audit events are not slot-scoped |
| 4 | Per-slot isolation | No file-system or artifact isolation between slots |
| 5 | Machine-readable patch artifacts | Plan step output is unstructured text |
| 6 | Patch conflict detection | No file-path-aware overlap detection between slot outputs |
| 7 | Cancellation / retry per slot | No per-slot lifecycle beyond plan step status |
| 8 | Merge protocol | No defined merge strategy for multi-slot output |
| 9 | Per-slot gate state | Gate model is per-plan-step, not per-slot |
| 10 | Parallel capability declaration | Endpoint config has no `supportsParallelSlots` or `maxConcurrentBridgeSlots` |

Until these gaps are addressed, **bridge-governed parallel slots cannot be implemented**.

### 3.2 Sequential Execution (v2.3 Minimum Viable)

**How it works**: A single provider instance executes logical slots one at a time. Planner → Executor-A → Executor-B → Verifier, in order.

**Feasibility**: ✅ Immediately feasible. Reuses existing plan step infrastructure.

**Constraints**:
- `maxConcurrentBridgeSlots` = 1 (hard policy limit).
- Slot output must be committed before next slot starts.
- Overlapping file writes across slots must be flagged as conflict.

### 3.3 Worktree Isolation

**Feasibility**: ⚠️ Requires ADR on git worktree creation authority.

**Recommended for**: v2.4+, after sequential mode is stable and the 10 bridge gaps above are closed.

### 3.4 Branch Isolation

**Feasibility**: ⚠️ Requires merge gate ADR. Higher complexity than worktree.

**Recommended for**: POST-v2.3.

### 3.5 Shared Workspace

**Feasibility**: ❌ Explicitly unsafe. Blocked for v2.3 and until file locking and concurrent-write safety are proven.

---

## 4. Key Findings (Revised)

### Q1: Do Codex / Claude Code support product-native parallel agent workflows?

- **Claude Code**: Yes — reported by official docs (Tier 1 evidence, citation pending). Must be verified in implementation handoff.
- **Codex**: Unknown — no Tier 1–2 evidence available. Must NOT be asserted as confirmed.

### Q2: Can cli-bridge v2.3 support bridge-governed parallel slots?

**No**. The 10 gaps in §3.1 are the binding constraint. Even if a provider supports internal parallelism, cli-bridge cannot govern it without:
- Slot/session identity.
- Per-slot audit, isolation, gates.
- Machine-readable patch artifacts.
- Conflict detection and merge protocol.

### Q3: What is the minimum safe v2.3 implementation?

- Bridge-governed sequential orchestration.
- Single provider.
- `patch-only` isolation (no workspace-write auto-apply).
- `maxConcurrentBridgeSlots` = 1.
- `logicalSlots` may be >1 (multiple roles in TeamSpec), but only one slot executes at a time.
- No worktree, branch, or shared workspace.
- No WorkBuddy executor promotion.
- No auto-apply, auto-commit, auto-push.

### Why sequential, not because "provider can't parallel"

v2.3 MVP is sequential **not** because providers lack product-native parallelism (Claude Code may have it), but because **cli-bridge lacks the bridge-governed parallel slot contract**. The bridge gap is the binding constraint, not the provider gap.

---

## 5. Policy Invariants (v2.3 Required)

| # | Invariant | Source |
|---|-----------|--------|
| P1 | Plan must be approved before dispatch | ADR-0003 §7.3 |
| P2 | State-mutating step requires per-step gate confirm | ADR-0003 §7.3 |
| P3 | Provider capability must be explicitly declared; tool names do not grant authority | AgentTeam Plan §4 |
| P4 | Bridge-governed parallel execution requires the 10 conditions in §3.1 to be met | This spike |
| P5 | If bridge-governed parallel is unavailable, fallback must be explicit (sequential or rejected), never silently faked | This spike |
| P6 | Step ceiling (hard 10) applies to total plan steps across all logical slots | ADR-0003 |
| P7 | Model/provider output cannot authorize execution, gate bypass, or workspace-write | ADR-0003, AgentTeam Plan §4.1 |
| P8 | Overlapping file patches across slots require conflict detection | This spike |
| P9 | Execution provider registry is future; v2.3 may hardcode a single known provider | This spike |
| P10 | WorkBuddy remains task source/result sink; NOT promoted to executor | v2.2 contract |
| P11 | `maxConcurrentBridgeSlots` must be enforced by PolicyEngine; v2.3 MVP = 1 | This spike |

---

## 6. Minimal TeamSpec Schema (Draft)

This is a design artifact, not an implementation contract.

```text
TeamSpecDraft {
  id: string;
  projectId: string;
  goalId: string;
  planId: string;

  logicalSlots: AgentSlotDraft[];      // 1–10 logical roles/tasks
  maxConcurrentBridgeSlots: 1;         // v2.3 MVP — hard ceiling
  mode: 'sequential';                  // only sequential in v2.3
  isolation: 'patch-only';             // only patch-only in v2.3

  provider: 'codex' | 'claude';        // single provider
  endpointId: string;                   // registered bridge endpoint id

  policyRequirements: PolicyRequirementDraft[];
  createdAt: number;
}

AgentSlotDraft {
  id: string;
  role: 'planner' | 'executor' | 'verifier';
  stepIndex: number;
  tier: 'patch-proposal' | 'workspace-write';
  isolationHint: 'patch-only';          // provisional
}

PolicyRequirementDraft {
  kind: 'human-gate' | 'conflict-detection' | 'output-verification';
  detail: string;
}
```

### Critical note on slots

In v2.3, an AgentTeam **may contain multiple logical slots** (e.g., planner + executor + verifier), but **cli-bridge may govern only one slot at a time** (`maxConcurrentBridgeSlots` = 1). This is sequential bridge-governed orchestration, not provider-native parallel orchestration.

The TeamSpec declares what roles exist (`logicalSlots`). The PolicyEngine enforces how many run concurrently (`maxConcurrentBridgeSlots`).

---

## 7. Kill Gates — Bridge-Governed Parallel Slots

Parallel bridge-governed slots are **blocked** until ALL of the following conditions are met:

1. Provider exposes independent slot/session identity.
2. Each slot has isolated workspace or patch-only artifact boundary.
3. Each slot output is machine-readable enough for cli-bridge to audit.
4. cli-bridge can map each slot to a Goal / Plan / Step.
5. cli-bridge can detect overlapping file patches before apply.
6. cli-bridge can cancel / retry / fail one slot without corrupting others.
7. cli-bridge can produce per-slot audit events.
8. User can inspect and approve merge / apply decisions.
9. Provider capability declaration includes `bridgeGovernedParallelSlots: true` and `maxConcurrentBridgeSlots >= 2`.
10. Worktree, branch, or shared-workspace modes have separate ADR approval.

Until all 10 conditions are met, the implementation must reject any TeamSpec with `maxConcurrentBridgeSlots > 1` and `mode !== 'sequential'`.

---

## 8. v2.3 Implementation Handoff Prerequisites

**Do NOT implement directly from this spike.** Before entering implementation, produce:

1. **Evidence reconciliation document**: Verify and cite Claude Code product-native parallelism from official docs or local experiment. Mark Codex as `unknown` unless new evidence emerges.
2. **Final TeamSpec schema**: From §6 draft, with finalized field names, validation rules, and store contract.
3. **Sequential orchestrator state machine**: How slots progress through pending → executing → done/failed/blocked.
4. **Patch-only conflict detection algorithm**: Compare patch file paths across sequential slot outputs.
5. **Provider capability declaration shape**: What endpoint metadata declares `canExecute`, `productNativeParallelism`, `maxConcurrentBridgeSlots`, `isolationModes`.
6. **PolicyEngine invariants**: Enforce §5 invariants at TeamSpec creation and dispatch time.
7. **Forbidden implementation list**: Explicitly list what v2.3 must NOT implement (§9).
8. **Test plan**: Sequential execution, conflict detection, gate enforcement, parallel rejection, evidence-verified capability matrix.

---

## 9. Forbidden Implementation List (Strong Constraint)

The following must NOT appear in any v2.3 implementation artifact:

- AgentTeam runtime implementation (scheduler, queue, daemon, dispatcher).
- TeamSpec HTTP endpoint or persistent store.
- Provider registry runtime code.
- Shell / exec / run / command endpoint.
- Workspace-write auto-apply or auto-commit or auto-push or auto-merge.
- Worktree / branch creation by cli-bridge.
- WorkBuddy promoted to executor (`canExecute: true`).
- Model API integration (PlannerModel, CriticModel, summary agent).
- External agent team dispatch by cli-bridge.
- Silent fake parallelism (sequential disguised as concurrent).

The spike document may discuss these as future capabilities, but must not imply they are currently implemented or approved.

---

## 10. Safe-to-Proceed

### Summary

| Question | Answer |
|----------|--------|
| Can we enter AgentTeam implementation handoff? | ✅ Yes, with constraints (see §8 prerequisites) |
| What is the minimum safe scope? | Sequential bridge-governed, single-provider, patch-only, maxConcurrentBridgeSlots=1 |
| Is bridge-governed parallel execution available? | ❌ No (10 bridge gaps, §3.1) |
| Does Claude Code have product-native parallelism? | Yes (Tier 1 evidence reported, citation pending) |
| Does Codex have product-native parallelism? | unknown / requires evidence |
| Is worktree isolation available? | ❌ Not yet (needs git worktree ADR) |
| Does WorkBuddy become an executor? | ❌ No |
| Are new execution surfaces needed? | ❌ No (reuse existing plan step + gate) |
| What invariants must code review enforce? | §5 (11 invariants) |
| What still needs a separate ADR? | Worktree isolation, branch isolation, Model API, WorkBuddy executor promotion |

### Recommended next step

✅ **Done.** `CLI-BRIDGE-v2.3-IMPLEMENTATION-HANDOFF.md` has been created. It covers all §8 prerequisites: evidence reconciliation, TeamSpec schema, sequential state machine, patch conflict detection, provider capability declaration, PolicyEngine invariants, test plan, and forbidden list.

After the handoff is reviewed and approved, open `feat/v2.3-agentteam-sequential` as an implementation branch.

---

*This spike is a decision artifact, not an implementation. It is safe to merge as a planning document.*
