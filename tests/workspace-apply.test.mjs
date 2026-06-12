// v2.5 Workspace apply test suite — Approach A (scratch dir, no git)
//
// ADR-0008 acceptance conditions:
// 1. Path containment
// 2. Main tree untouched
// 3. Per-apply human gate
// 4. Reversibility (discard)
// 5. Fail-closed
// 6. No VCS / no spawn
// 7. Typed audit metadata
// 8. Opt-in default OFF

import assert from 'node:assert/strict';
import test from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  BRIDGE_PROJECTS_PATH,
  createBridgeRuntime,
  handleBridgeRequest,
} from '../apps/local-server/src/routes/bridge-api.ts';
import { WorkspaceApplyStore, validateAllPaths } from '../apps/local-server/src/storage/workspace-apply-store.ts';

// ── Helpers ──────────────────────────────────────────────────────

const TEST_APPLY_ROOT = path.join(process.env.TEMP ?? process.env.TMPDIR ?? '/tmp', 'cli-bridge-apply-test-' + randomUUID());

function cleanTestRoot() {
  try { fs.rmSync(TEST_APPLY_ROOT, { recursive: true, force: true }); } catch {}
}

function jsonRequest(body) {
  const text = body === undefined ? '' : JSON.stringify(body);
  async function* gen() {
    if (text.length > 0) yield Buffer.from(text, 'utf8');
  }
  return gen();
}

async function call(runtime, method, pathStr, body) {
  return handleBridgeRequest(runtime, method, pathStr, jsonRequest(body));
}

const TEAMS = (key) => BRIDGE_PROJECTS_PATH + '/' + key + '/teams';

async function seedTeam(runtime, projectKey) {
  const goal = runtime.goalStore.createGoal({ sessionId: 'seed', description: 'Apply test', projectId: projectKey });
  const plan = runtime.goalStore.attachPlan({
    goalId: goal.id,
    steps: [
      { intent: 'Plan', kind: 'review', tier: 'patch-proposal', isStateMutating: false, targetEndpointId: 'claude-code-command' },
    ],
    permittedTiers: ['patch-proposal'],
  });
  if (!plan) throw new Error('plan failed');
  runtime.goalStore.approvePlan(goal.id);
  await call(runtime, 'POST', TEAMS(projectKey), {
    action: 'create', id: 't-apply-' + randomUUID().slice(0, 8),
    goalId: goal.id, planId: plan.id,
    logicalSlots: [{ id: 's0', role: 'planner', stepIndex: 0, tier: 'patch-proposal', isolation: 'patch-only' }],
    maxConcurrentBridgeSlots: 1, mode: 'sequential', isolation: 'patch-only',
    provider: 'claude', endpointId: 'claude-code-command',
  });
  const teams = runtime.teamStore.listByProject(projectKey);
  const team = teams[teams.length - 1];
  assert.ok(team);
  await call(runtime, 'POST', TEAMS(projectKey) + '/' + team.id + '/approve');
  // Record a clean artifact with known proposedFiles.
  runtime.teamStore.recordArtifact(team.id, {
    teamId: team.id, slotId: 's0', planStepId: plan.steps[0].id,
    summary: 'test artifact', proposedFiles: ['src/app.ts', 'src/lib.ts'],
    outputRedacted: true, createdAt: Date.now(),
  });
  return { team, plan };
}

// ── Path containment ─────────────────────────────────────────────

test('path containment: rejects ../ traversal', () => {
  assert.equal(validateAllPaths(['src/../etc/passwd']), null);
  assert.equal(validateAllPaths(['../../../etc/passwd']), null);
  assert.equal(validateAllPaths(['src/ok.ts', '../../bad.ts']), null);
});

test('path containment: rejects absolute paths', () => {
  assert.equal(validateAllPaths(['/etc/passwd']), null);
});

test('path containment: rejects backslash escapes', () => {
  assert.equal(validateAllPaths(['src\\..\\..\\etc']), null);
  assert.equal(validateAllPaths(['src\\\\..\\\\etc']), null);
});

test('path containment: rejects empty / null paths', () => {
  assert.equal(validateAllPaths(['']), null);
  assert.equal(validateAllPaths(['src/good.ts', '']), null);
});

test('path containment: accepts valid relative paths', () => {
  const result = validateAllPaths(['src/app.ts', 'src/lib.ts', 'tests/test.ts']);
  assert.ok(result);
  assert.deepEqual(result, ['src/app.ts', 'src/lib.ts', 'tests/test.ts']);
});

// ── Opt-in default OFF (ADR-0008 AC 8) ───────────────────────────

test('opt-in default OFF: apply rejected when flag is false', async () => {
  const runtime = createBridgeRuntime({ applyRoot: TEST_APPLY_ROOT });
  runtime.projectStore.upsert({ key: 'alpha', label: 'Alpha' });

  const res = await call(runtime, 'POST', TEAMS('alpha') + '/t-nonexistent/apply-requests', {});
  assert.equal(res.statusCode, 409);
  assert.ok(res.payload.message.includes('not enabled') || res.payload.message.includes('Workspace apply'));
});

test('opt-in default OFF: non-apply flows unaffected', async () => {
  const runtime = createBridgeRuntime({ applyRoot: TEST_APPLY_ROOT });
  runtime.projectStore.upsert({ key: 'alpha', label: 'Alpha' });
  const goal = runtime.goalStore.createGoal({ sessionId: 'test', description: 'Normal goal', projectId: 'alpha' });
  assert.ok(goal);
  // Standard goal operations still work.
  const res = await call(runtime, 'GET', TEAMS('alpha'));
  assert.equal(res.statusCode, 200);
});

// ── Apply lifecycle + gate (ADR-0008 AC 3) ────────────────────

test('apply gate: create pending, confirm writes, gate required', async () => {
  cleanTestRoot();
  const runtime = createBridgeRuntime({ applyRoot: TEST_APPLY_ROOT });
  runtime.projectStore.upsert({ key: 'alpha', label: 'Alpha', workspaceApplyEnabled: true });
  const { team, plan } = await seedTeam(runtime, 'alpha');
  const stepId = plan.steps[0].id;

  // Create apply request (pending, no write).
  let res = await call(runtime, 'POST', TEAMS('alpha') + '/' + team.id + '/apply-requests', {
    slotId: 's0', planStepId: stepId, proposedFiles: ['src/app.ts', 'src/lib.ts'],
  });
  assert.equal(res.statusCode, 201);
  assert.equal(res.payload.apply.status, 'pending');
  const applyId = res.payload.apply.applyId;

  // Confirm without confirmed:true — must fail.
  res = await call(runtime, 'POST', TEAMS('alpha') + '/' + team.id + '/apply-requests/' + applyId + '/confirm', {
    files: { 'src/app.ts': '// app' },
  });
  assert.equal(res.statusCode, 400);

  // Confirm with correct gate.
  res = await call(runtime, 'POST', TEAMS('alpha') + '/' + team.id + '/apply-requests/' + applyId + '/confirm', {
    confirmed: true,
    files: { 'src/app.ts': '// app content', 'src/lib.ts': '// lib content' },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.apply.status, 'applied');
  assert.ok(res.payload.apply.isolatedDirPath);
});

// ── Main tree untouched (ADR-0008 AC 2) ─────────────────────────

test('main tree untouched: apply writes only to isolated dir', async () => {
  cleanTestRoot();
  const runtime = createBridgeRuntime({ applyRoot: TEST_APPLY_ROOT });
  runtime.projectStore.upsert({ key: 'alpha', label: 'Alpha', workspaceApplyEnabled: true });
  const { team, plan } = await seedTeam(runtime, 'alpha');
  const stepId = plan.steps[0].id;

  let res = await call(runtime, 'POST', TEAMS('alpha') + '/' + team.id + '/apply-requests', {
    slotId: 's0', planStepId: stepId, proposedFiles: ['src/app.ts'],
  });
  const applyId = res.payload.apply.applyId;

  res = await call(runtime, 'POST', TEAMS('alpha') + '/' + team.id + '/apply-requests/' + applyId + '/confirm', {
    confirmed: true, files: { 'src/app.ts': '// app' },
  });
  assert.equal(res.statusCode, 200);
  const isoDir = res.payload.apply.isolatedDirPath;
  assert.ok(isoDir);
  // Isolated dir must be INSIDE apply root, NOT the repo root.
  assert.ok(isoDir.startsWith(TEST_APPLY_ROOT));
  // Main project tree must be unaffected — the isolated dir must not be inside the repo.
  assert.ok(!isoDir.startsWith(process.cwd()), 'isolated dir must not be inside the repository');
});

// ── Reversibility (ADR-0008 AC 4) ───────────────────────────────

test('discard: reversible, isolated dir cleaned', async () => {
  cleanTestRoot();
  const runtime = createBridgeRuntime({ applyRoot: TEST_APPLY_ROOT });
  runtime.projectStore.upsert({ key: 'alpha', label: 'Alpha', workspaceApplyEnabled: true });
  const { team, plan } = await seedTeam(runtime, 'alpha');
  const stepId = plan.steps[0].id;

  let res = await call(runtime, 'POST', TEAMS('alpha') + '/' + team.id + '/apply-requests', {
    slotId: 's0', planStepId: stepId, proposedFiles: ['src/app.ts'],
  });
  const applyId = res.payload.apply.applyId;
  const confirmRes = await call(runtime, 'POST', TEAMS('alpha') + '/' + team.id + '/apply-requests/' + applyId + '/confirm', {
    confirmed: true, files: { 'src/app.ts': '// app' },
  });
  const appliedDir = confirmRes.payload.apply.isolatedDirPath;
  assert.ok(fs.existsSync(appliedDir), 'isolated dir should exist after apply');

  res = await call(runtime, 'POST', TEAMS('alpha') + '/' + team.id + '/apply-requests/' + applyId + '/discard');
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.apply.status, 'discarded');
  assert.equal(fs.existsSync(appliedDir), false, 'isolated dir should be removed after discard');
});

// ── Fail-closed (ADR-0008 AC 5) ──────────────────────────────────

test('fail-closed: file list mismatch, no partial write', async () => {
  cleanTestRoot();
  const runtime = createBridgeRuntime({ applyRoot: TEST_APPLY_ROOT });
  runtime.projectStore.upsert({ key: 'alpha', label: 'Alpha', workspaceApplyEnabled: true });
  const { team, plan } = await seedTeam(runtime, 'alpha');
  const stepId = plan.steps[0].id;

  // Create request with many proposedFiles.
  const manyFiles = Array.from({ length: 10 }, (_, i) => 'src/file' + i + '.ts');
  let res = await call(runtime, 'POST', TEAMS('alpha') + '/' + team.id + '/apply-requests', {
    slotId: 's0', planStepId: stepId, proposedFiles: manyFiles,
  });
  const applyId = res.payload.apply.applyId;

  // Confirm with files exceeding default cap (200 is fine for 10 files).
  // But test mismatch: confirm with files NOT in proposedFiles.
  res = await call(runtime, 'POST', TEAMS('alpha') + '/' + team.id + '/apply-requests/' + applyId + '/confirm', {
    confirmed: true, files: { 'src/other.ts': '// bad' },
  });
  assert.equal(res.statusCode, 409);
  assert.ok(res.payload.message.includes('not in artifact proposedFiles') || res.payload.message.includes('not match'));
});

test('fail-closed: path escape rejected', async () => {
  cleanTestRoot();
  const runtime = createBridgeRuntime({ applyRoot: TEST_APPLY_ROOT });
  runtime.projectStore.upsert({ key: 'alpha', label: 'Alpha', workspaceApplyEnabled: true });
  const { team, plan } = await seedTeam(runtime, 'alpha');
  const stepId = plan.steps[0].id;

  let res = await call(runtime, 'POST', TEAMS('alpha') + '/' + team.id + '/apply-requests', {
    slotId: 's0', planStepId: stepId, proposedFiles: ['../etc/passwd'],
  });
  const applyId = res.payload.apply.applyId;

  res = await call(runtime, 'POST', TEAMS('alpha') + '/' + team.id + '/apply-requests/' + applyId + '/confirm', {
    confirmed: true, files: { '../etc/passwd': '// bad' },
  });
  assert.equal(res.statusCode, 409);
  assert.ok(res.payload.message.includes('containment') || res.payload.message.includes('invalid'));
});

test('fail-closed: disable mid-flight → write still rejected (flag checked at confirm too)', async () => {
  cleanTestRoot();
  const runtime = createBridgeRuntime({ applyRoot: TEST_APPLY_ROOT });
  runtime.projectStore.upsert({ key: 'alpha', label: 'Alpha', workspaceApplyEnabled: true });
  const { team, plan } = await seedTeam(runtime, 'alpha');
  const stepId = plan.steps[0].id;

  let res = await call(runtime, 'POST', TEAMS('alpha') + '/' + team.id + '/apply-requests', {
    slotId: 's0', planStepId: stepId, proposedFiles: ['src/app.ts'],
  });
  const applyId = res.payload.apply.applyId;

  // Disable apply.
  runtime.projectStore.upsert({ key: 'alpha', workspaceApplyEnabled: false });

  res = await call(runtime, 'POST', TEAMS('alpha') + '/' + team.id + '/apply-requests/' + applyId + '/confirm', {
    confirmed: true, files: { 'src/app.ts': '// app' },
  });
  assert.equal(res.statusCode, 409);
});

// ── Audit metadata (ADR-0008 AC 7) ──────────────────────────────

test('audit: workspace_apply_request/result with typed metadata, no raw content', async () => {
  cleanTestRoot();
  const runtime = createBridgeRuntime({ applyRoot: TEST_APPLY_ROOT });
  runtime.projectStore.upsert({ key: 'alpha', label: 'Alpha', workspaceApplyEnabled: true });
  const { team, plan } = await seedTeam(runtime, 'alpha');
  const stepId = plan.steps[0].id;

  let res = await call(runtime, 'POST', TEAMS('alpha') + '/' + team.id + '/apply-requests', {
    slotId: 's0', planStepId: stepId, proposedFiles: ['src/app.ts'],
  });
  const applyId = res.payload.apply.applyId;

  await call(runtime, 'POST', TEAMS('alpha') + '/' + team.id + '/apply-requests/' + applyId + '/confirm', {
    confirmed: true, files: { 'src/app.ts': 'console.log("secret")' },
  });

  const events = runtime.auditLog.exportEvents();
  const req = events.find(e => e.type === 'workspace_apply_request');
  const result = events.find(e => e.type === 'workspace_apply_result' && e.sessionId.includes('apply-result-'));

  assert.ok(req, 'workspace_apply_request audit should exist');
  assert.ok(result, 'workspace_apply_result audit should exist');

  // Request metadata.
  assert.ok(req.result.metadata);
  assert.equal(req.result.metadata.applyId, applyId);
  assert.equal(req.result.metadata.status, 'pending');
  assert.deepEqual(req.result.metadata.fileList, ['src/app.ts']);

  // Result metadata.
  assert.ok(result.result.metadata);
  assert.equal(result.result.metadata.status, 'applied');
  assert.ok(result.result.metadata.isolatedDirId);

  // No raw file content in audit.
  const allJson = JSON.stringify(events);
  assert.equal(allJson.includes('console.log("secret")'), false, 'raw file content must not be in audit');
  assert.equal(allJson.includes('// app content'), false, 'raw file content must not be in audit');
});

// ── No VCS / no spawn (ADR-0008 AC 6) ───────────────────────────

test('no VCS/spawn: source check — no child_process/git in store or route', () => {
  for (const filePath of [
    'apps/local-server/src/storage/workspace-apply-store.ts',
    'apps/local-server/src/routes/bridge-api.ts',
  ]) {
    const source = fs.readFileSync(filePath, 'utf8');
    assert.equal(source.includes("'child_process'"), false, `${filePath}: no 'child_process'`);
    assert.equal(source.includes('"child_process"'), false, `${filePath}: no "child_process"`);
    assert.equal(source.includes('node:child_process'), false, `${filePath}: no node:child_process`);
    assert.equal(source.includes('spawn('), false, `${filePath}: no spawn(`);
    assert.equal(source.includes('execFile('), false, `${filePath}: no execFile(`);
    assert.equal(source.includes('git apply'), false, `${filePath}: no git apply`);
    assert.equal(source.includes('git worktree'), false, `${filePath}: no git worktree`);
  }
});

// ── GET list ──────────────────────────────────────────────────────

test('GET apply-requests: lists project/team scoped records, no raw content', async () => {
  cleanTestRoot();
  const runtime = createBridgeRuntime({ applyRoot: TEST_APPLY_ROOT });
  runtime.projectStore.upsert({ key: 'alpha', label: 'Alpha', workspaceApplyEnabled: true });
  const { team, plan } = await seedTeam(runtime, 'alpha');
  const stepId = plan.steps[0].id;

  await call(runtime, 'POST', TEAMS('alpha') + '/' + team.id + '/apply-requests', {
    slotId: 's0', planStepId: stepId, proposedFiles: ['src/app.ts'],
  });

  const res = await call(runtime, 'GET', TEAMS('alpha') + '/' + team.id + '/apply-requests');
  assert.equal(res.statusCode, 200);
  assert.ok(Array.isArray(res.payload.applies));
  assert.equal(res.payload.applies.length, 1);
  // List must not include raw file content.
  const listJson = JSON.stringify(res.payload);
  assert.equal(listJson.includes('fileContent'), false);
});

// ── Conflict gate ─────────────────────────────────────────────────

test('conflict gate: apply rejected when team has conflicts', async () => {
  cleanTestRoot();
  const runtime = createBridgeRuntime({ applyRoot: TEST_APPLY_ROOT });
  runtime.projectStore.upsert({ key: 'alpha', label: 'Alpha', workspaceApplyEnabled: true });
  const { team, plan } = await seedTeam(runtime, 'alpha');
  const stepId = plan.steps[0].id;

  // Create a conflicting artifact in the same team.
  runtime.teamStore.recordArtifact(team.id, {
    teamId: team.id, slotId: 's1', planStepId: plan.steps[0].id,
    summary: 'conflict', proposedFiles: ['src/app.ts'], // same file
    outputRedacted: true, createdAt: Date.now(),
  });

  const res = await call(runtime, 'POST', TEAMS('alpha') + '/' + team.id + '/apply-requests', {
    slotId: 's0', planStepId: stepId, proposedFiles: ['src/app.ts'],
  });
  assert.equal(res.statusCode, 409);
  assert.ok(res.payload.message.includes('conflict'));
});

// ── PATCH project workspaceApplyEnabled ──────────────────────────

test('PATCH project: workspaceApplyEnabled flag persists and defaults false', async () => {
  const runtime = createBridgeRuntime();
  runtime.projectStore.upsert({ key: 'alpha', label: 'Alpha' });
  // Check default is false.
  const proj = runtime.projectStore.get('alpha');
  assert.equal(proj.workspaceApplyEnabled, false);

  // Enable via PATCH.
  await call(runtime, 'PATCH', BRIDGE_PROJECTS_PATH + '/alpha', { workspaceApplyEnabled: true });
  const updated = runtime.projectStore.get('alpha');
  assert.equal(updated.workspaceApplyEnabled, true);

  // Disable.
  await call(runtime, 'PATCH', BRIDGE_PROJECTS_PATH + '/alpha', { workspaceApplyEnabled: false });
  const disabled = runtime.projectStore.get('alpha');
  assert.equal(disabled.workspaceApplyEnabled, false);
});

// ── N2: non-string file content → clean failure ──────────────────

test('fail-closed: non-string file content returns clean error, no write', async () => {
  cleanTestRoot();
  const runtime = createBridgeRuntime({ applyRoot: TEST_APPLY_ROOT });
  runtime.projectStore.upsert({ key: 'alpha', label: 'Alpha', workspaceApplyEnabled: true });
  const { team, plan } = await seedTeam(runtime, 'alpha');
  const stepId = plan.steps[0].id;

  let res = await call(runtime, 'POST', TEAMS('alpha') + '/' + team.id + '/apply-requests', {
    slotId: 's0', planStepId: stepId, proposedFiles: ['src/app.ts'],
  });
  const applyId = res.payload.apply.applyId;

  res = await call(runtime, 'POST', TEAMS('alpha') + '/' + team.id + '/apply-requests/' + applyId + '/confirm', {
    confirmed: true, files: { 'src/app.ts': 12345 },
  });
  assert.ok(res.statusCode === 400 || res.statusCode === 409, 'should be 400 or 409, not 500');
  assert.ok(res.payload.message.includes('content') || res.payload.message.includes('string'), 'error should mention content type');
  const req = runtime.applyStore.getRequest(applyId);
  assert.equal(req.status, 'pending', 'status should remain pending after non-string content reject');
});

// ── N3: real caps exceed tests ──────────────────────────────────

test('fail-closed: maxFiles cap exceeded, no write', async () => {
  cleanTestRoot();
  const runtime = createBridgeRuntime({ applyRoot: TEST_APPLY_ROOT });
  runtime.projectStore.upsert({ key: 'alpha', label: 'Alpha', workspaceApplyEnabled: true });
  const { team, plan } = await seedTeam(runtime, 'alpha');
  const stepId = plan.steps[0].id;

  const files = ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts'];
  let res = await call(runtime, 'POST', TEAMS('alpha') + '/' + team.id + '/apply-requests', {
    slotId: 's0', planStepId: stepId, proposedFiles: files,
  });
  const applyId = res.payload.apply.applyId;
  runtime.applyStore.getRequest(applyId).caps = { maxFiles: 3, maxTotalBytes: 5 * 1024 * 1024 };

  const confirmFiles = {};
  for (const f of files) confirmFiles[f] = '// ' + f;
  res = await call(runtime, 'POST', TEAMS('alpha') + '/' + team.id + '/apply-requests/' + applyId + '/confirm', {
    confirmed: true, files: confirmFiles,
  });
  assert.equal(res.statusCode, 409);
  assert.ok(res.payload.message.includes('exceeds') || res.payload.message.includes('File count'));
});

test('fail-closed: maxTotalBytes cap exceeded, no write', async () => {
  cleanTestRoot();
  const runtime = createBridgeRuntime({ applyRoot: TEST_APPLY_ROOT });
  runtime.projectStore.upsert({ key: 'alpha', label: 'Alpha', workspaceApplyEnabled: true });
  const { team, plan } = await seedTeam(runtime, 'alpha');
  const stepId = plan.steps[0].id;

  let res = await call(runtime, 'POST', TEAMS('alpha') + '/' + team.id + '/apply-requests', {
    slotId: 's0', planStepId: stepId, proposedFiles: ['src/app.ts', 'src/lib.ts'],
  });
  const applyId = res.payload.apply.applyId;
  runtime.applyStore.getRequest(applyId).caps = { maxFiles: 200, maxTotalBytes: 10 };

  res = await call(runtime, 'POST', TEAMS('alpha') + '/' + team.id + '/apply-requests/' + applyId + '/confirm', {
    confirmed: true, files: { 'src/app.ts': '01234567890', 'src/lib.ts': '01234567890' },
  });
  assert.equal(res.statusCode, 409);
  assert.ok(res.payload.message.includes('exceeds') || res.payload.message.includes('size'));
});

// ══════════════════════════════════════════════════════════════════
// v2.5 ADR-0010: Pre-apply baseline manifest capture tests
// ══════════════════════════════════════════════════════════════════

// Helpers for baseline tests: create test files under a trusted root.
function createBaselineRoot() {
  const root = path.join(process.env.TEMP ?? process.env.TMPDIR ?? '/tmp', 'cli-bridge-baseline-' + randomUUID());
  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'app.ts'), '// app baseline', 'utf8');
  fs.writeFileSync(path.join(root, 'src', 'lib.ts'), '// lib baseline', 'utf8');
  return root;
}

function cleanBaselineRoot(root) {
  try { fs.rmSync(root, { recursive: true, force: true }); } catch {}
}

// ── AC1: Trusted root only ───────────────────────────────────────

test('ADR-0010 AC1: baseline root comes only from runtime option, not request', async () => {
  const baselineRoot = createBaselineRoot();
  cleanTestRoot();
  const runtime = createBridgeRuntime({ applyRoot: TEST_APPLY_ROOT, baselineRoot, baselineCaptureEnabled: true });
  runtime.projectStore.upsert({ key: 'alpha', label: 'Alpha', workspaceApplyEnabled: true });
  const { team, plan } = await seedTeam(runtime, 'alpha');
  const stepId = plan.steps[0].id;

  let res = await call(runtime, 'POST', TEAMS('alpha') + '/' + team.id + '/apply-requests', {
    slotId: 's0', planStepId: stepId, proposedFiles: ['src/app.ts', 'src/lib.ts'],
  });
  const applyId = res.payload.apply.applyId;
  res = await call(runtime, 'POST', TEAMS('alpha') + '/' + team.id + '/apply-requests/' + applyId + '/confirm', {
    confirmed: true, files: { 'src/app.ts': '// new', 'src/lib.ts': '// new' },
  });
  assert.equal(res.statusCode, 200);
  const req = runtime.applyStore.getRequest(applyId);
  assert.ok(req.baselineManifest, 'baseline manifest should be captured');
  assert.equal(req.baselineManifest.rootRef, 'runtime-baseline-root');
  assert.equal(req.baselineManifest.fileCount, 2);
  assert.equal(req.baselineManifest.readableCount, 2);
  // Audit must not contain absolute baselineRoot.
  const allEvents = JSON.stringify(runtime.auditLog.exportEvents());
  assert.equal(allEvents.includes(baselineRoot), false, 'absolute baselineRoot must not leak to audit');

  cleanBaselineRoot(baselineRoot);
});

// ── AC2: Separate opt-in, disabled by default ────────────────────

test('ADR-0010 AC2: default disabled, existing behavior unchanged', async () => {
  cleanTestRoot();
  const runtime = createBridgeRuntime({ applyRoot: TEST_APPLY_ROOT });
  runtime.projectStore.upsert({ key: 'alpha', label: 'Alpha', workspaceApplyEnabled: true });
  const { team, plan } = await seedTeam(runtime, 'alpha');
  const stepId = plan.steps[0].id;

  let res = await call(runtime, 'POST', TEAMS('alpha') + '/' + team.id + '/apply-requests', {
    slotId: 's0', planStepId: stepId, proposedFiles: ['src/app.ts'],
  });
  const applyId = res.payload.apply.applyId;
  res = await call(runtime, 'POST', TEAMS('alpha') + '/' + team.id + '/apply-requests/' + applyId + '/confirm', {
    confirmed: true, files: { 'src/app.ts': '// new' },
  });
  assert.equal(res.statusCode, 200);
  // No baseline manifest when disabled.
  const req = runtime.applyStore.getRequest(applyId);
  assert.equal(req.baselineManifest, undefined);
});

test('ADR-0010 AC2: enabled without trusted root fails closed before write', async () => {
  cleanTestRoot();
  const runtime = createBridgeRuntime({ applyRoot: TEST_APPLY_ROOT, baselineCaptureEnabled: true /* no baselineRoot */ });
  runtime.projectStore.upsert({ key: 'alpha', label: 'Alpha', workspaceApplyEnabled: true });
  const { team, plan } = await seedTeam(runtime, 'alpha');
  const stepId = plan.steps[0].id;

  let res = await call(runtime, 'POST', TEAMS('alpha') + '/' + team.id + '/apply-requests', {
    slotId: 's0', planStepId: stepId, proposedFiles: ['src/app.ts'],
  });
  const applyId = res.payload.apply.applyId;
  res = await call(runtime, 'POST', TEAMS('alpha') + '/' + team.id + '/apply-requests/' + applyId + '/confirm', {
    confirmed: true, files: { 'src/app.ts': '// new' },
  });
  assert.equal(res.statusCode, 409);
  assert.ok(res.payload.message.includes('no trusted root') || res.payload.message.includes('not configured'));
  // Status must remain pending (no write).
  assert.equal(runtime.applyStore.getRequest(applyId).status, 'pending');
});

// ── AC3: Metadata only, no raw content ───────────────────────────

test('ADR-0010 AC3: baseline manifest contains only metadata, no raw content', async () => {
  const baselineRoot = createBaselineRoot();
  cleanTestRoot();
  const runtime = createBridgeRuntime({ applyRoot: TEST_APPLY_ROOT, baselineRoot, baselineCaptureEnabled: true });
  runtime.projectStore.upsert({ key: 'alpha', label: 'Alpha', workspaceApplyEnabled: true });
  const { team, plan } = await seedTeam(runtime, 'alpha');
  const stepId = plan.steps[0].id;

  let res = await call(runtime, 'POST', TEAMS('alpha') + '/' + team.id + '/apply-requests', {
    slotId: 's0', planStepId: stepId, proposedFiles: ['src/app.ts', 'src/lib.ts'],
  });
  const applyId = res.payload.apply.applyId;
  res = await call(runtime, 'POST', TEAMS('alpha') + '/' + team.id + '/apply-requests/' + applyId + '/confirm', {
    confirmed: true, files: { 'src/app.ts': '// new', 'src/lib.ts': '// new' },
  });
  assert.equal(res.statusCode, 200);
  const m = runtime.applyStore.getRequest(applyId).baselineManifest;
  assert.ok(m);
  for (const entry of m.entries) {
    assert.ok(entry.path);
    assert.ok(typeof entry.exists === 'boolean');
    assert.ok(typeof entry.readable === 'boolean');
    // No raw content.
    assert.equal(entry.content, undefined, 'no raw content in baseline entry');
    assert.equal(entry.data, undefined, 'no raw data in baseline entry');
  }
  // No raw content in audit or response.
  const events = JSON.stringify(runtime.auditLog.exportEvents());
  assert.equal(events.includes('// app baseline'), false, 'no raw baseline content in audit');

  cleanBaselineRoot(baselineRoot);
});

// ── AC4: Containment ────────────────────────────────────────────

test('ADR-0010 AC4: path escape in baseline capture fails closed', async () => {
  const baselineRoot = createBaselineRoot();
  cleanTestRoot();
  const runtime = createBridgeRuntime({ applyRoot: TEST_APPLY_ROOT, baselineRoot, baselineCaptureEnabled: true });
  runtime.projectStore.upsert({ key: 'alpha', label: 'Alpha', workspaceApplyEnabled: true });
  const { team, plan } = await seedTeam(runtime, 'alpha');
  const stepId = plan.steps[0].id;

  let res = await call(runtime, 'POST', TEAMS('alpha') + '/' + team.id + '/apply-requests', {
    slotId: 's0', planStepId: stepId, proposedFiles: ['../etc/passwd', 'src/app.ts'],
  });
  const applyId = res.payload.apply.applyId;
  res = await call(runtime, 'POST', TEAMS('alpha') + '/' + team.id + '/apply-requests/' + applyId + '/confirm', {
    confirmed: true, files: { '../etc/passwd': '// bad', 'src/app.ts': '// new' },
  });
  // Fail-closed: no write.
  assert.equal(res.statusCode, 409);
  assert.equal(runtime.applyStore.getRequest(applyId).status, 'pending');

  cleanBaselineRoot(baselineRoot);
});

// ── AC5: Fail-closed before write ────────────────────────────────

test('ADR-0010 AC5: missing file records metadata, does not fail', async () => {
  const baselineRoot = createBaselineRoot();
  cleanTestRoot();
  const runtime = createBridgeRuntime({ applyRoot: TEST_APPLY_ROOT, baselineRoot, baselineCaptureEnabled: true });
  runtime.projectStore.upsert({ key: 'alpha', label: 'Alpha', workspaceApplyEnabled: true });
  const { team, plan } = await seedTeam(runtime, 'alpha');
  const stepId = plan.steps[0].id;

  let res = await call(runtime, 'POST', TEAMS('alpha') + '/' + team.id + '/apply-requests', {
    slotId: 's0', planStepId: stepId, proposedFiles: ['src/app.ts', 'src/newfile.ts', 'src/lib.ts'],
  });
  const applyId = res.payload.apply.applyId;
  res = await call(runtime, 'POST', TEAMS('alpha') + '/' + team.id + '/apply-requests/' + applyId + '/confirm', {
    confirmed: true, files: { 'src/app.ts': '// new', 'src/newfile.ts': '// new', 'src/lib.ts': '// new' },
  });
  // Missing proposed file is NOT a failure.
  assert.equal(res.statusCode, 200);
  const m = runtime.applyStore.getRequest(applyId).baselineManifest;
  const missing = m.entries.find(e => e.path === 'src/newfile.ts');
  assert.ok(missing);
  assert.equal(missing.exists, false);
  assert.equal(missing.readable, false);
  assert.equal(missing.errorKind, 'missing');
  assert.equal(m.missingCount, 1);

  cleanBaselineRoot(baselineRoot);
});

// ── AC6: Caps ────────────────────────────────────────────────────

test('ADR-0010 AC6: baseline byte cap exceeded fails closed', async () => {
  const baselineRoot = createBaselineRoot();
  cleanTestRoot();
  const runtime = createBridgeRuntime({
    applyRoot: TEST_APPLY_ROOT,
    baselineRoot,
    baselineCaptureEnabled: true,
    baselineCaps: { maxFiles: 200, maxTotalBytes: 10 },
  });
  runtime.projectStore.upsert({ key: 'alpha', label: 'Alpha', workspaceApplyEnabled: true });
  const { team, plan } = await seedTeam(runtime, 'alpha');
  const stepId = plan.steps[0].id;

  let res = await call(runtime, 'POST', TEAMS('alpha') + '/' + team.id + '/apply-requests', {
    slotId: 's0', planStepId: stepId, proposedFiles: ['src/app.ts', 'src/lib.ts'],
  });
  const applyId = res.payload.apply.applyId;
  res = await call(runtime, 'POST', TEAMS('alpha') + '/' + team.id + '/apply-requests/' + applyId + '/confirm', {
    confirmed: true, files: { 'src/app.ts': '// new', 'src/lib.ts': '// new' },
  });
  assert.equal(res.statusCode, 409);
  assert.ok(res.payload.message.includes('Baseline'));

  cleanBaselineRoot(baselineRoot);
});

// ── AC7: Audit metadata, no raw content / no absolute root ───────

test('ADR-0010 AC7: audit metadata has typed baseline info, no raw content', async () => {
  const baselineRoot = createBaselineRoot();
  cleanTestRoot();
  const runtime = createBridgeRuntime({ applyRoot: TEST_APPLY_ROOT, baselineRoot, baselineCaptureEnabled: true });
  runtime.projectStore.upsert({ key: 'alpha', label: 'Alpha', workspaceApplyEnabled: true });
  const { team, plan } = await seedTeam(runtime, 'alpha');
  const stepId = plan.steps[0].id;

  let res = await call(runtime, 'POST', TEAMS('alpha') + '/' + team.id + '/apply-requests', {
    slotId: 's0', planStepId: stepId, proposedFiles: ['src/app.ts'],
  });
  const applyId = res.payload.apply.applyId;
  await call(runtime, 'POST', TEAMS('alpha') + '/' + team.id + '/apply-requests/' + applyId + '/confirm', {
    confirmed: true, files: { 'src/app.ts': '// new' },
  });

  const events = runtime.auditLog.exportEvents();
  const resultEvent = events.find(e => e.type === 'workspace_apply_result');
  assert.ok(resultEvent);
  const meta = resultEvent.result.metadata;
  assert.ok(meta.baseline);
  assert.equal(meta.baseline.rootRef, 'runtime-baseline-root');
  assert.ok(typeof meta.baseline.readableCount === 'number');
  // No absolute root or raw content.
  const allJson = JSON.stringify(events);
  assert.equal(allJson.includes(baselineRoot), false, 'no absolute baselineRoot in audit');
  assert.equal(allJson.includes('// app baseline'), false, 'no raw baseline content in audit');

  cleanBaselineRoot(baselineRoot);
});

// ── AC8: No new presentation capability ─────────────────────────

test('ADR-0010 AC8: manifest exposes baseline summary only, no entries', async () => {
  const baselineRoot = createBaselineRoot();
  cleanTestRoot();
  const runtime = createBridgeRuntime({ applyRoot: TEST_APPLY_ROOT, baselineRoot, baselineCaptureEnabled: true });
  runtime.projectStore.upsert({ key: 'alpha', label: 'Alpha', workspaceApplyEnabled: true });
  const { team, plan } = await seedTeam(runtime, 'alpha');
  const stepId = plan.steps[0].id;

  let res = await call(runtime, 'POST', TEAMS('alpha') + '/' + team.id + '/apply-requests', {
    slotId: 's0', planStepId: stepId, proposedFiles: ['src/app.ts'],
  });
  const applyId = res.payload.apply.applyId;
  await call(runtime, 'POST', TEAMS('alpha') + '/' + team.id + '/apply-requests/' + applyId + '/confirm', {
    confirmed: true, files: { 'src/app.ts': '// new' },
  });

  res = await call(runtime, 'GET', TEAMS('alpha') + '/' + team.id + '/apply-requests/' + applyId);
  assert.equal(res.statusCode, 200);
  const manifest = res.payload.apply;
  assert.ok(manifest.baselineManifest, 'manifest should expose baseline summary');
  assert.equal(manifest.baselineManifest.fileCount, 1);
  // Entries (which contain per-file sha256) must NOT be exposed.
  assert.equal(manifest.baselineManifest.entries, undefined, 'manifest must not expose baseline entries');
  // Summary counts and byteTotal OK — these are metadata, not raw content.
  assert.ok(typeof manifest.baselineManifest.byteTotal === 'number', 'manifest summary includes byteTotal');

  cleanBaselineRoot(baselineRoot);
});

// ── AC9: No VCS/spawn — already covered by existing AC6 test ────
// ── AC10: Backward compatibility — existing tests pass ───────────
