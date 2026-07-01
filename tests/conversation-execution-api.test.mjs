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
  assert.match(res.payload.events[1].text, /Review preview created/);

  const review = runtime.pendingReviewStore.get(action.linkedReviewId);
  assert.equal(review.status, 'previewed');
  assert.equal(review.prompt, 'review the current README plan');
});
