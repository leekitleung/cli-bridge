import assert from 'node:assert/strict';
import test from 'node:test';
import { createBridgeRuntime, handleBridgeRequest } from '../apps/local-server/src/routes/bridge-api.ts';

const now = 1793000000000;
const CONSOLE_AUTH = { kind: 'console-cookie' };
const EXT_AUTH = { kind: 'extension-session' };

function createRuntime() {
  const runtime = createBridgeRuntime();
  runtime.endpointRegistry.register({
    id: 'workbuddy', label: 'WorkBuddy Executor', transport: 'workbuddy', risk: 'medium',
    capabilities: { canAcceptPrompt: true, canReturnOutput: true, canReview: false, canExecute: true, canSummarize: false },
  });
  runtime.projectStore.upsert({ key: 'cli-bridge', label: 'CLI Bridge' });
  return runtime;
}

async function call(method, path) {
  return { method, path };
}

// --- List loops ---

test('GET /bridge/projects/:key/automation-loops returns empty array', async () => {
  const runtime = createRuntime();
  const result = await handleBridgeRequest(runtime, 'GET', '/bridge/projects/cli-bridge/automation-loops', null);
  assert.equal(result.statusCode, 200);
  assert.ok(Array.isArray(result.payload.loops));
});

test('GET /bridge/projects/:key/automation-loops returns created loops', async () => {
  const runtime = createRuntime();
  runtime.automationLoopStore.create({
    projectId: 'cli-bridge', sourceEndpointId: 'chatgpt-web', targetEndpointId: 'workbuddy',
    maxCycles: 2, noProgressLimit: 2, deadlineAt: now + 600_000, now,
  });
  const result = await handleBridgeRequest(runtime, 'GET', '/bridge/projects/cli-bridge/automation-loops', null);
  assert.equal(result.payload.loops.length, 1);
});

// --- Create loop ---

test('POST /bridge/projects/:key/automation-loops creates loop', async () => {
  const runtime = createRuntime();
  const body = JSON.stringify({ sourceEndpointId: 'chatgpt-web', targetEndpointId: 'workbuddy' });
  const req = mockRequest(body);
  const result = await handleBridgeRequest(runtime, 'POST', '/bridge/projects/cli-bridge/automation-loops', req, undefined, CONSOLE_AUTH);
  assert.equal(result.statusCode, 201);
  assert.ok(result.payload.loop.id);
  assert.equal(result.payload.loop.status, 'draft');
});

test('POST /bridge/projects/:key/automation-loops requires sourceEndpointId', async () => {
  const runtime = createRuntime();
  const body = JSON.stringify({ targetEndpointId: 'workbuddy' });
  const req = mockRequest(body);
  const result = await handleBridgeRequest(runtime, 'POST', '/bridge/projects/cli-bridge/automation-loops', req, undefined, CONSOLE_AUTH);
  assert.equal(result.statusCode, 400);
});

// --- Auth boundary ---

test('POST /bridge/projects/:key/automation-loops requires console-cookie', async () => {
  const runtime = createRuntime();
  const body = JSON.stringify({ sourceEndpointId: 'chatgpt-web', targetEndpointId: 'workbuddy' });
  const req = mockRequest(body);
  const result = await handleBridgeRequest(runtime, 'POST', '/bridge/projects/cli-bridge/automation-loops', req, undefined, EXT_AUTH);
  assert.equal(result.statusCode, 403);
});

test('POST /bridge/projects/:key/automation-loops/:id/tick requires console-cookie', async () => {
  const runtime = createRuntime();
  const loop = runtime.automationLoopStore.create({
    projectId: 'cli-bridge', sourceEndpointId: 'chatgpt-web', targetEndpointId: 'workbuddy',
    maxCycles: 2, noProgressLimit: 2, deadlineAt: now + 600_000, now,
  });
  const body = JSON.stringify({ input: 'test' });
  const req = mockRequest(body);
  const result = await handleBridgeRequest(runtime, 'POST',
    `/bridge/projects/cli-bridge/automation-loops/${loop.id}/tick`, req, undefined, EXT_AUTH);
  assert.equal(result.statusCode, 403);
});

// --- Tick ---

test('POST /bridge/projects/:key/automation-loops/:id/tick dispatches one cycle', async () => {
  const runtime = createRuntime();
  const loop = runtime.automationLoopStore.create({
    projectId: 'cli-bridge', sourceEndpointId: 'chatgpt-web', targetEndpointId: 'workbuddy',
    maxCycles: 2, noProgressLimit: 2, deadlineAt: now + 600_000, now,
  });
  const body = JSON.stringify({ input: 'tick test' });
  const req = mockRequest(body);
  const result = await handleBridgeRequest(runtime, 'POST',
    `/bridge/projects/cli-bridge/automation-loops/${loop.id}/tick`, req, undefined, CONSOLE_AUTH);
  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.type, 'dispatched');
});

// --- Run ---

test('POST /bridge/projects/:key/automation-loops/:id/run executes bounded ticks', async () => {
  const runtime = createRuntime();
  const loop = runtime.automationLoopStore.create({
    projectId: 'cli-bridge', sourceEndpointId: 'chatgpt-web', targetEndpointId: 'workbuddy',
    maxCycles: 1, noProgressLimit: 2, deadlineAt: now + 600_000, now,
  });
  const body = JSON.stringify({ input: 'run test', maxTicksPerRun: 3 });
  const req = mockRequest(body);
  const result = await handleBridgeRequest(runtime, 'POST',
    `/bridge/projects/cli-bridge/automation-loops/${loop.id}/run`, req, undefined, CONSOLE_AUTH);
  assert.equal(result.statusCode, 200);
  assert.ok(Array.isArray(result.payload.trace));
  assert.ok(result.payload.trace.length >= 1);
});

// --- Pause / Resume / Cancel ---

test('POST pause and resume loop', async () => {
  const runtime = createRuntime();
  const loop = runtime.automationLoopStore.create({
    projectId: 'cli-bridge', sourceEndpointId: 'chatgpt-web', targetEndpointId: 'workbuddy',
    maxCycles: 2, noProgressLimit: 2, deadlineAt: now + 600_000, now,
  });
  runtime.automationLoopStore.start(loop.id);

  const pauseReq = mockRequest('{}');
  const pauseResult = await handleBridgeRequest(runtime, 'POST',
    `/bridge/projects/cli-bridge/automation-loops/${loop.id}/pause`, pauseReq, undefined, CONSOLE_AUTH);
  assert.equal(pauseResult.statusCode, 200);
  assert.equal(pauseResult.payload.loop.status, 'paused');

  const resumeReq = mockRequest('{}');
  const resumeResult = await handleBridgeRequest(runtime, 'POST',
    `/bridge/projects/cli-bridge/automation-loops/${loop.id}/resume`, resumeReq, undefined, CONSOLE_AUTH);
  assert.equal(resumeResult.statusCode, 200);
  assert.equal(resumeResult.payload.loop.status, 'running');
});

test('POST cancel loop', async () => {
  const runtime = createRuntime();
  const loop = runtime.automationLoopStore.create({
    projectId: 'cli-bridge', sourceEndpointId: 'chatgpt-web', targetEndpointId: 'workbuddy',
    maxCycles: 2, noProgressLimit: 2, deadlineAt: now + 600_000, now,
  });
  const req = mockRequest('{}');
  const result = await handleBridgeRequest(runtime, 'POST',
    `/bridge/projects/cli-bridge/automation-loops/${loop.id}/cancel`, req, undefined, CONSOLE_AUTH);
  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.loop.status, 'cancelled');
});

// --- Helpers ---

function mockRequest(body) {
  const chunks = [Buffer.from(body)];
  let called = false;
  const req = {
    [Symbol.asyncIterator]() {
      let yielded = false;
      return {
        next() {
          if (yielded) return Promise.resolve({ done: true });
          yielded = true;
          return Promise.resolve({ done: false, value: body });
        },
      };
    },
  };
  return req;
}
