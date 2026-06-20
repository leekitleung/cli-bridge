import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BRIDGE_AUTOMATION_BINDINGS_PATH,
  BRIDGE_AUTOMATION_BINDINGS_DERIVE_PATH,
  BRIDGE_GOALS_APPROVE_PATH,
  BRIDGE_GOALS_PATH,
  BRIDGE_GOALS_PLAN_PATH,
  BRIDGE_GOALS_STEP_PATH,
  BRIDGE_GOALS_CANCEL_PATH,
  createBridgeRuntime,
  handleBridgeRequest,
  isBridgePath,
} from '../apps/local-server/src/routes/bridge-api.ts';

const now = 1793000000000;

const codexMedium = {
  id: 'codex-medium',
  label: 'Codex Medium',
  transport: 'command',
  risk: 'medium',
  capabilities: {
    canAcceptPrompt: true,
    canReturnOutput: true,
    canReview: true,
    canExecute: true,
    canSummarize: true,
  },
};

const claudeLow = {
  ...codexMedium,
  id: 'claude-low',
  label: 'Claude Low',
};

function jsonRequest(body) {
  const text = body === undefined ? '' : JSON.stringify(body);
  async function* gen() {
    if (text.length > 0) yield Buffer.from(text, 'utf8');
  }
  return gen();
}

function okRun(stdout) {
  return { exitCode: 0, stdout, stderr: '', timedOut: false };
}

function fakeLauncherResolver(command) {
  return { executable: `/fake/${command}`, prependArgs: [] };
}

function validPlanJson(goalId, projectId = 'cli-bridge') {
  return JSON.stringify({
    id: `plan-${goalId}`,
    goalId,
    status: 'awaiting-approval',
    permittedTiers: ['patch-proposal'],
    steps: [
      {
        id: 'step-1',
        planId: `plan-${goalId}`,
        index: 0,
        intent: 'Review the code',
        kind: 'review',
        targetEndpointId: 'claude-code-command',
        tier: 'patch-proposal',
        isStateMutating: false,
        status: 'pending',
      },
    ],
    createdAt: now,
    updatedAt: now,
    projectId,
  });
}

function runtimeWithPlan() {
  return createBridgeRuntime({
    additionalEndpoints: [codexMedium, claudeLow],
    goalPlanCommandOptions: {
      runner: {
        async run(execution) {
          const stdin = execution.stdin ?? '';
          const match = stdin.match(/Goal ID:\s*([a-f0-9-]+)/i);
          const goalId = match ? match[1] : 'goal-unknown';
          return okRun(validPlanJson(goalId));
        },
      },
      launcherResolver: fakeLauncherResolver,
    },
  });
}

async function createGoalAndPlan(runtime) {
  const create = await handleBridgeRequest(runtime, 'POST', BRIDGE_GOALS_PATH, jsonRequest({
    sessionId: 's1',
    description: 'Build the feature',
    projectId: 'cli-bridge',
  }));
  assert.equal(create.statusCode, 201);
  const goalId = create.payload.goal.id;
  const plan = await handleBridgeRequest(runtime, 'POST', BRIDGE_GOALS_PLAN_PATH, jsonRequest({ goalId }));
  assert.equal(plan.statusCode, 201);
  return { goalId, planId: plan.payload.plan.id };
}

function bindingBody(goalId, planId, overrides = {}) {
  return {
    goalId,
    planId,
    reasoningEndpointId: 'chatgpt-web',
    executionEndpointId: 'codex-medium',
    reasoningTier: 'high',
    executionTier: 'medium',
    executionPermissionProfile: 'patch-proposal',
    executionWorkingDirectoryRef: 'cli-bridge',
    maxSteps: 4,
    maxReasoningRounds: 2,
    deadlineAt: '2026-06-21T00:00:00.000Z',
    ...overrides,
  };
}

test('automation binding paths are recognized bridge paths', () => {
  assert.equal(isBridgePath(BRIDGE_AUTOMATION_BINDINGS_PATH), true);
  assert.equal(isBridgePath(BRIDGE_AUTOMATION_BINDINGS_DERIVE_PATH), true);
});

test('POST /bridge/automation/bindings creates and GET inspects project-scoped binding', async () => {
  const runtime = runtimeWithPlan();
  const { goalId, planId } = await createGoalAndPlan(runtime);

  const created = await handleBridgeRequest(runtime, 'POST', BRIDGE_AUTOMATION_BINDINGS_PATH, jsonRequest(bindingBody(goalId, planId)));
  assert.equal(created.statusCode, 201);
  assert.equal(created.payload.binding.goalId, goalId);
  assert.equal(created.payload.binding.planId, planId);
  assert.equal(created.payload.binding.reasoningEndpoint.id, 'chatgpt-web');
  assert.equal(created.payload.binding.executionEndpoint.id, 'codex-medium');
  assert.match(created.payload.binding.bindingHash, /^sha256:/);

  const inspected = await handleBridgeRequest(
    runtime,
    'GET',
    `${BRIDGE_AUTOMATION_BINDINGS_PATH}?planId=${encodeURIComponent(planId)}`,
    jsonRequest(),
  );
  assert.equal(inspected.statusCode, 200);
  assert.equal(inspected.payload.binding.planId, planId);
});

test('approving a plan locks its automation binding and mutation is rejected', async () => {
  const runtime = runtimeWithPlan();
  const { goalId, planId } = await createGoalAndPlan(runtime);
  await handleBridgeRequest(runtime, 'POST', BRIDGE_AUTOMATION_BINDINGS_PATH, jsonRequest(bindingBody(goalId, planId)));

  const approved = await handleBridgeRequest(runtime, 'POST', BRIDGE_GOALS_APPROVE_PATH, jsonRequest({ goalId }));
  assert.equal(approved.statusCode, 200);
  assert.ok(approved.payload.binding.lockedAt);

  const duplicate = await handleBridgeRequest(runtime, 'POST', BRIDGE_AUTOMATION_BINDINGS_PATH, jsonRequest(bindingBody(goalId, planId, {
    executionTier: 'low',
  })));
  assert.equal(duplicate.statusCode, 409);
  assert.match(duplicate.payload.message, /binding is locked/);
});

test('POST /bridge/automation/bindings/derive creates a new plan lineage instead of mutating old plan', async () => {
  const runtime = runtimeWithPlan();
  const { goalId, planId } = await createGoalAndPlan(runtime);
  await handleBridgeRequest(runtime, 'POST', BRIDGE_AUTOMATION_BINDINGS_PATH, jsonRequest(bindingBody(goalId, planId)));
  await handleBridgeRequest(runtime, 'POST', BRIDGE_GOALS_APPROVE_PATH, jsonRequest({ goalId }));

  const derived = await handleBridgeRequest(runtime, 'POST', BRIDGE_AUTOMATION_BINDINGS_DERIVE_PATH, jsonRequest({
    parentPlanId: planId,
    goalId,
    planId: 'derived-plan-1',
    executionEndpointId: 'claude-low',
    executionTier: 'low',
  }));

  assert.equal(derived.statusCode, 201);
  assert.equal(derived.payload.binding.parentPlanId, planId);
  assert.equal(derived.payload.binding.planId, 'derived-plan-1');
  assert.equal(derived.payload.binding.executionEndpoint.id, 'claude-low');

  const original = await handleBridgeRequest(runtime, 'GET', `${BRIDGE_AUTOMATION_BINDINGS_PATH}?planId=${planId}`, jsonRequest());
  assert.equal(original.payload.binding.executionEndpoint.id, 'codex-medium');
});

test('failed derive does not replace the current plan or create an orphan binding', async () => {
  const runtime = runtimeWithPlan();
  const { goalId, planId } = await createGoalAndPlan(runtime);
  await handleBridgeRequest(runtime, 'POST', BRIDGE_AUTOMATION_BINDINGS_PATH, jsonRequest(bindingBody(goalId, planId)));
  await handleBridgeRequest(runtime, 'POST', BRIDGE_GOALS_APPROVE_PATH, jsonRequest({ goalId }));

  const failed = await handleBridgeRequest(runtime, 'POST', BRIDGE_AUTOMATION_BINDINGS_DERIVE_PATH, jsonRequest({
    parentPlanId: planId,
    goalId,
    planId: 'invalid-derived-plan',
    executionEndpointId: 'missing-executor',
    executionTier: 'low',
  }));
  assert.equal(failed.statusCode, 409);

  const goals = await handleBridgeRequest(runtime, 'GET', BRIDGE_GOALS_PATH, jsonRequest());
  assert.equal(goals.statusCode, 200);
  assert.equal(goals.payload.goals[0].plan.id, planId);

  const orphan = await handleBridgeRequest(
    runtime,
    'GET',
    `${BRIDGE_AUTOMATION_BINDINGS_PATH}?planId=invalid-derived-plan`,
    jsonRequest(),
  );
  assert.equal(orphan.statusCode, 404);
});

test('cancel wins before PlanStep advance', async () => {
  const runtime = runtimeWithPlan();
  const { goalId, planId } = await createGoalAndPlan(runtime);
  await handleBridgeRequest(runtime, 'POST', BRIDGE_AUTOMATION_BINDINGS_PATH, jsonRequest(bindingBody(goalId, planId)));
  await handleBridgeRequest(runtime, 'POST', BRIDGE_GOALS_APPROVE_PATH, jsonRequest({ goalId }));
  await handleBridgeRequest(runtime, 'POST', BRIDGE_GOALS_CANCEL_PATH, jsonRequest({ goalId }));

  const step = await handleBridgeRequest(runtime, 'POST', BRIDGE_GOALS_STEP_PATH, jsonRequest({ goalId }));
  assert.equal(step.statusCode, 200);
  assert.equal(step.payload.result.type, 'noop');
  assert.equal(step.payload.result.reason, 'goal-cancelled');
});
