# ADR-0031: Policy-Gated Planner Orchestration

Status: Accepted

Date: 2026-07-02

## Context

ADR-0030 introduced a planner-gated safety breaker:

```text
User -> planner proposal -> manual accept -> executor -> raw result
```

That boundary prevents accidental direct execution, but it is not a complete
product flow. Requiring manual Accept or Reject for every turn turns Project
Conversation into an approval console rather than a usable planning session.
The current runtime also allows internal route state such as `queued`,
`workbuddy-execution`, dispatch actions, and task status to leak into the main
chat surface.

The next phase must treat Conversation as a planner-first interaction:

```text
Conversation is a Planner Session by default.
Execution is a gated side effect, not a chat target.
The bridge routes planner output through a policy gate before creating any
executor task.
```

## Decision

CLI Bridge will introduce policy-gated planner orchestration.

Conversation messages route to a planner session by default. The planner
returns a structured `PlannerOutputEnvelope` containing user-visible text and a
machine-readable intent. A pure `GateEvaluator` consumes the envelope, session
state, executor availability, and policy config to decide whether to continue
planning, auto-execute, require user confirmation, or block.

The bridge remains an orchestration layer. It does not author semantic final
answers, summarize planner or executor output, rank outputs, or merge multiple
agent responses into an interpreted answer.

## Runtime Flow

```text
User message
  -> PlannerAdapter
  -> PlannerOutputEnvelope
  -> user transcript shows visibleText
  -> GateEvaluator
       -> continue_planning
       -> auto_execute
       -> require_user_confirm
       -> blocked
  -> accepted/auto instruction route
  -> executor endpoint
  -> raw executor result
  -> user transcript shows executor output
```

## Planner Output Envelope

Planner adapters MUST return structured envelopes. The gate MUST NOT parse
free-form natural language to decide whether execution is allowed.

```ts
export type PlannerIntent =
  | 'answer'
  | 'clarify'
  | 'propose_plan'
  | 'request_execution'
  | 'blocked';

export interface PlannerOutputEnvelope {
  id: string;
  sessionId: string;
  plannerEndpointId: string;
  visibleText: string;
  intent: PlannerIntent;
  proposedInstruction?: {
    summary: string;
    payload: string;
    targetExecutorIds?: string[];
    riskHints?: string[];
  };
  requiredInputs?: string[];
  createdAt: string;
}
```

Only `visibleText` is rendered in the main transcript. `proposedInstruction`
is internal until the policy gate returns `auto_execute` or the user explicitly
confirms a `require_user_confirm` decision.

## Gate Evaluator

The gate is a deterministic pure function.

```ts
export type GateDecision =
  | { type: 'continue_planning'; reason: string }
  | { type: 'auto_execute'; instruction: InstructionPacketDraft; reason: string }
  | { type: 'require_user_confirm'; proposalId: string; reason: string }
  | { type: 'blocked'; reason: string; missing: string[] };

export interface GateInput {
  plannerOutput: PlannerOutputEnvelope;
  sessionState: PlannerSessionState;
  executorAvailability: ExecutorAvailability[];
  policyConfig: GatePolicyConfig;
}
```

Gate decisions are auditable and persisted as internal state. They are not
shown in the main transcript by default.

## Executor Availability

Executor availability is checked before instruction creation or dispatch.
The system must not create an executor task and then discover that the executor
is unavailable.

```ts
export interface ExecutorAvailability {
  endpointId: string;
  status: 'online' | 'offline' | 'unknown';
  lastSeenAt?: string;
  capabilities: string[];
  claimMode: 'push' | 'pull';
}
```

For pull-based executors such as WorkBuddy, `online` requires an explicit
heartbeat, lease, or recent claim-readiness signal. A registry entry alone is
not enough to count as executor availability.

## Auto-Execute Boundary

The first implementation keeps `auto_execute` intentionally narrow. It is
allowed only when all conditions are true:

- Executor is online.
- Planner output contains a structured `proposedInstruction`.
- Operation is read-only or pure transformation.
- No filesystem mutation.
- No shell or command execution.
- No Git operation.
- No network request.
- No credential, token, cookie, or secret use.
- No external account mutation.
- No deletion, overwrite, publish, or send operation.

All other execution requests require explicit user confirmation or are blocked.

## ChatGPT Web Planner Boundary

ChatGPT Web can be a planner endpoint only under the current browser-extension
safety boundary.

Until a separate ADR approves a safe auto-send mechanism, the ChatGPT Web
planner adapter is interactive:

```text
Bridge fills ChatGPT Web composer
User manually sends
Extension reads planner response
Bridge receives planner envelope
```

The extension must not synthesize send-button clicks, keyboard submission,
`requestSubmit()`, `.submit()`, or equivalent automatic ChatGPT Web sending.

Automatic planner execution requires a non-Web-UI planner endpoint such as a
local planner process, Codex CLI planner, Claude Code planner, or future model
API adapter. Mock planner is test-only and must not be the default runtime
planner.

## Transcript Visibility

The main transcript may show only:

- User messages.
- Planner `visibleText`.
- Required user confirmation prompt.
- Executor raw result.
- Short unavailable/blocked user-facing state.

The main transcript must not show:

- `queued`
- `workbuddy-execution`
- `dispatch`
- `action`
- `route`
- instruction packet ids
- task ids
- endpoint internals
- gate decision internals

Internal state belongs in an inspect/debug surface.

## Red Lines

1. User messages MUST route to planner sessions by default.
2. Executor endpoints MUST NOT appear as primary chat targets.
3. Executor tasks MUST NOT be created before policy gate approval.
4. Manual Accept/Reject MUST NOT be required for every turn.
5. Mock planner MUST be test-only and MUST NOT be default runtime planner.
6. Internal task, route, dispatch, queued, action, and adapter events MUST NOT appear in the main transcript.
7. Executor offline MUST produce blocked/unavailable state before dispatch.
8. Bridge MUST NOT author semantic final answers.
9. Planner visible output may enter transcript; planner instruction payload remains internal until gate decision.
10. Executor raw result may enter transcript; bridge may only wrap, redact, delimit, or normalize transport.

## Non-Goals

- No generic shell, run, exec, Git, PR, or workspace mutation endpoint.
- No automatic ChatGPT Web send in this ADR.
- No parallel executor routing.
- No fallback executor routing.
- No semantic planner-output synthesis by the bridge.
- No full replacement of ADR-0029/0030 route stores; this phase layers policy
  orchestration in front of the existing route plane.

## Acceptance Conditions

- Conversation message reaches a real configured planner endpoint or returns
  `planner-unavailable`; it does not silently use mock planner.
- Mock planner is available only in tests or explicit development fixtures.
- Main transcript hides queued, route, action, task, dispatch, and adapter names.
- Planner output is stored as a `PlannerOutputEnvelope`.
- Gate evaluator is pure and covered by deterministic tests.
- Ordinary answer or clarification output does not create instruction packets or executor tasks.
- Request-execution output with offline executor returns `blocked` before dispatch.
- Request-execution output without structured instruction returns `blocked`.
- Narrow low-risk structured instruction can auto-execute when executor is online.
- High-risk structured instruction requires user confirmation.
- Extension session cannot force auto-execute or confirm execution.
- Executor raw result is rendered without bridge-authored semantic rewrite.
- Browser E2E proves no permanent WorkBuddy queued state when no worker is connected.

This ADR requires explicit human acceptance before execution implementation.
