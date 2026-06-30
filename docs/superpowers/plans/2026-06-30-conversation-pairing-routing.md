# Conversation Pairing Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a real Project Workspace conversation-pairing flow where users can visibly pair ChatGPT Web with Codex, Claude Code, or WorkBuddy targets, then see routed conversation activity and returned output in the center Conversation area.

**Architecture:** Separate conversation pairing from project team presets. Conversation pairing stores a project-scoped route for interactive conversation transport; team presets remain goal/plan automation bindings. The UI must show unavailable transport states honestly instead of hiding ChatGPT Web, Codex, or Claude Code from selectors.

**Tech Stack:** TypeScript local server, self-contained `/console/project` HTML, existing `/bridge/*` token/origin gates, endpoint registry, JSON snapshot persistence, Node test runner with jsdom.

---

## Scope Fence

This plan fixes the product-level mismatch found after the first Pairing UI patch:

- Conversation Pairing is not Team Preset.
- "Execution tool" in the visible UI must not mean `canExecute=true` only.
- ChatGPT Web must be selectable as conversation source.
- Codex CLI, Codex command review, Claude Code command review, and WorkBuddy must be visible as target options with route-type/status labels.
- Natural language submitted in Conversation mode must render in the central transcript with routing status and returned output when an implemented route returns.
- Goal creation remains available, but it is not the default explanation for every post-pairing conversational input.

Hard non-goals:

- No generic `/exec`, `/shell`, `/run`, or arbitrary command endpoint.
- No flipping endpoint `canExecute=true` for Codex or Claude Code as a UI workaround.
- No auto-send into ChatGPT Web without the existing human confirmation boundary.
- No raw token or raw prompt persistence outside existing stores.
- No direct terminal control UI until a registered endpoint/session can represent that terminal.

## File Structure

Create:

- `apps/local-server/src/storage/conversation-pairing-store.ts`
  - Owns project-scoped conversation routes.
  - Validates shape only; endpoint capability validation stays in route handler because it needs the endpoint registry.

- `apps/local-server/src/storage/conversation-transcript-store.ts`
  - Owns short, project-scoped conversation events visible in `/console/project`.
  - Stores redacted display summaries, not raw secrets.

- `tests/conversation-pairing-api.test.mjs`
  - API contract tests for route save/read/delete and capability validation.

- `tests/project-console-conversation-pairing.test.mjs`
  - jsdom UI tests for selectors, mode toggle, save, send, and transcript rendering.

Modify:

- `apps/local-server/src/routes/bridge-api.ts`
  - Add `/bridge/projects/:key/conversation-pairing`.
  - Add `/bridge/projects/:key/conversation/messages`.
  - Include stores in runtime, export/hydrate snapshot.

- `apps/local-server/src/routes/project-console.ts`
  - Replace current Pairing panel behavior so it uses conversation-pairing API.
  - Keep team preset commands but move them under "Automation binding", not primary Pairing.
  - Add composer mode state: `conversation` or `project`.
  - Render transcript in center Conversation area.

- `apps/local-server/src/storage/json-snapshot-store.ts`
  - Persist `conversationPairings` and `conversationTranscriptEvents`.

- `packages/shared/src/types.ts`
  - Add types for `ConversationPairing` and `ConversationTranscriptEvent` if this repo keeps cross-store types there.

- `packages/shared/src/schemas.ts`
  - Add schema assertions if shared types require runtime validation.

Do not modify:

- `apps/local-server/src/adapters/command-runner.ts` in this phase, except if a later accepted EX explicitly adds a review-command conversation adapter.
- Existing endpoint capability booleans for Codex/Claude.
- Extension auto-send behavior.

---

## Route Semantics

Conversation pairing route:

```ts
interface ConversationPairing {
  projectId: string;
  sourceEndpointId: string;
  targetEndpointId: string;
  targetRouteKind: 'web-relay' | 'managed-pty' | 'review-command' | 'workbuddy-execution' | 'unavailable';
  scope: 'project';
  status: 'ready' | 'needs-manual-confirmation' | 'not-implemented';
  updatedAt: number;
}
```

Selector capability rules:

- Source options:
  - endpoint status must be `online`
  - endpoint must support at least `canAcceptPrompt && canReturnOutput`
  - `chatgpt-web` must appear

- Target options:
  - `codex-cli`: visible as `managed-pty`, status `not-implemented` until a general prompt-return route exists
  - `codex-command`: visible as `review-command`, status `ready-for-review-route`, not general chat
  - `claude-code-command`: visible as `review-command`, status `ready-for-review-route`, not general chat
  - `workbuddy`: visible as `workbuddy-execution`, status `ready`
  - disabled only when endpoint has no usable route kind

Message route:

```ts
interface ConversationTranscriptEvent {
  id: string;
  projectId: string;
  pairingId: string;
  role: 'user' | 'bridge' | 'target';
  text: string;
  status: 'draft' | 'queued' | 'awaiting-manual-confirmation' | 'returned' | 'failed' | 'not-implemented';
  routeKind: ConversationPairing['targetRouteKind'];
  createdAt: number;
}
```

First implementation target:

- `workbuddy-execution`: create a task via existing WorkBuddy execution path only when the selected endpoint is `workbuddy`.
- `review-command`: do not fake a general chat. For general text, create transcript event with `not-implemented` and a visible explanation. For explicit `review ...`, reuse existing review flow and render the returned review result in transcript.
- `managed-pty`: show as selectable and `not-implemented` until a separate ADR accepts general managed PTY prompt-return.

---

## Task 0: Stop Calling Team Preset "Pairing"

**Files:**
- Modify: `apps/local-server/src/routes/project-console.ts`
- Modify: `tests/project-console-behavior.test.mjs`

- [ ] **Step 1: Write failing UI test for ChatGPT Web visibility**

Add to `tests/project-console-conversation-pairing.test.mjs`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { renderProjectConsoleHtml } from '../apps/local-server/src/routes/project-console.ts';

function setupConsole() {
  const html = renderProjectConsoleHtml();
  const calls = [];
  const dom = new JSDOM(html, {
    url: 'http://localhost:9300/console/project',
    runScripts: 'dangerously',
    resources: 'usable',
    beforeParse(win) {
      Object.defineProperty(win, 'localStorage', {
        value: { getItem: () => null, setItem: () => {} },
        configurable: true,
      });
      win.fetch = async (url, init = {}) => {
        const path = new URL(String(url)).pathname;
        calls.push({ path, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null });
        if (path === '/bridge/metrics') return { ok: true, status: 200, json: async () => ({}) };
        if (path === '/bridge/endpoints') {
          return { ok: true, status: 200, json: async () => ({ endpoints: [
            { id: 'chatgpt-web', label: 'ChatGPT Web', transport: 'web-dom', status: 'online', capabilities: { canAcceptPrompt: true, canReturnOutput: true, canReview: false, canExecute: false, canSummarize: true } },
            { id: 'codex-cli', label: 'Codex CLI', transport: 'managed-pty', status: 'online', capabilities: { canAcceptPrompt: true, canReturnOutput: true, canReview: false, canExecute: false, canSummarize: false } },
            { id: 'claude-code-command', label: 'Claude Code Review', transport: 'command', status: 'online', capabilities: { canAcceptPrompt: false, canReturnOutput: true, canReview: true, canExecute: false, canSummarize: false } },
            { id: 'codex-command', label: 'Codex Review', transport: 'command', status: 'online', capabilities: { canAcceptPrompt: false, canReturnOutput: true, canReview: true, canExecute: false, canSummarize: false } },
            { id: 'workbuddy', label: 'WorkBuddy Executor', transport: 'workbuddy', status: 'online', capabilities: { canAcceptPrompt: true, canReturnOutput: true, canReview: true, canExecute: true, canSummarize: false } },
          ] }) };
        }
        if (path === '/bridge/projects/cli-bridge/conversation-pairing') return { ok: true, status: 200, json: async () => ({ pairing: null }) };
        return { ok: true, status: 200, json: async () => ({}) };
      };
    },
  });
  return { window: dom.window, document: dom.window.document, calls };
}

async function waitFor(predicate, timeoutMs = 500) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await new Promise(r => setTimeout(r, 10));
  }
  throw new Error('waitFor timeout');
}

test('conversation pairing exposes ChatGPT Web as source and Codex/Claude/WorkBuddy as targets', async () => {
  const { document } = setupConsole();
  document.getElementById('token').value = 'test';
  document.getElementById('connect').click();
  await waitFor(() => document.getElementById('conn-dot').classList.contains('ok'));

  document.getElementById('composer-pairing').click();
  await waitFor(() => document.getElementById('conversation-pairing-context'));

  const sourceText = document.getElementById('conversation-source').textContent;
  const targetText = document.getElementById('conversation-target').textContent;
  assert.match(sourceText, /ChatGPT Web/);
  assert.match(targetText, /Codex CLI/);
  assert.match(targetText, /Claude Code Review/);
  assert.match(targetText, /Codex Review/);
  assert.match(targetText, /WorkBuddy Executor/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --experimental-strip-types --test tests/project-console-conversation-pairing.test.mjs
```

Expected: FAIL because `conversation-source`, `conversation-target`, and `conversation-pairing-context` do not exist.

- [ ] **Step 3: Rename current UI concepts in implementation**

In `apps/local-server/src/routes/project-console.ts`:

- Replace visible heading `Pairing` content that currently says "Saved as the project team preset" with "Conversation Pairing".
- Stop using `/team-preset` inside `loadPairingContext()` and `bindPairingContext()`.
- Keep legacy `pair status`, `pair reset`, and `pair planner ...` commands unchanged for team preset users.

Minimal transitional code:

```js
async function loadPairingContext() {
  if (!store.connected) {
    store.cache.pairing = { endpoints: [], pairing: null, loaded: false };
    return false;
  }
  const [epsRes, pairingRes] = await Promise.all([
    api('/bridge/endpoints?online=true', 'GET'),
    api('/bridge/projects/' + encodeURIComponent(store.activeProjectKey) + '/conversation-pairing', 'GET'),
  ]);
  store.cache.pairing = {
    endpoints: epsRes.ok && Array.isArray(epsRes.data?.endpoints) ? epsRes.data.endpoints : [],
    pairing: pairingRes.ok ? (pairingRes.data?.pairing || null) : null,
    loaded: true,
  };
  return epsRes.ok && pairingRes.ok;
}
```

- [ ] **Step 4: Run focused tests**

Run:

```bash
node --experimental-strip-types --test tests/project-console-conversation-pairing.test.mjs tests/project-console-behavior.test.mjs
```

Expected: new test still fails until API exists; existing behavior failures should be limited to tests that assumed `/team-preset` for the Pairing panel.

- [ ] **Step 5: Commit**

```bash
git add apps/local-server/src/routes/project-console.ts tests/project-console-conversation-pairing.test.mjs tests/project-console-behavior.test.mjs
git commit -m "test: define conversation pairing UI contract"
```

---

## Task 1: Add Conversation Pairing Store And API

**Files:**
- Create: `apps/local-server/src/storage/conversation-pairing-store.ts`
- Modify: `apps/local-server/src/routes/bridge-api.ts`
- Modify: `apps/local-server/src/storage/json-snapshot-store.ts`
- Test: `tests/conversation-pairing-api.test.mjs`

- [ ] **Step 1: Write API tests**

Create `tests/conversation-pairing-api.test.mjs`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { createBridgeRuntime, handleBridgeRequest } from '../apps/local-server/src/routes/bridge-api.ts';

function req(path, method = 'GET', body) {
  return {
    url: path,
    method,
    headers: { origin: 'http://127.0.0.1:31337', 'x-cli-bridge-pairing-token': 'test-token' },
    [Symbol.asyncIterator]: async function* () {
      if (body !== undefined) yield Buffer.from(JSON.stringify(body));
    },
  };
}

test('conversation pairing saves ChatGPT Web to Codex CLI route', async () => {
  const runtime = createBridgeRuntime({ pairingToken: 'test-token' });
  const create = await handleBridgeRequest(runtime, req('/bridge/projects/cli-bridge/conversation-pairing', 'PUT', {
    sourceEndpointId: 'chatgpt-web',
    targetEndpointId: 'codex-cli',
    scope: 'project',
  }));

  assert.equal(create.status, 200);
  assert.equal(create.payload.pairing.sourceEndpointId, 'chatgpt-web');
  assert.equal(create.payload.pairing.targetEndpointId, 'codex-cli');
  assert.equal(create.payload.pairing.targetRouteKind, 'managed-pty');
  assert.equal(create.payload.pairing.status, 'not-implemented');

  const read = await handleBridgeRequest(runtime, req('/bridge/projects/cli-bridge/conversation-pairing'));
  assert.equal(read.status, 200);
  assert.equal(read.payload.pairing.targetEndpointId, 'codex-cli');
});

test('conversation pairing exposes Claude Code command as review-command route', async () => {
  const runtime = createBridgeRuntime({ pairingToken: 'test-token' });
  const res = await handleBridgeRequest(runtime, req('/bridge/projects/cli-bridge/conversation-pairing', 'PUT', {
    sourceEndpointId: 'chatgpt-web',
    targetEndpointId: 'claude-code-command',
    scope: 'project',
  }));

  assert.equal(res.status, 200);
  assert.equal(res.payload.pairing.targetRouteKind, 'review-command');
  assert.equal(res.payload.pairing.status, 'ready');
});

test('conversation pairing rejects unknown source endpoint', async () => {
  const runtime = createBridgeRuntime({ pairingToken: 'test-token' });
  const res = await handleBridgeRequest(runtime, req('/bridge/projects/cli-bridge/conversation-pairing', 'PUT', {
    sourceEndpointId: 'missing',
    targetEndpointId: 'codex-cli',
    scope: 'project',
  }));

  assert.equal(res.status, 400);
  assert.match(res.payload.message, /source endpoint/);
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
node --experimental-strip-types --test tests/conversation-pairing-api.test.mjs
```

Expected: FAIL because route and store do not exist.

- [ ] **Step 3: Implement store**

Create `apps/local-server/src/storage/conversation-pairing-store.ts`:

```ts
export type ConversationRouteKind = 'web-relay' | 'managed-pty' | 'review-command' | 'workbuddy-execution' | 'unavailable';
export type ConversationPairingStatus = 'ready' | 'needs-manual-confirmation' | 'not-implemented';

export interface ConversationPairing {
  projectId: string;
  sourceEndpointId: string;
  targetEndpointId: string;
  targetRouteKind: ConversationRouteKind;
  scope: 'project';
  status: ConversationPairingStatus;
  updatedAt: number;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class InMemoryConversationPairingStore {
  private readonly pairings = new Map<string, ConversationPairing>();

  upsert(pairing: ConversationPairing): ConversationPairing {
    const stored = { ...pairing, scope: 'project' as const, updatedAt: Date.now() };
    this.pairings.set(stored.projectId, clone(stored));
    return clone(stored);
  }

  get(projectId: string): ConversationPairing | undefined {
    const pairing = this.pairings.get(projectId);
    return pairing ? clone(pairing) : undefined;
  }

  delete(projectId: string): boolean {
    return this.pairings.delete(projectId);
  }

  exportPairings(): ConversationPairing[] {
    return Array.from(this.pairings.values(), clone);
  }

  hydratePairing(pairing: ConversationPairing): void {
    if (!pairing || typeof pairing.projectId !== 'string') return;
    if (typeof pairing.sourceEndpointId !== 'string') return;
    if (typeof pairing.targetEndpointId !== 'string') return;
    this.pairings.set(pairing.projectId, clone(pairing));
  }
}
```

- [ ] **Step 4: Add route-kind resolver**

In `apps/local-server/src/routes/bridge-api.ts`, add helper near existing endpoint helpers:

```ts
function resolveConversationRouteKind(endpoint: AgentEndpoint): { kind: ConversationRouteKind; status: ConversationPairingStatus } {
  if (endpoint.id === 'workbuddy' && endpoint.capabilities.canExecute) {
    return { kind: 'workbuddy-execution', status: 'ready' };
  }
  if (endpoint.transport === 'command' && endpoint.capabilities.canReview) {
    return { kind: 'review-command', status: 'ready' };
  }
  if (endpoint.transport === 'managed-pty' && endpoint.capabilities.canAcceptPrompt && endpoint.capabilities.canReturnOutput) {
    return { kind: 'managed-pty', status: 'not-implemented' };
  }
  if (endpoint.transport === 'web-dom' && endpoint.capabilities.canAcceptPrompt && endpoint.capabilities.canReturnOutput) {
    return { kind: 'web-relay', status: 'needs-manual-confirmation' };
  }
  return { kind: 'unavailable', status: 'not-implemented' };
}

function validateConversationSource(endpoint: AgentEndpoint | undefined): string | null {
  if (!endpoint || endpoint.status !== 'online') return 'source endpoint not found or offline';
  if (!endpoint.capabilities.canAcceptPrompt || !endpoint.capabilities.canReturnOutput) {
    return `source endpoint "${endpoint.id}" cannot participate in conversation relay`;
  }
  return null;
}
```

- [ ] **Step 5: Add runtime store and persistence hooks**

In `BridgeRuntime`, add:

```ts
conversationPairingStore: InMemoryConversationPairingStore;
```

In `createBridgeRuntime()`:

```ts
const conversationPairingStore = new InMemoryConversationPairingStore();
```

In snapshot export:

```ts
conversationPairings: conversationPairingStore.exportPairings(),
```

In hydrate:

```ts
for (const p of snapshot.conversationPairings ?? []) {
  try { conversationPairingStore.hydratePairing(p); } catch {}
}
```

- [ ] **Step 6: Add API route**

In `handleBridgeRequest()` before project teams routes:

```ts
const conversationPairingPath = projectActionPathKey(pathname, 'conversation-pairing');
if (conversationPairingPath.matched) {
  if (!conversationPairingPath.key) return error(400, 'Invalid project key');
  const project = runtime.projectStore.get(conversationPairingPath.key);
  if (!project) return error(404, 'Project not found');
  if (project.archivedAt && method !== 'GET') return error(409, 'Cannot modify conversation pairing in archived project');

  if (method === 'GET') {
    return ok({ pairing: runtime.conversationPairingStore.get(conversationPairingPath.key) ?? null });
  }

  if (method === 'DELETE') {
    const deleted = runtime.conversationPairingStore.delete(conversationPairingPath.key);
    runtime.persist();
    return ok({ deleted });
  }

  if (method === 'PUT') {
    const parsed = await readJsonBody(request);
    if (!parsed.ok) return error(400, parsed.message);
    const body = parsed.body as Record<string, unknown>;
    const sourceEndpointId = typeof body.sourceEndpointId === 'string' ? body.sourceEndpointId.trim() : '';
    const targetEndpointId = typeof body.targetEndpointId === 'string' ? body.targetEndpointId.trim() : '';
    if (!sourceEndpointId) return error(400, 'sourceEndpointId is required');
    if (!targetEndpointId) return error(400, 'targetEndpointId is required');

    const source = runtime.endpointRegistry.get(sourceEndpointId);
    const target = runtime.endpointRegistry.get(targetEndpointId);
    const sourceError = validateConversationSource(source);
    if (sourceError) return error(400, sourceError);
    if (!target || target.status !== 'online') return error(400, 'target endpoint not found or offline');

    const route = resolveConversationRouteKind(target);
    if (route.kind === 'unavailable') {
      return error(400, `target endpoint "${targetEndpointId}" has no supported conversation route`);
    }

    const pairing = runtime.conversationPairingStore.upsert({
      projectId: conversationPairingPath.key,
      sourceEndpointId,
      targetEndpointId,
      targetRouteKind: route.kind,
      status: route.status,
      scope: 'project',
      updatedAt: 0,
    });
    runtime.persist();
    return ok({ pairing });
  }

  return methodNotAllowed(['GET', 'PUT', 'DELETE']);
}
```

- [ ] **Step 7: Run API tests**

Run:

```bash
node --experimental-strip-types --test tests/conversation-pairing-api.test.mjs
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/local-server/src/storage/conversation-pairing-store.ts apps/local-server/src/routes/bridge-api.ts apps/local-server/src/storage/json-snapshot-store.ts tests/conversation-pairing-api.test.mjs
git commit -m "feat: add conversation pairing API"
```

---

## Task 2: Replace Pairing Panel With Conversation Pairing UI

**Files:**
- Modify: `apps/local-server/src/routes/project-console.ts`
- Test: `tests/project-console-conversation-pairing.test.mjs`

- [ ] **Step 1: Extend UI tests for save behavior**

Append:

```js
test('conversation pairing save uses conversation-pairing endpoint, not team-preset', async () => {
  const { document, calls } = setupConsole();
  document.getElementById('token').value = 'test';
  document.getElementById('connect').click();
  await waitFor(() => document.getElementById('conn-dot').classList.contains('ok'));
  document.getElementById('composer-pairing').click();
  await waitFor(() => document.getElementById('conversation-pairing-save'));

  document.getElementById('conversation-source').value = 'chatgpt-web';
  document.getElementById('conversation-target').value = 'claude-code-command';
  document.getElementById('conversation-pairing-save').click();

  await waitFor(() => document.getElementById('command-status').textContent === 'conversation pairing saved');
  const put = calls.find(c => c.path === '/bridge/projects/cli-bridge/conversation-pairing' && c.method === 'PUT');
  assert.ok(put, 'expected conversation-pairing PUT');
  assert.equal(calls.some(c => c.path.includes('/team-preset') && c.method === 'PUT'), false);
  assert.deepEqual(put.body, {
    sourceEndpointId: 'chatgpt-web',
    targetEndpointId: 'claude-code-command',
    scope: 'project',
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
node --experimental-strip-types --test tests/project-console-conversation-pairing.test.mjs
```

Expected: FAIL until UI ids and endpoint path are updated.

- [ ] **Step 3: Update store shape in console script**

In `store.cache`, replace:

```js
pairing: { endpoints: [], preset: null, loaded: false }
```

with:

```js
pairing: { endpoints: [], conversation: null, loaded: false }
```

Update every cache reset to use the new shape.

- [ ] **Step 4: Replace selectors**

Use these element ids in the Pairing panel:

```html
<select id="conversation-source"></select>
<select id="conversation-target"></select>
<select id="conversation-scope"></select>
<button id="conversation-pairing-test">Test route</button>
<button id="conversation-pairing-save">Save route</button>
<button id="conversation-pairing-reset">Clear route</button>
<span id="conversation-pairing-status"></span>
```

The source options must be built from endpoints where:

```js
function canBeConversationSource(endpoint) {
  const caps = endpoint.capabilities || {};
  return endpoint.status === 'online' && !!caps.canAcceptPrompt && !!caps.canReturnOutput;
}
```

The target options must be built from route kind:

```js
function conversationRouteKind(endpoint) {
  const caps = endpoint.capabilities || {};
  if (endpoint.id === 'workbuddy' && caps.canExecute) return { kind: 'workbuddy-execution', status: 'ready' };
  if (endpoint.transport === 'command' && caps.canReview) return { kind: 'review-command', status: 'ready' };
  if (endpoint.transport === 'managed-pty' && caps.canAcceptPrompt && caps.canReturnOutput) return { kind: 'managed-pty', status: 'not implemented' };
  if (endpoint.transport === 'web-dom' && caps.canAcceptPrompt && caps.canReturnOutput) return { kind: 'web-relay', status: 'manual confirmation' };
  return { kind: 'unavailable', status: 'not available' };
}
```

- [ ] **Step 5: Update save/reset handlers**

Use:

```js
const res = await api('/bridge/projects/' + encodeURIComponent(store.activeProjectKey) + '/conversation-pairing', 'PUT', {
  sourceEndpointId,
  targetEndpointId,
  scope: 'project',
});
```

Delete uses the same path with `DELETE`.

- [ ] **Step 6: Run focused UI tests**

Run:

```bash
node --experimental-strip-types --test tests/project-console-conversation-pairing.test.mjs tests/project-console-ui.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/local-server/src/routes/project-console.ts tests/project-console-conversation-pairing.test.mjs tests/project-console-ui.test.mjs
git commit -m "feat: add conversation pairing controls"
```

---

## Task 3: Add Conversation Mode And Transcript Rendering

**Files:**
- Create: `apps/local-server/src/storage/conversation-transcript-store.ts`
- Modify: `apps/local-server/src/routes/bridge-api.ts`
- Modify: `apps/local-server/src/routes/project-console.ts`
- Test: `tests/project-console-conversation-pairing.test.mjs`

- [ ] **Step 1: Write failing transcript test**

Append:

```js
test('conversation mode sends message to conversation endpoint and renders transcript', async () => {
  const { document, calls } = setupConsole();
  document.getElementById('token').value = 'test';
  document.getElementById('connect').click();
  await waitFor(() => document.getElementById('conn-dot').classList.contains('ok'));

  document.getElementById('composer-mode-toggle').click();
  document.getElementById('command-input').value = 'hi draft';
  document.getElementById('command-send').click();

  await waitFor(() => document.getElementById('conversation-transcript').textContent.includes('hi draft'));
  const post = calls.find(c => c.path === '/bridge/projects/cli-bridge/conversation/messages' && c.method === 'POST');
  assert.ok(post, 'expected conversation message POST');
  assert.equal(post.body.text, 'hi draft');
  assert.equal(calls.some(c => c.path === '/bridge/goals' && c.method === 'POST'), false);
});
```

- [ ] **Step 2: Create transcript store**

Create `apps/local-server/src/storage/conversation-transcript-store.ts`:

```ts
export interface ConversationTranscriptEvent {
  id: string;
  projectId: string;
  pairingId: string;
  role: 'user' | 'bridge' | 'target';
  text: string;
  status: 'draft' | 'queued' | 'awaiting-manual-confirmation' | 'returned' | 'failed' | 'not-implemented';
  routeKind: 'web-relay' | 'managed-pty' | 'review-command' | 'workbuddy-execution' | 'unavailable';
  createdAt: number;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class InMemoryConversationTranscriptStore {
  private readonly events = new Map<string, ConversationTranscriptEvent>();

  append(event: Omit<ConversationTranscriptEvent, 'id' | 'createdAt'> & { id?: string; createdAt?: number }): ConversationTranscriptEvent {
    const stored: ConversationTranscriptEvent = {
      ...event,
      id: event.id ?? `conv-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      createdAt: event.createdAt ?? Date.now(),
    };
    this.events.set(stored.id, clone(stored));
    return clone(stored);
  }

  listByProject(projectId: string): ConversationTranscriptEvent[] {
    return Array.from(this.events.values())
      .filter(e => e.projectId === projectId)
      .sort((a, b) => a.createdAt - b.createdAt)
      .map(clone);
  }

  exportEvents(): ConversationTranscriptEvent[] {
    return Array.from(this.events.values(), clone);
  }

  hydrateEvent(event: ConversationTranscriptEvent): void {
    if (!event || typeof event.id !== 'string' || typeof event.projectId !== 'string') return;
    this.events.set(event.id, clone(event));
  }
}
```

- [ ] **Step 3: Add message API**

In `bridge-api.ts`, add `GET/POST /bridge/projects/:key/conversation/messages`.

POST behavior:

```ts
const pairing = runtime.conversationPairingStore.get(projectKey);
if (!pairing) return error(409, 'Conversation pairing is not configured');

const userEvent = runtime.conversationTranscriptStore.append({
  projectId: projectKey,
  pairingId: `${pairing.sourceEndpointId}->${pairing.targetEndpointId}`,
  role: 'user',
  text,
  status: 'queued',
  routeKind: pairing.targetRouteKind,
});

let bridgeText = '';
let bridgeStatus: ConversationTranscriptEvent['status'] = 'queued';
if (pairing.targetRouteKind === 'managed-pty') {
  bridgeStatus = 'not-implemented';
  bridgeText = 'Codex CLI is registered, but general managed-pty conversation dispatch is not implemented in this phase.';
} else if (pairing.targetRouteKind === 'review-command') {
  bridgeStatus = 'not-implemented';
  bridgeText = 'Claude/Codex command transport is review-only. Use review <text> for the governed review route.';
} else if (pairing.targetRouteKind === 'web-relay') {
  bridgeStatus = 'awaiting-manual-confirmation';
  bridgeText = 'Web relay requires the existing manual confirmation flow.';
} else if (pairing.targetRouteKind === 'workbuddy-execution') {
  bridgeStatus = 'queued';
  bridgeText = 'Queued for WorkBuddy execution flow.';
}

const bridgeEvent = runtime.conversationTranscriptStore.append({
  projectId: projectKey,
  pairingId: `${pairing.sourceEndpointId}->${pairing.targetEndpointId}`,
  role: 'bridge',
  text: bridgeText,
  status: bridgeStatus,
  routeKind: pairing.targetRouteKind,
});

runtime.persist();
return created({ events: [userEvent, bridgeEvent] });
```

- [ ] **Step 4: Add composer mode UI**

In `project-console.ts` footer toolbar, replace static `Project` mode with a button:

```html
<button type="button" class="composer-mode" id="composer-mode-toggle" aria-label="Toggle composer mode">Project</button>
```

Add state:

```js
composerMode: localStorage.getItem('cli-bridge-composer-mode') || 'project',
conversationEvents: [],
```

When pairing is saved successfully:

```js
store.composerMode = 'conversation';
localStorage.setItem('cli-bridge-composer-mode', 'conversation');
```

Handle toggle:

```js
$('composer-mode-toggle').addEventListener('click', () => {
  store.composerMode = store.composerMode === 'project' ? 'conversation' : 'project';
  localStorage.setItem('cli-bridge-composer-mode', store.composerMode);
  renderComposerMode();
});
```

- [ ] **Step 5: Route handleCommand by mode**

At the top of `handleCommand()` after help and pairing commands:

```js
if (store.composerMode === 'conversation' && !input.startsWith('/goal ') && !input.startsWith('goal ')) {
  await sendConversationMessage(input);
  return;
}
```

Implement:

```js
async function sendConversationMessage(input) {
  if (!store.connected) {
    appendCommandMessage(input, 'Connect with the pairing token first.', true);
    setCommandStatus('connect required', true);
    return;
  }
  const res = await api('/bridge/projects/' + encodeURIComponent(store.activeProjectKey) + '/conversation/messages', 'POST', { text: input });
  if (!res.ok) {
    appendCommandMessage(input, 'Conversation send failed: ' + escapeHtml(res.data?.message || res.status), true);
    setCommandStatus('conversation failed', true);
    return;
  }
  store.conversationEvents = (store.conversationEvents || []).concat(res.data?.events || []);
  renderConversationTranscript();
  setCommandStatus('conversation routed');
}
```

- [ ] **Step 6: Render transcript in center**

Add inside `goal-content` or a new `conversation-transcript` block:

```js
function renderConversationTranscript() {
  const el = $('conversation-transcript');
  if (!el) return;
  const events = store.conversationEvents || [];
  if (!events.length) {
    el.innerHTML = '<span class="unavailable">No conversation messages yet.</span>';
    return;
  }
  el.innerHTML = events.map(event =>
    '<div class="timeline-entry"><div class="origin ' + (event.role === 'user' ? 'user' : 'system') + '">'
    + escapeHtml(event.role)
    + '</div><div class="body">' + escapeHtml(event.text)
    + '<div class="time"><span class="pill">' + escapeHtml(event.status) + '</span> '
    + escapeHtml(event.routeKind) + '</div></div></div>'
  ).join('');
}
```

- [ ] **Step 7: Run tests**

Run:

```bash
node --experimental-strip-types --test tests/project-console-conversation-pairing.test.mjs tests/project-console-behavior.test.mjs tests/project-console-ui.test.mjs
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/local-server/src/storage/conversation-transcript-store.ts apps/local-server/src/routes/bridge-api.ts apps/local-server/src/routes/project-console.ts tests/project-console-conversation-pairing.test.mjs
git commit -m "feat: route conversation messages through project transcript"
```

---

## Task 4: Integrate Implemented Routes Without Overclaiming

**Files:**
- Modify: `apps/local-server/src/routes/bridge-api.ts`
- Modify: `apps/local-server/src/routes/project-console.ts`
- Test: `tests/conversation-pairing-api.test.mjs`

- [ ] **Step 1: Add route behavior tests**

Add:

```js
test('review-command conversation returns review-only explanation for generic text', async () => {
  const runtime = createBridgeRuntime({ pairingToken: 'test-token' });
  await handleBridgeRequest(runtime, req('/bridge/projects/cli-bridge/conversation-pairing', 'PUT', {
    sourceEndpointId: 'chatgpt-web',
    targetEndpointId: 'claude-code-command',
    scope: 'project',
  }));
  const res = await handleBridgeRequest(runtime, req('/bridge/projects/cli-bridge/conversation/messages', 'POST', {
    text: 'hi draft',
  }));

  assert.equal(res.status, 201);
  assert.equal(res.payload.events[1].status, 'not-implemented');
  assert.match(res.payload.events[1].text, /review-only/);
});

test('workbuddy route creates queued transcript event', async () => {
  const runtime = createBridgeRuntime({ pairingToken: 'test-token' });
  await handleBridgeRequest(runtime, req('/bridge/projects/cli-bridge/conversation-pairing', 'PUT', {
    sourceEndpointId: 'chatgpt-web',
    targetEndpointId: 'workbuddy',
    scope: 'project',
  }));
  const res = await handleBridgeRequest(runtime, req('/bridge/projects/cli-bridge/conversation/messages', 'POST', {
    text: 'summarize project status',
  }));

  assert.equal(res.status, 201);
  assert.equal(res.payload.events[1].routeKind, 'workbuddy-execution');
  assert.equal(res.payload.events[1].status, 'queued');
});
```

- [ ] **Step 2: Implement only safe route-specific behavior**

Rules:

- For `review-command`, generic text must not spawn CLI. It returns explanation.
- For explicit `review ...` in conversation mode, call existing `runReviewCommand()` from console, not the new generic message route.
- For `managed-pty`, return `not-implemented`.
- For `workbuddy-execution`, if an existing proposal/dispatch path is not available, store a queued transcript event and visible "queued, no auto execution" explanation. Do not invent direct execution.

- [ ] **Step 3: Run tests**

Run:

```bash
node --experimental-strip-types --test tests/conversation-pairing-api.test.mjs tests/project-console-conversation-pairing.test.mjs
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/local-server/src/routes/bridge-api.ts apps/local-server/src/routes/project-console.ts tests/conversation-pairing-api.test.mjs tests/project-console-conversation-pairing.test.mjs
git commit -m "feat: render honest conversation route outcomes"
```

---

## Task 5: Browser Verification And Final Cleanup

**Files:**
- Modify: `apps/local-server/src/routes/project-console.ts` only when the manual browser check exposes a visible UI defect in the implemented conversation-pairing controls.
- Test: no new test unless a defect is found

- [ ] **Step 1: Run full local checks**

Run:

```bash
npm run typecheck
node --experimental-strip-types --test tests/conversation-pairing-api.test.mjs tests/project-console-conversation-pairing.test.mjs tests/project-console-behavior.test.mjs tests/project-console-ui.test.mjs
npm test
```

Expected:

- typecheck passes
- focused tests pass
- full suite passes

- [ ] **Step 2: Restart local server**

Run:

```bash
npm start
```

Expected startup:

```text
CLI Bridge listening on http://127.0.0.1:31337
Project Workspace: http://127.0.0.1:31337/console/project
Pairing token: a newly generated 32-character hex token
```

The actual token is generated by the restarted server and must be copied from the startup output for that run.

- [ ] **Step 3: Manual browser checks**

In `/console/project`:

1. Paste token and Connect.
2. Click `Pairing`.
3. Confirm source selector includes `ChatGPT Web`.
4. Confirm target selector includes:
   - `Codex CLI`
   - `Codex Review`
   - `Claude Code Review`
   - `WorkBuddy Executor`
5. Save `ChatGPT Web -> Claude Code Review`.
6. Confirm Facts rail shows the saved route.
7. Toggle composer to `Conversation`.
8. Send `hi draft`.
9. Confirm center Conversation area shows:
   - user message
   - bridge route status
   - returned output or honest `review-only/not-implemented` explanation
10. Confirm Project History is not the only visible place showing the message.

- [ ] **Step 4: Commit**

```bash
git add apps/local-server/src/routes/project-console.ts tests/conversation-pairing-api.test.mjs tests/project-console-conversation-pairing.test.mjs
git commit -m "test: verify conversation pairing UX"
```

---

## Acceptance Criteria

Must pass:

- `ChatGPT Web` is selectable as conversation source.
- `Codex CLI`, `Codex Review`, `Claude Code Review`, and `WorkBuddy Executor` are visible target options.
- The UI labels route capabilities honestly:
  - `managed-pty`: not implemented for general conversation unless later ADR accepts it.
  - `review-command`: review-only route.
  - `workbuddy-execution`: execution flow route.
- Saving a conversation route does not call `/team-preset`.
- Team preset commands remain available but are not the primary Pairing panel.
- Post-pairing composer has a visible `Conversation` mode.
- In Conversation mode, submitted text appears in the center Conversation transcript with route result.
- Generic text in Conversation mode does not silently create a goal.
- Explicit `goal ...` still creates a goal.
- No token leaks into DOM text, localStorage, URLs, or logs.
- No generic shell or arbitrary command endpoint is introduced.

## Self-Review Notes

Spec coverage:

- Missing ChatGPT Web source: covered by Task 0 and Task 2.
- Missing Codex/Claude target: covered by Task 2.
- No central conversation output: covered by Task 3.
- Confusion between team preset and pairing: covered by Task 0 and Task 1.
- No overclaiming execution: covered by Task 4.

Known residual limitation:

- This plan does not authorize general managed-PTY chat execution for Codex CLI or Claude Code. It makes those targets visible and honest. A later ADR/EX slice is required to turn `managed-pty` general conversation from `not-implemented` into `ready`.
