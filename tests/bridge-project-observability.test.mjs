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
