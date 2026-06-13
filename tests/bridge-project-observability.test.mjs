// v2.1 Read-only project observability API tests.
//
// Covers the 4 new GET endpoints: timeline, audit, memory, verification.
// All are read-only; POST/PATCH/DELETE must fail. Project-scoped isolation,
// empty data, invalid input, and malformed encoding are tested.
//
// Uses handleBridgeRequest directly (no real CLI spawns).

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BRIDGE_PROJECTS_PATH,
  BRIDGE_GOALS_PATH,
  BRIDGE_REVIEWS_PATH,
  createBridgeRuntime,
  handleBridgeRequest,
} from '../apps/local-server/src/routes/bridge-api.ts';
import { buildHarnessVerification } from '../apps/local-server/src/project-observability/builders.ts';

// ---- helpers ----

function jsonRequest(body) {
  const text = body === undefined ? '' : JSON.stringify(body);
  async function* gen() {
    if (text.length > 0) yield Buffer.from(text, 'utf8');
  }
  return gen();
}

async function call(runtime, method, path, body, query) {
  return handleBridgeRequest(runtime, method, path, jsonRequest(body), query);
}

async function seedGoal(runtime, sessionId, description, projectId) {
  return call(runtime, 'POST', BRIDGE_GOALS_PATH, { sessionId, description, projectId });
}

async function seedReview(runtime, sessionId, prompt, projectId) {
  return call(runtime, 'POST', BRIDGE_REVIEWS_PATH, {
    sessionId, prompt,
    sourceEndpointId: 'claude-code-command',
    targetEndpointId: 'claude-code-command',
    projectId,
  });
}

async function seedApprovedGoalPlan(runtime, projectId) {
  runtime.projectStore.upsert({ key: projectId, label: projectId });
  const goal = runtime.goalStore.createGoal({
    sessionId: 'seed-' + projectId,
    description: 'Goal for ' + projectId,
    projectId,
  });
  const plan = runtime.goalStore.attachPlan({
    goalId: goal.id,
    steps: [
      {
        intent: 'Plan task',
        kind: 'review',
        tier: 'patch-proposal',
        isStateMutating: false,
        targetEndpointId: 'claude-code-command',
      },
      {
        intent: 'Verify task',
        kind: 'review',
        tier: 'patch-proposal',
        isStateMutating: false,
        targetEndpointId: 'claude-code-command',
      },
    ],
    permittedTiers: ['patch-proposal'],
  });
  if (!plan) throw new Error('failed to attach plan');
  runtime.goalStore.approvePlan(goal.id);
  return { goalId: goal.id, planId: plan.id, stepId: plan.steps[1].id };
}

async function seedTeamArtifact(runtime, projectId, teamId, notes, createdAt = 200) {
  const seeded = await seedApprovedGoalPlan(runtime, projectId);
  const teamsPath = BRIDGE_PROJECTS_PATH + '/' + projectId + '/teams';
  const create = await call(runtime, 'POST', teamsPath, {
    action: 'create',
    id: teamId,
    goalId: seeded.goalId,
    planId: seeded.planId,
    logicalSlots: [
      { id: 'slot-plan', role: 'planner', stepIndex: 0, tier: 'patch-proposal', isolation: 'patch-only' },
      { id: 'slot-verify', role: 'verifier', stepIndex: 1, tier: 'patch-proposal', isolation: 'patch-only' },
    ],
    maxConcurrentBridgeSlots: 1,
    mode: 'sequential',
    isolation: 'patch-only',
    provider: 'claude',
    endpointId: 'claude-code-command',
  });
  assert.equal(create.statusCode, 201);
  const approve = await call(runtime, 'POST', teamsPath + '/' + teamId + '/approve');
  assert.equal(approve.statusCode, 200);
  const artifact = await call(runtime, 'POST', teamsPath + '/' + teamId + '/artifacts', {
    slotId: 'slot-verify',
    summary: 'Verifier checked patch',
    proposedFiles: ['src/feature.ts'],
    verificationNotes: notes,
    outputRedacted: true,
    createdAt,
  });
  assert.equal(artifact.statusCode, 201);
  return seeded;
}

// ════════════════════════════════════════════════════════════════════
// Timeline
// ════════════════════════════════════════════════════════════════════

test('GET /bridge/projects/:key/timeline returns entries for active project', async () => {
  const runtime = createBridgeRuntime();
  const g1 = await seedGoal(runtime, 's1', 'Build feature X', 'alpha');
  const g2 = await seedGoal(runtime, 's2', 'Add feature Y', 'alpha');
  await seedReview(runtime, 's3', 'Review code', 'alpha');

  const res = await call(runtime, 'GET', BRIDGE_PROJECTS_PATH + '/alpha/timeline');
  assert.equal(res.statusCode, 200);
  assert.ok(res.payload.entries.length >= 3, `expected >=3 entries, got ${res.payload.entries.length}`);
  // Goal entries should be present.
  const goalLabels = res.payload.entries.filter(e => e.source === 'goal');
  assert.ok(goalLabels.length >= 2);
  // Review entry should be present.
  const reviewLabels = res.payload.entries.filter(e => e.source === 'review');
  assert.ok(reviewLabels.length >= 1);
});

test('GET /bridge/projects/:key/timeline returns empty for project with no records', async () => {
  const runtime = createBridgeRuntime();
  runtime.projectStore.upsert({ key: 'empty-proj', label: 'Empty' });

  const res = await call(runtime, 'GET', BRIDGE_PROJECTS_PATH + '/empty-proj/timeline');
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.entries.length, 0);
});

test('GET /bridge/projects/:key/timeline returns 404 for unknown project', async () => {
  const runtime = createBridgeRuntime();
  const res = await call(runtime, 'GET', BRIDGE_PROJECTS_PATH + '/unknown/timeline');
  assert.equal(res.statusCode, 404);
});

test('POST /bridge/projects/:key/timeline is rejected (read-only)', async () => {
  const runtime = createBridgeRuntime();
  const res = await call(runtime, 'POST', BRIDGE_PROJECTS_PATH + '/alpha/timeline');
  assert.equal(res.statusCode, 405);
});

// ════════════════════════════════════════════════════════════════════
// Audit
// ════════════════════════════════════════════════════════════════════

test('GET /bridge/projects/:key/audit returns audit entries with limit', async () => {
  const runtime = createBridgeRuntime();
  await seedGoal(runtime, 'sa1', 'Goal A', 'beta');
  await seedGoal(runtime, 'sa2', 'Goal B', 'beta');

  const res = await call(runtime, 'GET', BRIDGE_PROJECTS_PATH + '/beta/audit', undefined,
    new URLSearchParams('limit=5'));
  assert.equal(res.statusCode, 200);
  assert.ok(res.payload.total >= 0);
  assert.ok(res.payload.returning <= 5);
});

test('GET /bridge/projects/:key/audit rejects invalid limit', async () => {
  const runtime = createBridgeRuntime();
  await seedGoal(runtime, 's', 'X', 'gamma');
  const res = await call(runtime, 'GET', BRIDGE_PROJECTS_PATH + '/gamma/audit', undefined,
    new URLSearchParams('limit=0'));
  assert.equal(res.statusCode, 400);
});

test('GET /bridge/projects/:key/audit filters by type', async () => {
  const runtime = createBridgeRuntime();
  await seedGoal(runtime, 'st', 'Y', 'delta');
  const res = await call(runtime, 'GET', BRIDGE_PROJECTS_PATH + '/delta/audit', undefined,
    new URLSearchParams('type=goal_created'));
  assert.equal(res.statusCode, 200);
  // filter is on audit event type, which are real event types like "send_review"
  // — so filtering by "goal_created" yields 0, which is fine.
  assert.equal(res.payload.entries.length, 0);
});

test('POST /bridge/projects/:key/audit is rejected', async () => {
  const runtime = createBridgeRuntime();
  const res = await call(runtime, 'POST', BRIDGE_PROJECTS_PATH + '/alpha/audit');
  assert.equal(res.statusCode, 405);
});

test('PATCH /bridge/projects/:key/audit is rejected', async () => {
  const runtime = createBridgeRuntime();
  const res = await call(runtime, 'PATCH', BRIDGE_PROJECTS_PATH + '/alpha/audit');
  assert.equal(res.statusCode, 405);
});

// ════════════════════════════════════════════════════════════════════
// Memory
// ════════════════════════════════════════════════════════════════════

test('GET /bridge/projects/:key/memory returns derived memory', async () => {
  const runtime = createBridgeRuntime();
  await seedGoal(runtime, 'sm1', 'Add dark mode', 'epsilon');

  const res = await call(runtime, 'GET', BRIDGE_PROJECTS_PATH + '/epsilon/memory');
  assert.equal(res.statusCode, 200);
  assert.ok(Array.isArray(res.payload.entries));
  // At least one memory entry (active goals count).
  assert.ok(res.payload.entries.length >= 1, `expected >=1, got ${res.payload.entries.length}`);
  // Every entry must have sourceKind and sourceId.
  res.payload.entries.forEach(e => {
    assert.ok(typeof e.sourceKind === 'string');
    assert.ok(typeof e.sourceId === 'string');
    assert.ok(typeof e.fact === 'string');
  });
});

test('GET /bridge/projects/:key/memory is empty for no records', async () => {
  const runtime = createBridgeRuntime();
  runtime.projectStore.upsert({ key: 'bare', label: 'Bare' });
  const res = await call(runtime, 'GET', BRIDGE_PROJECTS_PATH + '/bare/memory');
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.entries.length, 0);
});

test('POST /bridge/projects/:key/memory is rejected', async () => {
  const runtime = createBridgeRuntime();
  const res = await call(runtime, 'POST', BRIDGE_PROJECTS_PATH + '/alpha/memory');
  assert.equal(res.statusCode, 405);
});

test('GET /bridge/projects/:key/memory includes verified artifact evidence', async () => {
  const runtime = createBridgeRuntime();
  const seeded = await seedTeamArtifact(runtime, 'mem-verif', 'team-mem-verif', 'npm test passed', 700);

  const res = await call(runtime, 'GET', BRIDGE_PROJECTS_PATH + '/mem-verif/memory');

  assert.equal(res.statusCode, 200);
  const verif = res.payload.entries.filter(e => e.sourceKind === 'verification');
  assert.equal(verif.length, 1, `expected 1 verification entry, got ${verif.length}`);
  assert.equal(verif[0].sourceId, 'team-mem-verif:slot-verify');
  assert.equal(verif[0].timestamp, 700);
  // Derived fact references the step, never echoes raw notes or infers pass/fail.
  assert.ok(verif[0].fact.includes(seeded.stepId.slice(0, 8)));
  assert.ok(!verif[0].fact.includes('npm test passed'));
});

test('GET /bridge/projects/:key/memory ignores blank artifact notes', async () => {
  const runtime = createBridgeRuntime();
  await seedTeamArtifact(runtime, 'mem-blank', 'team-mem-blank', '   ', 701);

  const res = await call(runtime, 'GET', BRIDGE_PROJECTS_PATH + '/mem-blank/memory');

  assert.equal(res.statusCode, 200);
  const verif = res.payload.entries.filter(e => e.sourceKind === 'verification');
  assert.equal(verif.length, 0);
});

test('memory verification entries are project-isolated', async () => {
  const runtime = createBridgeRuntime();
  await seedTeamArtifact(runtime, 'mem-alpha-iso', 'team-mem-alpha', 'alpha evidence', 800);
  await seedTeamArtifact(runtime, 'mem-beta-iso', 'team-mem-beta', 'beta evidence', 900);

  const alpha = await call(runtime, 'GET', BRIDGE_PROJECTS_PATH + '/mem-alpha-iso/memory');
  const beta = await call(runtime, 'GET', BRIDGE_PROJECTS_PATH + '/mem-beta-iso/memory');

  assert.equal(alpha.statusCode, 200);
  assert.equal(beta.statusCode, 200);
  const alphaVerif = alpha.payload.entries.filter(e => e.sourceKind === 'verification');
  const betaVerif = beta.payload.entries.filter(e => e.sourceKind === 'verification');
  assert.equal(alphaVerif.length, 1);
  assert.equal(betaVerif.length, 1);
  assert.equal(alphaVerif[0].sourceId, 'team-mem-alpha:slot-verify');
  assert.equal(betaVerif[0].sourceId, 'team-mem-beta:slot-verify');
  assert.ok(!betaVerif.some(e => e.sourceId.startsWith('team-mem-alpha')));
});

test('GET /bridge/projects/:key/memory does not mutate team artifacts', async () => {
  const runtime = createBridgeRuntime();
  await seedTeamArtifact(runtime, 'mem-readonly', 'team-mem-readonly', 'readonly evidence', 950);
  const before = runtime.teamStore.exportArtifacts();

  const res = await call(runtime, 'GET', BRIDGE_PROJECTS_PATH + '/mem-readonly/memory');

  const after = runtime.teamStore.exportArtifacts();
  assert.equal(res.statusCode, 200);
  assert.deepEqual(after, before);
});

// ════════════════════════════════════════════════════════════════════
// Verification
// ════════════════════════════════════════════════════════════════════

test('GET /bridge/projects/:key/verification returns unavailable status', async () => {
  const runtime = createBridgeRuntime();
  await seedGoal(runtime, 'sv', 'Verify me', 'zeta');

  const res = await call(runtime, 'GET', BRIDGE_PROJECTS_PATH + '/zeta/verification');
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.status, 'unavailable');
  assert.ok(Array.isArray(res.payload.records));
});

test('GET /bridge/projects/:key/verification returns empty for no data', async () => {
  const runtime = createBridgeRuntime();
  runtime.projectStore.upsert({ key: 'nv', label: 'No verification' });
  const res = await call(runtime, 'GET', BRIDGE_PROJECTS_PATH + '/nv/verification');
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.status, 'unavailable');
  assert.equal(res.payload.records.length, 0);
});

test('GET /bridge/projects/:key/verification returns artifact-backed records', async () => {
  const runtime = createBridgeRuntime();
  const seeded = await seedTeamArtifact(runtime, 'verif-alpha', 'team-verif', 'npm test passed', 300);

  const res = await call(runtime, 'GET', BRIDGE_PROJECTS_PATH + '/verif-alpha/verification');
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.status, 'recorded');
  assert.equal(res.payload.records.length, 1);
  assert.deepEqual(res.payload.records[0], {
    stepId: seeded.stepId,
    stepIndex: 1,
    stepIntent: 'Verify task',
    stepStatus: 'pending',
    harnessStatus: 'recorded',
    notes: 'npm test passed',
    teamId: 'team-verif',
    slotId: 'slot-verify',
    createdAt: 300,
  });
  assert.deepEqual(res.payload.summary, {
    evidenceCount: 1,
    lastRecordedAt: 300,
    doneStepCount: 0,
    totalStepCount: 2,
  });
  const summaryText = JSON.stringify(res.payload.summary);
  assert.equal(summaryText.includes('npm test passed'), false);
  assert.equal(/pass|fail|green|red/i.test(summaryText), false);
});

test('GET /bridge/projects/:key/verification ignores blank artifact notes', async () => {
  const runtime = createBridgeRuntime();
  await seedTeamArtifact(runtime, 'verif-blank', 'team-blank', '   ', 301);

  const res = await call(runtime, 'GET', BRIDGE_PROJECTS_PATH + '/verif-blank/verification');
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.status, 'unavailable');
  assert.equal(res.payload.records.length, 0);
  assert.deepEqual(res.payload.summary, {
    evidenceCount: 0,
    doneStepCount: 0,
    totalStepCount: 2,
  });
});

test('verification artifact records are project-isolated', async () => {
  const runtime = createBridgeRuntime();
  await seedTeamArtifact(runtime, 'verif-alpha-iso', 'team-alpha-iso', 'alpha tests pass', 400);
  await seedTeamArtifact(runtime, 'verif-beta-iso', 'team-beta-iso', 'beta tests pass', 500);

  const alpha = await call(runtime, 'GET', BRIDGE_PROJECTS_PATH + '/verif-alpha-iso/verification');
  const beta = await call(runtime, 'GET', BRIDGE_PROJECTS_PATH + '/verif-beta-iso/verification');
  assert.equal(alpha.statusCode, 200);
  assert.equal(beta.statusCode, 200);
  assert.equal(alpha.payload.status, 'recorded');
  assert.equal(beta.payload.status, 'recorded');
  assert.equal(alpha.payload.records.length, 1);
  assert.equal(beta.payload.records.length, 1);
  assert.equal(alpha.payload.records[0].notes, 'alpha tests pass');
  assert.equal(beta.payload.records[0].notes, 'beta tests pass');
  assert.equal(alpha.payload.records.some(record => record.teamId === 'team-beta-iso'), false);
  assert.equal(beta.payload.records.some(record => record.teamId === 'team-alpha-iso'), false);
});

test('GET /bridge/projects/:key/verification does not mutate team artifacts', async () => {
  const runtime = createBridgeRuntime();
  await seedTeamArtifact(runtime, 'verif-readonly', 'team-readonly', 'readonly evidence', 600);
  const before = runtime.teamStore.exportArtifacts();

  const res = await call(runtime, 'GET', BRIDGE_PROJECTS_PATH + '/verif-readonly/verification');
  const after = runtime.teamStore.exportArtifacts();
  assert.equal(res.statusCode, 200);
  assert.deepEqual(after, before);
});

test('v2.11: verification summary is deterministic, note-free, and distinct from legacy notes', () => {
  const input = {
    projectId: 'summary-alpha',
    goals: [],
    plans: [
      {
        id: 'plan-1',
        goalId: 'goal-1',
        status: 'approved',
        steps: [
          { id: 'step-1', index: 0, intent: 'Implement', kind: 'review', status: 'done' },
          { id: 'step-2', index: 1, intent: 'Verify', kind: 'review', status: 'pending' },
        ],
      },
    ],
    reviews: [],
    pendingPrompts: [],
    auditEvents: [],
    teams: [
      {
        id: 'team-a',
        projectId: 'summary-alpha',
        planId: 'plan-1',
        logicalSlots: [{ id: 'slot-verify', stepIndex: 1, status: 'pending' }],
      },
    ],
    artifacts: [
      {
        teamId: 'team-a',
        slotId: 'slot-verify',
        planStepId: 'step-2',
        summary: 'Verifier checked patch',
        verificationNotes: 'npm test passed',
        createdAt: 800,
      },
    ],
  };

  const first = buildHarnessVerification(input);
  const second = buildHarnessVerification(input);

  assert.deepEqual(first.summary, second.summary, 'same input yields same summary');
  assert.deepEqual(first.summary, {
    evidenceCount: 1,
    lastRecordedAt: 800,
    doneStepCount: 1,
    totalStepCount: 2,
  });
  assert.equal(first.records[0].notes, 'npm test passed', 'legacy records still carry notes');
  const summaryJson = JSON.stringify(first.summary);
  assert.equal(summaryJson.includes('npm test passed'), false, 'summary must not contain raw notes');
  assert.equal(/pass|fail|green|red/i.test(summaryJson), false, 'summary must not infer outcomes');
});

test('POST /bridge/projects/:key/verification is rejected', async () => {
  const runtime = createBridgeRuntime();
  const res = await call(runtime, 'POST', BRIDGE_PROJECTS_PATH + '/alpha/verification');
  assert.equal(res.statusCode, 405);
});

// ════════════════════════════════════════════════════════════════════
// Project isolation
// ════════════════════════════════════════════════════════════════════

test('timeline is project-isolated — alpha data not visible in beta', async () => {
  const runtime = createBridgeRuntime();
  await seedGoal(runtime, 's-iso-a', 'Alpha goal', 'alpha');
  await seedGoal(runtime, 's-iso-b', 'Beta goal', 'beta');

  const alphaRes = await call(runtime, 'GET', BRIDGE_PROJECTS_PATH + '/alpha/timeline');
  const betaRes = await call(runtime, 'GET', BRIDGE_PROJECTS_PATH + '/beta/timeline');

  // Both should have goal entries but for different descriptions.
  const alphaGoals = alphaRes.payload.entries.filter(e => e.source === 'goal');
  const betaGoals = betaRes.payload.entries.filter(e => e.source === 'goal');
  assert.ok(alphaGoals.length >= 1);
  assert.ok(betaGoals.length >= 1);
  const alphaLabels = alphaGoals.map(e => e.label).join('');
  const betaLabels = betaGoals.map(e => e.label).join('');
  assert.ok(alphaLabels.includes('Alpha'));
  assert.ok(betaLabels.includes('Beta'));
});

test('malformed encoding in observability path returns 400', async () => {
  const runtime = createBridgeRuntime();
  const res = await call(runtime, 'GET', BRIDGE_PROJECTS_PATH + '/%gg/timeline');
  assert.equal(res.statusCode, 400);
});

test('archived project observability still readable', async () => {
  const runtime = createBridgeRuntime();
  await seedGoal(runtime, 's-arch', 'Archived goal', 'arch-proj');
  runtime.projectStore.upsert({ key: 'arch-proj' });
  runtime.projectStore.archive('arch-proj');

  const res = await call(runtime, 'GET', BRIDGE_PROJECTS_PATH + '/arch-proj/timeline');
  assert.equal(res.statusCode, 200);
  assert.ok(res.payload.entries.length >= 1);
});

// ════════════════════════════════════════════════════════════════════
// Legacy review audit fallback — packetId without projectId
// ════════════════════════════════════════════════════════════════════

test('legacy review audit event without projectId appears via packetId fallback', async () => {
  const runtime = createBridgeRuntime();

  // Create a review in project 'legacy-proj'. This creates a review with both
  // projectId and packetId set, and its lifecycle also writes audit events.
  const reviewRes = await call(runtime, 'POST', BRIDGE_REVIEWS_PATH, {
    sessionId: 'legacy-session',
    sourceEndpointId: 'claude-code-command',
    targetEndpointId: 'claude-code-command',
    prompt: 'Review legacy code',
    projectId: 'legacy-proj',
  });
  assert.equal(reviewRes.statusCode, 201);
  const review = reviewRes.payload.review;
  assert.ok(review.packetId, 'review must have a packetId');

  // Inject a legacy audit event WITHOUT projectId but WITH the review's packetId.
  // This simulates audit events written before Phase B projectId was added.
  runtime.auditLog.createAndAppend({
    sessionId: 'legacy-session',
    packetId: review.packetId,
    // Explicitly OMIT projectId to simulate legacy behavior.
    type: 'send_review',
    source: 'legacy-runner',
    target: 'claude-code-command',
    result: { ok: true },
  });

  // The legacy audit event should appear in the audit view via packetId fallback.
  const auditRes = await call(runtime, 'GET', BRIDGE_PROJECTS_PATH + '/legacy-proj/audit');
  assert.equal(auditRes.statusCode, 200);
  const legacyEntries = auditRes.payload.entries.filter(
    e => e.source === 'legacy-runner',
  );
  assert.equal(legacyEntries.length, 1, 'legacy audit event should be found via packetId fallback');

  // It should also appear in the timeline.
  const timelineRes = await call(runtime, 'GET', BRIDGE_PROJECTS_PATH + '/legacy-proj/timeline');
  assert.equal(timelineRes.statusCode, 200);
  const legacyTimeline = timelineRes.payload.entries.filter(
    e => e.source === 'audit' && e.kind === 'send_review',
  );
  assert.ok(legacyTimeline.length >= 1, 'legacy audit should also appear in timeline');
});

test('audit limit rejects non-integer and trailing-garbage values', async () => {
  const runtime = createBridgeRuntime();
  await seedGoal(runtime, 'sl', 'Limit test', 'limit-proj');

  const res1 = await call(runtime, 'GET', BRIDGE_PROJECTS_PATH + '/limit-proj/audit', undefined,
    new URLSearchParams('limit=5abc'));
  assert.equal(res1.statusCode, 400);

  const res2 = await call(runtime, 'GET', BRIDGE_PROJECTS_PATH + '/limit-proj/audit', undefined,
    new URLSearchParams('limit=1.5'));
  assert.equal(res2.statusCode, 400);
});

test('audit limit=empty string returns 400', async () => {
  const runtime = createBridgeRuntime();
  await seedGoal(runtime, 'sle', 'Empty limit test', 'empty-lim-proj');
  const res = await call(runtime, 'GET', BRIDGE_PROJECTS_PATH + '/empty-lim-proj/audit', undefined,
    new URLSearchParams('limit='));
  assert.equal(res.statusCode, 400);
});
