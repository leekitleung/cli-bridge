# Passthrough Route Plane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Project Conversation from a direct paired relay into a stateful route plane where user-visible answers are executor-authored passthrough output and planner/instruction/route internals stay hidden.

**Architecture:** CLI Bridge remains a stateful control-plane router and passthrough data-plane, not an agent or semantic synthesis layer. The rollout adds transcript visibility, instruction packets, execution packets, and a single-mode task route adapter in four small phases while preserving the current conversation-pairing behavior. Multi-executor parallel and fallback modes are explicitly deferred until the single route plane is proven.

**Tech Stack:** TypeScript local server, existing Conversation stores, existing WorkBuddy inbox/result protocol, existing JSON snapshot persistence, self-contained Project Console HTML, Node test runner with jsdom.

---

## Boundary Statement

CLI Bridge is a stateful control-plane router and passthrough data-plane.
It does not act as an agent, planner, reviewer, or reasoning pipeline.
It coordinates authenticated sessions, endpoint routing, lifecycle state,
queues, retries, idempotency, audit metadata, visibility filtering, and
safe transcript rendering.
It does not semantically interpret, summarize, rank, rewrite, or synthesize
executor results.

## Passthrough Definition

User-visible answer body must be derived from executor-emitted fields only.
The bridge may apply protocol rendering, safety redaction, delimiter wrapping,
field selection, and transport normalization. The bridge must not author
semantic conclusions.

Allowed:

- Extract `stdout`, `rawOutput`, `output`, or `result.text`.
- Wrap outputs with endpoint delimiters.
- Redact token or credential material.
- Normalize newlines, encoding, and ANSI sequences.
- Truncate oversized logs only when marked as system status and linked to an artifact.

Forbidden:

- Summarize executor output.
- Explain failures unless the failure text came from the executor.
- Rank executor outputs.
- Merge multiple executor outputs into a semantic final answer.
- Emit a bridge-authored final answer.

## Current Gap

Current Project Conversation is still a paired relay:

```text
sourceEndpointId -> targetEndpointId
```

The target route adapter creates a conversation action and, for WorkBuddy,
enqueues a task in the existing pull inbox. This proves the transport path, but
it does not yet model:

- hidden instruction packets;
- route state separate from instruction state;
- execution packets separate from transcript events;
- visibility-controlled transcript rendering;
- a future path to planner(s) -> executor(s) without exposing planner output.

## Target Incremental Shape

```text
conversation message
  -> InstructionPacket visibility=internal
  -> TaskRoute mode=single visibility=internal
  -> existing target endpoint
  -> ExecutionPacket
  -> TranscriptEvent kind=executor_output visibility=user
```

## Non-Goals

- No parallel execution mode in this rollout.
- No fallback execution mode in this rollout.
- No generic `/exec`, `/run`, `/shell`, Git, PR, or workspace mutation endpoint.
- No extension-side route selection.
- No extension authority to confirm, dispatch, run loops, or create high-risk mutations.
- No planner output in user transcript.
- No semantic synthesis, summary, ranking, or bridge-authored final answer.

## File Structure

Create:

- `docs/planning/ADR-0029-passthrough-route-plane.md`
  - Records the control-plane/data-plane boundary, visibility model, and rollout order.

- `apps/local-server/src/storage/conversation-instruction-store.ts`
  - Stores internal instruction packets derived from conversation messages.

- `apps/local-server/src/storage/conversation-execution-store.ts`
  - Stores executor-returned execution packets before user transcript rendering.

- `apps/local-server/src/storage/conversation-route-store.ts`
  - Stores task route state for `mode: "single"`.

- `tests/conversation-visibility.test.mjs`
  - Contract tests for transcript visibility and no-internal-leak rules.

- `tests/conversation-route-plane.test.mjs`
  - Contract tests for instruction packet, task route, execution packet, and transcript output flow.

Modify:

- `apps/local-server/src/storage/conversation-transcript-store.ts`
  - Add `kind` and `visibility` fields while hydrating legacy events safely.

- `apps/local-server/src/storage/json-snapshot-store.ts`
  - Persist instruction packets, task routes, and execution packets.

- `apps/local-server/src/routes/bridge-api.ts`
  - Create instruction packets on conversation messages.
  - Create single task routes before dispatch.
  - Convert WorkBuddy results into execution packets and then user-visible transcript output.
  - Keep current route adapter behavior available during migration.

- `apps/local-server/src/routes/project-console.ts`
  - Render only `visibility: "user"` transcript events.
  - Keep status events short and non-semantic.
  - Never render instruction, route id, action id, task id, or endpoint secret.

- `tests/conversation-execution-api.test.mjs`
  - Update existing WorkBuddy result tests to assert execution packet creation.

- `tests/project-console-behavior.test.mjs`
  - Assert hidden internals stay hidden and only user-visible events render.

Do not modify:

- Pairing token generation.
- Local auto-pair extension claim flow.
- Generic shell/exec/run policies.
- Existing WorkBuddy pull protocol URL shape.

## Data Model

### Transcript Fields

Extend `ConversationTranscriptEvent`:

```ts
export type ConversationTranscriptVisibility = 'user' | 'internal';

export type ConversationTranscriptKind =
  | 'user_message'
  | 'instruction'
  | 'status'
  | 'executor_output';

export interface ConversationTranscriptEvent {
  id: string;
  projectId: string;
  pairingId: string;
  role: 'user' | 'bridge' | 'target';
  text: string;
  status: 'draft' | 'queued' | 'awaiting-manual-confirmation' | 'returned' | 'failed' | 'not-implemented';
  routeKind: ConversationRouteKind;
  kind: ConversationTranscriptKind;
  visibility: ConversationTranscriptVisibility;
  endpointId?: string;
  createdAt: number;
}
```

Legacy hydration rule:

```ts
kind = role === 'user' ? 'user_message'
  : role === 'target' ? 'executor_output'
  : 'status';
visibility = role === 'bridge' && status === 'awaiting-manual-confirmation'
  ? 'internal'
  : 'user';
```

### Instruction Packet

```ts
export interface ConversationInstructionPacket {
  id: string;
  projectId: string;
  sessionId: string;
  sourceEndpointId: string;
  plannerEndpointId?: string;
  userEventId: string;
  payload: string;
  payloadHash: string;
  visibility: 'internal';
  createdAt: number;
}
```

### Task Route

```ts
export type ConversationTaskRouteStatus =
  | 'created'
  | 'queued'
  | 'dispatched'
  | 'running'
  | 'returned'
  | 'failed'
  | 'canceled';

export interface ConversationTaskRoute {
  id: string;
  instructionId: string;
  sessionId: string;
  mode: 'single';
  plannerEndpointIds: string[];
  executorEndpointIds: string[];
  selectedExecutorId: string;
  fallbackExecutorIds: string[];
  status: ConversationTaskRouteStatus;
  visibility: 'internal';
  createdAt: number;
  updatedAt: number;
}
```

### Execution Packet

```ts
export interface ConversationExecutionPacket {
  id: string;
  routeId: string;
  instructionId: string;
  executorEndpointId: string;
  status: 'returned' | 'failed';
  rawOutput?: string;
  stdout?: string;
  stderr?: string;
  output?: unknown;
  failureReason?: string;
  createdAt: number;
}
```

## Task 0: ADR-0029 Boundary

**Files:**
- Create: `docs/planning/ADR-0029-passthrough-route-plane.md`

- [ ] **Step 1: Create ADR-0029**

Create `docs/planning/ADR-0029-passthrough-route-plane.md`:

```md
# ADR-0029: Passthrough Route Plane

Status: Proposed

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
```

- [ ] **Step 2: Verify ADR phrases**

Run:

```bash
rg -n "Status: Proposed|stateful control-plane router|passthrough data-plane|mode: single|No instruction packet enters user transcript" docs/planning/ADR-0029-passthrough-route-plane.md
```

Expected: all phrases present.

- [ ] **Step 3: Commit**

```bash
git add docs/planning/ADR-0029-passthrough-route-plane.md
git commit -m "docs: propose passthrough route plane boundary"
```

## Task 1: Transcript Visibility Model

**Files:**
- Modify: `apps/local-server/src/storage/conversation-transcript-store.ts`
- Modify: `apps/local-server/src/storage/json-snapshot-store.ts`
- Test: `tests/conversation-visibility.test.mjs`
- Test: `tests/project-console-behavior.test.mjs`

- [ ] **Step 1: Add failing visibility tests**

Create `tests/conversation-visibility.test.mjs`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { InMemoryConversationTranscriptStore } from '../apps/local-server/src/storage/conversation-transcript-store.ts';

test('new transcript events preserve explicit kind and visibility', () => {
  const store = new InMemoryConversationTranscriptStore();
  const event = store.append({
    projectId: 'cli-bridge',
    pairingId: 'chatgpt-web->workbuddy',
    role: 'bridge',
    text: 'WorkBuddy task preview',
    status: 'queued',
    routeKind: 'workbuddy-execution',
    kind: 'instruction',
    visibility: 'internal',
    endpointId: 'workbuddy',
  });

  assert.equal(event.kind, 'instruction');
  assert.equal(event.visibility, 'internal');
  assert.equal(event.endpointId, 'workbuddy');
});

test('legacy bridge confirmation events hydrate as internal status', () => {
  const store = new InMemoryConversationTranscriptStore();
  store.hydrateEvent({
    id: 'legacy-bridge',
    projectId: 'cli-bridge',
    pairingId: 'chatgpt-web->workbuddy',
    role: 'bridge',
    text: 'WorkBuddy preview created',
    status: 'awaiting-manual-confirmation',
    routeKind: 'workbuddy-execution',
    createdAt: 1,
  });

  const event = store.listByProject('cli-bridge')[0];
  assert.equal(event.kind, 'status');
  assert.equal(event.visibility, 'internal');
});

test('legacy target events hydrate as user-visible executor output', () => {
  const store = new InMemoryConversationTranscriptStore();
  store.hydrateEvent({
    id: 'legacy-target',
    projectId: 'cli-bridge',
    pairingId: 'chatgpt-web->workbuddy',
    role: 'target',
    text: 'done',
    status: 'returned',
    routeKind: 'workbuddy-execution',
    createdAt: 1,
  });

  const event = store.listByProject('cli-bridge')[0];
  assert.equal(event.kind, 'executor_output');
  assert.equal(event.visibility, 'user');
});
```

- [ ] **Step 2: Run failing test**

Run:

```bash
node --experimental-strip-types --test tests/conversation-visibility.test.mjs
```

Expected: FAIL because `kind` and `visibility` are not yet modeled.

- [ ] **Step 3: Implement transcript fields**

Modify `apps/local-server/src/storage/conversation-transcript-store.ts`:

```ts
export type ConversationTranscriptVisibility = 'user' | 'internal';

export type ConversationTranscriptKind =
  | 'user_message'
  | 'instruction'
  | 'status'
  | 'executor_output';

export interface ConversationTranscriptEvent {
  id: string;
  projectId: string;
  pairingId: string;
  role: 'user' | 'bridge' | 'target';
  text: string;
  status: 'draft' | 'queued' | 'awaiting-manual-confirmation' | 'returned' | 'failed' | 'not-implemented';
  routeKind: ConversationRouteKind;
  kind: ConversationTranscriptKind;
  visibility: ConversationTranscriptVisibility;
  endpointId?: string;
  createdAt: number;
}

function normalizeEvent(event: ConversationTranscriptEvent | Omit<ConversationTranscriptEvent, 'kind' | 'visibility'>): ConversationTranscriptEvent {
  const kind = 'kind' in event && event.kind
    ? event.kind
    : event.role === 'user'
      ? 'user_message'
      : event.role === 'target'
        ? 'executor_output'
        : 'status';
  const visibility = 'visibility' in event && event.visibility
    ? event.visibility
    : event.role === 'bridge' && event.status === 'awaiting-manual-confirmation'
      ? 'internal'
      : 'user';
  return { ...event, kind, visibility } as ConversationTranscriptEvent;
}
```

Use `normalizeEvent()` in both `append()` and `hydrateEvent()` before storing.

- [ ] **Step 4: Update Project Console rendering**

Modify `renderConversationTranscript()` in `apps/local-server/src/routes/project-console.ts` so it filters first:

```js
const visibleEvents = events.filter(event => event.visibility !== 'internal');
```

Keep the existing preview/action hiding as a fallback for legacy events.

- [ ] **Step 5: Add UI leak assertion**

Add this assertion to the existing conversation auto-dispatch test in `tests/project-console-behavior.test.mjs`:

```js
assert.equal(document.getElementById('conversation-transcript').textContent.includes('task preview'), false);
assert.equal(document.getElementById('conversation-transcript').textContent.includes('Confirm'), false);
assert.equal(document.getElementById('conversation-transcript').textContent.includes('Dispatch'), false);
```

- [ ] **Step 6: Verify**

Run:

```bash
node --experimental-strip-types --test tests/conversation-visibility.test.mjs tests/project-console-behavior.test.mjs
npm run typecheck
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add apps/local-server/src/storage/conversation-transcript-store.ts apps/local-server/src/routes/project-console.ts tests/conversation-visibility.test.mjs tests/project-console-behavior.test.mjs
git commit -m "feat: add conversation transcript visibility"
```

## Task 2: Instruction Packet Store

**Files:**
- Create: `apps/local-server/src/storage/conversation-instruction-store.ts`
- Modify: `apps/local-server/src/routes/bridge-api.ts`
- Modify: `apps/local-server/src/storage/json-snapshot-store.ts`
- Test: `tests/conversation-route-plane.test.mjs`

- [ ] **Step 1: Add failing instruction packet tests**

Create `tests/conversation-route-plane.test.mjs`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { createBridgeRuntime, handleBridgeRequest } from '../apps/local-server/src/routes/bridge-api.ts';

function jsonRequest(body) {
  const text = body === undefined ? '' : JSON.stringify(body);
  async function* gen() {
    if (text.length > 0) yield Buffer.from(text, 'utf8');
  }
  return gen();
}

async function call(runtime, method, path, body, authContext) {
  return handleBridgeRequest(runtime, method, path, jsonRequest(body), undefined, authContext);
}

test('conversation message creates internal instruction packet', async () => {
  const runtime = createBridgeRuntime();
  await call(runtime, 'PUT', '/bridge/projects/cli-bridge/conversation-pairing', {
    sourceEndpointId: 'chatgpt-web',
    targetEndpointId: 'workbuddy',
  });

  const res = await call(runtime, 'POST', '/bridge/projects/cli-bridge/conversation/messages', {
    text: 'inspect the project',
  });

  assert.equal(res.statusCode, 201);
  const packets = runtime.conversationInstructionStore.listByProject('cli-bridge');
  assert.equal(packets.length, 1);
  assert.equal(packets[0].payload, 'inspect the project');
  assert.equal(packets[0].sourceEndpointId, 'chatgpt-web');
  assert.equal(packets[0].visibility, 'internal');
  assert.match(packets[0].payloadHash, /^sha256:/);
});
```

- [ ] **Step 2: Run failing test**

Run:

```bash
node --experimental-strip-types --test tests/conversation-route-plane.test.mjs
```

Expected: FAIL because `conversationInstructionStore` does not exist.

- [ ] **Step 3: Implement instruction store**

Create `apps/local-server/src/storage/conversation-instruction-store.ts`:

```ts
import { createHash, randomUUID } from 'node:crypto';

export interface ConversationInstructionPacket {
  id: string;
  projectId: string;
  sessionId: string;
  sourceEndpointId: string;
  plannerEndpointId?: string;
  userEventId: string;
  payload: string;
  payloadHash: string;
  visibility: 'internal';
  createdAt: number;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function hashPayload(payload: string): string {
  return `sha256:${createHash('sha256').update(payload).digest('hex')}`;
}

export class InMemoryConversationInstructionStore {
  private readonly packets = new Map<string, ConversationInstructionPacket>();

  create(input: {
    projectId: string;
    sessionId: string;
    sourceEndpointId: string;
    plannerEndpointId?: string;
    userEventId: string;
    payload: string;
    now?: number;
  }): ConversationInstructionPacket {
    const packet: ConversationInstructionPacket = {
      id: randomUUID(),
      projectId: input.projectId,
      sessionId: input.sessionId,
      sourceEndpointId: input.sourceEndpointId,
      plannerEndpointId: input.plannerEndpointId,
      userEventId: input.userEventId,
      payload: input.payload,
      payloadHash: hashPayload(input.payload),
      visibility: 'internal',
      createdAt: input.now ?? Date.now(),
    };
    this.packets.set(packet.id, clone(packet));
    return clone(packet);
  }

  get(id: string): ConversationInstructionPacket | undefined {
    const packet = this.packets.get(id);
    return packet ? clone(packet) : undefined;
  }

  listByProject(projectId: string): ConversationInstructionPacket[] {
    return Array.from(this.packets.values())
      .filter(packet => packet.projectId === projectId)
      .sort((a, b) => a.createdAt - b.createdAt)
      .map(clone);
  }

  hydratePacket(packet: ConversationInstructionPacket): void {
    if (!packet || typeof packet.id !== 'string' || packet.visibility !== 'internal') return;
    this.packets.set(packet.id, clone(packet));
  }

  exportPackets(): ConversationInstructionPacket[] {
    return Array.from(this.packets.values(), clone);
  }
}
```

- [ ] **Step 4: Wire runtime and persistence**

Modify `apps/local-server/src/routes/bridge-api.ts`:

```ts
import { InMemoryConversationInstructionStore } from '../storage/conversation-instruction-store.ts';
```

Add to `BridgeRuntime`:

```ts
conversationInstructionStore: InMemoryConversationInstructionStore;
```

Instantiate in `createBridgeRuntime()`:

```ts
const conversationInstructionStore = new InMemoryConversationInstructionStore();
```

Return it on the runtime object and hydrate/export it through `json-snapshot-store.ts` using the existing conversation action persistence pattern.

- [ ] **Step 5: Create packet on conversation message**

In `POST /bridge/projects/:key/conversation/messages`, after `userEvent` is created:

```ts
const instruction = runtime.conversationInstructionStore.create({
  projectId: key,
  sessionId: `conversation:${key}`,
  sourceEndpointId: pairing.sourceEndpointId,
  userEventId: userEvent.id,
  payload: text,
});
```

Do not return `instruction` from the API response.

- [ ] **Step 6: Assert instruction is not returned**

Extend the test:

```js
assert.equal(JSON.stringify(res.payload).includes('inspect the project'), true);
assert.equal(JSON.stringify(res.payload).includes('payloadHash'), false);
assert.equal(JSON.stringify(res.payload).includes('instr_'), false);
```

The text may appear in the user message event; the internal packet metadata must not.

- [ ] **Step 7: Verify**

Run:

```bash
node --experimental-strip-types --test tests/conversation-route-plane.test.mjs tests/json-persistence.test.mjs
npm run typecheck
```

Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add apps/local-server/src/storage/conversation-instruction-store.ts apps/local-server/src/routes/bridge-api.ts apps/local-server/src/storage/json-snapshot-store.ts tests/conversation-route-plane.test.mjs tests/json-persistence.test.mjs
git commit -m "feat: add internal conversation instruction packets"
```

## Task 3: Execution Packet Store

**Files:**
- Create: `apps/local-server/src/storage/conversation-execution-store.ts`
- Modify: `apps/local-server/src/routes/bridge-api.ts`
- Modify: `apps/local-server/src/storage/json-snapshot-store.ts`
- Test: `tests/conversation-route-plane.test.mjs`

- [ ] **Step 1: Add failing execution packet test**

Append to `tests/conversation-route-plane.test.mjs`:

```js
const CONSOLE_AUTH = { kind: 'console-cookie' };

test('workbuddy result creates execution packet before transcript output', async () => {
  const runtime = createBridgeRuntime();
  await call(runtime, 'PUT', '/bridge/projects/cli-bridge/conversation-pairing', {
    sourceEndpointId: 'chatgpt-web',
    targetEndpointId: 'workbuddy',
  });
  const created = await call(runtime, 'POST', '/bridge/projects/cli-bridge/conversation/messages', {
    text: 'return a raw answer',
  });
  const action = created.payload.actions[0];
  await call(runtime, 'POST', `/bridge/projects/cli-bridge/conversation/actions/${action.id}/confirm`, {}, CONSOLE_AUTH);
  const dispatched = await call(runtime, 'POST', `/bridge/projects/cli-bridge/conversation/actions/${action.id}/dispatch`, {}, CONSOLE_AUTH);
  await call(runtime, 'GET', '/bridge/endpoints/workbuddy/inbox/next');

  const returned = await call(runtime, 'POST', '/bridge/endpoints/workbuddy/results', {
    taskId: dispatched.payload.task.taskId,
    ok: true,
    stdout: 'raw executor output',
    exitCode: 0,
    durationMs: 5,
  });

  assert.equal(returned.statusCode, 200);
  const packets = runtime.conversationExecutionStore.listByProject('cli-bridge');
  assert.equal(packets.length, 1);
  assert.equal(packets[0].rawOutput, 'raw executor output');
  assert.equal(packets[0].executorEndpointId, 'workbuddy');
  assert.equal(returned.payload.event.kind, 'executor_output');
  assert.equal(returned.payload.event.visibility, 'user');
  assert.equal(returned.payload.event.text, 'raw executor output');
});
```

- [ ] **Step 2: Run failing test**

Run:

```bash
node --experimental-strip-types --test tests/conversation-route-plane.test.mjs
```

Expected: FAIL because `conversationExecutionStore` does not exist.

- [ ] **Step 3: Implement execution store**

Create `apps/local-server/src/storage/conversation-execution-store.ts`:

```ts
import { randomUUID } from 'node:crypto';

export interface ConversationExecutionPacket {
  id: string;
  projectId: string;
  routeId?: string;
  instructionId?: string;
  executorEndpointId: string;
  status: 'returned' | 'failed';
  rawOutput?: string;
  stdout?: string;
  stderr?: string;
  output?: unknown;
  failureReason?: string;
  createdAt: number;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class InMemoryConversationExecutionStore {
  private readonly packets = new Map<string, ConversationExecutionPacket>();

  create(input: Omit<ConversationExecutionPacket, 'id' | 'createdAt'> & { now?: number }): ConversationExecutionPacket {
    const packet: ConversationExecutionPacket = {
      ...input,
      id: randomUUID(),
      createdAt: input.now ?? Date.now(),
    };
    this.packets.set(packet.id, clone(packet));
    return clone(packet);
  }

  listByProject(projectId: string): ConversationExecutionPacket[] {
    return Array.from(this.packets.values())
      .filter(packet => packet.projectId === projectId)
      .sort((a, b) => a.createdAt - b.createdAt)
      .map(clone);
  }

  hydratePacket(packet: ConversationExecutionPacket): void {
    if (!packet || typeof packet.id !== 'string' || typeof packet.projectId !== 'string') return;
    this.packets.set(packet.id, clone(packet));
  }

  exportPackets(): ConversationExecutionPacket[] {
    return Array.from(this.packets.values(), clone);
  }
}
```

- [ ] **Step 4: Wire runtime and persistence**

Add `conversationExecutionStore` to `BridgeRuntime`, instantiate it, hydrate it,
and export it through `json-snapshot-store.ts` using the same pattern as
conversation actions.

- [ ] **Step 5: Create execution packet on WorkBuddy results**

In `POST /bridge/endpoints/:id/results`, inside the conversation action branch:

```ts
const execution = runtime.conversationExecutionStore.create({
  projectId: conversationAction.projectId,
  executorEndpointId: conversationAction.targetEndpointId,
  status: outcomeOk ? 'returned' : 'failed',
  rawOutput: formatWorkBuddyConversationResult(result.output, result.stdout),
  stdout: result.stdout,
  stderr: result.stderr,
  output: result.output,
  failureReason: result.failureReason,
});
```

Use `execution.rawOutput` for the user-visible transcript event text.

- [ ] **Step 6: Verify**

Run:

```bash
node --experimental-strip-types --test tests/conversation-route-plane.test.mjs tests/conversation-execution-api.test.mjs tests/json-persistence.test.mjs
npm run typecheck
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add apps/local-server/src/storage/conversation-execution-store.ts apps/local-server/src/routes/bridge-api.ts apps/local-server/src/storage/json-snapshot-store.ts tests/conversation-route-plane.test.mjs tests/conversation-execution-api.test.mjs tests/json-persistence.test.mjs
git commit -m "feat: add conversation execution packets"
```

## Task 4: Single Task Route Store

**Files:**
- Create: `apps/local-server/src/storage/conversation-route-store.ts`
- Modify: `apps/local-server/src/conversation/conversation-route-adapter.ts`
- Modify: `apps/local-server/src/conversation/conversation-route-registry.ts`
- Modify: `apps/local-server/src/routes/bridge-api.ts`
- Modify: `apps/local-server/src/storage/json-snapshot-store.ts`
- Test: `tests/conversation-route-plane.test.mjs`

- [ ] **Step 1: Add failing route lifecycle test**

Append to `tests/conversation-route-plane.test.mjs`:

```js
test('conversation dispatch creates a single internal task route', async () => {
  const runtime = createBridgeRuntime();
  await call(runtime, 'PUT', '/bridge/projects/cli-bridge/conversation-pairing', {
    sourceEndpointId: 'chatgpt-web',
    targetEndpointId: 'workbuddy',
  });
  const created = await call(runtime, 'POST', '/bridge/projects/cli-bridge/conversation/messages', {
    text: 'route this once',
  });
  const instruction = runtime.conversationInstructionStore.listByProject('cli-bridge')[0];
  const action = created.payload.actions[0];
  await call(runtime, 'POST', `/bridge/projects/cli-bridge/conversation/actions/${action.id}/confirm`, {}, CONSOLE_AUTH);
  const dispatched = await call(runtime, 'POST', `/bridge/projects/cli-bridge/conversation/actions/${action.id}/dispatch`, {}, CONSOLE_AUTH);

  const routes = runtime.conversationRouteStore.listByProject('cli-bridge');
  assert.equal(routes.length, 1);
  assert.equal(routes[0].instructionId, instruction.id);
  assert.equal(routes[0].mode, 'single');
  assert.equal(routes[0].selectedExecutorId, 'workbuddy');
  assert.equal(routes[0].status, 'dispatched');
  assert.equal(routes[0].visibility, 'internal');
  assert.equal(JSON.stringify(dispatched.payload).includes(routes[0].id), false);
});
```

- [ ] **Step 2: Run failing test**

Run:

```bash
node --experimental-strip-types --test tests/conversation-route-plane.test.mjs
```

Expected: FAIL because `conversationRouteStore` does not exist.

- [ ] **Step 3: Implement route store**

Create `apps/local-server/src/storage/conversation-route-store.ts`:

```ts
import { randomUUID } from 'node:crypto';

export type ConversationTaskRouteStatus =
  | 'created'
  | 'queued'
  | 'dispatched'
  | 'running'
  | 'returned'
  | 'failed'
  | 'canceled';

export interface ConversationTaskRoute {
  id: string;
  projectId: string;
  instructionId: string;
  sessionId: string;
  mode: 'single';
  plannerEndpointIds: string[];
  executorEndpointIds: string[];
  selectedExecutorId: string;
  fallbackExecutorIds: string[];
  status: ConversationTaskRouteStatus;
  visibility: 'internal';
  createdAt: number;
  updatedAt: number;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class InMemoryConversationRouteStore {
  private readonly routes = new Map<string, ConversationTaskRoute>();

  create(input: {
    projectId: string;
    instructionId: string;
    sessionId: string;
    plannerEndpointIds: string[];
    executorEndpointIds: string[];
    selectedExecutorId: string;
    now?: number;
  }): ConversationTaskRoute {
    const now = input.now ?? Date.now();
    const route: ConversationTaskRoute = {
      id: randomUUID(),
      projectId: input.projectId,
      instructionId: input.instructionId,
      sessionId: input.sessionId,
      mode: 'single',
      plannerEndpointIds: input.plannerEndpointIds,
      executorEndpointIds: input.executorEndpointIds,
      selectedExecutorId: input.selectedExecutorId,
      fallbackExecutorIds: [],
      status: 'queued',
      visibility: 'internal',
      createdAt: now,
      updatedAt: now,
    };
    this.routes.set(route.id, clone(route));
    return clone(route);
  }

  markDispatched(routeId: string, now: number = Date.now()): ConversationTaskRoute | undefined {
    const route = this.routes.get(routeId);
    if (!route || route.status !== 'queued') return undefined;
    route.status = 'dispatched';
    route.updatedAt = now;
    this.routes.set(route.id, clone(route));
    return clone(route);
  }

  markReturned(routeId: string, now: number = Date.now()): ConversationTaskRoute | undefined {
    const route = this.routes.get(routeId);
    if (!route || !['dispatched', 'running'].includes(route.status)) return undefined;
    route.status = 'returned';
    route.updatedAt = now;
    this.routes.set(route.id, clone(route));
    return clone(route);
  }

  listByProject(projectId: string): ConversationTaskRoute[] {
    return Array.from(this.routes.values())
      .filter(route => route.projectId === projectId)
      .sort((a, b) => a.createdAt - b.createdAt)
      .map(clone);
  }

  hydrateRoute(route: ConversationTaskRoute): void {
    if (!route || typeof route.id !== 'string' || route.visibility !== 'internal') return;
    this.routes.set(route.id, clone(route));
  }

  exportRoutes(): ConversationTaskRoute[] {
    return Array.from(this.routes.values(), clone);
  }
}
```

- [ ] **Step 4: Wire runtime and persistence**

Add `conversationRouteStore` to `BridgeRuntime`, instantiate it, hydrate it,
and export it through `json-snapshot-store.ts`.

- [ ] **Step 5: Link actions to instruction and route**

Add optional internal ids to `ConversationAction`:

```ts
instructionId?: string;
routeId?: string;
```

When creating an action from a conversation message, pass `instruction.id`.
When dispatching a WorkBuddy action, create a `ConversationTaskRoute` before
enqueueing the WorkBuddy task and mark it dispatched after enqueue succeeds.

- [ ] **Step 6: Mark route returned**

In `POST /bridge/endpoints/:id/results`, when a conversation action is found:

```ts
if (conversationAction.routeId && outcomeOk) {
  runtime.conversationRouteStore.markReturned(conversationAction.routeId);
}
```

If the result failed, mark the route failed using a `markFailed()` method added
to `InMemoryConversationRouteStore`.

- [ ] **Step 7: Verify**

Run:

```bash
node --experimental-strip-types --test tests/conversation-route-plane.test.mjs tests/conversation-execution-api.test.mjs tests/json-persistence.test.mjs
npm run typecheck
npm run lint
```

Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add apps/local-server/src/storage/conversation-route-store.ts apps/local-server/src/storage/conversation-action-store.ts apps/local-server/src/routes/bridge-api.ts apps/local-server/src/storage/json-snapshot-store.ts tests/conversation-route-plane.test.mjs tests/conversation-execution-api.test.mjs tests/json-persistence.test.mjs
git commit -m "feat: add single conversation task routes"
```

## Task 5: Acceptance And Safety Gate

**Files:**
- Create: `scripts/passthrough-route-plane-acceptance.ts`
- Test: `tests/passthrough-route-plane-acceptance.test.mjs`
- Modify: `tests/project-console-behavior.test.mjs`

- [ ] **Step 1: Add acceptance script**

Create `scripts/passthrough-route-plane-acceptance.ts`:

```ts
import assert from 'node:assert/strict';
import { startLocalServer } from '../apps/local-server/src/server.ts';

const handle = await startLocalServer(0);
try {
  const consoleRes = await fetch(`${handle.url}/console/project`);
  const cookie = consoleRes.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie, 'console cookie must be set');
  const headers = { cookie, 'content-type': 'application/json' };

  async function api(path: string, method = 'GET', body?: unknown) {
    const res = await fetch(`${handle.url}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json();
    assert.ok(res.ok, `${method} ${path} returned ${res.status}: ${JSON.stringify(data)}`);
    return data;
  }

  await api('/bridge/projects/cli-bridge/conversation-pairing', 'PUT', {
    sourceEndpointId: 'chatgpt-web',
    targetEndpointId: 'workbuddy',
  });
  const created = await api('/bridge/projects/cli-bridge/conversation/messages', 'POST', {
    text: 'acceptance raw output',
  });
  const action = created.actions[0];
  await api(`/bridge/projects/cli-bridge/conversation/actions/${action.id}/confirm`, 'POST', {});
  const dispatched = await api(`/bridge/projects/cli-bridge/conversation/actions/${action.id}/dispatch`, 'POST', {});
  const inbox = await api('/bridge/endpoints/workbuddy/inbox/next');
  assert.equal(inbox.task.prompt, 'acceptance raw output');

  await api('/bridge/endpoints/workbuddy/results', 'POST', {
    taskId: dispatched.task.taskId,
    ok: true,
    stdout: 'executor raw answer',
    exitCode: 0,
    durationMs: 1,
  });

  const messages = await api('/bridge/projects/cli-bridge/conversation/messages');
  const visibleText = JSON.stringify(messages.messages.filter((event: any) => event.visibility !== 'internal'));
  assert.match(visibleText, /executor raw answer/);
  assert.doesNotMatch(visibleText, /task preview|confirm|dispatch|route_|instr_/i);

  console.log('passthrough route plane acceptance: OK');
} finally {
  await new Promise<void>((resolve, reject) => {
    handle.server.close(error => error ? reject(error) : resolve());
  });
}
```

- [ ] **Step 2: Add acceptance wiring test**

Create `tests/passthrough-route-plane-acceptance.test.mjs`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

test('passthrough route plane acceptance script is wired', () => {
  const source = readFileSync(new URL('../scripts/passthrough-route-plane-acceptance.ts', import.meta.url), 'utf8');
  assert.match(source, /passthrough route plane acceptance: OK/);
  assert.match(source, /executor raw answer/);
  assert.doesNotMatch(source, /localStorage\\.setItem\\(['"]cli-bridge-pairing-token/);
});
```

- [ ] **Step 3: Run acceptance script**

Run:

```bash
node --experimental-strip-types scripts/passthrough-route-plane-acceptance.ts
```

Expected:

```text
passthrough route plane acceptance: OK
```

- [ ] **Step 4: Run full gate**

Run:

```bash
npm run typecheck
npm run lint
npm test
git diff --check
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/passthrough-route-plane-acceptance.ts tests/passthrough-route-plane-acceptance.test.mjs tests/project-console-behavior.test.mjs
git commit -m "test: add passthrough route plane acceptance"
```

## Final Review Checklist

- [ ] ADR-0029 is explicitly accepted before Tasks 1-5 execute.
- [ ] `conversation-pairing` still supports existing single target behavior.
- [ ] User transcript renders no instruction packets.
- [ ] User transcript renders no route ids, task ids, action ids, tokens, cookies, or endpoint secrets.
- [ ] User-visible answer body comes from executor-emitted fields only.
- [ ] Bridge status events remain short and non-semantic.
- [ ] No generic shell/run/exec/Git/PR/workspace mutation endpoint was added.
- [ ] Extension session cannot gain confirm/dispatch/run authority.
- [ ] `npm run typecheck` passes.
- [ ] `npm run lint` passes.
- [ ] `npm test` passes.
- [ ] Acceptance script passes.

## Execution Recommendation

Use subagent-driven execution after ADR-0029 is accepted:

1. Task 0 inline by planning/review owner.
2. Task 1 by EX-1 agent, then REVIEW-1.
3. Task 2 by EX-2 agent, then REVIEW-2.
4. Task 3 by EX-3 agent, then REVIEW-3.
5. Task 4 by EX-4 agent, then REVIEW-4.
6. Task 5 inline acceptance by planning/review owner.

Do not continue from one EX task to the next without an RP/REVIEW gate.
