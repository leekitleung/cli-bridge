# Plan: AgentTeam + Project Control Plane

## 0. Status

Status: PLAN.

This document organizes the AgentTeam, memory, harness, model API, execution
provider, and project-management UI direction without changing the meaning of
the discussion recorded in
`CLI-BRIDGE-v2.1-AGENTTEAM-DISCUSSION-RAW.md`.

It extends, but does not replace:

- `ADR-0003-controlled-execution-layer.md`
- `CLI-BRIDGE-v2.0-IMPLEMENTATION-HANDOFF.md`
- `PLAN-GOAL-DRIVEN-DYNAMIC-WORKFLOW.md`
- `PLAN-LAYERED-ORCHESTRATION-AND-CONSOLE.md`
- `PLAN-PROJECT-CONVERSATION-TIMELINE.md`

This is not an implementation handoff. Code changes that add new execution
authority still require their own ADR or approved implementation handoff.

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

## 2. Core Architecture

```text
Project Control Plane
  -> GoalStore / PlanStore / StepStore
  -> AgentTeam Orchestrator
  -> ModelProvider Registry
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
  canExecute=false by default

ExecutionProvider
  can perform project work
  may support patch proposal, verification, workspace-write, or task execution
```

PolicyEngine is the hard boundary. Model output is never authorization.

## 3. AgentTeam Definition

AgentTeam does not require multiple external tools. The first-class concept is
multiple agent slots.

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

The default AgentTeam mode should be single-provider, multi-slot:

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

- `supportsParallelSlots`: whether multiple slots can run concurrently.
- `maxSlots`: hard concurrency limit.
- `isolationModes`: `patch-only`, `worktree`, `branch`, `shared-workspace`.
- `supportedModes`: `review-only`, `patch-proposal`, `workspace-write`,
  `verify`, `task-sync`.

If a requested AgentTeam needs more slots than a provider supports, the middle
layer must report that explicitly and offer safe alternatives. It must not
silently fake parallel execution.

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

The middle layer should support a control-plane model API, but not a free-form
unbounded model chat loop.

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

It may not authorize execution or gate bypass.

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

Do not implement the full vision in one slice.

Recommended sequence:

```text
v2.0
  Goal / Plan / Step
  orchestrator
  console goal view
  step progress
  gate

v2.1
  project conversation timeline
  memory store
  harness verification records

v2.2
  WorkBuddy task source/result sink
  task dashboard

v2.3
  AgentTeam TeamSpec
  single-provider multi-slot
  slot capability detection
  patch-proposal fanout

v2.4
  multi-provider AgentTeam
  model API planner/critic/arbiter
  replan and self-iteration

v2.5+
  governed workspace-write expansion
  worktree isolation
  merge queue
  advanced tool executors
```

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

