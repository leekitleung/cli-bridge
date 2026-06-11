# CLI Bridge Post-v2.3 — Planning Handoff

**Status**: PLANNING HANDOFF — choose next slice before implementation
**Date**: 2026-06-12
**Based on**:
- `PLAN-AGENTTEAM-PROJECT-CONTROL-PLANE.md`
- `CLI-BRIDGE-v2.3-CLOSEOUT-REVIEW.md`
- `CLI-BRIDGE-v2.3-SPIKE-AGENTTEAM-FEASIBILITY.md`
- `phase-b-features.md`
- `CLI-BRIDGE-v2.1-READINESS-INTAKE.md`

---

## 1. Current State

v2.3 AgentTeam Sequential MVP is closed out. The implemented chain is:

```text
TeamSpec create -> approve/cancel -> sequential slot advance ->
SlotArtifact record -> read-only conflict report -> slot lifecycle audit ->
Console Teams read-only visibility
```

The bridge remains single-provider, sequential, patch-only, and non-autonomous. No v2.4+ authority was added.

Current verification evidence from v2.3 closeout:

```text
npm run typecheck   pass
npm run lint        pass
npm test            498/498 pass
git diff --check    pass
```

---

## 2. Completed Roadmap Baseline

| Slice | Status | Notes |
|-------|--------|-------|
| v2.0 Goal / Plan / Step / Gate / Project Console | Complete | ADR-0003 remains binding. |
| v2.1 read-only project observability | Complete with placeholders | Timeline, audit, derived memory, verification placeholder. |
| v2.2 WorkBuddy task source/result sink | Complete | WorkBuddy remains non-executing. |
| v2.3 AgentTeam Sequential MVP | Complete | Single-provider, sequential, patch-only AgentTeam. |

---

## 3. Open Planning Tracks After v2.3

### Track A — Observability Completion

Low-risk continuation of existing read-only surfaces.

Candidate slices:
- Status panel real source contracts and one source integration at a time.
- Harness verification real source contract.
- Project memory read model, derived only from verified facts.

Constraints:
- Read-only console behavior must remain.
- Missing sources must degrade to unavailable states.
- No mutation, execution, scheduler, or model API authority.

### Track B — ADR-0004 Model API Decision

Required before v2.4a implementation.

Potential scope if approved later:
- planner / critic / arbiter model calls
- bounded replan
- non-mutating self-iteration

This track must first decide:
- whether the bridge should hold model API credentials;
- redaction and retention rules for model calls;
- budget, retry, and failure thresholds;
- which outputs are advisory vs gate-affecting;
- how ADR-0003 mutation gates remain binding.

No Model API implementation should begin before this ADR is accepted.

### Track C — Multi-provider AgentTeam Planning

Required before v2.4b implementation.

Open design items:
- provider identity and session identity;
- capability declaration parity across providers;
- provider failure and partial-result semantics;
- artifact normalization across provider outputs;
- review strategy for conflicting provider outputs.

This track does not authorize parallel slots, worktree isolation, or auto-merge.

### Track D — Workspace-write Expansion

Deferred to v2.5+ and not a near-term implementation slice.

Requires separate ADRs or handoffs for:
- worktree / branch / shared-workspace isolation;
- merge queue and conflict resolution policy;
- any auto-apply / commit / push / merge behavior;
- any advanced tool executor.

---

## 4. Recommended Next Slice

Recommended next milestone:

```text
Post-v2.3 Planning Closeout + Next-slice Selection
```

Deliverables:
- keep v2.3 closeout docs synchronized with review outcome;
- choose one next implementation track;
- create either an implementation handoff for a read-only observability slice or an ADR draft for Model API;
- explicitly restate the forbidden list and ADR-0003 invariants.

Recommended implementation order:

1. Finish planning/doc synchronization.
2. Choose Track A if the next goal is low-risk product polish.
3. Choose Track B if the next goal is v2.4a capability planning.
4. Choose Track C only after provider/session/failure policy is written.
5. Keep Track D deferred until there is an approved workspace-isolation ADR.

---

## 5. Forbidden Until Separately Approved

- Bridge-governed parallel slots.
- Worktree / branch / shared-workspace isolation.
- Real CLI dispatch as an execution provider beyond existing approved boundaries.
- Auto-apply / auto-commit / auto-push / auto-merge.
- WorkBuddy executor promotion.
- Model API / PlannerModel / CriticModel implementation without ADR approval.
- Scheduler / queue / daemon.
- Shell / exec / run / command endpoint.
- Any bypass of ADR-0003 plan approval, step ceiling, per-step gate, audit, or failure-stop behavior.

---

## 6. Acceptance Criteria For Starting The Next Implementation

Before code starts, the next slice must have:

- a named target track from section 3;
- a short implementation handoff or accepted ADR;
- explicit allowed modification range;
- explicit forbidden list;
- verification commands;
- closeout review checklist.

If the next slice expands execution authority, writes to the workspace, invokes model APIs, or promotes an external tool into an executor, it requires a dedicated ADR before implementation.
