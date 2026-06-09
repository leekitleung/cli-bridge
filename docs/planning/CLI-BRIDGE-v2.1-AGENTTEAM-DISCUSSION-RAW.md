# CLI Bridge v2.1 AgentTeam / Project Control Plane Discussion Raw Record

## 0. Status

Status: RAW DISCUSSION RECORD.

This file records the local architectural discussion that followed v2.0 Goal ->
Plan generation. It preserves the original intent and decisions in a lightly
structured form. The canonical planning synthesis lives in
`PLAN-AGENTTEAM-PROJECT-CONTROL-PLANE.md`.

PLAN synchronization status: `PLAN-AGENTTEAM-PROJECT-CONTROL-PLANE.md` captures
the 10 raw topics in §1. The planning review
`CLI-BRIDGE-v2.1-AGENTTEAM-PLANNING-REVIEW.md` identified follow-up tightening
items, including explicit self-iteration boundaries, PolicyEngine invariants,
timeline/memory boundaries, and open questions.

This record is not an implementation handoff. It does not authorize new
execution code, new workspace-write behavior, or any bypass of ADR-0003 gates.

## 1. User Questions Captured

The discussion centered on these user questions and corrections:

1. Whether harness, memory, self-iteration, and related mechanisms can be
   integrated into the middle layer.
2. Whether AgentTeam can define its own roles.
3. What starts an AgentTeam.
4. Whether WorkBuddy can enable AgentTeam.
5. Whether the middle-layer UI can show project task progress because CLI-only
   development loses project control after extended work.
6. Correction: WorkBuddy, qclaw, openclaw, and hermes should be able to execute
   code.
7. Clarification: AgentTeam does not necessarily mean multiple tools. The
   expected mode is like Claude Code or Codex: a single execution object can run
   multiple model/agent slots in parallel.
8. If an execution layer does not support multiple slots, the middle layer
   should say so rather than pretending it can parallelize.
9. Whether the middle layer should add a model API that can discuss plans with
   upstream models, or whether there is a better approach.
10. Request: record these discussions locally and organize them into a planning
    document without changing the original meaning.

## 2. Raw Conclusions Preserved

### 2.1 Middle layer as project control plane

The middle layer should evolve from a review console into a project control
plane. It should manage:

- Goal / Plan / Step state.
- AgentTeam composition and runs.
- Harness / verification results.
- Memory.
- Conversation timeline.
- Audit ledger.
- WorkBuddy tasks and progress.
- Human gates.

The middle layer should not become an unbounded free-running agent. It should
remain the control plane that governs agents, tools, and execution providers.

### 2.2 Harness integration

Harness can be integrated as a governed adapter for:

- Preflight checks.
- Governance checks.
- Verification commands.
- Closeout checks.
- Drift detection.

Initial stance: harness should be `canVerify` / `canReview` oriented and should
not automatically gain project-writing authority. Any mutation-capable harness
mode must become a separately registered execution endpoint with capability,
scope, gate, and audit.

### 2.3 Memory integration

Memory should be integrated, but split by purpose:

- Session memory: facts within one goal/run.
- Project memory: stable project facts, conventions, test commands, traps.
- Decision memory: ADRs, approvals, gate decisions, scope grants.
- Agent memory: endpoint performance, failure rate, cost, specialty.
- Task memory: WorkBuddy/task progress and blocking facts.

Short-lived memory may be written automatically. Long-lived project or decision
memory should not be written just because a model said it. It should be derived
from approved decisions, verification, or reviewed summaries.

### 2.4 Self-iteration

Self-iteration is acceptable when bounded and non-mutating:

- Plan critique.
- Plan refinement.
- Failure analysis.
- Replan proposal.
- Test failure diagnosis.
- Self-review.

Mutation-capable self-iteration must go through ADR-0003 style controls:

- Plan approval.
- Step ceiling.
- Retry ceiling.
- Gate for state-mutating steps.
- Audit.
- Human interruption.

### 2.5 WorkBuddy and other tools can execute, but only as governed endpoints

Earlier wording that treated WorkBuddy as permanently non-executing was too
narrow. The corrected model is:

- WorkBuddy as task system: task source, project context, progress board,
  result sink.
- WorkBuddy as executor endpoint: a separately registered execution identity
  with `canExecute=true`, scope, gates, and audit.

The same applies to qclaw, openclaw, hermes, Codex, Claude Code, and future
tools. Tool name does not determine authority. Endpoint identity and capability
do.

Unsafe form:

```text
WorkBuddy task state changes -> automatically trigger code execution
```

Safe form:

```text
WorkBuddy task
  -> middle layer creates or links a Goal
  -> Plan and TeamSpec are generated
  -> user approves scope
  -> orchestrator dispatches governed executor endpoints
  -> progress and results flow back to WorkBuddy
```

### 2.6 AgentTeam role self-definition

AgentTeam may propose roles, but may not grant itself authority.

Allowed self-proposed fields:

- Role names.
- Responsibility.
- Preferred model/tool.
- Suggested routing.
- Required context.

Not allowed:

- `canExecute`.
- `workspace-write`.
- Shell access.
- Commit/push authority.
- Gate bypass.
- Policy mutation.

The middle layer must bind proposed roles to approved endpoints after capability
and policy checks.

### 2.7 AgentTeam does not require multiple tools

AgentTeam should first mean multiple agent slots, not necessarily multiple
external tools.

Preferred model:

```text
ToolProvider
  codex / claude-code / workbuddy / qclaw / openclaw / hermes

ExecutionObject
  a concrete project-bound provider instance

AgentSlot
  one worker/model/role running inside that execution object

AgentTeam
  a set of AgentSlots coordinated by the middle layer
```

This supports the expected mode:

```text
One Codex execution object
  -> planner slot
  -> executor-a slot
  -> executor-b slot
  -> verifier slot
```

or:

```text
One Claude Code execution object
  -> several subagent-like slots
```

Multi-tool teams are a later, more complex mode, not a requirement for the
first AgentTeam design.

### 2.8 Multi-slot capability must be explicit

The middle layer must not assume every execution layer supports multiple slots.
Each execution object should declare:

- `supportsParallelSlots`.
- `maxSlots`.
- Supported isolation modes.
- Supported execution modes.

If a user requests a multi-slot run and the provider cannot support it, the UI
must say so and offer safe alternatives:

- Sequential fallback.
- Patch-only fanout if supported.
- Switch to a provider that supports parallel slots.

It must not silently fake parallelism.

### 2.9 Workspace isolation is required for parallel execution

Parallel write-capable execution against one shared working tree is unsafe.
Default safe modes:

- Patch proposal only.
- Per-slot worktree.
- Per-slot branch.
- Merge queue with review.

Direct shared workspace writing should be a high-risk mode requiring explicit
scope and gate policy.

### 2.10 Middle-layer model API

A middle-layer model API is useful, but it should be a structured control-plane
model, not a free-form model chat loop.

Recommended responsibilities:

- Plan.
- Critique.
- Rank.
- Merge.
- Summarize.
- Replan.
- Audit explanation.

Recommended flow:

```text
Goal
  -> PlannerModel creates PlanDraft
  -> CriticModel reviews omissions/risks/step granularity
  -> PlannerModel revises
  -> ArbiterModel emits FinalPlanCandidate
  -> Parser/Schema/PolicyEngine validate
  -> Human approves
```

Free-form model-to-model conversation is not the preferred default because it
has weak bounds, unclear responsibility, harder audit, and cost risk.

### 2.11 UI must show project management state

The middle-layer UI should address the CLI weakness: project control is lost
after long development sessions.

Required view families:

- Project overview.
- Goals.
- Plans and steps.
- AgentTeam slots and run state.
- Task board.
- Conversation timeline across terminals/tools.
- Audit ledger.
- Verification history.
- Merge/patch queue.

The UI should answer:

- What is the current project goal?
- Which plan is approved?
- Which step is running?
- Which agent slot is responsible?
- What is blocked?
- What needs user approval?
- What changed?
- Which tests/checks passed?
- Why did the project reach the current state?

## 3. Non-Authorizations

This discussion does not authorize:

- Unbounded agent loops.
- Headless gate confirmation.
- Automatic workspace-write.
- Automatic commit/push/merge/PR.
- Shell endpoints.
- Dangerous bypass flags.
- WorkBuddy/qclaw/openclaw/hermes executing outside the middle-layer endpoint
  registry and policy engine.

## 4. Link To Canonical Plan

The structured plan is:

```text
docs/planning/PLAN-AGENTTEAM-PROJECT-CONTROL-PLANE.md
```
