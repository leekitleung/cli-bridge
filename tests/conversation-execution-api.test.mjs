// Conversation Execution API contract tests.

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
  assert.equal(action.preview.includes('gated'), true);

  const confirmed = store.confirm(action.id, 1100);
  assert.equal(confirmed.status, 'confirmed');
  assert.equal(confirmed.updatedAt, 1100);
  assert.equal(store.confirm(action.id), undefined);
});

// --- Task 2: Runtime Persistence And Read API ---

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

async function call(runtime, method, path, body, authContext) {
  return handleBridgeRequest(runtime, method, path, jsonRequest(body), undefined, authContext);
}

const CONSOLE_AUTH = { kind: 'console-cookie' };

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

// --- Task 3: Review-Command Conversation Activation ---

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
  assert.match(res.payload.events[1].text, /review preview created/i);

  const review = runtime.pendingReviewStore.get(action.linkedReviewId);
  assert.equal(review.status, 'previewed');
  assert.equal(review.prompt, 'review the current README plan');
});

// --- Task 4: Conversation Action Confirm And Dispatch Routes ---

test('conversation review action confirm and dispatch use existing review gates', async () => {
  const runtime = createBridgeRuntime({
    reviewAdapterFor: () => fakeReviewAdapter('{"summary":"gate check ok","findings":["looks safe"]}'),
  });
  await call(runtime, 'PUT', '/bridge/projects/cli-bridge/conversation-pairing', {
    sourceEndpointId: 'chatgpt-web',
    targetEndpointId: 'claude-code-command',
  });
  const created = await call(runtime, 'POST', '/bridge/projects/cli-bridge/conversation/messages', {
    text: 'review this safely',
  });
  const action = created.payload.actions[0];

  const confirmed = await call(runtime, 'POST', `/bridge/projects/cli-bridge/conversation/actions/${action.id}/confirm`, {}, CONSOLE_AUTH);
  assert.equal(confirmed.statusCode, 200);
  assert.equal(confirmed.payload.action.status, 'confirmed');
  assert.equal(runtime.pendingReviewStore.get(action.linkedReviewId).status, 'confirmed');

  const dispatched = await call(runtime, 'POST', `/bridge/projects/cli-bridge/conversation/actions/${action.id}/dispatch`, {}, CONSOLE_AUTH);
  assert.equal(dispatched.statusCode, 200);
  assert.equal(dispatched.payload.action.status, 'returned');
});

// --- Task 5: WorkBuddy Conversation Activation ---

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

  const confirmed = await call(runtime, 'POST', `/bridge/projects/cli-bridge/conversation/actions/${action.id}/confirm`, {}, CONSOLE_AUTH);
  assert.equal(confirmed.statusCode, 200);
  assert.equal(confirmed.payload.action.status, 'confirmed');

  const dispatched = await call(runtime, 'POST', `/bridge/projects/cli-bridge/conversation/actions/${action.id}/dispatch`, {}, CONSOLE_AUTH);
  assert.equal(dispatched.statusCode, 200);
  assert.equal(dispatched.payload.action.status, 'queued');
  assert.equal(typeof dispatched.payload.task.taskId, 'string');

  const inbox = await call(runtime, 'GET', '/bridge/endpoints/workbuddy/inbox/next');
  assert.equal(inbox.statusCode, 200);
  assert.equal(inbox.payload.task.taskId, dispatched.payload.task.taskId);
  assert.equal(typeof inbox.payload.task.prompt, 'string');
});

// --- Task 6: Route-Generic Conversation API ---

test('conversation routes custom workbuddy transport target through route adapter', async () => {
  const runtime = createBridgeRuntime();
  runtime.endpointRegistry.register({
    id: 'custom-executor',
    label: 'Custom Executor',
    transport: 'workbuddy',
    risk: 'low',
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
  const inbox = await call(runtime, 'GET', '/bridge/endpoints/custom-executor/inbox/next');
  assert.equal(inbox.statusCode, 200);
  assert.equal(inbox.payload.task.prompt, 'inspect the repo through custom executor');
});

// --- Task 7: Review-Command Auto-Dispatch ---

function fakeReviewAdapter(reviewResultJson) {
  return {
    name: 'fake-review',
    async review(input) {
      const parsed = JSON.parse(reviewResultJson);
      return {
        ok: true,
        adapterName: 'fake-review',
        result: {
          id: input.resultId ?? 'res-fake',
          reviewRequestId: input.reviewRequestId,
          summary: parsed.summary,
          findings: parsed.findings,
          nextReviewPrompt: parsed.nextPromptDraft,
          createdAt: input.now ?? Date.now(),
        },
        meta: { command: 'claude', argv: [], exitCode: 0, durationMs: 1, timedOut: false, truncated: false },
      };
    },
  };
}

test('conversation review-command target dispatches through review adapter', async () => {
  const runtime = createBridgeRuntime({
    reviewAdapterFor: () => fakeReviewAdapter('{"summary":"review ok","findings":["no issues"]}'),
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
