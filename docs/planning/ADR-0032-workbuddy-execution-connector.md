# ADR-0032: WorkBuddy Execution Connector

Status: Accepted

Date: 2026-07-02

## Context

ADR-0031 introduced policy-gated planner orchestration. The policy gate can
produce `auto_execute` decisions for low-risk structured instructions, but
WorkBuddy is a pull-based executor with no running worker. This causes safe
execution requests to stop at:

```text
planner output → gate request_execution → Executor not started: executor:workbuddy
```

ADR-0003-AMENDMENT and ADR-0024-AMENDMENT already authorized WorkBuddy as a
separately registered execution endpoint with `canExecute: true`, pull-based
inbox/result protocol, and subject to all existing gates. The `WorkBuddyExecutionAdapter`
(`apps/local-server/src/adapters/workbuddy-execution-adapter.ts`) implements the
server-side protocol — enqueue, claimNext, recordResult, recordLog — and the
bridge API already exposes the inbox/result/log endpoints. The endpoint registry
recognizes `transport: 'workbuddy'` with `canExecute: true`.

What is missing is the worker side: a process that polls the inbox, records
progress, and returns raw results. Without it, pull-based execution is
theoretically complete but operationally unreachable.

## Decision

Add a **local WorkBuddy worker process** (`workbuddy-worker.ts`) that:

1. Polls `GET /bridge/endpoints/:id/inbox/next` at a configurable interval.
2. Records structured log entries through `POST /bridge/endpoints/:id/log`.
3. Returns raw execution output through `POST /bridge/endpoints/:id/results`.
4. Is started only by explicit operator config — never by default server startup.
5. Uses the server-owned pairing token in memory when launched by
   `start-local-configured`.

The worker is **not a generic command endpoint**. It processes only task payloads
already accepted by planner policy, dispatched by the gate evaluator, and
enqueued by the execution adapter.

### Worker Tick Model

```
poll inbox → claim pending task → process allowed payload → post raw result → poll again
```

On empty inbox, the worker returns to idle and polls again on the next interval.
This is an operator-controlled pull loop, not a server-side push or automation
loop.

### Task Processing Scope

The initial worker supports only **diagnostic tasks**. It returns `stdout` and
`output` strings based on the prompt it receives. No shell spawn, no filesystem
access, no network calls. This keeps the first slice within the narrow
`auto_execute` boundary defined by ADR-0031:

- Read-only or pure transformation.
- No filesystem mutation.
- No shell or command execution.
- No Git operation.
- No network request.
- No credential, token, cookie, or secret use.

Task kind expansion requires a separate ADR.

## Runtime Flow

```text
Operator starts configured server
  → startLocalServer(port, runtimeOptions)
  → createWorkBuddyWorker({ pairingToken, endpointId, baseUrl })
  → runWorkBuddyWorker(worker, abortSignal)  // starts polling loop

Planner session
  → planner returns PlannerOutputEnvelope (intent: request_execution)
  → gate evaluator → auto_execute
  → instruction packet → task route → WorkBuddyExecutionAdapter.enqueue()

Worker poll
  → GET /bridge/endpoints/workbuddy/inbox/next
  → claim task (status: pending → claimed)
  → POST /bridge/endpoints/workbuddy/log (kind: progress)
  → process task payload
  → POST /bridge/endpoints/workbuddy/results (stdout, output)
  → task status: claimed → returned

Main transcript
  → shows planner visibleText + executor raw result
  → does NOT show queued, dispatch, route, action, workbuddy-execution internals
```

## Security Boundaries

### Transport Layer

- Worker uses the server-owned pairing token (`x-cli-bridge-pairing-token` header).
- Token is held in memory only — never persisted to config files, snapshots,
  environment variables, DOM, localStorage, or logs.
- `start-local-configured` passes the token directly from `LocalServerHandle.pairingToken`.

### Route Surface

- No new `/shell`, `/exec`, `/run`, `/command`, Git mutation, PR, or workspace
  mutation route is added.
- Worker communicates exclusively through the existing inbox/result/log endpoints.
- These endpoints are protected by the standard bridge token + origin gate.

### Authority Boundary

- Worker execution is local operator tooling, not extension-accessible.
- Extension (pairing token / auto-pair session) cannot start the worker, accept
  the gate, reject the gate, or post results.
- Only Console cookie-authenticated requests can accept/reject plans (per ADR-0030).

### Transcript Visibility

- Main conversation transcript may show executor result and high-level status.
- Main transcript must **not** show:
  - `queued`, `workbuddy-execution`, `dispatch`, `route`, `action`
  - Instruction packet IDs, task IDs, endpoint internals
  - Gate decision internals
- WorkBuddy execution lifecycle (task status, worker logs) appears only in the
  WorkBuddy panel on the Console UI.

### Task Payload Validation

- Worker validates task payload structure before processing — rejects
  malformed or missing `taskId` / `proposalId`.
- Worker does not self-confirm proposals, modify bindings, or choose its own
  project root (per ADR-0003-AMENDMENT).
- Failed tasks produce a `failed` status with a failure reason, not silent drops.

## Read Model for Execution Visibility

The existing `GET /bridge/projects/:key/workbuddy` returns task-system records
only (`tasks`, `reviewResultSinks`, `promptDraftSinks`, `executionLedgerEvents`).
This ADR adds two read-model fields:

- `executionTasks`: WorkBuddy execution task lifecycle (taskId, status, endpointId,
  prompt summary, timestamps). Does not include raw prompt content or internal
  instruction packet payload.
- `executionLogs`: structured log entries (logId, taskId, kind, message, timestamp).
  Does not include pairing token, instruction packets, route IDs, action IDs,
  or planner internals.

These are read-only — no mutation through this surface. The Console WorkBuddy
panel renders them without exposing internal route/action/queued text.

## Readiness Model

The worker declares availability through the existing claim-readiness signal.
The `WorkBuddyExecutionAdapter.isReady()` returns `true` when a poll has occurred
within the configured staleness window (default 120s). The gate evaluator checks
this before `auto_execute`:

```ts
// ADR-0031 GateEvaluator
executorAvailability: [{
  endpointId: 'workbuddy',
  status: workbuddyExecution.isReady() ? 'online' : 'offline',
  claimMode: 'pull',
}]
```

A registry entry alone is not enough. The worker must have actively polled.

## Non-Goals

- No generic shell, run, exec, Git, PR, or workspace mutation endpoint.
- No background infinite server-side execution loop — worker is operator-started
  and operator-stopped.
- No external WorkBuddy desktop/app integration in this ADR — that is a separate
  ADR.
- No parallel executor routing or fallback executor routing.
- No task kind expansion beyond diagnostic — requires a separate ADR.
- No worker auto-start on default server startup — `npm run start:local-server`
  does not start a worker.
- No push-based execution — WorkBuddy remains pull-based.

## Consequences

### Positive

- The planner gate → executor closed loop is operationally complete.
- Operator can see whether WorkBuddy is online, whether it claimed work, and
  the raw result it returned.
- Security boundary is explicit and auditable: no new routes, token in memory
  only, worker scope bounded to diagnostic tasks.
- Existing tests for bridge API, WorkBuddy state, and planner gate are preserved.

### Negative

- Operator must explicitly enable and start the worker — adds a setup step
  for local testing.
- Worker process lifecycle is tied to the server process — restarting the
  server restarts the worker.
- Polling model adds latency (pollIntervalMs) between task enqueue and claim.

### Risks

- If the worker process crashes, the operator must restart the configured server.
  Mitigation: worker errors are logged but do not crash the server.
- If the in-memory token is leaked through a stack trace or error message, it
  could expose the bridge to unauthorized access. Mitigation: error messages
  never include the token; token redaction is applied in log paths.

## Acceptance Conditions

- [ ] ADR is accepted by operator before any implementation begins.
- [ ] A running configured worker makes `workbuddy` executor online (isReady).
- [ ] Safe planner output with `riskHints: ["pure-transform"]` creates exactly
  one WorkBuddy execution task.
- [ ] Worker claims the task (status: pending → claimed) and posts one raw result
  (status: claimed → returned).
- [ ] Console main transcript shows only user/planner/executor-facing content —
  no `queued`, `dispatch`, `route`, `action`, `workbuddy-execution`.
- [ ] WorkBuddy panel shows task lifecycle and worker logs.
- [ ] Extension auth cannot force worker start, accept gate, reject gate, or
  post results.
- [ ] Pairing token is absent from snapshot, DOM, localStorage, config files,
  API responses, and test logs.
- [ ] No new generic execution route exists.
- [ ] `npm run start:local-server` (default) does not start a worker.
- [ ] `npm run start:local-server:configured` with `workbuddyWorker.enabled: true`
  starts a worker.

## Implementation Plan

The full implementation is specified in
`docs/superpowers/plans/2026-07-02-workbuddy-execution-connector.md`. Key tasks:

| Task | Description | Files |
|------|-------------|-------|
| ADR-0032 | This document | `docs/planning/ADR-0032-workbuddy-execution-connector.md` |
| Worker Core | `workbuddy-worker.ts` + tests | `apps/local-server/src/workbuddy/workbuddy-worker.ts`, `tests/workbuddy-worker.test.mjs` |
| Configured Startup | `start-local-configured` integration | `scripts/start-local-configured.ts`, `scripts/local-config.example.json` |
| Read Model | API read methods + contract | `workbuddy-execution-adapter.ts`, `bridge-api.ts`, contract docs |
| Console UI | WorkBuddy panel execution lifecycle | `project-console.ts`, `project-console-behavior.test.mjs` |
| E2E Acceptance | Planner gate → worker → result | `tests/policy-gated-conversation-api.test.mjs`, `scripts/workbuddy-connector-acceptance.ts` |

Implementation enters EX batch only after ADR acceptance.

## References

- ADR-0003-AMENDMENT: WorkBuddy Execution Authorization
- ADR-0024-AMENDMENT: WorkBuddy Execution Endpoint Authorization
- ADR-0029: Passthrough Route Plane
- ADR-0030: Planner-Gated Execution Flow
- ADR-0031: Policy-Gated Planner Orchestration
- `apps/local-server/src/adapters/workbuddy-execution-adapter.ts` — existing server-side protocol
- `docs/superpowers/plans/2026-07-02-workbuddy-execution-connector.md` — full implementation plan

---

This ADR requires explicit human acceptance before execution implementation.
