# ADR-0028: Agent Work-Cycle Automation Loop

Status: Proposed

Date: 2026-07-01

## Context

Conversation actions (ADR-0026) and generic route adapters (ADR-0027) can
dispatch one governed unit of work per confirmation, but project automation
needs a bounded loop that repeats work cycles until a declared stop condition
is met. Without a generic loop, automation is limited to single-shot
dispatches with no stateful cycle tracking.

## Decision

Add a persistent Automation Loop state machine layered above existing Goal,
Conversation Action, Review Command, and WorkBuddy inbox primitives. A loop
advances by explicit ticks:

```text
observe -> evaluate stop conditions -> dispatch one governed action
        -> wait for result / external return -> record evidence -> repeat
```

- Each tick dispatches at most one governed action.
- `run` is a bounded wrapper (`maxTicksPerRun`) around repeated `tick` calls.
- Stop conditions are evaluated before every dispatch.

## Constraints

- Loop ticking/running requires local Console cookie authority.
- Extension and ChatGPT content scripts cannot tick, run, confirm, or dispatch
  loops.
- The loop reuses existing Conversation Action, Review Command, and WorkBuddy
  inbox/result primitives.
- No generic shell, run, exec, Git, PR, or workspace mutation endpoint is
  added.
- Stop conditions are evaluated before every dispatch.
- All loop evidence stores hashes, route ids, action ids, task ids, and
  status; it must not store raw pairing tokens.

## Stop Conditions

The loop stops before dispatching the next cycle if any condition is true:

| Condition | Trigger |
|---|---|
| `goal-done` | Linked goal is done |
| `goal-cancelled` | Linked goal is cancelled |
| `goal-failed` | Linked goal is failed |
| `max-cycles` | Completed cycle count reached configured max |
| `deadline` | Wall-clock deadline reached |
| `no-progress` | Progress hash did not change for N consecutive cycles |
| `awaiting-gate` | Next action needs human approval |
| `action-failed` | Last action failed |
| `endpoint-unavailable` | Selected target endpoint is offline or missing |
| `manual-pause` | Operator paused the loop |
| `cancelled` | Operator cancelled the loop |

## Acceptance Conditions

- A loop with `maxCycles: 2` dispatches exactly two cycles and then stops with
  reason `max-cycles`.
- A loop stops on `no-progress` without creating another task.
- A cancelled loop cannot tick or run.
- Extension session auth receives 403 on tick/run routes.

This ADR requires explicit human acceptance before execution implementation
(refer to `docs/superpowers/plans/2026-07-01-agent-work-cycle-loop.md` for
the full 6-task implementation plan).
