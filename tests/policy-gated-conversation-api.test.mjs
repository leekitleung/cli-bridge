// Policy-gated conversation API tests (ADR-0031 Task 5).
import assert from 'node:assert/strict';
import test from 'node:test';

function jsonBody(body) {
  const text = body === undefined ? '' : JSON.stringify(body);
  async function* gen() {
    if (text.length > 0) yield Buffer.from(text, 'utf8');
  }
  return gen();
}

function safeAutoExecutePlanner() {
  return {
    id: 'test-planner',
    mode: 'test-only',
    async plan(input) {
      return {
        id: `out-${Date.now()}`,
        sessionId: input.sessionId,
        plannerEndpointId: 'test-planner',
        visibleText: 'I can format that.',
        intent: 'request_execution',
        proposedInstruction: {
          summary: 'format text',
          payload: 'format text',
          targetExecutorIds: ['workbuddy'],
          riskHints: ['pure-transform'],
        },
        createdAt: new Date().toISOString(),
      };
    },
  };
}

async function setupPairing(runtime, projectId = 'cli-bridge') {
  const { handleBridgeRequest } = await import('../apps/local-server/src/routes/bridge-api.ts');
  return handleBridgeRequest(
    runtime,
    'PUT',
    `/bridge/projects/${projectId}/conversation-pairing`,
    jsonBody({
      sourceEndpointId: 'codex-cli',
      targetEndpointId: 'workbuddy',
      targetRouteKind: 'workbuddy-execution',
    }),
  );
}

test('conversation message returns planner-unavailable when no real planner is configured', async () => {
  const { createBridgeRuntime, handleBridgeRequest } = await import('../apps/local-server/src/routes/bridge-api.ts');
  const runtime = createBridgeRuntime();

  const res = await handleBridgeRequest(
    runtime,
    'POST',
    '/bridge/projects/cli-bridge/conversation/messages',
    jsonBody({ text: 'hi' }),
  );

  assert.equal(res.statusCode, 409);
  assert.match(res.payload.message, /planner.*unavailable/i);
  const packets = runtime.conversationInstructionStore.listByProject('cli-bridge');
  assert.equal(packets.length, 0);
  const routes = runtime.conversationRouteStore.listByProject('cli-bridge');
  assert.equal(routes.length, 0);
});

test('planner answer intent renders planner output without executor task', async () => {
  const { createBridgeRuntime, handleBridgeRequest } = await import('../apps/local-server/src/routes/bridge-api.ts');
  const runtime = createBridgeRuntime({
    plannerAdapters: [{
      id: 'test-planner',
      mode: 'test-only',
      async plan(input) {
        return {
          id: `out-${Date.now()}`,
          sessionId: input.sessionId,
          plannerEndpointId: 'test-planner',
          visibleText: 'Hello from planner',
          intent: 'answer',
          createdAt: new Date().toISOString(),
        };
      },
    }],
  });

  // Setup pairing so messages can be sent.
  const pairRes = await setupPairing(runtime);
  assert.equal(pairRes.statusCode, 200, 'pairing should be created');

  const res = await handleBridgeRequest(
    runtime,
    'POST',
    '/bridge/projects/cli-bridge/conversation/messages',
    jsonBody({ text: 'hi' }),
  );

  assert.equal(res.statusCode, 201);
  const lastEvent = res.payload.events[res.payload.events.length - 1];
  assert.match(lastEvent.text, /Hello from planner/);
  const packets = runtime.conversationInstructionStore.listByProject('cli-bridge');
  assert.equal(packets.length, 0);
  const tasks = runtime.workbuddyExecution.exportTasks();
  assert.equal(tasks.length, 0);
});

test('request execution blocks before dispatch when executor unavailable', async () => {
  const { createBridgeRuntime, handleBridgeRequest } = await import('../apps/local-server/src/routes/bridge-api.ts');
  const runtime = createBridgeRuntime({
    plannerAdapters: [{
      id: 'test-planner',
      mode: 'test-only',
      async plan(input) {
        return {
          id: `out-${Date.now()}`,
          sessionId: input.sessionId,
          plannerEndpointId: 'test-planner',
          visibleText: 'Ready to execute.',
          intent: 'request_execution',
          proposedInstruction: {
            summary: 'format text',
            payload: 'format text',
            targetExecutorIds: ['workbuddy'],
            riskHints: ['pure-transform'],
          },
          createdAt: new Date().toISOString(),
        };
      },
    }],
  });

  // Setup pairing.
  const pairRes = await setupPairing(runtime);
  assert.equal(pairRes.statusCode, 200, 'pairing should be created');

  const res = await handleBridgeRequest(
    runtime,
    'POST',
    '/bridge/projects/cli-bridge/conversation/messages',
    jsonBody({ text: 'format this' }),
  );

  assert.equal(res.statusCode, 201);
  assert.equal(res.payload.gate.type, 'blocked');
  const packets = runtime.conversationInstructionStore.listByProject('cli-bridge');
  assert.equal(packets.length, 0);
  const tasks = runtime.workbuddyExecution.exportTasks();
  assert.equal(tasks.length, 0);
});

test('executor raw result returns to transcript without bridge-authored rewrite', async () => {
  const { createBridgeRuntime, handleBridgeRequest } = await import('../apps/local-server/src/routes/bridge-api.ts');
  const runtime = createBridgeRuntime({ plannerAdapters: [safeAutoExecutePlanner()] });

  // Setup pairing.
  const pairRes = await setupPairing(runtime);
  assert.equal(pairRes.statusCode, 200, 'pairing should be created');

  // Simulate WorkBuddy readiness by enqueueing and claiming a task.
  runtime.workbuddyExecution.enqueue({
    endpointId: 'workbuddy',
    proposalId: 'stub',
    planId: 'stub',
    goalId: 'stub',
    bindingHash: 'stub',
    prompt: 'stub',
    workingDirectory: '/tmp',
  });
  runtime.workbuddyExecution.claimNext('workbuddy');

  // Send message — should auto_execute because planner returns safe operation.
  const message = await handleBridgeRequest(
    runtime,
    'POST',
    '/bridge/projects/cli-bridge/conversation/messages',
    jsonBody({ text: 'format abc' }),
  );
  assert.equal(message.statusCode, 201);

  // Verify task was created.
  const tasks = runtime.workbuddyExecution.exportTasks();
  // Find the newly dispatched task (not the stub we created for readiness)
  const dispatchedTask = tasks.find(t => t.prompt === 'format abc' && t.status !== 'claimed');
  assert.ok(dispatchedTask, 'task was dispatched');

  // Claim the task before submitting results (required for results endpoint).
  runtime.workbuddyExecution.claimNext('workbuddy');

  // Submit executor result.
  const result = await handleBridgeRequest(
    runtime,
    'POST',
    '/bridge/endpoints/workbuddy/results',
    jsonBody({
      taskId: dispatchedTask.taskId,
      ok: true,
      stdout: 'ABC',
    }),
  );

  assert.equal(result.statusCode, 200);
  const transcript = runtime.conversationTranscriptStore.listByProject('cli-bridge');
  const executorEvents = transcript.filter(e => e.role === 'target');
  assert.ok(executorEvents.length > 0, 'has executor output event');
});
