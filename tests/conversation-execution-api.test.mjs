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
 * Setup helper: creates a workbuddy conversation action, confirms, dispatches,
 * and claims it — returning { runtime, action, task } ready for result submission.
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
  const action = postMsg.payload.actions[0];
  assert.ok(action);

  await handleBridgeRequest(
    runtime,
    'POST',
    `/bridge/projects/${projectId}/conversation/actions/${action.id}/confirm`,
    jsonBody({}),
    undefined,
    CONSOLE_AUTH,
  );

  const dispatchRes = await handleBridgeRequest(
    runtime,
    'POST',
    `/bridge/projects/${projectId}/conversation/actions/${action.id}/dispatch`,
    jsonBody({}),
    undefined,
    CONSOLE_AUTH,
  );
  const task = dispatchRes.payload.task;
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

  return { runtime, action, task };
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

    await handleBridgeRequest(
      first,
      'PUT',
      '/bridge/projects/cli-bridge/conversation-pairing',
      jsonBody({ sourceEndpointId: 'chatgpt-web', targetEndpointId: 'workbuddy', scope: 'project' }),
    );

    const postMsg = await handleBridgeRequest(
      first,
      'POST',
      '/bridge/projects/cli-bridge/conversation/messages',
      jsonBody({ text: 'persistent instruction' }),
    );
    const action = postMsg.payload.actions[0];

    await handleBridgeRequest(
      first,
      'POST',
      `/bridge/projects/cli-bridge/conversation/actions/${action.id}/confirm`,
      jsonBody({}),
      undefined,
      CONSOLE_AUTH,
    );

    const dispatchRes = await handleBridgeRequest(
      first,
      'POST',
      `/bridge/projects/cli-bridge/conversation/actions/${action.id}/dispatch`,
      jsonBody({}),
      undefined,
      CONSOLE_AUTH,
    );
    const task = dispatchRes.payload.task;

    // Claim.
    await handleBridgeRequest(first, 'GET', '/bridge/endpoints/workbuddy/inbox/next', jsonBody(undefined));

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
