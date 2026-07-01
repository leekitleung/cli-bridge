# Agent Work-Cycle Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a bounded automation loop that lets an agent repeatedly run work cycles until a declared stop condition is met.

**Architecture:** Introduce a generic Automation Loop state machine above existing Goal, Conversation Action, Review Command, and WorkBuddy inbox primitives. The loop advances by explicit ticks: observe current state, decide whether to continue, dispatch one governed action when allowed, record evidence, then re-check stop conditions before the next tick.

**Tech Stack:** TypeScript, Node native test runner, existing local-server bridge API, JSON snapshot persistence, Project Console HTML/JS.

---

## Scope And Pressure Test

### Problem

The current automation can dispatch a single Conversation action and can run some goal orchestration steps, but there is no generic, persistent loop that says:

1. run one agent work cycle;
2. collect the result;
3. decide whether to continue;
4. stop when a configured condition is satisfied.

### Non-Goals

- Do not add a generic shell, run, exec, Git, PR, or workspace mutation endpoint.
- Do not let ChatGPT Web or extension sessions confirm/dispatch loop work.
- Do not create an infinite background worker in this slice.
- Do not bypass existing WorkBuddy pull-based inbox/result protocol.
- Do not make browser/Web relay loops the canonical implementation; Web relay remains a route-specific loop.

### Core Loop

```text
observe -> evaluate stop conditions -> plan next cycle -> dispatch one governed action
        -> wait for result / external return -> record evidence -> repeat
```

Each tick performs at most one dispatch. `run` is only a bounded wrapper around repeated `tick` calls and must stop at `maxTicksPerRun`. If the latest cycle is `dispatching` or `waiting-result`, `tick` must return `{ type: 'waiting' }` and must not dispatch another action.

### Stop Conditions And Inputs

The loop stops before dispatching the next cycle if any condition is true:

- `goal-done`: linked goal is done.
- `goal-cancelled`: linked goal is cancelled.
- `goal-failed`: linked goal is failed.
- `max-cycles`: completed cycle count reached configured max.
- `deadline`: wall-clock deadline reached.
- `no-progress`: progress hash did not change for N consecutive returned cycles.
- `awaiting-gate`: next action needs human approval.
- `awaiting-input`: no next-cycle input is available after a returned cycle.
- `action-failed`: last action failed.
- `endpoint-unavailable`: selected target endpoint is offline or missing.
- `manual-pause`: operator paused the loop.
- `cancelled`: operator cancelled the loop.

Stop inputs come from existing stores and adapters:

| Stop condition | Source of truth | Required test |
|---|---|---|
| `goal-done` / `goal-cancelled` / `goal-failed` | `runtime.goalStore.getGoal(loop.goalId)?.status` | each terminal goal status stops before dispatch |
| `max-cycles` | `AutomationLoopRun.cycleCount >= maxCycles` | no next task is created after max |
| `deadline` | `Date.now() >= loop.deadlineAt` | deadline stops before dispatch |
| `no-progress` | returned cycles only; compare `progressHash` against `lastProgressHash` | waiting/skipped ticks do not increment no-progress |
| `awaiting-gate` | route adapter returns a planned action that cannot be auto-confirmed, or runner observes an unconfirmed action requiring manual gate | no WorkBuddy task is enqueued |
| `awaiting-input` | no `input`, loop `pendingInput`, or returned result `nextInput` exists | tick stops before dispatch |
| `action-failed` | conversation action `failed`, adapter dispatch error, or WorkBuddy result `ok: false` | loop stops and records `failureReason` |
| `endpoint-unavailable` | `endpointRegistry.get(targetEndpointId)` missing, offline, or route adapter unavailable | missing and offline endpoints are tested separately |
| `manual-pause` | loop status is `paused` | tick returns paused without dispatch |
| `cancelled` | loop status is `cancelled` | tick/run return cancelled without dispatch |

### Duplicate Dispatch Defense

Each cycle has a stable idempotency key:

```text
dispatchKey = `${loopId}:${cycleIndex}`
```

Before creating a Conversation action or WorkBuddy task, the runner must check whether a cycle with the same `loopId` and `index` already has `conversationActionId`, `workBuddyTaskId`, or `reviewId`. Retrying the same tick must return the existing cycle state and must not enqueue a duplicate task.

### Execution Notes

- `cycleCount` means completed returned or failed cycles, not merely begun or dispatched cycles.
- `nextCycleIndex` is derived from existing cycles and `dispatchKey` uniqueness.
- `pendingInput` may store next-cycle instruction text, but must never store pairing tokens, auth headers, cookies, or credential material.
- `awaiting-gate` is determined by route adapter capability/readiness, not by a hard-coded endpoint id.
- Full Playwright acceptance is a release gate; normal `npm test` should keep browser E2E optional unless the repository already has a stable browser test harness for that scenario.

### Security Boundary

- `GET /automation-loops` may use existing bridge auth.
- All mutation routes, including create, start, tick, run, pause, resume, cancel, and dispatching loop work, require `console-cookie`.
- Extension session and ChatGPT content scripts may observe or submit returns where already allowed, but cannot start/tick/run/dispatch a loop.
- All loop evidence stores hashes, route ids, action ids, task ids, and status; it must not store raw pairing tokens.

---

## File Structure

- Create `apps/local-server/src/automation/automation-loop-store.ts`
  - Owns loop records, cycle records, stop-condition evaluation inputs, pause/cancel, export/hydrate.
- Create `apps/local-server/src/automation/automation-loop-runner.ts`
  - Executes one `tick()` using existing runtime stores and adapters.
- Modify `apps/local-server/src/routes/bridge-api.ts`
  - Add runtime store, persistence wiring, and `/automation-loops` routes.
- Modify `apps/local-server/src/storage/json-snapshot-store.ts`
  - Persist loop runs and cycles.
- Modify `apps/local-server/src/routes/project-console.ts`
  - Add minimal loop status/control in Project Console.
- Add `tests/automation-loop-store.test.mjs`
  - Store and stop-condition unit tests.
- Add `tests/automation-loop-api.test.mjs`
  - API auth boundary and loop tick/run tests.
- Add `tests/project-console-automation-loop.test.mjs`
  - Console rendering and route allowlist tests.

---

## Data Model

```ts
export type AutomationLoopStatus =
  | 'draft'
  | 'running'
  | 'waiting'
  | 'paused'
  | 'done'
  | 'failed'
  | 'cancelled';

export type AutomationLoopStopReason =
  | 'goal-done'
  | 'goal-cancelled'
  | 'goal-failed'
  | 'max-cycles'
  | 'deadline'
  | 'no-progress'
  | 'awaiting-gate'
  | 'awaiting-input'
  | 'action-failed'
  | 'endpoint-unavailable'
  | 'manual-pause'
  | 'cancelled';

export interface AutomationLoopRun {
  id: string;
  projectId: string;
  goalId?: string;
  pairingId?: string;
  sourceEndpointId: string;
  targetEndpointId: string;
  status: AutomationLoopStatus;
  cycleCount: number;
  maxCycles: number;
  noProgressLimit: number;
  noProgressCount: number;
  lastProgressHash?: string;
  pendingInput?: string;
  deadlineAt: number;
  stopReason?: AutomationLoopStopReason;
  lastError?: string;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  pausedAt?: number;
  doneAt?: number;
  failedAt?: number;
  cancelledAt?: number;
}

export interface AutomationLoopCycle {
  id: string;
  loopId: string;
  index: number;
  dispatchKey: string;
  status: 'planned' | 'dispatching' | 'waiting-result' | 'returned' | 'failed' | 'skipped';
  promptHash: string;
  progressHash?: string;
  resultHash?: string;
  resultStatus?: 'returned' | 'failed' | 'timeout' | 'cancelled';
  nextInputHash?: string;
  dispatchRouteId?: string;
  targetEndpointStatus?: 'online' | 'offline' | 'missing';
  gateReason?: string;
  failureReason?: string;
  conversationActionId?: string;
  workBuddyTaskId?: string;
  reviewId?: string;
  evidenceIds?: string[];
  stopReason?: AutomationLoopStopReason;
  createdAt: number;
  updatedAt: number;
}
```

---

## Task 0: ADR-0028 Loop Boundary

**Files:**
- Create: `docs/planning/ADR-0028-agent-work-cycle-loop.md`

- [ ] **Step 1: Write ADR**

```md
# ADR-0028: Agent Work-Cycle Automation Loop

Status: Proposed

Date: 2026-07-01

## Context

Conversation actions and WorkBuddy inbox dispatch can perform one governed
unit of work, but project automation needs a bounded loop that repeats work
cycles until a declared stop condition is met.

## Decision

Add a persistent Automation Loop state machine. A loop advances by explicit
ticks. Each tick observes state, evaluates stop conditions, dispatches at most
one governed action, records evidence, and stops before the next tick if any
stop condition is met.

## Constraints

- Loop ticking/running requires local Console cookie authority.
- Extension and ChatGPT content scripts cannot tick, run, confirm, or dispatch loops.
- The loop reuses existing Conversation Action, Review Command, and WorkBuddy
  inbox/result primitives.
- No generic shell, run, exec, Git, PR, or workspace mutation endpoint is added.
- Stop conditions are evaluated before every dispatch.
- If the latest cycle is `waiting-result` or `dispatching`, tick returns
  `waiting` and must not dispatch another action.
- Loop mutation routes, including create, require local Console cookie authority.
- Duplicate dispatch is prevented with `dispatchKey = loopId:cycleIndex`.

## Acceptance Conditions

- A loop with `maxCycles: 2` dispatches exactly two cycles and then stops.
- A run cannot dispatch a second cycle before the previous cycle returns.
- Retrying the same tick cannot enqueue a duplicate WorkBuddy task.
- A loop stops on no-progress without creating another task.
- Missing and offline endpoints stop with `endpoint-unavailable`.
- Adapter dispatch failure or returned failed task stops with `action-failed`.
- A cancelled loop cannot tick or run.
- Extension session auth receives 403 on tick/run routes.
```

- [ ] **Step 2: Commit ADR proposal**

```bash
git add docs/planning/ADR-0028-agent-work-cycle-loop.md
git commit -m "docs: propose agent work-cycle loop boundary"
```

Expected: ADR remains `Proposed` until human acceptance.

---

## Task 0.5: Loop State Transition Spec

**Files:**
- Create: `docs/planning/ADR-0028-loop-state-transitions.md`

- [ ] **Step 1: Write the transition spec**

```md
# ADR-0028 Loop State Transition Spec

## Loop Statuses

- `draft`: created but not started.
- `running`: allowed to dispatch if stop conditions are false and no unresolved cycle exists.
- `waiting`: latest cycle is `dispatching` or `waiting-result`; no new dispatch allowed.
- `paused`: operator paused; no dispatch until explicit resume.
- `done`: terminal success.
- `failed`: terminal failure.
- `cancelled`: terminal operator stop.

## Legal Transitions

| From | Event | To |
|---|---|---|
| `draft` | start | `running` |
| `running` | dispatch cycle | `waiting` |
| `waiting` | cycle returned with progress | `running` |
| `waiting` | cycle failed | `failed` |
| `running` | stop condition met | `done` or `failed` |
| `running` | pause | `paused` |
| `paused` | resume | `running` |
| `draft` / `running` / `waiting` / `paused` | cancel | `cancelled` |

## Dispatch Rules

- `tick` may dispatch only from `running`.
- `tick` must return `waiting` when latest cycle is `dispatching` or `waiting-result`.
- `run` must stop when `tick` returns `waiting`.
- A returned cycle is the only event that makes the next cycle dispatchable.
- Returned result payloads may provide `nextInput`. If absent and the caller does
  not provide input on the next tick, the loop stops with `awaiting-input`.
- Retrying a tick for an existing `dispatchKey` returns the existing cycle and does not enqueue a duplicate task.
```

- [ ] **Step 2: Commit spec**

```bash
git add docs/planning/ADR-0028-loop-state-transitions.md
git commit -m "docs: specify automation loop state transitions"
```

Expected: state transition rules are documented before store/runner implementation begins.

---

## Task 1: Loop Store

**Files:**
- Create: `apps/local-server/src/automation/automation-loop-store.ts`
- Test: `tests/automation-loop-store.test.mjs`

- [ ] **Step 1: Write failing store tests**

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { InMemoryAutomationLoopStore } from '../apps/local-server/src/automation/automation-loop-store.ts';

test('automation loop stops at max cycles before another dispatch', () => {
  const store = new InMemoryAutomationLoopStore();
  const loop = store.create({
    projectId: 'cli-bridge',
    sourceEndpointId: 'chatgpt-web',
    targetEndpointId: 'workbuddy',
    maxCycles: 2,
    noProgressLimit: 2,
    deadlineAt: 1793000600000,
    now: 1793000000000,
  });
  const first = store.beginCycle(loop.id, { prompt: 'cycle one', now: 1793000000500 });
  store.markCycleReturned(loop.id, first.id, { progressHash: 'sha256:a', now: 1793000001000 });
  const second = store.beginCycle(loop.id, { prompt: 'cycle two', now: 1793000001500 });
  store.markCycleReturned(loop.id, second.id, { progressHash: 'sha256:b', now: 1793000002000 });
  const stopped = store.evaluateStop(loop.id, { now: 1793000003000 });
  assert.equal(stopped.stop, true);
  assert.equal(stopped.reason, 'max-cycles');
});

test('automation loop stops on repeated no-progress', () => {
  const store = new InMemoryAutomationLoopStore();
  const loop = store.create({
    projectId: 'cli-bridge',
    sourceEndpointId: 'chatgpt-web',
    targetEndpointId: 'workbuddy',
    maxCycles: 5,
    noProgressLimit: 1,
    deadlineAt: 1793000600000,
    now: 1793000000000,
  });
  const first = store.beginCycle(loop.id, { prompt: 'cycle one', now: 1793000000500 });
  store.markCycleReturned(loop.id, first.id, { progressHash: 'sha256:same', now: 1793000001000 });
  const second = store.beginCycle(loop.id, { prompt: 'cycle two', now: 1793000001500 });
  store.markCycleReturned(loop.id, second.id, { progressHash: 'sha256:same', now: 1793000002000 });
  const stopped = store.evaluateStop(loop.id, { now: 1793000003000 });
  assert.equal(stopped.stop, true);
  assert.equal(stopped.reason, 'no-progress');
});

test('store reports unresolved latest cycle as waiting', () => {
  const store = new InMemoryAutomationLoopStore();
  const loop = store.create({
    projectId: 'cli-bridge',
    sourceEndpointId: 'chatgpt-web',
    targetEndpointId: 'workbuddy',
    maxCycles: 3,
    noProgressLimit: 2,
    deadlineAt: 1793000600000,
    now: 1793000000000,
  });
  const cycle = store.beginCycle(loop.id, {
    prompt: 'inspect project',
    now: 1793000001000,
  });
  store.markCycleWaiting(loop.id, cycle.id, {
    conversationActionId: 'act-1',
    workBuddyTaskId: 'task-1',
    now: 1793000002000,
  });
  assert.equal(store.latestUnresolvedCycle(loop.id).id, cycle.id);
});

test('store preserves stop reason and no-progress count after hydrate', () => {
  const store = new InMemoryAutomationLoopStore();
  const loop = store.create({
    projectId: 'cli-bridge',
    sourceEndpointId: 'chatgpt-web',
    targetEndpointId: 'workbuddy',
    maxCycles: 3,
    noProgressLimit: 1,
    deadlineAt: 1793000600000,
    now: 1793000000000,
  });
  const first = store.beginCycle(loop.id, { prompt: 'cycle one', now: 1793000000500 });
  store.markCycleReturned(loop.id, first.id, { progressHash: 'sha256:same', now: 1793000001000 });
  const second = store.beginCycle(loop.id, { prompt: 'cycle two', now: 1793000001500 });
  store.markCycleReturned(loop.id, second.id, { progressHash: 'sha256:same', now: 1793000002000 });
  store.evaluateStop(loop.id, { now: 1793000003000 });
  const exported = store.exportLoops()[0];
  const reloaded = new InMemoryAutomationLoopStore();
  reloaded.hydrateLoop(exported);
  const hydrated = reloaded.get(loop.id);
  assert.equal(hydrated.stopReason, 'no-progress');
  assert.equal(hydrated.noProgressCount, 1);
});
```

- [ ] **Step 2: Run failing tests**

```bash
node --experimental-strip-types --test tests/automation-loop-store.test.mjs
```

Expected: FAIL because `automation-loop-store.ts` does not exist.

- [ ] **Step 3: Implement minimal store**

Implement `create`, `get`, `listByProject`, `start`, `pause`, `resume`, `cancel`, `beginCycle`, `markCycleDispatching`, `markCycleWaiting`, `markCycleReturned`, `markCycleFailed`, `markProgress`, `latestUnresolvedCycle`, `findCycleByDispatchKey`, `evaluateStop`, `exportLoops`, `exportCycles`, `hydrateLoop`, and `hydrateCycle`.

Key behavior:

```ts
evaluateStop(loopId, input) {
  const loop = this.loops.get(loopId);
  if (!loop) return { stop: true, reason: 'cancelled' };
  if (loop.status === 'cancelled') return { stop: true, reason: 'cancelled' };
  if (loop.status === 'paused') return { stop: true, reason: 'manual-pause' };
  if (input.goalStatus === 'done') return this.stop(loop, 'goal-done', input.now);
  if (input.goalStatus === 'cancelled') return this.stop(loop, 'goal-cancelled', input.now);
  if (input.goalStatus === 'failed') return this.fail(loop, 'goal-failed', input.now);
  if (input.endpointStatus === 'missing' || input.endpointStatus === 'offline') return this.fail(loop, 'endpoint-unavailable', input.now);
  if (input.awaitingGate) return this.stop(loop, 'awaiting-gate', input.now);
  if (input.actionFailed) return this.fail(loop, 'action-failed', input.now);
  if (input.now >= loop.deadlineAt) return this.fail(loop, 'deadline', input.now);
  if (loop.cycleCount >= loop.maxCycles) return this.stop(loop, 'max-cycles', input.now);
  if (loop.noProgressCount >= loop.noProgressLimit) return this.stop(loop, 'no-progress', input.now);
  return { stop: false };
}
```

- [ ] **Step 4: Verify store tests**

```bash
node --experimental-strip-types --test tests/automation-loop-store.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/local-server/src/automation/automation-loop-store.ts tests/automation-loop-store.test.mjs
git commit -m "feat: add automation loop store"
```

---

## Task 2: Persistence And Runtime Wiring

**Files:**
- Modify: `apps/local-server/src/routes/bridge-api.ts`
- Modify: `apps/local-server/src/storage/json-snapshot-store.ts`
- Test: `tests/json-persistence.test.mjs`

- [ ] **Step 1: Add failing persistence test**

Add a test that creates a loop, exports the snapshot, creates a second runtime with the same `dataDir`, and asserts the loop survives reload.

```js
test('automation loops persist across runtime reload', async () => {
  await usingTempDir(async (dir) => {
    const first = createBridgeRuntime({ dataDir: dir });
    const loop = first.automationLoopStore.create({
      projectId: 'cli-bridge',
      sourceEndpointId: 'chatgpt-web',
      targetEndpointId: 'workbuddy',
      maxCycles: 2,
      noProgressLimit: 2,
      deadlineAt: 1793000600000,
      now: 1793000000000,
    });
    first.persist();

    const second = createBridgeRuntime({ dataDir: dir });
    assert.equal(second.automationLoopStore.get(loop.id).id, loop.id);
  });
});

test('automation loop snapshot preserves stop metadata and cycle index', async () => {
  await usingTempDir(async (dir) => {
    const first = createBridgeRuntime({ dataDir: dir });
    const loop = first.automationLoopStore.create({
      projectId: 'cli-bridge',
      sourceEndpointId: 'chatgpt-web',
      targetEndpointId: 'workbuddy',
      maxCycles: 1,
      noProgressLimit: 1,
      deadlineAt: 1793000600000,
      now: 1793000000000,
    });
    const cycle = first.automationLoopStore.beginCycle(loop.id, {
      prompt: 'persisted cycle',
      now: 1793000001000,
    });
    first.automationLoopStore.markCycleReturned(loop.id, cycle.id, {
      progressHash: 'sha256:progress',
      resultHash: 'sha256:result',
      now: 1793000002000,
    });
    first.automationLoopStore.evaluateStop(loop.id, { now: 1793000003000 });
    first.persist();

    const second = createBridgeRuntime({ dataDir: dir });
    const hydrated = second.automationLoopStore.get(loop.id);
    const cycles = second.automationLoopStore.listCycles(loop.id);
    assert.equal(hydrated.stopReason, 'max-cycles');
    assert.equal(hydrated.noProgressCount, 0);
    assert.equal(hydrated.lastProgressHash, 'sha256:progress');
    assert.equal(cycles[0].index, 1);
    assert.equal(cycles[0].resultHash, 'sha256:result');
  });
});
```

- [ ] **Step 2: Run failing test**

```bash
node --experimental-strip-types --test tests/json-persistence.test.mjs
```

Expected: FAIL because `automationLoopStore` is not wired into runtime/snapshot.

- [ ] **Step 3: Wire runtime**

Add to `BridgeRuntime`:

```ts
automationLoopStore: InMemoryAutomationLoopStore;
```

Instantiate in `createBridgeRuntime()` and include loops/cycles in `persist()`.

- [ ] **Step 4: Wire snapshot**

Add optional fields to snapshot parsing/building:

```ts
automationLoops?: AutomationLoopRun[];
automationLoopCycles?: AutomationLoopCycle[];
```

Hydrate both arrays when present; default to `[]`.

- [ ] **Step 5: Verify**

```bash
node --experimental-strip-types --test tests/json-persistence.test.mjs
npm run typecheck
```

Expected: PASS and typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add apps/local-server/src/routes/bridge-api.ts apps/local-server/src/storage/json-snapshot-store.ts tests/json-persistence.test.mjs
git commit -m "feat: persist automation loops"
```

---

## Task 3: Loop Runner

**Files:**
- Create: `apps/local-server/src/automation/automation-loop-runner.ts`
- Test: `tests/automation-loop-runner.test.mjs`

- [ ] **Step 1: Write failing runner tests**

```js
test('runner tick dispatches one work cycle and then waits', async () => {
  const runtime = createBridgeRuntime();
  const loop = runtime.automationLoopStore.create({
    projectId: 'cli-bridge',
    sourceEndpointId: 'chatgpt-web',
    targetEndpointId: 'workbuddy',
    maxCycles: 2,
    noProgressLimit: 2,
    deadlineAt: Date.now() + 60_000,
  });
  const result = await tickAutomationLoop(runtime, loop.id, {
    input: 'inspect current project state',
    authKind: 'console-cookie',
  });
  assert.equal(result.type, 'dispatched');
  assert.equal(result.action.status, 'queued');
  const task = runtime.workbuddyExecution.claimNext('workbuddy');
  assert.equal(task.prompt, 'inspect current project state');
});

test('runner tick returns waiting when latest cycle is unresolved', async () => {
  const runtime = createBridgeRuntime();
  const loop = runtime.automationLoopStore.create({
    projectId: 'cli-bridge',
    sourceEndpointId: 'chatgpt-web',
    targetEndpointId: 'workbuddy',
    maxCycles: 2,
    noProgressLimit: 2,
    deadlineAt: Date.now() + 60_000,
  });
  const first = await tickAutomationLoop(runtime, loop.id, {
    input: 'first cycle',
    authKind: 'console-cookie',
  });
  assert.equal(first.type, 'dispatched');
  const second = await tickAutomationLoop(runtime, loop.id, {
    input: 'must not dispatch',
    authKind: 'console-cookie',
  });
  assert.equal(second.type, 'waiting');
  assert.equal(runtime.workbuddyExecution.listPendingTasks('workbuddy').length, 1);
});

test('runner retry does not duplicate dispatch for same cycle index', async () => {
  const runtime = createBridgeRuntime();
  const loop = runtime.automationLoopStore.create({
    projectId: 'cli-bridge',
    sourceEndpointId: 'chatgpt-web',
    targetEndpointId: 'workbuddy',
    maxCycles: 2,
    noProgressLimit: 2,
    deadlineAt: Date.now() + 60_000,
  });
  const first = await tickAutomationLoop(runtime, loop.id, {
    input: 'idempotent cycle',
    authKind: 'console-cookie',
    cycleIndex: 1,
  });
  const retry = await tickAutomationLoop(runtime, loop.id, {
    input: 'idempotent cycle',
    authKind: 'console-cookie',
    cycleIndex: 1,
  });
  assert.equal(first.type, 'dispatched');
  assert.equal(retry.type, 'waiting');
  assert.equal(runtime.workbuddyExecution.listPendingTasks('workbuddy').length, 1);
});

test('runner stops on missing target endpoint', async () => {
  const runtime = createBridgeRuntime();
  const loop = runtime.automationLoopStore.create({
    projectId: 'cli-bridge',
    sourceEndpointId: 'chatgpt-web',
    targetEndpointId: 'missing-executor',
    maxCycles: 1,
    noProgressLimit: 1,
    deadlineAt: Date.now() + 60_000,
  });
  const result = await tickAutomationLoop(runtime, loop.id, {
    input: 'blocked',
    authKind: 'console-cookie',
  });
  assert.equal(result.type, 'stopped');
  assert.equal(result.reason, 'endpoint-unavailable');
});

test('runner stops on offline target endpoint', async () => {
  const runtime = createBridgeRuntime();
  runtime.endpointRegistry.offline('workbuddy');
  const loop = runtime.automationLoopStore.create({
    projectId: 'cli-bridge',
    sourceEndpointId: 'chatgpt-web',
    targetEndpointId: 'workbuddy',
    maxCycles: 1,
    noProgressLimit: 1,
    deadlineAt: Date.now() + 60_000,
  });
  const result = await tickAutomationLoop(runtime, loop.id, {
    input: 'blocked',
    authKind: 'console-cookie',
  });
  assert.equal(result.type, 'stopped');
  assert.equal(result.reason, 'endpoint-unavailable');
});

test('runner stops when adapter dispatch fails', async () => {
  const runtime = createBridgeRuntime();
  runtime.workbuddyExecution.enqueue = () => {
    throw new Error('enqueue failed');
  };
  const loop = runtime.automationLoopStore.create({
    projectId: 'cli-bridge',
    sourceEndpointId: 'chatgpt-web',
    targetEndpointId: 'workbuddy',
    maxCycles: 1,
    noProgressLimit: 1,
    deadlineAt: Date.now() + 60_000,
  });
  const result = await tickAutomationLoop(runtime, loop.id, {
    input: 'adapter failure',
    authKind: 'console-cookie',
  });
  assert.equal(result.type, 'stopped');
  assert.equal(result.reason, 'action-failed');
});

test('runner stops at awaiting gate before dispatch', async () => {
  const runtime = createBridgeRuntime();
  const loop = runtime.automationLoopStore.create({
    projectId: 'cli-bridge',
    sourceEndpointId: 'chatgpt-web',
    targetEndpointId: 'chatgpt-web',
    maxCycles: 1,
    noProgressLimit: 1,
    deadlineAt: Date.now() + 60_000,
  });
  const result = await tickAutomationLoop(runtime, loop.id, {
    input: 'web relay requires gate',
    authKind: 'console-cookie',
  });
  assert.equal(result.type, 'stopped');
  assert.equal(result.reason, 'awaiting-gate');
});

test('runner records returned result and uses nextInput for the next cycle', async () => {
  const runtime = createBridgeRuntime();
  const loop = runtime.automationLoopStore.create({
    projectId: 'cli-bridge',
    sourceEndpointId: 'chatgpt-web',
    targetEndpointId: 'workbuddy',
    maxCycles: 2,
    noProgressLimit: 2,
    deadlineAt: Date.now() + 60_000,
  });
  const first = await tickAutomationLoop(runtime, loop.id, {
    input: 'cycle one',
    authKind: 'console-cookie',
  });
  const task = runtime.workbuddyExecution.claimNext('workbuddy');
  runtime.workbuddyExecution.recordResult(task.taskId, {
    ok: true,
    proposalId: task.proposalId,
    output: { nextInput: 'cycle two' },
    durationMs: 10,
  });
  const recorded = recordAutomationLoopResult(runtime, loop.id, first.cycle.id, {
    workBuddyTaskId: task.taskId,
    now: Date.now(),
  });
  assert.equal(recorded.status, 'returned');
  const second = await tickAutomationLoop(runtime, loop.id, {
    authKind: 'console-cookie',
  });
  assert.equal(second.type, 'dispatched');
  const nextTask = runtime.workbuddyExecution.claimNext('workbuddy');
  assert.equal(nextTask.prompt, 'cycle two');
});

test('runner refuses extension-session authority', async () => {
  const runtime = createBridgeRuntime();
  const loop = runtime.automationLoopStore.create({
    projectId: 'cli-bridge',
    sourceEndpointId: 'chatgpt-web',
    targetEndpointId: 'workbuddy',
    maxCycles: 1,
    noProgressLimit: 1,
    deadlineAt: Date.now() + 60_000,
  });
  const result = await tickAutomationLoop(runtime, loop.id, {
    input: 'should not run',
    authKind: 'extension-session',
  });
  assert.equal(result.type, 'blocked');
  assert.equal(result.reason, 'console-cookie-required');
});
```

- [ ] **Step 2: Run failing tests**

```bash
node --experimental-strip-types --test tests/automation-loop-runner.test.mjs
```

Expected: FAIL because runner does not exist.

- [ ] **Step 3: Implement `tickAutomationLoop()`**

Implementation rules:

- Require `authKind === 'console-cookie'`.
- Load loop; reject paused/cancelled/terminal.
- If `latestUnresolvedCycle(loop.id)` exists, observe whether the linked task/review has returned. If not returned, return `{ type: 'waiting', cycle }`.
- If the linked result returned, call `recordAutomationLoopResult()` before evaluating the next dispatch.
- Compute `dispatchKey = `${loop.id}:${nextCycleIndex}``; if it already exists, return existing cycle state.
- Evaluate stop conditions before dispatch.
- Resolve next input from `tick.input`, then `loop.pendingInput`. If neither exists, stop with `awaiting-input`.
- Read goal status from `runtime.goalStore` when `loop.goalId` is present.
- Read endpoint status from `runtime.endpointRegistry`; missing or offline target stops with `endpoint-unavailable`.
- Resolve target endpoint through `resolveConversationRouteAdapter`.
- If the route is not auto-dispatchable and needs a gate, stop with `awaiting-gate`.
- Create a Conversation message/action with the tick input.
- Confirm and dispatch the action through the adapter.
- If confirm/dispatch fails, mark cycle failed and stop with `action-failed`.
- Create a cycle record linked to the action/task.
- Return `dispatched` with a `waiting-result` cycle; the next tick must return `waiting` until `recordAutomationLoopResult()` marks the cycle returned.

Implement `recordAutomationLoopResult()`:

- find the cycle and linked WorkBuddy task/review result;
- set `resultStatus`, `resultHash`, `progressHash`, and `failureReason`;
- increment no-progress only for returned cycles;
- if result contains `output.nextInput` as a string, store it as `loop.pendingInput`;
- if result failed, stop loop with `action-failed`.

- [ ] **Step 4: Verify**

```bash
node --experimental-strip-types --test tests/automation-loop-runner.test.mjs
npm run typecheck
```

Expected: PASS and typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add apps/local-server/src/automation/automation-loop-runner.ts tests/automation-loop-runner.test.mjs
git commit -m "feat: add automation loop runner"
```

---

## Task 4: Bridge API Routes

**Files:**
- Modify: `apps/local-server/src/routes/bridge-api.ts`
- Test: `tests/automation-loop-api.test.mjs`

- [ ] **Step 1: Write failing API tests**

```js
test('automation loop API run stops at waiting after one unresolved dispatch', async () => {
  const runtime = createBridgeRuntime();
  const created = await call(runtime, 'POST', '/bridge/projects/cli-bridge/automation-loops', {
    sourceEndpointId: 'chatgpt-web',
    targetEndpointId: 'workbuddy',
    maxCycles: 1,
    noProgressLimit: 1,
    deadlineAt: Date.now() + 60_000,
  }, CONSOLE_AUTH);
  const run = await call(runtime, 'POST', `/bridge/projects/cli-bridge/automation-loops/${created.payload.loop.id}/run`, {
    input: 'one cycle only',
    maxTicksPerRun: 3,
  }, CONSOLE_AUTH);
  assert.equal(run.statusCode, 200);
  assert.equal(run.payload.trace[0].type, 'dispatched');
  assert.equal(run.payload.trace[1].type, 'waiting');
  assert.equal(runtime.workbuddyExecution.listPendingTasks('workbuddy').length, 1);
});

test('automation loop API can continue after result return and then stop at max cycles', async () => {
  const runtime = createBridgeRuntime();
  const created = await call(runtime, 'POST', '/bridge/projects/cli-bridge/automation-loops', {
    sourceEndpointId: 'chatgpt-web',
    targetEndpointId: 'workbuddy',
    maxCycles: 2,
    noProgressLimit: 2,
    deadlineAt: Date.now() + 60_000,
  }, CONSOLE_AUTH);
  const firstRun = await call(runtime, 'POST', `/bridge/projects/cli-bridge/automation-loops/${created.payload.loop.id}/run`, {
    input: 'cycle one',
    maxTicksPerRun: 3,
  }, CONSOLE_AUTH);
  const firstTask = runtime.workbuddyExecution.claimNext('workbuddy');
  runtime.workbuddyExecution.recordResult(firstTask.taskId, {
    ok: true,
    proposalId: firstTask.proposalId,
    output: { nextInput: 'cycle two' },
    durationMs: 10,
  });
  const secondRun = await call(runtime, 'POST', `/bridge/projects/cli-bridge/automation-loops/${created.payload.loop.id}/run`, {
    maxTicksPerRun: 3,
  }, CONSOLE_AUTH);
  assert.equal(firstRun.statusCode, 200);
  assert.equal(secondRun.payload.trace[0].type, 'dispatched');
  assert.equal(secondRun.payload.trace.at(-1).reason, 'max-cycles');
});

test('extension session cannot tick automation loops', async () => {
  const runtime = createBridgeRuntime();
  const created = await call(runtime, 'POST', '/bridge/projects/cli-bridge/automation-loops', {
    sourceEndpointId: 'chatgpt-web',
    targetEndpointId: 'workbuddy',
    maxCycles: 1,
    noProgressLimit: 1,
    deadlineAt: Date.now() + 60_000,
  }, CONSOLE_AUTH);
  const tick = await call(runtime, 'POST', `/bridge/projects/cli-bridge/automation-loops/${created.payload.loop.id}/tick`, {
    input: 'blocked',
  }, { kind: 'extension-session' });
  assert.equal(tick.statusCode, 403);
});

test('extension session cannot create automation loops', async () => {
  const runtime = createBridgeRuntime();
  const created = await call(runtime, 'POST', '/bridge/projects/cli-bridge/automation-loops', {
    sourceEndpointId: 'chatgpt-web',
    targetEndpointId: 'workbuddy',
    maxCycles: 1,
    noProgressLimit: 1,
    deadlineAt: Date.now() + 60_000,
  }, { kind: 'extension-session' });
  assert.equal(created.statusCode, 403);
});
```

- [ ] **Step 2: Run failing tests**

```bash
node --experimental-strip-types --test tests/automation-loop-api.test.mjs
```

Expected: FAIL because routes do not exist.

- [ ] **Step 3: Add routes**

Routes:

```text
GET  /bridge/projects/:key/automation-loops
POST /bridge/projects/:key/automation-loops
POST /bridge/projects/:key/automation-loops/:id/tick
POST /bridge/projects/:key/automation-loops/:id/run
POST /bridge/projects/:key/automation-loops/:id/pause
POST /bridge/projects/:key/automation-loops/:id/resume
POST /bridge/projects/:key/automation-loops/:id/cancel
```

Auth:

- `GET` can use existing bridge auth.
- all `POST` routes, including create, require `authContext.kind === 'console-cookie'`.

`run` behavior:

```ts
const maxTicksPerRun = Math.min(body.maxTicksPerRun ?? 1, 10);
let input = typeof body.input === 'string' ? body.input : undefined;
const trace = [];
for (let i = 0; i < maxTicksPerRun; i += 1) {
  const result = await tickAutomationLoop(runtime, loopId, { input, authKind: authContext.kind });
  trace.push(result);
  if (result.type === 'waiting') break;
  if (result.type !== 'dispatched') break;
  input = undefined;
}
return ok({ loop: runtime.automationLoopStore.get(loopId), trace });
```

`run` must not call `tick` again with the same input after a dispatch. Further progress requires the unresolved cycle to return and either provide `nextInput` or receive a fresh input from a later `tick/run` call.

- [ ] **Step 4: Verify**

```bash
node --experimental-strip-types --test tests/automation-loop-api.test.mjs
npm run typecheck
```

Expected: PASS and typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add apps/local-server/src/routes/bridge-api.ts tests/automation-loop-api.test.mjs
git commit -m "feat: expose automation loop API"
```

---

## Task 5: Project Console Controls

**Files:**
- Modify: `apps/local-server/src/routes/project-console.ts`
- Test: `tests/project-console-automation-loop.test.mjs`
- Test: `tests/project-console-ui.test.mjs`

- [ ] **Step 1: Add failing UI tests**

```js
test('console renders automation loop controls without shell routes', () => {
  const html = renderProjectConsoleHtml();
  assert.match(html, /automation-loop/);
  assert.doesNotMatch(html, /\\/bridge\\/shell/);
  assert.doesNotMatch(html, /\\/bridge\\/exec/);
});
```

- [ ] **Step 2: Add controls**

Add a compact loop panel in Conversation mode:

- `Start loop`
- `Run one tick`
- `Pause`
- `Cancel`
- loop status
- cycle count
- stop reason

Control states:

- `Start loop` enabled only for no loop or `draft`.
- `Run one tick` enabled only for `running`; disabled for `waiting`, `paused`, `done`, `failed`, and `cancelled`.
- `Pause` enabled only for `running` or `waiting`.
- `Cancel` enabled for non-terminal loops.
- `Resume` enabled only for `paused`.

Visible copy:

```text
Loop: running · cycles 1/3
Stop: max-cycles
```

Do not add explanatory onboarding text.

- [ ] **Step 3: Add API allowlist entries**

Update existing console path allowlist tests to include:

```text
/bridge/projects/:key/automation-loops
/bridge/projects/:key/automation-loops/:id/tick
/bridge/projects/:key/automation-loops/:id/run
/bridge/projects/:key/automation-loops/:id/pause
/bridge/projects/:key/automation-loops/:id/resume
/bridge/projects/:key/automation-loops/:id/cancel
```

- [ ] **Step 4: Verify**

```bash
node --experimental-strip-types --test tests/project-console-automation-loop.test.mjs tests/project-console-ui.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/local-server/src/routes/project-console.ts tests/project-console-automation-loop.test.mjs tests/project-console-ui.test.mjs
git commit -m "feat: add automation loop console controls"
```

---

## Task 6: Automated Acceptance

**Files:**
- Create: `scripts/automation-loop-acceptance.ts`
- Test: `tests/automation-loop-acceptance.test.mjs`

- [ ] **Step 1: Add acceptance script**

Script checks:

1. start isolated local server;
2. open `/console/project` with Playwright;
3. verify cookie auto-pair;
4. create loop with `maxCycles: 2`;
5. run loop;
6. verify run stops at `waiting` after one unresolved dispatch;
7. retry run and verify no duplicate WorkBuddy task is created;
8. claim WorkBuddy inbox task and return progress with `nextInput`;
9. run the second cycle;
10. verify third cycle is not created after `max-cycles`;
11. verify missing/offline endpoints stop with `endpoint-unavailable`;
12. verify failed WorkBuddy result stops with `action-failed`;
13. verify extension token cannot tick/run;
14. verify no raw token in DOM/localStorage/output/snapshot/API response traces.

- [ ] **Step 2: Add script test**

```js
test('automation loop acceptance script is wired', async () => {
  const source = await readFile(new URL('../scripts/automation-loop-acceptance.ts', import.meta.url), 'utf8');
  assert.match(source, /maxCycles: 2/);
  assert.match(source, /extension token cannot tick\\/run/i);
  assert.doesNotMatch(source, /localStorage\\.setItem\\(['"]cli-bridge-pairing-token/);
});
```

- [ ] **Step 3: Verify acceptance**

```bash
node --experimental-strip-types scripts/automation-loop-acceptance.ts
node --experimental-strip-types --test tests/automation-loop-acceptance.test.mjs
npm test
git diff --check
```

Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add scripts/automation-loop-acceptance.ts tests/automation-loop-acceptance.test.mjs
git commit -m "test: add automation loop acceptance"
```

---

## Final Gate

Run:

```bash
npm run typecheck
npm run lint
npm test
git diff --check
```

Expected:

- typecheck clean
- lint clean
- all tests pass
- no whitespace errors
- no new shell/run/exec endpoints
- extension session cannot tick/run loops
- loops stop on max cycles, no progress, deadline, cancel, failure, and gate
- `run` does not dispatch a new cycle while latest cycle is `waiting-result`
- retrying `tick` for the same loop state does not create a duplicate WorkBuddy task
- missing and offline endpoints stop separately with `endpoint-unavailable`
- adapter dispatch failure and returned failed task stop with `action-failed`
- no-progress increments only on returned cycles
- snapshot hydrate preserves loop status, cycle index, stopReason, noProgressCount, and lastProgressHash
- raw pairing tokens are absent from snapshots, DOM, localStorage, API responses, and acceptance traces

---

## Execution Recommendation

Use subagent-driven execution after ADR-0028 is accepted:

1. Task 0 inline review/planning.
2. Task 0.5 inline state-transition spec.
3. Task 1 and Task 2 sequential execution.
4. Task 3 runner implementation with focused review.
5. Task 4 API implementation with auth review.
6. Task 5 UI controls.
7. Task 6 acceptance automation.

Do not start Task 1 before ADR-0028 is explicitly accepted.
