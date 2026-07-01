# Generic Conversation Route Adapters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Conversation automation follow the two paired endpoints by dispatching through target route adapters instead of hard-coding one tool name.

**Architecture:** Pairing still selects a source endpoint and target endpoint. The target endpoint resolves to a route adapter (`workbuddy-execution`, `review-command`, later `web-relay` or `managed-pty`) and Conversation creates/dispatches actions through that adapter. Auto-dispatch remains a local Console session capability and still requires Console cookie auth; extension and ChatGPT content scripts cannot confirm or dispatch.

**Tech Stack:** TypeScript local server, existing endpoint registry, existing Conversation stores, existing WorkBuddy and review command execution paths, self-contained Project Console HTML, Node test runner.

---

## Current Gap

Current behavior is not fully pairing-generic:

- `resolveConversationRouteKind()` treats execution as `endpoint.id === 'workbuddy' && canExecute`.
- Project Console mirrors the same `workbuddy` id check.
- Conversation action creation has explicit `workbuddy-execution` and `review-command` branches.
- Review command dispatch does not run the existing governed review dispatch; it only marks the action queued and points the operator to `/bridge/reviews/dispatch`.
- UI auto-dispatch is generic over actions, but it only works for routes that already return a dispatchable action.

## Target Behavior

- Pairing selects `sourceEndpointId` and `targetEndpointId`.
- The target endpoint chooses a registered `ConversationRouteAdapter`.
- A route adapter owns:
  - route kind and readiness status;
  - action preview creation;
  - confirm side effects;
  - dispatch side effects;
  - user-facing preview/status text.
- Auto-dispatch stays generic: it sees previewed actions and calls `confirm -> dispatch`; it does not know tool names.
- The extension cannot confirm/dispatch or set route authority.

## Non-Goals

- No arbitrary `/exec`, `/run`, `/shell`, Git, PR, or workspace mutation endpoint.
- No extension-side route selection.
- No ChatGPT-side confirm/dispatch.
- No managed PTY execution in this plan.
- No web relay auto-send in this plan.
- No generic execution for endpoints without a registered route adapter.

## File Structure

Create:

- `docs/planning/ADR-0027-generic-conversation-route-adapters.md`
  - Records the boundary change from one hard-coded target to route-adapter-based dispatch.

- `apps/local-server/src/conversation/conversation-route-adapter.ts`
  - Defines `ConversationRouteAdapter`, `ConversationRouteResolution`, and helper inputs.

- `apps/local-server/src/conversation/conversation-route-registry.ts`
  - Registers route adapters and resolves target endpoint to adapter.

- `tests/conversation-route-adapters.test.mjs`
  - Unit tests for route resolution and adapter behavior.

Modify:

- `apps/local-server/src/routes/bridge-api.ts`
  - Replace hard-coded route/action branches with adapter calls.
  - Keep Console-cookie gate for confirm/dispatch.

- `apps/local-server/src/routes/project-console.ts`
  - Replace client-side `endpoint.id === 'workbuddy'` route label with server-compatible route capability rules.
  - Keep auto-dispatch generic and session-scoped.

- `tests/conversation-execution-api.test.mjs`
  - Add route-generic conversation tests.

- `tests/project-console-behavior.test.mjs`
  - Add UI tests for generic route labels and auto-dispatch.

Do not modify:

- Extension confirm/dispatch authority.
- Pairing token storage model.
- Generic shell/exec/run route policy.

## Task 0: ADR Boundary

**Files:**
- Create: `docs/planning/ADR-0027-generic-conversation-route-adapters.md`

- [ ] **Step 1: Create ADR-0027**

Create `docs/planning/ADR-0027-generic-conversation-route-adapters.md`:

```md
# ADR-0027: Generic Conversation Route Adapters

Status: Proposed

Date: 2026-07-01

## Context

ADR-0026 made Conversation actions dispatchable from the local Project Console,
but execution dispatch is still coupled to a specific endpoint id. This makes
Conversation automation feel like a WorkBuddy shortcut rather than a pairing
between the selected source and target tools.

## Decision

Conversation automation will dispatch through registered target route adapters.
The pairing chooses source and target endpoints. The target endpoint resolves to
a route adapter based on endpoint transport and capabilities. The adapter owns
preview, confirm, and dispatch behavior for that route.

## Constraints

- Auto-dispatch remains local Console session authority only.
- Extension and ChatGPT content scripts cannot confirm or dispatch actions.
- Endpoints without a registered adapter are not auto-dispatchable.
- Managed PTY and web relay remain non-auto-dispatch routes in this ADR.
- No generic shell, run, exec, Git, PR, or workspace mutation endpoint is added.

## Acceptance Conditions

This ADR requires explicit human acceptance before execution implementation.
```

- [ ] **Step 2: Verify boundary phrases**

Run:

```bash
rg -n "Status: Proposed|registered target route adapters|Auto-dispatch remains local Console|Extension and ChatGPT|No generic shell" docs/planning/ADR-0027-generic-conversation-route-adapters.md
```

Expected: all phrases present.

- [ ] **Step 3: Commit**

```bash
git add docs/planning/ADR-0027-generic-conversation-route-adapters.md
git commit -m "docs: propose generic conversation route adapter boundary"
```

## Task 1: Route Adapter Interfaces

**Files:**
- Create: `apps/local-server/src/conversation/conversation-route-adapter.ts`
- Create: `apps/local-server/src/conversation/conversation-route-registry.ts`
- Test: `tests/conversation-route-adapters.test.mjs`

- [ ] **Step 1: Add failing route resolution tests**

Create `tests/conversation-route-adapters.test.mjs`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveConversationRouteAdapter } from '../apps/local-server/src/conversation/conversation-route-registry.ts';

function endpoint(overrides) {
  return {
    id: 'endpoint',
    label: 'Endpoint',
    transport: 'web-dom',
    status: 'online',
    capabilities: {
      canAcceptPrompt: false,
      canReturnOutput: false,
      canReview: false,
      canExecute: false,
      canSummarize: false,
    },
    ...overrides,
    capabilities: {
      canAcceptPrompt: false,
      canReturnOutput: false,
      canReview: false,
      canExecute: false,
      canSummarize: false,
      ...(overrides.capabilities || {}),
    },
  };
}

test('route adapter resolves executable workbuddy transport without endpoint id special case', () => {
  const target = endpoint({
    id: 'custom-executor',
    label: 'Custom Executor',
    transport: 'workbuddy',
    capabilities: { canExecute: true, canAcceptPrompt: true, canReturnOutput: true },
  });
  const route = resolveConversationRouteAdapter(target);
  assert.equal(route.kind, 'workbuddy-execution');
  assert.equal(route.status, 'ready');
  assert.equal(route.adapter.id, 'workbuddy-execution');
});

test('route adapter resolves command review endpoints by transport and canReview', () => {
  const target = endpoint({
    id: 'custom-reviewer',
    label: 'Custom Reviewer',
    transport: 'command',
    capabilities: { canReview: true },
  });
  const route = resolveConversationRouteAdapter(target);
  assert.equal(route.kind, 'review-command');
  assert.equal(route.status, 'ready');
  assert.equal(route.adapter.id, 'review-command');
});

test('route adapter leaves managed pty non-auto-dispatchable', () => {
  const target = endpoint({
    id: 'codex-pty',
    label: 'Codex PTY',
    transport: 'managed-pty',
    capabilities: { canAcceptPrompt: true, canReturnOutput: true },
  });
  const route = resolveConversationRouteAdapter(target);
  assert.equal(route.kind, 'managed-pty');
  assert.equal(route.status, 'not-implemented');
  assert.equal(route.adapter, null);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node --experimental-strip-types --test tests/conversation-route-adapters.test.mjs
```

Expected: FAIL because `conversation-route-registry.ts` does not exist.

- [ ] **Step 3: Create adapter types**

Create `apps/local-server/src/conversation/conversation-route-adapter.ts`:

```ts
import type { IncomingMessage } from 'node:http';
import type { AgentEndpoint } from '../../../../packages/shared/src/types.ts';
import type { ConversationRouteKind, ConversationPairingStatus } from '../storage/conversation-pairing-store.ts';
import type { ConversationAction } from '../storage/conversation-action-store.ts';
import type { BridgeRuntime, BridgeResult } from '../routes/bridge-api.ts';

export interface ConversationRouteResolution {
  kind: ConversationRouteKind;
  status: ConversationPairingStatus;
  adapter: ConversationRouteAdapter | null;
}

export interface CreateConversationActionInput {
  runtime: BridgeRuntime;
  projectId: string;
  sourceEndpointId: string;
  targetEndpoint: AgentEndpoint;
  userEventId: string;
  bridgeEventId: string;
  text: string;
}

export interface ConfirmConversationActionInput {
  runtime: BridgeRuntime;
  action: ConversationAction;
}

export interface DispatchConversationActionInput {
  runtime: BridgeRuntime;
  action: ConversationAction;
  request: IncomingMessage;
}

export interface ConversationRouteAdapter {
  id: ConversationRouteKind;
  label: string;
  canHandleTarget(endpoint: AgentEndpoint): boolean;
  statusForTarget(endpoint: AgentEndpoint): ConversationPairingStatus;
  bridgeText(actionLabel: string): string;
  createAction(input: CreateConversationActionInput): ConversationAction | null;
  confirm(input: ConfirmConversationActionInput): BridgeResult;
  dispatch(input: DispatchConversationActionInput): Promise<BridgeResult> | BridgeResult;
}
```

- [ ] **Step 4: Create route registry**

Create `apps/local-server/src/conversation/conversation-route-registry.ts`:

```ts
import type { AgentEndpoint } from '../../../../packages/shared/src/types.ts';
import type {
  ConversationRouteAdapter,
  ConversationRouteResolution,
} from './conversation-route-adapter.ts';

function bridgeError(statusCode: number, message: string) {
  return { statusCode, payload: { status: 'error', message } };
}

const unsupportedAdapterMethods = {
  createAction() {
    return null;
  },
  confirm() {
    return bridgeError(409, 'Conversation route adapter is not implemented yet');
  },
  dispatch() {
    return bridgeError(409, 'Conversation route adapter is not implemented yet');
  },
};

const workbuddyExecutionAdapter: ConversationRouteAdapter = {
  id: 'workbuddy-execution',
  label: 'Execution task',
  canHandleTarget(endpoint) {
    return endpoint.transport === 'workbuddy' && !!endpoint.capabilities.canExecute;
  },
  statusForTarget() {
    return 'ready';
  },
  bridgeText(targetLabel) {
    return `${targetLabel} execution preview created.`;
  },
  ...unsupportedAdapterMethods,
};

const reviewCommandAdapter: ConversationRouteAdapter = {
  id: 'review-command',
  label: 'Review command',
  canHandleTarget(endpoint) {
    return endpoint.transport === 'command' && !!endpoint.capabilities.canReview;
  },
  statusForTarget() {
    return 'ready';
  },
  bridgeText(targetLabel) {
    return `${targetLabel} review preview created.`;
  },
  ...unsupportedAdapterMethods,
};

const adapters = [workbuddyExecutionAdapter, reviewCommandAdapter];

export function resolveConversationRouteAdapter(endpoint: AgentEndpoint): ConversationRouteResolution {
  const adapter = adapters.find(candidate => candidate.canHandleTarget(endpoint));
  if (adapter) {
    return { kind: adapter.id, status: adapter.statusForTarget(endpoint), adapter };
  }
  if (endpoint.transport === 'managed-pty' && endpoint.capabilities.canAcceptPrompt && endpoint.capabilities.canReturnOutput) {
    return { kind: 'managed-pty', status: 'not-implemented', adapter: null };
  }
  if (endpoint.transport === 'web-dom' && endpoint.capabilities.canAcceptPrompt && endpoint.capabilities.canReturnOutput) {
    return { kind: 'web-relay', status: 'needs-manual-confirmation', adapter: null };
  }
  return { kind: 'unavailable', status: 'not-implemented', adapter: null };
}
```

This implementation is deliberately non-dispatching so Task 1 proves id-based routing is removed while still typechecking. Task 2 replaces the stub method behavior with real adapter methods.

- [ ] **Step 5: Run focused tests**

```bash
node --experimental-strip-types --test tests/conversation-route-adapters.test.mjs
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/local-server/src/conversation/conversation-route-adapter.ts apps/local-server/src/conversation/conversation-route-registry.ts tests/conversation-route-adapters.test.mjs
git commit -m "feat: add conversation route adapter interfaces"
```

## Task 2: Real Route Adapter Implementations

**Files:**
- Modify: `apps/local-server/src/conversation/conversation-route-registry.ts`
- Test: `tests/conversation-route-adapters.test.mjs`

- [ ] **Step 1: Add adapter method tests**

Append to `tests/conversation-route-adapters.test.mjs`:

```js
import { createBridgeRuntime } from '../apps/local-server/src/routes/bridge-api.ts';

test('workbuddy adapter creates and dispatches a target-specific task', async () => {
  const runtime = createBridgeRuntime();
  const target = endpoint({
    id: 'custom-executor',
    label: 'Custom Executor',
    transport: 'workbuddy',
    capabilities: { canExecute: true, canAcceptPrompt: true, canReturnOutput: true },
  });
  runtime.endpointRegistry.register(target);
  const route = resolveConversationRouteAdapter(target);
  const action = route.adapter.createAction({
    runtime,
    projectId: 'cli-bridge',
    sourceEndpointId: 'chatgpt-web',
    targetEndpoint: target,
    userEventId: 'u1',
    bridgeEventId: 'b1',
    text: 'inspect this repository',
  });
  assert.equal(action.targetEndpointId, 'custom-executor');
  assert.equal(action.routeKind, 'workbuddy-execution');
  const confirmed = route.adapter.confirm({ runtime, action });
  assert.equal(confirmed.statusCode, 200);
  const dispatched = await route.adapter.dispatch({ runtime, action: confirmed.payload.action, request: {} });
  assert.equal(dispatched.statusCode, 200);
  assert.equal(dispatched.payload.task.endpointId, 'custom-executor');
});
```

- [ ] **Step 2: Run tests to verify failure**

```bash
node --experimental-strip-types --test tests/conversation-route-adapters.test.mjs
```

Expected: FAIL because skeletal adapters do not implement `createAction`, `confirm`, or `dispatch`.

- [ ] **Step 3: Implement real adapters**

Replace `apps/local-server/src/conversation/conversation-route-registry.ts` with:

```ts
import type { AgentEndpoint } from '../../../../packages/shared/src/types.ts';
import type { ConversationRouteResolution, ConversationRouteAdapter } from './conversation-route-adapter.ts';

function bridgeOk(payload: unknown) {
  return { statusCode: 200, payload };
}

function bridgeError(statusCode: number, message: string) {
  return { statusCode, payload: { status: 'error', message } };
}

const workbuddyExecutionAdapter: ConversationRouteAdapter = {
  id: 'workbuddy-execution',
  label: 'Execution task',
  canHandleTarget(endpoint) {
    return endpoint.transport === 'workbuddy' && !!endpoint.capabilities.canExecute;
  },
  statusForTarget() {
    return 'ready';
  },
  bridgeText(targetLabel) {
    return `${targetLabel} execution preview created. Auto-dispatch can queue this task from the local Console.`;
  },
  createAction(input) {
    return input.runtime.conversationActionStore.createPreview({
      projectId: input.projectId,
      sourceEndpointId: input.sourceEndpointId,
      targetEndpointId: input.targetEndpoint.id,
      routeKind: 'workbuddy-execution',
      userEventId: input.userEventId,
      bridgeEventId: input.bridgeEventId,
      text: input.text,
      preview: `${input.targetEndpoint.label} task preview`,
    });
  },
  confirm(input) {
    const confirmed = input.runtime.conversationActionStore.confirm(input.action.id);
    if (!confirmed) return bridgeError(409, 'Conversation action cannot be confirmed');
    input.runtime.persist();
    return bridgeOk({ action: confirmed });
  },
  dispatch(input) {
    if (input.action.status !== 'confirmed') return bridgeError(409, 'Conversation action must be confirmed before dispatch');
    const dispatching = input.runtime.conversationActionStore.markDispatching(input.action.id);
    if (!dispatching) return bridgeError(409, 'Conversation action cannot dispatch');
    const task = input.runtime.workbuddyExecution.enqueue({
      endpointId: input.action.targetEndpointId,
      proposalId: input.action.id,
      planId: `conversation:${input.action.projectId}`,
      goalId: `conversation:${input.action.projectId}`,
      bindingHash: input.action.textHash,
      prompt: input.action.preview,
      workingDirectory: process.cwd(),
      timeoutMs: 120_000,
    });
    const queued = input.runtime.conversationActionStore.markQueued(input.action.id, task.taskId);
    input.runtime.persist();
    return bridgeOk({ action: queued, task });
  },
};

const reviewCommandAdapter: ConversationRouteAdapter = {
  id: 'review-command',
  label: 'Review command',
  canHandleTarget(endpoint) {
    return endpoint.transport === 'command' && !!endpoint.capabilities.canReview;
  },
  statusForTarget() {
    return 'ready';
  },
  bridgeText(targetLabel) {
    return `${targetLabel} review preview created. Auto-dispatch can run this governed review from the local Console.`;
  },
  createAction(input) {
    const review = input.runtime.pendingReviewStore.createDraft({
      sessionId: `conversation:${input.projectId}`,
      sourceEndpointId: input.sourceEndpointId,
      targetEndpointId: input.targetEndpoint.id,
      prompt: input.text,
      projectId: input.projectId,
    });
    const previewed = input.runtime.pendingReviewStore.preview(review.id) ?? review;
    return input.runtime.conversationActionStore.createPreview({
      projectId: input.projectId,
      sourceEndpointId: input.sourceEndpointId,
      targetEndpointId: input.targetEndpoint.id,
      routeKind: 'review-command',
      userEventId: input.userEventId,
      bridgeEventId: input.bridgeEventId,
      text: input.text,
      preview: `${input.targetEndpoint.label} review preview`,
      linkedReviewId: previewed.id,
    });
  },
  confirm(input) {
    if (!input.action.linkedReviewId) return bridgeError(409, 'Conversation action has no linked review');
    const confirmedReview = input.runtime.pendingReviewStore.confirm(input.action.linkedReviewId);
    if (!confirmedReview) return bridgeError(409, 'Linked review cannot be confirmed');
    const confirmedAction = input.runtime.conversationActionStore.confirm(input.action.id);
    if (!confirmedAction) return bridgeError(409, 'Conversation action cannot be confirmed');
    input.runtime.persist();
    return bridgeOk({ action: confirmedAction, review: confirmedReview });
  },
  async dispatch(input) {
    return bridgeError(409, 'Review command auto-dispatch is implemented in Task 4');
  },
};

const adapters = [workbuddyExecutionAdapter, reviewCommandAdapter];

export function resolveConversationRouteAdapter(endpoint: AgentEndpoint): ConversationRouteResolution {
  const adapter = adapters.find(candidate => candidate.canHandleTarget(endpoint));
  if (adapter) {
    return { kind: adapter.id, status: adapter.statusForTarget(endpoint), adapter };
  }
  if (endpoint.transport === 'managed-pty' && endpoint.capabilities.canAcceptPrompt && endpoint.capabilities.canReturnOutput) {
    return { kind: 'managed-pty', status: 'not-implemented', adapter: null };
  }
  if (endpoint.transport === 'web-dom' && endpoint.capabilities.canAcceptPrompt && endpoint.capabilities.canReturnOutput) {
    return { kind: 'web-relay', status: 'needs-manual-confirmation', adapter: null };
  }
  return { kind: 'unavailable', status: 'not-implemented', adapter: null };
}
```

- [ ] **Step 4: Run focused tests**

```bash
node --experimental-strip-types --test tests/conversation-route-adapters.test.mjs
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/local-server/src/conversation/conversation-route-registry.ts tests/conversation-route-adapters.test.mjs
git commit -m "feat: add conversation route adapter registry"
```

## Task 3: Bridge API Uses Route Adapters

**Files:**
- Modify: `apps/local-server/src/routes/bridge-api.ts`
- Test: `tests/conversation-execution-api.test.mjs`

- [ ] **Step 1: Add route-generic API test**

Append to `tests/conversation-execution-api.test.mjs`:

```js
test('conversation routes custom workbuddy transport target through route adapter', async () => {
  const runtime = createBridgeRuntime();
  runtime.endpointRegistry.register({
    id: 'custom-executor',
    label: 'Custom Executor',
    transport: 'workbuddy',
    status: 'online',
    capabilities: { canAcceptPrompt: true, canReturnOutput: true, canReview: false, canExecute: true, canSummarize: false },
  });
  await call(runtime, 'PUT', '/bridge/projects/cli-bridge/conversation-pairing', {
    sourceEndpointId: 'chatgpt-web',
    targetEndpointId: 'custom-executor',
  });
  const created = await call(runtime, 'POST', '/bridge/projects/cli-bridge/conversation/messages', {
    text: 'inspect the repo through custom executor',
  });
  assert.equal(created.statusCode, 201);
  const action = created.payload.actions[0];
  assert.equal(action.targetEndpointId, 'custom-executor');
  assert.equal(action.routeKind, 'workbuddy-execution');
  const confirmed = await call(runtime, 'POST', `/bridge/projects/cli-bridge/conversation/actions/${action.id}/confirm`, {}, CONSOLE_AUTH);
  assert.equal(confirmed.statusCode, 200);
  const dispatched = await call(runtime, 'POST', `/bridge/projects/cli-bridge/conversation/actions/${action.id}/dispatch`, {}, CONSOLE_AUTH);
  assert.equal(dispatched.statusCode, 200);
  assert.equal(dispatched.payload.task.endpointId, 'custom-executor');
});
```

- [ ] **Step 2: Run test to verify current failure**

```bash
node --experimental-strip-types --test tests/conversation-execution-api.test.mjs
```

Expected: FAIL because `resolveConversationRouteKind()` still checks `endpoint.id === 'workbuddy'`.

- [ ] **Step 3: Replace route resolution in bridge API**

In `apps/local-server/src/routes/bridge-api.ts`:

1. Import:

```ts
import { resolveConversationRouteAdapter } from '../conversation/conversation-route-registry.ts';
```

2. Replace `resolveConversationRouteKind(endpoint)` body with:

```ts
function resolveConversationRouteKind(endpoint: AgentEndpoint): { kind: ConversationRouteKind; status: ConversationPairingStatus } {
  const route = resolveConversationRouteAdapter(endpoint);
  return { kind: route.kind, status: route.status };
}
```

3. In `POST /conversation/messages`, fetch the target endpoint and route adapter:

```ts
const targetEndpoint = runtime.endpointRegistry.get(pairing.targetEndpointId);
if (!targetEndpoint) return error(409, 'Conversation target endpoint is unavailable');
const route = resolveConversationRouteAdapter(targetEndpoint);
```

4. Replace route-specific action creation with:

```ts
const action = route.adapter?.createAction({
  runtime,
  projectId: key,
  sourceEndpointId: pairing.sourceEndpointId,
  targetEndpoint,
  userEventId: userEvent.id,
  bridgeEventId: bridgeEvent.id,
  text,
});
if (action) actions.push(action);
```

5. Replace route-specific bridge text with:

```ts
if (route.adapter) {
  bridgeStatus = 'awaiting-manual-confirmation';
  bridgeText = route.adapter.bridgeText(targetEndpoint.label || targetEndpoint.id);
} else if (pairing.targetRouteKind === 'managed-pty') {
  bridgeStatus = 'not-implemented';
  bridgeText = 'Managed PTY conversation dispatch is not implemented in this phase.';
} else if (pairing.targetRouteKind === 'web-relay') {
  bridgeStatus = 'awaiting-manual-confirmation';
  bridgeText = 'Web relay requires the existing manual confirmation flow.';
}
```

- [ ] **Step 4: Replace confirm/dispatch branches**

In the Conversation Actions route:

```ts
const targetEndpoint = runtime.endpointRegistry.get(action.targetEndpointId);
if (!targetEndpoint) return error(409, 'Conversation action target endpoint is unavailable');
const route = resolveConversationRouteAdapter(targetEndpoint);
if (!route.adapter || route.adapter.id !== action.routeKind) {
  return error(409, `Conversation action route ${action.routeKind} is not dispatchable`);
}

if (conversationActionPath.sub === 'confirm') {
  return route.adapter.confirm({ runtime, action });
}

if (conversationActionPath.sub === 'dispatch') {
  return await route.adapter.dispatch({ runtime, action, request });
}
```

- [ ] **Step 5: Run focused tests**

```bash
node --experimental-strip-types --test tests/conversation-route-adapters.test.mjs tests/conversation-execution-api.test.mjs
npm run typecheck
```

Expected: PASS except the review-command auto-dispatch behavior remains explicitly blocked until Task 4.

- [ ] **Step 6: Commit**

```bash
git add apps/local-server/src/routes/bridge-api.ts tests/conversation-execution-api.test.mjs
git commit -m "feat: route conversation actions through target adapters"
```

## Task 4: Review Command Adapter Dispatch

**Files:**
- Modify: `apps/local-server/src/storage/conversation-action-store.ts`
- Modify: `apps/local-server/src/conversation/conversation-route-registry.ts`
- Test: `tests/conversation-execution-api.test.mjs`

- [ ] **Step 1: Add review-command auto-dispatch test**

Append to `tests/conversation-execution-api.test.mjs`:

```js
test('conversation review-command target dispatches through review adapter', async () => {
  const runtime = createBridgeRuntime({
    reviewAdapterFor: () => ({
      adapterName: 'fake-review',
      command: 'fake-review',
      argv: [],
      run: async () => ({ summary: 'review ok', raw: 'review ok' }),
    }),
  });
  await call(runtime, 'PUT', '/bridge/projects/cli-bridge/conversation-pairing', {
    sourceEndpointId: 'chatgpt-web',
    targetEndpointId: 'claude-code-command',
  });
  const created = await call(runtime, 'POST', '/bridge/projects/cli-bridge/conversation/messages', {
    text: 'review this plan',
  });
  const action = created.payload.actions[0];
  const confirmed = await call(runtime, 'POST', `/bridge/projects/cli-bridge/conversation/actions/${action.id}/confirm`, {}, CONSOLE_AUTH);
  assert.equal(confirmed.statusCode, 200);
  const dispatched = await call(runtime, 'POST', `/bridge/projects/cli-bridge/conversation/actions/${action.id}/dispatch`, {}, CONSOLE_AUTH);
  assert.equal(dispatched.statusCode, 200);
  assert.equal(dispatched.payload.action.status, 'returned');
  assert.match(dispatched.payload.result.summary, /review ok/);
});
```

- [ ] **Step 2: Run test to verify failure**

```bash
node --experimental-strip-types --test tests/conversation-execution-api.test.mjs
```

Expected: FAIL because review-command adapter dispatch returns 409.

- [ ] **Step 3: Implement review adapter dispatch**

First add a returned transition to `apps/local-server/src/storage/conversation-action-store.ts`:

```ts
  markReturned(actionId: string, linkedReviewId: string, now: number = Date.now()): ConversationAction | undefined {
    const action = this.actions.get(actionId);
    if (!action || action.status !== 'dispatching') return undefined;
    action.status = 'returned';
    action.linkedReviewId = linkedReviewId;
    action.updatedAt = now;
    this.actions.set(action.id, clone(action));
    return clone(action);
  }
```

In `reviewCommandAdapter.dispatch`, run the existing review command path by using the same primitives as `/bridge/reviews/dispatch`:

```ts
import { runCommandReview } from '../review/command-review-runner.ts';
import { buildClaudeReviewPrompt } from '../review/claude-review-prompt.ts';

async dispatch(input) {
  if (input.action.status !== 'confirmed') return bridgeError(409, 'Conversation action must be confirmed before dispatch');
  if (!input.action.linkedReviewId) return bridgeError(409, 'Conversation action has no linked review');
  const review = input.runtime.pendingReviewStore.get(input.action.linkedReviewId);
  if (!review || review.status !== 'confirmed') return bridgeError(409, 'Linked review must be confirmed');
  const adapter = input.runtime.reviewAdapterFor(review.targetEndpointId);
  if (!adapter) return bridgeError(409, 'Review target is not a runnable command endpoint');
  const sent = input.runtime.pendingReviewStore.sendConfirmed(review.id);
  if (!sent.ok) return bridgeError(409, sent.failureReason ?? 'Review cannot be sent');
  const dispatching = input.runtime.conversationActionStore.markDispatching(input.action.id);
  if (!dispatching) return bridgeError(409, 'Conversation action cannot dispatch');
  const runResult = await runCommandReview(
    input.runtime.pendingReviewStore,
    input.runtime.auditLog,
    adapter,
    {
      reviewId: review.id,
      prompt: buildClaudeReviewPrompt({ codexOutput: review.prompt }),
    },
  );
  if (!runResult.ok) return bridgeError(500, runResult.failureReason ?? 'review-run-failed');
  const returnedAction = input.runtime.conversationActionStore.markReturned(input.action.id, review.id);
  input.runtime.persist();
  return bridgeOk({
    action: returnedAction,
    review: runResult.returned?.review,
    result: runResult.returned?.result,
    nextPrompt: runResult.returned?.nextPrompt,
  });
}
```

- [ ] **Step 4: Run focused tests**

```bash
node --experimental-strip-types --test tests/conversation-route-adapters.test.mjs tests/conversation-execution-api.test.mjs tests/bridge-reviews-api.test.mjs
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/local-server/src/storage/conversation-action-store.ts apps/local-server/src/conversation/conversation-route-registry.ts tests/conversation-execution-api.test.mjs
git commit -m "feat: dispatch review conversation actions through adapter"
```

## Task 5: Project Console Route Labels

**Files:**
- Modify: `apps/local-server/src/routes/project-console.ts`
- Test: `tests/project-console-behavior.test.mjs`

- [ ] **Step 1: Add route label tests**

Add to `tests/project-console-behavior.test.mjs`:

```js
test('pairing target labels use route capability instead of workbuddy id', async () => {
  const { document, setFixture } = setupConsole();
  setFixture('/bridge/endpoints', {
    ok: true,
    payload: {
      endpoints: [
        {
          id: 'chatgpt-web',
          label: 'ChatGPT Web',
          transport: 'web-dom',
          status: 'online',
          capabilities: { canAcceptPrompt: true, canReturnOutput: true, canReview: false, canExecute: false, canSummarize: false },
        },
        {
          id: 'custom-executor',
          label: 'Custom Executor',
          transport: 'workbuddy',
          status: 'online',
          capabilities: { canAcceptPrompt: true, canReturnOutput: true, canReview: false, canExecute: true, canSummarize: false },
        },
      ],
    },
  });
  setFixture('/bridge/projects/cli-bridge/conversation-pairing', { ok: true, payload: { pairing: null } });
  document.getElementById('token').value = 'test';
  document.getElementById('connect').click();
  await waitFor(() => document.getElementById('conn-dot').classList.contains('ok'));
  document.getElementById('composer-pairing').click();
  await waitFor(() => document.getElementById('conversation-target'));
  assert.match(document.getElementById('conversation-target').textContent, /custom-executor/);
  assert.match(document.getElementById('conversation-target').textContent, /workbuddy-execution/);
});
```

- [ ] **Step 2: Run test to verify failure**

```bash
node --experimental-strip-types --test tests/project-console-behavior.test.mjs
```

Expected: FAIL because client route label still checks `endpoint.id === 'workbuddy'`.

- [ ] **Step 3: Update client route labels**

In `apps/local-server/src/routes/project-console.ts`, replace:

```js
if (endpoint.id === 'workbuddy' && caps.canExecute) return { kind: 'workbuddy-execution', status: 'ready' };
```

with:

```js
if (endpoint.transport === 'workbuddy' && caps.canExecute) return { kind: 'workbuddy-execution', status: 'ready' };
```

Replace hard-coded preview wording in UI tests with target endpoint label wording.

- [ ] **Step 4: Run focused tests**

```bash
node --experimental-strip-types --test tests/project-console-behavior.test.mjs tests/project-console-conversation-execution.test.mjs
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/local-server/src/routes/project-console.ts tests/project-console-behavior.test.mjs
git commit -m "fix: label conversation targets by route capability"
```

## Task 6: Browser Acceptance

**Files:**
- Test only unless defects are found.

- [ ] **Step 1: Run full gates**

```bash
npm run typecheck
npm run lint
node --experimental-strip-types --test tests/conversation-route-adapters.test.mjs tests/conversation-execution-api.test.mjs tests/project-console-behavior.test.mjs tests/project-console-conversation-execution.test.mjs tests/project-console-ui.test.mjs
npm test
git diff --check
```

Expected: all pass.

- [ ] **Step 2: Run browser acceptance**

Run a Chromium acceptance equivalent to:

1. Start local server on `127.0.0.1:31337`.
2. Open `/console/project`.
3. Confirm auto-pair works.
4. Register or use a non-`workbuddy` endpoint with `transport: workbuddy` and `canExecute: true`.
5. Save Conversation pairing to `chatgpt-web -> custom-executor`.
6. Confirm UI shows `custom-executor` as `workbuddy-execution`.
7. Send a Conversation message.
8. Confirm action auto-dispatches without manual button clicks.
9. Confirm WorkBuddy inbox claim returns a task with `endpointId: custom-executor`.
10. Confirm extension token cannot confirm/dispatch actions.
11. Confirm URL, visible DOM, localStorage, and committed artifacts contain no raw pairing token.

- [ ] **Step 3: Commit acceptance note only if required**

Do not commit screenshots or token-bearing artifacts. If an acceptance note is needed, store only hashes and route ids.

## Acceptance Criteria

- No endpoint id special case is required for executable Conversation targets.
- Conversation routing follows the saved pairing target endpoint.
- Auto-dispatch remains generic over actions.
- WorkBuddy transport targets dispatch to their own `endpointId`.
- Review command targets can dispatch through the review adapter.
- Managed PTY and web relay remain non-auto-dispatch routes.
- Extension and ChatGPT cannot confirm or dispatch actions.
- No generic shell/run/exec/Git/PR route is introduced.
- Full tests and browser acceptance pass.

## Execution Recommendation

Use Subagent-Driven execution after ADR-0027 acceptance:

1. Task 0 inline by reviewing agent.
2. Tasks 1-2 by a route-adapter agent.
3. Task 3 by a bridge API agent.
4. Task 4 by a review adapter agent.
5. Task 5 by a Console UI agent.
6. Task 6 by the reviewing agent with browser evidence.

Do not execute implementation before ADR-0027 is explicitly accepted.
