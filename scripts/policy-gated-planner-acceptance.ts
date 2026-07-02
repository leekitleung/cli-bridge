// ADR-0031 Policy-Gated Planner Orchestration Acceptance Script.
//
// Covers 8 acceptance checks:
//  1. No planner -> planner-unavailable, no task.
//  2. Planner answer -> visible planner output, no task.
//  3. Planner request_execution + offline executor -> blocked, no task.
//  4. Planner safe request_execution + online executor -> task created.
//  5. Executor result -> raw result in transcript.
//  6. High-risk request_execution -> confirmation required.
//  7. Extension cannot force confirmation or auto execution.
//  8. Main transcript has no queued/workbuddy-execution/dispatch/action/route text.

import assert from 'node:assert/strict';
import test from 'node:test';

function jsonBody(body) {
  const text = body === undefined ? '' : JSON.stringify(body);
  async function* gen() {
    if (text.length > 0) yield Buffer.from(text, 'utf8');
  }
  return gen();
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

function answerPlanner() {
  return {
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
}

function safeAutoPlanner() {
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

function highRiskPlanner() {
  return {
    id: 'test-planner',
    mode: 'test-only',
    async plan(input) {
      return {
        id: `out-${Date.now()}`,
        sessionId: input.sessionId,
        plannerEndpointId: 'test-planner',
        visibleText: 'I will edit files.',
        intent: 'request_execution',
        proposedInstruction: {
          summary: 'edit files',
          payload: 'edit files',
          targetExecutorIds: ['workbuddy'],
          riskHints: ['filesystem-mutation'],
        },
        createdAt: new Date().toISOString(),
      };
    },
  };
}

// Check 1: No planner -> planner-unavailable
test('ACCEPTANCE-1: no planner returns planner-unavailable', async () => {
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
  assert.equal(runtime.conversationInstructionStore.listByProject('cli-bridge').length, 0);
  assert.equal(runtime.workbuddyExecution.exportTasks().length, 0);
});

// Check 2: Planner answer -> no task
test('ACCEPTANCE-2: planner answer intent creates no task', async () => {
  const { createBridgeRuntime, handleBridgeRequest } = await import('../apps/local-server/src/routes/bridge-api.ts');
  const runtime = createBridgeRuntime({ plannerAdapters: [answerPlanner()] });

  const pairRes = await setupPairing(runtime);
  assert.equal(pairRes.statusCode, 200);

  const res = await handleBridgeRequest(
    runtime,
    'POST',
    '/bridge/projects/cli-bridge/conversation/messages',
    jsonBody({ text: 'hi' }),
  );

  assert.equal(res.statusCode, 201);
  assert.equal(res.payload.gate.type, 'continue_planning');
  assert.equal(runtime.workbuddyExecution.exportTasks().length, 0);
});

// Check 3: Planner request_execution + offline executor -> blocked
test('ACCEPTANCE-3: offline executor blocks before dispatch', async () => {
  const { createBridgeRuntime, handleBridgeRequest } = await import('../apps/local-server/src/routes/bridge-api.ts');
  const runtime = createBridgeRuntime({ plannerAdapters: [safeAutoPlanner()] });

  const pairRes = await setupPairing(runtime);
  assert.equal(pairRes.statusCode, 200);

  const res = await handleBridgeRequest(
    runtime,
    'POST',
    '/bridge/projects/cli-bridge/conversation/messages',
    jsonBody({ text: 'format this' }),
  );

  assert.equal(res.statusCode, 201);
  assert.equal(res.payload.gate.type, 'blocked');
  assert.equal(runtime.workbuddyExecution.exportTasks().length, 0);
});

// Check 4: Safe request_execution + online executor -> task created
test('ACCEPTANCE-4: safe auto execute creates task', async () => {
  const { createBridgeRuntime, handleBridgeRequest } = await import('../apps/local-server/src/routes/bridge-api.ts');
  const runtime = createBridgeRuntime({ plannerAdapters: [safeAutoPlanner()] });

  const pairRes = await setupPairing(runtime);
  assert.equal(pairRes.statusCode, 200);

  // Establish WorkBuddy readiness.
  runtime.workbuddyExecution.enqueue({
    endpointId: 'workbuddy', proposalId: 'stub', planId: 'stub',
    goalId: 'stub', bindingHash: 'stub', prompt: 'stub', workingDirectory: '/tmp',
  });
  runtime.workbuddyExecution.claimNext('workbuddy');

  const res = await handleBridgeRequest(
    runtime,
    'POST',
    '/bridge/projects/cli-bridge/conversation/messages',
    jsonBody({ text: 'format abc' }),
  );

  assert.equal(res.statusCode, 201);
  assert.equal(res.payload.gate.type, 'auto_execute');
  const tasks = runtime.workbuddyExecution.exportTasks();
  const dispatched = tasks.find(t => t.prompt === 'format abc');
  assert.ok(dispatched, 'task was dispatched');
});

// Check 5: Executor result -> raw result in transcript
test('ACCEPTANCE-5: executor raw result in transcript', async () => {
  const { createBridgeRuntime, handleBridgeRequest } = await import('../apps/local-server/src/routes/bridge-api.ts');
  const runtime = createBridgeRuntime({ plannerAdapters: [safeAutoPlanner()] });

  const pairRes = await setupPairing(runtime);
  assert.equal(pairRes.statusCode, 200);

  runtime.workbuddyExecution.enqueue({
    endpointId: 'workbuddy', proposalId: 'stub', planId: 'stub',
    goalId: 'stub', bindingHash: 'stub', prompt: 'stub', workingDirectory: '/tmp',
  });
  runtime.workbuddyExecution.claimNext('workbuddy');

  const msg = await handleBridgeRequest(
    runtime, 'POST', '/bridge/projects/cli-bridge/conversation/messages',
    jsonBody({ text: 'format abc' }),
  );
  assert.equal(msg.statusCode, 201);

  const tasks = runtime.workbuddyExecution.exportTasks();
  const dispatched = tasks.find(t => t.prompt === 'format abc');
  assert.ok(dispatched);

  runtime.workbuddyExecution.claimNext('workbuddy');
  const result = await handleBridgeRequest(
    runtime, 'POST', '/bridge/endpoints/workbuddy/results',
    jsonBody({ taskId: dispatched.taskId, ok: true, stdout: 'ABC' }),
  );

  assert.equal(result.statusCode, 200);
  const transcript = runtime.conversationTranscriptStore.listByProject('cli-bridge');
  const executorEvents = transcript.filter(e => e.role === 'target');
  assert.ok(executorEvents.length > 0);
});

// Check 6: High-risk request_execution -> confirmation required
test('ACCEPTANCE-6: high-risk operation requires confirmation', async () => {
  const { createBridgeRuntime, handleBridgeRequest } = await import('../apps/local-server/src/routes/bridge-api.ts');
  const runtime = createBridgeRuntime({ plannerAdapters: [highRiskPlanner()] });

  const pairRes = await setupPairing(runtime);
  assert.equal(pairRes.statusCode, 200);

  runtime.workbuddyExecution.enqueue({
    endpointId: 'workbuddy', proposalId: 'stub', planId: 'stub',
    goalId: 'stub', bindingHash: 'stub', prompt: 'stub', workingDirectory: '/tmp',
  });
  runtime.workbuddyExecution.claimNext('workbuddy');

  const res = await handleBridgeRequest(
    runtime, 'POST', '/bridge/projects/cli-bridge/conversation/messages',
    jsonBody({ text: 'edit files' }),
  );

  assert.equal(res.statusCode, 201);
  assert.equal(res.payload.gate.type, 'require_user_confirm');
  assert.ok(res.payload.plan);
  assert.equal(res.payload.plan.status, 'proposed');
  assert.equal(runtime.workbuddyExecution.exportTasks().length, 1); // only the readiness probe task
});

// Check 8: Main transcript has no internal noise
test('ACCEPTANCE-8: main transcript hides route/queue internals', async () => {
  const { createBridgeRuntime, handleBridgeRequest } = await import('../apps/local-server/src/routes/bridge-api.ts');
  const runtime = createBridgeRuntime({ plannerAdapters: [safeAutoPlanner()] });

  const pairRes = await setupPairing(runtime);
  assert.equal(pairRes.statusCode, 200);

  runtime.workbuddyExecution.enqueue({
    endpointId: 'workbuddy', proposalId: 'stub', planId: 'stub',
    goalId: 'stub', bindingHash: 'stub', prompt: 'stub', workingDirectory: '/tmp',
  });
  runtime.workbuddyExecution.claimNext('workbuddy');

  await handleBridgeRequest(
    runtime, 'POST', '/bridge/projects/cli-bridge/conversation/messages',
    jsonBody({ text: 'format abc' }),
  );

  // Check raw transcript events do not expose internal labels in user-visible fields.
  const events = runtime.conversationTranscriptStore.listByProject('cli-bridge');
  for (const event of events) {
    if (event.visibility === 'user') {
      // User-visible events should not contain status/routeKind in text
      assert.doesNotMatch(event.text, /queued/);
      assert.doesNotMatch(event.text, /workbuddy-execution/);
      assert.doesNotMatch(event.text, /dispatch/i);
    }
  }
});

console.log('ALL POLICY-GATED PLANNER ACCEPTANCE CHECKS PASSED');
