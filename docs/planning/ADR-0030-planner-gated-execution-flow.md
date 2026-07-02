# ADR-0030: Planner-Gated Execution Flow

Status: Accepted

Date: 2026-07-02

## Context

ADR-0026 through ADR-0029 established the passthrough route plane: Conversation
messages flow through governed route adapters into an executor endpoint. The
current model couples user messages directly to the executor via the route
adapter. A user message immediately creates an instruction packet, a task route,
and an action — before any human review of what the executor will do.

This is a safety gap. The system needs an explicit planning gate: the user
should see a planner-generated proposal and explicitly accept it before any
executor task is created.

## Decision

CLI Bridge will introduce a **planner-gated execution flow**. The Conversation
lifecycle will change from:

```
User → executor
```

to:

```
User → planner → plan proposal → user accept → executor → raw result
```

### P0 Principle

```
plan.status !== accepted
⇒ no instruction packet
⇒ no task route
⇒ no executor task
```

The planner output is a **proposal only**. It does not become an instruction or
automatically create any execution artifact. The user must explicitly accept the
proposal to transition into the existing v2.21 route plane.

### Conversation = Planning Session

Every conversation message enters a planning session. The planner adapter
generates a `ConversationPlanProposal` — a structured, user-visible proposal
with title, body, steps, constraints, and risk notes. The user sees this in
the Console transcript and chooses to Accept or Reject.

### Plan Proposal State Machine

```
proposed → accepted → dispatching → dispatched → returned
proposed → accepted → dispatching → dispatched → failed
proposed → rejected
proposed → superseded (revision v2 introduced)
```

- `proposed` is an **immutable terminal state** for that version.
- `superseded` means a newer revision exists; the old version can no longer be
  accepted.
- No in-place modification after `proposed`. Modifications produce a new
  `planId` + incremented `version`.
- Only `proposed` plans are eligible for acceptance.

### Accept / Reject

- **Accept**: transitions plan to `accepted`, then creates the instruction
  packet, task route, and dispatches the executor via the existing v2.21
  route adapter infrastructure.
- **Reject**: transitions plan to `rejected`; no instruction, route, or task
  is created.

### Authority Boundary

- **Only Console cookie-authenticated requests** can accept/reject a plan.
- Extension (pairing token / auto-pair session) receives HTTP 403.
- Planner output is user-visible as a proposal; it never automatically
  becomes an instruction packet.
- Accept is the **sole execution gate** — no other path creates an
  executor task from a conversation message.

### User Transcript Visibility

Before accept:
- User sees: user message, planner proposal (title + body + steps)

After accept:
- User sees: dispatching status, executor raw output
- User does NOT see: internal ids (route, task, action, instruction packet),
  dispatcher internals, route adapter names.

### Result Continuation

After the executor completes:
- Plan status updates to `returned` (success) or `failed` (error).
- Executor raw output is the only user-visible answer body.
- Failure status is short and non-semantic.
- No planner draft leaks after accept.

### Plan Immutability Rule

Once a plan is `proposed`, it becomes **immutable**. Any modification creates a
new plan revision with a new `planId` or incremented `version`.

This rule prevents three systemic failures:

| Failure mode | Without immutability | With immutability |
|-------------|---------------------|-------------------|
| Accept verification | User accepts a "moving target" that planner mutates concurrently | Accept targets a frozen snapshot; verifiable |
| Execution mismatch | Planner changes content after accept; executor runs stale/divergent plan | Executor input = frozen plan snapshot at accept time |
| Audit trail | Cannot reconstruct: "user accepted what exactly?" | Every accept references a specific, immutable plan version |

Rules:
- A plan becomes immutable once `status = "proposed"`.
- Any planner update MUST generate a new `planId` or increment `version`.
- Only immutable plan instances are eligible for acceptance.
- Execution MUST reference a frozen plan snapshot, not a mutable `planId`.

### System Invariants

These three invariants MUST hold before any EX implementation begins:

**I1 — Execution isolation**: executor input = frozen plan snapshot only.
The executor receives a snapshot at accept time. It never reads mutable plan state.

**I2 — UI cannot mutate plan**: UI actions only produce `accept`, `reject`,
or `new revision`. The UI never modifies plan content in place.

**I3 — Bridge cannot patch plan after dispatch**: once a plan moves past
`dispatching`, no field modification is allowed. The plan is read-only.

## Constraints

- No new shell, run, exec, Git, PR, or workspace mutation endpoint is added.
- Extension does not gain accept/dispatch permissions.
- The planner MVP may use the existing `command review` adapter or a mock
  planner adapter. Multi-planner routing is deferred.
- The existing single-target conversation pairing still works.
- Plan proposals are persisted via the existing JSON snapshot mechanism.

## Acceptance Conditions

- [ ] Conversation message creates a plan proposal, not an executor task.
- [ ] WorkBuddy inbox remains empty before plan accept.
- [ ] Instruction store remains empty before plan accept.
- [ ] Route store remains empty before plan accept.
- [ ] Accept creates instruction packet, route, and enqueues executor task.
- [ ] Reject creates no instruction, route, or task.
- [ ] Extension cannot accept a plan (403).
- [ ] User transcript shows planner proposal before accept.
- [ ] User transcript hides internal ids (route, task, action, instruction).
- [ ] Final answer only from executor raw output.
- [ ] Plan content is immutable after `proposed`; mutation produces new version.
- [ ] Accept validates the plan is still `proposed` and not `superseded`.
- [ ] Executor input is a frozen plan snapshot at accept time.
- [ ] Dispatched plan cannot be modified (I3 invariant).
- [ ] Existing conversation pairing and route adapter tests still pass.

This ADR requires explicit human acceptance before execution implementation.
