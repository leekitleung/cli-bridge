# WorkBuddy Execution Connector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make WorkBuddy visibly receive, process, and return execution results after the planner gate chooses `auto_execute`.

**Architecture:** Keep CLI Bridge as the control plane and passthrough relay. Add a bounded local WorkBuddy worker that polls the existing inbox/result protocol, reports heartbeat/log/status, and returns raw output. Do not add generic `/shell`, `/exec`, `/run`, Git mutation, PR, or workspace mutation endpoints.

**Tech Stack:** Node.js TypeScript with `--experimental-strip-types`, Node native test runner, existing local-server route/store patterns, existing `start-local-configured` launcher.

---

## Scope

This plan fixes the current blocker:

```text
planner output → gate request_execution → Executor not started: executor:workbuddy
```

Root cause: WorkBuddy is modeled as a pull-based executor, but no WorkBuddy worker is running. The existing server already has:

- `GET /bridge/endpoints/:id/inbox/next`
- `POST /bridge/endpoints/:id/results`
- `POST /bridge/endpoints/:id/log`
- `POST /bridge/endpoints/:id/heartbeat`
- `/bridge/projects/:key/workbuddy` non-executing dashboard state

The missing piece is a real worker loop plus operator-facing visibility.

## Non-Goals

- No ChatGPT Web automation changes.
- No planner behavior changes except test fixtures.
- No generic command endpoint.
- No background infinite server-side execution loop.
- No external WorkBuddy desktop/app integration in the first slice. The first slice creates an in-repo local WorkBuddy worker and visible WorkBuddy execution state.

## File Map

- Create `apps/local-server/src/workbuddy/workbuddy-worker.ts`
  - Polls inbox, records logs, processes allowed task kinds, posts results.
- Modify `apps/local-server/src/adapters/workbuddy-execution-adapter.ts`
  - Add read-model methods for execution tasks/logs; preserve `claimNext()` as the readiness signal because it already records every inbox poll, including empty polls.
- Modify `apps/local-server/src/routes/bridge-api.ts`
  - Return WorkBuddy execution task/result/log status through a read-only status surface.
- Modify `apps/local-server/src/routes/project-console.ts`
  - Show execution lifecycle in the WorkBuddy/task area without leaking route/action/internal packet text into main transcript.
- Modify `scripts/start-local-configured.ts`
  - Optional config-driven worker startup using the in-memory pairing token from `LocalServerHandle`.
- Modify `scripts/local-config.example.json`
  - Document `workbuddyWorker.enabled`.
- Create `tests/workbuddy-worker.test.mjs`
  - Unit tests for worker poll/process/result behavior.
- Modify `tests/policy-gated-conversation-api.test.mjs`
  - Integration coverage for planner gate → worker online → task created.
- Create `tests/helpers/static-planner-adapter.mjs`
  - Shared static planner adapter used by policy-gated integration and acceptance scripts.
- Modify `tests/project-console-behavior.test.mjs`
  - UI coverage for WorkBuddy status visibility.
- Create `scripts/workbuddy-connector-acceptance.ts`
  - End-to-end acceptance: configured server + worker + planner request + raw result.
- Create `docs/planning/ADR-0032-workbuddy-execution-connector.md`
  - Boundary record for local worker execution semantics.

---

## Task 0: ADR-0032 Boundary

**Files:**
- Create: `docs/planning/ADR-0032-workbuddy-execution-connector.md`

- [ ] **Step 1: Write ADR**

Create `docs/planning/ADR-0032-workbuddy-execution-connector.md`:

```markdown
# ADR-0032: WorkBuddy Execution Connector

Status: Proposed

## Context

ADR-0031 introduced policy-gated planner orchestration. The gate can select
`auto_execute`, but WorkBuddy is pull-based and currently has no worker. This
causes safe execution requests to stop at `Executor not started:
executor:workbuddy`.

## Decision

Add a local WorkBuddy worker process that:

1. polls `GET /bridge/endpoints/workbuddy/inbox/next`;
2. records progress through `POST /bridge/endpoints/workbuddy/log`;
3. returns raw execution output through `POST /bridge/endpoints/workbuddy/results`;
4. is started only by explicit operator config;
5. uses the server-owned pairing token in memory when launched by
   `start-local-configured`.

The worker is not a generic command endpoint. It can only process task payloads
already accepted by planner policy and dispatched by CLI Bridge.

## Security Boundaries

- No new `/shell`, `/exec`, `/run`, `/command`, Git mutation, PR, or workspace
  mutation route.
- Worker execution is local operator tooling, not extension-accessible.
- Pairing token is passed in memory or environment only; never persisted to
  config, snapshots, DOM, localStorage, or logs.
- Main conversation transcript may show executor result and high-level status,
  but must not show route/action/dispatch/queued internals.
- Default server startup does not enable the worker.

## Consequences

Users can see whether WorkBuddy is online, whether it claimed work, and the raw
result it returned. External WorkBuddy app integration remains a later ADR.
```

- [ ] **Step 2: Commit ADR proposal**

Run:

```bash
git add docs/planning/ADR-0032-workbuddy-execution-connector.md
git commit -m "docs: propose workbuddy execution connector boundary"
```

Expected: one docs commit.

- [ ] **Step 3: Review gate**

Stop after this commit. Implementation starts only after explicit ADR acceptance.

---

## Task 1: Worker Core

**Files:**
- Create: `apps/local-server/src/workbuddy/workbuddy-worker.ts`
- Create: `tests/workbuddy-worker.test.mjs`

- [ ] **Step 1: Write failing worker tests**

Create `tests/workbuddy-worker.test.mjs`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createWorkBuddyWorker,
  onceWorkBuddyWorker,
} from '../apps/local-server/src/workbuddy/workbuddy-worker.ts';

test('worker reports idle when inbox has no task', async () => {
  const calls = [];
  const worker = createWorkBuddyWorker({
    endpointId: 'workbuddy',
    baseUrl: 'http://127.0.0.1:31337',
    pairingToken: 'secret',
    fetchFn: async (url, init) => {
      calls.push({ url: String(url), init });
      return jsonResponse(200, { task: null, message: 'No pending tasks' });
    },
  });

  const result = await onceWorkBuddyWorker(worker);

  assert.equal(result.type, 'idle');
  assert.match(calls[0].url, /\/bridge\/endpoints\/workbuddy\/inbox\/next$/);
  assert.equal(calls[0].init.headers['x-cli-bridge-pairing-token'], 'secret');
});

test('worker posts raw result for a claimed diagnostic task', async () => {
  const posted = [];
  const worker = createWorkBuddyWorker({
    endpointId: 'workbuddy',
    baseUrl: 'http://127.0.0.1:31337',
    pairingToken: 'secret',
    fetchFn: async (url, init) => {
      const path = new URL(String(url)).pathname;
      if (path.endsWith('/inbox/next')) {
        return jsonResponse(200, {
          task: {
            taskId: 'task-1',
            endpointId: 'workbuddy',
            proposalId: 'proposal-1',
            planId: 'plan-1',
            goalId: 'goal-1',
            bindingHash: 'hash-1',
            prompt: 'diagnostic: ping',
            workingDirectory: '/tmp',
            timeoutMs: 120000,
            createdAt: 1,
            status: 'claimed',
          },
        });
      }
      posted.push({ path, body: JSON.parse(init.body) });
      return jsonResponse(200, { ok: true });
    },
  });

  const result = await onceWorkBuddyWorker(worker);

  assert.equal(result.type, 'returned');
  assert.equal(posted.at(-1).path, '/bridge/endpoints/workbuddy/results');
  assert.equal(posted.at(-1).body.taskId, 'task-1');
  assert.equal(posted.at(-1).body.ok, true);
  assert.match(posted.at(-1).body.stdout, /diagnostic worker received/);
});

function jsonResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(payload),
    json: async () => payload,
  };
}
```

- [ ] **Step 2: Verify tests fail**

Run:

```bash
node --experimental-strip-types --test tests/workbuddy-worker.test.mjs
```

Expected: fail because `workbuddy-worker.ts` does not exist.

- [ ] **Step 3: Implement worker core**

Create `apps/local-server/src/workbuddy/workbuddy-worker.ts`:

```ts
import { setTimeout as delay } from 'node:timers/promises';

export interface WorkerFetchResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

export type WorkerFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<WorkerFetchResponse>;

export interface WorkBuddyWorkerOptions {
  endpointId: string;
  baseUrl: string;
  pairingToken: string;
  pollIntervalMs?: number;
  fetchFn?: WorkerFetch;
}

export type WorkBuddyWorkerTickResult =
  | { type: 'idle' }
  | { type: 'returned'; taskId: string }
  | { type: 'failed'; taskId?: string; reason: string };

export interface WorkBuddyWorker {
  endpointId: string;
  baseUrl: string;
  pairingToken: string;
  pollIntervalMs: number;
  fetchFn: WorkerFetch;
}

const TOKEN_HEADER = 'x-cli-bridge-pairing-token';

export function createWorkBuddyWorker(options: WorkBuddyWorkerOptions): WorkBuddyWorker {
  return {
    endpointId: options.endpointId,
    baseUrl: options.baseUrl.replace(/\/$/, ''),
    pairingToken: options.pairingToken,
    pollIntervalMs: options.pollIntervalMs ?? 1_000,
    fetchFn: options.fetchFn ?? (fetch as unknown as WorkerFetch),
  };
}

export async function onceWorkBuddyWorker(worker: WorkBuddyWorker): Promise<WorkBuddyWorkerTickResult> {
  const inbox = await requestJson(worker, `/bridge/endpoints/${encodeURIComponent(worker.endpointId)}/inbox/next`, 'GET');
  if (!inbox.ok) return { type: 'failed', reason: `inbox ${inbox.status}` };
  const task = (inbox.payload as { task?: unknown }).task;
  if (!task || typeof task !== 'object') return { type: 'idle' };

  const taskRecord = task as { taskId?: unknown; proposalId?: unknown; prompt?: unknown };
  if (typeof taskRecord.taskId !== 'string' || typeof taskRecord.proposalId !== 'string') {
    return { type: 'failed', reason: 'invalid task payload' };
  }

  const stdout = `diagnostic worker received: ${typeof taskRecord.prompt === 'string' ? taskRecord.prompt : ''}`;
  const result = await requestJson(worker, `/bridge/endpoints/${encodeURIComponent(worker.endpointId)}/results`, 'POST', {
    taskId: taskRecord.taskId,
    proposalId: taskRecord.proposalId,
    ok: true,
    stdout,
    output: stdout,
    durationMs: 0,
  });

  if (!result.ok) return { type: 'failed', taskId: taskRecord.taskId, reason: `results ${result.status}` };
  return { type: 'returned', taskId: taskRecord.taskId };
}

export async function runWorkBuddyWorker(worker: WorkBuddyWorker, signal?: AbortSignal): Promise<void> {
  while (!signal?.aborted) {
    await onceWorkBuddyWorker(worker);
    await delay(worker.pollIntervalMs, undefined, { signal }).catch(() => undefined);
  }
}

async function requestJson(
  worker: WorkBuddyWorker,
  path: string,
  method: 'GET' | 'POST',
  body?: unknown,
): Promise<{ ok: boolean; status: number; payload: unknown }> {
  const response = await worker.fetchFn(`${worker.baseUrl}${path}`, {
    method,
    headers: {
      [TOKEN_HEADER]: worker.pairingToken,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const raw = await response.text();
  let payload: unknown = {};
  if (raw.length > 0) {
    try { payload = JSON.parse(raw); } catch { payload = { raw }; }
  }
  return { ok: response.ok, status: response.status, payload };
}
```

- [ ] **Step 4: Verify worker tests pass**

Run:

```bash
node --experimental-strip-types --test tests/workbuddy-worker.test.mjs
```

Expected: 2/2 pass.

- [ ] **Step 5: Commit**

Run:

```bash
git add apps/local-server/src/workbuddy/workbuddy-worker.ts tests/workbuddy-worker.test.mjs
git commit -m "feat: add local workbuddy worker core"
```

---

## Task 2: Configured Worker Startup

**Files:**
- Modify: `scripts/start-local-configured.ts`
- Modify: `scripts/local-config.example.json`
- Test: existing `tests/start-local-configured.test.mjs`

- [ ] **Step 1: Add failing launcher tests**

Add tests to `tests/start-local-configured.test.mjs`:

```js
test('parseConfig accepts disabled workbuddy worker config', () => {
  const config = parseConfig(JSON.stringify({
    workbuddyWorker: { enabled: false, endpointId: 'workbuddy', pollIntervalMs: 250 },
  }));
  assert.equal(config.workbuddyWorker.enabled, false);
  assert.equal(config.workbuddyWorker.endpointId, 'workbuddy');
});

test('parseConfig rejects invalid workbuddy worker config', () => {
  assert.throws(
    () => parseConfig(JSON.stringify({ workbuddyWorker: { enabled: true, pollIntervalMs: -1 } })),
    /workbuddyWorker.pollIntervalMs/,
  );
});
```

- [ ] **Step 2: Verify tests fail**

Run:

```bash
node --experimental-strip-types --test tests/start-local-configured.test.mjs
```

Expected: fail because `workbuddyWorker` is not typed/validated.

- [ ] **Step 3: Implement config type and validation**

Modify `scripts/start-local-configured.ts`:

```ts
import {
  createWorkBuddyWorker,
  runWorkBuddyWorker,
} from '../apps/local-server/src/workbuddy/workbuddy-worker.ts';

export interface LocalConfig {
  // existing fields...
  workbuddyWorker?: {
    enabled: boolean;
    endpointId?: string;
    pollIntervalMs?: number;
  };
}
```

In `parseConfig()` add:

```ts
if (config.workbuddyWorker !== undefined) {
  if (typeof config.workbuddyWorker !== 'object' || config.workbuddyWorker === null || Array.isArray(config.workbuddyWorker)) {
    throw new Error('config.workbuddyWorker must be an object when present.');
  }
  if (typeof config.workbuddyWorker.enabled !== 'boolean') {
    throw new Error('config.workbuddyWorker.enabled must be boolean.');
  }
  if (config.workbuddyWorker.endpointId !== undefined && typeof config.workbuddyWorker.endpointId !== 'string') {
    throw new Error('config.workbuddyWorker.endpointId must be string when present.');
  }
  if (
    config.workbuddyWorker.pollIntervalMs !== undefined
    && (!Number.isInteger(config.workbuddyWorker.pollIntervalMs) || config.workbuddyWorker.pollIntervalMs <= 0)
  ) {
    throw new Error('config.workbuddyWorker.pollIntervalMs must be a positive integer when present.');
  }
}
```

Add startup helper:

```ts
export function startConfiguredWorkBuddyWorker(
  handle: Pick<LocalServerHandle, 'url' | 'pairingToken'>,
  config: LocalConfig,
): AbortController | undefined {
  if (!config.workbuddyWorker?.enabled) return undefined;
  const controller = new AbortController();
  const worker = createWorkBuddyWorker({
    endpointId: config.workbuddyWorker.endpointId ?? 'workbuddy',
    baseUrl: handle.url,
    pairingToken: handle.pairingToken,
    pollIntervalMs: config.workbuddyWorker.pollIntervalMs,
  });
  void runWorkBuddyWorker(worker, controller.signal).catch((err: unknown) => {
    console.error(`WorkBuddy worker stopped: ${err instanceof Error ? err.message : String(err)}`);
  });
  return controller;
}
```

In `main()` after `bootstrapStartedServer(...)`:

```ts
const workbuddyWorkerController = startConfiguredWorkBuddyWorker(handle, config);
installShutdownHandlers(handle);
if (workbuddyWorkerController) {
  process.once('SIGINT', () => workbuddyWorkerController.abort());
  process.once('SIGTERM', () => workbuddyWorkerController.abort());
}
```

- [ ] **Step 4: Update example config**

Add to `scripts/local-config.example.json`:

```json
{
  "workbuddyWorker": {
    "enabled": false,
    "endpointId": "workbuddy",
    "pollIntervalMs": 1000
  }
}
```

Keep valid JSON shape; merge this object into the existing example instead of replacing it.

- [ ] **Step 5: Verify launcher tests**

Run:

```bash
node --experimental-strip-types --test tests/start-local-configured.test.mjs
```

Expected: pass.

- [ ] **Step 6: Commit**

Run:

```bash
git add scripts/start-local-configured.ts scripts/local-config.example.json tests/start-local-configured.test.mjs
git commit -m "feat: start workbuddy worker from local config"
```

---

## Task 3: Server Read Model for Execution Visibility

**Files:**
- Modify: `apps/local-server/src/adapters/workbuddy-execution-adapter.ts`
- Modify: `apps/local-server/src/routes/bridge-api.ts`
- Modify: `docs/contracts/bridge-workbuddy-api.md`
- Test: `tests/bridge-workbuddy-api.test.mjs`

- [ ] **Step 1: Add failing API test**

Add to `tests/bridge-workbuddy-api.test.mjs`:

```js
test('GET workbuddy includes execution tasks and logs read model', async () => {
  const runtime = createBridgeRuntime();
  const task = runtime.workbuddyExecution.enqueue({
    endpointId: 'workbuddy',
    proposalId: 'proposal-1',
    planId: 'plan-1',
    goalId: 'goal-1',
    bindingHash: 'hash-1',
    prompt: 'diagnostic',
    workingDirectory: '/tmp',
  });
  runtime.workbuddyExecution.recordLog({
    taskId: task.taskId,
    endpointId: 'workbuddy',
    kind: 'progress',
    message: 'claimed',
  });

  const res = await handleBridgeRequest(
    runtime,
    'GET',
    '/bridge/projects/cli-bridge/workbuddy',
    jsonBody(undefined),
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.executionTasks.length, 1);
  assert.equal(res.payload.executionTasks[0].taskId, task.taskId);
  assert.equal(res.payload.executionLogs.length, 1);
  assert.equal(res.payload.executionLogs[0].message, 'claimed');
  assert.doesNotMatch(JSON.stringify(res.payload), /x-cli-bridge-pairing-token/);
});
```

- [ ] **Step 2: Verify test fails**

Run:

```bash
node --experimental-strip-types --test tests/bridge-workbuddy-api.test.mjs
```

Expected: fail because `executionTasks`/`executionLogs` are absent.

- [ ] **Step 3: Add read methods**

Modify `WorkBuddyExecutionAdapter`:

```ts
listTasks(endpointId?: string): WorkBuddyExecutionTask[] {
  return Array.from(this.tasks.values())
    .filter(t => endpointId === undefined || t.endpointId === endpointId)
    .map(clone);
}

listLogs(endpointId?: string): WorkBuddyExecutionLogEntry[] {
  return this.logs
    .filter(l => endpointId === undefined || l.endpointId === endpointId)
    .map(clone);
}
```

- [ ] **Step 4: Return execution read model**

In GET `/bridge/projects/:key/workbuddy`, add:

```ts
executionTasks: runtime.workbuddyExecution.listTasks('workbuddy'),
executionLogs: runtime.workbuddyExecution.listLogs('workbuddy'),
```

Do not include pairing token, instruction packets, route IDs, action IDs, or planner internals.

- [ ] **Step 5: Update contract docs**

Update `docs/contracts/bridge-workbuddy-api.md` response example:

```json
{
  "projectId": "my-project",
  "tasks": [],
  "reviewResultSinks": [],
  "promptDraftSinks": [],
  "executionLedgerEvents": [],
  "executionTasks": [],
  "executionLogs": []
}
```

- [ ] **Step 6: Verify**

Run:

```bash
node --experimental-strip-types --test tests/bridge-workbuddy-api.test.mjs
npm run typecheck
```

Expected: pass.

- [ ] **Step 7: Commit**

Run:

```bash
git add apps/local-server/src/adapters/workbuddy-execution-adapter.ts apps/local-server/src/routes/bridge-api.ts docs/contracts/bridge-workbuddy-api.md tests/bridge-workbuddy-api.test.mjs
git commit -m "feat: expose workbuddy execution read model"
```

---

## Task 4: Console WorkBuddy Visibility

**Files:**
- Modify: `apps/local-server/src/routes/project-console.ts`
- Test: `tests/project-console-behavior.test.mjs`

- [ ] **Step 1: Add failing UI test**

Add to `tests/project-console-behavior.test.mjs`:

```js
test('WorkBuddy panel renders execution task lifecycle without internal route text', async () => {
  const { window, document } = setupConsole();
  window.store.workbuddy = {
    projectId: 'cli-bridge',
    tasks: [],
    reviewResultSinks: [],
    promptDraftSinks: [],
    executionLedgerEvents: [],
    executionTasks: [{
      taskId: 'task-1',
      endpointId: 'workbuddy',
      proposalId: 'proposal-1',
      planId: 'plan-1',
      goalId: 'goal-1',
      bindingHash: 'hash-1',
      prompt: 'diagnostic',
      workingDirectory: '/repo',
      timeoutMs: 120000,
      createdAt: 1,
      status: 'claimed',
      claimedAt: 2,
    }],
    executionLogs: [{
      logId: 'log-1',
      taskId: 'task-1',
      endpointId: 'workbuddy',
      kind: 'progress',
      message: 'worker claimed task',
      timestamp: 3,
    }],
  };

  window.renderWorkBuddy();

  const text = document.getElementById('workbuddy-view').textContent;
  assert.match(text, /claimed/);
  assert.match(text, /worker claimed task/);
  assert.doesNotMatch(text, /workbuddy-execution|dispatch|route|action/);
});
```

- [ ] **Step 2: Verify test fails**

Run:

```bash
node --experimental-strip-types --test tests/project-console-behavior.test.mjs
```

Expected: fail because execution tasks/logs are not rendered.

- [ ] **Step 3: Render WorkBuddy execution state**

Modify WorkBuddy rendering in `project-console.ts` to include:

```js
const executionTasks = Array.isArray(data.executionTasks) ? data.executionTasks : [];
const executionLogs = Array.isArray(data.executionLogs) ? data.executionLogs : [];
const executionHtml = executionTasks.length === 0
  ? '<div class="empty-state">No executor work yet.</div>'
  : executionTasks.map(task => {
      const logs = executionLogs.filter(log => log.taskId === task.taskId);
      return '<div class="workbuddy-task">'
        + '<div class="workbuddy-task-title">' + escapeHtml(task.status || 'unknown') + '</div>'
        + '<div class="workbuddy-task-meta">' + escapeHtml(task.endpointId || 'workbuddy') + '</div>'
        + logs.map(log => '<div class="workbuddy-log">' + escapeHtml(log.message || '') + '</div>').join('')
        + '</div>';
    }).join('');
```

Place this in the WorkBuddy panel only, not in the main transcript.

- [ ] **Step 4: Verify UI**

Run:

```bash
node --experimental-strip-types --test tests/project-console-behavior.test.mjs
```

Expected: pass.

- [ ] **Step 5: Commit**

Run:

```bash
git add apps/local-server/src/routes/project-console.ts tests/project-console-behavior.test.mjs
git commit -m "feat: show workbuddy execution lifecycle"
```

---

## Task 5: Planner Gate End-to-End with Worker Online

**Files:**
- Modify: `tests/policy-gated-conversation-api.test.mjs`
- Create: `scripts/workbuddy-connector-acceptance.ts`

- [ ] **Step 1: Add integration test for online worker**

Add to `tests/policy-gated-conversation-api.test.mjs`:

```js
test('safe planner execution creates workbuddy task when worker has polled', async () => {
  const runtime = createBridgeRuntime({
    plannerAdapters: [createStaticPlannerAdapter({
      intent: 'request_execution',
      visibleText: 'Ready to run a diagnostic task.',
      proposedInstruction: {
        summary: 'diagnostic',
        payload: 'diagnostic: ping',
        targetExecutorIds: ['workbuddy'],
        riskHints: ['pure-transform'],
      },
    })],
  });

  runtime.workbuddyExecution.claimNext('workbuddy');

  const res = await postConversationMessage(runtime, 'run diagnostic');

  assert.equal(res.statusCode, 201);
  assert.equal(res.payload.gate.type, 'auto_execute');
  const tasks = runtime.workbuddyExecution.exportTasks().filter(t => t.proposalId !== 'stub');
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].endpointId, 'workbuddy');
});
```

- [ ] **Step 2: Verify test passes or fails for the right reason**

Run:

```bash
node --experimental-strip-types --test tests/policy-gated-conversation-api.test.mjs
```

Expected: pass if readiness is already based on polling; otherwise fail with blocked executor.

- [ ] **Step 3: Add acceptance script**

Create `tests/helpers/static-planner-adapter.mjs`:

```js
export function createStaticPlannerAdapter(output) {
  return {
    id: output.id ?? 'static-test-planner',
    label: 'Static Test Planner',
    async plan() {
      return {
        id: output.id ?? 'planner-output-static',
        visibleText: output.visibleText,
        intent: output.intent,
        proposedInstruction: output.proposedInstruction,
        requiredInputs: output.requiredInputs ?? [],
      };
    },
  };
}
```

Create `scripts/workbuddy-connector-acceptance.ts`:

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { startLocalServer } from '../apps/local-server/src/server.ts';
import { createWorkBuddyWorker, onceWorkBuddyWorker } from '../apps/local-server/src/workbuddy/workbuddy-worker.ts';
import { createStaticPlannerAdapter } from '../tests/helpers/static-planner-adapter.mjs';

test('WorkBuddy connector acceptance: planner gate to worker result', async () => {
  const handle = await startLocalServer(0, {
    plannerAdapters: [createStaticPlannerAdapter({
      intent: 'request_execution',
      visibleText: 'Ready to run diagnostic.',
      proposedInstruction: {
        summary: 'diagnostic',
        payload: 'diagnostic: ping',
        targetExecutorIds: ['workbuddy'],
        riskHints: ['pure-transform'],
      },
    })],
  });

  try {
    const worker = createWorkBuddyWorker({
      endpointId: 'workbuddy',
      baseUrl: handle.url,
      pairingToken: handle.pairingToken,
    });

    await onceWorkBuddyWorker(worker);

    const send = await fetch(`${handle.url}/bridge/projects/cli-bridge/conversation/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-cli-bridge-pairing-token': handle.pairingToken,
      },
      body: JSON.stringify({ text: 'run diagnostic' }),
    });
    assert.equal(send.status, 201);

    const workerResult = await onceWorkBuddyWorker(worker);
    assert.equal(workerResult.type, 'returned');

    const read = await fetch(`${handle.url}/bridge/projects/cli-bridge/conversation/messages`, {
      headers: { 'x-cli-bridge-pairing-token': handle.pairingToken },
    });
    const payload = await read.json();
    assert.match(JSON.stringify(payload), /diagnostic worker received/);
  } finally {
    await new Promise(resolve => handle.server.close(resolve));
  }
});
```

- [ ] **Step 4: Run acceptance**

Run:

```bash
node --experimental-strip-types scripts/workbuddy-connector-acceptance.ts
```

Expected: pass and print TAP success.

- [ ] **Step 5: Commit**

Run:

```bash
git add tests/policy-gated-conversation-api.test.mjs scripts/workbuddy-connector-acceptance.ts tests/helpers/static-planner-adapter.mjs
git commit -m "test: add workbuddy connector acceptance"
```

---

## Task 6: Final Verification and Operator Runbook

**Files:**
- Modify: `README.md`
- Modify: `docs/contracts/bridge-workbuddy-api.md`

- [ ] **Step 1: Document operator startup**

Add to `README.md`:

```markdown
### Local WorkBuddy Worker

For local operator testing, enable the bounded WorkBuddy worker in
`scripts/local-config.json`:

```json
{
  "planner": { "kind": "codex" },
  "workbuddyWorker": {
    "enabled": true,
    "endpointId": "workbuddy",
    "pollIntervalMs": 1000
  }
}
```

Start:

```bash
npm run start:local-server:configured
```

The worker uses the server-owned pairing token in memory. Do not put pairing
tokens in config files. The main transcript shows planner/user-facing messages
only; WorkBuddy lifecycle appears in the WorkBuddy panel.
```
```

- [ ] **Step 2: Run full gates**

Run:

```bash
npm run typecheck
npm run lint
node --experimental-strip-types scripts/policy-gated-planner-acceptance.ts
node --experimental-strip-types scripts/workbuddy-connector-acceptance.ts
npm test
git diff --check
```

Expected:

- typecheck clean
- lint clean
- policy-gated acceptance 8/8
- WorkBuddy connector acceptance pass
- full test suite pass
- no whitespace errors

- [ ] **Step 3: Manual browser verification**

Start configured server:

```bash
npm run start:local-server:configured
```

Open:

```text
http://127.0.0.1:31337/console/project
```

Verify:

1. Pairing is saved as `chatgpt-web → workbuddy`.
2. Conversation message asks for a safe diagnostic execution.
3. Main transcript shows planner text and then executor result only.
4. Main transcript does not show `queued`, `dispatch`, `route`, `action`, or `workbuddy-execution`.
5. WorkBuddy panel shows task status and worker logs.
6. `/bridge/projects/cli-bridge/workbuddy` contains `executionTasks` and `executionLogs`.

- [ ] **Step 4: Commit docs**

Run:

```bash
git add README.md docs/contracts/bridge-workbuddy-api.md
git commit -m "docs: document local workbuddy connector runbook"
```

---

## Acceptance Criteria

- A running configured worker makes `workbuddy` available before user sends a safe execution request.
- Safe planner output with `riskHints: ["pure-transform"]` creates exactly one WorkBuddy task.
- Worker claims the task and posts one raw result.
- Console main transcript shows only user/planner/executor-facing content.
- WorkBuddy panel shows task lifecycle/logs.
- Extension auth cannot force worker start, accept gate, reject gate, or post results.
- Pairing token is absent from snapshot, DOM, localStorage, API responses, and test logs.
- No new generic execution route exists.

## Recommended Execution Mode

Use **Subagent-Driven** execution:

1. Task 0 in review/planning context.
2. Task 1 and Task 2 as separate EX batches.
3. REVIEW after Task 2 because worker startup touches auth/token handling.
4. Task 3 and Task 4 as separate EX batches.
5. Task 5 and Task 6 as final acceptance batch.
