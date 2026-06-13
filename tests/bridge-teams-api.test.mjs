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
import { KNOWN_PROVIDER_CAPABILITIES } from '../apps/local-server/src/storage/provider-capability.ts';

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
  const event = runtime.auditLog.exportEvents().find(e => e.teamId === 't-approve' && e.type === 'team_approved');
  assert.ok(event, 'should emit team_approved audit event');
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
  const event = runtime.auditLog.exportEvents().find(e => e.teamId === 't-cancel' && e.type === 'team_cancelled');
  assert.ok(event, 'should emit team_cancelled audit event');
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

// v2.4b Multi-provider AgentTeam — compatibility and provider binding
test('multi-provider: single-provider TeamSpec defaults slot provider and endpoint', async () => {
  const runtime = createBridgeRuntime();
  runtime.projectStore.upsert({ key: 'alpha' });
  const g = await seedApprovedGoalPlan(runtime, 'alpha');
  if (!g) return;
  const res = await call(runtime, 'POST', TEAMS('alpha'), {
    action: 'create', id: 't-provider-default', goalId: g.goalId, planId: g.planId,
    logicalSlots: [{ id: 's0', role: 'planner', stepIndex: 0, tier: 'patch-proposal', isolation: 'patch-only' }],
    maxConcurrentBridgeSlots: 1, mode: 'sequential', isolation: 'patch-only',
    provider: 'claude', endpointId: 'claude-code-command',
  });
  assert.equal(res.statusCode, 201);
  assert.equal(res.payload.team.logicalSlots[0].providerId, 'claude');
  assert.equal(res.payload.team.logicalSlots[0].endpointId, 'claude-code-command');
});

test('multi-provider: per-slot provider binding accepts known providers', async () => {
  const runtime = createBridgeRuntime();
  runtime.projectStore.upsert({ key: 'alpha' });
  const g = await seedApprovedGoalPlan(runtime, 'alpha');
  if (!g) return;
  const res = await call(runtime, 'POST', TEAMS('alpha'), {
    action: 'create', id: 't-multi-provider', goalId: g.goalId, planId: g.planId,
    logicalSlots: [
      { id: 's0', role: 'planner', stepIndex: 0, tier: 'patch-proposal', isolation: 'patch-only', providerId: 'claude', endpointId: 'claude-code-command' },
      { id: 's1', role: 'verifier', stepIndex: 1, tier: 'patch-proposal', isolation: 'patch-only', providerId: 'codex', endpointId: 'codex-command' },
    ],
    maxConcurrentBridgeSlots: 1, mode: 'sequential', isolation: 'patch-only',
    provider: 'claude', endpointId: 'claude-code-command',
  });
  assert.equal(res.statusCode, 201);
  assert.equal(res.payload.team.logicalSlots[0].providerId, 'claude');
  assert.equal(res.payload.team.logicalSlots[1].providerId, 'codex');
  assert.equal(res.payload.team.logicalSlots[1].endpointId, 'codex-command');
});

test('multi-provider: unknown slot provider fails closed', async () => {
  const runtime = createBridgeRuntime();
  runtime.projectStore.upsert({ key: 'alpha' });
  const g = await seedApprovedGoalPlan(runtime, 'alpha');
  if (!g) return;
  const res = await call(runtime, 'POST', TEAMS('alpha'), {
    action: 'create', id: 't-slot-unk', goalId: g.goalId, planId: g.planId,
    logicalSlots: [{ id: 's0', role: 'planner', stepIndex: 0, tier: 'patch-proposal', isolation: 'patch-only', providerId: 'no-such', endpointId: 'fake' }],
    maxConcurrentBridgeSlots: 1, mode: 'sequential', isolation: 'patch-only',
    provider: 'claude', endpointId: 'claude-code-command',
  });
  assert.equal(res.statusCode, 400);
  assert.ok(res.payload.message.includes('logicalSlots[0]'));
  assert.ok(res.payload.message.includes('Unknown provider'));
});

test('multi-provider: provider capability hard invariants remain locked', () => {
  for (const provider of ['claude', 'codex']) {
    const cap = KNOWN_PROVIDER_CAPABILITIES[provider];
    assert.equal(cap.bridgeGovernedParallelSlots, false);
    assert.equal(cap.maxConcurrentBridgeSlots, 1);
    assert.deepEqual(cap.isolationModes, ['patch-only']);
    assert.equal(cap.canExecute, true);
  }
});

test('multi-provider: slot endpoint must match provider capability', async () => {
  const runtime = createBridgeRuntime();
  runtime.projectStore.upsert({ key: 'alpha' });
  const g = await seedApprovedGoalPlan(runtime, 'alpha');
  if (!g) return;
  const res = await call(runtime, 'POST', TEAMS('alpha'), {
    action: 'create', id: 't-slot-endpoint-mismatch', goalId: g.goalId, planId: g.planId,
    logicalSlots: [{ id: 's0', role: 'planner', stepIndex: 0, tier: 'patch-proposal', isolation: 'patch-only', providerId: 'codex', endpointId: 'claude-code-command' }],
    maxConcurrentBridgeSlots: 1, mode: 'sequential', isolation: 'patch-only',
    provider: 'claude', endpointId: 'claude-code-command',
  });
  assert.equal(res.statusCode, 400);
  assert.ok(res.payload.message.includes('endpointId codex-command'));
});

test('multi-provider: cross-provider team still rejects parallel executing slot', async () => {
  const runtime = createBridgeRuntime();
  runtime.projectStore.upsert({ key: 'alpha' });
  const g = await seedApprovedGoalPlan(runtime, 'alpha');
  if (!g) return;
  await call(runtime, 'POST', TEAMS('alpha'), {
    action: 'create', id: 't-cross-parallel', goalId: g.goalId, planId: g.planId,
    logicalSlots: [
      { id: 's0', role: 'planner', stepIndex: 0, tier: 'patch-proposal', isolation: 'patch-only', providerId: 'claude', endpointId: 'claude-code-command' },
      { id: 's1', role: 'verifier', stepIndex: 1, tier: 'patch-proposal', isolation: 'patch-only', providerId: 'codex', endpointId: 'codex-command' },
    ],
    maxConcurrentBridgeSlots: 1, mode: 'sequential', isolation: 'patch-only',
    provider: 'claude', endpointId: 'claude-code-command',
  });
  await call(runtime, 'POST', TEAMS('alpha') + '/t-cross-parallel/approve');
  let res = await call(runtime, 'POST', TEAMS('alpha') + '/t-cross-parallel/slots/s0/advance', { status: 'executing' });
  assert.equal(res.statusCode, 200);
  res = await call(runtime, 'POST', TEAMS('alpha') + '/t-cross-parallel/slots/s1/advance', { status: 'executing' });
  assert.equal(res.statusCode, 409);
  assert.ok(res.payload.message.includes('not the current slot') || res.payload.message.includes('already executing'));
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

// ════════════════════════════════════════════════════════════════════
// Artifact API — POST /teams/:teamId/artifacts
// ════════════════════════════════════════════════════════════════════

test('POST /teams/:teamId/artifacts records a valid artifact', async () => {
  const runtime = createBridgeRuntime();
  runtime.projectStore.upsert({ key: 'alpha' });
  const g = await seedApprovedGoalPlan(runtime, 'alpha');
  if (!g) { assert.fail('seed failed'); return; }

  await call(runtime, 'POST', TEAMS('alpha'), {
    action: 'create', id: 't-art-api', goalId: g.goalId, planId: g.planId,
    logicalSlots: [{ id: 's0', role: 'planner', stepIndex: 0, tier: 'patch-proposal', isolation: 'patch-only' }],
    maxConcurrentBridgeSlots: 1, mode: 'sequential', isolation: 'patch-only',
    provider: 'claude', endpointId: 'claude-code-command',
  });
  await call(runtime, 'POST', TEAMS('alpha') + '/t-art-api/approve');

  // planStepId auto-filled from plan — omit to test auto-fill
  const res = await call(runtime, 'POST', TEAMS('alpha') + '/t-art-api/artifacts', {
    slotId: 's0',
    summary: 'Patched auth module', proposedFiles: ['src/auth.ts'],
    verificationNotes: 'tests pass', outputRedacted: true, createdAt: 200,
  });
  assert.equal(res.statusCode, 201);
  assert.equal(res.payload.artifact.summary, 'Patched auth module');
  assert.equal(res.payload.artifact.proposedFiles.length, 1);
  assert.equal(res.payload.artifact.providerId, 'claude');
  assert.equal(res.payload.artifact.endpointId, 'claude-code-command');
  assert.ok(res.payload.artifact.bridgeRunId);

  // Verify artifact in store
  const artifacts = runtime.teamStore.listArtifacts('t-art-api');
  assert.equal(artifacts.length, 1);
});

test('v2.12: POST /teams/:teamId/artifacts records explicit typed verification evidence', async () => {
  const runtime = createBridgeRuntime();
  runtime.projectStore.upsert({ key: 'alpha' });
  const g = await seedApprovedGoalPlan(runtime, 'alpha');
  if (!g) { assert.fail('seed failed'); return; }

  await call(runtime, 'POST', TEAMS('alpha'), {
    action: 'create', id: 't-art-typed', goalId: g.goalId, planId: g.planId,
    logicalSlots: [{ id: 's0', role: 'verifier', stepIndex: 0, tier: 'patch-proposal', isolation: 'patch-only' }],
    maxConcurrentBridgeSlots: 1, mode: 'sequential', isolation: 'patch-only',
    provider: 'claude', endpointId: 'claude-code-command',
  });
  await call(runtime, 'POST', TEAMS('alpha') + '/t-art-typed/approve');

  const res = await call(runtime, 'POST', TEAMS('alpha') + '/t-art-typed/artifacts', {
    slotId: 's0',
    summary: 'Typed verification recorded',
    proposedFiles: ['src/auth.ts'],
    verificationEvidence: { result: 'failed', commandLabel: 'unit-tests', recordedAt: 201 },
    outputRedacted: true,
    createdAt: 200,
  });

  assert.equal(res.statusCode, 201);
  assert.deepEqual(res.payload.artifact.verificationEvidence, {
    result: 'failed',
    commandLabel: 'unit-tests',
    recordedAt: 201,
  });
  assert.equal(res.payload.artifact.verificationNotes, undefined);
});

test('v2.12: POST /teams/:teamId/artifacts rejects malformed typed verification evidence', async () => {
  const runtime = createBridgeRuntime();
  runtime.projectStore.upsert({ key: 'alpha' });
  const g = await seedApprovedGoalPlan(runtime, 'alpha');
  if (!g) { assert.fail('seed failed'); return; }

  await call(runtime, 'POST', TEAMS('alpha'), {
    action: 'create', id: 't-art-typed-bad', goalId: g.goalId, planId: g.planId,
    logicalSlots: [{ id: 's0', role: 'verifier', stepIndex: 0, tier: 'patch-proposal', isolation: 'patch-only' }],
    maxConcurrentBridgeSlots: 1, mode: 'sequential', isolation: 'patch-only',
    provider: 'claude', endpointId: 'claude-code-command',
  });
  await call(runtime, 'POST', TEAMS('alpha') + '/t-art-typed-bad/approve');

  const res = await call(runtime, 'POST', TEAMS('alpha') + '/t-art-typed-bad/artifacts', {
    slotId: 's0',
    summary: 'Bad typed verification',
    proposedFiles: ['src/auth.ts'],
    verificationEvidence: { result: 'maybe', commandLabel: 'npm test', output: 'raw output' },
    outputRedacted: true,
    createdAt: 200,
  });

  assert.equal(res.statusCode, 400);
  assert.equal(runtime.teamStore.listArtifacts('t-art-typed-bad').length, 0);
});

test('multi-provider: artifact records slot provider and rejects unredacted partial raw output', async () => {
  const runtime = createBridgeRuntime();
  runtime.projectStore.upsert({ key: 'alpha' });
  const g = await seedApprovedGoalPlan(runtime, 'alpha');
  if (!g) return;

  await call(runtime, 'POST', TEAMS('alpha'), {
    action: 'create', id: 't-art-provider', goalId: g.goalId, planId: g.planId,
    logicalSlots: [
      { id: 's0', role: 'planner', stepIndex: 0, tier: 'patch-proposal', isolation: 'patch-only', providerId: 'codex', endpointId: 'codex-command' },
    ],
    maxConcurrentBridgeSlots: 1, mode: 'sequential', isolation: 'patch-only',
    provider: 'claude', endpointId: 'claude-code-command',
  });
  await call(runtime, 'POST', TEAMS('alpha') + '/t-art-provider/approve');

  let res = await call(runtime, 'POST', TEAMS('alpha') + '/t-art-provider/artifacts', {
    slotId: 's0',
    summary: 'Partial provider output', proposedFiles: ['src/a.ts'],
    rawProviderOutput: 'sk-secret raw provider output', outputRedacted: false,
  });
  assert.equal(res.statusCode, 400);
  assert.equal(runtime.teamStore.listArtifacts('t-art-provider').length, 0);

  res = await call(runtime, 'POST', TEAMS('alpha') + '/t-art-provider/artifacts', {
    slotId: 's0',
    summary: 'Redacted provider output', proposedFiles: ['src/a.ts'],
    rawProviderOutput: '[redacted]', outputRedacted: true, bridgeRunId: 'run-codex-1', externalSessionId: 'session-codex-1',
  });
  assert.equal(res.statusCode, 201);
  assert.equal(res.payload.artifact.providerId, 'codex');
  assert.equal(res.payload.artifact.endpointId, 'codex-command');
  assert.equal(res.payload.artifact.bridgeRunId, 'run-codex-1');
  assert.equal(res.payload.artifact.externalSessionId, 'session-codex-1');
});

test('POST /teams/:teamId/artifacts rejects mismatched planStepId', async () => {
  const runtime = createBridgeRuntime();
  runtime.projectStore.upsert({ key: 'alpha' });
  const g = await seedApprovedGoalPlan(runtime, 'alpha');
  if (!g) { assert.fail('seed failed'); return; }

  await call(runtime, 'POST', TEAMS('alpha'), {
    action: 'create', id: 't-planstep-mismatch', goalId: g.goalId, planId: g.planId,
    logicalSlots: [{ id: 's0', role: 'planner', stepIndex: 0, tier: 'patch-proposal', isolation: 'patch-only' }],
    maxConcurrentBridgeSlots: 1, mode: 'sequential', isolation: 'patch-only',
    provider: 'claude', endpointId: 'claude-code-command',
  });
  await call(runtime, 'POST', TEAMS('alpha') + '/t-planstep-mismatch/approve');

  // Supply a fake planStepId not matching the actual plan step.
  const res = await call(runtime, 'POST', TEAMS('alpha') + '/t-planstep-mismatch/artifacts', {
    slotId: 's0', planStepId: 'wrong-id',
    summary: 'Done', proposedFiles: [], outputRedacted: true, createdAt: 1,
  });
  assert.equal(res.statusCode, 400);
  assert.ok(res.payload.message.includes('planStepId'));
});

test('POST /teams/:teamId/artifacts rejects unredacted raw output', async () => {
  const runtime = createBridgeRuntime();
  runtime.projectStore.upsert({ key: 'alpha' });
  const g = await seedApprovedGoalPlan(runtime, 'alpha');
  if (!g) { assert.fail('seed failed'); return; }

  await call(runtime, 'POST', TEAMS('alpha'), {
    action: 'create', id: 't-raw', goalId: g.goalId, planId: g.planId,
    logicalSlots: [{ id: 's0', role: 'planner', stepIndex: 0, tier: 'patch-proposal', isolation: 'patch-only' }],
    maxConcurrentBridgeSlots: 1, mode: 'sequential', isolation: 'patch-only',
    provider: 'claude', endpointId: 'claude-code-command',
  });
  await call(runtime, 'POST', TEAMS('alpha') + '/t-raw/approve');

  // planStepId omitted — auto-fills; but rawProviderOutput without outputRedacted should still fail.
  const res = await call(runtime, 'POST', TEAMS('alpha') + '/t-raw/artifacts', {
    slotId: 's0',
    summary: 'Done', proposedFiles: ['src/x.ts'],
    rawProviderOutput: 'sensitive data', outputRedacted: false, createdAt: 1,
  });
  assert.equal(res.statusCode, 400);
  assert.ok(res.payload.message.includes('redaction'));
});

test('POST /teams/:teamId/artifacts rejects unknown slot', async () => {
  const runtime = createBridgeRuntime();
  runtime.projectStore.upsert({ key: 'alpha' });
  const g = await seedApprovedGoalPlan(runtime, 'alpha');
  if (!g) { assert.fail('seed failed'); return; }

  await call(runtime, 'POST', TEAMS('alpha'), {
    action: 'create', id: 't-bad-slot', goalId: g.goalId, planId: g.planId,
    logicalSlots: [{ id: 's0', role: 'planner', stepIndex: 0, tier: 'patch-proposal', isolation: 'patch-only' }],
    maxConcurrentBridgeSlots: 1, mode: 'sequential', isolation: 'patch-only',
    provider: 'claude', endpointId: 'claude-code-command',
  });

  const res = await call(runtime, 'POST', TEAMS('alpha') + '/t-bad-slot/artifacts', {
    slotId: 'nonexistent', planStepId: 'ps0',
    summary: 'Done', proposedFiles: [], outputRedacted: true, createdAt: 1,
  });
  assert.equal(res.statusCode, 400);
  assert.ok(res.payload.message.includes('slotId'));
});

test('POST /teams/:teamId/artifacts rejects cross-project team', async () => {
  const runtime = createBridgeRuntime();
  runtime.projectStore.upsert({ key: 'alpha' });
  runtime.projectStore.upsert({ key: 'beta' });
  const gb = await seedApprovedGoalPlan(runtime, 'beta');
  if (!gb) { assert.fail('seed failed'); return; }

  await call(runtime, 'POST', TEAMS('beta'), {
    action: 'create', id: 't-beta-art', goalId: gb.goalId, planId: gb.planId,
    logicalSlots: [{ id: 's0', role: 'planner', stepIndex: 0, tier: 'patch-proposal', isolation: 'patch-only' }],
    maxConcurrentBridgeSlots: 1, mode: 'sequential', isolation: 'patch-only',
    provider: 'claude', endpointId: 'claude-code-command',
  });

  // Try to record artifact via alpha project path — should 404
  const res = await call(runtime, 'POST', TEAMS('alpha') + '/t-beta-art/artifacts', {
    slotId: 's0', planStepId: 'ps0',
    summary: 'Done', proposedFiles: [], outputRedacted: true, createdAt: 1,
  });
  assert.equal(res.statusCode, 404);
});

test('POST /teams/:teamId/artifacts writes artifact_recorded audit', async () => {
  const runtime = createBridgeRuntime();
  runtime.projectStore.upsert({ key: 'alpha' });
  const g = await seedApprovedGoalPlan(runtime, 'alpha');
  if (!g) { assert.fail('seed failed'); return; }

  await call(runtime, 'POST', TEAMS('alpha'), {
    action: 'create', id: 't-aud-art', goalId: g.goalId, planId: g.planId,
    logicalSlots: [{ id: 's0', role: 'planner', stepIndex: 0, tier: 'patch-proposal', isolation: 'patch-only' }],
    maxConcurrentBridgeSlots: 1, mode: 'sequential', isolation: 'patch-only',
    provider: 'claude', endpointId: 'claude-code-command',
  });
  await call(runtime, 'POST', TEAMS('alpha') + '/t-aud-art/approve');

  // planStepId auto-filled, sends correct value
  await call(runtime, 'POST', TEAMS('alpha') + '/t-aud-art/artifacts', {
    slotId: 's0',
    summary: 'Done', proposedFiles: ['src/auth.ts'], outputRedacted: true, createdAt: 1,
  });

  const event = runtime.auditLog.exportEvents().find(e => e.teamId === 't-aud-art' && e.type === 'artifact_recorded');
  assert.ok(event, 'should emit artifact_recorded audit event');
  assert.equal(event.slotId, 's0');
  // planStepId is derived from plan — not a fake value
  assert.equal(typeof event.planStepId, 'string');
  assert.ok(event.planStepId.length > 0);
  assert.equal(event.projectId, 'alpha');
});

// ════════════════════════════════════════════════════════════════════
// Conflict report — GET /teams/:teamId/conflicts
// ════════════════════════════════════════════════════════════════════

test('GET /teams/:teamId/conflicts returns clean when no overlap', async () => {
  const runtime = createBridgeRuntime();
  runtime.projectStore.upsert({ key: 'alpha' });
  const g = await seedApprovedGoalPlan(runtime, 'alpha');
  if (!g) { assert.fail('seed failed'); return; }

  await call(runtime, 'POST', TEAMS('alpha'), {
    action: 'create', id: 't-clean-conf', goalId: g.goalId, planId: g.planId,
    logicalSlots: [
      { id: 's0', role: 'planner', stepIndex: 0, tier: 'patch-proposal', isolation: 'patch-only' },
      { id: 's1', role: 'verifier', stepIndex: 1, tier: 'patch-proposal', isolation: 'patch-only' },
    ],
    maxConcurrentBridgeSlots: 1, mode: 'sequential', isolation: 'patch-only',
    provider: 'claude', endpointId: 'claude-code-command',
  });
  await call(runtime, 'POST', TEAMS('alpha') + '/t-clean-conf/approve');

  // Record non-overlapping artifacts via store
  runtime.teamStore.recordArtifact('t-clean-conf', {
    teamId: 't-clean-conf', slotId: 's0', planStepId: 'p0',
    summary: 'a', proposedFiles: ['src/api.ts'], outputRedacted: true, createdAt: 1,
  });
  runtime.teamStore.recordArtifact('t-clean-conf', {
    teamId: 't-clean-conf', slotId: 's1', planStepId: 'p1',
    summary: 'b', proposedFiles: ['tests/api.test.ts'], outputRedacted: true, createdAt: 2,
  });

  const res = await call(runtime, 'GET', TEAMS('alpha') + '/t-clean-conf/conflicts');
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.report.clean, true);
  assert.equal(res.payload.report.conflicts.length, 0);
});

test('GET /teams/:teamId/conflicts detects same-file conflict', async () => {
  const runtime = createBridgeRuntime();
  runtime.projectStore.upsert({ key: 'alpha' });
  const g = await seedApprovedGoalPlan(runtime, 'alpha');
  if (!g) { assert.fail('seed failed'); return; }

  await call(runtime, 'POST', TEAMS('alpha'), {
    action: 'create', id: 't-same-file', goalId: g.goalId, planId: g.planId,
    logicalSlots: [
      { id: 's0', role: 'planner', stepIndex: 0, tier: 'patch-proposal', isolation: 'patch-only' },
      { id: 's1', role: 'verifier', stepIndex: 1, tier: 'patch-proposal', isolation: 'patch-only' },
    ],
    maxConcurrentBridgeSlots: 1, mode: 'sequential', isolation: 'patch-only',
    provider: 'claude', endpointId: 'claude-code-command',
  });
  await call(runtime, 'POST', TEAMS('alpha') + '/t-same-file/approve');

  runtime.teamStore.recordArtifact('t-same-file', {
    teamId: 't-same-file', slotId: 's0', planStepId: 'p0',
    providerId: 'claude', endpointId: 'claude-code-command', bridgeRunId: 'run-claude',
    summary: 'a', proposedFiles: ['src/app.ts'], outputRedacted: true, createdAt: 1,
  });
  runtime.teamStore.recordArtifact('t-same-file', {
    teamId: 't-same-file', slotId: 's1', planStepId: 'p1',
    providerId: 'codex', endpointId: 'codex-command', bridgeRunId: 'run-codex',
    summary: 'b', proposedFiles: ['src/app.ts'], outputRedacted: true, createdAt: 2,
  });

  const res = await call(runtime, 'GET', TEAMS('alpha') + '/t-same-file/conflicts');
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.report.clean, false);
  assert.equal(res.payload.report.conflicts.length, 1);
  assert.equal(res.payload.report.conflicts[0].path, '/src/app.ts');
  assert.equal(res.payload.report.conflicts[0].providerA, 'claude');
  assert.equal(res.payload.report.conflicts[0].providerB, 'codex');
  assert.equal(res.payload.meta.readOnly, true);
  assert.equal(res.payload.meta.winnerSelected, false);
  assert.equal(res.payload.meta.applyAvailable, false);
  assert.equal('winner' in res.payload.report.conflicts[0], false);
});

test('GET /teams/:teamId/conflicts 404 on cross-project', async () => {
  const runtime = createBridgeRuntime();
  runtime.projectStore.upsert({ key: 'alpha' });
  runtime.projectStore.upsert({ key: 'beta' });
  const gb = await seedApprovedGoalPlan(runtime, 'beta');
  if (!gb) { assert.fail('seed failed'); return; }

  await call(runtime, 'POST', TEAMS('beta'), {
    action: 'create', id: 't-beta-conf', goalId: gb.goalId, planId: gb.planId,
    logicalSlots: [{ id: 's0', role: 'planner', stepIndex: 0, tier: 'patch-proposal', isolation: 'patch-only' }],
    maxConcurrentBridgeSlots: 1, mode: 'sequential', isolation: 'patch-only',
    provider: 'claude', endpointId: 'claude-code-command',
  });

  const res = await call(runtime, 'GET', TEAMS('alpha') + '/t-beta-conf/conflicts');
  assert.equal(res.statusCode, 404);
});

// ════════════════════════════════════════════════════════════════════
// Slot state advance — POST /teams/:teamId/slots/:slotId/advance
// ════════════════════════════════════════════════════════════════════

test('POST /slots/:slotId/advance follows sequential order', async () => {
  const runtime = createBridgeRuntime();
  runtime.projectStore.upsert({ key: 'alpha' });
  const g = await seedApprovedGoalPlan(runtime, 'alpha');
  if (!g) { assert.fail('seed failed'); return; }

  await call(runtime, 'POST', TEAMS('alpha'), {
    action: 'create', id: 't-seq-api', goalId: g.goalId, planId: g.planId,
    logicalSlots: [
      { id: 's0', role: 'planner', stepIndex: 0, tier: 'patch-proposal', isolation: 'patch-only' },
      { id: 's1', role: 'verifier', stepIndex: 1, tier: 'patch-proposal', isolation: 'patch-only' },
    ],
    maxConcurrentBridgeSlots: 1, mode: 'sequential', isolation: 'patch-only',
    provider: 'claude', endpointId: 'claude-code-command',
  });
  await call(runtime, 'POST', TEAMS('alpha') + '/t-seq-api/approve');

  // Advance slot 0 -> done
  let res = await call(runtime, 'POST', TEAMS('alpha') + '/t-seq-api/slots/s0/advance', { status: 'done' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.team.logicalSlots[0].status, 'done');
  assert.equal(res.payload.team.currentSlotIndex, 1);

  // Advance slot 1 -> done
  res = await call(runtime, 'POST', TEAMS('alpha') + '/t-seq-api/slots/s1/advance', { status: 'done' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.team.status, 'done');
});

test('POST /slots/:slotId/advance rejects skipping current slot', async () => {
  const runtime = createBridgeRuntime();
  runtime.projectStore.upsert({ key: 'alpha' });
  const g = await seedApprovedGoalPlan(runtime, 'alpha');
  if (!g) { assert.fail('seed failed'); return; }

  await call(runtime, 'POST', TEAMS('alpha'), {
    action: 'create', id: 't-skip', goalId: g.goalId, planId: g.planId,
    logicalSlots: [
      { id: 's0', role: 'planner', stepIndex: 0, tier: 'patch-proposal', isolation: 'patch-only' },
      { id: 's1', role: 'verifier', stepIndex: 1, tier: 'patch-proposal', isolation: 'patch-only' },
    ],
    maxConcurrentBridgeSlots: 1, mode: 'sequential', isolation: 'patch-only',
    provider: 'claude', endpointId: 'claude-code-command',
  });
  await call(runtime, 'POST', TEAMS('alpha') + '/t-skip/approve');

  // Try to advance slot 1 before slot 0 — should reject
  const res = await call(runtime, 'POST', TEAMS('alpha') + '/t-skip/slots/s1/advance', { status: 'done' });
  assert.equal(res.statusCode, 409);
  assert.ok(res.payload.message.includes('not the current slot'));
});

test('POST /slots/:slotId/advance rejects double executing', async () => {
  const runtime = createBridgeRuntime();
  runtime.projectStore.upsert({ key: 'alpha' });
  const g = await seedApprovedGoalPlan(runtime, 'alpha');
  if (!g) { assert.fail('seed failed'); return; }

  await call(runtime, 'POST', TEAMS('alpha'), {
    action: 'create', id: 't-double', goalId: g.goalId, planId: g.planId,
    logicalSlots: [
      { id: 's0', role: 'planner', stepIndex: 0, tier: 'patch-proposal', isolation: 'patch-only' },
      { id: 's1', role: 'verifier', stepIndex: 1, tier: 'patch-proposal', isolation: 'patch-only' },
    ],
    maxConcurrentBridgeSlots: 1, mode: 'sequential', isolation: 'patch-only',
    provider: 'claude', endpointId: 'claude-code-command',
  });
  await call(runtime, 'POST', TEAMS('alpha') + '/t-double/approve');

  // Start slot 0 — auto-sets team to executing
  let res = await call(runtime, 'POST', TEAMS('alpha') + '/t-double/slots/s0/advance', { status: 'executing' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.team.logicalSlots[0].status, 'executing');

  // Try to set slot 0 to executing again while it's executing — should be ok (same slot)
  // But trying a different slot should fail
  res = await call(runtime, 'POST', TEAMS('alpha') + '/t-double/slots/s1/advance', { status: 'executing' });
  assert.equal(res.statusCode, 409);
  assert.ok(res.payload.message.includes('not the current slot') || res.payload.message.includes('already executing'));
});

test('POST /slots/:slotId/advance failed slot stops team', async () => {
  const runtime = createBridgeRuntime();
  runtime.projectStore.upsert({ key: 'alpha' });
  const g = await seedApprovedGoalPlan(runtime, 'alpha');
  if (!g) { assert.fail('seed failed'); return; }

  await call(runtime, 'POST', TEAMS('alpha'), {
    action: 'create', id: 't-fail-api', goalId: g.goalId, planId: g.planId,
    logicalSlots: [
      { id: 's0', role: 'planner', stepIndex: 0, tier: 'patch-proposal', isolation: 'patch-only' },
      { id: 's1', role: 'verifier', stepIndex: 1, tier: 'patch-proposal', isolation: 'patch-only' },
    ],
    maxConcurrentBridgeSlots: 1, mode: 'sequential', isolation: 'patch-only',
    provider: 'claude', endpointId: 'claude-code-command',
  });
  await call(runtime, 'POST', TEAMS('alpha') + '/t-fail-api/approve');

  let res = await call(runtime, 'POST', TEAMS('alpha') + '/t-fail-api/slots/s0/advance', { status: 'failed' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.team.status, 'failed');
  assert.equal(res.payload.team.logicalSlots[0].status, 'failed');

  // Cannot advance slot 1 on a failed team
  res = await call(runtime, 'POST', TEAMS('alpha') + '/t-fail-api/slots/s1/advance', { status: 'done' });
  assert.equal(res.statusCode, 409);
});

test('multi-provider: failed provider slot stops team and later provider slot does not auto-start', async () => {
  const runtime = createBridgeRuntime();
  runtime.projectStore.upsert({ key: 'alpha' });
  const g = await seedApprovedGoalPlan(runtime, 'alpha');
  if (!g) { assert.fail('seed failed'); return; }

  await call(runtime, 'POST', TEAMS('alpha'), {
    action: 'create', id: 't-provider-fail-stop', goalId: g.goalId, planId: g.planId,
    logicalSlots: [
      { id: 's0', role: 'planner', stepIndex: 0, tier: 'patch-proposal', isolation: 'patch-only', providerId: 'claude', endpointId: 'claude-code-command' },
      { id: 's1', role: 'verifier', stepIndex: 1, tier: 'patch-proposal', isolation: 'patch-only', providerId: 'codex', endpointId: 'codex-command' },
    ],
    maxConcurrentBridgeSlots: 1, mode: 'sequential', isolation: 'patch-only',
    provider: 'claude', endpointId: 'claude-code-command',
  });
  await call(runtime, 'POST', TEAMS('alpha') + '/t-provider-fail-stop/approve');

  let res = await call(runtime, 'POST', TEAMS('alpha') + '/t-provider-fail-stop/slots/s0/advance', { status: 'failed' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.team.status, 'failed');
  assert.equal(res.payload.team.logicalSlots[1].status, 'pending');

  res = await call(runtime, 'POST', TEAMS('alpha') + '/t-provider-fail-stop/slots/s1/advance', { status: 'executing' });
  assert.equal(res.statusCode, 409);
  assert.equal(runtime.teamStore.get('t-provider-fail-stop').logicalSlots[1].status, 'pending');
});

test('POST /slots/:slotId/advance writes slot audit events', async () => {
  const runtime = createBridgeRuntime();
  runtime.projectStore.upsert({ key: 'alpha' });
  const g = await seedApprovedGoalPlan(runtime, 'alpha');
  if (!g) { assert.fail('seed failed'); return; }

  await call(runtime, 'POST', TEAMS('alpha'), {
    action: 'create', id: 't-aud-slot', goalId: g.goalId, planId: g.planId,
    logicalSlots: [{ id: 's0', role: 'planner', stepIndex: 0, tier: 'patch-proposal', isolation: 'patch-only' }],
    maxConcurrentBridgeSlots: 1, mode: 'sequential', isolation: 'patch-only',
    provider: 'claude', endpointId: 'claude-code-command',
  });
  await call(runtime, 'POST', TEAMS('alpha') + '/t-aud-slot/approve');

  // Advance to executing (triggers slot_started), then to done (triggers slot_done).
  let res = await call(runtime, 'POST', TEAMS('alpha') + '/t-aud-slot/slots/s0/advance', { status: 'executing' });
  assert.equal(res.statusCode, 200);
  res = await call(runtime, 'POST', TEAMS('alpha') + '/t-aud-slot/slots/s0/advance', { status: 'done' });
  assert.equal(res.statusCode, 200);

  const events = runtime.auditLog.exportEvents().filter(e => e.teamId === 't-aud-slot');
  const started = events.find(e => e.type === 'slot_started');
  const done = events.find(e => e.type === 'slot_done');
  assert.ok(started, 'should emit slot_started');
  assert.ok(done, 'should emit slot_done');
  assert.equal(started.slotId, 's0');
  assert.equal(done.slotId, 's0');
  const startedMeta = started.result.metadata;
  const doneMeta = done.result.metadata;
  assert.equal(startedMeta.providerId, 'claude');
  assert.equal(startedMeta.endpointId, 'claude-code-command');
  assert.ok(startedMeta.bridgeRunId);
  assert.equal(doneMeta.providerId, 'claude');
  const auditText = JSON.stringify(events);
  assert.equal(auditText.includes('raw provider output'), false);
  assert.equal(auditText.includes('sk-secret'), false);
});

test('POST /slots/:slotId/advance rejects non-approved/cancelled team', async () => {
  const runtime = createBridgeRuntime();
  runtime.projectStore.upsert({ key: 'alpha' });
  const g = await seedApprovedGoalPlan(runtime, 'alpha');
  if (!g) { assert.fail('seed failed'); return; }

  await call(runtime, 'POST', TEAMS('alpha'), {
    action: 'create', id: 't-pending-slot', goalId: g.goalId, planId: g.planId,
    logicalSlots: [{ id: 's0', role: 'planner', stepIndex: 0, tier: 'patch-proposal', isolation: 'patch-only' }],
    maxConcurrentBridgeSlots: 1, mode: 'sequential', isolation: 'patch-only',
    provider: 'claude', endpointId: 'claude-code-command',
  });
  // Team is pending-approval, should reject slot advance
  const res = await call(runtime, 'POST', TEAMS('alpha') + '/t-pending-slot/slots/s0/advance', { status: 'done' });
  assert.equal(res.statusCode, 409);
  assert.ok(res.payload.message.includes('pending-approval'));
});

test('POST /slots/:slotId/advance rejects cross-project', async () => {
  const runtime = createBridgeRuntime();
  runtime.projectStore.upsert({ key: 'alpha' });
  runtime.projectStore.upsert({ key: 'beta' });
  const gb = await seedApprovedGoalPlan(runtime, 'beta');
  if (!gb) { assert.fail('seed failed'); return; }

  await call(runtime, 'POST', TEAMS('beta'), {
    action: 'create', id: 't-beta-slot', goalId: gb.goalId, planId: gb.planId,
    logicalSlots: [{ id: 's0', role: 'planner', stepIndex: 0, tier: 'patch-proposal', isolation: 'patch-only' }],
    maxConcurrentBridgeSlots: 1, mode: 'sequential', isolation: 'patch-only',
    provider: 'claude', endpointId: 'claude-code-command',
  });
  await call(runtime, 'POST', TEAMS('beta') + '/t-beta-slot/approve');

  const res = await call(runtime, 'POST', TEAMS('alpha') + '/t-beta-slot/slots/s0/advance', { status: 'done' });
  assert.equal(res.statusCode, 404);
});

// ════════════════════════════════════════════════════════════════════
// P1/P2 fix coverage: blocked-needs-gate, slot cancelled, malformed ids
// ════════════════════════════════════════════════════════════════════

test('POST /slots/:slotId/advance blocked-needs-gate writes slot_gated audit', async () => {
  const runtime = createBridgeRuntime();
  runtime.projectStore.upsert({ key: 'alpha' });
  const g = await seedApprovedGoalPlan(runtime, 'alpha');
  if (!g) { assert.fail('seed failed'); return; }

  await call(runtime, 'POST', TEAMS('alpha'), {
    action: 'create', id: 't-gate', goalId: g.goalId, planId: g.planId,
    logicalSlots: [{ id: 's0', role: 'planner', stepIndex: 0, tier: 'patch-proposal', isolation: 'patch-only' }],
    maxConcurrentBridgeSlots: 1, mode: 'sequential', isolation: 'patch-only',
    provider: 'claude', endpointId: 'claude-code-command',
  });
  await call(runtime, 'POST', TEAMS('alpha') + '/t-gate/approve');

  // Advance to executing then blocked-needs-gate
  let res = await call(runtime, 'POST', TEAMS('alpha') + '/t-gate/slots/s0/advance', { status: 'executing' });
  assert.equal(res.statusCode, 200);
  res = await call(runtime, 'POST', TEAMS('alpha') + '/t-gate/slots/s0/advance', { status: 'blocked-needs-gate' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.team.logicalSlots[0].status, 'blocked-needs-gate');

  const event = runtime.auditLog.exportEvents().find(e => e.teamId === 't-gate' && e.type === 'slot_gated');
  assert.ok(event, 'should emit slot_gated audit event');
  assert.equal(event.slotId, 's0');
});

test('POST /slots/:slotId/advance cancelled slot stops team', async () => {
  const runtime = createBridgeRuntime();
  runtime.projectStore.upsert({ key: 'alpha' });
  const g = await seedApprovedGoalPlan(runtime, 'alpha');
  if (!g) { assert.fail('seed failed'); return; }

  await call(runtime, 'POST', TEAMS('alpha'), {
    action: 'create', id: 't-slot-cancel', goalId: g.goalId, planId: g.planId,
    logicalSlots: [
      { id: 's0', role: 'planner', stepIndex: 0, tier: 'patch-proposal', isolation: 'patch-only' },
      { id: 's1', role: 'verifier', stepIndex: 1, tier: 'patch-proposal', isolation: 'patch-only' },
    ],
    maxConcurrentBridgeSlots: 1, mode: 'sequential', isolation: 'patch-only',
    provider: 'claude', endpointId: 'claude-code-command',
  });
  await call(runtime, 'POST', TEAMS('alpha') + '/t-slot-cancel/approve');

  // Cancel the current slot — team should become cancelled too.
  let res = await call(runtime, 'POST', TEAMS('alpha') + '/t-slot-cancel/slots/s0/advance', { status: 'cancelled' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.team.status, 'cancelled');
  assert.equal(res.payload.team.logicalSlots[0].status, 'cancelled');

  // Cannot advance slot 1 on cancelled team
  res = await call(runtime, 'POST', TEAMS('alpha') + '/t-slot-cancel/slots/s1/advance', { status: 'done' });
  assert.equal(res.statusCode, 409);
});

test('POST /slots/:slotId/advance malformed encoded slotId returns 400', async () => {
  const runtime = createBridgeRuntime();
  runtime.projectStore.upsert({ key: 'alpha' });
  const g = await seedApprovedGoalPlan(runtime, 'alpha');
  if (!g) { assert.fail('seed failed'); return; }

  await call(runtime, 'POST', TEAMS('alpha'), {
    action: 'create', id: 't-mal', goalId: g.goalId, planId: g.planId,
    logicalSlots: [{ id: 's0', role: 'planner', stepIndex: 0, tier: 'patch-proposal', isolation: 'patch-only' }],
    maxConcurrentBridgeSlots: 1, mode: 'sequential', isolation: 'patch-only',
    provider: 'claude', endpointId: 'claude-code-command',
  });
  await call(runtime, 'POST', TEAMS('alpha') + '/t-mal/approve');

  // Use a malformed percent-encoded slotId — should return controlled error, not 500.
  const res = await call(runtime, 'POST', TEAMS('alpha') + '/t-mal/slots/%ZZ/advance', { status: 'done' });
  assert.ok(res.statusCode === 400 || res.statusCode === 404 || res.statusCode === 405, 'malformed path should not crash');
  assert.notEqual(res.statusCode, 500);
});
