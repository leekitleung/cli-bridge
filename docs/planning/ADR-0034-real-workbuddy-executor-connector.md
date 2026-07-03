# ADR-0034: Real WorkBuddy Executor Connector

Status: Accepted

Date: 2026-07-03

## Context

ADR-0032 introduced a local WorkBuddy worker process that polls the inbox and
returns diagnostic echo results. This diagnostic worker was useful for verifying
the inbox/result channel works, but its output (`diagnostic worker received: ...`)
is now leaking into the main conversation transcript as a fake "executor output".

The current state conflates two distinct concerns:

1. **Diagnostic connector** — a lightweight probe that verifies the inbox/result
   channel is operational (echo-only, no real execution).
2. **Real executor connector** — a WorkBuddy worker that performs actual
   computation and returns genuine artifacts, results, and logs.

The diagnostic echo creates a false sense of execution readiness. Users see
"executor output" in the transcript, but it's just a loopback of their own
prompt. The planner also has special-cased fast paths for "WorkBuddy diagnostic
requests" that bypass the planner CLI entirely, further blurring the line
between probe and execution.

## Decision

CLI Bridge will split the WorkBuddy connector into two distinct layers:

1. **Diagnostic connector** — internal probe only, never visible in the main
   conversation transcript.
2. **Real executor connector** — the actual WorkBuddy execution worker that
   performs real tasks and whose results MAY enter the main transcript.

### Diagnostic Connector

- Exists solely to verify the inbox/result transport channel works.
- Its output is **never** rendered in the main conversation transcript.
- It can appear in connector/status panels (e.g., "channel: OK").
- It does **not** satisfy the `executorReady` condition.

### Real Executor Connector

- Must return real artifacts, not echo the prompt.
- Its results enter the main conversation transcript as `executor_output`.
- Must satisfy `executorReady` to allow the planner gate to produce
  `auto_execute` decisions.
- Must implement the full worker contract (inbox poll, log, result, heartbeat).

### Entry Conditions for Real Execution Results

A result enters the main transcript ONLY when ALL of:

1. The task was claimed by a real executor (not the diagnostic worker).
2. The result payload contains real content (not a diagnostic echo pattern).
3. The `executorReady` flag is true at the time of result processing.

Results that match the diagnostic echo pattern (`/^diagnostic worker received:/i`)
are permanently excluded from the main transcript, regardless of other conditions.

### UI Boundaries

| Surface | Shows Diagnostic Info | Shows Real Execution Info |
|---------|----------------------|--------------------------|
| Main conversation transcript | ❌ Never | ✅ Real executor_output only |
| Connector status panel | ✅ Channel status only | ✅ Full lifecycle |
| Developer debug logs | ✅ Full detail | ✅ Full detail |

### Security Boundaries

1. **No generic shell endpoint** — WorkBuddy cannot execute arbitrary commands.
   Only task payloads already accepted by planner policy, dispatched by the gate
   evaluator, and enqueued by the execution adapter are processed.

2. **No browser extension execution** — The extension is a UI transport only.
   It cannot spawn processes, access the filesystem, or execute code outside
   the browser sandbox.

3. **Server-owned working directory** — The working directory for execution is
   set by the server, never supplied by the WorkBuddy worker.

4. **Cross-endpoint result injection prevention** — Results are validated against
   task ownership (endpoint ID must match the task's endpoint ID).

## Readiness Model

```
┌──────────────────────────────────────────────────────┐
│                   WorkBuddy Readiness                 │
├──────────────────────┬───────────────────────────────┤
│ diagnosticReady      │ inbox/result channel works    │
│ executorReady        │ real executor registered +    │
│                      │ capability declared           │
│ lastHeartbeatAt      │ last executor heartbeat       │
│ lastTaskClaimedAt    │ last task claim timestamp      │
│ lastResultAt         │ last real result timestamp     │
│ lastFailureReason    │ last failure explanation       │
└──────────────────────┴───────────────────────────────┘
```

Only `executorReady: true` allows:
- The gate evaluator to produce `auto_execute` for WorkBuddy targets.
- The UI to display "executor is ready / responding."
- Real executor output to enter the main transcript.

When `diagnosticReady` is true but `executorReady` is false:
- The UI shows "channel OK, but no real executor connected."
- The planner gate returns `blocked` for execution requests targeting WorkBuddy.
- No fake execution results are generated.

## Real Worker Contract

The real worker MUST implement:

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `GET /bridge/endpoints/:id/inbox/next` | GET | Poll for next pending task |
| `POST /bridge/endpoints/:id/results` | POST | Return real execution result |
| `POST /bridge/endpoints/:id/log` | POST | Append execution log entry |
| `POST /bridge/endpoints/:id/heartbeat` | POST | Periodic heartbeat (optional, recommended) |

### Result payload requirements

```json
{
  "taskId": "uuid",
  "proposalId": "uuid",
  "ok": true,
  "output": { /* structured result — real artifact, not echo */ },
  "stdout": "real stdout content",
  "stderr": "",
  "exitCode": 0,
  "durationMs": 1234
}
```

### Diagnostic result (excluded from main transcript)

```json
{
  "taskId": "uuid",
  "proposalId": "uuid",
  "ok": true,
  "stdout": "diagnostic worker received: some prompt",
  "output": "diagnostic worker received: some prompt",
  "durationMs": 0
}
```

Any result whose `stdout` or `output` matches the pattern
`/^diagnostic worker received:/i` is classified as a diagnostic result and
excluded from the main conversation transcript.

## Migration Path

1. Add `executorReady` flag to the WorkBuddy execution adapter.
2. Add heartbeat endpoint and tracking.
3. Modify the result processing pipeline to check diagnostic vs real.
4. Update the gate evaluator to require `executorReady` (not just
   `diagnosticReady`) for `auto_execute` decisions.
5. Update the conversation transcript to filter diagnostic results.
6. Update the project console UI to show the split readiness state.
7. Keep the diagnostic worker as an optional probe tool, but remove its
   auto-start from the default server configuration.

## Consequences

- **Positive**: Users no longer see fake diagnostic echo as real execution results.
- **Positive**: The readiness model is honest — it distinguishes "channel works"
  from "executor is actually running."
- **Positive**: Security boundary is clear — no new execution surface is added.
- **Neutral**: The diagnostic worker must be explicitly started if operators
  want to probe channel health.
- **Neutral**: The planner fast path for WorkBuddy status queries remains, but
  now produces `blocked` when `executorReady` is false.
