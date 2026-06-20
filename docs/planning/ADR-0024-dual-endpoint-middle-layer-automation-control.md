# ADR-0024: Dual-Endpoint Middle-Layer Automation Control

Status: Accepted

Date: 2026-06-20

## Review Findings

1. The repository already has the correct foundations: `AgentEndpoint`, endpoint
   capabilities, Goal/Plan/PlanStep state, provider capability registration,
   plan approval, and state-changing step gates. A second orchestration state
   machine would create competing ownership and recovery rules.

2. Codex and Claude currently have bounded command adapters and executable
   capability metadata. WorkBuddy's implemented identity is a task source and
   result sink with `canExecute=false`; it is not an execution transport.

3. ADR-0023 authorizes bounded ChatGPT Web submission and return, but explicitly
   treats returned content as untrusted data with no execution authority. This
   boundary is compatible with using ChatGPT Web as a reasoning endpoint only
   if the middle layer converts its return into a proposal that still requires
   an execution gate.

4. The two intended routes are structurally the same above their transports:
   an upper reasoning endpoint produces a plan or review artifact, then a fixed
   execution endpoint receives a bounded proposal after human confirmation.
   Letting the CLI route bypass the middle layer would create different audit,
   pause, retry, and permission semantics for equivalent work.

5. Provider choice and model tier are separate axes. The same tool may occupy
   both reasoning and execution roles through different registered endpoint
   profiles, while two different tools may be paired freely at run creation.

## Context

CLI Bridge needs one automation control model for two upper reasoning routes:

- a high-tier Codex, Claude Code, or later compatible CLI endpoint; or
- ChatGPT Web, using the already authorized Web relay.

Both routes hand work to a medium- or low-tier execution endpoint. The operator
normally chooses two tools, but may choose separate high- and lower-tier
profiles of the same tool. Human confirmation must control automation, not
merely observe it.

The project console is the authoritative control surface. The extension may
mirror state and expose emergency controls, but it must not choose endpoints,
working directories, permission profiles, or execution scope.

## Decision

### 1. Both Routes Use the Middle Layer

All reasoning-to-execution automation passes through CLI Bridge. A CLI
reasoning endpoint and ChatGPT Web are transport alternatives behind the same
reasoning contract. Neither may dispatch directly to an executor.

The middle layer remains responsible for:

- endpoint capability validation;
- immutable run binding;
- plan and proposal persistence;
- human confirmation;
- pause, resume, cancel, timeout, and failure state;
- sanitized audit evidence;
- dispatch to the registered execution adapter.

### 2. Reuse Goal/Plan as the Run State Machine

The implementation must extend the current Goal/Plan/PlanStep model. It must not
create an unrelated `AutomationRun` workflow with duplicate step ownership.

Each automated plan receives one immutable binding:

```ts
interface RunEndpointBinding {
  goalId: string;
  planId: string;
  reasoningEndpointId: string;
  executionEndpointId: string;
  reasoningTier: 'high';
  executionTier: 'medium' | 'low';
  executionPermissionProfile: string;
  executionWorkingDirectoryRef: string;
  maxSteps: number;
  maxReasoningRounds: number;
  deadlineAt: string;
  parentPlanId?: string;
  bindingHash: string;
  lockedAt: string;
}
```

`executionWorkingDirectoryRef` is a server-resolved project reference, not an
extension-supplied path. The binding hash covers both endpoint identities,
tiers, permission profile, project reference, limits, and deadline.

### 3. Bindings Are Immutable During a Run

The operator may pair compatible reasoning and execution endpoints freely when
creating a plan. Once the plan is approved and its binding is locked:

- neither endpoint may be replaced;
- model tier, permission profile, project reference, and limits may not widen;
- no automatic provider failover or fallback is allowed;
- adapter failure pauses the plan and does not select another endpoint.

Changing an endpoint or permission profile requires cancelling or pausing the
old plan and deriving a new plan with `parentPlanId`. The new binding requires a
new start approval and retains lineage to the old plan.

### 4. Reasoning Endpoints Produce the Same Artifact

Every reasoning adapter must normalize its result into a bounded artifact:

```ts
interface ReasoningArtifact {
  artifactId: string;
  goalId: string;
  planId: string;
  endpointId: string;
  kind: 'plan-draft' | 'review-result' | 'execution-proposal';
  contentHash: string;
  summary: string;
  createdAt: string;
}
```

Raw model output remains untrusted input. It cannot select an execution
endpoint, alter the binding, approve itself, widen permissions, or dispatch a
command. ChatGPT Web content additionally remains subject to ADR-0023's
redaction, routing, and no-execution rules.

### 5. Every Execution Dispatch Requires Human Confirmation

Automation-mode execution is stricter than the existing state-changing-only
step gate. Every execution proposal, including a nominally read-only command,
must receive a one-time confirmation before dispatch.

The confirmation card must show:

- reasoning endpoint and artifact identity;
- execution endpoint and model/tier profile;
- prompt or task preview and content hash;
- project and resolved working directory;
- permission profile;
- current step and reasoning round;
- remaining step/round limits and deadline;
- `Confirm`, `Edit`, and `Cancel` controls.

A confirmation is bound to `planId`, `stepId`, `proposalId`, `contentHash`, and
`bindingHash`. It is single-use. Editing creates a new proposal and invalidates
the old confirmation. Confirmation does not authorize later steps.

### 6. Execution Uses One Provider-Neutral Lifecycle

Codex, Claude Code, and future execution tools must use the same lifecycle:

```text
draft -> awaiting-confirmation -> confirmed -> dispatching
      -> returned | failed | paused | cancelled | timed-out
```

Provider-specific invocation belongs inside a registered adapter. An adapter
must not expose generic shell execution, accept arbitrary executable paths, use
dangerous permission-bypass flags, or reinterpret a reasoning artifact as
approval.

The current WorkBuddy identity remains non-executing. A future WorkBuddy
execution route requires a separately registered endpoint identity, a bounded
adapter, capability evidence, focused tests, and explicit ADR amendment or
replacement. Existing WorkBuddy task-source/result-sink records must not be
silently promoted.

### 7. Project Console Owns Control

The server-backed project console is authoritative for binding selection,
start approval, per-dispatch confirmation, edit, pause, resume, and cancel.

The extension may:

- display the current plan, binding identities, step, round, and state;
- request pause, resume, or cancel through server APIs;
- show that an execution proposal awaits confirmation.

The extension must not select or change endpoints, permissions, project roots,
proposal content, or approval records.

### 8. Fail Closed Without Automatic Retry

Any ChatGPT error, ambiguous page state, endpoint timeout, parse failure,
capability mismatch, stale confirmation, dispatch uncertainty, or result
correlation failure immediately pauses the plan. No automatic retry is allowed.

Pause or cancel wins before reasoning advance, proposal confirmation, dispatch,
and next-step creation. Recovery requires an explicit operator action. If it is
uncertain whether an execution was dispatched, resume must not replay it.

## Relationship to Existing Decisions

- ADR-0023 remains unchanged: ChatGPT Web may transport bounded reasoning data
  but returned content has no execution authority.
- ADR-0004 remains unchanged: model API endpoints are non-executing unless a
  separate accepted decision changes their capability.
- ADR-0006 remains unchanged for the implemented WorkBuddy identity and current
  sequential provider rules.
- ADR-0003's approval boundary is strengthened for this automation mode: every
  execution dispatch requires confirmation, not only state-changing steps.
- `PLAN-LAYERED-ORCHESTRATION-AND-CONSOLE.md` and
  `PLAN-GOAL-DRIVEN-DYNAMIC-WORKFLOW.md` remain directional background. This
  ADR is the controlling decision for dual-endpoint automation.

## Alternatives Considered

### CLI Direct, ChatGPT Web Through the Middle Layer

Rejected. Equivalent reasoning routes would have different permissions, audit
records, pause behavior, and recovery semantics.

### Dynamic Provider Routing and Automatic Failover

Rejected. Mid-run switching breaks reproducibility and makes a prior approval
apply to a different identity than the operator reviewed.

### One Tool Permanently Assigned to Each Role

Rejected. Role is a capability and tier assignment, not a permanent provider
identity. Compatible endpoint profiles should be freely pairable at run start.

### Extension as the Main Controller

Rejected. It would move endpoint and permission decisions into an untrusted Web
surface and duplicate server-owned state.

## Non-Goals

- parallel execution or multi-agent scheduling;
- automatic provider selection, fallback, or load balancing;
- generic shell, terminal, arbitrary argv, MCP, or browser-computer authority;
- endpoint or permission selection by ChatGPT content or the extension;
- automatic commit, push, merge, PR creation, deployment, or approval;
- promotion of the current WorkBuddy identity to executor;
- changes to Stage A/B/C ChatGPT DOM submission or loop policy;
- bypassing existing capability, project, or permission boundaries.

## Risks and Mitigations

- **Confirmation fatigue:** every execution is gated. Mitigate with concise,
  complete cards; do not weaken the gate through batch approval.
- **Same-tool role confusion:** two profiles of one provider may look alike.
  Show endpoint id, model/tier, permission profile, and role on every card.
- **Uncertain dispatch:** a timeout may occur after process creation. Pause and
  require reconciliation; never replay automatically.
- **Prompt injection:** reasoning output may request wider authority. Validate
  against the locked binding and treat the output only as proposal data.
- **Adapter drift:** providers may behave differently. Require a shared adapter
  conformance suite before registering an execution endpoint.

## Acceptance and Implementation Gate

This ADR requires an explicit operator reply of `接受`. Creating this document
does not accept it.

Until acceptance:

- `RP-DUAL-ENDPOINT-AUTOMATION-CONTROL` remains blocked;
- no runtime, API, schema, console, extension, or adapter implementation is
  authorized by this decision;
- existing ADR-0023 Web automation and current Goal/Plan behavior remain the
  only active behavior.
