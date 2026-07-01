# ADR-0029: Passthrough Route Plane

Status: Accepted

Date: 2026-07-02

## Context

ADR-0026 and ADR-0027 made Project Conversation dispatch through governed
route adapters, and ADR-0028 added bounded automation loops. The current
Conversation model still couples user messages directly to a paired target.
It does not yet separate user-visible transcript output from internal
instruction, route, and execution state.

## Decision

CLI Bridge will be modeled as a stateful control-plane router and passthrough
data-plane. It will not act as an agent, planner, reviewer, or reasoning
pipeline. It may validate, route, persist, audit, redact, delimit, and safely
render protocol data. It must not semantically interpret, summarize, rank,
rewrite, merge, or synthesize executor results.

Conversation messages will move through:

conversation message -> internal instruction packet -> internal task route
-> executor endpoint -> execution packet -> user-visible executor_output event

The first implementation phase supports only `mode: single`.

## Constraints

- Planner output and instruction packets are internal by default.
- User transcript may render only user_message, status, and executor_output.
- Status events are bridge-authored but must remain short and non-semantic.
- Executor output is the only source for user-visible answer body.
- Parallel and fallback modes are deferred.
- No generic shell, run, exec, Git, PR, or workspace mutation endpoint is added.
- Mutation routes remain protected by the existing local boundary and credential gates.

## Acceptance Conditions

- No instruction packet enters user transcript.
- No route id, task id, action id, endpoint secret, token, cookie, or auth header enters user transcript.
- WorkBuddy executor output returns through an execution packet before transcript rendering.
- Bridge-authored final answers are impossible in Project Conversation rendering.
- Existing single-target conversation pairing still works.

This ADR requires explicit human acceptance before execution implementation.
