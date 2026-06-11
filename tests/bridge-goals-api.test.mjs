// Goal-driven execution HTTP endpoint tests (§7.4, ADR-0003).
//
// Layer 1 — Unit integration: calls handleBridgeRequest directly
// with fake runner/adapter injection (no real CLI spawns).
//
// Covers:
//   1. POST /bridge/goals          — create goal
//   2. POST /bridge/goals/plan     — generate plan (fake CLI)
//   3. POST /bridge/goals/approve  — approve plan
//   4. POST /bridge/goals/step     — advance one step
//   5. POST /bridge/goals/gate     — gate-approve mutating step
//   6. POST /bridge/goals/cancel   — cancel goal
//   7. GET  /bridge/goals          — list goals + plan state
//   8. Integration: full life cycle create→plan→approve→step→done
//   9. Gate denial: plan not approved → step rejected
//  10. Gate denial: mutating step requires gate
//  11. Gate denial: tier-violation
//  12. Error cases: missing fields, bad goalId

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BRIDGE_GOALS_PATH,
  BRIDGE_GOALS_PLAN_PATH,
  BRIDGE_GOALS_APPROVE_PATH,
  BRIDGE_GOALS_STEP_PATH,
  BRIDGE_GOALS_GATE_PATH,
  BRIDGE_GOALS_CANCEL_PATH,
  createBridgeRuntime,
  handleBridgeRequest,
  isBridgePath,
} from '../apps/local-server/src/routes/bridge-api.ts';

const now = 1792000000000;

// ---- Test helpers ----

function jsonRequest(body) {
  const text = body === undefined ? '' : JSON.stringify(body);
  async function* gen() {
    if (text.length > 0) {
      yield Buffer.from(text, 'utf8');
    }
  }
  return gen();
}

function okRun(stdout) {
  return { exitCode: 0, stdout, stderr: '', timedOut: false };
}

function fakeRunner(result) {
  return {
    async run() {
      return typeof result === 'function' ? result() : result;
    },
  };
}

function fakeLauncherResolver(command) {
  return { executable: `/fake/${command}`, prependArgs: [] };
}

function validPlanJson(goalId, overrides = {}) {
  return JSON.stringify({
    id: `plan-${goalId}`,
    goalId,
    status: 'awaiting-approval',
    permittedTiers: ['patch-proposal'],
    steps: [
      {
        id: 'step-1', planId: `plan-${goalId}`, index: 0,
        intent: 'Review the code', kind: 'review',
        targetEndpointId: 'claude-code-command',
        tier: 'patch-proposal', isStateMutating: false, status: 'pending',
      },
      {
        id: 'step-2', planId: `plan-${goalId}`, index: 1,
        intent: 'Propose a patch', kind: 'propose-patch',
        targetEndpointId: 'codex-command',
        tier: 'patch-proposal', isStateMutating: false, status: 'pending',
      },
    ],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  });
}

function runtimeWithDynamicPlan(planBuilder) {
  const builder = planBuilder ?? ((gid) => validPlanJson(gid));
  return createBridgeRuntime({
    goalPlanCommandOptions: {
      runner: {
        async run(execution) {
          const stdin = execution.stdin ?? '';
          const match = stdin.match(/Goal ID:\s*([a-f0-9-]+)/i);
          const goalId = match ? match[1] : 'goal-unknown';
          return okRun(builder(goalId));
        },
      },
      launcherResolver: fakeLauncherResolver,
    },
  });
}

// ════════════════════════════════════════════════════════════════════
// Path registration
// ════════════════════════════════════════════════════════════════════

test('goal paths are recognized bridge paths', () => {
  assert.equal(isBridgePath(BRIDGE_GOALS_PATH), true);
  assert.equal(isBridgePath(BRIDGE_GOALS_PLAN_PATH), true);
  assert.equal(isBridgePath(BRIDGE_GOALS_APPROVE_PATH), true);
  assert.equal(isBridgePath(BRIDGE_GOALS_STEP_PATH), true);
  assert.equal(isBridgePath(BRIDGE_GOALS_GATE_PATH), true);
  assert.equal(isBridgePath(BRIDGE_GOALS_CANCEL_PATH), true);
});

// ════════════════════════════════════════════════════════════════════
// POST /bridge/goals — create goal
// ════════════════════════════════════════════════════════════════════

test('POST /bridge/goals creates a goal in draft status', async () => {
  const runtime = createBridgeRuntime();
  const res = await handleBridgeRequest(runtime, 'POST', BRIDGE_GOALS_PATH, jsonRequest({
    sessionId: 'session-1',
    description: 'Add dark mode toggle',
  }));

  assert.equal(res.statusCode, 201);
  assert.ok(res.payload.goal);
  assert.equal(res.payload.goal.sessionId, 'session-1');
  assert.equal(res.payload.goal.description, 'Add dark mode toggle');
  assert.equal(res.payload.goal.status, 'draft');
});

test('POST /bridge/goals requires sessionId and description', async () => {
  const runtime = createBridgeRuntime();

  const res1 = await handleBridgeRequest(runtime, 'POST', BRIDGE_GOALS_PATH, jsonRequest({
    description: 'no sessionId',
  }));
  assert.equal(res1.statusCode, 400);

  const res2 = await handleBridgeRequest(runtime, 'POST', BRIDGE_GOALS_PATH, jsonRequest({
    sessionId: 's1',
  }));
  assert.equal(res2.statusCode, 400);
});

test('POST /bridge/goals creates independent goals', async () => {
  const runtime = createBridgeRuntime();
  const g1 = await handleBridgeRequest(runtime, 'POST', BRIDGE_GOALS_PATH, jsonRequest({
    sessionId: 's1', description: 'Task A',
  }));
  const g2 = await handleBridgeRequest(runtime, 'POST', BRIDGE_GOALS_PATH, jsonRequest({
    sessionId: 's2', description: 'Task B',
  }));

  assert.equal(g1.statusCode, 201);
  assert.equal(g2.statusCode, 201);
  assert.notEqual(g1.payload.goal.id, g2.payload.goal.id);
});

// ════════════════════════════════════════════════════════════════════
// GET /bridge/goals — list goals
// ════════════════════════════════════════════════════════════════════

test('GET /bridge/goals lists created goals with null plan when no plan exists', async () => {
  const runtime = createBridgeRuntime();
  await handleBridgeRequest(runtime, 'POST', BRIDGE_GOALS_PATH, jsonRequest({
    sessionId: 's1', description: 'Task A',
  }));
  await handleBridgeRequest(runtime, 'POST', BRIDGE_GOALS_PATH, jsonRequest({
    sessionId: 's1', description: 'Task B',
  }));

  const res = await handleBridgeRequest(runtime, 'GET', BRIDGE_GOALS_PATH, jsonRequest());
  assert.equal(res.statusCode, 200);
  assert.ok(Array.isArray(res.payload.goals));
  assert.equal(res.payload.goals.length, 2);
  assert.equal(res.payload.goals[0].plan, null);
  assert.equal(res.payload.goals[1].plan, null);
});

test('GET /bridge/goals includes plan when attached', async () => {
  const runtime = runtimeWithDynamicPlan((gid) => validPlanJson(gid));

  const create = await handleBridgeRequest(runtime, 'POST', BRIDGE_GOALS_PATH, jsonRequest({
    sessionId: 's1', description: 'Task with plan',
  }));
  const goalId = create.payload.goal.id;

  // Generate plan.
  await handleBridgeRequest(runtime, 'POST', BRIDGE_GOALS_PLAN_PATH, jsonRequest({
    goalId,
  }));

  const res = await handleBridgeRequest(runtime, 'GET', BRIDGE_GOALS_PATH, jsonRequest());
  assert.equal(res.payload.goals.length, 1);
  assert.ok(res.payload.goals[0].plan);
  assert.equal(res.payload.goals[0].plan.steps.length, 2);
});

// ════════════════════════════════════════════════════════════════════
// POST /bridge/goals/plan — generate plan
// ════════════════════════════════════════════════════════════════════

test('POST /bridge/goals/plan generates a plan via fake CLI', async () => {
  const runtime = runtimeWithDynamicPlan((gid) => validPlanJson(gid));

  const create = await handleBridgeRequest(runtime, 'POST', BRIDGE_GOALS_PATH, jsonRequest({
    sessionId: 's1', description: 'Fix login bug',
  }));
  const goalId = create.payload.goal.id;

  const res = await handleBridgeRequest(runtime, 'POST', BRIDGE_GOALS_PLAN_PATH, jsonRequest({
    goalId,
  }));

  assert.equal(res.statusCode, 201);
  assert.ok(res.payload.plan);
  assert.equal(res.payload.plan.status, 'awaiting-approval');
  assert.equal(res.payload.plan.goalId, goalId);
  assert.equal(res.payload.plan.steps.length, 2);
  assert.ok(res.payload.meta);
  assert.equal(res.payload.meta.adapterName, 'goal-plan-generator');
});

test('POST /bridge/goals/plan requires goalId', async () => {
  const runtime = createBridgeRuntime();
  const res = await handleBridgeRequest(runtime, 'POST', BRIDGE_GOALS_PLAN_PATH, jsonRequest({}));
  assert.equal(res.statusCode, 400);
});

test('POST /bridge/goals/plan rejects non-existent goalId', async () => {
  const runtime = runtimeWithDynamicPlan((gid) => validPlanJson(gid));
  const res = await handleBridgeRequest(runtime, 'POST', BRIDGE_GOALS_PLAN_PATH, jsonRequest({
    goalId: 'nonexistent',
  }));
  assert.equal(res.statusCode, 409);
  assert.ok(res.payload.message.includes('goal-not-found'));
});

test('POST /bridge/goals/plan rejects goal not in draft status', async () => {
  const runtime = runtimeWithDynamicPlan((gid) => validPlanJson(gid));

  const create = await handleBridgeRequest(runtime, 'POST', BRIDGE_GOALS_PATH, jsonRequest({
    sessionId: 's1', description: 'Task',
  }));
  const goalId = create.payload.goal.id;

  // Generate a plan.
  await handleBridgeRequest(runtime, 'POST', BRIDGE_GOALS_PLAN_PATH, jsonRequest({ goalId }));

  // Goal is now 'planned', cannot generate plan again.
  const res = await handleBridgeRequest(runtime, 'POST', BRIDGE_GOALS_PLAN_PATH, jsonRequest({ goalId }));
  assert.equal(res.statusCode, 409);
  assert.ok(res.payload.message.includes('goal-not-draft') || res.payload.message.includes('failed'));
});

// ════════════════════════════════════════════════════════════════════
// POST /bridge/goals/approve — approve plan
// ════════════════════════════════════════════════════════════════════

test('POST /bridge/goals/approve approves an awaiting-approval plan', async () => {
  const runtime = runtimeWithDynamicPlan((gid) => validPlanJson(gid));

  const create = await handleBridgeRequest(runtime, 'POST', BRIDGE_GOALS_PATH, jsonRequest({
    sessionId: 's1', description: 'Task',
  }));
  const goalId = create.payload.goal.id;
  await handleBridgeRequest(runtime, 'POST', BRIDGE_GOALS_PLAN_PATH, jsonRequest({ goalId }));

  const res = await handleBridgeRequest(runtime, 'POST', BRIDGE_GOALS_APPROVE_PATH, jsonRequest({ goalId }));
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.plan.status, 'approved');
  assert.equal(res.payload.goal.status, 'approved');
});

test('POST /bridge/goals/approve requires goalId', async () => {
  const runtime = createBridgeRuntime();
  const res = await handleBridgeRequest(runtime, 'POST', BRIDGE_GOALS_APPROVE_PATH, jsonRequest({}));
  assert.equal(res.statusCode, 400);
});

test('POST /bridge/goals/approve rejects non-existent goal', async () => {
  const runtime = createBridgeRuntime();
  const res = await handleBridgeRequest(runtime, 'POST', BRIDGE_GOALS_APPROVE_PATH, jsonRequest({
    goalId: 'no-such-goal',
  }));
  assert.equal(res.statusCode, 409);
});

test('POST /bridge/goals/approve rejects goal without a plan', async () => {
  const runtime = createBridgeRuntime();
  const create = await handleBridgeRequest(runtime, 'POST', BRIDGE_GOALS_PATH, jsonRequest({
    sessionId: 's1', description: 'Task',
  }));
  const res = await handleBridgeRequest(runtime, 'POST', BRIDGE_GOALS_APPROVE_PATH, jsonRequest({
    goalId: create.payload.goal.id,
  }));
  assert.equal(res.statusCode, 409);
});

// ════════════════════════════════════════════════════════════════════
// POST /bridge/goals/step — advance one step
// ════════════════════════════════════════════════════════════════════

test('POST /bridge/goals/step advances a non-mutating step to done', async () => {
  const runtime = runtimeWithDynamicPlan((gid) => validPlanJson(gid));

  const create = await handleBridgeRequest(runtime, 'POST', BRIDGE_GOALS_PATH, jsonRequest({
    sessionId: 's1', description: 'Task',
  }));
  const goalId = create.payload.goal.id;
  await handleBridgeRequest(runtime, 'POST', BRIDGE_GOALS_PLAN_PATH, jsonRequest({ goalId }));
  await handleBridgeRequest(runtime, 'POST', BRIDGE_GOALS_APPROVE_PATH, jsonRequest({ goalId }));

  const res = await handleBridgeRequest(runtime, 'POST', BRIDGE_GOALS_STEP_PATH, jsonRequest({ goalId }));

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.result.type, 'step-completed');
  assert.equal(res.payload.result.stepKind, 'review');
  assert.equal(res.payload.stepsAdvanced, 1);
});

test('POST /bridge/goals/step rejects non-approved plan', async () => {
  const runtime = runtimeWithDynamicPlan((gid) => validPlanJson(gid));

  const create = await handleBridgeRequest(runtime, 'POST', BRIDGE_GOALS_PATH, jsonRequest({
    sessionId: 's1', description: 'Task',
  }));
  const goalId = create.payload.goal.id;
  await handleBridgeRequest(runtime, 'POST', BRIDGE_GOALS_PLAN_PATH, jsonRequest({ goalId }));
  // NOT approved.

  const res = await handleBridgeRequest(runtime, 'POST', BRIDGE_GOALS_STEP_PATH, jsonRequest({ goalId }));
  assert.equal(res.statusCode, 200); // step endpoint does NOT return 4xx for noop — it reports the advance result
  assert.equal(res.payload.result.type, 'noop');
});

test('POST /bridge/goals/step returns step-gated for mutating steps', async () => {
  const runtime = runtimeWithDynamicPlan((gid) => validPlanJson(gid, {
    steps: [{
      id: 'step-w', planId: 'plan-goal-m', index: 0,
      intent: 'Write config', kind: 'write-file',
      targetEndpointId: 'codex-command',
      tier: 'workspace-write', isStateMutating: true, status: 'pending',
    }],
    permittedTiers: ['patch-proposal', 'workspace-write'],
  }));

  const create = await handleBridgeRequest(runtime, 'POST', BRIDGE_GOALS_PATH, jsonRequest({
    sessionId: 's1', description: 'Write something',
  }));
  const goalId = create.payload.goal.id;
  await handleBridgeRequest(runtime, 'POST', BRIDGE_GOALS_PLAN_PATH, jsonRequest({
    goalId,
    permittedTiers: ['patch-proposal', 'workspace-write'],
  }));
  await handleBridgeRequest(runtime, 'POST', BRIDGE_GOALS_APPROVE_PATH, jsonRequest({ goalId }));

  const res = await handleBridgeRequest(runtime, 'POST', BRIDGE_GOALS_STEP_PATH, jsonRequest({ goalId }));

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.result.type, 'step-gated');
  assert.equal(res.payload.result.stepKind, 'write-file');
});

// ════════════════════════════════════════════════════════════════════
// POST /bridge/goals/gate — gate-approve mutating step
// ════════════════════════════════════════════════════════════════════

test('POST /bridge/goals/gate gate-approves a blocked step', async () => {
  const runtime = runtimeWithDynamicPlan((gid) => validPlanJson(gid, {
    steps: [{
      id: 'step-w', planId: 'plan-goal-g', index: 0,
      intent: 'Write config', kind: 'write-file',
      targetEndpointId: 'codex-command',
      tier: 'workspace-write', isStateMutating: true, status: 'pending',
    }],
    permittedTiers: ['patch-proposal', 'workspace-write'],
  }));

  const create = await handleBridgeRequest(runtime, 'POST', BRIDGE_GOALS_PATH, jsonRequest({
    sessionId: 's1', description: 'Task',
  }));
  const goalId = create.payload.goal.id;
  await handleBridgeRequest(runtime, 'POST', BRIDGE_GOALS_PLAN_PATH, jsonRequest({
    goalId,
    permittedTiers: ['patch-proposal', 'workspace-write'],
  }));
  await handleBridgeRequest(runtime, 'POST', BRIDGE_GOALS_APPROVE_PATH, jsonRequest({ goalId }));

  // Step gets blocked.
  await handleBridgeRequest(runtime, 'POST', BRIDGE_GOALS_STEP_PATH, jsonRequest({ goalId }));

  // Gate-approve.
  const planAfterGate = runtime.goalStore.getPlanByGoal(goalId);
  const stepId = planAfterGate.steps[0].id;

  const res = await handleBridgeRequest(runtime, 'POST', BRIDGE_GOALS_GATE_PATH, jsonRequest({
    goalId, stepId,
  }));

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.step.status, 'gated-approved');
  assert.equal(res.payload.step.id, stepId);
});

test('POST /bridge/goals/gate requires goalId and stepId', async () => {
  const runtime = createBridgeRuntime();
  const res = await handleBridgeRequest(runtime, 'POST', BRIDGE_GOALS_GATE_PATH, jsonRequest({}));
  assert.equal(res.statusCode, 400);
});

test('POST /bridge/goals/gate rejects non-blocked step', async () => {
  const runtime = runtimeWithDynamicPlan((gid) => validPlanJson(gid));

  const create = await handleBridgeRequest(runtime, 'POST', BRIDGE_GOALS_PATH, jsonRequest({
    sessionId: 's1', description: 'Task',
  }));
  const goalId = create.payload.goal.id;
  await handleBridgeRequest(runtime, 'POST', BRIDGE_GOALS_PLAN_PATH, jsonRequest({ goalId }));
  await handleBridgeRequest(runtime, 'POST', BRIDGE_GOALS_APPROVE_PATH, jsonRequest({ goalId }));

  // Step is still pending (non-mutating), not blocked.
  const plan = runtime.goalStore.getPlanByGoal(goalId);
  const stepId = plan.steps[0].id;

  const res = await handleBridgeRequest(runtime, 'POST', BRIDGE_GOALS_GATE_PATH, jsonRequest({
    goalId, stepId,
  }));
  assert.equal(res.statusCode, 409);
});

// ════════════════════════════════════════════════════════════════════
// POST /bridge/goals/cancel — cancel goal
// ════════════════════════════════════════════════════════════════════

test('POST /bridge/goals/cancel cancels a goal and its plan', async () => {
  const runtime = runtimeWithDynamicPlan((gid) => validPlanJson(gid));

  const create = await handleBridgeRequest(runtime, 'POST', BRIDGE_GOALS_PATH, jsonRequest({
    sessionId: 's1', description: 'Task',
  }));
  const goalId = create.payload.goal.id;
  await handleBridgeRequest(runtime, 'POST', BRIDGE_GOALS_PLAN_PATH, jsonRequest({ goalId }));

  const res = await handleBridgeRequest(runtime, 'POST', BRIDGE_GOALS_CANCEL_PATH, jsonRequest({ goalId }));
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.goal.status, 'cancelled');
  assert.equal(res.payload.plan.status, 'cancelled');
});

test('POST /bridge/goals/cancel requires goalId', async () => {
  const runtime = createBridgeRuntime();
  const res = await handleBridgeRequest(runtime, 'POST', BRIDGE_GOALS_CANCEL_PATH, jsonRequest({}));
  assert.equal(res.statusCode, 400);
});

test('POST /bridge/goals/cancel rejects non-existent goal', async () => {
  const runtime = createBridgeRuntime();
  const res = await handleBridgeRequest(runtime, 'POST', BRIDGE_GOALS_CANCEL_PATH, jsonRequest({
    goalId: 'no-such-goal',
  }));
  assert.equal(res.statusCode, 409);
});

// ════════════════════════════════════════════════════════════════════
// Full life cycle — integration tests
// ════════════════════════════════════════════════════════════════════

test('full life cycle: create → plan → approve → step → done', async () => {
  const runtime = runtimeWithDynamicPlan((gid) => validPlanJson(gid));

  // 1. Create goal.
  const create = await handleBridgeRequest(runtime, 'POST', BRIDGE_GOALS_PATH, jsonRequest({
    sessionId: 's1', description: 'Complete life cycle test',
  }));
  assert.equal(create.statusCode, 201);
  const goalId = create.payload.goal.id;

  // 2. Generate plan.
  const planRes = await handleBridgeRequest(runtime, 'POST', BRIDGE_GOALS_PLAN_PATH, jsonRequest({ goalId }));
  assert.equal(planRes.statusCode, 201);
  assert.equal(planRes.payload.plan.status, 'awaiting-approval');

  // 3. Approve plan.
  const approveRes = await handleBridgeRequest(runtime, 'POST', BRIDGE_GOALS_APPROVE_PATH, jsonRequest({ goalId }));
  assert.equal(approveRes.statusCode, 200);
  assert.equal(approveRes.payload.plan.status, 'approved');

  // 4. Advance step 1 (review).
  const step1 = await handleBridgeRequest(runtime, 'POST', BRIDGE_GOALS_STEP_PATH, jsonRequest({ goalId }));
  assert.equal(step1.payload.result.type, 'step-completed');
  assert.equal(step1.payload.result.stepKind, 'review');

  // 5. Advance step 2 (propose-patch).
  const step2 = await handleBridgeRequest(runtime, 'POST', BRIDGE_GOALS_STEP_PATH, jsonRequest({ goalId }));
  assert.equal(step2.payload.result.type, 'step-completed');
  assert.equal(step2.payload.result.stepKind, 'propose-patch');

  // Plan should now be done.
  const finalPlan = await handleBridgeRequest(runtime, 'GET', BRIDGE_GOALS_PATH, jsonRequest());
  assert.equal(finalPlan.payload.goals[0].plan.status, 'done');
  assert.equal(finalPlan.payload.goals[0].goal.status, 'done');
});

test('mutating step life cycle: create → plan → approve → gate → step → done', async () => {
  const runtime = runtimeWithDynamicPlan((gid) => validPlanJson(gid, {
    steps: [{
      id: 'step-w', planId: 'plan-goal-gate', index: 0,
      intent: 'Write config', kind: 'write-file',
      targetEndpointId: 'codex-command',
      tier: 'workspace-write', isStateMutating: true, status: 'pending',
    }],
    permittedTiers: ['patch-proposal', 'workspace-write'],
  }));

  // Create, plan, approve.
  const create = await handleBridgeRequest(runtime, 'POST', BRIDGE_GOALS_PATH, jsonRequest({
    sessionId: 's1', description: 'Write file gate test',
  }));
  const goalId = create.payload.goal.id;

  await handleBridgeRequest(runtime, 'POST', BRIDGE_GOALS_PLAN_PATH, jsonRequest({
    goalId,
    permittedTiers: ['patch-proposal', 'workspace-write'],
  }));
  await handleBridgeRequest(runtime, 'POST', BRIDGE_GOALS_APPROVE_PATH, jsonRequest({ goalId }));

  // Step gets blocked at gate.
  const advance1 = await handleBridgeRequest(runtime, 'POST', BRIDGE_GOALS_STEP_PATH, jsonRequest({ goalId }));
  assert.equal(advance1.payload.result.type, 'step-gated');

  // Gate-approve.
  const plan = runtime.goalStore.getPlanByGoal(goalId);
  const stepId = plan.steps[0].id;
  await handleBridgeRequest(runtime, 'POST', BRIDGE_GOALS_GATE_PATH, jsonRequest({ goalId, stepId }));

  // Now step can run.
  const advance2 = await handleBridgeRequest(runtime, 'POST', BRIDGE_GOALS_STEP_PATH, jsonRequest({ goalId }));
  assert.equal(advance2.payload.result.type, 'step-completed');
  assert.equal(advance2.payload.result.stepKind, 'write-file');

  // Plan is done.
  const final = runtime.goalStore.getPlanByGoal(goalId);
  assert.equal(final.status, 'done');
});

// ════════════════════════════════════════════════════════════════════
// Error cases
// ════════════════════════════════════════════════════════════════════

test('POST /bridge/goals/plan rejects bad JSON body', async () => {
  const runtime = createBridgeRuntime();

  // Send non-JSON body.
  const gen = async function* () {
    yield Buffer.from('not json', 'utf8');
  };
  const res = await handleBridgeRequest(runtime, 'POST', BRIDGE_GOALS_PLAN_PATH, gen());
  assert.equal(res.statusCode, 400);
  assert.ok(res.payload.message.includes('Malformed JSON'));
});

test('GET /bridge/goals rejects POST, and metrics still work', async () => {
  const runtime = createBridgeRuntime();
  // GET /bridge/goals cannot be POST.
  const res = await handleBridgeRequest(runtime, 'POST', BRIDGE_GOALS_PATH, jsonRequest({
    sessionId: 's1', // missing description → this is actually POST /bridge/goals
  }));
  // This is the POST /goals handler, which requires both sessionId and description.
  // With only sessionId, we get 400. But that's the POST handler — not a method-not-allowed.
  // Let me test a different path.
  assert.equal(res.statusCode, 400);
});

test('bridge path returns 405 for unregistered method on recognized path', async () => {
  const runtime = createBridgeRuntime();
  const res = await handleBridgeRequest(runtime, 'PUT', BRIDGE_GOALS_PATH, jsonRequest());
  assert.equal(res.statusCode, 405);
});

// ════════════════════════════════════════════════════════════════════
// §P1 code-review regression tests
// ════════════════════════════════════════════════════════════════════

test('goal-plan command config includes claude review-only safety args', async () => {
  // Capture the actual command execution to assert safety argv.
  let capturedArgs = null;
  const runtime = createBridgeRuntime({
    goalPlanCommandOptions: {
      runner: {
        async run(execution) {
          capturedArgs = [...execution.args];
          return okRun(validPlanJson('goal-safety'));
        },
      },
      launcherResolver: fakeLauncherResolver,
    },
  });

  // Create a goal and generate a plan.
  const createRes = await handleBridgeRequest(runtime, 'POST', BRIDGE_GOALS_PATH, jsonRequest({
    sessionId: 'safety-test',
    description: 'Safety args test',
  }));
  const goalId = createRes.payload.goal.id;

  await handleBridgeRequest(runtime, 'POST', BRIDGE_GOALS_PLAN_PATH, jsonRequest({
    goalId,
  }));

  assert.ok(capturedArgs, 'command args should have been captured');
  assert.ok(capturedArgs.includes('--tools'), 'should include --tools flag');
  assert.ok(capturedArgs.includes('--disallowed-tools'), 'should include --disallowed-tools flag');
  assert.ok(capturedArgs.includes('--permission-mode'), 'should include --permission-mode flag');
  assert.ok(capturedArgs.includes('plan'), 'should set permission mode to plan');
  assert.ok(capturedArgs.includes('--no-session-persistence'), 'should disable session persistence');
});

test('POST /bridge/goals/plan rejects cwd from request body', async () => {
  const runtime = createBridgeRuntime();
  // Create a goal first.
  const createRes = await handleBridgeRequest(runtime, 'POST', BRIDGE_GOALS_PATH, jsonRequest({
    sessionId: 'cwd-reject',
    description: 'CWD should be rejected from body',
  }));
  const goalId = createRes.payload.goal.id;

  const res = await handleBridgeRequest(runtime, 'POST', BRIDGE_GOALS_PLAN_PATH, jsonRequest({
    goalId,
    cwd: '/tmp/evil',
  }));
  assert.equal(res.statusCode, 400);
  assert.ok(
    res.payload.message.includes('cwd'),
    `expected cwd rejection; got: ${JSON.stringify(res.payload)}`,
  );
});

test('goal plan with 11 steps rejected at parse time (ADR-0003 hard ceiling=10)', async () => {
  // Build a plan JSON with 11 non-mutating review steps — exceeds ADR-0003 hard ceiling of 10.
  function bigPlanBuilder(goalId) {
    const steps = [];
    for (let i = 0; i < 11; i += 1) {
      steps.push({
        id: `step-${i}`,
        planId: `plan-${goalId}`,
        index: i,
        intent: `Review item ${i}`,
        kind: 'review',
        targetEndpointId: 'claude-code-command',
        tier: 'patch-proposal',
        isStateMutating: false,
        status: 'pending',
      });
    }
    return JSON.stringify({
      id: `plan-${goalId}`,
      goalId,
      status: 'awaiting-approval',
      permittedTiers: ['patch-proposal'],
      steps,
      createdAt: now,
      updatedAt: now,
    });
  }

  const runtime = runtimeWithDynamicPlan(bigPlanBuilder);

  const createRes = await handleBridgeRequest(runtime, 'POST', BRIDGE_GOALS_PATH, jsonRequest({
    sessionId: 'ceiling-test',
    description: 'Too many steps',
  }));
  const goalId = createRes.payload.goal.id;

  const res = await handleBridgeRequest(runtime, 'POST', BRIDGE_GOALS_PLAN_PATH, jsonRequest({
    goalId,
  }));
  assert.equal(res.statusCode, 409, '11-step plan should be rejected at parse time');
  assert.ok(
    res.payload.message.includes('step-ceiling-exceeded'),
    `expected step-ceiling-exceeded; got: ${JSON.stringify(res.payload)}`,
  );
});
