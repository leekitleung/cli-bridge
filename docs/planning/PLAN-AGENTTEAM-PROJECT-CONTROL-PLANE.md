# Plan: AgentTeam + Project Control Plane

## 0. Status

Status: V2.3 CLOSEOUT COMPLETE — Post-v2.3 planning gate active (2026-06-12).

The v2.3 feasibility spike (`CLI-BRIDGE-v2.3-SPIKE-AGENTTEAM-FEASIBILITY.md`) has
concluded; the implementation handoff (`CLI-BRIDGE-v2.3-IMPLEMENTATION-HANDOFF.md`)
was implemented and closeout-approved in `CLI-BRIDGE-v2.3-CLOSEOUT-REVIEW.md`.
Post-v2.3 planning is tracked in `CLI-BRIDGE-POST-v2.3-PLANNING-HANDOFF.md`.
Key decisions:
- Sequential, single-provider, patch-only AgentTeam is feasible with current bridge architecture.
- Bridge-governed parallel slots are not available in v2.3 because cli-bridge lacks the slot governance contract.
- Claude Code product-native parallelism: reported by official docs, pending citation verification.
- Codex product-native parallelism: unknown / requires evidence.
- Minimum viable v2.3 scope is implemented: TeamSpec, sequential slot state, patch artifact recording, read-only conflict reporting, audit, and console visibility.
- Worktree/branch isolation deferred past v2.3. WorkBuddy remains non-executing.

This document remains the architectural reference. The spike is the feasibility artifact; the closeout review is the v2.3 implementation evidence; the post-v2.3 handoff is the next planning gate.

This plan is intentionally **not** a v2.1 implementation baseline. v2.0 must
first run real Goal -> Plan -> approve -> bounded step progression -> gate ->
audit flows. Only after that evidence exists may any v2.1+ implementation
handoff decide which parts of this future plan are still worth carrying forward.

It extends, but does not replace:

- `ADR-0003-controlled-execution-layer.md`
- `CLI-BRIDGE-v2.0-IMPLEMENTATION-HANDOFF.md`
- `PLAN-GOAL-DRIVEN-DYNAMIC-WORKFLOW.md`
- `PLAN-LAYERED-ORCHESTRATION-AND-CONSOLE.md`
- `PLAN-PROJECT-CONVERSATION-TIMELINE.md`
- `CLI-BRIDGE-v2.1-AGENTTEAM-PLANNING-REVIEW.md`
- `CLI-BRIDGE-v2.1-AGENTTEAM-DIRECTIONAL-REVIEW.md`

This is not an implementation handoff. Code changes that add new execution
authority still require their own ADR or approved implementation handoff.

Relationship to `PLAN-GOAL-DRIVEN-DYNAMIC-WORKFLOW.md`: this document is a
future extension of the goal-driven control-plane idea, not a replacement for
v2.0. If this document conflicts with ADR-0003 or the v2.0 handoff, ADR-0003
and v2.0 win.

## 1. Product Goal

The middle layer should become a project control plane. The problem to solve is
not that CLI agents cannot write code; it is that long-running CLI development
loses project-level control.

The control plane should manage:

- Goals and plans.
- Agent teams and execution slots.
- Task and project progress.
- Memory and decisions.
- Conversation history across tools.
- Verification and harness results.
- Audit and gates.

The middle layer owns state, policy, orchestration, and visibility. External
tools and models are workers or advisors governed by that layer.

### 1.1 Differentiation

This is not trying to become Cursor, Aider, Roo/Cline, Goose, Continue,
OpenDevin, or Claude Code itself.

The defensible differentiation is:

- The bridge orchestrates existing local CLI/browser surfaces instead of
  replacing them.
- In CLI/browser-mediated modes, the bridge does not need to hold model API keys
  or become the primary source-code host.
- The bridge's product value is local observability, explicit policy, visible
  gates, interruptibility, and audit.

If a later slice requires the bridge itself to call model APIs or to hold broader
execution authority, that slice must justify why this differentiation still
holds.

## 2. Core Architecture

```text
Project Control Plane
  -> GoalStore / PlanStore / StepStore
  -> AgentTeam Orchestrator
  -> ModelProvider Registry (deferred; ADR required)
  -> ExecutionProvider Registry
  -> PolicyEngine
  -> MemoryStore
  -> ConversationTimeline
  -> AuditLog
  -> HarnessAdapter
  -> WorkBuddyAdapter
  -> Console UI
```

The central split is:

```text
ModelProvider
  thinks, plans, critiques, ranks, merges, summarizes, audits
  deferred until a dedicated ADR accepts middle-layer model API
  canExecute=false by default

ExecutionProvider
  can perform project work
  may support patch proposal, verification, workspace-write, or task execution
```

PolicyEngine is the hard boundary. Model output is never authorization.

Responsibility boundaries:

- AuditLog is the authoritative event ledger.
- ConversationTimeline is a project-facing event view derived from audit,
  review, prompt, and future step logs; see
  `PLAN-PROJECT-CONVERSATION-TIMELINE.md`.
- MemoryStore is a derived and curated continuity layer. It may summarize
  events, but it is not the source of truth for approvals, gates, or execution.

## 3. AgentTeam Definition

AgentTeam does not require multiple external tools. The first-class concept is
multiple agent slots. This remains a future concept until a feasibility spike
proves the target execution provider can support it safely.

```text
ToolProvider
  codex / claude-code / workbuddy / qclaw / openclaw / hermes

ExecutionObject
  one concrete provider instance bound to a project/workspace

AgentSlot
  one role/model/worker inside an execution object

AgentTeam
  a coordinated group of AgentSlots
```

ToolProvider is a registration namespace, not a permission carrier. Authority
comes from the concrete endpoint/execution-object capability declaration in §4
and from PolicyEngine checks.

The preferred future AgentTeam shape is single-provider, multi-slot, but this is
not yet a baseline:

```text
CodexTeam
  planner slot
  executor-a slot
  executor-b slot
  verifier slot
```

Multi-provider teams are supported later as an advanced mode:

```text
Codex executor
Claude reviewer
Hermes verifier
WorkBuddy task manager
```

Before v2.3 or any AgentTeam implementation handoff, run a feasibility spike for
the selected provider. The spike must confirm whether parallel slots are real
provider capability, multiple independent CLI processes, or unavailable.

## 4. Capability Model

Every execution object must declare its real capabilities.

Suggested shape:

```text
ExecutionObject {
  id
  provider
  projectRoot
  supportsParallelSlots
  maxSlots
  isolationModes
  supportedModes
  capabilities
}
```

Important fields:

- `supportsParallelSlots`: whether multiple slots can run concurrently **under bridge governance** (not provider-native parallelism — see v2.3 spike §1 for the distinction).
- `maxSlots`: hard concurrency limit.
- `isolationModes`: `patch-only`, `worktree`, `branch`, `shared-workspace`.
- `supportedModes`: `review-only`, `patch-proposal`, `workspace-write`,
  `verify`, `task-sync`.

Bridge-governed parallel execution requires both `supportsParallelSlots=true` AND
`maxSlots >= 2` AND the 10 bridge gap conditions from the v2.3 spike (§3.1).
If any condition is not met, the orchestrator must explicitly reject the
parallel request or present a sequential/patch-only/provider-switch fallback.

Provider-native parallelism (e.g., Claude Code subagent management) is a
separate concept. Even if a provider supports it internally, cli-bridge cannot
govern parallel slots until the bridge gap is closed. See
`CLI-BRIDGE-v2.3-SPIKE-AGENTTEAM-FEASIBILITY.md` for the full analysis.

If a requested AgentTeam needs more slots than bridge governance supports,
the middle layer must report that explicitly and offer safe alternatives.
It must not silently fake parallel execution.

Concrete schemas and state machines are intentionally deferred to each v2.x
implementation handoff. This plan defines the conceptual shape and invariants.

## 4.1 PolicyEngine Required Invariants

PolicyEngine is the hard boundary for AgentTeam and provider dispatch.

Minimum invariants:

- A plan must be approved before execution.
- A state-mutating step must enter the per-step gate before it can run.
- Capability must be explicitly declared by the endpoint/execution object.
- Tool/provider names do not grant authority.
- Requested isolation must satisfy the execution strategy; unsafe shared
  workspace writes require explicit scope and gate policy.
- Parallel execution requires `supportsParallelSlots=true` and `maxSlots >= 2`.
- Step limits, retry limits, and budget limits must stop execution when reached.
- Replanning outside the approved Goal scope must trigger plan-level approval.
- Model output cannot authorize workspace-write, execution, or gate bypass.

## 5. WorkBuddy / qclaw / openclaw / hermes

WorkBuddy and similar tools may execute code, but only as governed endpoints.

The corrected identity model is:

```text
WorkBuddy as task system
  task source, project context, board, result sink

WorkBuddy as executor endpoint
  separately registered endpoint with canExecute=true
```

The same applies to:

- qclaw
- openclaw
- hermes
- Codex
- Claude Code
- future tools

Tool name does not grant authority. Endpoint identity, declared capability,
approved scope, gate policy, and audit determine authority.

Unsafe:

```text
task status changes -> automatic code execution
```

Safe:

```text
task selected or linked
  -> middle layer creates or links Goal
  -> Plan and TeamSpec are generated
  -> user approves scope
  -> orchestrator dispatches governed endpoints
  -> results and progress flow back to task system
```

## 6. Role Self-Definition

AgentTeam may propose roles. It may not grant itself permissions.

Allowed role proposal:

- Role name.
- Responsibility.
- Preferred provider/model.
- Context needed.
- Suggested routing.

Forbidden self-authorization:

- `canExecute`.
- `workspace-write`.
- Shell access.
- Commit/push permission.
- Gate bypass.
- Policy mutation.

The middle layer binds proposed roles to approved endpoints only after policy
validation.

## 7. AgentTeam Start Conditions

Review-only teams can start with lower requirements:

```text
Goal exists
Plan or review target exists
review-capable endpoints available
audit/timeline enabled
```

Execution teams require stricter conditions:

```text
Goal exists
Plan generated and schema-valid
Plan approved
TeamSpec generated or selected
Each role bound to an approved endpoint
Each endpoint capability satisfies its role
ExecutionObject availability checked
Parallel slot requirements checked
Isolation mode selected
Step limit / retry limit / budget set
Audit and timeline enabled
State-mutating gate policy active
```

If workspace-write is involved, approval of plan scope does not replace the
per-step gate.

## 8. Parallel Execution Strategy

Parallel execution must be explicit and isolated.

Supported strategies:

```text
parallel-split
  different steps assigned to different slots

parallel-race
  multiple slots attempt the same step; reviewer/arbiter selects result

planner-executor-reviewer
  planner produces plan, executor proposes patch, reviewer verifies

swarm-review
  multiple reviewers inspect the same output and aggregate risks
```

Default safe execution mode:

```text
patch-proposal first
  -> collect patches
  -> detect overlap
  -> review/merge queue
  -> gate before workspace mutation
```

Write-capable parallel execution should use worktree or branch isolation. Shared
workspace writes are high-risk and should require explicit approval.

## 9. Model API In The Middle Layer

Model API in the middle layer is deferred and not part of the current planning
baseline. It changes the product shape from transport/policy/audit to a model
caller, with API key management, billing, vendor dependency, prompt-injection,
and offline-mode implications.

Before implementation, create a dedicated ADR-0004-style decision:

```text
model API in middle layer: yes/no, scope, provider/key handling, billing,
prompt-injection controls, offline behavior, and non-goals
```

If accepted later, the first allowed scope should be minimal and explicit:

```text
PlannerModel only
user-provided key
opt-in per project/run
canExecute=false
no gate bypass
```

The broader roles below are future candidates, not approved baseline. The middle
layer should support structured model APIs only if a future ADR accepts them; it
must not introduce a free-form unbounded model chat loop.

Recommended structured model roles:

- PlannerModel.
- CriticModel.
- ArbiterModel.
- SummarizerModel.
- ReplannerModel.
- AuditExplainerModel.

Recommended bounded flow:

```text
Goal
  -> PlannerModel creates PlanDraft
  -> CriticModel reviews risks and omissions
  -> PlannerModel revises
  -> ArbiterModel emits FinalPlanCandidate
  -> Parser / Schema / PolicyEngine validate
  -> human approves
```

The model API may also:

- Suggest TeamSpec.
- Rank competing patches.
- Summarize conversation timelines.
- Propose replans after failure.
- Explain audit history.

AuditExplainerModel output is annotation only. UI must distinguish model
explanations from authoritative audit rows produced by AuditLog and
orchestrator.

Replanning that exceeds the approved Goal scope must re-trigger plan-level
approval, preserving ADR-0003 §5.

It may not authorize execution or gate bypass.

## 9.1 Self-Iteration Boundaries

Self-iteration is allowed only when bounded, auditable, and policy-checked.

Allowed non-mutating self-iteration:

- Plan critique.
- Plan refinement.
- Failure analysis.
- Replan proposal.
- Test failure diagnosis.
- Self-review.

Mutation-capable self-iteration must not bypass ADR-0003 controls. It requires:

- Approved plan scope.
- Step ceiling.
- Consecutive-failure stop.
- Per-step gate for state-mutating work.
- Audit.
- User interruption.

Self-iteration may propose a new step or plan. It may not approve that proposal,
grant workspace-write, commit/push, or continue after crossing the approved Goal
scope.

## 10. Harness Integration

Harness should be integrated as a verification and governance adapter before it
is considered an executor.

Initial responsibilities:

- Preflight.
- Governance check.
- Verification.
- Drift detection.
- Closeout readiness.

Potential endpoint modes:

```text
harness-verifier
  canVerify=true
  canExecute=false

harness-governance-reviewer
  canReview=true
  canExecute=false
```

`harness-verifier` is one implementation of the generic `verify` mode listed in
§4. It does not add a separate mode dimension.

Any mutation-capable harness mode must be a separately approved endpoint.

## 11. Memory Model

Memory should support project continuity without letting models write unchecked
project truth.

Memory classes:

- Session memory.
- Project memory.
- Decision memory.
- Agent performance memory.
- Task memory.

Write policy:

- Session memory can be automatic and short-lived.
- Project memory should be reviewed or derived from verified facts.
- Decision memory must come from ADRs, approvals, and gates.
- Agent performance memory should come from orchestrator metrics.
- Task memory should sync with WorkBuddy/task systems and execution ledger.

Long-lived memory review workflow is TBD. Until a concrete handoff defines it,
project memory writes should be derived from verified facts, human decisions, or
reviewed summaries, and linked back to AuditLog or ConversationTimeline events.

## 12. UI Direction

The UI should make project state legible.

Required views:

- Project overview.
- Goals.
- Plans and PlanSteps.
- AgentTeam slots.
- Task board.
- Conversation timeline.
- Audit ledger.
- Verification history.
- Patch/merge queue.

The UI should answer:

- What goal is active?
- What plan is approved?
- Which step is running?
- Which slot/provider owns it?
- What is blocked?
- What requires approval?
- What changed?
- Which checks passed or failed?
- Why is the project in its current state?

This turns scattered CLI work into a managed project workflow.

## 13. Suggested Delivery Sequence

Do not implement the full vision in one slice. Do not treat this sequence as a
commitment before v2.0 real-use validation.

Recommended sequence:

```text
v2.0
  Goal / Plan / Step
  orchestrator
  console goal view
  step progress
  gate

v2.1
  read-only project observability
  project conversation timeline
  derived memory only
  audit view
  harness verification records

v2.2
  WorkBuddy task source/result sink
  task dashboard

v2.3-spike
  single-provider multi-slot feasibility
  Codex worktree/patch isolation feasibility
  Claude/Codex external orchestration limits

v2.3
  AgentTeam TeamSpec
  single-provider multi-slot
  slot capability detection
  patch-proposal fanout

v2.4a (requires ADR for model API)
  model API planner/critic/arbiter
  bounded replan and self-iteration

v2.4b
  multi-provider AgentTeam

v2.5+
  governed workspace-write expansion
  worktree isolation
  merge queue
  advanced tool executors
```

Each v2.x slice needs its own ADR or implementation handoff before code. The
thresholds from ADR-0003 remain binding unless a later ADR changes them: step
ceiling default 1, hard ceiling 10, consecutive-failure stop threshold 2.

Kill gates:

- After v2.0, if real usage shows Goal/Plan/Step is awkward or low-value, freeze
  v2.1+ and re-plan.
- After v2.1 observability, if users do not rely on the project timeline/audit
  view, do not continue into AgentTeam.
- After v2.3-spike, if provider-level multi-slot is not feasible without large
  workspace orchestration, keep AgentTeam deferred.
- If the bridge must hold broad API keys/source state to compete with full IDE
  agents, re-evaluate whether the project should return to review gateway and
  safety-foundation scope.

If a freeze gate triggers, change this plan status from FUTURE / NOT BASELINE to
ARCHIVED-STALLED. Revival then requires a new ADR or replacement plan that
explicitly accepts the new route.

## 14. Non-Goals Until Separately Approved

- Unbounded autonomous loop.
- Silent parallelism when provider lacks multi-slot support.
- Automatic workspace-write.
- Automatic commit/push/merge/PR.
- Headless state-mutating gate.
- Shell endpoint.
- Dangerous bypass flags.
- External task tools triggering execution without middle-layer approval.

## 15. Immediate Planning Impact

Existing wording that says WorkBuddy is only a task source/result sink should be
read as the current implemented identity, not a permanent product limit.

Future planning should distinguish:

```text
tool as task system
tool as model provider
tool as execution provider
tool as verifier
```

Each identity must be registered separately with capabilities and policy.

Near-term baseline:

- v2.0 remains the active controlled-execution MVP.
- v2.1, if started, should be read-only observability first.
- AgentTeam, model API, and multi-slot execution are future options gated by
  v2.0 evidence, feasibility, and separate ADR/handoff approval.

Synchronized upstream documents as of this plan:

- `ADR-0003-controlled-execution-layer.md`
- `CLI-BRIDGE-v2.0-IMPLEMENTATION-HANDOFF.md`
- `PLAN-GOAL-DRIVEN-DYNAMIC-WORKFLOW.md`
- `PLAN-LAYERED-ORCHESTRATION-AND-CONSOLE.md`
- `PLAN-PROJECT-CONVERSATION-TIMELINE.md`

## 16. Open Questions

- Partial failure strategy: when one AgentSlot fails while others continue, does
  the TeamRun abort all, isolate the failed slot, or continue best-effort?
- Patch overlap detection: what is the minimal merge queue algorithm, and when
  does file overlap require human review?
- Cost model: how are ModelProvider and ExecutionProvider calls counted against
  budget limits?
- Long-lived memory review: who approves project memory writes, and how are
  they linked to audit/timeline evidence?
- Project/session ownership: how are goals, sessions, timeline threads, and task
  systems linked without overfitting too early?
