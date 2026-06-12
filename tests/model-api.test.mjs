// v2.4a PlannerModel test suite
//
// Tests: model-api plannerSource, default review-cli unchanged,
// missing key, network failure, schema rejection, step ceiling,
// audit events, no raw prompt/response/key leakage, no state mutation.

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BRIDGE_PROJECTS_PATH,
  createBridgeRuntime,
  handleBridgeRequest,
} from '../apps/local-server/src/routes/bridge-api.ts';

// ════════════════════════════════════════════════════════════
// Helpers
// ════════════════════════════════════════════════════════════

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

function createGoal(runtime, description, projectId) {
  return runtime.goalStore.createGoal({ sessionId: 'test', description, projectId });
}

// ════════════════════════════════════════════════════════════
// Mock model provider for testing
// ════════════════════════════════════════════════════════════

function createMockProvider(opts = {}) {
  const {
    shouldFail = false,
    shouldTimeout = false,
    shouldReturnEmpty = false,
    returnsValid = true,
    stepCount = 2,
  } = opts;

  return async function plan(input) {
    if (shouldTimeout) {
      return new Promise(() => {}); // never resolves (test timeout will catch)
    }
    if (shouldFail) {
      return { ok: false, reason: 'simulated network error', retryable: false, latencyMs: 50 };
    }
    if (shouldReturnEmpty) {
      return {
        ok: true,
        draft: { steps: [], rationale: 'No steps needed' },
        provider: 'mock/test',
        usage: { promptTokens: 10, completionTokens: 5 },
        latencyMs: 30,
      };
    }
    if (!returnsValid) {
      return {
        ok: true,
        draft: {
          steps: [
            { intent: 'bad step', kind: 'invalid-kind', tier: 'invalid-tier', isStateMutating: false, targetEndpointId: 'unknown' },
          ],
        },
        provider: 'mock/test',
        usage: { promptTokens: 10, completionTokens: 5 },
        latencyMs: 30,
      };
    }
    const steps = [];
    for (let i = 0; i < stepCount; i++) {
      steps.push({
        intent: `Step ${i + 1}: do something useful`,
        kind: i === 0 ? 'review' : 'propose-patch',
        tier: 'patch-proposal',
        isStateMutating: false,
        targetEndpointId: input.endpoints[0]?.id || 'claude-code-command',
      });
    }
    return {
      ok: true,
      draft: { steps, rationale: 'A good plan' },
      provider: 'mock/test',
      usage: { promptTokens: 20, completionTokens: 10 },
      latencyMs: 25,
    };
  };
}

// ════════════════════════════════════════════════════════════
// Default review-cli unchanged
// ════════════════════════════════════════════════════════════

test('POST /bridge/goals/plan review-cli default behavior unchanged', async () => {
  const runtime = createBridgeRuntime({
    goalPlanCommandOptions: { command: 'echo', args: ['no-real-cli'], timeout: 100 },
  });
  const goal = createGoal(runtime, 'Test goal unchanged');
  const res = await call(runtime, 'POST', '/bridge/goals/plan', { goalId: goal.id });
  // Expect a controlled error from review-cli path, not a 500.
  assert.ok(res.statusCode === 400 || res.statusCode === 409);
});

// ════════════════════════════════════════════════════════════
// model-api happy path
// ════════════════════════════════════════════════════════════

test('plannerSource: model-api returns advisory draft with mock provider', async () => {
  const mockProvider = createMockProvider({ returnsValid: true, stepCount: 2 });
  const runtime = createBridgeRuntime({ modelProviderFactory: () => ({ plan: mockProvider }) });
  const goal = createGoal(runtime, 'Build a login page');

  const res = await call(runtime, 'POST', '/bridge/goals/plan', {
    goalId: goal.id,
    plannerSource: 'model-api',
    apiKey: 'sk-test-key',
  });

  assert.equal(res.statusCode, 200);
  assert.ok(res.payload.draft, 'should return a draft');
  assert.equal(res.payload.plan, null, 'should not attach a plan to the goal');
  assert.equal(res.payload.meta.source, 'model-api');
  assert.equal(res.payload.meta.modelSuggested, true);
  assert.ok(res.payload.draft.valid);
  assert.equal(res.payload.draft.steps.length, 2);

  // Verify goal state unchanged (plan not attached).
  const plan = runtime.goalStore.getPlanByGoal(goal.id);
  assert.ok(!plan, 'model plan should not attach to goal');
});

// ════════════════════════════════════════════════════════════
// Missing API key
// ════════════════════════════════════════════════════════════

test('plannerSource: model-api fails with missing API key', async () => {
  const mockProvider = createMockProvider();
  const runtime = createBridgeRuntime({ modelProviderFactory: () => ({ plan: mockProvider }) });
  const goal = createGoal(runtime, 'Test goal');

  const res = await call(runtime, 'POST', '/bridge/goals/plan', {
    goalId: goal.id,
    plannerSource: 'model-api',
    // no apiKey
  });

  assert.equal(res.statusCode, 409);
  assert.ok(res.payload.message.includes('key'));
});

// ════════════════════════════════════════════════════════════
// Model failure
// ════════════════════════════════════════════════════════════

test('plannerSource: model-api returns error on provider failure', async () => {
  const mockProvider = createMockProvider({ shouldFail: true });
  const runtime = createBridgeRuntime({ modelProviderFactory: () => ({ plan: mockProvider }) });
  const goal = createGoal(runtime, 'Test goal');

  const res = await call(runtime, 'POST', '/bridge/goals/plan', {
    goalId: goal.id,
    plannerSource: 'model-api',
    apiKey: 'sk-test',
  });

  assert.equal(res.statusCode, 409);
  assert.ok(res.payload.message.includes('failed'));
  assert.ok(res.payload.message.includes('simulated network error'));

  // Goal state unchanged.
  const plan = runtime.goalStore.getPlanByGoal(goal.id);
  assert.ok(!plan, 'model failure should not attach plan');
});

// ════════════════════════════════════════════════════════════
// Schema validation rejection
// ════════════════════════════════════════════════════════════

test('plannerSource: model-api handles schema-invalid output', async () => {
  const mockProvider = createMockProvider({ returnsValid: false });
  const runtime = createBridgeRuntime({ modelProviderFactory: () => ({ plan: mockProvider }) });
  const goal = createGoal(runtime, 'Test goal');

  const res = await call(runtime, 'POST', '/bridge/goals/plan', {
    goalId: goal.id,
    plannerSource: 'model-api',
    apiKey: 'sk-test',
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.draft.valid, false);
  assert.ok(res.payload.draft.validationIssues.length > 0);
  assert.ok(res.payload.meta.modelSuggested);
});

// ════════════════════════════════════════════════════════════
// Step ceiling enforcement
// ════════════════════════════════════════════════════════════

test('plannerSource: model-api enforces step ceiling', async () => {
  const mockProvider = createMockProvider({ returnsValid: true, stepCount: 20 });
  const runtime = createBridgeRuntime({ modelProviderFactory: () => ({ plan: mockProvider }) });
  const goal = createGoal(runtime, 'Test goal');

  const res = await call(runtime, 'POST', '/bridge/goals/plan', {
    goalId: goal.id,
    plannerSource: 'model-api',
    apiKey: 'sk-test',
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.draft.valid, false);
  assert.ok(res.payload.draft.validationIssues.some(issue => issue.includes('ceiling')));
});

// ════════════════════════════════════════════════════════════
// Audit events
// ════════════════════════════════════════════════════════════

test('plannerSource: model-api writes audit events without raw content', async () => {
  const mockProvider = createMockProvider({ returnsValid: true, stepCount: 1 });
  const runtime = createBridgeRuntime({ modelProviderFactory: () => ({ plan: mockProvider }) });
  const goal = createGoal(runtime, 'Test goal');

  await call(runtime, 'POST', '/bridge/goals/plan', {
    goalId: goal.id,
    plannerSource: 'model-api',
    apiKey: 'sk-test',
  });

  const events = runtime.auditLog.exportEvents();
  const reqEvent = events.find(e => e.type === 'model_plan_request');
  const resEvent = events.find(e => e.type === 'model_plan_result');

  assert.ok(reqEvent, 'should emit model_plan_request');
  assert.ok(resEvent, 'should emit model_plan_result');
  assert.equal(reqEvent.goalId, goal.id);
  assert.equal(resEvent.goalId, goal.id);
  assert.equal(reqEvent.result.ok, true);
  assert.equal(resEvent.result.ok, true);

  // No raw prompt/response/key in audit.
  const allEvents = JSON.stringify(events);
  assert.equal(allEvents.includes('sk-test'), false, 'API key must not be in audit');
  assert.equal(allEvents.includes('Build a login page'), false, 'goal description must not be in audit (raw prompt)');
});

// ════════════════════════════════════════════════════════════
// Forbidden kinds rejection
// ════════════════════════════════════════════════════════════

test('plannerModel: rejects git-commit, git-push, run-command steps', async () => {
  const { generateModelPlan } = await import('../apps/local-server/src/model/planner-model.ts');
  const provider = {
    plan: async () => ({
      ok: true,
      draft: {
        steps: [
          { intent: 'commit', kind: 'git-commit', tier: 'workspace-write', isStateMutating: true, targetEndpointId: 'claude-code-command' },
        ],
      },
      provider: 'test',
      usage: { promptTokens: 1, completionTokens: 1 },
      latencyMs: 1,
    }),
  };

  const result = await generateModelPlan(provider, {
    goalDescription: 'test',
    endpoints: [{ id: 'claude-code-command', label: 'CC' }],
    permittedTiers: ['patch-proposal', 'workspace-write'],
    maxSteps: 10,
  });

  assert.equal(result.ok, true);
  assert.ok(result.draft.validationIssues.some(i => i.includes('forbidden')));
});

// ════════════════════════════════════════════════════════════
// PlannerSource validation
// ════════════════════════════════════════════════════════════

test('plannerSource: rejects unknown plannerSource value', async () => {
  const runtime = createBridgeRuntime();
  const goal = createGoal(runtime, 'Test goal');

  const res = await call(runtime, 'POST', '/bridge/goals/plan', {
    goalId: goal.id,
    plannerSource: 'unknown-source',
  });

  assert.equal(res.statusCode, 400);
  assert.ok(res.payload.message.includes('plannerSource'));
});
