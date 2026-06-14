// v2.13 ADR-0018: Verification profile runner tests
// Uses injected fake spawn — never runs a real external command.

import assert from 'node:assert/strict';
import test from 'node:test';
import * as path from 'node:path';
import { runVerificationProfile } from '../apps/local-server/src/verification/profile-runner.ts';

const BASE_PROFILE = {
  id: 'unit-tests',
  label: 'Unit tests',
  argv: ['npm.cmd', 'test'],
  cwdPolicy: { kind: 'project-root' },
  env: ['PATH', 'SystemRoot'],
  timeoutMs: 10000,
  outputCapBytes: 65536,
  networkRisk: 'unknown',
  mutationRisk: 'read-only',
};

// ── Helpers ──────────────────────────────────────────────────────

function fakeSpawn(result) {
  return async (_file, _args, _opts) => {
    return {
      ok: result.ok ?? true,
      exitCode: result.exitCode ?? null,
      signal: result.signal ?? null,
      stdoutChunks: result.stdoutChunks ?? [],
      stderrChunks: result.stderrChunks ?? [],
      error: result.error,
    };
  };
}

function makeRunner(opts) {
  return runVerificationProfile({
    profile: { ...BASE_PROFILE, ...opts.profile },
    projectKey: 'test-project',
    workspaceRoot: opts.root ?? '/tmp/test-root',
    spawnFn: opts.spawn,
  });
}

async function assertResult(r, expected, extra) {
  const res = await r;
  assert.equal(res.record.result, expected, 'result type');
  assert.equal(res.record.commandLabel, 'Unit tests');
  assert.equal(res.record.outputDiscarded, true);
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      assert.deepEqual(res.record[k], v, 'field ' + k);
    }
  }
}

// ── Tests ────────────────────────────────────────────────────────

test('exit 0 maps to passed', async () => {
  await assertResult(makeRunner({ spawn: fakeSpawn({ exitCode: 0 }) }), 'passed');
});

test('exit 1 maps to failed', async () => {
  await assertResult(makeRunner({ spawn: fakeSpawn({ exitCode: 1 }) }), 'failed');
});

test('signal maps to errored', async () => {
  await assertResult(makeRunner({ spawn: fakeSpawn({ signal: 'SIGTERM', exitCode: null }) }), 'errored');
});

test('spawn error maps to errored', async () => {
  await assertResult(makeRunner({ spawn: fakeSpawn({ error: 'ENOENT' }) }), 'errored');
});

test('timeout maps to errored', async () => {
  await assertResult(makeRunner({ spawn: fakeSpawn({ error: 'timeout' }) }), 'errored');
});

test('truncated flag set when output exceeds cap', async () => {
  const bigChunk = Buffer.alloc(70000, 'x');
  await assertResult(makeRunner({
    spawn: fakeSpawn({ exitCode: 0, stdoutChunks: [bigChunk] }),
    profile: { outputCapBytes: 100 },
  }), 'passed', { truncated: true });
});

test('output is always discarded', async () => {
  const r = await makeRunner({ spawn: fakeSpawn({ exitCode: 0, stdoutChunks: [Buffer.from('hello')] }) });
  assert.equal(r.record.outputDiscarded, true);
  assert.ok(!('stdout' in r.record));
  assert.ok(!('stderr' in r.record));
});

test('lock prevents concurrent runs', async () => {
  // eslint-disable-next-line no-unused-vars
  const lazySpawn = () => new Promise((resolve) => {
    setTimeout(() => resolve({ ok: true, exitCode: 0, signal: null, stdoutChunks: [], stderrChunks: [] }), 500);
  });
  // Start first run (will block in spawn).
  const p1 = makeRunner({ spawn: lazySpawn });
  await new Promise(r => setTimeout(r, 50));
  // Second run should be locked.
  const p2 = makeRunner({ spawn: lazySpawn });
  await assertResult(p2, 'errored');
  // First should complete.
  await assertResult(p1, 'passed');
});

test('no raw output fields in record', async () => {
  const r = await makeRunner({ spawn: fakeSpawn({ exitCode: 0, stdoutChunks: [Buffer.from('hello')], stderrChunks: [Buffer.from('err')] }) });
  const keys = Object.keys(r.record);
  assert.equal(keys.includes('stdout'), false);
  assert.equal(keys.includes('stderr'), false);
  assert.equal(keys.includes('argv'), false);
  assert.equal(keys.includes('cwd'), false);
  assert.equal(keys.includes('env'), false);
  assert.equal(keys.includes('command'), false);
  assert.equal(keys.includes('output'), false);
});

// ── v2.13-h: containment / env / argv structure ──────────────────

test('cwdPolicy valid subPath allowed and passed to spawn', async () => {
  // Production roots come from normalizeProjectWorkspaceRoots (path.resolve'd
  // absolute). Mirror that here: a POSIX-looking literal like '/tmp/real' is not
  // an absolute path on Windows, so path.resolve it before passing to the runner.
  const root = path.resolve('/tmp/real');
  let c;
  const sf = async (f, a, o) => { c = o.cwd; return { ok: true, exitCode: 0, signal: null, stdoutChunks: [], stderrChunks: [] }; };
  const r = await makeRunner({ spawn: sf, root, profile: { cwdPolicy: { kind: 'project-root', subPath: 'sub' } } });
  assert.equal(r.record.result, 'passed');
  assert.equal(c, path.join(root, 'sub'));
});

test('cwdPolicy traversal escape rejected before spawn', async () => {
  let called = false;
  const r = await makeRunner({
    spawn: async () => { called = true; return { ok: true, exitCode: 0, signal: null, stdoutChunks: [], stderrChunks: [] }; },
    root: '/tmp/real', profile: { cwdPolicy: { kind: 'project-root', subPath: '../etc' } },
  });
  assert.equal(r.record.result, 'errored');
  assert.equal(called, false);
});

test('env allowlist only passes named vars', async () => {
  let e;
  const sf = async (f, a, o) => { e = o.env; return { ok: true, exitCode: 0, signal: null, stdoutChunks: [], stderrChunks: [] }; };
  process.env.__CB_TEST_VAR__ = 'hello';
  const r = await makeRunner({ spawn: sf, profile: { env: ['__CB_TEST_VAR__', 'NONEXISTENT'] } });
  delete process.env.__CB_TEST_VAR__;
  assert.equal(r.record.result, 'passed');
  assert.deepEqual(Object.keys(e).sort(), ['__CB_TEST_VAR__']);
  assert.equal(e.__CB_TEST_VAR__, 'hello');
});

test('structured argv passed as file + args, not shell string', async () => {
  let f, a;
  const sf = async (ff, aa) => { f = ff; a = aa; return { ok: true, exitCode: 0, signal: null, stdoutChunks: [], stderrChunks: [] }; };
  const r = await makeRunner({ spawn: sf, profile: { argv: ['npm.cmd', 'test', '--verbose'] } });
  assert.equal(r.record.result, 'passed');
  assert.equal(f, 'npm.cmd');
  assert.deepEqual(a, ['test', '--verbose']);
});
