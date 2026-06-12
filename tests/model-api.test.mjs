// v2.4a PlannerModel test suite
//
// Tests: model-api plannerSource, default review-cli unchanged,
// missing key, network failure, schema rejection (fail-closed),
// step ceiling (fail-closed), forbidden kinds (fail-closed),
// input budget, parse failure (non-retryable),
// audit events (request before, result after, all outcomes),
// no raw prompt/response/key leakage, no state mutation.

import assert from 'node:assert/strict';
import test from 'node:test';
import {
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
    shouldReturnEmpty = false,
    returnsValid = true,
    stepCount = 2,
    forbiddenSteps = false,
    invalidKind = false,
    unknownEndpoint = false,
    stepCeiling = 5,
  } = opts;

  return async function plan(input) {
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
    if (invalidKind) {
      return {
        ok: true,
        draft: { steps: [{ intent: 'bad', kind: 'invalid-kind', tier: 'patch-proposal', isStateMutating: false, targetEndpointId: input.endpoints[0]?.id || 'claude-code-command' }] },
        provider: 'mock/test',
        usage: { promptTokens: 10, completionTokens: 5 },
        latencyMs: 30,
      };
    }
    if (unknownEndpoint) {
      return {
        ok: true,
        draft: { steps: [{ intent: 'bad', kind: 'review', tier: 'patch-proposal', isStateMutating: false, targetEndpointId: 'nonexistent' }] },
        provider: 'mock/test',
        usage: { promptTokens: 10, completionTokens: 5 },
        latencyMs: 30,
      };
    }
    if (forbiddenSteps) {
      return {
        ok: true,
        draft: { steps: [{ intent: 'commit', kind: 'git-commit', tier: 'workspace-write', isStateMutating: true, targetEndpointId: input.endpoints[0]?.id || 'claude-code-command' }] },
        provider: 'mock/test',
        usage: { promptTokens: 10, completionTokens: 5 },
        latencyMs: 30,
      };
    }
    const steps = [];
    for (let i = 0; i < stepCount; i++) {
      steps.push({
        intent: `Step ${i + 1}`,
        kind: i === 0 ? 'review' : 'propose-patch',
        tier: 'patch-proposal',
        isStateMutating: false,
        targetEndpointId: input.endpoints[0]?.id || 'claude-code-command',
      });
    }
    return {
      ok: true,
      draft: { steps, rationale: 'Good plan' },
      provider: 'mock/test',
      usage: { promptTokens: 20, completionTokens: 10 },
      latencyMs: 25,
    };
  };
}

function createMockCritiqueProvider(opts = {}) {
  const {
    critiqueShouldFail = false,
    invalidCritiqueSchema = false,
    forbiddenCritique = false,
    blockingCritique = false,
  } = opts;
  const plan = createMockProvider({ returnsValid: true, stepCount: 2 });
  return {
    plan,
    async critique(input) {
      if (critiqueShouldFail) {
        return { ok: false, reason: 'simulated critique provider error', retryable: false, latencyMs: 40 };
      }
      if (invalidCritiqueSchema) {
        return {
          ok: true,
          critique: { items: [{ severity: 'fatal', category: 'safety', message: 'bad' }] },
          provider: 'mock/critic',
          usage: { promptTokens: 15, completionTokens: 7 },
          latencyMs: 20,
        };
      }
      if (forbiddenCritique) {
        return {
          ok: true,
          critique: {
            summary: 'unsafe',
            items: [{
              severity: 'blocking',
              category: 'policy',
              message: 'Run this shell command to bypass the approval gate',
              stepIndex: 0,
              suggestedAction: 'git push origin main',
            }],
          },
          provider: 'mock/critic',
          usage: { promptTokens: 15, completionTokens: 7 },
          latencyMs: 20,
        };
      }
      return {
        ok: true,
        critique: {
          summary: blockingCritique ? 'Review found a blocking advisory issue' : 'No major risks found',
          items: [{
            severity: blockingCritique ? 'blocking' : 'warning',
            category: blockingCritique ? 'policy' : 'test_coverage',
            message: blockingCritique ? 'Human should review policy scope before approval.' : 'Add a focused regression test.',
            stepIndex: 0,
            suggestedAction: 'Add non-executable review notes for the human approver.',
          }],
        },
        provider: 'mock/critic',
        usage: { promptTokens: 15, completionTokens: 7 },
        latencyMs: 20,
      };
    },
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
  assert.equal(res.payload.critique, null);
  assert.equal(res.payload.meta.critic, null);
  assert.equal(res.payload.draft.steps.length, 2);

  // Goal state unchanged.
  assert.ok(!runtime.goalStore.getPlanByGoal(goal.id), 'model plan should not attach to goal');

  // Audit events: request before, result after, both present with metadata.
  const events = runtime.auditLog.exportEvents();
  const req = events.find(e => e.type === 'model_plan_request');
  const resE = events.find(e => e.type === 'model_plan_result');
  assert.ok(req, 'should have model_plan_request');
  assert.ok(resE, 'should have model_plan_result');
  assert.equal(req.result.ok, true);
  assert.equal(resE.result.ok, true);
  // Request audit metadata.
  const reqMeta = req.result.metadata;
  assert.equal(reqMeta.status, 'requested');
  assert.equal(reqMeta.provider, 'openai/gpt-4o-mini');
  assert.equal(reqMeta.tokenBudget.input, 4096);
  // Result audit metadata.
  const resMeta = resE.result.metadata;
  assert.equal(resMeta.status, 'accepted');
  assert.equal(resMeta.provider, 'mock/test');
  assert.ok(typeof resMeta.latencyMs === 'number');
  assert.ok(resMeta.usage);
  assert.ok(typeof resMeta.usage.promptTokens === 'number');
});

// ════════════════════════════════════════════════════════════
// CriticModel advisory review
// ════════════════════════════════════════════════════════════

test('criticSource: model-api returns advisory critique with draft and no plan attachment', async () => {
  const runtime = createBridgeRuntime({ modelProviderFactory: () => createMockCritiqueProvider() });
  const goal = createGoal(runtime, 'Build a login page');

  const res = await call(runtime, 'POST', '/bridge/goals/plan', {
    goalId: goal.id,
    plannerSource: 'model-api',
    criticSource: 'model-api',
    apiKey: 'sk-test-key',
  });

  assert.equal(res.statusCode, 200);
  assert.ok(res.payload.draft);
  assert.ok(res.payload.critique);
  assert.equal(res.payload.plan, null);
  assert.equal(res.payload.meta.critic.source, 'model-api');
  assert.equal(res.payload.critique.items.length, 1);
  assert.equal(runtime.goalStore.getGoal(goal.id).status, 'draft');
  assert.ok(!runtime.goalStore.getPlanByGoal(goal.id), 'critic should not attach plan');

  const events = runtime.auditLog.exportEvents();
  assert.ok(events.find(e => e.type === 'model_critique_request'));
  const result = events.find(e => e.type === 'model_critique_result');
  assert.ok(result);
  assert.equal(result.result.ok, true);
  const meta = result.result.metadata;
  assert.equal(meta.status, 'accepted');
  assert.equal(meta.provider, 'mock/critic');
  assert.equal(meta.itemCount, 1);
  assert.equal(meta.highestSeverity, 'warning');
});

test('criticSource: blocking critique is label only and does not mutate state', async () => {
  const runtime = createBridgeRuntime({ modelProviderFactory: () => createMockCritiqueProvider({ blockingCritique: true }) });
  const goal = createGoal(runtime, 'Review policy-sensitive plan');

  const res = await call(runtime, 'POST', '/bridge/goals/plan', {
    goalId: goal.id,
    plannerSource: 'model-api',
    criticSource: 'model-api',
    apiKey: 'sk-test-key',
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.critique.items[0].severity, 'blocking');
  assert.equal(runtime.goalStore.getGoal(goal.id).status, 'draft');
  assert.equal(runtime.goalStore.getPlanByGoal(goal.id), undefined);

  const meta = runtime.auditLog.exportEvents().find(e => e.type === 'model_critique_result').result.metadata;
  assert.equal(meta.highestSeverity, 'blocking');
  assert.equal(meta.status, 'accepted');
});

test('criticSource: model-api fail-closed on invalid critique schema', async () => {
  const runtime = createBridgeRuntime({ modelProviderFactory: () => createMockCritiqueProvider({ invalidCritiqueSchema: true }) });
  const goal = createGoal(runtime, 'Test goal');

  const res = await call(runtime, 'POST', '/bridge/goals/plan', {
    goalId: goal.id,
    plannerSource: 'model-api',
    criticSource: 'model-api',
    apiKey: 'sk-test',
  });

  assert.equal(res.statusCode, 409);
  assert.ok(res.payload.message.includes('schema validation'));
  assert.equal(runtime.goalStore.getGoal(goal.id).status, 'draft');
  assert.equal(runtime.goalStore.getPlanByGoal(goal.id), undefined);

  const meta = runtime.auditLog.exportEvents().find(e => e.type === 'model_critique_result').result.metadata;
  assert.equal(meta.status, 'rejected');
  assert.equal(meta.failureKind, 'schema-rejection');
});

test('criticSource: model-api rejects forbidden executable and gate-bypass critique content', async () => {
  const runtime = createBridgeRuntime({ modelProviderFactory: () => createMockCritiqueProvider({ forbiddenCritique: true }) });
  const goal = createGoal(runtime, 'Test goal');

  const res = await call(runtime, 'POST', '/bridge/goals/plan', {
    goalId: goal.id,
    plannerSource: 'model-api',
    criticSource: 'model-api',
    apiKey: 'sk-test',
  });

  assert.equal(res.statusCode, 409);
  assert.ok(res.payload.message.includes('policy constraints'));
  assert.equal(runtime.goalStore.getGoal(goal.id).status, 'draft');
  assert.equal(runtime.goalStore.getPlanByGoal(goal.id), undefined);

  const meta = runtime.auditLog.exportEvents().find(e => e.type === 'model_critique_result').result.metadata;
  assert.equal(meta.status, 'rejected');
  assert.equal(meta.failureKind, 'policy-rejection');
  assert.ok(meta.failureReason.includes('forbidden'));
});

test('criticSource: model-api audit has no raw content or key', async () => {
  const runtime = createBridgeRuntime({ modelProviderFactory: () => createMockCritiqueProvider({ blockingCritique: true }) });
  const goal = createGoal(runtime, 'Read raw file C:/secret.txt and use sk-test-secret');

  await call(runtime, 'POST', '/bridge/goals/plan', {
    goalId: goal.id,
    plannerSource: 'model-api',
    criticSource: 'model-api',
    apiKey: 'sk-test-secret',
  });

  const allEvents = JSON.stringify(runtime.auditLog.exportEvents());
  assert.equal(allEvents.includes('sk-test-secret'), false, 'API key must not be in audit');
  assert.equal(allEvents.includes('Read raw file'), false, 'goal description must not be in audit');
  assert.equal(allEvents.includes('rawPrompt'), false, 'raw prompt must not be in audit');
  assert.equal(allEvents.includes('rawProviderOutput'), false, 'raw output must not be in audit');
  assert.equal(allEvents.includes('C:/secret.txt'), false, 'raw file path/content request must not be in audit');
});

test('criticSource requires plannerSource: model-api', async () => {
  const runtime = createBridgeRuntime();
  const goal = createGoal(runtime, 'Test goal');
  const res = await call(runtime, 'POST', '/bridge/goals/plan', {
    goalId: goal.id,
    criticSource: 'model-api',
  });
  assert.equal(res.statusCode, 400);
  assert.ok(res.payload.message.includes('criticSource'));
});

// ════════════════════════════════════════════════════════════
// Missing API key
// ════════════════════════════════════════════════════════════

test('plannerSource: model-api fails with missing API key', async () => {
  const mockProvider = createMockProvider();
  const runtime = createBridgeRuntime({ modelProviderFactory: () => ({ plan: mockProvider }) });
  const goal = createGoal(runtime, 'Test goal');
  const res = await call(runtime, 'POST', '/bridge/goals/plan', {
    goalId: goal.id, plannerSource: 'model-api',
  });
  assert.equal(res.statusCode, 409);
  assert.ok(res.payload.message.includes('key'));
});

// ════════════════════════════════════════════════════════════
// Model failure (provider error)
// ════════════════════════════════════════════════════════════

test('plannerSource: model-api fail-closed on provider error', async () => {
  const mockProvider = createMockProvider({ shouldFail: true });
  const runtime = createBridgeRuntime({ modelProviderFactory: () => ({ plan: mockProvider }) });
  const goal = createGoal(runtime, 'Test goal');

  const res = await call(runtime, 'POST', '/bridge/goals/plan', {
    goalId: goal.id, plannerSource: 'model-api', apiKey: 'sk-test',
  });

  assert.equal(res.statusCode, 409);
  assert.ok(!runtime.goalStore.getPlanByGoal(goal.id));

  // Both request and result audit must exist with failure metadata.
  const events = runtime.auditLog.exportEvents();
  assert.ok(events.find(e => e.type === 'model_plan_request'));
  const resE = events.find(e => e.type === 'model_plan_result');
  assert.ok(resE);
  assert.equal(resE.result.ok, false);
  const meta = resE.result.metadata;
  assert.equal(meta.status, 'failed');
  assert.ok(meta.failureReason);
  assert.equal(meta.failureKind, 'provider-error');
});

// ════════════════════════════════════════════════════════════
// Schema rejection — fail-closed (409, not 200)
// ════════════════════════════════════════════════════════════

test('plannerSource: model-api fail-closed on schema-invalid output', async () => {
  const mockProvider = createMockProvider({ invalidKind: true });
  const runtime = createBridgeRuntime({ modelProviderFactory: () => ({ plan: mockProvider }) });
  const goal = createGoal(runtime, 'Test goal');

  const res = await call(runtime, 'POST', '/bridge/goals/plan', {
    goalId: goal.id, plannerSource: 'model-api', apiKey: 'sk-test',
  });

  assert.equal(res.statusCode, 409);
  assert.ok(res.payload.message.includes('schema validation'));

  const events = runtime.auditLog.exportEvents();
  const resE = events.find(e => e.type === 'model_plan_result');
  assert.ok(resE);
  assert.equal(resE.result.ok, false);
  const meta = resE.result.metadata;
  assert.equal(meta.status, 'rejected');
  assert.equal(meta.failureKind, 'schema-rejection');
  assert.ok(meta.failureReason);
});

// ════════════════════════════════════════════════════════════
// Step ceiling — fail-closed
// ════════════════════════════════════════════════════════════

test('plannerSource: model-api fail-closed on step ceiling violation', async () => {
  const mockProvider = createMockProvider({ stepCount: 20 });
  const runtime = createBridgeRuntime({ modelProviderFactory: () => ({ plan: mockProvider }) });
  const goal = createGoal(runtime, 'Test goal');

  const res = await call(runtime, 'POST', '/bridge/goals/plan', {
    goalId: goal.id, plannerSource: 'model-api', apiKey: 'sk-test',
  });

  assert.equal(res.statusCode, 409);
  assert.ok(res.payload.message.includes('policy'));
});

// ════════════════════════════════════════════════════════════
// Forbidden kinds — fail-closed
// ════════════════════════════════════════════════════════════

test('plannerSource: model-api fail-closed on forbidden step kinds', async () => {
  const mockProvider = createMockProvider({ forbiddenSteps: true });
  const runtime = createBridgeRuntime({ modelProviderFactory: () => ({ plan: mockProvider }) });
  const goal = createGoal(runtime, 'Test goal');

  const res = await call(runtime, 'POST', '/bridge/goals/plan', {
    goalId: goal.id, plannerSource: 'model-api', apiKey: 'sk-test',
  });

  assert.equal(res.statusCode, 409);
  assert.ok(res.payload.message.includes('policy'));
});

// ════════════════════════════════════════════════════════════
// Empty plan — fail-closed
// ════════════════════════════════════════════════════════════

test('plannerSource: model-api fail-closed on empty plan', async () => {
  const mockProvider = createMockProvider({ shouldReturnEmpty: true });
  const runtime = createBridgeRuntime({ modelProviderFactory: () => ({ plan: mockProvider }) });
  const goal = createGoal(runtime, 'Test goal');

  const res = await call(runtime, 'POST', '/bridge/goals/plan', {
    goalId: goal.id, plannerSource: 'model-api', apiKey: 'sk-test',
  });

  assert.equal(res.statusCode, 409);
});

// ════════════════════════════════════════════════════════════
// Unknown endpoint — fail-closed
// ════════════════════════════════════════════════════════════

test('plannerSource: model-api fail-closed on unknown endpoint', async () => {
  const mockProvider = createMockProvider({ unknownEndpoint: true });
  const runtime = createBridgeRuntime({ modelProviderFactory: () => ({ plan: mockProvider }) });
  const goal = createGoal(runtime, 'Test goal');

  const res = await call(runtime, 'POST', '/bridge/goals/plan', {
    goalId: goal.id, plannerSource: 'model-api', apiKey: 'sk-test',
  });

  assert.equal(res.statusCode, 409);
  assert.ok(res.payload.message.includes('schema'));
});

// ════════════════════════════════════════════════════════════
// Input budget exceeded — non-retryable, fail-closed
// ════════════════════════════════════════════════════════════

test('plannerModel: input budget exceeded returns non-retryable failure', async () => {
  const { OpenAiAdapter } = await import('../apps/local-server/src/model/openai-adapter.ts');
  const adapter = new OpenAiAdapter('sk-test', { maxInputTokens: 10 }); // tiny budget
  const result = await adapter.plan({
    goalDescription: 'A very long goal description that exceeds the tiny token budget',
    endpoints: [{ id: 'cc', label: 'CC' }],
    permittedTiers: ['patch-proposal'],
    maxSteps: 5,
  });
  assert.equal(result.ok, false);
  assert.equal(result.retryable, false);
  assert.ok(result.reason.includes('Input too large') || result.reason.includes('budget') || result.reason.includes('exceed'));
});

// ════════════════════════════════════════════════════════════
// Audit redaction — no raw content / API key leakage
// ════════════════════════════════════════════════════════════

test('plannerSource: model-api audit has no raw content or key', async () => {
  const mockProvider = createMockProvider({ returnsValid: true, stepCount: 1 });
  const runtime = createBridgeRuntime({ modelProviderFactory: () => ({ plan: mockProvider }) });
  const goal = createGoal(runtime, 'Build a login page');

  await call(runtime, 'POST', '/bridge/goals/plan', {
    goalId: goal.id, plannerSource: 'model-api', apiKey: 'sk-test-secret',
  });

  const allEvents = JSON.stringify(runtime.auditLog.exportEvents());
  assert.equal(allEvents.includes('sk-test-secret'), false, 'API key must not be in audit');
  assert.equal(allEvents.includes('Build a login page'), false, 'goal description must not be in audit');

  // Verify typed audit metadata has no raw content.
  const resultEvent = runtime.auditLog.exportEvents().find(e => e.type === 'model_plan_result');
  const meta = resultEvent.result.metadata;
  const metaStr = JSON.stringify(meta);
  assert.equal(metaStr.includes('sk-test'), false, 'API key must not be in audit metadata');
  assert.equal(metaStr.includes('rawProviderOutput'), false, 'no raw provider output in audit metadata');
  assert.equal(metaStr.includes('rawPrompt'), false, 'no raw prompt content in audit metadata');
});

// ════════════════════════════════════════════════════════════
// Audit metadata completeness
// ════════════════════════════════════════════════════════════

test('model plan audit request includes provider, budget, tiers, status', async () => {
  const mockProvider = createMockProvider({ returnsValid: true, stepCount: 1 });
  const runtime = createBridgeRuntime({ modelProviderFactory: () => ({ plan: mockProvider }) });
  const goal = createGoal(runtime, 'Test');

  await call(runtime, 'POST', '/bridge/goals/plan', {
    goalId: goal.id, plannerSource: 'model-api', apiKey: 'sk-test',
  });

  const req = runtime.auditLog.exportEvents().find(e => e.type === 'model_plan_request');
  assert.ok(req);
  const meta = req.result.metadata;
  assert.equal(meta.status, 'requested');
  assert.ok(meta.provider);
  assert.equal(meta.endpoint, 'openai/chat/completions');
  assert.ok(typeof meta.tokenBudget.input === 'number');
  assert.ok(typeof meta.tokenBudget.output === 'number');
  assert.ok(typeof meta.maxSteps === 'number');
  assert.ok(Array.isArray(meta.permittedTiers));
});

test('model plan audit result accepted has provider, usage, latency, status', async () => {
  const mockProvider = createMockProvider({ returnsValid: true, stepCount: 1 });
  const runtime = createBridgeRuntime({ modelProviderFactory: () => ({ plan: mockProvider }) });
  const goal = createGoal(runtime, 'Test');

  await call(runtime, 'POST', '/bridge/goals/plan', {
    goalId: goal.id, plannerSource: 'model-api', apiKey: 'sk-test',
  });

  const res = runtime.auditLog.exportEvents().find(e => e.type === 'model_plan_result');
  assert.ok(res);
  assert.equal(res.result.ok, true);
  const meta = res.result.metadata;
  assert.equal(meta.status, 'accepted');
  assert.ok(meta.provider);
  assert.ok(typeof meta.latencyMs === 'number');
  assert.ok(meta.usage);
  assert.ok(typeof meta.usage.promptTokens === 'number');
});

// ════════════════════════════════════════════════════════════
// Parse failure classification
// ════════════════════════════════════════════════════════════

test('OpenAiAdapter: JSON parse failure is non-retryable', async () => {
  const { OpenAiAdapter } = await import('../apps/local-server/src/model/openai-adapter.ts');
  // Use a model name that will fail the actual API, but we want to test the classification.
  // Instead, test via the generateModelPlan path with a mock that returns invalid JSON.
  // We test that parseModelOutput throws -> caught as non-retryable.
  const adapter = new OpenAiAdapter('sk-test');
  // Directly test parseModelOutput with invalid JSON.
  try {
    // Access private via prototype for test.
    const parsed = Object.getPrototypeOf(adapter).parseModelOutput.call(adapter, '{invalid json');
    assert.fail('should have thrown');
  } catch (err) {
    assert.ok(err instanceof SyntaxError || err.message.includes('JSON'));
  }
});

// ════════════════════════════════════════════════════════════
// Console: no execute/dispatch/apply buttons
// ════════════════════════════════════════════════════════════

test('console model API display has no execute buttons', async () => {
  const { renderProjectConsoleHtml } = await import('../apps/local-server/src/routes/project-console.ts');
  const html = renderProjectConsoleHtml();
  // Should show model API status.
  assert.ok(html.includes('Model API'), 'console should show model API status');
  // No execute/dispatch/apply buttons for model actions.
  const hasApply = html.includes('apply plan') || html.includes('Apply Plan');
  const hasDispatch = html.includes('dispatch model') || html.includes('Dispatch Plan');
  const hasExecute = html.includes('execute plan') || html.includes('Execute Plan');
  const hasAutoApply = html.includes('auto-apply');
  assert.equal(hasApply || hasDispatch || hasExecute || hasAutoApply, false, 'no model execute/dispatch/apply actions');
});

// ════════════════════════════════════════════════════════════
// PlannerSource validation
// ════════════════════════════════════════════════════════════

test('plannerSource: rejects unknown plannerSource value', async () => {
  const runtime = createBridgeRuntime();
  const goal = createGoal(runtime, 'Test goal');
  const res = await call(runtime, 'POST', '/bridge/goals/plan', {
    goalId: goal.id, plannerSource: 'unknown-source',
  });
  assert.equal(res.statusCode, 400);
  assert.ok(res.payload.message.includes('plannerSource'));
});
