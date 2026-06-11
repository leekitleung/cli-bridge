// v2.2 WorkBuddy Non-Executing Task System API tests.
//
// Covers POST /bridge/projects/:key/workbuddy with action multiplexing,
// project isolation, archived guards, forbidden fields, and GET project view.

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BRIDGE_PROJECTS_PATH,
  createBridgeRuntime,
  handleBridgeRequest,
} from '../apps/local-server/src/routes/bridge-api.ts';

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

const WB = BRIDGE_PROJECTS_PATH + '/alpha/workbuddy';

// ════════════════════════════════════════════════════════════════════
// POST record-task
// ═══���════════════════════════════════════════════════════════════════

test('POST /bridge/projects/:key/workbuddy records a task reference', async () => {
  const runtime = createBridgeRuntime();
  runtime.projectStore.upsert({ key: 'alpha' });
  const res = await call(runtime, 'POST', WB, {
    action: 'record-task',
    id: 'task-1',
    title: 'Fix auth bug',
    status: 'open',
    createdAt: 100,
    updatedAt: 200,
  });
  assert.equal(res.statusCode, 201);
  assert.equal(res.payload.task.title, 'Fix auth bug');
  assert.equal(res.payload.task.status, 'open');

  // Verify GET returns the task.
  const getRes = await call(runtime, 'GET', WB);
  assert.equal(getRes.statusCode, 200);
  assert.equal(getRes.payload.tasks.length, 1);
  assert.equal(getRes.payload.tasks[0].title, 'Fix auth bug');
});

test('POST rejects unknown action', async () => {
  const runtime = createBridgeRuntime();
  runtime.projectStore.upsert({ key: 'alpha' });
  const res = await call(runtime, 'POST', WB, { action: 'execute-task', id: 'x' });
  assert.equal(res.statusCode, 400);
});

test('POST rejects missing action', async () => {
  const runtime = createBridgeRuntime();
  runtime.projectStore.upsert({ key: 'alpha' });
  const res = await call(runtime, 'POST', WB, { id: 'x', title: 'test' });
  assert.equal(res.statusCode, 400);
});

// ════════════════════════════════════════════════════════════════════
// Project isolation
// ════════════════════════════════════════════════════════════════════

test('alpha WorkBuddy tasks not visible in beta GET', async () => {
  const runtime = createBridgeRuntime();
  runtime.projectStore.upsert({ key: 'alpha' });
  runtime.projectStore.upsert({ key: 'beta' });

  await call(runtime, 'POST', WB, {
    action: 'record-task', id: 'at-1', title: 'Alpha task', status: 'open', createdAt: 1, updatedAt: 2,
  });

  const betaRes = await call(runtime, 'GET', BRIDGE_PROJECTS_PATH + '/beta/workbuddy');
  assert.equal(betaRes.statusCode, 200);
  assert.equal(betaRes.payload.tasks.length, 0, 'beta must not see alpha tasks');
});

// ════════════════════════════════════════════════════════════════════
// Archived project
// ════════════════════════════════════════════════════════════════════

test('archived project GET workbuddy allowed, POST rejected', async () => {
  const runtime = createBridgeRuntime();
  runtime.projectStore.upsert({ key: 'arch-wb' });
  runtime.projectStore.archive('arch-wb');
  const archWb = BRIDGE_PROJECTS_PATH + '/arch-wb/workbuddy';

  const getRes = await call(runtime, 'GET', archWb);
  assert.equal(getRes.statusCode, 200);

  const postRes = await call(runtime, 'POST', archWb, {
    action: 'record-task', id: 'at', title: 'Archived', status: 'open', createdAt: 1, updatedAt: 2,
  });
  assert.equal(postRes.statusCode, 409);
});

// ════════════════════════════════════════════════════════════════════
// body.projectId mismatch
// ════════════════════════════════════════════════════════════════════

test('POST rejects body.projectId mismatch with URL key', async () => {
  const runtime = createBridgeRuntime();
  runtime.projectStore.upsert({ key: 'alpha' });
  const res = await call(runtime, 'POST', WB, {
    action: 'record-task', projectId: 'beta', id: 't', title: 'X', status: 'open', createdAt: 1, updatedAt: 2,
  });
  assert.equal(res.statusCode, 400);
  assert.ok(res.payload.message.includes('projectId'));
});

// ════════════════════════════════════════════════════════════════════
// Unknown project
// ════════════════════════════════════════════════════════════════════

test('POST workbuddy to unknown project returns 404', async () => {
  const runtime = createBridgeRuntime();
  const res = await call(runtime, 'POST', BRIDGE_PROJECTS_PATH + '/unknown/workbuddy', {
    action: 'record-task', id: 't', title: 'X', status: 'open', createdAt: 1, updatedAt: 2,
  });
  assert.equal(res.statusCode, 404);
});

// ════════════════════════════════════════════════════════════════════
// review result sink / prompt draft sink / ledger
// ════════════════════════════════════════════════════════════════════

test('record-review-result creates a review result sink', async () => {
  const runtime = createBridgeRuntime();
  runtime.projectStore.upsert({ key: 'alpha' });
  const res = await call(runtime, 'POST', WB, {
    action: 'record-review-result',
    id: 'rr-1',
    reviewResultId: 'rev-1',
    summary: 'All clear',
    findings: ['no issues'],
    createdAt: 1,
  });
  assert.equal(res.statusCode, 201);
  assert.equal(res.payload.reviewResultSink.summary, 'All clear');
});

test('record-prompt-draft creates a draft sink (never confirmed)', async () => {
  const runtime = createBridgeRuntime();
  runtime.projectStore.upsert({ key: 'alpha' });
  const res = await call(runtime, 'POST', WB, {
    action: 'record-prompt-draft',
    id: 'pd-1',
    promptDraft: 'Consider using Redis',
    createdAt: 1,
  });
  assert.equal(res.statusCode, 201);
  assert.equal(res.payload.promptDraftSink.status, 'draft');
  assert.equal(res.payload.promptDraftSink.promptDraft, 'Consider using Redis');
});

test('record-ledger creates an execution ledger event', async () => {
  const runtime = createBridgeRuntime();
  runtime.projectStore.upsert({ key: 'alpha' });
  const res = await call(runtime, 'POST', WB, {
    action: 'record-ledger',
    id: 'le-1',
    kind: 'external-status-recorded',
    summary: 'Manual delivery to staging complete',
    createdAt: 1,
  });
  assert.equal(res.statusCode, 201);
  assert.equal(res.payload.executionLedgerEvent.kind, 'external-status-recorded');
});

// ════════════════════════════════════════════════════════════════════
// All types visible in GET
// ════════════════════════════════════════════════════════════════════

test('GET workbuddy returns all record types scoped to project', async () => {
  const runtime = createBridgeRuntime();
  runtime.projectStore.upsert({ key: 'alpha' });
  await call(runtime, 'POST', WB, { action: 'record-task', id: 't1', title: 'T1', status: 'done', createdAt: 1, updatedAt: 2 });
  await call(runtime, 'POST', WB, { action: 'record-review-result', id: 'r1', reviewResultId: 'rev', summary: 'OK', findings: [], createdAt: 1 });
  await call(runtime, 'POST', WB, { action: 'record-prompt-draft', id: 'p1', promptDraft: 'Draft', createdAt: 1 });
  await call(runtime, 'POST', WB, { action: 'record-ledger', id: 'l1', kind: 'manual-delivery-recorded', summary: 'Done', createdAt: 1 });

  const getRes = await call(runtime, 'GET', WB);
  assert.equal(getRes.statusCode, 200);
  assert.equal(getRes.payload.tasks.length, 1);
  assert.equal(getRes.payload.reviewResultSinks.length, 1);
  assert.equal(getRes.payload.promptDraftSinks.length, 1);
  assert.equal(getRes.payload.executionLedgerEvents.length, 1);
});

// ════════════════════════════════════════════════════════════════════
// Non-GET/POST methods
// ════════════════════════════════════════════════════════════════════

test('PATCH/DELETE workbuddy returns 405', async () => {
  const runtime = createBridgeRuntime();
  runtime.projectStore.upsert({ key: 'alpha' });
  const res1 = await call(runtime, 'PATCH', WB);
  const res2 = await call(runtime, 'DELETE', WB);
  assert.equal(res1.statusCode, 405);
  assert.equal(res2.statusCode, 405);
});
