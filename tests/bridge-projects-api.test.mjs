// Phase B Project aggregation endpoint tests (Task 14).
//
// Project aggregation views group records by projectId/default-project backfill.
// Metadata/archive controls are limited to documented project-store mutations
// and must not add execution authority or weaken existing gates.

import assert from 'node:assert/strict';
import test from 'node:test';
import * as path from 'node:path';

import {
  BRIDGE_PENDING_PROMPTS_PATH,
  BRIDGE_PROJECTS_PATH,
  BRIDGE_REVIEWS_PATH,
  BRIDGE_GOALS_PATH,
  createBridgeRuntime,
  handleBridgeRequest,
  isBridgePath,
} from '../apps/local-server/src/routes/bridge-api.ts';
import { DEFAULT_PROJECT_KEY } from '../packages/shared/src/types.ts';

function jsonRequest(body) {
  const text = body === undefined ? '' : JSON.stringify(body);
  async function* gen() {
    if (text.length > 0) {
      yield Buffer.from(text, 'utf8');
    }
  }
  return gen();
}

async function call(runtime, method, path, body, queryParams) {
  return handleBridgeRequest(runtime, method, path, jsonRequest(body), queryParams);
}

test('project paths are recognized bridge paths', () => {
  assert.equal(isBridgePath(BRIDGE_PROJECTS_PATH), true);
  assert.equal(isBridgePath(`${BRIDGE_PROJECTS_PATH}/cli-bridge`), true);
  assert.equal(isBridgePath('/bridge/projects-alpha'), false);
});

test('GET /bridge/projects returns the default project when no records exist', async () => {
  const runtime = createBridgeRuntime();

  const res = await call(runtime, 'GET', BRIDGE_PROJECTS_PATH);

  assert.equal(res.statusCode, 200);
  assert.ok(Array.isArray(res.payload.projects));
  const summary = res.payload.projects.find((p) => p.project.key === DEFAULT_PROJECT_KEY);
  assert.ok(summary);
  assert.equal(summary.project.label, 'CLI Bridge');
  assert.equal(summary.goalCount, 0);
  assert.equal(summary.reviewCount, 0);
  assert.equal(summary.promptCount, 0);
  assert.equal(summary.status, 'unknown');
});

test('GET /bridge/projects groups explicit project records and backfills unscoped records', async () => {
  const runtime = createBridgeRuntime();

  await call(runtime, 'POST', BRIDGE_GOALS_PATH, {
    sessionId: 's-default',
    description: 'Default project goal',
  });
  await call(runtime, 'POST', BRIDGE_GOALS_PATH, {
    sessionId: 's-alpha',
    description: 'Alpha goal',
    projectId: 'alpha',
  });
  await call(runtime, 'POST', BRIDGE_PENDING_PROMPTS_PATH, {
    sessionId: 's-alpha',
    prompt: 'Alpha prompt',
    projectId: 'alpha',
  });
  await call(runtime, 'POST', BRIDGE_REVIEWS_PATH, {
    sessionId: 's-beta',
    sourceEndpointId: 'codex-command',
    targetEndpointId: 'claude-code-command',
    prompt: 'Review beta',
    projectId: 'beta',
  });

  const res = await call(runtime, 'GET', BRIDGE_PROJECTS_PATH);
  assert.equal(res.statusCode, 200);

  const byKey = new Map(res.payload.projects.map((summary) => [summary.project.key, summary]));
  assert.equal(byKey.get(DEFAULT_PROJECT_KEY).goalCount, 1);
  assert.equal(byKey.get('alpha').goalCount, 1);
  assert.equal(byKey.get('alpha').promptCount, 1);
  assert.equal(byKey.get('alpha').status, 'active');
  assert.equal(byKey.get('beta').reviewCount, 1);
  assert.equal(byKey.get('beta').goalCount, 0);
  assert.equal(byKey.get('beta').status, 'unknown');
});

test('GET /bridge/projects/:key returns project-scoped grouped data and derived status', async () => {
  const runtime = createBridgeRuntime();

  const alphaGoal = await call(runtime, 'POST', BRIDGE_GOALS_PATH, {
    sessionId: 's-alpha',
    description: 'Alpha goal',
    projectId: 'alpha',
  });
  await call(runtime, 'POST', BRIDGE_GOALS_PATH, {
    sessionId: 's-beta',
    description: 'Beta goal',
    projectId: 'beta',
  });
  await call(runtime, 'POST', BRIDGE_PENDING_PROMPTS_PATH, {
    sessionId: 's-alpha',
    prompt: 'Alpha prompt',
    projectId: 'alpha',
  });
  await call(runtime, 'POST', BRIDGE_REVIEWS_PATH, {
    sessionId: 's-alpha',
    sourceEndpointId: 'codex-command',
    targetEndpointId: 'claude-code-command',
    prompt: 'Alpha review',
    projectId: 'alpha',
  });

  const res = await call(runtime, 'GET', `${BRIDGE_PROJECTS_PATH}/alpha`);

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.project.key, 'alpha');
  assert.equal(res.payload.summary.goalCount, 1);
  assert.equal(res.payload.goals.length, 1);
  assert.equal(res.payload.goals[0].goal.id, alphaGoal.payload.goal.id);
  assert.equal(res.payload.reviews.length, 1);
  assert.equal(res.payload.pendingPrompts.length, 1);
  assert.equal(res.payload.status.activeGoal.id, alphaGoal.payload.goal.id);
  assert.equal(res.payload.status.goalsSummary.length, 1);
  assert.ok(typeof res.payload.status.latestAudit === 'object', 'latestAudit must be present when audit events exist');
  // status.memory is now sourced from the real derived-memory view (capped),
  // not a reserved []. Alpha has an active goal and a review → ≥1 entry.
  assert.ok(Array.isArray(res.payload.status.memory));
  assert.ok(res.payload.status.memory.length >= 1, `expected populated status.memory, got ${res.payload.status.memory.length}`);
  assert.ok(res.payload.status.memory.length <= 8, 'status.memory must be capped at 8');
  assert.ok(res.payload.status.memory.some(m => m.sourceKind === 'goal'),
    'status.memory should include a goal-derived fact');
});

test('GET /bridge/projects/:key returns empty status.memory for a project with no records', async () => {
  const runtime = createBridgeRuntime();
  runtime.projectStore.upsert({ key: 'bare-status', label: 'Bare' });

  const res = await call(runtime, 'GET', `${BRIDGE_PROJECTS_PATH}/bare-status`);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.payload.status.memory, []);
});

test('GET /bridge/projects/:key scopes audit events by records in that project', async () => {
  const runtime = createBridgeRuntime();

  await call(runtime, 'POST', BRIDGE_PENDING_PROMPTS_PATH, {
    sessionId: 's-alpha',
    prompt: 'Alpha prompt',
    projectId: 'alpha',
  });
  await call(runtime, 'POST', BRIDGE_PENDING_PROMPTS_PATH, {
    sessionId: 's-beta',
    prompt: 'Beta prompt',
    projectId: 'beta',
  });

  const alpha = await call(runtime, 'GET', `${BRIDGE_PROJECTS_PATH}/alpha`);
  const beta = await call(runtime, 'GET', `${BRIDGE_PROJECTS_PATH}/beta`);

  assert.equal(alpha.statusCode, 200);
  assert.equal(beta.statusCode, 200);
  assert.ok(alpha.payload.auditEvents.length >= 1);
  assert.ok(beta.payload.auditEvents.length >= 1);
  // Audit events filtered by record packetId — different sessions → isolated.
  const alphaPacketIds = new Set(
    alpha.payload.pendingPrompts.map(p => p.packetId)
  );
  const betaPacketIds = new Set(
    beta.payload.pendingPrompts.map(p => p.packetId)
  );
  assert.ok(alpha.payload.auditEvents.every(e => alphaPacketIds.has(e.packetId)),
    'alpha audit events must reference alpha-scoped packetIds');
  assert.ok(beta.payload.auditEvents.every(e => betaPacketIds.has(e.packetId)),
    'beta audit events must reference beta-scoped packetIds');
});

// P1 regression: same session across two projects must NOT cross-leak audit events.
test('GET /bridge/projects/:key audit isolation when two projects share the same session', async () => {
  const runtime = createBridgeRuntime();
  const sharedSession = 'session-shared';

  // Create a review in project-alpha.
  await call(runtime, 'POST', BRIDGE_REVIEWS_PATH, {
    sessionId: sharedSession,
    sourceEndpointId: 'codex-command',
    targetEndpointId: 'claude-code-command',
    prompt: 'Alpha review content here',
    projectId: 'alpha',
  });
  // Create a pending prompt in project-beta — same sessionId.
  await call(runtime, 'POST', BRIDGE_PENDING_PROMPTS_PATH, {
    sessionId: sharedSession,
    prompt: 'Beta prompt content here',
    projectId: 'beta',
  });

  const alpha = await call(runtime, 'GET', `${BRIDGE_PROJECTS_PATH}/alpha`);
  const beta = await call(runtime, 'GET', `${BRIDGE_PROJECTS_PATH}/beta`);

  assert.equal(alpha.statusCode, 200);
  assert.equal(beta.statusCode, 200);
  assert.ok(alpha.payload.auditEvents.length >= 1, 'alpha has audit events');
  assert.ok(beta.payload.auditEvents.length >= 1, 'beta has audit events');

  // Verify no cross-contamination via packetId.
  const aPacketIds = new Set(alpha.payload.reviews.map(r => r.packetId));
  const bPacketIds = new Set(beta.payload.pendingPrompts.map(p => p.packetId));
  assert.ok(alpha.payload.auditEvents.every(e => e.packetId && aPacketIds.has(e.packetId)),
    'alpha audit must only reference alpha packetIds');
  assert.ok(beta.payload.auditEvents.every(e => e.packetId && bPacketIds.has(e.packetId)),
    'beta audit must only reference beta packetIds');
  // Extra safety: alpha must NOT have beta's packetIds in audit.
  assert.ok(alpha.payload.auditEvents.every(e => !bPacketIds.has(e.packetId)),
    'alpha audit must NOT reference beta packetIds');
});

test('GET /bridge/projects/:key returns 404 for unknown projects with no records', async () => {
  const runtime = createBridgeRuntime();

  const res = await call(runtime, 'GET', `${BRIDGE_PROJECTS_PATH}/does-not-exist`);

  assert.equal(res.statusCode, 404);
  assert.equal(res.payload.status, 'error');
});

test('project aggregation endpoints reject unregistered methods', async () => {
  const runtime = createBridgeRuntime();

  // POST /bridge/projects is now a valid endpoint (B3 explicit project creation).
  // Other methods on the listing path and POST on detail paths are still rejected.
  const putList = await call(runtime, 'PUT', BRIDGE_PROJECTS_PATH);
  const delList = await call(runtime, 'DELETE', BRIDGE_PROJECTS_PATH);
  const detailPost = await call(runtime, 'POST', `${BRIDGE_PROJECTS_PATH}/alpha`, { label: 'Alpha' });
  const detailPut = await call(runtime, 'PUT', `${BRIDGE_PROJECTS_PATH}/alpha`);

  assert.equal(putList.statusCode, 405);
  assert.equal(delList.statusCode, 405);
  assert.equal(detailPost.statusCode, 405);
  assert.equal(detailPut.statusCode, 405);
});

// projectId input validation: invalid characters, too long, slashes.
test('POST /bridge/goals rejects invalid projectId values', async () => {
  const runtime = createBridgeRuntime();
  const invalidCases = [
    { projectId: '/etc/passwd', desc: 'slash-traversal' },
    { projectId: 'a'.repeat(65), desc: 'too-long' },
    { projectId: 'has space', desc: 'contains-space' },
    { projectId: 'has/slash', desc: 'contains-slash' },
    { projectId: '\x00', desc: 'null-char' },
  ];
  for (const { projectId, desc } of invalidCases) {
    const res = await call(runtime, 'POST', BRIDGE_GOALS_PATH, {
      sessionId: `s-${desc}`,
      description: 'test',
      projectId,
    });
    assert.equal(res.statusCode, 400, `projectId "${desc}" must be rejected`);
  }
});

test('POST /bridge/goals accepts valid projectId values', async () => {
  const runtime = createBridgeRuntime();
  const validCases = ['my-project', 'alpha_2', 'a', 'a'.repeat(64)];
  for (const projectId of validCases) {
    const res = await call(runtime, 'POST', BRIDGE_GOALS_PATH, {
      sessionId: `s-${projectId}`,
      description: 'test',
      projectId,
    });
    assert.equal(res.statusCode, 201, `projectId "${projectId}" must be accepted`);
  }
});

test('GET /bridge/projects/:key rejects invalid URL keys', async () => {
  const runtime = createBridgeRuntime();
  // Slash, space, and other invalid chars in URL path segment.
  const invalidPaths = [
    `${BRIDGE_PROJECTS_PATH}/a/b`,
    `${BRIDGE_PROJECTS_PATH}/has space`,
    `${BRIDGE_PROJECTS_PATH}/%2Fslash`,
  ];
  for (const path of invalidPaths) {
    const res = await call(runtime, 'GET', path);
    assert.ok(
      res.statusCode === 404 || res.statusCode === 405,
      `${path} must return 404/405, got ${res.statusCode}`,
    );
  }
});

// ════════════════════════════════════════════════════════════════════
// Archive / unarchive behavior tests
// ════════════════════════════════════════════════════════════════════

test('POST /bridge/projects/:key/archive sets archivedAt', async () => {
  const runtime = createBridgeRuntime();
  // Create a project explicitly so it has a label.
  runtime.projectStore.upsert({ key: 'alpha', label: 'Alpha' });
  runtime.persist();

  const res = await call(runtime, 'POST', `${BRIDGE_PROJECTS_PATH}/alpha/archive`);
  assert.equal(res.statusCode, 200);
  assert.equal(typeof res.payload.project.archivedAt, 'number');
});

test('POST /bridge/projects/:key/unarchive clears archivedAt', async () => {
  const runtime = createBridgeRuntime();
  runtime.projectStore.upsert({ key: 'alpha', label: 'Alpha' });
  runtime.projectStore.archive('alpha');
  runtime.persist();

  const res = await call(runtime, 'POST', `${BRIDGE_PROJECTS_PATH}/alpha/unarchive`);
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.project.archivedAt, undefined);
});

test('archived project blocks goal creation with 409', async () => {
  const runtime = createBridgeRuntime();
  runtime.projectStore.upsert({ key: 'alpha', label: 'Alpha' });
  runtime.projectStore.archive('alpha');
  runtime.persist();

  const res = await call(runtime, 'POST', BRIDGE_GOALS_PATH, {
    sessionId: 's-archived',
    description: 'should fail',
    projectId: 'alpha',
  });
  assert.equal(res.statusCode, 409);
});

test('archived project blocks review creation with 409', async () => {
  const runtime = createBridgeRuntime();
  runtime.projectStore.upsert({ key: 'alpha', label: 'Alpha' });
  runtime.projectStore.archive('alpha');
  runtime.persist();

  const res = await call(runtime, 'POST', BRIDGE_REVIEWS_PATH, {
    sessionId: 's-archived',
    sourceEndpointId: 'codex-command',
    targetEndpointId: 'claude-code-command',
    prompt: 'review this',
    projectId: 'alpha',
  });
  assert.equal(res.statusCode, 409);
});

test('archived project blocks prompt creation with 409', async () => {
  const runtime = createBridgeRuntime();
  runtime.projectStore.upsert({ key: 'alpha', label: 'Alpha' });
  runtime.projectStore.archive('alpha');
  runtime.persist();

  const res = await call(runtime, 'POST', BRIDGE_PENDING_PROMPTS_PATH, {
    sessionId: 's-archived',
    prompt: 'should fail',
    projectId: 'alpha',
  });
  assert.equal(res.statusCode, 409);
});

test('GET /bridge/projects hides archived projects by default', async () => {
  const runtime = createBridgeRuntime();
  runtime.projectStore.upsert({ key: 'alpha', label: 'Alpha' });
  runtime.projectStore.archive('alpha');
  runtime.persist();

  const res = await call(runtime, 'GET', BRIDGE_PROJECTS_PATH);
  assert.equal(res.statusCode, 200);
  const archived = res.payload.projects.find(p => p.project.key === 'alpha');
  assert.equal(archived, undefined, 'archived project must not appear in default listing');
});

test('GET /bridge/projects?includeArchived=true includes archived projects', async () => {
  const runtime = createBridgeRuntime();
  runtime.projectStore.upsert({ key: 'alpha', label: 'Alpha' });
  runtime.projectStore.archive('alpha');
  runtime.persist();

  // Use query param via call helper.
  const res = await call(runtime, 'GET', BRIDGE_PROJECTS_PATH, undefined,
    new URLSearchParams('includeArchived=true'));
  assert.equal(res.statusCode, 200);
  const archived = res.payload.projects.find(p => p.project.key === 'alpha');
  assert.ok(archived, 'archived project must appear with includeArchived=true');
});

test('default project cannot be archived', async () => {
  const runtime = createBridgeRuntime();
  const res = await call(runtime, 'POST', `${BRIDGE_PROJECTS_PATH}/cli-bridge/archive`);
  assert.equal(res.statusCode, 409);
});

test('malformed percent-encoding in archive path does not crash', async () => {
  const runtime = createBridgeRuntime();
  // %ZZ is invalid percent-encoding — must NOT throw (500), but return 400.
  const res = await call(runtime, 'POST', `${BRIDGE_PROJECTS_PATH}/alpha%ZZ/archive`);
  assert.ok(res.statusCode === 400 || res.statusCode === 404,
    `malformed encoding must return 400/404, got ${res.statusCode}`);
});

test('malformed percent-encoding in unarchive path does not crash', async () => {
  const runtime = createBridgeRuntime();
  const res = await call(runtime, 'POST', `${BRIDGE_PROJECTS_PATH}/alpha%ZZ/unarchive`);
  assert.ok(res.statusCode === 400 || res.statusCode === 404,
    `malformed encoding must return 400/404, got ${res.statusCode}`);
});

// ════════════════════════════════════════════════════════════════════
// AuditEvent.projectId propagation
// ════════════════════════════════════════════════════════════════════

test('project-scoped prompt audit events carry projectId', async () => {
  const runtime = createBridgeRuntime();
  const prompt = runtime.pendingPromptStore.createPendingPrompt({
    sessionId: 's-audit',
    prompt: 'test prompt with projectId',
    source: 'chatgpt-web',
    transport: 'clipboard',
    projectId: 'alpha',
  });
  const events = runtime.auditLog.listEvents();
  const createEvent = events.find(e => e.packetId === prompt.packetId);
  assert.ok(createEvent, 'must have created an audit event');
  assert.equal(createEvent.projectId, 'alpha', 'audit event must carry projectId');
});

test('project-scoped review audit events carry projectId', async () => {
  const runtime = createBridgeRuntime();
  const review = runtime.pendingReviewStore.createDraft({
    sessionId: 's-audit',
    sourceEndpointId: 'codex-command',
    targetEndpointId: 'claude-code-command',
    prompt: 'review with projectId',
    projectId: 'beta',
  });
  const events = runtime.auditLog.listEvents();
  const createEvent = events.find(e => e.packetId === review.packetId);
  assert.ok(createEvent, 'must have created an audit event');
  assert.equal(createEvent.projectId, 'beta', 'audit event must carry projectId');
});

test('projectId-match audit filtering isolates events by projectId', async () => {
  const runtime = createBridgeRuntime();
  runtime.pendingPromptStore.createPendingPrompt({
    sessionId: 's1', prompt: 'alpha prompt', source: 'chatgpt-web',
    transport: 'clipboard', projectId: 'alpha',
  });
  runtime.pendingPromptStore.createPendingPrompt({
    sessionId: 's1', prompt: 'beta prompt', source: 'chatgpt-web',
    transport: 'clipboard', projectId: 'beta',
  });

  const alphaEvents = runtime.auditLog.listEvents()
    .filter(e => e.projectId === 'alpha');
  const betaEvents = runtime.auditLog.listEvents()
    .filter(e => e.projectId === 'beta');

  assert.ok(alphaEvents.length > 0, 'must find alpha-scoped audit events');
  assert.ok(betaEvents.length > 0, 'must find beta-scoped audit events');
  assert.ok(alphaEvents.every(e => e.projectId === 'alpha'));
  assert.ok(betaEvents.every(e => e.projectId === 'beta'));
});

test('audit event with mismatched projectId is excluded even if packetId matches', async () => {
  const runtime = createBridgeRuntime();
  // Create alpha-scoped record so /bridge/projects/alpha exists (returns 200).
  runtime.pendingPromptStore.createPendingPrompt({
    sessionId: 's1', prompt: 'alpha prompt', source: 'chatgpt-web',
    transport: 'clipboard', projectId: 'alpha',
  });
  // Manually forge an audit event with projectId='beta', but an alpha-scoped packetId.
  const alphaEvents = runtime.auditLog.listEvents();
  const alphaPromptEvent = alphaEvents.find(e => e.projectId === 'alpha');
  runtime.auditLog.append({
    ...alphaPromptEvent,
    id: 'forged-beta',
    projectId: 'beta', // authoritative: 'beta' — mismatched!
    // packetId stays alpha-scoped
  });

  // Fetch alpha project detail — the forged event must NOT appear
  // because projectId='beta' is authoritative, not packetId.
  const { handleBridgeRequest } = await import('../apps/local-server/src/routes/bridge-api.ts');
  const alphaDetail = await handleBridgeRequest(runtime, 'GET', `${BRIDGE_PROJECTS_PATH}/alpha`, {});
  assert.equal(alphaDetail.statusCode, 200, 'alpha detail must return 200');
  const alphaAuditEvents = alphaDetail.payload.auditEvents || [];
  assert.ok(alphaAuditEvents.length > 0, 'alpha must have some audit events');
  assert.ok(!alphaAuditEvents.some(e => e.id === 'forged-beta'),
    'mismatched projectId (beta) event must be excluded from alpha detail');
});

test('/bridge/projects/:key includes events by projectId-first matching', async () => {
  const runtime = createBridgeRuntime();
  // Create alpha-scoped prompt.
  runtime.pendingPromptStore.createPendingPrompt({
    sessionId: 's1', prompt: 'alpha prompt', source: 'chatgpt-web',
    transport: 'clipboard', projectId: 'alpha',
  });

  const { handleBridgeRequest } = await import('../apps/local-server/src/routes/bridge-api.ts');
  const detail = await handleBridgeRequest(runtime, 'GET', `${BRIDGE_PROJECTS_PATH}/alpha`, {});
  const events = detail.payload.auditEvents || [];
  assert.ok(events.length > 0, 'alpha detail must include projectId-matched audit events');
  assert.ok(events.every(e => e.projectId === 'alpha'), 'all events must be alpha-scoped');
});

test('encoded traversal-like project key in archive path is rejected', async () => {
  const runtime = createBridgeRuntime();
  const res = await call(runtime, 'POST', `${BRIDGE_PROJECTS_PATH}/%2e%2e/archive`);
  assert.equal(res.statusCode, 400);
});

// ════════════════════════════════════════════════════════════════════
// Phase B closeout — PATCH / metadata contract tests
// ════════════════════════════════════════════════════════════════════

test('PATCH /bridge/projects/:key updates label and description', async () => {
  const runtime = createBridgeRuntime();
  runtime.projectStore.upsert({ key: 'alpha', label: 'Alpha' });
  const res = await call(runtime, 'PATCH', `${BRIDGE_PROJECTS_PATH}/alpha`, {
    label: 'New Alpha',
    description: 'Updated desc',
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.project.label, 'New Alpha');
  assert.equal(res.payload.project.description, 'Updated desc');
});

test('PATCH /bridge/projects/:key rejects disallowed fields', async () => {
  const runtime = createBridgeRuntime();
  runtime.projectStore.upsert({ key: 'alpha', label: 'Alpha' });
  const res = await call(runtime, 'PATCH', `${BRIDGE_PROJECTS_PATH}/alpha`, {
    key: 'renamed',
  });
  assert.equal(res.statusCode, 400);
});

test('ADR-0014: POST/PATCH project root fields are not accepted into project metadata', async () => {
  const runtime = createBridgeRuntime();

  let res = await call(runtime, 'POST', BRIDGE_PROJECTS_PATH, {
    key: 'root-test',
    label: 'Root Test',
    workspaceRoot: 'H:/should/not/store',
    baselineRoot: 'H:/should/not/store',
    cwd: 'H:/should/not/store',
  });
  assert.equal(res.statusCode, 201);
  assert.equal(res.payload.project.workspaceRoot, undefined);
  assert.equal(res.payload.project.baselineRoot, undefined);
  assert.equal(res.payload.project.cwd, undefined);

  res = await call(runtime, 'PATCH', `${BRIDGE_PROJECTS_PATH}/root-test`, {
    workspaceRoot: 'H:/other',
    baselineRoot: 'H:/other',
    cwd: 'H:/other',
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.project.workspaceRoot, undefined);
  assert.equal(res.payload.project.baselineRoot, undefined);
  assert.equal(res.payload.project.cwd, undefined);

  const stored = runtime.projectStore.get('root-test');
  assert.equal(stored.workspaceRoot, undefined);
  assert.equal(stored.baselineRoot, undefined);
  assert.equal(stored.cwd, undefined);
});

test('PATCH /bridge/projects/:key rejects unknown project', async () => {
  const runtime = createBridgeRuntime();
  const res = await call(runtime, 'PATCH', `${BRIDGE_PROJECTS_PATH}/unknown`, {
    label: 'No one',
  });
  assert.equal(res.statusCode, 404);
});

test('PATCH /bridge/projects/:key is idempotent', async () => {
  const runtime = createBridgeRuntime();
  runtime.projectStore.upsert({ key: 'alpha', label: 'Alpha' });
  await call(runtime, 'PATCH', `${BRIDGE_PROJECTS_PATH}/alpha`, { label: 'Alpha' });
  const res = await call(runtime, 'PATCH', `${BRIDGE_PROJECTS_PATH}/alpha`, { label: 'Alpha' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.project.label, 'Alpha');
});

// ════════════════════════════════════════════════════════════════════
// P1 code-review regression: implicit project upsert + archivedAt pres.
// ════════════════════════════════════════════════════════════════════

test('implicit project via goal creation is PATCH-able and archivable', async () => {
  const runtime = createBridgeRuntime();
  const res = await call(runtime, 'POST', BRIDGE_GOALS_PATH, {
    sessionId: 'implicit-goal',
    description: 'Test implicit project',
    projectId: 'implicit-goal-proj',
  });
  assert.equal(res.statusCode, 201);

  const patchRes = await call(runtime, 'PATCH', BRIDGE_PROJECTS_PATH + '/implicit-goal-proj', {
    label: 'Implicit Goal Proj',
  });
  assert.equal(patchRes.statusCode, 200, 'PATCH should succeed on implicit project');
  assert.equal(patchRes.payload.project.label, 'Implicit Goal Proj');

  const archiveRes = await call(runtime, 'POST', BRIDGE_PROJECTS_PATH + '/implicit-goal-proj/archive');
  assert.equal(archiveRes.statusCode, 200);
  assert.ok(archiveRes.payload.project.archivedAt, 'should have archivedAt');

  const unarchiveRes = await call(runtime, 'POST', BRIDGE_PROJECTS_PATH + '/implicit-goal-proj/unarchive');
  assert.equal(unarchiveRes.statusCode, 200);
  assert.equal(unarchiveRes.payload.project.archivedAt, undefined);
});

test('implicit project via review creation is PATCH-able', async () => {
  const runtime = createBridgeRuntime();
  const res = await call(runtime, 'POST', BRIDGE_REVIEWS_PATH, {
    sessionId: 'implicit-review',
    sourceEndpointId: 'claude-code-command',
    targetEndpointId: 'claude-code-command',
    prompt: 'Review this',
    projectId: 'implicit-review-proj',
  });
  assert.equal(res.statusCode, 201);

  const patchRes = await call(runtime, 'PATCH', BRIDGE_PROJECTS_PATH + '/implicit-review-proj', {
    label: 'Implicit Review Proj',
  });
  assert.equal(patchRes.statusCode, 200, 'PATCH should work for review-created project');
});

test('implicit project via prompt creation is PATCH-able', async () => {
  const runtime = createBridgeRuntime();
  const res = await call(runtime, 'POST', BRIDGE_PENDING_PROMPTS_PATH, {
    sessionId: 'implicit-prompt',
    prompt: 'Test prompt',
    projectId: 'implicit-prompt-proj',
  });
  assert.equal(res.statusCode, 201);

  const patchRes = await call(runtime, 'PATCH', BRIDGE_PROJECTS_PATH + '/implicit-prompt-proj', {
    label: 'Implicit Prompt Proj',
  });
  assert.equal(patchRes.statusCode, 200, 'PATCH should work for prompt-created project');
});

test('PATCH archived project preserves archivedAt', async () => {
  const runtime = createBridgeRuntime();
  runtime.projectStore.upsert({ key: 'archived-proj', label: 'Archived' });
  await call(runtime, 'POST', BRIDGE_PROJECTS_PATH + '/archived-proj/archive');

  const patchRes = await call(runtime, 'PATCH', BRIDGE_PROJECTS_PATH + '/archived-proj', {
    label: 'Still Archived',
  });
  assert.equal(patchRes.statusCode, 200);
  assert.equal(patchRes.payload.project.label, 'Still Archived');
  assert.ok(patchRes.payload.project.archivedAt, 'archivedAt should survive PATCH');

  const listRes = await call(runtime, 'GET', BRIDGE_PROJECTS_PATH);
  const visible = listRes.payload.projects.some(p => p.project.key === 'archived-proj');
  assert.equal(visible, false, 'archived project hidden from default listing');

  const includeRes = await call(runtime, 'GET', BRIDGE_PROJECTS_PATH, undefined,
    new URLSearchParams('includeArchived=true'));
  const inArchiveList = includeRes.payload.projects.some(p => p.project.key === 'archived-proj');
  assert.equal(inArchiveList, true, 'archived project visible with includeArchived=true');
});

// ════════════════════════════════════════════════════════════════════
// B3: POST /bridge/projects — explicit project creation
// ════════════════════════════════════════════════════════════════════

test('POST /bridge/projects creates explicit project', async () => {
  const runtime = createBridgeRuntime();
  const res = await call(runtime, 'POST', BRIDGE_PROJECTS_PATH, { key: 'my-proj', label: 'My Project' });
  assert.equal(res.statusCode, 201);
  assert.equal(res.payload.project.key, 'my-proj');
  assert.equal(res.payload.project.label, 'My Project');
  assert.ok(res.payload.project.createdAt > 0);
  assert.equal(res.payload.project.archivedAt, undefined);

  // Verify in listing.
  const list = await call(runtime, 'GET', BRIDGE_PROJECTS_PATH);
  const found = list.payload.projects.find(p => p.project.key === 'my-proj');
  assert.ok(found, 'new project should appear in listing');
});

test('POST /bridge/projects with only key uses key as label', async () => {
  const runtime = createBridgeRuntime();
  const res = await call(runtime, 'POST', BRIDGE_PROJECTS_PATH, { key: 'label-as-key' });
  assert.equal(res.statusCode, 201);
  assert.equal(res.payload.project.label, 'label-as-key');
});

test('POST /bridge/projects rejects duplicate key (409)', async () => {
  const runtime = createBridgeRuntime();
  await call(runtime, 'POST', BRIDGE_PROJECTS_PATH, { key: 'dup', label: 'First' });
  const res = await call(runtime, 'POST', BRIDGE_PROJECTS_PATH, { key: 'dup', label: 'Second' });
  assert.equal(res.statusCode, 409);
  // Metadata should not be overwritten.
  assert.equal(runtime.projectStore.get('dup').label, 'First');
});

test('POST /bridge/projects rejects duplicate archived key (409)', async () => {
  const runtime = createBridgeRuntime();
  await call(runtime, 'POST', BRIDGE_PROJECTS_PATH, { key: 'arch-dup' });
  runtime.projectStore.archive('arch-dup');
  const res = await call(runtime, 'POST', BRIDGE_PROJECTS_PATH, { key: 'arch-dup' });
  assert.equal(res.statusCode, 409);
  // Should still be archived (not implicitly unarchived).
  assert.ok(runtime.projectStore.get('arch-dup').archivedAt);
});

test('POST /bridge/projects rejects cli-bridge (default exists)', async () => {
  const runtime = createBridgeRuntime();
  const res = await call(runtime, 'POST', BRIDGE_PROJECTS_PATH, { key: 'cli-bridge' });
  assert.equal(res.statusCode, 409);
});

test('POST /bridge/projects rejects missing key', async () => {
  const runtime = createBridgeRuntime();
  const res = await call(runtime, 'POST', BRIDGE_PROJECTS_PATH, { label: 'NoKey' });
  assert.equal(res.statusCode, 400);
});

test('POST /bridge/projects rejects invalid key', async () => {
  const runtime = createBridgeRuntime();
  const res = await call(runtime, 'POST', BRIDGE_PROJECTS_PATH, { key: '' });
  assert.equal(res.statusCode, 400);
});

test('POST /bridge/projects rejects disallowed fields', async () => {
  const runtime = createBridgeRuntime();
  const res = await call(runtime, 'POST', BRIDGE_PROJECTS_PATH, { key: 'bad', createdAt: 1 });
  assert.equal(res.statusCode, 400);
  assert.ok(res.payload.message.includes('createdAt'));
});

// v2.13: verifyProfileId allowlist validation
test('v2.13: verifyProfileId must reference a configured verification profile', async () => {
  // Runtime with profiles
  const runtime = createBridgeRuntime({
    verifyProfiles: [{ id: 'unit-tests', label: 'Unit', argv: ['npm', 'test'], env: [], timeoutMs: 1000, outputCapBytes: 1024, networkRisk: 'unknown', mutationRisk: 'read-only' }],
  });

  // Configured profile id → 200 and stored
  let res = await call(runtime, 'PATCH', `${BRIDGE_PROJECTS_PATH}/cli-bridge`, { verifyProfileId: 'unit-tests' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.project.verifyProfileId, 'unit-tests');
  assert.equal(runtime.projectStore.get('cli-bridge').verifyProfileId, 'unit-tests');

  // Null removes → 200, not persisted
  res = await call(runtime, 'PATCH', `${BRIDGE_PROJECTS_PATH}/cli-bridge`, { verifyProfileId: null });
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.project.verifyProfileId, undefined);
  assert.equal(runtime.projectStore.get('cli-bridge').verifyProfileId, undefined);

  // Unknown profile id → 400, not stored
  res = await call(runtime, 'PATCH', `${BRIDGE_PROJECTS_PATH}/cli-bridge`, { verifyProfileId: 'nope' });
  assert.equal(res.statusCode, 400);
  assert.equal(runtime.projectStore.get('cli-bridge').verifyProfileId, undefined);

  // Non-string (number/object) → 400
  res = await call(runtime, 'PATCH', `${BRIDGE_PROJECTS_PATH}/cli-bridge`, { verifyProfileId: 123 });
  assert.equal(res.statusCode, 400);
  res = await call(runtime, 'PATCH', `${BRIDGE_PROJECTS_PATH}/cli-bridge`, { verifyProfileId: {} });
  assert.equal(res.statusCode, 400);
});

test('v2.13: verifyProfileId rejected when no runtime profiles are configured', async () => {
  const runtime = createBridgeRuntime();
  const res = await call(runtime, 'PATCH', `${BRIDGE_PROJECTS_PATH}/cli-bridge`, { verifyProfileId: 'any' });
  assert.equal(res.statusCode, 400);
  assert.ok(res.payload.message.includes('verifyProfileId'));
  assert.equal(runtime.projectStore.get('cli-bridge').verifyProfileId, undefined);
});

// ── v2.13-h: /verification/profiles and /verification/confirm route tests ──

function makeVerifyRuntime(opts) {
  // Inject a counting fake spawn so route tests never run a real external
  // command. Records each invocation's file/args/cwd/env for assertions.
  const spawnCalls = [];
  const verificationSpawnFn = opts.spawnFn ?? (async (file, args, o) => {
    spawnCalls.push({ file, args, cwd: o.cwd, env: o.env });
    return { ok: true, exitCode: 0, signal: null, stdoutChunks: [], stderrChunks: [] };
  });
  const runtime = createBridgeRuntime({
    verifyProfiles: opts.profiles ?? [{ id: 'ut', label: 'UT', argv: ['npm', 'test'], env: [], timeoutMs: 5000, outputCapBytes: 65536, networkRisk: 'unknown', mutationRisk: 'read-only' }],
    projectWorkspaceRoots: 'root' in opts ? opts.root : { 'cli-bridge': '/tmp/test-root' },
    baselineRoot: opts.baselineRoot ?? '/tmp/baseline',
    verificationSpawnFn,
  });
  runtime.__spawnCalls = spawnCalls;
  return runtime;
}

test('v2.13: GET /verification/profiles returns sanitized metadata only', async () => {
  const rt = makeVerifyRuntime({});
  const res = await call(rt, 'GET', `${BRIDGE_PROJECTS_PATH}/cli-bridge/verification/profiles`);
  assert.equal(res.statusCode, 200);
  const p = res.payload.profiles[0];
  assert.equal(p.id, 'ut');
  assert.equal(p.label, 'UT');
  assert.equal(p.networkRisk, 'unknown');
  assert.equal(p.mutationRisk, 'read-only');
  assert.equal(p.selected, false);
  // Redaction: no argv/cwd/env/root/caps
  for (const banned of ['argv', 'cwd', 'env', 'root', 'workspaceRoot', 'timeoutMs', 'outputCapBytes']) {
    assert.equal(banned in p, false, `profile must not expose ${banned}`);
  }
  assert.equal(res.payload.selectedProfileId, null);
  assert.equal(res.payload.workspaceRootAvailable, true);
});

test('v2.13: GET /verification/profiles shows selected when project opt-in is set', async () => {
  const rt = makeVerifyRuntime({});
  await call(rt, 'PATCH', `${BRIDGE_PROJECTS_PATH}/cli-bridge`, { verifyProfileId: 'ut' });
  const res = await call(rt, 'GET', `${BRIDGE_PROJECTS_PATH}/cli-bridge/verification/profiles`);
  assert.equal(res.payload.selectedProfileId, 'ut');
  assert.equal(res.payload.profiles[0].selected, true);
});

test('v2.13: POST /verification/confirm fail-closed without confirm:true', async () => {
  const rt = makeVerifyRuntime({});
  await call(rt, 'PATCH', `${BRIDGE_PROJECTS_PATH}/cli-bridge`, { verifyProfileId: 'ut' });
  let res = await call(rt, 'POST', `${BRIDGE_PROJECTS_PATH}/cli-bridge/verification/confirm`, {});
  assert.equal(res.statusCode, 409);
  res = await call(rt, 'POST', `${BRIDGE_PROJECTS_PATH}/cli-bridge/verification/confirm`, { confirm: false });
  assert.equal(res.statusCode, 409);
  assert.equal(rt.__spawnCalls.length, 0, 'no spawn without confirm:true');
});

test('v2.13: POST /verification/confirm runs configured profile and returns typed result', async () => {
  const rt = makeVerifyRuntime({ profiles: [{ id: 'ut', label: 'UT', argv: ['npm', 'test', '--silent'], env: [], timeoutMs: 5000, outputCapBytes: 65536, networkRisk: 'unknown', mutationRisk: 'read-only' }] });
  await call(rt, 'PATCH', `${BRIDGE_PROJECTS_PATH}/cli-bridge`, { verifyProfileId: 'ut' });
  const res = await call(rt, 'POST', `${BRIDGE_PROJECTS_PATH}/cli-bridge/verification/confirm`, { confirm: true });
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.profileId, 'ut');
  assert.equal(res.payload.commandLabel, 'UT');
  // Fake spawn returns exit 0 → deterministic passed (no real external command).
  assert.equal(res.payload.result, 'passed');
  assert.equal(typeof res.payload.elapsedMs, 'number');
  assert.equal(typeof res.payload.truncated, 'boolean');
  assert.equal(res.payload.outputDiscarded, true);

  // Fake spawn invoked exactly once, with the selected profile's structured
  // argv and the project-specific workspace root (normalized) as cwd.
  assert.equal(rt.__spawnCalls.length, 1, 'spawn invoked exactly once');
  assert.equal(rt.__spawnCalls[0].file, 'npm');
  assert.deepEqual(rt.__spawnCalls[0].args, ['test', '--silent']);
  assert.equal(rt.__spawnCalls[0].cwd, path.resolve('/tmp/test-root'));

  // No raw output / argv / cwd / env / root in the response.
  for (const banned of ['stdout', 'stderr', 'output', 'argv', 'cwd', 'env', 'root']) {
    assert.equal(banned in res.payload, false, `response must not contain ${banned}`);
  }
  const payloadJson = JSON.stringify(res.payload);
  assert.equal(payloadJson.includes('test-root'), false, 'response must not leak the absolute cwd/root');

  // Stored run record is sanitized too (no raw output/argv/cwd/env/root).
  const stored = rt.verificationRunStore.getForProject('cli-bridge');
  assert.equal(stored.length, 1);
  for (const banned of ['stdout', 'stderr', 'output', 'argv', 'cwd', 'env', 'root']) {
    assert.equal(banned in stored[0], false, `stored record must not contain ${banned}`);
  }

  // Audit event is redacted: no absolute cwd/root or raw output streams.
  const auditRes = await call(rt, 'GET', `${BRIDGE_PROJECTS_PATH}/cli-bridge/audit`);
  assert.equal(auditRes.statusCode, 200);
  const auditJson = JSON.stringify(auditRes.payload);
  assert.equal(auditJson.includes('test-root'), false, 'audit must not leak the absolute cwd/root');
  for (const banned of ['stdout', 'stderr', 'argv']) {
    assert.equal(auditJson.includes(banned), false, `audit must not contain ${banned}`);
  }
});

test('v2.13: POST /verification/confirm rejects command/argv/cwd/env override', async () => {
  const rt = makeVerifyRuntime({});
  await call(rt, 'PATCH', `${BRIDGE_PROJECTS_PATH}/cli-bridge`, { verifyProfileId: 'ut' });
  for (const field of ['command', 'argv', 'cwd', 'env', 'shell', 'stdout', 'stderr', 'output', 'root', 'profile', 'profileId']) {
    const res = await call(rt, 'POST', `${BRIDGE_PROJECTS_PATH}/cli-bridge/verification/confirm`, { confirm: true, [field]: 'hack' });
    assert.equal(res.statusCode, 400, `should reject ${field} override`);
    assert.ok(res.payload.message.includes(field), `message should mention ${field}`);
  }
});

test('v2.13: POST /verification/confirm no-spawn when no project workspace root', async () => {
  const rt = makeVerifyRuntime({ root: {} }); // no root for cli-bridge
  await call(rt, 'PATCH', `${BRIDGE_PROJECTS_PATH}/cli-bridge`, { verifyProfileId: 'ut' });
  const res = await call(rt, 'POST', `${BRIDGE_PROJECTS_PATH}/cli-bridge/verification/confirm`, { confirm: true });
  assert.equal(res.statusCode, 409);
  assert.ok(res.payload.message?.includes('workspace root') || res.payload.message?.includes('root') || res.payload.message?.includes('workspace'));
  assert.equal(rt.__spawnCalls.length, 0, 'no spawn when no project workspace root');
});

test('v2.13: POST /verification/confirm no-spawn with baselineRoot when no project workspace root (no fallback)', async () => {
  const rt = makeVerifyRuntime({ root: {}, baselineRoot: '/tmp/baseline' }); // baselineRoot exists but not projectWorkspaceRoots
  await call(rt, 'PATCH', `${BRIDGE_PROJECTS_PATH}/cli-bridge`, { verifyProfileId: 'ut' });
  const res = await call(rt, 'POST', `${BRIDGE_PROJECTS_PATH}/cli-bridge/verification/confirm`, { confirm: true });
  assert.equal(res.statusCode, 409); // no baselineRoot fallback
  assert.equal(rt.__spawnCalls.length, 0, 'no spawn and no baselineRoot fallback');
});
