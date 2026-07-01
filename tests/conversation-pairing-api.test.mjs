// Conversation Pairing API contract tests.

import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBridgeRuntime, handleBridgeRequest } from '../apps/local-server/src/routes/bridge-api.ts';

function jsonRequest(body) {
  const text = body === undefined ? '' : JSON.stringify(body);
  async function* gen() {
    if (text.length > 0) {
      yield Buffer.from(text, 'utf8');
    }
  }
  return gen();
}

async function call(runtime, method, path, body) {
  return handleBridgeRequest(runtime, method, path, jsonRequest(body));
}

test('conversation pairing saves ChatGPT Web to Codex CLI route', async () => {
  const runtime = createBridgeRuntime();
  const create = await call(runtime, 'PUT', '/bridge/projects/cli-bridge/conversation-pairing', {
    sourceEndpointId: 'chatgpt-web',
    targetEndpointId: 'codex-cli',
    scope: 'project',
  });

  assert.equal(create.statusCode, 200);
  assert.equal(create.payload.pairing.sourceEndpointId, 'chatgpt-web');
  assert.equal(create.payload.pairing.targetEndpointId, 'codex-cli');
  assert.equal(create.payload.pairing.targetRouteKind, 'managed-pty');
  assert.equal(create.payload.pairing.status, 'not-implemented');

  const read = await call(runtime, 'GET', '/bridge/projects/cli-bridge/conversation-pairing');
  assert.equal(read.statusCode, 200);
  assert.equal(read.payload.pairing.targetEndpointId, 'codex-cli');
});

test('conversation pairing exposes Claude Code command as review-command route', async () => {
  const runtime = createBridgeRuntime();
  const res = await call(runtime, 'PUT', '/bridge/projects/cli-bridge/conversation-pairing', {
    sourceEndpointId: 'chatgpt-web',
    targetEndpointId: 'claude-code-command',
    scope: 'project',
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.pairing.targetRouteKind, 'review-command');
  assert.equal(res.payload.pairing.status, 'ready');
});

test('conversation pairing deletes route', async () => {
  const runtime = createBridgeRuntime();
  await call(runtime, 'PUT', '/bridge/projects/cli-bridge/conversation-pairing', {
    sourceEndpointId: 'chatgpt-web',
    targetEndpointId: 'codex-command',
    scope: 'project',
  });
  const del = await call(runtime, 'DELETE', '/bridge/projects/cli-bridge/conversation-pairing');
  assert.equal(del.statusCode, 200);
  assert.equal(del.payload.deleted, true);

  const read = await call(runtime, 'GET', '/bridge/projects/cli-bridge/conversation-pairing');
  assert.equal(read.statusCode, 200);
  assert.equal(read.payload.pairing, null);
});

test('conversation pairing rejects unknown source endpoint', async () => {
  const runtime = createBridgeRuntime();
  const res = await call(runtime, 'PUT', '/bridge/projects/cli-bridge/conversation-pairing', {
    sourceEndpointId: 'missing',
    targetEndpointId: 'codex-cli',
    scope: 'project',
  });

  assert.equal(res.statusCode, 400);
  assert.match(res.payload.message, /source endpoint/);
});

test('review-command conversation creates a previewed review action', async () => {
  const runtime = createBridgeRuntime();
  await call(runtime, 'PUT', '/bridge/projects/cli-bridge/conversation-pairing', {
    sourceEndpointId: 'chatgpt-web',
    targetEndpointId: 'claude-code-command',
    scope: 'project',
  });
  const res = await call(runtime, 'POST', '/bridge/projects/cli-bridge/conversation/messages', {
    text: 'hi draft',
  });

  assert.equal(res.statusCode, 201);
  assert.equal(res.payload.events[1].status, 'awaiting-manual-confirmation');
  assert.match(res.payload.events[1].text, /Review preview created/);
  assert.equal(res.payload.actions.length, 1);
  assert.equal(res.payload.actions[0].routeKind, 'review-command');
  assert.equal(res.payload.actions[0].status, 'previewed');
});

test('workbuddy route creates previewed transcript event with action', async () => {
  const runtime = createBridgeRuntime();
  await call(runtime, 'PUT', '/bridge/projects/cli-bridge/conversation-pairing', {
    sourceEndpointId: 'chatgpt-web',
    targetEndpointId: 'workbuddy',
    scope: 'project',
  });
  const res = await call(runtime, 'POST', '/bridge/projects/cli-bridge/conversation/messages', {
    text: 'summarize project status',
  });

  assert.equal(res.statusCode, 201);
  assert.equal(res.payload.events[1].routeKind, 'workbuddy-execution');
  assert.equal(res.payload.events[1].status, 'awaiting-manual-confirmation');
  assert.match(res.payload.events[1].text, /WorkBuddy execution preview/);
  assert.equal(res.payload.actions.length, 1);
  assert.equal(res.payload.actions[0].routeKind, 'workbuddy-execution');
  assert.equal(res.payload.actions[0].status, 'previewed');
});

test('conversation pairing and transcript survive snapshot round-trip', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'conversation-pairing-test-'));
  try {
    const runtimeA = createBridgeRuntime({ dataDir: dir });

    await call(runtimeA, 'PUT', '/bridge/projects/cli-bridge/conversation-pairing', {
      sourceEndpointId: 'chatgpt-web',
      targetEndpointId: 'workbuddy',
      scope: 'project',
    });
    await call(runtimeA, 'POST', '/bridge/projects/cli-bridge/conversation/messages', {
      text: 'persist test',
    });

    const runtimeB = createBridgeRuntime({ dataDir: dir });

    const readP = await call(runtimeB, 'GET', '/bridge/projects/cli-bridge/conversation-pairing');
    assert.equal(readP.statusCode, 200);
    assert.equal(readP.payload.pairing.sourceEndpointId, 'chatgpt-web');
    assert.equal(readP.payload.pairing.targetEndpointId, 'workbuddy');

    const readM = await call(runtimeB, 'GET', '/bridge/projects/cli-bridge/conversation/messages');
    assert.equal(readM.statusCode, 200);
    assert.ok(readM.payload.messages.length >= 2, 'expected at least 2 transcript events');
    assert.match(readM.payload.messages[0].text, /persist test/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
