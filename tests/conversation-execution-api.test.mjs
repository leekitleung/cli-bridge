// EX-3: Execution Packets — integration tests for the full roundtrip
// result → execution packet → transcript event.

import assert from 'node:assert/strict';
import test from 'node:test';

function jsonBody(body) {
  const text = body === undefined ? '' : JSON.stringify(body);
  async function* gen() {
    if (text.length > 0) yield Buffer.from(text, 'utf8');
  }
  return gen();
}

const CONSOLE_AUTH = { kind: 'console-cookie' };

/**
 * Setup helper: creates a planner-gated workbuddy conversation, accepts the
 * generated plan, dispatches, and claims it — returning { runtime, action, task }
 * ready for result submission.
 */
async function setupAndClaim(runtime, projectId = 'cli-bridge', text = 'test instruction') {
  // Setup project and workbuddy pairing.
  const { handleBridgeRequest } = await import('../apps/local-server/src/routes/bridge-api.ts');

  await handleBridgeRequest(
    runtime,
    'PUT',
    `/bridge/projects/${projectId}/conversation-pairing`,
    jsonBody({ sourceEndpointId: 'chatgpt-web', targetEndpointId: 'workbuddy', scope: 'project' }),
  );

  const postMsg = await handleBridgeRequest(
    runtime,
    'POST',
    `/bridge/projects/${projectId}/conversation/messages`,
    jsonBody({ text }),
  );
  assert.equal(postMsg.statusCode, 201);
  const plan = postMsg.payload.plan;
  assert.ok(plan);
  assert.equal(plan.status, 'proposed');

  const acceptRes = await handleBridgeRequest(
    runtime,
    'POST',
    `/bridge/projects/${projectId}/conversation/plans/${plan.id}/accept`,
    jsonBody({}),
    undefined,
    CONSOLE_AUTH,
  );
  assert.equal(acceptRes.statusCode, 200);
  const action = acceptRes.payload.action;
  assert.ok(action);
  const task = acceptRes.payload.dispatch?.task;
  assert.ok(task);

  // Claim the task.
  const claimRes = await handleBridgeRequest(
    runtime,
    'GET',
    `/bridge/endpoints/workbuddy/inbox/next`,
    jsonBody(undefined),
  );
  assert.equal(claimRes.statusCode, 200);
  assert.equal(claimRes.payload.task.taskId, task.taskId);

  return { runtime, plan, action, task };
}

test('result submission creates an execution packet before transcript event', async () => {
  const { createBridgeRuntime, handleBridgeRequest } = await import('../apps/local-server/src/routes/bridge-api.ts');
  const runtime = createBridgeRuntime();
  const { action, task } = await setupAndClaim(runtime);

  // Before result: no execution packets.
  assert.equal(runtime.conversationExecutionStore.exportPackets().length, 0);

  // Submit the result.
  const resultRes = await handleBridgeRequest(
    runtime,
    'POST',
    '/bridge/endpoints/workbuddy/results',
    jsonBody({
      taskId: task.taskId,
      ok: true,
      output: { result: 'deployment complete' },
      stdout: 'deployed successfully\nno errors',
      stderr: '',
      exitCode: 0,
      durationMs: 1500,
    }),
  );
  assert.equal(resultRes.statusCode, 200);

  // After result: one execution packet created.
  const packets = runtime.conversationExecutionStore.exportPackets();
  assert.equal(packets.length, 1);
  const ep = packets[0];
  assert.equal(ep.taskId, task.taskId);
  assert.equal(ep.ok, true);
  assert.equal(ep.projectId, 'cli-bridge');
  assert.equal(typeof ep.id, 'string');
  assert.ok(ep.id.startsWith('exec-'));
  assert.equal(ep.durationMs, 1500);
  assert.equal(ep.stdout, 'deployed successfully\nno errors');
  assert.equal(ep.exitCode, 0);
});

test('execution packet is NOT in result API response', async () => {
  const { createBridgeRuntime, handleBridgeRequest } = await import('../apps/local-server/src/routes/bridge-api.ts');
  const runtime = createBridgeRuntime();
  const { task } = await setupAndClaim(runtime, 'cli-bridge', 'run tests');

  const resultRes = await handleBridgeRequest(
    runtime,
    'POST',
    '/bridge/endpoints/workbuddy/results',
    jsonBody({
      taskId: task.taskId,
      ok: true,
      stdout: 'all tests passed',
      durationMs: 100,
    }),
  );

  assert.equal(resultRes.statusCode, 200);

  // Response must NOT include execution packet.
  const payload = resultRes.payload;
  assert.ok(payload.result, 'response has result');
  assert.ok(payload.action, 'response has action');
  assert.ok(payload.event, 'response has transcript event');
  assert.equal('executionPacket' in payload, false, 'API response must not expose execution packet');
  assert.equal('executionPackets' in payload, false, 'API response must not expose execution packets');
});

test('user-visible answer body is derived from executor fields only', async () => {
  const { createBridgeRuntime, handleBridgeRequest } = await import('../apps/local-server/src/routes/bridge-api.ts');
  const runtime = createBridgeRuntime();
  const { task } = await setupAndClaim(runtime, 'cli-bridge', 'generate report');

  const resultRes = await handleBridgeRequest(
    runtime,
    'POST',
    '/bridge/endpoints/workbuddy/results',
    jsonBody({
      taskId: task.taskId,
      ok: true,
      stdout: 'Report generated: quarterly-finance.xlsx',
      durationMs: 100,
    }),
  );

  assert.equal(resultRes.statusCode, 200);
  const transcriptEvent = resultRes.payload.event;
  assert.ok(transcriptEvent);
  assert.equal(transcriptEvent.role, 'target');
  assert.ok(transcriptEvent.text.includes('Report generated: quarterly-finance.xlsx'),
    'transcript text should contain executor stdout');
  assert.equal(transcriptEvent.status, 'returned');
  assert.equal(transcriptEvent.kind, 'executor_output');
  assert.equal(transcriptEvent.visibility, 'user');
});

test('failed executor text comes from failureReason', async () => {
  const { createBridgeRuntime, handleBridgeRequest } = await import('../apps/local-server/src/routes/bridge-api.ts');
  const runtime = createBridgeRuntime();
  const { task } = await setupAndClaim(runtime, 'cli-bridge', 'run failing command');

  const resultRes = await handleBridgeRequest(
    runtime,
    'POST',
    '/bridge/endpoints/workbuddy/results',
    jsonBody({
      taskId: task.taskId,
      ok: false,
      failureReason: 'command not found: deploy',
      stderr: 'Error: command not found: deploy\n  at /path/to/script.js:1:1',
      exitCode: 127,
      durationMs: 50,
    }),
  );

  assert.equal(resultRes.statusCode, 200);

  // Verify execution packet has failure info.
  const packets = runtime.conversationExecutionStore.exportPackets();
  assert.equal(packets.length, 1);
  assert.equal(packets[0].ok, false);
  assert.equal(packets[0].failureReason, 'command not found: deploy');

  // Verify transcript event uses failureReason.
  const transcriptEvent = resultRes.payload.event;
  assert.ok(transcriptEvent);
  assert.equal(transcriptEvent.role, 'target');
  assert.equal(transcriptEvent.status, 'failed');
  assert.equal(transcriptEvent.text, 'command not found: deploy');
  assert.equal(transcriptEvent.kind, 'executor_output');
});

test('failed executor text falls back to stderr when failureReason is absent', async () => {
  const { createBridgeRuntime, handleBridgeRequest } = await import('../apps/local-server/src/routes/bridge-api.ts');
  const runtime = createBridgeRuntime();
  const { task } = await setupAndClaim(runtime, 'cli-bridge', 'run error');

  const resultRes = await handleBridgeRequest(
    runtime,
    'POST',
    '/bridge/endpoints/workbuddy/results',
    jsonBody({
      taskId: task.taskId,
      ok: false,
      stderr: 'process killed by signal SIGTERM',
      exitCode: 143,
      durationMs: 5000,
    }),
  );

  assert.equal(resultRes.statusCode, 200);
  const transcriptEvent = resultRes.payload.event;
  assert.equal(transcriptEvent.text, 'process killed by signal SIGTERM');
  assert.equal(transcriptEvent.status, 'failed');
});

test('execution packet links to instruction packet via userEventId', async () => {
  const { createBridgeRuntime, handleBridgeRequest } = await import('../apps/local-server/src/routes/bridge-api.ts');
  const runtime = createBridgeRuntime();
  const { task } = await setupAndClaim(runtime, 'cli-bridge', 'my instruction');

  // Verify instruction packet exists.
  const instPackets = runtime.conversationInstructionStore.exportPackets();
  assert.equal(instPackets.length, 1);
  const instructionPacket = instPackets[0];

  await handleBridgeRequest(
    runtime,
    'POST',
    '/bridge/endpoints/workbuddy/results',
    jsonBody({
      taskId: task.taskId,
      ok: true,
      stdout: 'done',
      durationMs: 300,
    }),
  );

  // Check execution packet links to the instruction packet.
  const execPackets = runtime.conversationExecutionStore.exportPackets();
  assert.equal(execPackets.length, 1);
  assert.equal(execPackets[0].instructionPacketId, instructionPacket.id);
});

test('persistence roundtrip preserves execution packets', async () => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { resolve } = await import('node:path');
  const { createBridgeRuntime, handleBridgeRequest } = await import('../apps/local-server/src/routes/bridge-api.ts');

  const dir = mkdtempSync(resolve(tmpdir(), 'cli-bridge-test-'));
  try {
    // Phase 1: create runtime, setup, submit result, persist.
    const first = createBridgeRuntime({ dataDir: dir });
    const { task } = await setupAndClaim(first, 'cli-bridge', 'persistent instruction');

    await handleBridgeRequest(
      first,
      'POST',
      '/bridge/endpoints/workbuddy/results',
      jsonBody({
        taskId: task.taskId,
        ok: true,
        output: { key: 'value' },
        stdout: 'persistent output',
        stderr: '',
        exitCode: 0,
        durationMs: 999,
      }),
    );
    first.persist();

    const firstPackets = first.conversationExecutionStore.exportPackets();
    assert.equal(firstPackets.length, 1);
    const firstEp = firstPackets[0];

    // Phase 2: new runtime from same dir should restore execution packets.
    const second = createBridgeRuntime({ dataDir: dir });
    const secondPackets = second.conversationExecutionStore.exportPackets();
    assert.equal(secondPackets.length, 1);
    const secondEp = secondPackets[0];

    assert.equal(secondEp.id, firstEp.id);
    assert.equal(secondEp.taskId, firstEp.taskId);
    assert.equal(secondEp.ok, true);
    assert.deepEqual(secondEp.output, { key: 'value' });
    assert.equal(secondEp.stdout, 'persistent output');
    assert.equal(secondEp.exitCode, 0);
    assert.equal(secondEp.durationMs, 999);
    assert.equal(secondEp.projectId, 'cli-bridge');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── EX-4: Full pipeline: instruction → route → task → result → execution → transcript ──

test('full pipeline creates route linking instruction → action → task → result', async () => {
  const { createBridgeRuntime, handleBridgeRequest } = await import('../apps/local-server/src/routes/bridge-api.ts');
  const runtime = createBridgeRuntime();
  const { action, task } = await setupAndClaim(runtime, 'cli-bridge', 'full pipeline test');

  // Verify route was created.
  const routes = runtime.conversationRouteStore.exportRoutes();
  assert.equal(routes.length, 1);
  const route = routes[0];
  assert.equal(route.mode, 'single');
  // Route is dispatched because setupAndClaim already confirmed+dispatched.
  assert.equal(route.status, 'dispatched');
  assert.equal(route.projectId, 'cli-bridge');
  assert.equal(typeof route.instructionPacketId, 'string');
  assert.equal(route.actionId, action.id);
  assert.equal(route.taskId, task.taskId);

  // Verify instruction → route link.
  const instPackets = runtime.conversationInstructionStore.exportPackets();
  assert.equal(instPackets.length, 1);
  const foundByInst = runtime.conversationRouteStore.findByInstructionId(instPackets[0].id);
  assert.ok(foundByInst);
  assert.equal(foundByInst.id, route.id);

  // Submit result to complete the pipeline.
  await handleBridgeRequest(
    runtime,
    'POST',
    '/bridge/endpoints/workbuddy/results',
    jsonBody({
      taskId: task.taskId,
      ok: true,
      stdout: 'pipeline complete',
      durationMs: 100,
    }),
  );

  // Route should be completed.
  const completedRoute = runtime.conversationRouteStore.get(route.id);
  assert.ok(completedRoute);
  assert.equal(completedRoute.status, 'completed');

  // Execution packet should exist.
  const execPackets = runtime.conversationExecutionStore.exportPackets();
  assert.equal(execPackets.length, 1);
});

test('route lifecycle: proposed → accepted → dispatched → completed via full pipeline', async () => {
  const { createBridgeRuntime, handleBridgeRequest } = await import('../apps/local-server/src/routes/bridge-api.ts');
  const runtime = createBridgeRuntime();
  const { task } = await setupAndClaim(runtime, 'cli-bridge', 'lifecycle test');

  const routes = runtime.conversationRouteStore.exportRoutes();
  assert.equal(routes.length, 1);

  const dispatchedRoute = runtime.conversationRouteStore.get(routes[0].id);
  assert.ok(dispatchedRoute);
  assert.equal(dispatchedRoute.status, 'dispatched');
  assert.equal(dispatchedRoute.taskId, task.taskId);

  // Submit result — route moves to completed.
  await handleBridgeRequest(
    runtime,
    'POST',
    '/bridge/endpoints/workbuddy/results',
    jsonBody({
      taskId: task.taskId,
      ok: true,
      stdout: 'lifecycle done',
      durationMs: 200,
    }),
  );

  const completedRoute = runtime.conversationRouteStore.get(routes[0].id);
  assert.ok(completedRoute);
  assert.equal(completedRoute.status, 'completed');
});

test('route lifecycle: pending → dispatched → failed', async () => {
  const { createBridgeRuntime, handleBridgeRequest } = await import('../apps/local-server/src/routes/bridge-api.ts');
  const runtime = createBridgeRuntime();
  const { task } = await setupAndClaim(runtime, 'cli-bridge', 'failure test');

  const routes = runtime.conversationRouteStore.exportRoutes();
  assert.equal(routes.length, 1);

  // Submit failed result.
  await handleBridgeRequest(
    runtime,
    'POST',
    '/bridge/endpoints/workbuddy/results',
    jsonBody({
      taskId: task.taskId,
      ok: false,
      failureReason: 'execution timeout',
      exitCode: 1,
      durationMs: 5000,
    }),
  );

  const failedRoute = runtime.conversationRouteStore.get(routes[0].id);
  assert.ok(failedRoute);
  assert.equal(failedRoute.status, 'failed');
});

test('route id stays internal — not in API responses', async () => {
  const { createBridgeRuntime, handleBridgeRequest } = await import('../apps/local-server/src/routes/bridge-api.ts');
  const runtime = createBridgeRuntime();
  const { task } = await setupAndClaim(runtime, 'cli-bridge', 'internal test');

  // Submit result.
  const resultRes = await handleBridgeRequest(
    runtime,
    'POST',
    '/bridge/endpoints/workbuddy/results',
    jsonBody({
      taskId: task.taskId,
      ok: true,
      stdout: 'done',
      durationMs: 100,
    }),
  );

  assert.equal(resultRes.statusCode, 200);
  const payload = resultRes.payload;

  // Route metadata must never appear in API responses.
  assert.equal('route' in payload, false, 'result API response must not expose route');
  assert.equal('routeId' in payload, false, 'result API response must not expose routeId');
  assert.equal('conversationRoute' in payload, false, 'result API response must not expose conversationRoute');

  if (payload.action) {
    assert.equal('routeId' in payload.action, false, 'action in API response must not expose routeId');
  }
  if (payload.event) {
    assert.equal('routeId' in payload.event, false, 'event in API response must not expose routeId');
  }
});

// ── EX-4: Route idempotency ──

test('posting messages creates no routes before plan acceptance', async () => {
  const { createBridgeRuntime, handleBridgeRequest } = await import('../apps/local-server/src/routes/bridge-api.ts');
  const runtime = createBridgeRuntime();

  // Setup.
  await handleBridgeRequest(
    runtime,
    'PUT',
    '/bridge/projects/cli-bridge/conversation-pairing',
    jsonBody({ sourceEndpointId: 'chatgpt-web', targetEndpointId: 'workbuddy', scope: 'project' }),
  );

  // First message creates a plan, but no route before acceptance.
  const first = await handleBridgeRequest(
    runtime,
    'POST',
    '/bridge/projects/cli-bridge/conversation/messages',
    jsonBody({ text: 'hello' }),
  );
  assert.equal(first.statusCode, 201);
  assert.ok(first.payload.plan);
  assert.equal(runtime.conversationRouteStore.exportRoutes().length, 0);

  // Second message creates another plan, but still no executor route.
  const second = await handleBridgeRequest(
    runtime,
    'POST',
    '/bridge/projects/cli-bridge/conversation/messages',
    jsonBody({ text: 'world' }),
  );
  assert.equal(second.statusCode, 201);
  assert.ok(second.payload.plan);
  assert.notEqual(first.payload.plan.id, second.payload.plan.id);
  assert.equal(runtime.conversationRouteStore.exportRoutes().length, 0);
});
