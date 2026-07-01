import assert from 'node:assert/strict';
import test from 'node:test';
import { createBridgeRuntime } from '../apps/local-server/src/routes/bridge-api.ts';
import { tickAutomationLoop, runAutomationLoop, recordAutomationLoopResult } from '../apps/local-server/src/automation/automation-loop-runner.ts';

const now = 1793000000000;

function createRuntime() {
  return createBridgeRuntime();
}

function createLoop(runtime, overrides = {}) {
  // Register target endpoint
  runtime.endpointRegistry.register({
    id: 'workbuddy',
    label: 'WorkBuddy Executor',
    transport: 'workbuddy',
    risk: 'medium',
    capabilities: {
      canAcceptPrompt: true,
      canReturnOutput: true,
      canReview: false,
      canExecute: true,
      canSummarize: false,
    },
  });
  runtime.projectStore.upsert({ key: 'cli-bridge', label: 'CLI Bridge' });

  return runtime.automationLoopStore.create({
    projectId: 'cli-bridge',
    sourceEndpointId: 'chatgpt-web',
    targetEndpointId: 'workbuddy',
    maxCycles: 2,
    noProgressLimit: 2,
    deadlineAt: now + 600_000,
    now,
    ...overrides,
  });
}

// --- Auth guard ---

test('runner refuses extension-session authority', () => {
  const runtime = createRuntime();
  const loop = createLoop(runtime);
  const result = tickAutomationLoop(runtime, loop.id, {
    input: 'should not run',
    authKind: 'extension-session',
  });
  assert.equal(result.type, 'blocked');
  assert.equal(result.reason, 'console-cookie-required');
});

test('runner allows console-cookie authority', () => {
  const runtime = createRuntime();
  const loop = createLoop(runtime);
  const result = tickAutomationLoop(runtime, loop.id, {
    input: 'inspect project state',
    authKind: 'console-cookie',
    now: now + 1000,
  });
  assert.equal(result.type, 'dispatched');
  assert.ok(result.cycle);
  assert.equal(result.cycle.status, 'waiting-result');
});

// --- Terminal states ---

test('runner refuses cancelled loop', () => {
  const runtime = createRuntime();
  const loop = createLoop(runtime);
  runtime.automationLoopStore.cancel(loop.id);
  const result = tickAutomationLoop(runtime, loop.id, {
    input: 'should not run',
    authKind: 'console-cookie',
  });
  assert.equal(result.type, 'blocked');
  assert.equal(result.reason, 'loop-cancelled');
});

test('runner refuses paused loop', () => {
  const runtime = createRuntime();
  const loop = createLoop(runtime);
  runtime.automationLoopStore.start(loop.id);
  runtime.automationLoopStore.pause(loop.id);
  const result = tickAutomationLoop(runtime, loop.id, {
    input: 'should not run',
    authKind: 'console-cookie',
  });
  assert.equal(result.type, 'blocked');
  assert.equal(result.reason, 'loop-paused');
});

// --- Dispatch ---

test('runner tick dispatches one work cycle and returns waiting', () => {
  const runtime = createRuntime();
  const loop = createLoop(runtime);
  const result = tickAutomationLoop(runtime, loop.id, {
    input: 'inspect current project state',
    authKind: 'console-cookie',
    now: now + 1000,
  });
  assert.equal(result.type, 'dispatched');
  assert.equal(result.cycle.status, 'waiting-result');

  const updatedLoop = runtime.automationLoopStore.get(loop.id);
  assert.equal(updatedLoop.status, 'waiting');
  assert.equal(updatedLoop.cycleCount, 0);
});

test('runner creates a conversation action for the tick', () => {
  const runtime = createRuntime();
  const loop = createLoop(runtime);
  tickAutomationLoop(runtime, loop.id, {
    input: 'test action',
    authKind: 'console-cookie',
    now: now + 1000,
  });

  const actions = runtime.conversationActionStore.listByProject('cli-bridge');
  assert.ok(actions.length >= 1, 'at least one action was created');
});

test('runner enqueues original input text, not preview text', () => {
  const runtime = createRuntime();
  const loop = createLoop(runtime);
  const result = tickAutomationLoop(runtime, loop.id, {
    input: 'inspect current project state',
    authKind: 'console-cookie',
    now: now + 1000,
  });
  assert.equal(result.type, 'dispatched');
  const task = runtime.workbuddyExecution.claimNext('workbuddy');
  assert.equal(task.prompt, 'inspect current project state');
});

test('runner retry does not duplicate dispatch while cycle is unresolved', () => {
  const runtime = createRuntime();
  const loop = createLoop(runtime);
  const first = tickAutomationLoop(runtime, loop.id, {
    input: 'idempotent cycle',
    authKind: 'console-cookie',
    now: now + 1000,
    cycleIndex: 1,
  });
  const retry = tickAutomationLoop(runtime, loop.id, {
    input: 'idempotent cycle retry',
    authKind: 'console-cookie',
    now: now + 2000,
    cycleIndex: 1,
  });
  assert.equal(first.type, 'dispatched');
  assert.equal(retry.type, 'waiting');
  assert.equal(runtime.workbuddyExecution.listPendingTasks('workbuddy').length, 1);
});

// --- Stop condition: max-cycles ---

test('runner stops at max cycles', () => {
  const runtime = createRuntime();
  const loop = createLoop(runtime, { maxCycles: 1 });
  const result1 = tickAutomationLoop(runtime, loop.id, {
    input: 'first tick',
    authKind: 'console-cookie',
    now: now + 1000,
  });
  assert.equal(result1.type, 'dispatched');
  const task = runtime.workbuddyExecution.claimNext('workbuddy');
  runtime.workbuddyExecution.recordResult(task.taskId, {
    ok: true,
    proposalId: task.proposalId,
    output: { nextInput: 'unused' },
    durationMs: 1,
  });
  recordAutomationLoopResult(runtime, loop.id, result1.cycle.id, { workBuddyTaskId: task.taskId, now: now + 1500 });

  const result2 = tickAutomationLoop(runtime, loop.id, {
    input: 'second tick should stop',
    authKind: 'console-cookie',
    now: now + 2000,
  });
  assert.equal(result2.type, 'stopped');
  assert.equal(result2.reason, 'max-cycles');
});

// --- runAutomationLoop ---

test('run runs until stop condition', () => {
  const runtime = createRuntime();
  const loop = createLoop(runtime, { maxCycles: 1 });
  const result = runAutomationLoop(runtime, loop.id, {
    input: 'run test',
    authKind: 'console-cookie',
    maxTicksPerRun: 5,
    now: now + 1000,
  });
  assert.equal(result.trace.length, 2);
  assert.equal(result.trace[0].type, 'dispatched');
  assert.equal(result.trace[1].type, 'waiting');
});

test('run stops at waiting instead of dispatching unresolved cycles', () => {
  const runtime = createRuntime();
  const loop = createLoop(runtime, { maxCycles: 10 });
  const result = runAutomationLoop(runtime, loop.id, {
    input: 'run test',
    authKind: 'console-cookie',
    maxTicksPerRun: 2,
    now: now + 1000,
  });
  assert.equal(result.trace.length, 2);
  assert.equal(result.trace[0].type, 'dispatched');
  assert.equal(result.trace[1].type, 'waiting');
  assert.equal(runtime.workbuddyExecution.listPendingTasks('workbuddy').length, 1);
});

test('run hard caps at 10 ticks per run', () => {
  const runtime = createRuntime();
  const loop = createLoop(runtime, { maxCycles: 20 });
  const result = runAutomationLoop(runtime, loop.id, {
    input: 'run test',
    authKind: 'console-cookie',
    maxTicksPerRun: 100,
    now: now + 1000,
  });
  assert.ok(result.trace.length <= 10, `expected <= 10, got ${result.trace.length}`);
});

// --- Edge cases ---

test('runner errors on non-existent loop', () => {
  const runtime = createRuntime();
  const result = tickAutomationLoop(runtime, 'nonexistent', {
    input: 'test',
    authKind: 'console-cookie',
  });
  assert.equal(result.type, 'error');
  assert.equal(result.reason, 'loop-not-found');
});

test('runner stops on endpoint-not-found', () => {
  const runtime = createRuntime();
  const loop = runtime.automationLoopStore.create({
    projectId: 'cli-bridge',
    sourceEndpointId: 'chatgpt-web',
    targetEndpointId: 'nonexistent',
    maxCycles: 2,
    noProgressLimit: 2,
    deadlineAt: now + 600_000,
    now,
  });
  const result = tickAutomationLoop(runtime, loop.id, {
    input: 'test',
    authKind: 'console-cookie',
    now: now + 1000,
  });
  assert.equal(result.type, 'stopped');
  assert.equal(result.reason, 'endpoint-unavailable');
});

test('runner auto-starts draft loops', () => {
  const runtime = createRuntime();
  const loop = createLoop(runtime); // created as 'draft'
  assert.equal(loop.status, 'draft');

  tickAutomationLoop(runtime, loop.id, {
    input: 'test',
    authKind: 'console-cookie',
    now: now + 1000,
  });

  const updated = runtime.automationLoopStore.get(loop.id);
  assert.equal(updated.status, 'waiting');
});
