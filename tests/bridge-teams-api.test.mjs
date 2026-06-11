// v2.3 AgentTeam Sequential MVP tests — TeamSpec API + policy + store.
// All endpoints are project-scoped, non-executing, token-gate protected.

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BRIDGE_PROJECTS_PATH,
  BRIDGE_GOALS_PATH,
  createBridgeRuntime,
  handleBridgeRequest,
} from '../apps/local-server/src/routes/bridge-api.ts';
import { detectFileConflicts } from '../packages/shared/src/schemas.ts';

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

async function seedApprovedGoalPlan(runtime, projectId) {
  const goal = runtime.goalStore.createGoal({
    sessionId: 'seed', description: 'Goal for team', projectId,
  });
  // Attach a plan to the goal, then approve.
  const plan = runtime.goalStore.attachPlan({
    goalId: goal.id,
    steps: [
      { intent: 'Plan task', kind: 'review', tier: 'patch-proposal', isStateMutating: false, targetEndpointId: 'claude-code-command' },
      { intent: 'Verify task', kind: 'review', tier: 'patch-proposal', isStateMutating: false, targetEndpointId: 'claude-code-command' },
    ],
    permittedTiers: ['patch-proposal'],
  });
  if (!plan) throw new Error('failed to attach plan');
  runtime.goalStore.approvePlan(goal.id);
  return { goalId: goal.id, planId: plan.id };
}

const TEAMS = (key) => BRIDGE_PROJECTS_PATH + '/' + key + '/teams';

// ════════════════════════════════════════════════════════════════════
// TeamSpec create — happy path
// ════════════════════════════════════════════════════════════════════

test('POST /bridge/projects/:key/teams creates a valid TeamSpec', async () => {
  const runtime = createBridgeRuntime();
  runtime.projectStore.upsert({ key: 'alpha' });
  const g = await seedApprovedGoalPlan(runtime, 'alpha', 's1');
  if (!g) { assert.fail('seed failed'); return; }

  const res = await call(runtime, 'POST', TEAMS('alpha'), {
    action: 'create', id: 'team-1', goalId: g.goalId, planId: g.planId,
    logicalSlots: [
      { id: 's0', role: 'planner', stepIndex: 0, tier: 'patch-proposal', isolation: 'patch-only' },
      { id: 's1', role: 'verifier', stepIndex: 1, tier: 'patch-proposal', isolation: 'patch-only' },
    ],
    maxConcurrentBridgeSlots: 1, mode: 'sequential', isolation: 'patch-only',
    provider: 'claude', endpointId: 'claude-code-command',
  });
  assert.equal(res.statusCode, 201);
  assert.equal(res.payload.team.id, 'team-1');
  assert.equal(res.payload.team.status, 'pending-approval');
  assert.equal(res.payload.team.maxConcurrentBridgeSlots, 1);
  assert.equal(res.payload.team.logicalSlots.length, 2);

  // GET
  const getRes = await call(runtime, 'GET', TEAMS('alpha'));
  assert.equal(getRes.statusCode, 200);
  assert.equal(getRes.payload.teams.length, 1);
});

// ════════════════════════════════════════════════════════════════════
// Rejections
// ════════════════════════════════════════════════════════════════════

test('reject maxConcurrentBridgeSlots > 1', async () => {
  const runtime = createBridgeRuntime();
  runtime.projectStore.upsert({ key: 'alpha' });
  const g = await seedApprovedGoalPlan(runtime, 'alpha', 's2');
  if (!g) return;
  const res = await call(runtime, 'POST', TEAMS('alpha'), {
    action: 'create', id: 't-bad', goalId: g.goalId, planId: g.planId,
    logicalSlots: [{ id: 's0', role: 'planner', stepIndex: 0, tier: 'patch-proposal', isolation: 'patch-only' }],
    maxConcurrentBridgeSlots: 2, mode: 'sequential', isolation: 'patch-only',
    provider: 'claude', endpointId: 'claude-code-command',
  });
  assert.equal(res.statusCode, 400);
});

test('reject mode !== sequential', async () => {
  const runtime = createBridgeRuntime();
  runtime.projectStore.upsert({ key: 'alpha' });
  const g = await seedApprovedGoalPlan(runtime, 'alpha', 's3');
  if (!g) return;
  const res = await call(runtime, 'POST', TEAMS('alpha'), {
    action: 'create', id: 't-bad', goalId: g.goalId, planId: g.planId,
    logicalSlots: [{ id: 's0', role: 'planner', stepIndex: 0, tier: 'patch-proposal', isolation: 'patch-only' }],
    maxConcurrentBridgeSlots: 1, mode: 'parallel', isolation: 'patch-only',
    provider: 'claude', endpointId: 'claude-code-command',
  });
  assert.equal(res.statusCode, 400);
});

test('reject isolation !== patch-only', async () => {
  const runtime = createBridgeRuntime();
  runtime.projectStore.upsert({ key: 'alpha' });
  const g = await seedApprovedGoalPlan(runtime, 'alpha', 's4');
  if (!g) return;
  const res = await call(runtime, 'POST', TEAMS('alpha'), {
    action: 'create', id: 't-bad', goalId: g.goalId, planId: g.planId,
    logicalSlots: [{ id: 's0', role: 'planner', stepIndex: 0, tier: 'patch-proposal', isolation: 'worktree' }],
    maxConcurrentBridgeSlots: 1, mode: 'sequential', isolation: 'worktree',
    provider: 'claude', endpointId: 'claude-code-command',
  });
  assert.equal(res.statusCode, 400);
});

test('reject WorkBuddy as executor', async () => {
  const runtime = createBridgeRuntime();
  runtime.projectStore.upsert({ key: 'alpha' });
  const g = await seedApprovedGoalPlan(runtime, 'alpha', 's5');
  if (!g) return;
  const res = await call(runtime, 'POST', TEAMS('alpha'), {
    action: 'create', id: 't-bad', goalId: g.goalId, planId: g.planId,
    logicalSlots: [{ id: 's0', role: 'planner', stepIndex: 0, tier: 'patch-proposal', isolation: 'patch-only' }],
    maxConcurrentBridgeSlots: 1, mode: 'sequential', isolation: 'patch-only',
    provider: 'workbuddy', endpointId: 'workbuddy-connector',
  });
  assert.equal(res.statusCode, 400);
  assert.ok(res.payload.message.includes('WorkBuddy'));
});

test('accept logicalSlots > 1 with maxConcurrentBridgeSlots = 1', async () => {
  const runtime = createBridgeRuntime();
  runtime.projectStore.upsert({ key: 'alpha' });
  const g = await seedApprovedGoalPlan(runtime, 'alpha', 's6');
  if (!g) return;
  const res = await call(runtime, 'POST', TEAMS('alpha'), {
    action: 'create', id: 't-multi', goalId: g.goalId, planId: g.planId,
    logicalSlots: [
      { id: 's0', role: 'planner', stepIndex: 0, tier: 'patch-proposal', isolation: 'patch-only' },
      { id: 's1', role: 'executor', stepIndex: 1, tier: 'patch-proposal', isolation: 'patch-only' },
    ],
    maxConcurrentBridgeSlots: 1, mode: 'sequential', isolation: 'patch-only',
    provider: 'claude', endpointId: 'claude-code-command',
  });
  assert.equal(res.statusCode, 201);
});

test('reject unknown project', async () => {
  const runtime = createBridgeRuntime();
  const res = await call(runtime, 'POST', TEAMS('unknown'), { action: 'create', id: 't' });
  assert.equal(res.statusCode, 404);
});

test('reject archived project create', async () => {
  const runtime = createBridgeRuntime();
  runtime.projectStore.upsert({ key: 'arch-proj' });
  runtime.projectStore.archive('arch-proj');
  const res = await call(runtime, 'POST', TEAMS('arch-proj'), {
    action: 'create', id: 't', goalId: 'g', planId: 'p',
    logicalSlots: [{ id: 's', role: 'planner', stepIndex: 0, tier: 'patch-proposal', isolation: 'patch-only' }],
    maxConcurrentBridgeSlots: 1, mode: 'sequential', isolation: 'patch-only',
    provider: 'claude', endpointId: 'claude-code-command',
  });
  assert.equal(res.statusCode, 409);
});

test('PATCH/DELETE teams returns 405', async () => {
  const runtime = createBridgeRuntime();
  runtime.projectStore.upsert({ key: 'alpha' });
  const res1 = await call(runtime, 'PATCH', TEAMS('alpha'));
  const res2 = await call(runtime, 'DELETE', TEAMS('alpha'));
  assert.equal(res1.statusCode, 405);
  assert.equal(res2.statusCode, 405);
});

test('alpha teams not visible in beta', async () => {
  const runtime = createBridgeRuntime();
  runtime.projectStore.upsert({ key: 'alpha' });
  runtime.projectStore.upsert({ key: 'beta' });
  const ga = await seedApprovedGoalPlan(runtime, 'alpha', 'sa');
  if (!ga) return;
  await call(runtime, 'POST', TEAMS('alpha'), {
    action: 'create', id: 't-a', goalId: ga.goalId, planId: ga.goalId,
    logicalSlots: [{ id: 's0', role: 'planner', stepIndex: 0, tier: 'patch-proposal', isolation: 'patch-only' }],
    maxConcurrentBridgeSlots: 1, mode: 'sequential', isolation: 'patch-only',
    provider: 'claude', endpointId: 'claude-code-command',
  });
  const betaRes = await call(runtime, 'GET', TEAMS('beta'));
  assert.equal(betaRes.statusCode, 200);
  assert.equal(betaRes.payload.teams.length, 0);
});

// ════════════════════════════════════════════════════════════════════
// Store: approve/cancel/slot progression
// ════════════════════════════════════════════════════════════════════

test('approve and cancel team lifecycle', async () => {
  const runtime = createBridgeRuntime();
  runtime.projectStore.upsert({ key: 'alpha' });
  const g = await seedApprovedGoalPlan(runtime, 'alpha', 'sl');
  if (!g) return;

  // Create
  await call(runtime, 'POST', TEAMS('alpha'), {
    action: 'create', id: 't-life', goalId: g.goalId, planId: g.planId,
    logicalSlots: [{ id: 's0', role: 'planner', stepIndex: 0, tier: 'patch-proposal', isolation: 'patch-only' }],
    maxConcurrentBridgeSlots: 1, mode: 'sequential', isolation: 'patch-only',
    provider: 'claude', endpointId: 'claude-code-command',
  });

  // Approve via store
  const approved = runtime.teamStore.approve('t-life');
  assert.ok(approved, 'must approve');
  assert.equal(approved.status, 'approved');

  // Cancel via store
  const cancelled = runtime.teamStore.cancel('t-life');
  assert.ok(cancelled, 'must cancel');
  assert.equal(cancelled.status, 'cancelled');
});

test('slot progression: sequential order', async () => {
  const runtime = createBridgeRuntime();
  runtime.projectStore.upsert({ key: 'alpha' });
  const g = await seedApprovedGoalPlan(runtime, 'alpha', 'sq');
  if (!g) return;

  await call(runtime, 'POST', TEAMS('alpha'), {
    action: 'create', id: 't-seq', goalId: g.goalId, planId: g.planId,
    logicalSlots: [
      { id: 's0', role: 'planner', stepIndex: 0, tier: 'patch-proposal', isolation: 'patch-only' },
      { id: 's1', role: 'verifier', stepIndex: 1, tier: 'patch-proposal', isolation: 'patch-only' },
    ],
    maxConcurrentBridgeSlots: 1, mode: 'sequential', isolation: 'patch-only',
    provider: 'claude', endpointId: 'claude-code-command',
  });

  runtime.teamStore.approve('t-seq');
  runtime.teamStore.setExecuting('t-seq');

  // Advance slot 0 to done
  let team = runtime.teamStore.advanceSlot('t-seq', 's0', 'done');
  assert.ok(team);
  assert.equal(team.logicalSlots[0].status, 'done');
  assert.equal(team.currentSlotIndex, 1); // moved forward

  // Advance slot 1 to done
  let team2 = runtime.teamStore.advanceSlot('t-seq', 's1', 'done');
  assert.ok(team2);
  assert.equal(team2.status, 'done'); // all slots done
});

test('failed slot stops team', async () => {
  const runtime = createBridgeRuntime();
  runtime.projectStore.upsert({ key: 'alpha' });
  const g = await seedApprovedGoalPlan(runtime, 'alpha', 'sf');
  if (!g) return;

  await call(runtime, 'POST', TEAMS('alpha'), {
    action: 'create', id: 't-fail', goalId: g.goalId, planId: g.planId,
    logicalSlots: [
      { id: 's0', role: 'planner', stepIndex: 0, tier: 'patch-proposal', isolation: 'patch-only' },
      { id: 's1', role: 'verifier', stepIndex: 1, tier: 'patch-proposal', isolation: 'patch-only' },
    ],
    maxConcurrentBridgeSlots: 1, mode: 'sequential', isolation: 'patch-only',
    provider: 'claude', endpointId: 'claude-code-command',
  });

  runtime.teamStore.approve('t-fail');
  runtime.teamStore.setExecuting('t-fail');
  let team = runtime.teamStore.advanceSlot('t-fail', 's0', 'failed');
  assert.ok(team);
  assert.equal(team.status, 'failed');
});

// ════════════════════════════════════════════════════════════════════
// Conflict detection
// ════════════════════════════════════════════════════════════════════

test('detectFileConflicts: same file conflict', () => {
  const result = detectFileConflicts([
    { slotId: 'a', proposedFiles: ['src/app.ts'] },
    { slotId: 'b', proposedFiles: ['src/app.ts'] },
  ]);
  assert.equal(result.clean, false);
  assert.equal(result.conflicts.length, 1);
});

test('detectFileConflicts: directory prefix conflict', () => {
  const result = detectFileConflicts([
    { slotId: 'a', proposedFiles: ['/src/components'] },
    { slotId: 'b', proposedFiles: ['/src/components/app.ts'] },
  ]);
  assert.equal(result.clean, false);
});

test('detectFileConflicts: no overlap clean', () => {
  const result = detectFileConflicts([
    { slotId: 'a', proposedFiles: ['src/api.ts'] },
    { slotId: 'b', proposedFiles: ['tests/api.test.ts'] },
  ]);
  assert.equal(result.clean, true);
});

test('detectFileConflicts: non-adjacent overlap', () => {
  const result = detectFileConflicts([
    { slotId: 'a', proposedFiles: ['src/shared.ts'] },
    { slotId: 'b', proposedFiles: ['tests/main.ts'] },
    { slotId: 'c', proposedFiles: ['src/shared.ts'] },
  ]);
  assert.equal(result.clean, false);
  assert.equal(result.conflicts[0].slotA, 'a');
  assert.equal(result.conflicts[0].slotB, 'c');
});

test('Slot artifact recording', async () => {
  const runtime = createBridgeRuntime();
  runtime.projectStore.upsert({ key: 'alpha' });
  const g = await seedApprovedGoalPlan(runtime, 'alpha', 'sa-art');
  if (!g) return;
  await call(runtime, 'POST', TEAMS('alpha'), {
    action: 'create', id: 't-art', goalId: g.goalId, planId: g.planId,
    logicalSlots: [{ id: 's0', role: 'planner', stepIndex: 0, tier: 'patch-proposal', isolation: 'patch-only' }],
    maxConcurrentBridgeSlots: 1, mode: 'sequential', isolation: 'patch-only',
    provider: 'claude', endpointId: 'claude-code-command',
  });
  runtime.teamStore.recordArtifact('t-art', {
    teamId: 't-art', slotId: 's0', planStepId: 's0',
    summary: 'Patched auth', proposedFiles: ['src/auth.ts'],
    outputRedacted: true, createdAt: 100,
  });
  const artifacts = runtime.teamStore.listArtifacts('t-art');
  assert.equal(artifacts.length, 1);
  assert.equal(artifacts[0].summary, 'Patched auth');
});

// ════════════════════════════════════════════════════════════════════
// planId mismatch + stepIndex range
// ════════════════════════════════════════════════════════════════════

test('reject planId that does not match approved plan', async () => {
  const runtime = createBridgeRuntime();
  runtime.projectStore.upsert({ key: 'alpha' });
  const g = await seedApprovedGoalPlan(runtime, 'alpha');
  if (!g) { assert.fail('seed failed'); return; }
  const res = await call(runtime, 'POST', TEAMS('alpha'), {
    action: 'create', id: 't-planid', goalId: g.goalId, planId: 'wrong-plan-id',
    logicalSlots: [{ id: 's0', role: 'planner', stepIndex: 0, tier: 'patch-proposal', isolation: 'patch-only' }],
    maxConcurrentBridgeSlots: 1, mode: 'sequential', isolation: 'patch-only',
    provider: 'claude', endpointId: 'claude-code-command',
  });
  assert.equal(res.statusCode, 400);
  assert.ok(res.payload.message.includes('planId'));
});

test('reject stepIndex out of plan steps range', async () => {
  const runtime = createBridgeRuntime();
  runtime.projectStore.upsert({ key: 'alpha' });
  const g = await seedApprovedGoalPlan(runtime, 'alpha');
  if (!g) { assert.fail('seed failed'); return; }
  const res = await call(runtime, 'POST', TEAMS('alpha'), {
    action: 'create', id: 't-stepout', goalId: g.goalId, planId: g.planId,
    logicalSlots: [{ id: 's0', role: 'planner', stepIndex: 99, tier: 'patch-proposal', isolation: 'patch-only' }],
    maxConcurrentBridgeSlots: 1, mode: 'sequential', isolation: 'patch-only',
    provider: 'claude', endpointId: 'claude-code-command',
  });
  assert.equal(res.statusCode, 400);
  assert.ok(res.payload.message.includes('stepIndex'));
});

// ════════════════════════════════════════════════════════════════════
// HTTP approve / cancel endpoints
// ════════════════════════════════════════════════════════════════════

test('POST /teams/:teamId/approve approves a pending team', async () => {
  const runtime = createBridgeRuntime();
  runtime.projectStore.upsert({ key: 'alpha' });
  const g = await seedApprovedGoalPlan(runtime, 'alpha');
  if (!g) { assert.fail('seed failed'); return; }
  // Create team
  await call(runtime, 'POST', TEAMS('alpha'), {
    action: 'create', id: 't-approve', goalId: g.goalId, planId: g.planId,
    logicalSlots: [{ id: 's0', role: 'planner', stepIndex: 0, tier: 'patch-proposal', isolation: 'patch-only' }],
    maxConcurrentBridgeSlots: 1, mode: 'sequential', isolation: 'patch-only',
    provider: 'claude', endpointId: 'claude-code-command',
  });
  // Approve
  const res = await call(runtime, 'POST', TEAMS('alpha') + '/t-approve/approve');
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.team.status, 'approved');
});

test('POST /teams/:teamId/cancel cancels a pending team', async () => {
  const runtime = createBridgeRuntime();
  runtime.projectStore.upsert({ key: 'alpha' });
  const g = await seedApprovedGoalPlan(runtime, 'alpha');
  if (!g) { assert.fail('seed failed'); return; }
  await call(runtime, 'POST', TEAMS('alpha'), {
    action: 'create', id: 't-cancel', goalId: g.goalId, planId: g.planId,
    logicalSlots: [{ id: 's0', role: 'planner', stepIndex: 0, tier: 'patch-proposal', isolation: 'patch-only' }],
    maxConcurrentBridgeSlots: 1, mode: 'sequential', isolation: 'patch-only',
    provider: 'claude', endpointId: 'claude-code-command',
  });
  const res = await call(runtime, 'POST', TEAMS('alpha') + '/t-cancel/cancel');
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.team.status, 'cancelled');
});

test('approve non-existent team returns 404', async () => {
  const runtime = createBridgeRuntime();
  runtime.projectStore.upsert({ key: 'alpha' });
  const res = await call(runtime, 'POST', TEAMS('alpha') + '/no-such/approve');
  assert.equal(res.statusCode, 404);
});

test('approve archived project team returns 409', async () => {
  const runtime = createBridgeRuntime();
  runtime.projectStore.upsert({ key: 'arch-team' });
  const g = await seedApprovedGoalPlan(runtime, 'arch-team');
  if (!g) { assert.fail('seed failed'); return; }
  await call(runtime, 'POST', TEAMS('arch-team'), {
    action: 'create', id: 't-arch', goalId: g.goalId, planId: g.planId,
    logicalSlots: [{ id: 's0', role: 'planner', stepIndex: 0, tier: 'patch-proposal', isolation: 'patch-only' }],
    maxConcurrentBridgeSlots: 1, mode: 'sequential', isolation: 'patch-only',
    provider: 'claude', endpointId: 'claude-code-command',
  });
  runtime.projectStore.archive('arch-team');
  const res = await call(runtime, 'POST', TEAMS('arch-team') + '/t-arch/approve');
  assert.equal(res.statusCode, 409);
});

// ════════════════════════════════════════════════════════════════════
// Cross-project isolation: approve/cancel must check team.projectId
// ════════════════════════════════════════════════════════════════════

test('alpha path cannot approve beta team', async () => {
  const runtime = createBridgeRuntime();
  runtime.projectStore.upsert({ key: 'alpha' });
  runtime.projectStore.upsert({ key: 'beta' });
  const gb = await seedApprovedGoalPlan(runtime, 'beta');
  if (!gb) { assert.fail('seed failed'); return; }

  // Create team in beta project
  await call(runtime, 'POST', TEAMS('beta'), {
    action: 'create', id: 'team-beta', goalId: gb.goalId, planId: gb.planId,
    logicalSlots: [{ id: 's0', role: 'planner', stepIndex: 0, tier: 'patch-proposal', isolation: 'patch-only' }],
    maxConcurrentBridgeSlots: 1, mode: 'sequential', isolation: 'patch-only',
    provider: 'claude', endpointId: 'claude-code-command',
  });

  // Try to approve beta's team via alpha project path
  const res = await call(runtime, 'POST', TEAMS('alpha') + '/team-beta/approve');
  assert.equal(res.statusCode, 404);
  // Verify beta team was NOT approved
  assert.equal(runtime.teamStore.get('team-beta').status, 'pending-approval');
});

test('alpha path cannot cancel beta team', async () => {
  const runtime = createBridgeRuntime();
  runtime.projectStore.upsert({ key: 'alpha' });
  runtime.projectStore.upsert({ key: 'beta' });
  const gb = await seedApprovedGoalPlan(runtime, 'beta');
  if (!gb) { assert.fail('seed failed'); return; }

  await call(runtime, 'POST', TEAMS('beta'), {
    action: 'create', id: 'team-beta2', goalId: gb.goalId, planId: gb.planId,
    logicalSlots: [{ id: 's0', role: 'planner', stepIndex: 0, tier: 'patch-proposal', isolation: 'patch-only' }],
    maxConcurrentBridgeSlots: 1, mode: 'sequential', isolation: 'patch-only',
    provider: 'claude', endpointId: 'claude-code-command',
  });

  const res = await call(runtime, 'POST', TEAMS('alpha') + '/team-beta2/cancel');
  assert.equal(res.statusCode, 404);
  assert.equal(runtime.teamStore.get('team-beta2').status, 'pending-approval');
});

// ════════════════════════════════════════════════════════════════════
// Goal project isolation on create
// ════════════════════════════════════════════════════════════════════

test('reject goal from different project on team create', async () => {
  const runtime = createBridgeRuntime();
  runtime.projectStore.upsert({ key: 'alpha' });
  runtime.projectStore.upsert({ key: 'beta' });
  // Create goal + plan in beta project
  const gb = await seedApprovedGoalPlan(runtime, 'beta');
  if (!gb) { assert.fail('seed failed'); return; }

  // Try to use beta goal/plan to create team in alpha
  const res = await call(runtime, 'POST', TEAMS('alpha'), {
    action: 'create', id: 't-cross-goal', goalId: gb.goalId, planId: gb.planId,
    logicalSlots: [{ id: 's0', role: 'planner', stepIndex: 0, tier: 'patch-proposal', isolation: 'patch-only' }],
    maxConcurrentBridgeSlots: 1, mode: 'sequential', isolation: 'patch-only',
    provider: 'claude', endpointId: 'claude-code-command',
  });
  assert.equal(res.statusCode, 400);
  assert.ok(res.payload.message.includes('project'));
});

// ════════════════════════════════════════════════════════════════════
// Duplicate team ID rejection
// ════════════════════════════════════════════════════════════════════

test('reject duplicate team id on create', async () => {
  const runtime = createBridgeRuntime();
  runtime.projectStore.upsert({ key: 'alpha' });
  const g = await seedApprovedGoalPlan(runtime, 'alpha');
  if (!g) { assert.fail('seed failed'); return; }

  await call(runtime, 'POST', TEAMS('alpha'), {
    action: 'create', id: 'team-dup', goalId: g.goalId, planId: g.planId,
    logicalSlots: [{ id: 's0', role: 'planner', stepIndex: 0, tier: 'patch-proposal', isolation: 'patch-only' }],
    maxConcurrentBridgeSlots: 1, mode: 'sequential', isolation: 'patch-only',
    provider: 'claude', endpointId: 'claude-code-command',
  });

  const res = await call(runtime, 'POST', TEAMS('alpha'), {
    action: 'create', id: 'team-dup', goalId: g.goalId, planId: g.planId,
    logicalSlots: [{ id: 's0', role: 'planner', stepIndex: 0, tier: 'patch-proposal', isolation: 'patch-only' }],
    maxConcurrentBridgeSlots: 1, mode: 'sequential', isolation: 'patch-only',
    provider: 'claude', endpointId: 'claude-code-command',
  });
  assert.equal(res.statusCode, 409);
});

test('duplicate team id across projects does not overwrite', async () => {
  const runtime = createBridgeRuntime();
  runtime.projectStore.upsert({ key: 'alpha' });
  runtime.projectStore.upsert({ key: 'beta' });
  const ga = await seedApprovedGoalPlan(runtime, 'alpha');
  const gb = await seedApprovedGoalPlan(runtime, 'beta');
  if (!ga || !gb) { assert.fail('seed failed'); return; }

  // Create in alpha
  await call(runtime, 'POST', TEAMS('alpha'), {
    action: 'create', id: 'team-same', goalId: ga.goalId, planId: ga.planId,
    logicalSlots: [{ id: 's0', role: 'planner', stepIndex: 0, tier: 'patch-proposal', isolation: 'patch-only' }],
    maxConcurrentBridgeSlots: 1, mode: 'sequential', isolation: 'patch-only',
    provider: 'claude', endpointId: 'claude-code-command',
  });

  // Try same id in beta — should be 409, not overwrite alpha
  const res = await call(runtime, 'POST', TEAMS('beta'), {
    action: 'create', id: 'team-same', goalId: gb.goalId, planId: gb.planId,
    logicalSlots: [{ id: 's0', role: 'planner', stepIndex: 0, tier: 'patch-proposal', isolation: 'patch-only' }],
    maxConcurrentBridgeSlots: 1, mode: 'sequential', isolation: 'patch-only',
    provider: 'claude', endpointId: 'claude-code-command',
  });
  assert.equal(res.statusCode, 409);

  // Alpha team should still be in alpha's listing
  assert.equal(runtime.teamStore.listByProject('alpha').length, 1);
  assert.equal(runtime.teamStore.listByProject('alpha')[0].provider, 'claude');
});
// Provider capability tests
test('reject unknown provider', async () => {
  const runtime = createBridgeRuntime();
  runtime.projectStore.upsert({ key: 'alpha' });
  const g = await seedApprovedGoalPlan(runtime, 'alpha');
  if (!g) return;
  const res = await call(runtime, 'POST', TEAMS('alpha'), {
    action: 'create', id: 't-unk', goalId: g.goalId, planId: g.planId,
    logicalSlots: [{ id: 's0', role: 'planner', stepIndex: 0, tier: 'patch-proposal', isolation: 'patch-only' }],
    maxConcurrentBridgeSlots: 1, mode: 'sequential', isolation: 'patch-only',
    provider: 'no-such', endpointId: 'fake',
  });
  assert.equal(res.statusCode, 400);
  assert.ok(res.payload.message.includes('Unknown provider'));
});
test('reject WorkBuddy as executor via capability', async () => {
  const runtime = createBridgeRuntime();
  runtime.projectStore.upsert({ key: 'alpha' });
  const g = await seedApprovedGoalPlan(runtime, 'alpha');
  if (!g) return;
  const res = await call(runtime, 'POST', TEAMS('alpha'), {
    action: 'create', id: 't-wb', goalId: g.goalId, planId: g.planId,
    logicalSlots: [{ id: 's0', role: 'planner', stepIndex: 0, tier: 'patch-proposal', isolation: 'patch-only' }],
    maxConcurrentBridgeSlots: 1, mode: 'sequential', isolation: 'patch-only',
    provider: 'workbuddy', endpointId: 'workbuddy',
  });
  assert.equal(res.statusCode, 400);
  assert.ok(res.payload.message.includes('execute') || res.payload.message.includes('WorkBuddy') || res.payload.message.includes('cannot'));
});
test('reject unsupported isolation via capability', async () => {
  const runtime = createBridgeRuntime();
  runtime.projectStore.upsert({ key: 'alpha' });
  const g = await seedApprovedGoalPlan(runtime, 'alpha');
  if (!g) return;
  const res = await call(runtime, 'POST', TEAMS('alpha'), {
    action: 'create', id: 't-iso2', goalId: g.goalId, planId: g.planId,
    logicalSlots: [{ id: 's0', role: 'planner', stepIndex: 0, tier: 'patch-proposal', isolation: 'patch-only' }],
    maxConcurrentBridgeSlots: 1, mode: 'sequential', isolation: 'worktree',
    provider: 'claude', endpointId: 'claude-code-command',
  });
  assert.equal(res.statusCode, 400);
});
test('reject unsupported mode via capability', async () => {
  const runtime = createBridgeRuntime();
  runtime.projectStore.upsert({ key: 'alpha' });
  const g = await seedApprovedGoalPlan(runtime, 'alpha');
  if (!g) return;
  const res = await call(runtime, 'POST', TEAMS('alpha'), {
    action: 'create', id: 't-mod2', goalId: g.goalId, planId: g.planId,
    logicalSlots: [{ id: 's0', role: 'planner', stepIndex: 0, tier: 'patch-proposal', isolation: 'patch-only' }],
    maxConcurrentBridgeSlots: 1, mode: 'invalid-mode', isolation: 'patch-only',
    provider: 'claude', endpointId: 'claude-code-command',
  });
  assert.equal(res.statusCode, 400);
});
test('team create writes audit with teamId', async () => {
  const runtime = createBridgeRuntime();
  runtime.projectStore.upsert({ key: 'alpha' });
  const g = await seedApprovedGoalPlan(runtime, 'alpha');
  if (!g) return;
  await call(runtime, 'POST', TEAMS('alpha'), {
    action: 'create', id: 't-aud', goalId: g.goalId, planId: g.planId,
    logicalSlots: [{ id: 's0', role: 'planner', stepIndex: 0, tier: 'patch-proposal', isolation: 'patch-only' }],
    maxConcurrentBridgeSlots: 1, mode: 'sequential', isolation: 'patch-only',
    provider: 'claude', endpointId: 'claude-code-command',
  });
  const events = runtime.auditLog.exportEvents();
  const teamEvent = events.find(e => e.teamId === 't-aud');
  assert.ok(teamEvent, 'should find audit event with teamId');
  assert.equal(teamEvent.type, 'team_created');
});
test('recordArtifact rejects unredacted raw output', () => {
  const runtime = createBridgeRuntime();
  runtime.projectStore.upsert({ key: 'alpha' });
  const result = runtime.teamStore.recordArtifact('tx', {
    teamId: 'tx', slotId: 's0', planStepId: 'p0',
    summary: 'Done', proposedFiles: ['src/x.ts'],
    rawProviderOutput: 'secret', outputRedacted: false, createdAt: 1,
  });
  assert.equal(result, null);
});
test('recordArtifact accepts redacted output', () => {
  const runtime = createBridgeRuntime();
  runtime.projectStore.upsert({ key: 'alpha' });
  const result = runtime.teamStore.recordArtifact('tr', {
    teamId: 'tr', slotId: 's0', planStepId: 'p0',
    summary: 'Done', proposedFiles: ['src/x.ts'],
    rawProviderOutput: '[redacted]', outputRedacted: true, createdAt: 1,
  });
  assert.ok(result);
  assert.equal(result.summary, 'Done');
});
