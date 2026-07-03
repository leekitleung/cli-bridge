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

// ADR-0035: Wrap a PlannerAdapter as a ConversationSourceAdapter for tests.
function asSourceAdapter(endpointId, kind, planner) {
  return {
    endpointId,
    kind,
    isAvailable() { return true; },
    async plan(input) {
      return planner.plan(input);
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

test('conversation message returns source-unavailable when no source adapter is configured', async () => {
  const { createBridgeRuntime, handleBridgeRequest } = await import('../apps/local-server/src/routes/bridge-api.ts');
  const runtime = createBridgeRuntime();
  await setupPairing(runtime);

  const res = await handleBridgeRequest(
    runtime,
    'POST',
    '/bridge/projects/cli-bridge/conversation/messages',
    jsonBody({ text: 'hi' }),
  );

  assert.equal(res.statusCode, 409);
  assert.match(res.payload.message, /source.*unavailable/i);
  const packets = runtime.conversationInstructionStore.listByProject('cli-bridge');
  assert.equal(packets.length, 0);
  const routes = runtime.conversationRouteStore.listByProject('cli-bridge');
  assert.equal(routes.length, 0);
});

test('planner answer intent renders planner output without executor task', async () => {
  const { createBridgeRuntime, handleBridgeRequest } = await import('../apps/local-server/src/routes/bridge-api.ts');
  const testPlanner = {
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
  };
  const runtime = createBridgeRuntime({
    plannerAdapters: [testPlanner],
    sourceAdapters: [asSourceAdapter('codex-cli', 'codex-cli', testPlanner)],
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
  const testPlanner = {
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
  };
  const runtime = createBridgeRuntime({
    plannerAdapters: [testPlanner],
    sourceAdapters: [asSourceAdapter('codex-cli', 'codex-cli', testPlanner)],
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

  const read = await handleBridgeRequest(
    runtime,
    'GET',
    '/bridge/projects/cli-bridge/conversation/messages',
    jsonBody(undefined),
  );
  assert.equal(read.statusCode, 200);
  assert.equal(read.payload.gate.type, 'blocked');
  assert.equal(read.payload.gateDecisions.length, 1);
});

test('workbuddy status-style request uses local fast path instead of slow planner', async () => {
  const { createBridgeRuntime, handleBridgeRequest } = await import('../apps/local-server/src/routes/bridge-api.ts');
  let plannerCalled = false;
  const slowPlanner = {
    id: 'slow-planner',
    mode: 'test-only',
    async plan() {
      plannerCalled = true;
      throw new Error('planner should not run');
    },
  };
  const runtime = createBridgeRuntime({
    plannerAdapters: [slowPlanner],
    sourceAdapters: [asSourceAdapter('codex-cli', 'codex-cli', slowPlanner)],
  });

  await setupPairing(runtime);
  // ADR-0034: Simulate real executor readiness by claiming a task.
  runtime.workbuddyExecution.enqueue({
    projectId: 'cli-bridge',
    endpointId: 'workbuddy',
    proposalId: 'readiness-probe',
    planId: 'readiness-probe',
    goalId: 'readiness-probe',
    bindingHash: 'readiness-probe',
    prompt: 'readiness-probe',
    workingDirectory: '/tmp',
  });
  runtime.workbuddyExecution.claimNext('workbuddy');
  // Mark executor as ready for real execution.
  runtime.workbuddyExecution.markExecutorReady();

  const res = await handleBridgeRequest(
    runtime,
    'POST',
    '/bridge/projects/cli-bridge/conversation/messages',
    jsonBody({ text: 'workbuddy 状态怎样' }),
  );

  assert.equal(res.statusCode, 201);
  assert.equal(plannerCalled, false);
  // ADR-0034: When executorReady is true, status queries return 'answer'.
  assert.equal(res.payload.gate.type, 'continue_planning');
});

test('diagnostic workbuddy result stays out of user-visible transcript', async () => {
  const { createBridgeRuntime, handleBridgeRequest } = await import('../apps/local-server/src/routes/bridge-api.ts');
  const runtime = createBridgeRuntime({
    plannerAdapters: [safeAutoExecutePlanner()],
    sourceAdapters: [asSourceAdapter('codex-cli', 'codex-cli', safeAutoExecutePlanner())],
  });

  await setupPairing(runtime);
  // ADR-0034: Mark executor as ready so the planner gate allows auto_execute.
  runtime.workbuddyExecution.markExecutorReady();

  const message = await handleBridgeRequest(
    runtime,
    'POST',
    '/bridge/projects/cli-bridge/conversation/messages',
    jsonBody({ text: 'run diagnostic test' }),
  );
  assert.equal(message.statusCode, 201);
  const task = message.payload.dispatch.task;
  runtime.workbuddyExecution.claimNext('workbuddy');

  const result = await handleBridgeRequest(
    runtime,
    'POST',
    '/bridge/endpoints/workbuddy/results',
    jsonBody({
      taskId: task.taskId,
      proposalId: task.proposalId,
      ok: true,
      stdout: 'diagnostic worker received: run diagnostic test',
      output: 'diagnostic worker received: run diagnostic test',
    }),
  );

  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.event, undefined);
  const transcript = runtime.conversationTranscriptStore.listByProject('cli-bridge');
  assert.equal(transcript.some(e => /diagnostic worker received/.test(e.text)), false);
  assert.equal(transcript.some(e => e.kind === 'executor_output'), false);
});

test('executor raw result returns to transcript without bridge-authored rewrite', async () => {
  const { createBridgeRuntime, handleBridgeRequest } = await import('../apps/local-server/src/routes/bridge-api.ts');
  const runtime = createBridgeRuntime({
    plannerAdapters: [safeAutoExecutePlanner()],
    sourceAdapters: [asSourceAdapter('codex-cli', 'codex-cli', safeAutoExecutePlanner())],
  });

  // Setup pairing.
  const pairRes = await setupPairing(runtime);
  assert.equal(pairRes.statusCode, 200, 'pairing should be created');

  // ADR-0034: Simulate WorkBuddy readiness by claiming a task and marking executor ready.
  runtime.workbuddyExecution.enqueue({
    projectId: 'cli-bridge',
    endpointId: 'workbuddy',
    proposalId: 'stub',
    planId: 'stub',
    goalId: 'stub',
    bindingHash: 'stub',
    prompt: 'stub',
    workingDirectory: '/tmp',
  });
  runtime.workbuddyExecution.claimNext('workbuddy');
  runtime.workbuddyExecution.markExecutorReady();

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

// ADR-0032: WorkBuddy worker online integration.
test('safe planner execution creates workbuddy task when worker has polled', async () => {
  const { createBridgeRuntime, handleBridgeRequest } = await import('../apps/local-server/src/routes/bridge-api.ts');
  const testPlanner = {
    id: 'test-planner',
    mode: 'test-only',
    async plan(input) {
      return {
        id: `out-${Date.now()}`,
        sessionId: input.sessionId,
        plannerEndpointId: 'test-planner',
        visibleText: 'Ready to run a diagnostic task.',
        intent: 'request_execution',
        proposedInstruction: {
          summary: 'diagnostic',
          payload: 'diagnostic: ping',
          targetExecutorIds: ['workbuddy'],
          riskHints: ['pure-transform'],
        },
      };
    },
  };
  const runtime = createBridgeRuntime({
    plannerAdapters: [testPlanner],
    sourceAdapters: [asSourceAdapter('codex-cli', 'codex-cli', testPlanner)],
  });

  // ADR-0034: Simulate worker polling and marking executor as ready.
  runtime.workbuddyExecution.claimNext('workbuddy');
  runtime.workbuddyExecution.markExecutorReady();

  // Setup pairing. ADR-0035: Must pair with 'codex-cli' since that's the source adapter we registered.
  const pairRes = await handleBridgeRequest(
    runtime,
    'PUT',
    '/bridge/projects/cli-bridge/conversation-pairing',
    jsonBody({ sourceEndpointId: 'codex-cli', targetEndpointId: 'workbuddy' }),
  );
  assert.equal(pairRes.statusCode, 200);

  const res = await handleBridgeRequest(
    runtime,
    'POST',
    '/bridge/projects/cli-bridge/conversation/messages',
    jsonBody({ text: 'run diagnostic' }),
  );

  assert.equal(res.statusCode, 201);
  assert.equal(res.payload.gate.type, 'auto_execute');
  const tasks = runtime.workbuddyExecution.exportTasks().filter(t => t.proposalId !== 'stub');
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].endpointId, 'workbuddy');
});
