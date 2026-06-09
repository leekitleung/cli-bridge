# CLI Bridge v2.1 AgentTeam / Project Control Plane Directional Review

## 0. Status

Status: DIRECTIONAL REVIEW.

This review evaluates whether the AgentTeam / Project Control Plane planning
should become a near-term baseline after v2.0. It supersedes no ADR, but it
tightens the interpretation of `PLAN-AGENTTEAM-PROJECT-CONTROL-PLANE.md`.

Application status: applied on 2026-06-09 in commit `19a9925`.

## 1. Overall Judgment

v2.0 remains the correct active path:

- Goal-driven Console MVP.
- `patch-proposal` by default.
- Step ceiling default 1, hard max 10.
- Stop after 2 consecutive failures.
- First execution endpoint: Codex patch-proposal.
- Console-only state-changing gate.

The AgentTeam plan has useful safety principles, but v2.1+ was overdrawn before
v2.0 had real usage feedback. It should be treated as future planning, not as an
implementation baseline.

## 2. Directional Drifts

### Drift A: Model API In The Middle Layer

Adding PlannerModel / CriticModel / ArbiterModel / SummarizerModel /
ReplannerModel / AuditExplainerModel to the middle layer is a product-form
change. Earlier architecture used the middle layer for transport, policy, state,
and audit; models lived in upstream CLIs or browser surfaces.

Middle-layer model calls introduce:

- API key management.
- Billing/cost surface.
- New vendor dependency.
- Prompt-injection surface.
- Offline behavior issues.
- Potential ToS/account-surface questions depending on provider.

This needs its own ADR before becoming a planning baseline. Until then, model API
is deferred. If later accepted, the first scope should be minimal: at most one
explicit opt-in PlannerModel with user-provided key. Critic/Arbiter/Replanner
roles remain future work.

### Drift B: Planning Beyond v2.0 Before Validation

`PLAN-GOAL-DRIVEN-DYNAMIC-WORKFLOW.md` already warns that Goal/Plan/PlanStep
should be exercised on 1-2 real goals before being hardened. Planning v2.1-v2.5+
as an implementation route before v2.0 runs contradicts that principle.

v2.1+ should require real v2.0 usage evidence first.

### Drift C: Single-Provider Multi-Slot Feasibility

Single-provider multi-slot should not be treated as default baseline yet.

Known constraints:

- Codex CLI can be parallelized only as multiple `codex exec` processes, which
  implies worktree/branch/patch isolation managed by the bridge.
- Claude Code subagents are internal to Claude Code. From the bridge, multiple
  `claude -p` invocations are independent processes, not externally managed
  Claude subagents with shared internal context.
- ChatGPT Web does not support this model.

Therefore single-provider multi-slot requires a feasibility spike before any
implementation handoff.

### Drift D: Token Economy Is Not The Core Product Claim

Tier x role remains a useful routing optimization, but token price is not the
most defensible core narrative. The durable value is:

- Project-level observability.
- Context routing.
- Controlled execution.
- Auditability.
- Interruptible, rejectable policy gates.

The control plane should be justified by project management and safety, not by
assuming cheap models do most work.

### Drift E: Differentiation From Existing Coding Products

Project control plane overlaps with Cursor, Aider, Roo/Cline, Goose, Continue,
OpenDevin-style systems, and Claude Code itself. The bridge must state its
distinct value:

- It orchestrates the user's existing local CLI/browser surfaces rather than
  replacing them.
- It can avoid holding source code or model API keys when operating in
  CLI/browser-mediated modes.
- It centers local audit, visible gates, and interruptibility rather than
  autonomous driving.

If this differentiation stops being true, the project should reassess whether it
should return to a narrower review gateway / safety foundation.

## 3. Recommended Corrections

1. Mark AgentTeam planning as FUTURE / NOT BASELINE.
2. Require v2.0 real usage feedback before v2.1+ implementation handoffs.
3. Move middle-layer model API behind a future ADR-0004 decision.
4. Shrink v2.1 to read-only observability: ConversationTimeline, derived memory,
   audit view, and harness verification records.
5. Move AgentTeam multi-slot to a feasibility spike before implementation.
6. Treat tier x role as optional routing optimization.
7. Add differentiation language to the control-plane plan.
8. Make the relationship between Goal-driven plan and AgentTeam plan explicit.
9. Add kill gates after each v2.x slice.

## 4. Planning Consequence

No AgentTeam implementation should begin until:

```text
v2.0 Goal -> Plan -> approve -> bounded step progression -> gate -> audit
has been run on real project goals and reviewed.
```

No middle-layer model API should begin until a dedicated ADR accepts it.
