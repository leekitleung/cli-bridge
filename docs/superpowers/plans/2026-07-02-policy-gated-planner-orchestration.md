# Policy-Gated Planner Orchestration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Project Conversation usable as a planner-first session where policy, not per-turn manual approval, decides whether to continue planning, auto-execute, require confirmation, or block.

**Architecture:** ADR-0031 layers a planner output envelope, executor availability, and deterministic gate evaluator in front of the existing ADR-0029/0030 route plane. The main transcript becomes user/planner/executor-result only; route, task, action, dispatch, and queued internals move out of the primary chat surface. Mock planner remains test-only, and real runtime requires a configured planner adapter or returns planner-unavailable.

**Tech Stack:** TypeScript local server, existing Project Console single-file UI, existing conversation stores, existing WorkBuddy pull protocol, JSON snapshot persistence, Node test runner with jsdom, existing local launcher/browser acceptance patterns.

---

## Gate Status

Do not implement this plan before ADR-0031 is explicitly accepted.

ADR file:

```text
docs/planning/ADR-0031-policy-gated-planner-orchestration.md
```

## Current Problem

ADR-0030 made execution safe but not usable:

```text
User -> mock planner proposal -> manual accept -> WorkBuddy task
```

Observed failure mode:

- Every user message requires Accept or Reject.
- Main transcript can show internal `queued workbuddy-execution` details.
- Mock planner does not send the question to ChatGPT Web, Codex, or Claude.
- WorkBuddy is pull-based; without a worker it stays queued and appears broken.

ADR-0031 target:

```text
User -> real planner -> PlannerOutputEnvelope -> GateEvaluator
  -> continue_planning | auto_execute | require_user_confirm | blocked
  -> executor only after gate approval
  -> raw executor result
```

## File Structure

Create:

- `apps/local-server/src/conversation/planner-output-envelope.ts`
  - Defines `PlannerOutputEnvelope`, `PlannerIntent`, and validation helpers.

- `apps/local-server/src/conversation/planner-adapter.ts`
  - Defines planner adapter interface and runtime registry.

- `apps/local-server/src/conversation/mock-planner-adapter.ts`
  - Test-only planner adapter. It must not be registered by default runtime.

- `apps/local-server/src/conversation/gate-evaluator.ts`
  - Pure gate evaluator and policy config.

- `apps/local-server/src/conversation/executor-availability.ts`
  - Converts endpoint registry and WorkBuddy readiness into gate input.

- `apps/local-server/src/storage/planner-output-store.ts`
  - Persists planner output envelopes.

- `apps/local-server/src/storage/gate-decision-store.ts`
  - Persists internal gate decisions for audit/debug.

- `tests/planner-output-envelope.test.mjs`
  - Envelope validation and transcript visibility tests.

- `tests/gate-evaluator.test.mjs`
  - Pure policy tests for every gate decision.

- `tests/executor-availability.test.mjs`
  - WorkBuddy pull readiness and offline/unknown tests.

- `tests/policy-gated-conversation-api.test.mjs`
  - End-to-end API tests for planner -> gate -> route plane.

- `scripts/policy-gated-planner-acceptance.ts`
  - Automated acceptance script for the complete ADR-0031 runtime flow.

Modify:

- `apps/local-server/src/routes/bridge-api.ts`
  - Replace conversation message mock planner behavior with configured planner adapter call.
  - Run gate evaluation after planner envelope creation.
  - Create instruction/route/task only for `auto_execute` or explicit confirmation.
  - Return planner-unavailable or blocked states before dispatch.

- `apps/local-server/src/routes/project-console.ts`
  - Hide internal statuses from main transcript.
  - Render planner visible output, confirmation prompts only when required, blocked/offline states, and executor raw result.
  - Add optional debug/inspect surface only if existing UI patterns support it without expanding scope.

- `apps/local-server/src/storage/json-snapshot-store.ts`
  - Persist planner envelopes, gate decisions, and executor availability heartbeat state if stored.

- `apps/local-server/src/workbuddy/workbuddy-execution-adapter.ts`
  - Add readiness/heartbeat or claim-readiness signal without changing existing inbox/result URL compatibility.

- `tests/project-console-behavior.test.mjs`
  - Assert main transcript hides queued/action/route/dispatch internals.

- `tests/local-launcher.test.mjs`
  - Assert extension auth cannot force gate approval or execution.

Do not modify:

- Pairing token generation.
- Local auto-pair extension claim flow.
- Existing generic shell/run/exec/Git/PR boundaries.
- Existing WorkBuddy inbox/result endpoint shape.

## Core Types

### Planner Output Envelope

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

### Gate Decision

```ts
export type GateDecision =
  | { type: 'continue_planning'; reason: string }
  | { type: 'auto_execute'; instruction: InstructionPacketDraft; reason: string }
  | { type: 'require_user_confirm'; proposalId: string; reason: string }
  | { type: 'blocked'; reason: string; missing: string[] };
```

### Executor Availability

```ts
export interface ExecutorAvailability {
  endpointId: string;
  status: 'online' | 'offline' | 'unknown';
  lastSeenAt?: string;
  capabilities: string[];
  claimMode: 'push' | 'pull';
}
```

## Task 0: ADR-0031 Acceptance Gate

**Files:**
- Create: `docs/planning/ADR-0031-policy-gated-planner-orchestration.md`
- Create: `docs/superpowers/plans/2026-07-02-policy-gated-planner-orchestration.md`

- [ ] **Step 1: Verify ADR status**

Run:

```bash
rg -n "Status: Proposed|Status: Accepted" docs/planning/ADR-0031-policy-gated-planner-orchestration.md
```

Expected before implementation:

```text
Status: Proposed
```

- [ ] **Step 2: Human review**

Review must explicitly decide one of:

```text
ACCEPT ADR-0031
REVISE ADR-0031
REJECT ADR-0031
```

- [ ] **Step 3: Accept only after explicit decision**

Patch only this line after explicit acceptance:

```diff
-Status: Proposed
+Status: Accepted
```

- [ ] **Step 4: Commit planning gate**

```bash
git add docs/planning/ADR-0031-policy-gated-planner-orchestration.md docs/superpowers/plans/2026-07-02-policy-gated-planner-orchestration.md
git commit -m "docs: propose policy-gated planner orchestration"
```

## Task 1: Transcript Visibility Cleanup

**Files:**
- Modify: `apps/local-server/src/routes/project-console.ts`
- Modify: `tests/project-console-behavior.test.mjs`

- [ ] **Step 1: Write failing UI test for hidden route internals**

Add a test near the existing conversation transcript visibility tests:

```js
test('main conversation transcript hides route and queue internals', () => {
  const html = renderConversationTranscript([
    { role: 'user', kind: 'user_message', visibility: 'user', text: 'hi', status: 'draft', routeKind: 'workbuddy-execution' },
    { role: 'bridge', kind: 'status', visibility: 'internal', text: 'task dispatched to workbuddy', status: 'queued', routeKind: 'workbuddy-execution' },
    { role: 'target', kind: 'executor_output', visibility: 'user', text: 'done', status: 'returned', routeKind: 'workbuddy-execution' },
  ]);

  assert.match(html, /hi/);
  assert.match(html, /done/);
  assert.doesNotMatch(html, /queued/);
  assert.doesNotMatch(html, /workbuddy-execution/);
  assert.doesNotMatch(html, /dispatch/i);
});
```

- [ ] **Step 2: Run test and verify failure**

Run:

```bash
node --experimental-strip-types --test tests/project-console-behavior.test.mjs
```

Expected: FAIL because the current main transcript can expose internal status or route labels in rendered message metadata.

- [ ] **Step 3: Implement minimal visibility filter**

In `project-console.ts`, ensure main transcript rendering excludes internal kinds and hides metadata labels:

```ts
function isMainTranscriptEvent(event) {
  return event.visibility === 'user'
    && event.kind !== 'instruction'
    && event.kind !== 'status';
}
```

Rendered conversation message chrome must not include `event.status` or `event.routeKind` for user-visible rows.

- [ ] **Step 4: Run focused UI tests**

```bash
node --experimental-strip-types --test tests/project-console-behavior.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/local-server/src/routes/project-console.ts tests/project-console-behavior.test.mjs
git commit -m "fix: hide conversation route internals from main transcript"
```

## Task 2: Executor Availability Before Dispatch

**Files:**
- Create: `apps/local-server/src/conversation/executor-availability.ts`
- Create: `tests/executor-availability.test.mjs`
- Modify: `apps/local-server/src/workbuddy/workbuddy-execution-adapter.ts`
- Modify: `apps/local-server/src/routes/bridge-api.ts`

- [ ] **Step 1: Write failing availability tests**

Create `tests/executor-availability.test.mjs`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';

test('workbuddy pull executor is unknown without readiness signal', async () => {
  const { resolveExecutorAvailability } = await import('../apps/local-server/src/conversation/executor-availability.ts');
  const availability = resolveExecutorAvailability({
    endpoint: { id: 'workbuddy', transport: 'workbuddy', capabilities: { canExecute: true } },
    workbuddyReady: false,
    now: 1000,
  });

  assert.equal(availability.status, 'unknown');
  assert.equal(availability.claimMode, 'pull');
});

test('workbuddy pull executor is online with fresh readiness signal', async () => {
  const { resolveExecutorAvailability } = await import('../apps/local-server/src/conversation/executor-availability.ts');
  const availability = resolveExecutorAvailability({
    endpoint: { id: 'workbuddy', transport: 'workbuddy', capabilities: { canExecute: true } },
    workbuddyReady: true,
    lastSeenAt: 900,
    now: 1000,
  });

  assert.equal(availability.status, 'online');
});
```

- [ ] **Step 2: Run and verify failure**

```bash
node --experimental-strip-types --test tests/executor-availability.test.mjs
```

Expected: FAIL because `executor-availability.ts` does not exist.

- [ ] **Step 3: Implement availability resolver**

Create `apps/local-server/src/conversation/executor-availability.ts`:

```ts
export function resolveExecutorAvailability(input: {
  endpoint: { id: string; transport: string; capabilities?: Record<string, boolean> };
  workbuddyReady?: boolean;
  lastSeenAt?: number;
  now: number;
}) {
  const claimMode = input.endpoint.transport === 'workbuddy' ? 'pull' : 'push';
  const capabilities = Object.entries(input.endpoint.capabilities ?? {})
    .filter(([, enabled]) => enabled)
    .map(([name]) => name);

  if (claimMode === 'pull') {
    return {
      endpointId: input.endpoint.id,
      status: input.workbuddyReady ? 'online' as const : 'unknown' as const,
      lastSeenAt: input.lastSeenAt,
      capabilities,
      claimMode,
    };
  }

  return {
    endpointId: input.endpoint.id,
    status: 'online' as const,
    lastSeenAt: input.lastSeenAt,
    capabilities,
    claimMode,
  };
}
```

- [ ] **Step 4: Block dispatch before task creation when executor unavailable**

Add an API test in `tests/policy-gated-conversation-api.test.mjs` later, then wire `bridge-api.ts` to evaluate availability before instruction creation. For this task, only expose the resolver and WorkBuddy readiness data needed by Task 4.

- [ ] **Step 5: Run focused tests**

```bash
node --experimental-strip-types --test tests/executor-availability.test.mjs
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/local-server/src/conversation/executor-availability.ts apps/local-server/src/workbuddy/workbuddy-execution-adapter.ts tests/executor-availability.test.mjs
git commit -m "feat: add executor availability model"
```

## Task 3: Real Planner Adapter Boundary

**Files:**
- Create: `apps/local-server/src/conversation/planner-adapter.ts`
- Create: `apps/local-server/src/conversation/mock-planner-adapter.ts`
- Create: `tests/planner-adapter.test.mjs`
- Modify: `apps/local-server/src/routes/bridge-api.ts`

- [ ] **Step 1: Write test that default runtime has no mock planner**

Create `tests/planner-adapter.test.mjs`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';

test('default runtime does not silently register mock planner', async () => {
  const { createBridgeRuntime } = await import('../apps/local-server/src/routes/bridge-api.ts');
  const runtime = createBridgeRuntime();

  assert.equal(runtime.plannerRegistry.has('mock-planner'), false);
});
```

- [ ] **Step 2: Run and verify failure**

```bash
node --experimental-strip-types --test tests/planner-adapter.test.mjs
```

Expected: FAIL because planner registry does not exist.

- [ ] **Step 3: Define planner adapter interface**

Create `apps/local-server/src/conversation/planner-adapter.ts`:

```ts
import type { PlannerOutputEnvelope } from './planner-output-envelope.ts';

export interface PlannerRequest {
  sessionId: string;
  projectId: string;
  userText: string;
  history: Array<{ role: 'user' | 'planner' | 'executor'; text: string }>;
}

export interface PlannerAdapter {
  id: string;
  mode: 'interactive' | 'automatic' | 'test-only';
  plan(input: PlannerRequest): Promise<PlannerOutputEnvelope>;
}

export class PlannerAdapterRegistry {
  private readonly adapters = new Map<string, PlannerAdapter>();

  register(adapter: PlannerAdapter): void {
    this.adapters.set(adapter.id, adapter);
  }

  get(id: string): PlannerAdapter | undefined {
    return this.adapters.get(id);
  }

  has(id: string): boolean {
    return this.adapters.has(id);
  }
}
```

- [ ] **Step 4: Create test-only mock planner**

Create `apps/local-server/src/conversation/mock-planner-adapter.ts`:

```ts
import type { PlannerAdapter } from './planner-adapter.ts';

export const mockPlannerAdapter: PlannerAdapter = {
  id: 'mock-planner',
  mode: 'test-only',
  async plan(input) {
    return {
      id: `planner-output-${Date.now()}`,
      sessionId: input.sessionId,
      plannerEndpointId: 'mock-planner',
      visibleText: `Plan proposal: ${input.userText}`,
      intent: 'propose_plan',
      proposedInstruction: {
        summary: input.userText,
        payload: input.userText,
        targetExecutorIds: [],
        riskHints: ['test-only'],
      },
      createdAt: new Date().toISOString(),
    };
  },
};
```

- [ ] **Step 5: Wire runtime registry without mock by default**

In `bridge-api.ts`, create a planner registry on runtime. Allow tests to pass explicit adapters through `createBridgeRuntime({ plannerAdapters: [...] })`.

- [ ] **Step 6: Run tests**

```bash
node --experimental-strip-types --test tests/planner-adapter.test.mjs
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/local-server/src/conversation/planner-adapter.ts apps/local-server/src/conversation/mock-planner-adapter.ts apps/local-server/src/routes/bridge-api.ts tests/planner-adapter.test.mjs
git commit -m "feat: add planner adapter registry"
```

## Task 4: Planner Output Envelope and Gate Evaluator

**Files:**
- Create: `apps/local-server/src/conversation/planner-output-envelope.ts`
- Create: `apps/local-server/src/conversation/gate-evaluator.ts`
- Create: `tests/planner-output-envelope.test.mjs`
- Create: `tests/gate-evaluator.test.mjs`

- [ ] **Step 1: Write envelope validation tests**

Create `tests/planner-output-envelope.test.mjs`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';

test('request_execution requires proposedInstruction payload', async () => {
  const { validatePlannerOutputEnvelope } = await import('../apps/local-server/src/conversation/planner-output-envelope.ts');

  const result = validatePlannerOutputEnvelope({
    id: 'out-1',
    sessionId: 's-1',
    plannerEndpointId: 'planner-1',
    visibleText: 'I can do that.',
    intent: 'request_execution',
    createdAt: new Date().toISOString(),
  });

  assert.equal(result.ok, false);
  assert.match(result.reason, /proposedInstruction/);
});
```

- [ ] **Step 2: Write gate evaluator tests**

Create `tests/gate-evaluator.test.mjs`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';

const onlineExecutor = {
  endpointId: 'workbuddy',
  status: 'online',
  capabilities: ['canExecute'],
  claimMode: 'pull',
};

test('answer intent continues planning and does not execute', async () => {
  const { evaluateGate } = await import('../apps/local-server/src/conversation/gate-evaluator.ts');
  const decision = evaluateGate({
    plannerOutput: { id: 'o1', sessionId: 's1', plannerEndpointId: 'p1', visibleText: 'Answer only', intent: 'answer', createdAt: new Date().toISOString() },
    sessionState: { projectId: 'cli-bridge' },
    executorAvailability: [onlineExecutor],
    policyConfig: { allowSafeAutoExecute: true },
  });

  assert.equal(decision.type, 'continue_planning');
});

test('request_execution with offline executor blocks before dispatch', async () => {
  const { evaluateGate } = await import('../apps/local-server/src/conversation/gate-evaluator.ts');
  const decision = evaluateGate({
    plannerOutput: {
      id: 'o2',
      sessionId: 's1',
      plannerEndpointId: 'p1',
      visibleText: 'Ready to execute.',
      intent: 'request_execution',
      proposedInstruction: { summary: 'format text', payload: 'format text', targetExecutorIds: ['workbuddy'], riskHints: ['pure-transform'] },
      createdAt: new Date().toISOString(),
    },
    sessionState: { projectId: 'cli-bridge' },
    executorAvailability: [{ ...onlineExecutor, status: 'offline' }],
    policyConfig: { allowSafeAutoExecute: true },
  });

  assert.equal(decision.type, 'blocked');
  assert.deepEqual(decision.missing, ['executor:workbuddy']);
});

test('safe pure transform can auto execute when executor is online', async () => {
  const { evaluateGate } = await import('../apps/local-server/src/conversation/gate-evaluator.ts');
  const decision = evaluateGate({
    plannerOutput: {
      id: 'o3',
      sessionId: 's1',
      plannerEndpointId: 'p1',
      visibleText: 'Ready to format.',
      intent: 'request_execution',
      proposedInstruction: { summary: 'format text', payload: 'format text', targetExecutorIds: ['workbuddy'], riskHints: ['pure-transform'] },
      createdAt: new Date().toISOString(),
    },
    sessionState: { projectId: 'cli-bridge' },
    executorAvailability: [onlineExecutor],
    policyConfig: { allowSafeAutoExecute: true },
  });

  assert.equal(decision.type, 'auto_execute');
});

test('file mutation requires user confirmation', async () => {
  const { evaluateGate } = await import('../apps/local-server/src/conversation/gate-evaluator.ts');
  const decision = evaluateGate({
    plannerOutput: {
      id: 'o4',
      sessionId: 's1',
      plannerEndpointId: 'p1',
      visibleText: 'I will edit files.',
      intent: 'request_execution',
      proposedInstruction: { summary: 'edit files', payload: 'edit files', targetExecutorIds: ['workbuddy'], riskHints: ['filesystem-mutation'] },
      createdAt: new Date().toISOString(),
    },
    sessionState: { projectId: 'cli-bridge' },
    executorAvailability: [onlineExecutor],
    policyConfig: { allowSafeAutoExecute: true },
  });

  assert.equal(decision.type, 'require_user_confirm');
});
```

- [ ] **Step 3: Run and verify failures**

```bash
node --experimental-strip-types --test tests/planner-output-envelope.test.mjs tests/gate-evaluator.test.mjs
```

Expected: FAIL because modules do not exist.

- [ ] **Step 4: Implement envelope and gate**

Implement only the types and rule checks required by the tests. Treat unknown
risk hints as `require_user_confirm`, not `auto_execute`.

- [ ] **Step 5: Run tests**

```bash
node --experimental-strip-types --test tests/planner-output-envelope.test.mjs tests/gate-evaluator.test.mjs
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/local-server/src/conversation/planner-output-envelope.ts apps/local-server/src/conversation/gate-evaluator.ts tests/planner-output-envelope.test.mjs tests/gate-evaluator.test.mjs
git commit -m "feat: add planner envelope and policy gate"
```

## Task 5: Conversation API Uses Planner and Gate

**Files:**
- Modify: `apps/local-server/src/routes/bridge-api.ts`
- Create: `tests/policy-gated-conversation-api.test.mjs`
- Modify: `apps/local-server/src/storage/json-snapshot-store.ts`
- Create: `apps/local-server/src/storage/planner-output-store.ts`
- Create: `apps/local-server/src/storage/gate-decision-store.ts`

- [ ] **Step 1: Write failing API test for no planner**

Create `tests/policy-gated-conversation-api.test.mjs`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';

function jsonBody(body) {
  const text = body === undefined ? '' : JSON.stringify(body);
  async function* gen() {
    if (text.length > 0) yield Buffer.from(text, 'utf8');
  }
  return gen();
}

test('conversation message returns planner-unavailable when no real planner is configured', async () => {
  const { createBridgeRuntime, handleBridgeRequest } = await import('../apps/local-server/src/routes/bridge-api.ts');
  const runtime = createBridgeRuntime();

  const res = await handleBridgeRequest(
    runtime,
    'POST',
    '/bridge/projects/cli-bridge/conversation/messages',
    jsonBody({ text: 'hi' }),
  );

  assert.equal(res.statusCode, 409);
  assert.match(res.payload.message, /planner.*unavailable/i);
  assert.equal(runtime.conversationInstructionStore.exportPackets().length, 0);
  assert.equal(runtime.conversationRouteStore.exportRoutes().length, 0);
});
```

- [ ] **Step 2: Write API test for answer intent**

```js
test('planner answer intent renders planner output without executor task', async () => {
  const { createBridgeRuntime, handleBridgeRequest } = await import('../apps/local-server/src/routes/bridge-api.ts');
  const runtime = createBridgeRuntime({
    plannerAdapters: [{
      id: 'test-planner',
      mode: 'test-only',
      async plan() {
        return { id: 'out-1', sessionId: 's1', plannerEndpointId: 'test-planner', visibleText: 'Hello from planner', intent: 'answer', createdAt: new Date().toISOString() };
      },
    }],
  });

  const res = await handleBridgeRequest(runtime, 'POST', '/bridge/projects/cli-bridge/conversation/messages', jsonBody({ text: 'hi' }));

  assert.equal(res.statusCode, 201);
  assert.match(res.payload.events.at(-1).text, /Hello from planner/);
  assert.equal(runtime.conversationInstructionStore.exportPackets().length, 0);
  assert.equal(runtime.workbuddyExecution.exportTasks().length, 0);
});
```

- [ ] **Step 3: Write API test for blocked offline executor**

```js
test('request execution blocks before dispatch when executor unavailable', async () => {
  const { createBridgeRuntime, handleBridgeRequest } = await import('../apps/local-server/src/routes/bridge-api.ts');
  const runtime = createBridgeRuntime({
    plannerAdapters: [{
      id: 'test-planner',
      mode: 'test-only',
      async plan() {
        return {
          id: 'out-2',
          sessionId: 's1',
          plannerEndpointId: 'test-planner',
          visibleText: 'Ready to execute.',
          intent: 'request_execution',
          proposedInstruction: { summary: 'format text', payload: 'format text', targetExecutorIds: ['workbuddy'], riskHints: ['pure-transform'] },
          createdAt: new Date().toISOString(),
        };
      },
    }],
  });

  const res = await handleBridgeRequest(runtime, 'POST', '/bridge/projects/cli-bridge/conversation/messages', jsonBody({ text: 'format this' }));

  assert.equal(res.statusCode, 201);
  assert.equal(res.payload.gate.type, 'blocked');
  assert.equal(runtime.conversationInstructionStore.exportPackets().length, 0);
  assert.equal(runtime.workbuddyExecution.exportTasks().length, 0);
});
```

- [ ] **Step 4: Run and verify failures**

```bash
node --experimental-strip-types --test tests/policy-gated-conversation-api.test.mjs
```

Expected: FAIL until `bridge-api.ts` routes through planner registry and gate evaluator.

- [ ] **Step 5: Implement planner and gate API wiring**

In `POST /conversation/messages`:

```text
append user event
resolve configured planner
if missing -> 409 planner-unavailable
call planner.plan()
validate envelope
append planner visibleText event
resolve executor availability
evaluateGate()
persist internal gate decision
if continue_planning -> return events + gate
if blocked -> append short blocked state, return events + gate
if require_user_confirm -> create proposal/confirmation state, return events + gate
if auto_execute -> create instruction + route + executor task
```

- [ ] **Step 6: Run API tests**

```bash
node --experimental-strip-types --test tests/policy-gated-conversation-api.test.mjs tests/conversation-execution-api.test.mjs tests/conversation-pairing-api.test.mjs
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/local-server/src/routes/bridge-api.ts apps/local-server/src/storage/json-snapshot-store.ts apps/local-server/src/storage/planner-output-store.ts apps/local-server/src/storage/gate-decision-store.ts tests/policy-gated-conversation-api.test.mjs
git commit -m "feat: route conversations through planner policy gate"
```

## Task 6: Console Conversation UX

**Files:**
- Modify: `apps/local-server/src/routes/project-console.ts`
- Modify: `tests/project-console-behavior.test.mjs`

- [ ] **Step 1: Write failing test for planner-first display**

Add:

```js
test('conversation displays planner output and hides gate internals', async () => {
  const { document, setFixture } = setupConsole();
  setFixture('/bridge/projects/cli-bridge/conversation/messages', {
    ok: true,
    status: 201,
    payload: {
      events: [
        { role: 'user', kind: 'user_message', visibility: 'user', text: 'hi' },
        { role: 'planner', kind: 'planner_output', visibility: 'user', text: 'I need one detail before executing.' },
      ],
      gate: { type: 'continue_planning', reason: 'clarification-needed' },
    },
  });

  document.getElementById('command-input').value = 'hi';
  document.getElementById('command-send').click();

  await waitFor(() => document.getElementById('conversation-transcript').textContent.includes('I need one detail'));
  assert.doesNotMatch(document.getElementById('conversation-transcript').textContent, /continue_planning/);
  assert.doesNotMatch(document.getElementById('conversation-transcript').textContent, /queued|workbuddy-execution|dispatch/i);
});
```

- [ ] **Step 2: Write failing test for require confirm only when gate requires it**

```js
test('conversation shows confirmation controls only for require_user_confirm', async () => {
  const { document, setFixture } = setupConsole();
  setFixture('/bridge/projects/cli-bridge/conversation/messages', {
    ok: true,
    status: 201,
    payload: {
      events: [
        { role: 'planner', kind: 'planner_output', visibility: 'user', text: 'I will edit files if you approve.' },
      ],
      gate: { type: 'require_user_confirm', proposalId: 'proposal-1', reason: 'filesystem-mutation' },
    },
  });

  document.getElementById('command-input').value = 'edit files';
  document.getElementById('command-send').click();

  await waitFor(() => document.querySelector('[data-gate-confirm="proposal-1"]'));
  assert.ok(document.querySelector('[data-gate-reject="proposal-1"]'));
});
```

- [ ] **Step 3: Run and verify failures**

```bash
node --experimental-strip-types --test tests/project-console-behavior.test.mjs
```

Expected: FAIL until UI understands planner events and gate decisions.

- [ ] **Step 4: Implement UI rendering**

Rules:

```text
continue_planning -> render planner visibleText only
blocked -> render short user-facing unavailable state
require_user_confirm -> render planner visibleText + confirm/reject controls
auto_execute -> render planner visibleText, then wait for executor output
```

- [ ] **Step 5: Run UI tests**

```bash
node --experimental-strip-types --test tests/project-console-behavior.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/local-server/src/routes/project-console.ts tests/project-console-behavior.test.mjs
git commit -m "feat: show planner-first conversation flow"
```

## Task 7: Result Loop and Acceptance Script

**Files:**
- Modify: `apps/local-server/src/routes/bridge-api.ts`
- Create: `scripts/policy-gated-planner-acceptance.ts`
- Modify: `tests/conversation-execution-api.test.mjs`

- [ ] **Step 1: Write result loop API test**

Add:

```js
test('executor raw result returns to transcript without bridge-authored rewrite', async () => {
  const { createBridgeRuntime, handleBridgeRequest } = await import('../apps/local-server/src/routes/bridge-api.ts');
  const runtime = createBridgeRuntime({ plannerAdapters: [safeAutoExecutePlanner()] });

  const message = await handleBridgeRequest(runtime, 'POST', '/bridge/projects/cli-bridge/conversation/messages', jsonBody({ text: 'format abc' }));
  assert.equal(message.statusCode, 201);

  const task = runtime.workbuddyExecution.exportTasks()[0];
  const result = await handleBridgeRequest(runtime, 'POST', '/bridge/endpoints/workbuddy/results', jsonBody({
    taskId: task.taskId,
    ok: true,
    stdout: 'ABC',
  }));

  assert.equal(result.statusCode, 200);
  const transcript = runtime.conversationTranscriptStore.listByProject('cli-bridge');
  assert.equal(transcript.at(-1).text, 'ABC');
});
```

- [ ] **Step 2: Create acceptance script**

Create `scripts/policy-gated-planner-acceptance.ts` covering:

```text
1. No planner -> planner-unavailable, no task.
2. Planner answer -> visible planner output, no task.
3. Planner request_execution + offline executor -> blocked, no task.
4. Planner safe request_execution + online executor -> task created.
5. Executor result -> raw result in transcript.
6. High-risk request_execution -> confirmation required.
7. Extension cannot force confirmation or auto execution.
8. Main transcript has no queued/workbuddy-execution/dispatch/action/route text.
```

- [ ] **Step 3: Run acceptance**

```bash
node --experimental-strip-types scripts/policy-gated-planner-acceptance.ts
```

Expected:

```text
ALL POLICY-GATED PLANNER ACCEPTANCE CHECKS PASSED
```

- [ ] **Step 4: Run full gate**

```bash
npm run typecheck
npm run lint
npm test
git diff --check
```

Expected:

```text
typecheck clean
lint clean
all tests pass
diff check clean
```

- [ ] **Step 5: Commit**

```bash
git add apps/local-server/src/routes/bridge-api.ts scripts/policy-gated-planner-acceptance.ts tests/conversation-execution-api.test.mjs
git commit -m "test: add policy-gated planner acceptance"
```

## Final Review Gate

Before calling ADR-0031 complete, verify:

```bash
node --experimental-strip-types scripts/policy-gated-planner-acceptance.ts
npm run typecheck
npm run lint
npm test
git diff --check
```

Required evidence:

- Main transcript no longer shows `queued`, `workbuddy-execution`, `dispatch`, `action`, or `route`.
- User messages do not create executor tasks unless gate returns `auto_execute` or confirmed execution.
- Mock planner is not default runtime planner.
- Executor offline blocks before dispatch.
- ChatGPT Web planner remains interactive unless a later ADR approves auto-send.
- Bridge never authors semantic final answers.

## Execution Strategy

Recommended: Subagent-Driven.

Rationale:

- Task 1 can land independently as immediate UX stop-loss.
- Task 2 and Task 4 define separate pure logic modules and are easy to review.
- Task 3 and Task 5 touch `bridge-api.ts` and need review gates between them.
- Task 6 is UI-specific.
- Task 7 is acceptance-only and should not change product semantics.

Suggested commit chain:

```text
docs: propose policy-gated planner orchestration
fix: hide conversation route internals from main transcript
feat: add executor availability model
feat: add planner adapter registry
feat: add planner envelope and policy gate
feat: route conversations through planner policy gate
feat: show planner-first conversation flow
test: add policy-gated planner acceptance
```
