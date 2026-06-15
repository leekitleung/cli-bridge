// v2.5 Read-only apply-result presentation test suite (ADR-0009).
//
// Maps to the 8 ADR-0009 acceptance conditions:
// 1. Read-only proof
// 2. Containment
// 3. No baseline / no diff (incl. source check)
// 4. Redaction + caps
// 5. Fail-closed
// 6. No VCS / no spawn (source check)
// 7. Opt-in default OFF
// 8. No "apply from preview"
//
// All endpoints are strictly read-only GETs over an existing isolated apply
// result. No mutation, no baseline, no diff, no git/spawn, no apply-from-preview.

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

// ── Helpers ──────────────────────────────────────────────────────

const TEST_APPLY_ROOT = path.join(
  process.env.TEMP ?? process.env.TMPDIR ?? '/tmp',
  'cli-bridge-apply-present-test-' + randomUUID(),
);

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

async function call(runtime, method, pathStr, body, query) {
  return handleBridgeRequest(runtime, method, pathStr, jsonRequest(body), query);
}

const TEAMS = (key) => BRIDGE_PROJECTS_PATH + '/' + key + '/teams';

// A token-like secret matching the openai-api-key redaction rule (sk-[A-Za-z0-9_-]{20,}).
const SECRET_TOKEN = 'sk-' + 'A1b2C3d4E5f6G7h8I9j0KLmnopqrstuv';
const BIG_CONTENT = 'x'.repeat(70 * 1024); // > 64 KB preview cap → truncated

const APPLY_FILES = {
  'src/app.ts': '// plain app content\n',
  'src/secret.ts': 'export const key = "' + SECRET_TOKEN + '";\n',
  'src/big.ts': BIG_CONTENT,
};
const PROPOSED = Object.keys(APPLY_FILES);

async function seedAppliedApply(runtime, projectKey) {
  const goal = runtime.goalStore.createGoal({ sessionId: 'seed', description: 'Present test', projectId: projectKey });
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
    action: 'create', id: 't-present-' + randomUUID().slice(0, 8),
    goalId: goal.id, planId: plan.id,
    logicalSlots: [{ id: 's0', role: 'planner', stepIndex: 0, tier: 'patch-proposal', isolation: 'patch-only' }],
    maxConcurrentBridgeSlots: 1, mode: 'sequential', isolation: 'patch-only',
    provider: 'claude', endpointId: 'claude-code-command',
  });
  const teams = runtime.teamStore.listByProject(projectKey);
  const team = teams[teams.length - 1];
  assert.ok(team);
  await call(runtime, 'POST', TEAMS(projectKey) + '/' + team.id + '/approve');
  runtime.teamStore.recordArtifact(team.id, {
    teamId: team.id, slotId: 's0', planStepId: plan.steps[0].id,
    summary: 'present test artifact', proposedFiles: PROPOSED,
    outputRedacted: true, createdAt: Date.now(),
  });

  let res = await call(runtime, 'POST', TEAMS(projectKey) + '/' + team.id + '/apply-requests', {
    slotId: 's0', planStepId: plan.steps[0].id, proposedFiles: PROPOSED,
  });
  assert.equal(res.statusCode, 201);
  const applyId = res.payload.apply.applyId;

  res = await call(runtime, 'POST', TEAMS(projectKey) + '/' + team.id + '/apply-requests/' + applyId + '/confirm', {
    confirmed: true, files: APPLY_FILES,
  });
  assert.equal(res.statusCode, 200, 'apply confirm should succeed: ' + JSON.stringify(res.payload));

  return { team, plan, applyId };
}

function applyBase(projectKey, teamId, applyId) {
  return TEAMS(projectKey) + '/' + teamId + '/apply-requests/' + applyId;
}

// Snapshot a directory tree as a sorted list of "relpath:size" for read-only proof.
function snapshotDir(root) {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) walk(abs);
      else out.push(path.relative(root, abs).replace(/\\/g, '/') + ':' + fs.statSync(abs).size);
    }
  };
  walk(root);
  return out.sort();
}

// ── Condition 1: Read-only proof ─────────────────────────────────

test('AC1 read-only: manifest/files/preview do not mutate request or isolated dir', async () => {
  cleanTestRoot();
  const runtime = createBridgeRuntime({ applyRoot: TEST_APPLY_ROOT });
  runtime.projectStore.upsert({ key: 'alpha', label: 'Alpha', workspaceApplyEnabled: true });
  const { team, applyId } = await seedAppliedApply(runtime, 'alpha');
  const base = applyBase('alpha', team.id, applyId);

  const isoDir = runtime.applyStore.getRequest(applyId).isolatedDirPath;
  const before = snapshotDir(isoDir);
  const statusBefore = runtime.applyStore.getRequest(applyId).status;

  // Read all three endpoints multiple times.
  await call(runtime, 'GET', base);
  await call(runtime, 'GET', base + '/files');
  await call(runtime, 'GET', base + '/files/preview', undefined, new URLSearchParams({ path: 'src/app.ts' }));
  await call(runtime, 'GET', base + '/files/preview', undefined, new URLSearchParams({ path: 'src/big.ts' }));

  const after = snapshotDir(isoDir);
  assert.deepEqual(after, before, 'isolated dir contents must be unchanged by reads');
  assert.equal(runtime.applyStore.getRequest(applyId).status, statusBefore, 'status unchanged');
  assert.equal(statusBefore, 'applied');
});

// ── Condition 2: Containment ─────────────────────────────────────

test('AC2 containment: traversal / absolute / drive-letter / UNC path selectors rejected', async () => {
  cleanTestRoot();
  const runtime = createBridgeRuntime({ applyRoot: TEST_APPLY_ROOT });
  runtime.projectStore.upsert({ key: 'alpha', label: 'Alpha', workspaceApplyEnabled: true });
  const { team, applyId } = await seedAppliedApply(runtime, 'alpha');
  const base = applyBase('alpha', team.id, applyId);

  const escaping = [
    '../escape.ts',
    '../../etc/passwd',
    'src/../../etc/passwd',
    '/etc/passwd',
    'C:\\Windows\\system32',
    '\\\\server\\share\\x',
    'src\\..\\..\\etc',
  ];
  for (const p of escaping) {
    const res = await call(runtime, 'GET', base + '/files/preview', undefined, new URLSearchParams({ path: p }));
    assert.equal(res.statusCode, 400, 'escaping path must be 400: ' + p);
    // No content disclosed.
    assert.equal(res.payload.content, undefined, 'no content disclosed for: ' + p);
  }
});

// ── Condition 3: No baseline / no diff ───────────────────────────

test('AC3 no baseline/no diff: file list carries no classification field', async () => {
  cleanTestRoot();
  const runtime = createBridgeRuntime({ applyRoot: TEST_APPLY_ROOT });
  runtime.projectStore.upsert({ key: 'alpha', label: 'Alpha', workspaceApplyEnabled: true });
  const { team, applyId } = await seedAppliedApply(runtime, 'alpha');
  const base = applyBase('alpha', team.id, applyId);

  const res = await call(runtime, 'GET', base + '/files');
  assert.equal(res.statusCode, 200);
  assert.ok(Array.isArray(res.payload.files));
  for (const f of res.payload.files) {
    assert.deepEqual(Object.keys(f).sort(), ['path', 'size'], 'file entry must only have path + size');
    for (const banned of ['modified', 'unchanged', 'new', 'status', 'classification', 'diff', 'baseline']) {
      assert.equal(banned in f, false, 'file entry must not carry ' + banned);
    }
  }
});

test('AC3 no baseline/no diff: source has no baseline/diff/classification endpoint', () => {
  const store = fs.readFileSync('apps/local-server/src/storage/workspace-apply-store.ts', 'utf8');
  const route = fs.readFileSync('apps/local-server/src/routes/bridge-api.ts', 'utf8');
  for (const [name, src] of [['store', store], ['route', route]]) {
    // No diff route/sub or diff-producing identifiers introduced by presentation.
    assert.equal(src.includes("'diff'"), false, name + ': no diff sub-route');
    assert.equal(src.includes('/diff'), false, name + ': no /diff path');
    // No raw baseline content storage identifiers (ADR-0010 allows metadata-only captureBaseline method).
    for (const ident of ['originalContent', 'baselineContent', 'preApplyBaseline', 'beforeContent']) {
      assert.equal(src.includes(ident), false, name + ': no baseline identifier ' + ident);
    }
  }
});

// ── Condition 4: Redaction + caps ────────────────────────────────

test('AC4 redaction: secret token redacted in preview', async () => {
  cleanTestRoot();
  const runtime = createBridgeRuntime({ applyRoot: TEST_APPLY_ROOT });
  runtime.projectStore.upsert({ key: 'alpha', label: 'Alpha', workspaceApplyEnabled: true });
  const { team, applyId } = await seedAppliedApply(runtime, 'alpha');
  const base = applyBase('alpha', team.id, applyId);

  const res = await call(runtime, 'GET', base + '/files/preview', undefined, new URLSearchParams({ path: 'src/secret.ts' }));
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.redacted, true, 'preview should report redacted:true');
  assert.equal(res.payload.content.includes(SECRET_TOKEN), false, 'raw secret must not appear');
  assert.ok(res.payload.content.includes('[REDACTED'), 'redaction marker should appear');
});

test('AC4 caps: over-cap file returns truncated:true', async () => {
  cleanTestRoot();
  const runtime = createBridgeRuntime({ applyRoot: TEST_APPLY_ROOT });
  runtime.projectStore.upsert({ key: 'alpha', label: 'Alpha', workspaceApplyEnabled: true });
  const { team, applyId } = await seedAppliedApply(runtime, 'alpha');
  const base = applyBase('alpha', team.id, applyId);

  const res = await call(runtime, 'GET', base + '/files/preview', undefined, new URLSearchParams({ path: 'src/big.ts' }));
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.truncated, true, 'over-cap file should be truncated');
  assert.ok(res.payload.content.length <= 64 * 1024, 'content must be capped');
  assert.equal(res.payload.size, 70 * 1024, 'reported size is the true file size');
});

test('AC4 manifest: exposes isolatedDirId but never isolatedDirPath or secrets', async () => {
  cleanTestRoot();
  const runtime = createBridgeRuntime({ applyRoot: TEST_APPLY_ROOT });
  runtime.projectStore.upsert({ key: 'alpha', label: 'Alpha', workspaceApplyEnabled: true });
  const { team, applyId } = await seedAppliedApply(runtime, 'alpha');
  const base = applyBase('alpha', team.id, applyId);

  const res = await call(runtime, 'GET', base);
  assert.equal(res.statusCode, 200);
  const manifest = res.payload.apply;
  assert.ok(manifest.isolatedDirId, 'manifest exposes isolatedDirId');
  assert.equal('isolatedDirPath' in manifest, false, 'manifest must NOT include isolatedDirPath');
  const json = JSON.stringify(res.payload);
  const isoPath = runtime.applyStore.getRequest(applyId).isolatedDirPath;
  assert.equal(json.includes(isoPath), false, 'absolute isolated dir path must not leak');
  assert.equal(json.includes(SECRET_TOKEN), false, 'no secret in manifest');
});

// ── Condition 5: Fail-closed ─────────────────────────────────────

test('AC5 fail-closed: unknown applyId → 404 on all three endpoints', async () => {
  cleanTestRoot();
  const runtime = createBridgeRuntime({ applyRoot: TEST_APPLY_ROOT });
  runtime.projectStore.upsert({ key: 'alpha', label: 'Alpha', workspaceApplyEnabled: true });
  const { team } = await seedAppliedApply(runtime, 'alpha');
  const base = applyBase('alpha', team.id, 'does-not-exist-' + randomUUID());

  assert.equal((await call(runtime, 'GET', base)).statusCode, 404);
  assert.equal((await call(runtime, 'GET', base + '/files')).statusCode, 404);
  assert.equal((await call(runtime, 'GET', base + '/files/preview', undefined, new URLSearchParams({ path: 'src/app.ts' }))).statusCode, 404);
});

test('AC5 fail-closed: preview of non-existent (but valid) file → 404', async () => {
  cleanTestRoot();
  const runtime = createBridgeRuntime({ applyRoot: TEST_APPLY_ROOT });
  runtime.projectStore.upsert({ key: 'alpha', label: 'Alpha', workspaceApplyEnabled: true });
  const { team, applyId } = await seedAppliedApply(runtime, 'alpha');
  const base = applyBase('alpha', team.id, applyId);

  const res = await call(runtime, 'GET', base + '/files/preview', undefined, new URLSearchParams({ path: 'src/nope.ts' }));
  assert.equal(res.statusCode, 404);
  assert.equal(res.payload.content, undefined);
});

test('AC5 fail-closed: missing path query → 400', async () => {
  cleanTestRoot();
  const runtime = createBridgeRuntime({ applyRoot: TEST_APPLY_ROOT });
  runtime.projectStore.upsert({ key: 'alpha', label: 'Alpha', workspaceApplyEnabled: true });
  const { team, applyId } = await seedAppliedApply(runtime, 'alpha');
  const base = applyBase('alpha', team.id, applyId);

  const res = await call(runtime, 'GET', base + '/files/preview');
  assert.equal(res.statusCode, 400);
});

test('AC5 fail-closed: files/preview on pending apply → 409', async () => {
  cleanTestRoot();
  const runtime = createBridgeRuntime({ applyRoot: TEST_APPLY_ROOT });
  runtime.projectStore.upsert({ key: 'alpha', label: 'Alpha', workspaceApplyEnabled: true });
  // Build a pending (unconfirmed) apply.
  const goal = runtime.goalStore.createGoal({ sessionId: 'seed', description: 'Pending', projectId: 'alpha' });
  const plan = runtime.goalStore.attachPlan({
    goalId: goal.id,
    steps: [{ intent: 'Plan', kind: 'review', tier: 'patch-proposal', isStateMutating: false, targetEndpointId: 'claude-code-command' }],
    permittedTiers: ['patch-proposal'],
  });
  runtime.goalStore.approvePlan(goal.id);
  await call(runtime, 'POST', TEAMS('alpha'), {
    action: 'create', id: 't-pending-' + randomUUID().slice(0, 8),
    goalId: goal.id, planId: plan.id,
    logicalSlots: [{ id: 's0', role: 'planner', stepIndex: 0, tier: 'patch-proposal', isolation: 'patch-only' }],
    maxConcurrentBridgeSlots: 1, mode: 'sequential', isolation: 'patch-only',
    provider: 'claude', endpointId: 'claude-code-command',
  });
  const teams = runtime.teamStore.listByProject('alpha');
  const team = teams[teams.length - 1];
  await call(runtime, 'POST', TEAMS('alpha') + '/' + team.id + '/approve');
  runtime.teamStore.recordArtifact(team.id, {
    teamId: team.id, slotId: 's0', planStepId: plan.steps[0].id,
    summary: 'pending artifact', proposedFiles: ['src/app.ts'],
    outputRedacted: true, createdAt: Date.now(),
  });
  const created = await call(runtime, 'POST', TEAMS('alpha') + '/' + team.id + '/apply-requests', {
    slotId: 's0', planStepId: plan.steps[0].id, proposedFiles: ['src/app.ts'],
  });
  const applyId = created.payload.apply.applyId;
  const base = applyBase('alpha', team.id, applyId);

  // Manifest still works (pending is a valid record), but files/preview 409.
  assert.equal((await call(runtime, 'GET', base)).statusCode, 200);
  assert.equal((await call(runtime, 'GET', base + '/files')).statusCode, 409);
  assert.equal((await call(runtime, 'GET', base + '/files/preview', undefined, new URLSearchParams({ path: 'src/app.ts' }))).statusCode, 409);
});

test('AC5 fail-closed: files/preview on discarded apply → 409', async () => {
  cleanTestRoot();
  const runtime = createBridgeRuntime({ applyRoot: TEST_APPLY_ROOT });
  runtime.projectStore.upsert({ key: 'alpha', label: 'Alpha', workspaceApplyEnabled: true });
  const { team, applyId } = await seedAppliedApply(runtime, 'alpha');
  const base = applyBase('alpha', team.id, applyId);

  await call(runtime, 'POST', base + '/discard');
  assert.equal((await call(runtime, 'GET', base + '/files')).statusCode, 409);
  assert.equal((await call(runtime, 'GET', base + '/files/preview', undefined, new URLSearchParams({ path: 'src/app.ts' }))).statusCode, 409);
});

// ── Condition 6: No VCS / no spawn ───────────────────────────────

test('AC6 no VCS/spawn: presentation source uses no child_process/git/spawn', () => {
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

// ── Condition 7: Opt-in default OFF ──────────────────────────────

test('AC7 opt-in default OFF: all three endpoints reject when flag is false', async () => {
  cleanTestRoot();
  const runtime = createBridgeRuntime({ applyRoot: TEST_APPLY_ROOT });
  // Project exists but workspaceApplyEnabled defaults false.
  runtime.projectStore.upsert({ key: 'alpha', label: 'Alpha' });
  assert.equal(runtime.projectStore.get('alpha').workspaceApplyEnabled, false);

  const base = applyBase('alpha', 't-any', randomUUID());
  for (const sub of ['', '/files']) {
    const res = await call(runtime, 'GET', base + sub);
    assert.equal(res.statusCode, 409, 'disabled apply must reject ' + (sub || 'manifest'));
    assert.ok(res.payload.message.includes('not enabled') || res.payload.message.includes('Workspace apply'));
  }
  const prev = await call(runtime, 'GET', base + '/files/preview', undefined, new URLSearchParams({ path: 'src/app.ts' }));
  assert.equal(prev.statusCode, 409);
});

test('AC7 opt-in default OFF: non-apply flows unaffected', async () => {
  cleanTestRoot();
  const runtime = createBridgeRuntime({ applyRoot: TEST_APPLY_ROOT });
  runtime.projectStore.upsert({ key: 'alpha', label: 'Alpha' });
  const res = await call(runtime, 'GET', TEAMS('alpha'));
  assert.equal(res.statusCode, 200);
});

// ── Condition 8: No "apply from preview" ─────────────────────────

test('AC8 no apply-from-preview: presentation routes are GET-only (POST → 405)', async () => {
  cleanTestRoot();
  const runtime = createBridgeRuntime({ applyRoot: TEST_APPLY_ROOT });
  runtime.projectStore.upsert({ key: 'alpha', label: 'Alpha', workspaceApplyEnabled: true });
  const { team, applyId } = await seedAppliedApply(runtime, 'alpha');
  const base = applyBase('alpha', team.id, applyId);

  // No write/promote/apply verb on the read-only surfaces.
  assert.equal((await call(runtime, 'POST', base)).statusCode, 405, 'manifest POST not allowed');
  assert.equal((await call(runtime, 'POST', base + '/files')).statusCode, 405, 'files POST not allowed');
  assert.equal((await call(runtime, 'POST', base + '/files/preview', { confirmed: true })).statusCode, 405, 'preview POST not allowed');
  assert.equal((await call(runtime, 'PUT', base)).statusCode, 405, 'manifest PUT not allowed');
  assert.equal((await call(runtime, 'DELETE', base + '/files')).statusCode, 405, 'files DELETE not allowed');

  // There is no "promote"/"apply-from-preview" sub-route.
  const promote = await call(runtime, 'POST', base + '/files/preview/apply', { confirmed: true });
  assert.equal(promote.statusCode === 404 || promote.statusCode === 405, true, 'no apply-from-preview route');
});

test('AC8 no apply-from-preview: console viewer exposes no apply/promote/write affordance', () => {
  const consoleSrc = fs.readFileSync('apps/local-server/src/routes/project-console.ts', 'utf8');
  // The read-only apply viewer must exist...
  assert.ok(consoleSrc.includes('Apply Result (read-only)'), 'console has read-only apply viewer');
  // ...and the viewer functions must issue GET requests only (no write verb).
  const vStart = consoleSrc.indexOf('async function viewApplyResult');
  const vEnd = consoleSrc.indexOf('async function runReviewCommand');
  assert.ok(vStart !== -1 && vEnd !== -1 && vEnd > vStart, 'viewer functions located');
  const viewer = consoleSrc.slice(vStart, vEnd);
  assert.equal(/'POST'|'PUT'|'DELETE'|'PATCH'/.test(viewer), false, 'viewer must use GET only');
  assert.equal(/promote|apply-from-preview/i.test(viewer), false, 'viewer must not promote/apply');
  // No apply confirm/discard calls anywhere in the console.
  assert.equal(/apply-requests[^\n]*\/confirm/.test(consoleSrc), false, 'console must not call apply confirm');
  assert.equal(/apply-requests[^\n]*\/discard/.test(consoleSrc), false, 'console must not call apply discard');
});

// ── Additional fail-closed error paths (EX-2.5-4 hardening) ───────

test('fail-closed: wrong project id on all three endpoints → 404', async () => {
  cleanTestRoot();
  const runtime = createBridgeRuntime({ applyRoot: TEST_APPLY_ROOT });
  runtime.projectStore.upsert({ key: 'alpha', label: 'Alpha', workspaceApplyEnabled: true });
  runtime.projectStore.upsert({ key: 'beta', label: 'Beta', workspaceApplyEnabled: true });
  const { team, applyId } = await seedAppliedApply(runtime, 'alpha');

  // Use the correct applyId but wrong projectKey.
  const base = applyBase('beta', team.id, applyId);
  assert.equal((await call(runtime, 'GET', base)).statusCode, 404, 'manifest with wrong project → 404');
  assert.equal((await call(runtime, 'GET', base + '/files')).statusCode, 404, 'files with wrong project → 404');
  assert.equal((await call(runtime, 'GET', base + '/files/preview', undefined, new URLSearchParams({ path: 'src/app.ts' }))).statusCode, 404, 'preview with wrong project → 404');
});

test('fail-closed: wrong team id on all three endpoints → 404', async () => {
  cleanTestRoot();
  const runtime = createBridgeRuntime({ applyRoot: TEST_APPLY_ROOT });
  runtime.projectStore.upsert({ key: 'alpha', label: 'Alpha', workspaceApplyEnabled: true });
  const { team, applyId } = await seedAppliedApply(runtime, 'alpha');

  // Create a second team and use its id with the wrong apply.
  const base = applyBase('alpha', 't-nonexistent-' + randomUUID().slice(0,8), applyId);
  assert.equal((await call(runtime, 'GET', base)).statusCode, 404, 'manifest with wrong team → 404');
  assert.equal((await call(runtime, 'GET', base + '/files')).statusCode, 404, 'files with wrong team → 404');
  assert.equal((await call(runtime, 'GET', base + '/files/preview', undefined, new URLSearchParams({ path: 'src/app.ts' }))).statusCode, 404, 'preview with wrong team → 404');
});

test('fail-closed: consistent error shape across endpoints', async () => {
  cleanTestRoot();
  const runtime = createBridgeRuntime({ applyRoot: TEST_APPLY_ROOT });
  runtime.projectStore.upsert({ key: 'alpha', label: 'Alpha', workspaceApplyEnabled: true });
  const { team, applyId } = await seedAppliedApply(runtime, 'alpha');

  // Apply disabled mid-flight.
  runtime.projectStore.upsert({ key: 'alpha', workspaceApplyEnabled: false });
  const base = applyBase('alpha', team.id, applyId);
  for (const sub of ['', '/files']) {
    const res = await call(runtime, 'GET', base + sub);
    assert.equal(res.statusCode, 409);
    assert.ok(res.payload.status === 'error', 'error shape: { status: "error" }');
    assert.ok(typeof res.payload.message === 'string', 'error shape: has message');
  }
  const prev = await call(runtime, 'GET', base + '/files/preview', undefined, new URLSearchParams({ path: 'src/app.ts' }));
  assert.equal(prev.statusCode, 409);
  assert.equal(prev.payload.status, 'error');
});
