// Phase B Project aggregation endpoint tests (Task 14).
//
// These endpoints are read-only projections over existing stores. They must
// group records by projectId/default-project backfill without adding mutation
// authority or weakening existing gates.

import assert from 'node:assert/strict';
import test from 'node:test';

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

async function call(runtime, method, path, body) {
  return handleBridgeRequest(runtime, method, path, jsonRequest(body));
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
  assert.equal(res.payload.status.latestAudit, null);
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
  assert.ok(alpha.payload.auditEvents.every((event) => event.sessionId === 's-alpha'));
  assert.ok(beta.payload.auditEvents.every((event) => event.sessionId === 's-beta'));
});

test('GET /bridge/projects/:key returns 404 for unknown projects with no records', async () => {
  const runtime = createBridgeRuntime();

  const res = await call(runtime, 'GET', `${BRIDGE_PROJECTS_PATH}/does-not-exist`);

  assert.equal(res.statusCode, 404);
  assert.equal(res.payload.status, 'error');
});

test('project aggregation endpoints are read-only and reject POST', async () => {
  const runtime = createBridgeRuntime();

  const listPost = await call(runtime, 'POST', BRIDGE_PROJECTS_PATH, { projectId: 'new' });
  const detailPost = await call(runtime, 'POST', `${BRIDGE_PROJECTS_PATH}/alpha`, { label: 'Alpha' });

  assert.equal(listPost.statusCode, 405);
  assert.equal(detailPost.statusCode, 405);
});
