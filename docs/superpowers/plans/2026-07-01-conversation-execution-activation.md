# Conversation Execution Activation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Conversation mode from a transcript-only surface into a usable governed action entrypoint while preserving approval gates and forbidding arbitrary shell execution.

**Architecture:** Conversation messages become server-owned action records that point to existing governed routes. Review-command targets create previewed review requests that require confirm/dispatch; WorkBuddy targets create confirmable WorkBuddy execution requests that enqueue only after explicit confirmation; managed PTY stays blocked. The UI renders clear action buttons instead of leaving users at `draft`/`queued` without a next step.

**Tech Stack:** TypeScript local server, existing bridge API stores, self-contained Project Console HTML, Node test runner with jsdom.

---

## Decision Summary

This plan does not make Conversation mode an arbitrary command runner.

Allowed in this plan:

- Plain Conversation messages may create a governed action preview.
- `review-command` routes may create a pending review in `previewed` state.
- `workbuddy-execution` routes may create a confirmable WorkBuddy conversation execution request.
- UI may expose explicit Confirm / Dispatch controls for those server-owned actions.
- Confirm / Dispatch action routes must require the local Console cookie credential.
- Revoke, pairing, token discipline, and existing route auth remain unchanged.

Still forbidden:

- No generic `/exec`, `/run`, `/shell`, terminal, Git, PR, workspace write, or command argv endpoint.
- No automatic dispatch of model/user text without an existing gate.
- No extension-side route selection or permission expansion.
- No extension-session-token Confirm / Dispatch, even when the extension is paired.
- No managed PTY conversation dispatch in this phase.
- No auto-confirm of pending prompts, reviews, proposals, or WorkBuddy tasks.

## Why The Current UI Shows `draft`

The current implementation completed authentication and transcript routing, not execution activation.

Current behavior:

- Goal creation returns `draft` until the operator runs `plan` and approval steps.
- `review-command` conversation returns `not-implemented` with review-only guidance.
- `workbuddy-execution` conversation records a transcript event with `queued`, but does not create a claimable WorkBuddy task.
- `managed-pty` remains `not-implemented`.

Target behavior:

- Conversation mode gives the operator a visible next action.
- Review targets show `awaiting-manual-confirmation` with a review id and Confirm / Dispatch controls.
- WorkBuddy targets show `awaiting-manual-confirmation` with a conversation execution request id and Confirm / Queue controls.
- Once confirmed, WorkBuddy tasks appear in the existing WorkBuddy inbox and are claimable by WorkBuddy.

## File Structure

Create:

- `apps/local-server/src/storage/conversation-action-store.ts`
  - Owns confirmable Conversation action records.
  - Tracks action id, project id, transcript event ids, route kind, target endpoint, payload hash, status, and linked review/task/proposal ids.

- `tests/conversation-execution-api.test.mjs`
  - Contract tests for review-command and WorkBuddy activation.

- `tests/project-console-conversation-execution.test.mjs`
  - jsdom behavior tests for action buttons and transcript rendering.

- `docs/planning/ADR-0026-conversation-execution-activation.md`
  - Review boundary for enabling Conversation-to-action activation.

Modify:

- `apps/local-server/src/routes/bridge-api.ts`
  - Instantiate and persist `conversationActionStore`.
  - Make `POST /bridge/projects/:key/conversation/messages` create action previews for supported route kinds.
  - Add `POST /bridge/projects/:key/conversation/actions/:actionId/confirm`.
  - Add `POST /bridge/projects/:key/conversation/actions/:actionId/dispatch`.

- `apps/local-server/src/server.ts`
  - Pass bridge auth context into bridge route handling.
  - Ensure Conversation action confirm/dispatch routes accept only Console cookie auth, not extension session auth.

- `apps/local-server/src/storage/json-snapshot-store.ts`
  - Persist conversation actions.

- `apps/local-server/src/routes/project-console.ts`
  - Render conversation action buttons.
  - Wire Confirm / Dispatch to new action routes.
  - Replace confusing `draft`/bare `queued` display with actionable labels.

- `tests/project-console-ui.test.mjs`
  - Update endpoint allowlist for the new conversation action routes.

Do not modify:

- Pairing token generation or auto-pair auth.
- Extension token storage.
- ChatGPT DOM submit selectors or auto-send behavior.
- Generic command runner allowlists.

## Data Model

Create `apps/local-server/src/storage/conversation-action-store.ts`:

```ts
import { createHash, randomUUID } from 'node:crypto';
import type { ConversationRouteKind } from './conversation-pairing-store.ts';

export type ConversationActionStatus =
  | 'previewed'
  | 'confirmed'
  | 'dispatching'
  | 'queued'
  | 'returned'
  | 'failed'
  | 'cancelled';

export interface ConversationAction {
  id: string;
  projectId: string;
  sourceEndpointId: string;
  targetEndpointId: string;
  routeKind: ConversationRouteKind;
  userEventId: string;
  bridgeEventId: string;
  textHash: string;
  preview: string;
  status: ConversationActionStatus;
  linkedReviewId?: string;
  linkedWorkBuddyTaskId?: string;
  failureReason?: string;
  createdAt: number;
  updatedAt: number;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function hashText(text: string): string {
  return `sha256:${createHash('sha256').update(text).digest('hex')}`;
}

export class InMemoryConversationActionStore {
  private readonly actions = new Map<string, ConversationAction>();

  createPreview(input: Omit<ConversationAction, 'id' | 'textHash' | 'status' | 'createdAt' | 'updatedAt'> & { text: string; now?: number }): ConversationAction {
    const now = input.now ?? Date.now();
    const action: ConversationAction = {
      id: randomUUID(),
      projectId: input.projectId,
      sourceEndpointId: input.sourceEndpointId,
      targetEndpointId: input.targetEndpointId,
      routeKind: input.routeKind,
      userEventId: input.userEventId,
      bridgeEventId: input.bridgeEventId,
      textHash: hashText(input.text),
      preview: input.preview,
      linkedReviewId: input.linkedReviewId,
      linkedWorkBuddyTaskId: input.linkedWorkBuddyTaskId,
      status: 'previewed',
      createdAt: now,
      updatedAt: now,
    };
    this.actions.set(action.id, clone(action));
    return clone(action);
  }

  get(actionId: string): ConversationAction | undefined {
    const action = this.actions.get(actionId);
    return action ? clone(action) : undefined;
  }

  listByProject(projectId: string): ConversationAction[] {
    return Array.from(this.actions.values())
      .filter(action => action.projectId === projectId)
      .sort((a, b) => a.createdAt - b.createdAt)
      .map(clone);
  }

  confirm(actionId: string, now: number = Date.now()): ConversationAction | undefined {
    const action = this.actions.get(actionId);
    if (!action || action.status !== 'previewed') return undefined;
    action.status = 'confirmed';
    action.updatedAt = now;
    this.actions.set(action.id, clone(action));
    return clone(action);
  }

  markDispatching(actionId: string, now: number = Date.now()): ConversationAction | undefined {
    const action = this.actions.get(actionId);
    if (!action || action.status !== 'confirmed') return undefined;
    action.status = 'dispatching';
    action.updatedAt = now;
    this.actions.set(action.id, clone(action));
    return clone(action);
  }

  markQueued(actionId: string, linkedWorkBuddyTaskId: string, now: number = Date.now()): ConversationAction | undefined {
    const action = this.actions.get(actionId);
    if (!action || action.status !== 'dispatching') return undefined;
    action.status = 'queued';
    action.linkedWorkBuddyTaskId = linkedWorkBuddyTaskId;
    action.updatedAt = now;
    this.actions.set(action.id, clone(action));
    return clone(action);
  }

  fail(actionId: string, failureReason: string, now: number = Date.now()): ConversationAction | undefined {
    const action = this.actions.get(actionId);
    if (!action) return undefined;
    action.status = 'failed';
    action.failureReason = failureReason;
    action.updatedAt = now;
    this.actions.set(action.id, clone(action));
    return clone(action);
  }

  hydrateAction(action: ConversationAction): void {
    if (!action || typeof action.id !== 'string' || typeof action.projectId !== 'string') return;
    this.actions.set(action.id, clone(action));
  }

  exportActions(): ConversationAction[] {
    return Array.from(this.actions.values(), clone);
  }
}
```

## Task 0: ADR Boundary

**Files:**
- Create: `docs/planning/ADR-0026-conversation-execution-activation.md`

- [ ] **Step 1: Create the ADR**

Create `docs/planning/ADR-0026-conversation-execution-activation.md`:

```md
# ADR-0026: Conversation Execution Activation

Status: Proposed

Date: 2026-07-01

## Context

ADR-0025 made the Project Console and installed extension obtain local bridge
credentials without manual token entry. Conversation mode can now receive text,
but currently only writes transcript events and route-status explanations. Users
see `draft`, `queued`, or `not-implemented` without a governed next action.

## Decision

CLI Bridge may turn Conversation messages into server-owned action previews for
existing governed routes. Review-command targets may create previewed review
requests. WorkBuddy targets may create confirmable execution requests that are
queued only after explicit confirmation.

## Constraints

- No automatic dispatch from raw conversation text.
- No generic shell, run, exec, Git, PR, or workspace mutation endpoint.
- Managed PTY conversation dispatch remains blocked.
- All mutating actions require server-owned confirmation state.
- Conversation action confirm/dispatch requires local Console cookie auth.
- Returned model or ChatGPT content remains untrusted data.
- Extension code may not choose target routes or confirm/dispatch actions.
- Existing route authentication and pairing boundaries remain unchanged.

## Acceptance Conditions

This ADR requires explicit human acceptance before EX implementation.
```

- [ ] **Step 2: Verify boundary phrases**

Run:

```bash
rg -n "Status: Proposed|No automatic dispatch|Managed PTY|explicit human acceptance|No generic shell" docs/planning/ADR-0026-conversation-execution-activation.md
```

Expected: all phrases present.

- [ ] **Step 3: Commit**

```bash
git add docs/planning/ADR-0026-conversation-execution-activation.md
git commit -m "docs: propose conversation execution activation boundary"
```

## Task 1: Conversation Action Store

**Files:**
- Create: `apps/local-server/src/storage/conversation-action-store.ts`
- Test: `tests/conversation-execution-api.test.mjs`

- [ ] **Step 1: Add failing store tests**

Create `tests/conversation-execution-api.test.mjs` with this first test:

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { InMemoryConversationActionStore } from '../apps/local-server/src/storage/conversation-action-store.ts';

test('conversation action store creates and confirms action previews', () => {
  const store = new InMemoryConversationActionStore();
  const action = store.createPreview({
    projectId: 'cli-bridge',
    sourceEndpointId: 'chatgpt-web',
    targetEndpointId: 'workbuddy',
    routeKind: 'workbuddy-execution',
    userEventId: 'user-1',
    bridgeEventId: 'bridge-1',
    text: 'implement the README fix',
    preview: 'WorkBuddy will prepare a gated execution task.',
    now: 1000,
  });

  assert.equal(action.status, 'previewed');
  assert.equal(action.projectId, 'cli-bridge');
  assert.match(action.textHash, /^sha256:/);
  assert.equal(action.preview.includes('README'), true);

  const confirmed = store.confirm(action.id, 1100);
  assert.equal(confirmed.status, 'confirmed');
  assert.equal(confirmed.updatedAt, 1100);
  assert.equal(store.confirm(action.id), undefined);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node --experimental-strip-types --test tests/conversation-execution-api.test.mjs
```

Expected: FAIL because `conversation-action-store.ts` does not exist.

- [ ] **Step 3: Implement store**

Create `apps/local-server/src/storage/conversation-action-store.ts` using the full Data Model code above.

- [ ] **Step 4: Run store test**

```bash
node --experimental-strip-types --test tests/conversation-execution-api.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/local-server/src/storage/conversation-action-store.ts tests/conversation-execution-api.test.mjs
git commit -m "feat: add conversation action store"
```

## Task 2: Runtime Persistence And Read API

**Files:**
- Modify: `apps/local-server/src/routes/bridge-api.ts`
- Modify: `apps/local-server/src/storage/json-snapshot-store.ts`
- Test: `tests/conversation-execution-api.test.mjs`

- [ ] **Step 1: Add failing persistence/read test**

Append to `tests/conversation-execution-api.test.mjs`:

```js
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBridgeRuntime, handleBridgeRequest } from '../apps/local-server/src/routes/bridge-api.ts';

function jsonRequest(body) {
  const text = body === undefined ? '' : JSON.stringify(body);
  async function* gen() {
    if (text.length > 0) yield Buffer.from(text, 'utf8');
  }
  return gen();
}

async function call(runtime, method, path, body) {
  return handleBridgeRequest(runtime, method, path, jsonRequest(body));
}

test('conversation actions are returned with conversation messages and survive reload', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'conversation-actions-'));
  try {
    const runtimeA = createBridgeRuntime({ dataDir: dir });
    runtimeA.conversationActionStore.createPreview({
      projectId: 'cli-bridge',
      sourceEndpointId: 'chatgpt-web',
      targetEndpointId: 'workbuddy',
      routeKind: 'workbuddy-execution',
      userEventId: 'user-1',
      bridgeEventId: 'bridge-1',
      text: 'ship this',
      preview: 'Preview text',
      now: 1000,
    });
    runtimeA.persist();

    const runtimeB = createBridgeRuntime({ dataDir: dir });
    const res = await call(runtimeB, 'GET', '/bridge/projects/cli-bridge/conversation/messages');
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.actions.length, 1);
    assert.equal(res.payload.actions[0].status, 'previewed');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node --experimental-strip-types --test tests/conversation-execution-api.test.mjs
```

Expected: FAIL because runtime lacks `conversationActionStore` and GET response lacks `actions`.

- [ ] **Step 3: Wire runtime**

In `apps/local-server/src/routes/bridge-api.ts`:

```ts
import { InMemoryConversationActionStore } from '../storage/conversation-action-store.ts';
```

Add to `BridgeRuntime`:

```ts
conversationActionStore: InMemoryConversationActionStore;
```

In `createBridgeRuntime()` instantiate:

```ts
const conversationActionStore = new InMemoryConversationActionStore();
```

Hydrate from snapshot:

```ts
for (const action of read.snapshot.conversationActions ?? []) {
  try { conversationActionStore.hydrateAction(action); } catch { }
}
```

Persist to snapshot:

```ts
conversationActions: conversationActionStore.exportActions(),
```

Return in runtime object:

```ts
conversationActionStore,
```

In `GET /conversation/messages`, return:

```ts
return ok({
  messages: runtime.conversationTranscriptStore.listByProject(key),
  actions: runtime.conversationActionStore.listByProject(key),
});
```

- [ ] **Step 4: Update snapshot types**

In `apps/local-server/src/storage/json-snapshot-store.ts`, add:

```ts
conversationActions?: import('./conversation-action-store.ts').ConversationAction[];
```

to the snapshot interface.

- [ ] **Step 5: Run tests**

```bash
node --experimental-strip-types --test tests/conversation-execution-api.test.mjs
npm run typecheck
```

Expected: PASS and typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add apps/local-server/src/routes/bridge-api.ts apps/local-server/src/storage/json-snapshot-store.ts tests/conversation-execution-api.test.mjs
git commit -m "feat: persist conversation actions"
```

## Task 3: Review-Command Conversation Activation

**Files:**
- Modify: `apps/local-server/src/routes/bridge-api.ts`
- Test: `tests/conversation-execution-api.test.mjs`

- [ ] **Step 1: Add failing review activation test**

Append:

```js
test('review-command conversation creates a previewed review action', async () => {
  const runtime = createBridgeRuntime();
  await call(runtime, 'PUT', '/bridge/projects/cli-bridge/conversation-pairing', {
    sourceEndpointId: 'chatgpt-web',
    targetEndpointId: 'claude-code-command',
  });

  const res = await call(runtime, 'POST', '/bridge/projects/cli-bridge/conversation/messages', {
    text: 'review the current README plan',
  });

  assert.equal(res.statusCode, 201);
  const action = res.payload.actions[0];
  assert.equal(action.routeKind, 'review-command');
  assert.equal(action.status, 'previewed');
  assert.equal(typeof action.linkedReviewId, 'string');
  assert.equal(res.payload.events[1].status, 'awaiting-manual-confirmation');
  assert.match(res.payload.events[1].text, /Review preview created/);

  const review = runtime.pendingReviewStore.get(action.linkedReviewId);
  assert.equal(review.status, 'previewed');
  assert.equal(review.prompt, 'review the current README plan');
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node --experimental-strip-types --test tests/conversation-execution-api.test.mjs
```

Expected: FAIL because conversation messages still return `not-implemented`.

- [ ] **Step 3: Implement review activation**

In `POST /conversation/messages`, replace the `review-command` branch with:

```ts
} else if (pairing.targetRouteKind === 'review-command') {
  const review = runtime.pendingReviewStore.createDraft({
    sessionId: `conversation:${key}`,
    sourceEndpointId: pairing.sourceEndpointId,
    targetEndpointId: pairing.targetEndpointId,
    prompt: text,
    projectId: key,
  });
  const previewed = runtime.pendingReviewStore.preview(review.id) ?? review;
  bridgeStatus = 'awaiting-manual-confirmation';
  bridgeText = `Review preview created. Confirm and dispatch review ${previewed.id}.`;
```

After creating `bridgeEvent`, add:

```ts
const actions: ConversationAction[] = [];
if (pairing.targetRouteKind === 'review-command' && previewedReview) {
  actions.push(runtime.conversationActionStore.createPreview({
    projectId: key,
    sourceEndpointId: pairing.sourceEndpointId,
    targetEndpointId: pairing.targetEndpointId,
    routeKind: pairing.targetRouteKind,
    userEventId: userEvent.id,
    bridgeEventId: bridgeEvent.id,
    text,
    preview: `Review command preview for ${pairing.targetEndpointId}`,
    linkedReviewId: previewedReview.id,
  }));
}
```

Return:

```ts
return created({ events: [userEvent, bridgeEvent], actions });
```

Use a local variable before the branch:

```ts
let previewedReview: ReturnType<typeof runtime.pendingReviewStore.get> | undefined;
```

- [ ] **Step 4: Run focused tests**

```bash
node --experimental-strip-types --test tests/conversation-execution-api.test.mjs tests/bridge-reviews-api.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/local-server/src/routes/bridge-api.ts tests/conversation-execution-api.test.mjs
git commit -m "feat: create review actions from conversation"
```

## Task 4: Conversation Action Confirm And Dispatch Routes

**Files:**
- Modify: `apps/local-server/src/server.ts`
- Modify: `apps/local-server/src/routes/bridge-api.ts`
- Test: `tests/conversation-execution-api.test.mjs`
- Test: `tests/local-launcher.test.mjs`

- [ ] **Step 1: Add failing confirm/dispatch test for review actions**

Append:

```js
test('conversation review action confirm and dispatch use existing review gates', async () => {
  const runtime = createBridgeRuntime();
  await call(runtime, 'PUT', '/bridge/projects/cli-bridge/conversation-pairing', {
    sourceEndpointId: 'chatgpt-web',
    targetEndpointId: 'claude-code-command',
  });
  const created = await call(runtime, 'POST', '/bridge/projects/cli-bridge/conversation/messages', {
    text: 'review this safely',
  });
  const action = created.payload.actions[0];

  const confirmed = await call(runtime, 'POST', `/bridge/projects/cli-bridge/conversation/actions/${action.id}/confirm`, {});
  assert.equal(confirmed.statusCode, 200);
  assert.equal(confirmed.payload.action.status, 'confirmed');
  assert.equal(runtime.pendingReviewStore.get(action.linkedReviewId).status, 'confirmed');

  const dispatched = await call(runtime, 'POST', `/bridge/projects/cli-bridge/conversation/actions/${action.id}/dispatch`, {});
  assert.equal(dispatched.statusCode, 200);
  assert.equal(dispatched.payload.action.status === 'queued' || dispatched.payload.action.status === 'returned', true);
});
```

- [ ] **Step 2: Add failing auth-source boundary test**

Append a focused integration test that obtains an extension session token through
the local auto-pair claim flow and then attempts:

```http
POST /bridge/projects/cli-bridge/conversation/actions/:actionId/confirm
POST /bridge/projects/cli-bridge/conversation/actions/:actionId/dispatch
```

Expected result: both return `403` when authenticated only by extension session
token. The same action must still confirm and dispatch when authenticated by the
Console cookie created by `GET /console/project`.

This test is required because normal bridge authentication accepts both Console
cookies and extension session tokens. Conversation action confirmation is a
local operator decision, so the route needs a narrower auth-source gate.

- [ ] **Step 3: Run tests to verify they fail**

```bash
node --experimental-strip-types --test tests/conversation-execution-api.test.mjs tests/local-launcher.test.mjs
```

Expected: FAIL with 404/405 for missing action routes and/or FAIL because
extension session auth can still reach the new confirm/dispatch route.

- [ ] **Step 4: Thread bridge auth context into route handling**

In `apps/local-server/src/server.ts`, make bridge authentication return an auth
context such as:

```ts
type BridgeAuthKind = 'console-cookie' | 'pairing-token' | 'extension-session';
```

Pass that context into `handleBridgeRequest(...)`.

In `apps/local-server/src/routes/bridge-api.ts`, accept the context as a narrow
optional parameter used only by routes that need source-specific authorization.
Do not change broad bridge route behavior.

- [ ] **Step 5: Add route matcher**

In `apps/local-server/src/routes/bridge-api.ts`, add:

```ts
function projectConversationActionPath(pathname: string): { matched: true; key: string; actionId: string; sub: 'confirm' | 'dispatch' } | { matched: false } {
  const prefix = `${BRIDGE_PROJECTS_PATH}/`;
  if (!pathname.startsWith(prefix)) return { matched: false };
  const rest = pathname.slice(prefix.length);
  const parts = rest.split('/');
  if (parts.length !== 5 || parts[1] !== 'conversation' || parts[2] !== 'actions') return { matched: false };
  const sub = parts[4];
  if (sub !== 'confirm' && sub !== 'dispatch') return { matched: false };
  try {
    return {
      matched: true,
      key: decodeURIComponent(parts[0]).trim(),
      actionId: decodeURIComponent(parts[3]).trim(),
      sub,
    };
  } catch {
    return { matched: true, key: '', actionId: '', sub: sub as 'confirm' | 'dispatch' };
  }
}
```

- [ ] **Step 6: Implement confirm route**

Before the final `return error(404, ...)`, add:

```ts
const conversationActionPath = projectConversationActionPath(pathname);
if (conversationActionPath.matched) {
  if (authContext?.kind !== 'console-cookie') return error(403, 'Conversation action confirmation requires local Console session');
  if (!conversationActionPath.key || !conversationActionPath.actionId) return error(400, 'Invalid conversation action path');
  const project = runtime.projectStore.get(conversationActionPath.key);
  if (!project) return error(404, 'Project not found');
  const action = runtime.conversationActionStore.get(conversationActionPath.actionId);
  if (!action || action.projectId !== conversationActionPath.key) return error(404, 'Conversation action not found');
  if (project.archivedAt) return error(409, 'Cannot modify conversation action in archived project');
  if (method !== 'POST') return error(405, 'Method not allowed');

  if (conversationActionPath.sub === 'confirm') {
    if (action.routeKind === 'review-command') {
      if (!action.linkedReviewId) return error(409, 'Conversation action has no linked review');
      const confirmedReview = runtime.pendingReviewStore.confirm(action.linkedReviewId);
      if (!confirmedReview) return error(409, 'Linked review cannot be confirmed');
      const confirmedAction = runtime.conversationActionStore.confirm(action.id);
      runtime.persist();
      return ok({ action: confirmedAction, review: confirmedReview });
    }
    const confirmedAction = runtime.conversationActionStore.confirm(action.id);
    if (!confirmedAction) return error(409, 'Conversation action cannot be confirmed');
    runtime.persist();
    return ok({ action: confirmedAction });
  }
```

- [ ] **Step 7: Implement review dispatch route**

Continue inside the same route:

```ts
  if (conversationActionPath.sub === 'dispatch') {
    if (action.status !== 'confirmed') return error(409, 'Conversation action must be confirmed before dispatch');
    const dispatching = runtime.conversationActionStore.markDispatching(action.id);
    if (!dispatching) return error(409, 'Conversation action cannot dispatch');
    if (action.routeKind === 'review-command') {
      if (!action.linkedReviewId) return error(409, 'Conversation action has no linked review');
      const review = runtime.pendingReviewStore.get(action.linkedReviewId);
      if (!review || review.status !== 'confirmed') return error(409, 'Linked review must be confirmed');
      runtime.conversationActionStore.markQueued(action.id, action.linkedReviewId);
      runtime.persist();
      return ok({
        action: runtime.conversationActionStore.get(action.id),
        review,
        message: 'Review action is confirmed. Use /bridge/reviews/dispatch for the governed CLI run.',
      });
    }
    return error(409, `Conversation action route ${action.routeKind} cannot dispatch yet`);
  }
}
```

This keeps the real CLI review dispatch in the existing `/bridge/reviews/dispatch` path. Conversation dispatch marks the action queued and points the UI to the governed review dispatch route.

- [ ] **Step 8: Run tests**

```bash
node --experimental-strip-types --test tests/conversation-execution-api.test.mjs tests/bridge-reviews-api.test.mjs tests/local-launcher.test.mjs
npm run typecheck
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/local-server/src/server.ts apps/local-server/src/routes/bridge-api.ts tests/conversation-execution-api.test.mjs tests/local-launcher.test.mjs
git commit -m "feat: confirm conversation review actions"
```

## Task 5: WorkBuddy Conversation Activation

**Files:**
- Modify: `apps/local-server/src/routes/bridge-api.ts`
- Test: `tests/conversation-execution-api.test.mjs`

- [ ] **Step 1: Add failing WorkBuddy action test**

Append:

```js
test('workbuddy conversation action confirms and queues a WorkBuddy inbox task', async () => {
  const runtime = createBridgeRuntime();
  await call(runtime, 'PUT', '/bridge/projects/cli-bridge/conversation-pairing', {
    sourceEndpointId: 'chatgpt-web',
    targetEndpointId: 'workbuddy',
  });
  const created = await call(runtime, 'POST', '/bridge/projects/cli-bridge/conversation/messages', {
    text: 'inspect the repo and propose the smallest fix',
  });
  const action = created.payload.actions[0];
  assert.equal(action.routeKind, 'workbuddy-execution');
  assert.equal(action.status, 'previewed');

  const confirmed = await call(runtime, 'POST', `/bridge/projects/cli-bridge/conversation/actions/${action.id}/confirm`, {});
  assert.equal(confirmed.statusCode, 200);
  assert.equal(confirmed.payload.action.status, 'confirmed');

  const dispatched = await call(runtime, 'POST', `/bridge/projects/cli-bridge/conversation/actions/${action.id}/dispatch`, {});
  assert.equal(dispatched.statusCode, 200);
  assert.equal(dispatched.payload.action.status, 'queued');
  assert.equal(typeof dispatched.payload.task.taskId, 'string');

  const inbox = await call(runtime, 'GET', '/bridge/endpoints/workbuddy/inbox/next');
  assert.equal(inbox.statusCode, 200);
  assert.equal(inbox.payload.task.taskId, dispatched.payload.task.taskId);
  assert.match(inbox.payload.task.prompt, /inspect the repo/);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node --experimental-strip-types --test tests/conversation-execution-api.test.mjs
```

Expected: FAIL because WorkBuddy actions do not enqueue.

- [ ] **Step 3: Create WorkBuddy preview action**

In `POST /conversation/messages`, replace the `workbuddy-execution` branch with:

```ts
} else if (pairing.targetRouteKind === 'workbuddy-execution') {
  bridgeStatus = 'awaiting-manual-confirmation';
  bridgeText = 'WorkBuddy execution preview created. Confirm to queue a WorkBuddy task.';
```

After `bridgeEvent`, add action creation:

```ts
if (pairing.targetRouteKind === 'workbuddy-execution') {
  actions.push(runtime.conversationActionStore.createPreview({
    projectId: key,
    sourceEndpointId: pairing.sourceEndpointId,
    targetEndpointId: pairing.targetEndpointId,
    routeKind: pairing.targetRouteKind,
    userEventId: userEvent.id,
    bridgeEventId: bridgeEvent.id,
    text,
    preview: `WorkBuddy task preview for ${pairing.targetEndpointId}`,
  }));
}
```

- [ ] **Step 4: Implement WorkBuddy dispatch**

In the conversation action dispatch route, add before the review-command dispatch block:

```ts
    if (action.routeKind === 'workbuddy-execution') {
      const task = runtime.workbuddyExecution.enqueue({
        endpointId: action.targetEndpointId,
        proposalId: action.id,
        planId: `conversation:${action.projectId}`,
        goalId: `conversation:${action.projectId}`,
        bindingHash: action.textHash,
        prompt: action.preview,
        workingDirectory: process.cwd(),
        timeoutMs: 120_000,
      });
      const queued = runtime.conversationActionStore.markQueued(action.id, task.taskId);
      runtime.persist();
      return ok({ action: queued, task });
    }
```

This is not a generic execution proposal. It is a bounded WorkBuddy inbox task with server-owned endpoint, working directory, timeout, and prompt.

- [ ] **Step 5: Run tests**

```bash
node --experimental-strip-types --test tests/conversation-execution-api.test.mjs tests/bridge-workbuddy-api.test.mjs
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/local-server/src/routes/bridge-api.ts tests/conversation-execution-api.test.mjs
git commit -m "feat: queue workbuddy tasks from conversation"
```

## Task 6: Project Console Action UI

**Files:**
- Modify: `apps/local-server/src/routes/project-console.ts`
- Modify: `tests/project-console-ui.test.mjs`
- Test: `tests/project-console-conversation-execution.test.mjs`

- [ ] **Step 1: Add failing UI behavior tests**

Create `tests/project-console-conversation-execution.test.mjs`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { renderProjectConsoleHtml } from '../apps/local-server/src/routes/project-console.ts';

async function waitFor(predicate, timeoutMs = 500) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('waitFor timeout');
}

function setup() {
  const html = renderProjectConsoleHtml();
  const calls = [];
  const fixtures = {};
  const dom = new JSDOM(html, {
    url: 'http://127.0.0.1:31337/console/project',
    runScripts: 'dangerously',
    resources: 'usable',
    beforeParse(win) {
      Object.defineProperty(win, 'localStorage', {
        value: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
        configurable: true,
      });
      win.fetch = async (url, init = {}) => {
        const path = new URL(String(url)).pathname;
        calls.push({ path, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null });
        const fixture = fixtures[path];
        return {
          ok: fixture?.ok !== false,
          status: fixture?.status ?? 200,
          json: async () => fixture?.payload ?? {},
        };
      };
    },
  });
  return { document: dom.window.document, calls, fixtures };
}

test('conversation action buttons confirm and dispatch server-owned actions', async () => {
  const { document, calls, fixtures } = setup();
  fixtures['/health/private'] = { payload: { ok: true } };
  fixtures['/bridge/projects/cli-bridge/conversation/messages'] = {
    status: 201,
    payload: {
      events: [
        { id: 'u1', role: 'user', text: 'do useful work', status: 'queued', routeKind: 'workbuddy-execution' },
        { id: 'b1', role: 'bridge', text: 'Confirm to queue', status: 'awaiting-manual-confirmation', routeKind: 'workbuddy-execution' },
      ],
      actions: [
        { id: 'act-1', status: 'previewed', routeKind: 'workbuddy-execution', preview: 'WorkBuddy preview' },
      ],
    },
  };
  fixtures['/bridge/projects/cli-bridge/conversation/actions/act-1/confirm'] = {
    payload: { action: { id: 'act-1', status: 'confirmed', routeKind: 'workbuddy-execution', preview: 'WorkBuddy preview' } },
  };
  fixtures['/bridge/projects/cli-bridge/conversation/actions/act-1/dispatch'] = {
    payload: { action: { id: 'act-1', status: 'queued', routeKind: 'workbuddy-execution', preview: 'WorkBuddy preview' } },
  };

  await waitFor(() => document.getElementById('conn-dot').classList.contains('ok'));
  document.getElementById('composer-mode-toggle').click();
  document.getElementById('command-input').value = 'do useful work';
  document.getElementById('command-send').click();
  await waitFor(() => document.querySelector('[data-conversation-action-confirm="act-1"]'));

  document.querySelector('[data-conversation-action-confirm="act-1"]').click();
  await waitFor(() => calls.some(call => call.path.endsWith('/confirm')));
  document.querySelector('[data-conversation-action-dispatch="act-1"]').click();
  await waitFor(() => calls.some(call => call.path.endsWith('/dispatch')));

  assert.equal(calls.some(call => call.path.includes('/exec') || call.path.includes('/run')), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node --experimental-strip-types --test tests/project-console-conversation-execution.test.mjs
```

Expected: FAIL because action buttons are not rendered.

- [ ] **Step 3: Store and render actions**

In `project-console.ts`, add to store:

```js
conversationActions: [],
```

In `sendConversationMessage`, after success:

```js
store.conversationActions = mergeConversationActions(store.conversationActions || [], res.data?.actions || []);
```

Add:

```js
function mergeConversationActions(existing, incoming) {
  const byId = {};
  existing.forEach(action => { byId[action.id] = action; });
  incoming.forEach(action => { byId[action.id] = action; });
  return Object.values(byId);
}
```

In `renderConversationTranscript`, append action HTML:

```js
const actions = store.conversationActions || [];
const actionHtml = actions.map(action => renderConversationAction(action)).join('');
el.innerHTML = eventsHtml + actionHtml;
bindConversationActionButtons();
```

Add:

```js
function renderConversationAction(action) {
  const canConfirm = action.status === 'previewed';
  const canDispatch = action.status === 'confirmed';
  return '<div class="timeline-entry" data-conversation-action="' + escapeHtml(action.id) + '">'
    + '<div class="origin system">action</div>'
    + '<div class="body">' + escapeHtml(action.preview || action.routeKind)
    + '<div class="time"><span class="pill">' + escapeHtml(action.status) + '</span> ' + escapeHtml(action.routeKind || '') + '</div>'
    + '<div class="context-actions">'
    + '<button data-conversation-action-confirm="' + escapeHtml(action.id) + '"' + (canConfirm ? '' : ' disabled') + '>Confirm</button>'
    + '<button data-conversation-action-dispatch="' + escapeHtml(action.id) + '"' + (canDispatch ? '' : ' disabled') + '>Dispatch</button>'
    + '</div></div></div>';
}
```

- [ ] **Step 4: Wire action buttons**

Add:

```js
function bindConversationActionButtons() {
  document.querySelectorAll('[data-conversation-action-confirm]').forEach(button => {
    button.addEventListener('click', async () => {
      const actionId = button.getAttribute('data-conversation-action-confirm');
      await runConversationAction(actionId, 'confirm');
    });
  });
  document.querySelectorAll('[data-conversation-action-dispatch]').forEach(button => {
    button.addEventListener('click', async () => {
      const actionId = button.getAttribute('data-conversation-action-dispatch');
      await runConversationAction(actionId, 'dispatch');
    });
  });
}

async function runConversationAction(actionId, action) {
  const res = await api('/bridge/projects/' + encodeURIComponent(store.activeProjectKey) + '/conversation/actions/' + encodeURIComponent(actionId) + '/' + action, 'POST', {});
  if (!res.ok) {
    appendCommandMessage(action + ' conversation action', 'Conversation action failed: ' + escapeHtml(res.data?.message || res.status), true);
    setCommandStatus('conversation action failed', true);
    return;
  }
  store.conversationActions = mergeConversationActions(store.conversationActions || [], [res.data.action]);
  renderConversationTranscript();
  setCommandStatus('conversation action ' + action + 'ed');
}
```

- [ ] **Step 5: Update allowlist tests**

In `tests/project-console-ui.test.mjs`, include:

```js
'/bridge/projects/'
'/conversation/actions/'
```

or update the existing path extraction allowlist to allow paths matching:

```js
path.includes('/conversation/actions/') && (path.endsWith('/confirm') || path.endsWith('/dispatch'))
```

- [ ] **Step 6: Run UI tests**

```bash
node --experimental-strip-types --test tests/project-console-conversation-execution.test.mjs tests/project-console-ui.test.mjs tests/project-console-behavior.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/local-server/src/routes/project-console.ts tests/project-console-conversation-execution.test.mjs tests/project-console-ui.test.mjs
git commit -m "feat: add conversation action controls"
```

## Task 7: Full Verification And Browser Acceptance

**Files:**
- Test only unless defects are found.

- [ ] **Step 1: Run full gates**

```bash
npm run typecheck
npm run lint
node --experimental-strip-types --test tests/conversation-execution-api.test.mjs tests/project-console-conversation-execution.test.mjs tests/conversation-pairing-api.test.mjs tests/project-console-behavior.test.mjs tests/project-console-ui.test.mjs
npm test
git diff --check
```

Expected: all pass.

- [ ] **Step 2: Browser acceptance**

Run a real Chromium acceptance equivalent to:

1. Start local server.
2. Open `http://127.0.0.1:31337/console/project`.
3. Confirm auto-pair works without manual token entry.
4. Configure Conversation pairing to `chatgpt-web -> workbuddy`.
5. Switch composer to Conversation.
6. Send `inspect the repo and propose the smallest safe next step`.
7. Confirm transcript shows an action with `previewed`.
8. Click Confirm.
9. Confirm action becomes `confirmed`.
10. Click Dispatch.
11. Confirm action becomes `queued`.
12. Call `/bridge/endpoints/workbuddy/inbox/next` with the current auth credential and confirm the task is claimable.
13. Confirm URL, visible DOM, localStorage, and repo scan do not contain the printed pairing token.

- [ ] **Step 3: Commit acceptance note only if required**

Do not commit screenshots or token-bearing artifacts.

## Acceptance Criteria

- Plain Conversation mode no longer strands users at bare `draft`/`queued` without a next action.
- Review-command conversations create previewed review actions.
- WorkBuddy conversations create previewed execution actions.
- No conversation action dispatches without explicit confirmation.
- Managed PTY remains blocked.
- Extension and ChatGPT content scripts cannot confirm or dispatch actions.
- Conversation action confirm/dispatch succeeds only with local Console cookie auth.
- All new routes require existing bridge authentication.
- No new shell/run/exec/Git/PR endpoint is introduced.
- Full tests and real browser acceptance pass.

## Review Checklist

- Does any raw conversation text become execution without a server-owned preview?
- Can a non-confirmed action dispatch?
- Can an extension session token confirm or dispatch a conversation action?
- Can archived projects mutate conversation actions?
- Does WorkBuddy receive only server-owned endpoint, working directory, timeout, and prompt?
- Do UI buttons call only `/conversation/actions/:id/confirm` and `/dispatch`?
- Are existing review and WorkBuddy gates preserved?
- Does any token enter URL, visible DOM, localStorage, logs, reports, or committed artifacts?

## Execution Recommendation

Use Subagent-Driven execution after ADR-0026 acceptance:

1. Task 0 inline by reviewing agent.
2. Tasks 1-2 by one storage/runtime agent.
3. Tasks 3-5 as separate route agents with review between tasks.
4. Task 6 by a UI agent.
5. Task 7 by reviewing agent with real browser evidence.

Do not execute implementation before ADR-0026 is explicitly accepted.
