// v2.0 §7.5 Goal-driven console view tests.
//
// Two layers:
//   1. View: the rendered HTML is a self-contained thin view that only talks to
//      /bridge/goals*, has no shell/auto-execute affordance, and surfaces the
//      gate.
//   2. End-to-end: drive the full Goal lifecycle through handleBridgeRequest
//      with a fake plan runner (no real CLI), proving the page's endpoints are
//      wired and the state-mutating gate is enforced.

import assert from 'node:assert/strict';
import test from 'node:test';

import { CONSOLE_GOALS_PATH, renderGoalConsoleHtml } from '../apps/local-server/src/routes/console-goals.ts';
import { PAIRING_TOKEN_HEADER } from '../packages/shared/src/constants.ts';
import { startLocalServer } from '../apps/local-server/src/server.ts';
import {
  BRIDGE_GOALS_PATH,
  BRIDGE_GOALS_PLAN_PATH,
  BRIDGE_GOALS_APPROVE_PATH,
  BRIDGE_GOALS_STEP_PATH,
  BRIDGE_GOALS_GATE_PATH,
  BRIDGE_GOALS_CANCEL_PATH,
  createBridgeRuntime,
  handleBridgeRequest,
} from '../apps/local-server/src/routes/bridge-api.ts';

function closer(handle) {
  return async () => {
    await new Promise((resolve, reject) => {
      handle.server.close((error) => (error ? reject(error) : resolve(undefined)));
    });
  };
}

function jsonRequest(body) {
  const text = body === undefined ? '' : JSON.stringify(body);
  async function* gen() {
    if (text.length > 0) {
      yield Buffer.from(text, 'utf8');
    }
  }
  return gen();
}

// ════════════════════════════════════════════════════════════════════
// §1  View assertions
// ════════════════════════════════════════════════════════════════════

test('goal console HTML is a self-contained view that only talks to /bridge/goals*', () => {
  const html = renderGoalConsoleHtml();
  assert.match(html, /CLI Bridge Goal Console/);
  assert.match(html, /\/bridge\/goals/);
  assert.match(html, /\/bridge\/goals\/plan/);
  assert.match(html, /\/bridge\/goals\/approve/);
  assert.match(html, /\/bridge\/goals\/step/);
  assert.match(html, /\/bridge\/goals\/gate/);
  assert.match(html, /\/bridge\/goals\/cancel/);
  // Links back to the review console.
  assert.match(html, /\/console/);
});

test('goal console HTML has no shell-style endpoint and no auto-execute affordance', () => {
  const html = renderGoalConsoleHtml();
  // No bare shell-style endpoints (the safe paths are /bridge/goals/step etc.).
  assert.equal(/\/(exec|shell|run|command)['"`]/.test(html), false);
  // No silent auto-submit.
  assert.equal(html.includes('requestSubmit'), false);
  // The page must teach the gate boundary explicitly.
  assert.match(html, /gate/i);
  assert.match(html, /must be approved before any step runs/i);
});

test('goal console page is served as HTML at /console/goals without a token', async (t) => {
  const handle = await startLocalServer(0);
  t.after(closer(handle));

  const res = await fetch(`${handle.url}${CONSOLE_GOALS_PATH}`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  const body = await res.text();
  assert.match(body, /CLI Bridge Goal Console/);
});

test('goal console bridge calls require the pairing token', async (t) => {
  const handle = await startLocalServer(0);
  t.after(closer(handle));

  const noToken = await fetch(`${handle.url}/bridge/goals`, { headers: { origin: handle.url } });
  assert.equal(noToken.status, 401);

  const badToken = await fetch(`${handle.url}/bridge/goals`, {
    headers: { origin: handle.url, [PAIRING_TOKEN_HEADER]: 'wrong' },
  });
  assert.equal(badToken.status, 403);

  const okRes = await fetch(`${handle.url}/bridge/goals`, {
    headers: { origin: handle.url, [PAIRING_TOKEN_HEADER]: handle.pairingToken },
  });
  assert.equal(okRes.status, 200);
});

// ════════════════════════════════════════════════════════════════════
// §2  End-to-end lifecycle through the goals endpoints (fake runner)
// ════════════════════════════════════════════════════════════════════

// Holds the goal id so the fake plan runner can return a plan bound to it.
const planContext = { goalId: '' };

function buildPlanJson(goalId) {
  return JSON.stringify({
    id: `plan-${goalId}`,
    goalId,
    status: 'awaiting-approval',
    permittedTiers: ['patch-proposal', 'workspace-write'],
    steps: [
      {
        id: 'step-review', planId: `plan-${goalId}`, index: 0,
        intent: 'Review the change', kind: 'review',
        targetEndpointId: 'claude-code-command', tier: 'patch-proposal',
        isStateMutating: false, status: 'pending',
      },
      {
        id: 'step-apply', planId: `plan-${goalId}`, index: 1,
        intent: 'Apply the patch', kind: 'apply-patch',
        targetEndpointId: 'codex-command', tier: 'workspace-write',
        isStateMutating: true, status: 'pending',
      },
    ],
    createdAt: 1790000000000,
    updatedAt: 1790000000000,
  });
}

function fakeGoalPlanRunner() {
  return {
    async run() {
      return {
        exitCode: 0,
        stdout: buildPlanJson(planContext.goalId),
        stderr: '',
        timedOut: false,
      };
    },
  };
}

function fakeLauncherResolver(command) {
  return { executable: `/fake/${command}`, prependArgs: [] };
}

function makeRuntime() {
  return createBridgeRuntime({
    goalPlanCommandOptions: {
      runner: fakeGoalPlanRunner(),
      launcherResolver: fakeLauncherResolver,
    },
  });
}

async function call(runtime, method, path, body) {
  return handleBridgeRequest(runtime, method, path, jsonRequest(body));
}

test('e2e: create → plan → approve → run non-mutating → gate mutating → run → done', async () => {
  const runtime = makeRuntime();

  // Create goal.
  const createRes = await call(runtime, 'POST', BRIDGE_GOALS_PATH, {
    sessionId: 's1', description: 'Apply a small change',
  });
  assert.equal(createRes.statusCode, 201);
  const goalId = createRes.payload.goal.id;
  planContext.goalId = goalId;

  // Generate plan (workspace-write permitted so the mutating step survives).
  const planRes = await call(runtime, 'POST', BRIDGE_GOALS_PLAN_PATH, {
    goalId, permittedTiers: ['patch-proposal', 'workspace-write'],
  });
  assert.equal(planRes.statusCode, 201);
  assert.equal(planRes.payload.plan.status, 'awaiting-approval');
  assert.equal(planRes.payload.plan.steps.length, 2);

  // A step cannot advance before approval.
  const earlyStep = await call(runtime, 'POST', BRIDGE_GOALS_STEP_PATH, { goalId });
  assert.equal(earlyStep.payload.result.type, 'noop');

  // Approve plan.
  const approveRes = await call(runtime, 'POST', BRIDGE_GOALS_APPROVE_PATH, { goalId });
  assert.equal(approveRes.statusCode, 200);
  assert.equal(approveRes.payload.plan.status, 'approved');

  // Step 1: non-mutating review → completed.
  const step1 = await call(runtime, 'POST', BRIDGE_GOALS_STEP_PATH, { goalId });
  assert.equal(step1.payload.result.type, 'step-completed');
  assert.equal(step1.payload.result.stepIndex, 0);

  // Step 2: mutating apply-patch → blocked at gate, NOT run.
  const step2 = await call(runtime, 'POST', BRIDGE_GOALS_STEP_PATH, { goalId });
  assert.equal(step2.payload.result.type, 'step-gated');
  assert.equal(step2.payload.result.stepIndex, 1);
  const gatedStepId = step2.payload.result.stepId;

  // Approve the gate.
  const gateRes = await call(runtime, 'POST', BRIDGE_GOALS_GATE_PATH, { goalId, stepId: gatedStepId });
  assert.equal(gateRes.statusCode, 200);
  assert.equal(gateRes.payload.step.status, 'gated-approved');

  // Step 3: gated-approved mutating step now runs → completed → plan done.
  const step3 = await call(runtime, 'POST', BRIDGE_GOALS_STEP_PATH, { goalId });
  assert.equal(step3.payload.result.type, 'step-completed');
  assert.equal(step3.payload.result.stepIndex, 1);

  const listRes = await call(runtime, 'GET', BRIDGE_GOALS_PATH);
  const entry = listRes.payload.goals.find((g) => g.goal.id === goalId);
  assert.equal(entry.goal.status, 'done');
  assert.equal(entry.plan.status, 'done');
});

test('e2e: a mutating step never runs without the gate', async () => {
  const runtime = makeRuntime();

  const createRes = await call(runtime, 'POST', BRIDGE_GOALS_PATH, {
    sessionId: 's2', description: 'mutating only',
  });
  const goalId = createRes.payload.goal.id;
  planContext.goalId = goalId;

  await call(runtime, 'POST', BRIDGE_GOALS_PLAN_PATH, {
    goalId, permittedTiers: ['patch-proposal', 'workspace-write'],
  });
  await call(runtime, 'POST', BRIDGE_GOALS_APPROVE_PATH, { goalId });

  // Advance past the non-mutating step.
  await call(runtime, 'POST', BRIDGE_GOALS_STEP_PATH, { goalId });
  // Mutating step is gated, not run.
  const gated = await call(runtime, 'POST', BRIDGE_GOALS_STEP_PATH, { goalId });
  assert.equal(gated.payload.result.type, 'step-gated');

  // Without gate approval, repeated step calls keep it gated — never running.
  const again = await call(runtime, 'POST', BRIDGE_GOALS_STEP_PATH, { goalId });
  assert.equal(again.payload.result.type, 'noop');
  assert.equal(again.payload.result.reason, 'all-runnable-steps-are-gated');

  const listRes = await call(runtime, 'GET', BRIDGE_GOALS_PATH);
  const entry = listRes.payload.goals.find((g) => g.goal.id === goalId);
  const applyStep = entry.plan.steps.find((s) => s.kind === 'apply-patch');
  assert.equal(applyStep.status, 'blocked-needs-gate');
});

test('e2e: cancel stops further advancement', async () => {
  const runtime = makeRuntime();

  const createRes = await call(runtime, 'POST', BRIDGE_GOALS_PATH, {
    sessionId: 's3', description: 'to cancel',
  });
  const goalId = createRes.payload.goal.id;
  planContext.goalId = goalId;

  await call(runtime, 'POST', BRIDGE_GOALS_PLAN_PATH, {
    goalId, permittedTiers: ['patch-proposal', 'workspace-write'],
  });
  await call(runtime, 'POST', BRIDGE_GOALS_APPROVE_PATH, { goalId });

  const cancelRes = await call(runtime, 'POST', BRIDGE_GOALS_CANCEL_PATH, { goalId });
  assert.equal(cancelRes.statusCode, 200);
  assert.equal(cancelRes.payload.goal.status, 'cancelled');

  const step = await call(runtime, 'POST', BRIDGE_GOALS_STEP_PATH, { goalId });
  assert.equal(step.payload.result.type, 'noop');
  assert.equal(step.payload.result.reason, 'goal-cancelled');
});
