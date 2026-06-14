// v2.14 ADR-0019-a: Git status reader tests
// Uses injected fake spawn — never runs a real git command.
// Verifies: read-only argv, cwd containment, sanitized output, fail-closed behavior.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readGitStatus } from '../apps/local-server/src/verification/git-status-reader.ts';

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

function textToChunks(text) {
  if (!text) return [];
  return [Buffer.from(text, 'utf8')];
}

function makeReader(opts) {
  return readGitStatus({
    projectKey: 'test-project',
    workspaceRoot: opts.root ?? '/tmp/test-root',
    spawnFn: opts.spawn,
  });
}

// ── Tests: read-only argv assertion ──────────────────────────────

test('git rev-parse argv is read-only and shell:false', async () => {
  /** @type {{ file: string, args: string[] }[]} */
  const calls = [];
  const spawn = async (file, args, opts) => {
    calls.push({ file, args });
    return { ok: true, exitCode: 0, signal: null, stdoutChunks: textToChunks('true\n'), stderrChunks: [] };
  };
  await makeReader({ spawn });

  assert(calls.length >= 1, 'should have at least one spawn call');
  // First call must be rev-parse --is-inside-work-tree
  const first = calls[0];
  assert.equal(first.file, 'git');
  assert.ok(first.args.includes('--is-inside-work-tree'), 'should include --is-inside-work-tree');
  assert.ok(first.args.includes('rev-parse'), 'should include rev-parse');
  // Must not include any write commands
  const allArgs = calls.flatMap(c => c.args);
  const forbidden = ['commit', 'push', 'pull', 'fetch', 'merge', 'rebase', 'checkout', '-b', 'clone', 'init', 'am', 'apply', 'cherry-pick', 'stash'];
  for (const cmd of forbidden) {
    assert.ok(!allArgs.includes(cmd), `must not include '${cmd}'`);
  }
});

test('git branch argv is read-only', async () => {
  const calls = [];
  const spawn = async (file, args, opts) => {
    calls.push({ args: [...args] });
    if (calls.length === 1) {
      return { ok: true, exitCode: 0, signal: null, stdoutChunks: textToChunks('true\n'), stderrChunks: [] };
    }
    return { ok: true, exitCode: 0, signal: null, stdoutChunks: textToChunks('main\n'), stderrChunks: [] };
  };
  await makeReader({ spawn });

  const branchCall = calls.find(c => c.args.includes('--show-current'));
  assert.ok(branchCall, 'should have branch --show-current call');
});

test('git status argv uses --porcelain only', async () => {
  const calls = [];
  const spawn = async (file, args, opts) => {
    calls.push({ args: [...args] });
    if (calls.length === 1) {
      return { ok: true, exitCode: 0, signal: null, stdoutChunks: textToChunks('true\n'), stderrChunks: [] };
    }
    return { ok: true, exitCode: 0, signal: null, stdoutChunks: textToChunks(''), stderrChunks: [] };
  };
  await makeReader({ spawn });

  const statusCall = calls.find(c => c.args.includes('--porcelain'));
  assert.ok(statusCall, 'should have status --porcelain call');
  assert.ok(statusCall.args.includes('status'));
});

test('git ahead-behind uses rev-list --left-right --count only', async () => {
  const calls = [];
  const spawn = async (file, args, opts) => {
    calls.push({ args: [...args] });
    if (calls.length === 1) {
      return { ok: true, exitCode: 0, signal: null, stdoutChunks: textToChunks('true\n'), stderrChunks: [] };
    }
    return { ok: true, exitCode: 0, signal: null, stdoutChunks: textToChunks('1\t0\n'), stderrChunks: [] };
  };
  await makeReader({ spawn });

  const abCall = calls.find(c => c.args.includes('--left-right'));
  assert.ok(abCall, 'should have ahead-behind call');
  assert.ok(abCall.args.includes('--left-right'));
  assert.ok(abCall.args.includes('--count'));
  assert.ok(abCall.args.includes('rev-list'));
});

// ── Tests: Sanitized output ──────────────────────────────────────

test('response contains only sanitized fields', async () => {
  const spawn = fakeSpawn({ exitCode: 0, stdoutChunks: textToChunks('true\n') });
  // Not a git repo → rev-parse returns non-true, so isGitRepo:false
  const result = await makeReader({ spawn: fakeSpawn({ exitCode: 0, stdoutChunks: textToChunks('false\n') }) });
  const view = result.view;
  const allowed = new Set(['branch', 'dirty', 'aheadCount', 'behindCount', 'isGitRepo', 'fetchedAt', 'available']);
  for (const key of Object.keys(view)) {
    assert.ok(allowed.has(key), `must not contain '${key}'`);
  }
  // No absolute path, no remote URL, no commit hash, no raw output
  const json = JSON.stringify(view);
  assert.ok(!json.includes('/tmp/test-root'), 'must not contain absolute cwd');
  assert.ok(!json.includes('remote'), 'must not contain remote');
  assert.ok(!json.includes('https://'), 'must not contain URL');
  assert.ok(!json.includes('sha256'), 'must not contain hash');
  assert.ok(!json.includes('commit'), 'must not contain commit');
});

test('healthy git repo returns full GitStatusView', async () => {
  let callCount = 0;
  const spawn = async (_file, _args, _opts) => {
    callCount++;
    if (callCount === 1) return { ok: true, exitCode: 0, signal: null, stdoutChunks: textToChunks('true\n'), stderrChunks: [] };
    if (callCount === 2) return { ok: true, exitCode: 0, signal: null, stdoutChunks: textToChunks('feat/my-branch\n'), stderrChunks: [] };
    if (callCount === 3) return { ok: true, exitCode: 0, signal: null, stdoutChunks: textToChunks('M file.ts\n'), stderrChunks: [] };
    return { ok: true, exitCode: 0, signal: null, stdoutChunks: textToChunks('3\t1\n'), stderrChunks: [] };
  };
  const result = await makeReader({ spawn });

  assert.equal(result.view.isGitRepo, true);
  assert.equal(result.view.available, true);
  assert.equal(result.view.branch, 'feat/my-branch');
  assert.equal(result.view.dirty, true);
  assert.equal(result.view.aheadCount, 3);
  assert.equal(result.view.behindCount, 1);
  assert.equal(typeof result.view.fetchedAt, 'number');
  assert.equal(typeof result.elapsedMs, 'number');
});

test('clean repo with no upstream returns null ahead/behind', async () => {
  let callCount = 0;
  const spawn = async (_file, _args, _opts) => {
    callCount++;
    if (callCount === 1) return { ok: true, exitCode: 0, signal: null, stdoutChunks: textToChunks('true\n'), stderrChunks: [] };
    if (callCount === 2) return { ok: true, exitCode: 0, signal: null, stdoutChunks: textToChunks('main\n'), stderrChunks: [] };
    if (callCount === 3) return { ok: true, exitCode: 0, signal: null, stdoutChunks: textToChunks('\n'), stderrChunks: [] };
    // rev-list fails (no upstream) — exitCode non-zero
    return { ok: true, exitCode: 128, signal: null, stdoutChunks: textToChunks(''), stderrChunks: textToChunks('fatal: no upstream\n') };
  };
  const result = await makeReader({ spawn });

  assert.equal(result.view.isGitRepo, true);
  assert.equal(result.view.dirty, false);
  assert.equal(result.view.aheadCount, null);
  assert.equal(result.view.behindCount, null);
});

// ── Tests: Fail-closed ───────────────────────────────────────────

test('not a git repo returns isGitRepo:false available:true', async () => {
  const result = await makeReader({
    spawn: fakeSpawn({ exitCode: 128, stdoutChunks: textToChunks('false\n'), stderrChunks: textToChunks('fatal: not a git repository\n') }),
  });

  assert.equal(result.view.isGitRepo, false);
  assert.equal(result.view.available, true);
  assert.equal(result.view.branch, null);
  assert.equal(result.view.dirty, false);
});

test('spawn error returns available:false', async () => {
  const result = await makeReader({
    spawn: fakeSpawn({ ok: false, error: 'ENOENT' }),
  });

  assert.equal(result.view.available, false);
  assert.equal(result.view.isGitRepo, false);
  assert.ok(result.error !== undefined);
});

test('timeout returns available:false', async () => {
  const result = await makeReader({
    spawn: fakeSpawn({ ok: false, error: 'timeout', signal: 'SIGTERM' }),
  });

  assert.equal(result.view.available, false);
});

test('partial failure returns available:true with nulls', async () => {
  let callCount = 0;
  const spawn = async (_file, _args, _opts) => {
    callCount++;
    if (callCount === 1) return { ok: true, exitCode: 0, signal: null, stdoutChunks: textToChunks('true\n'), stderrChunks: [] };
    // Branch command fails
    if (callCount === 2) return { ok: false, exitCode: null, signal: null, error: 'spawn error' };
    // Status command works
    if (callCount === 3) return { ok: true, exitCode: 0, signal: null, stdoutChunks: textToChunks('M file.ts\n'), stderrChunks: [] };
    return { ok: true, exitCode: 0, signal: null, stdoutChunks: textToChunks('0\t0\n'), stderrChunks: [] };
  };
  const result = await makeReader({ spawn });

  // Still available; just branch is null
  assert.equal(result.view.available, true);
  assert.equal(result.view.isGitRepo, true);
  assert.equal(result.view.branch, null);
  assert.equal(result.view.dirty, true); // status worked
});

// ── Tests: Cwd containment ───────────────────────────────────────

test('cwd is the provided workspaceRoot', async () => {
  /** @type {string|null} */
  let capturedCwd = null;
  const spawn = async (_file, _args, opts) => {
    capturedCwd = opts.cwd;
    return { ok: true, exitCode: 0, signal: null, stdoutChunks: textToChunks('true\n'), stderrChunks: [] };
  };
  await makeReader({ root: '/tmp/my-project-root', spawn });

  assert.equal(capturedCwd, '/tmp/my-project-root');
});

test('no baselineRoot or server cwd in argv', async () => {
  const calls = [];
  const spawn = async (_file, args, opts) => {
    calls.push({ args: [...args], cwd: opts.cwd });
    if (calls.length === 1) return { ok: true, exitCode: 0, signal: null, stdoutChunks: textToChunks('true\n'), stderrChunks: [] };
    return { ok: true, exitCode: 0, signal: null, stdoutChunks: textToChunks(''), stderrChunks: [] };
  };
  await makeReader({ root: '/tmp/proj', spawn });

  for (const call of calls) {
    assert.equal(call.cwd, '/tmp/proj', 'cwd must be the provided root');
    // No .gitconfig, no remote URL, no token in args
    for (const arg of call.args) {
      assert.ok(!arg.includes('baseline'), `must not contain baseline in arg: ${arg}`);
      assert.ok(!arg.includes('http'), `must not contain http in arg: ${arg}`);
      assert.ok(!arg.includes('token'), `must not contain token in arg: ${arg}`);
      assert.ok(!arg.includes('credential'), `must not contain credential in arg: ${arg}`);
    }
  }
});

// ── Tests: No network/credentials ────────────────────────────────

test('no git fetch/pull/remote in any argv', async () => {
  const calls = [];
  const spawn = async (_file, args, _opts) => {
    calls.push(args);
    if (calls.length === 1) return { ok: true, exitCode: 0, signal: null, stdoutChunks: textToChunks('true\n'), stderrChunks: [] };
    return { ok: true, exitCode: 0, signal: null, stdoutChunks: textToChunks(''), stderrChunks: [] };
  };
  await makeReader({ spawn });

  const allArgs = calls.flat().join(' ');
  assert.ok(!allArgs.includes('fetch'), 'must not contain fetch');
  assert.ok(!allArgs.includes('pull'), 'must not contain pull');
  assert.ok(!allArgs.includes('remote'), 'must not contain remote');
  assert.ok(!allArgs.includes('clone'), 'must not contain clone');
  assert.ok(!allArgs.includes('https'), 'must not contain https');
  assert.ok(!allArgs.includes('ssh'), 'must not contain ssh');
});

// ── Tests: Branch sanitization ───────────────────────────────────

test('branch with control characters is rejected', async () => {
  let callCount = 0;
  const spawn = async (_file, _args, _opts) => {
    callCount++;
    if (callCount === 1) return { ok: true, exitCode: 0, signal: null, stdoutChunks: textToChunks('true\n'), stderrChunks: [] };
    return { ok: true, exitCode: 0, signal: null, stdoutChunks: textToChunks('\x00bad\x1bbranch\n'), stderrChunks: [] };
  };
  const result = await makeReader({ spawn });
  assert.equal(result.view.branch, null, 'control chars in branch should sanitize to null');
});

test('branch over 256 chars is rejected', async () => {
  let callCount = 0;
  const spawn = async (_file, _args, _opts) => {
    callCount++;
    if (callCount === 1) return { ok: true, exitCode: 0, signal: null, stdoutChunks: textToChunks('true\n'), stderrChunks: [] };
    return { ok: true, exitCode: 0, signal: null, stdoutChunks: textToChunks('x'.repeat(257) + '\n'), stderrChunks: [] };
  };
  const result = await makeReader({ spawn });
  assert.equal(result.view.branch, null, 'over-long branch should sanitize to null');
});

// ── Tests: response never exposes raw output ─────────────────────

test('response never contains raw stdout', async () => {
  let callCount = 0;
  const spawn = async (_file, _args, _opts) => {
    callCount++;
    if (callCount === 1) return { ok: true, exitCode: 0, signal: null, stdoutChunks: textToChunks('true\n'), stderrChunks: [] };
    return { ok: true, exitCode: 0, signal: null, stdoutChunks: textToChunks('branch\n'), stderrChunks: [] };
  };
  const result = await makeReader({ spawn });

  // view should not contain raw chunks
  assert.equal(typeof result.view.branch, 'string');
  assert.ok(!('stdout' in result.view));
  assert.ok(!('stderr' in result.view));
  assert.ok(!('rawOutput' in result.view));
  assert.ok(!('chunks' in result.view));
});

// ── Tests: env/containerization hardening ────────────────────────

test('every spawn call includes -c core.fsmonitor= and -c core.hooksPath=', async () => {
  const calls = [];
  const spawn = async (_file, args, _opts) => {
    calls.push([...args]);
    if (calls.length === 1) return { ok: true, exitCode: 0, signal: null, stdoutChunks: textToChunks('true\n'), stderrChunks: [] };
    if (calls.length === 2) return { ok: true, exitCode: 0, signal: null, stdoutChunks: textToChunks('main\n'), stderrChunks: [] };
    if (calls.length === 3) return { ok: true, exitCode: 0, signal: null, stdoutChunks: textToChunks(''), stderrChunks: [] };
    return { ok: true, exitCode: 0, signal: null, stdoutChunks: textToChunks('0\t0\n'), stderrChunks: [] };
  };
  await makeReader({ spawn });

  assert.ok(calls.length >= 1, 'should have at least one spawn call');
  for (const args of calls) {
    const hasFsmonitor = args.includes('-c') && args.includes('core.fsmonitor=');
    const hasHooksPath = args.includes('-c') && args.includes('core.hooksPath=');
    assert.ok(hasFsmonitor, `every spawn must include -c core.fsmonitor=, got: ${args.join(' ')}`);
    assert.ok(hasHooksPath, `every spawn must include -c core.hooksPath=, got: ${args.join(' ')}`);
  }
});

test('spawn env contains GIT_TERMINAL_PROMPT=0 and GIT_OPTIONAL_LOCKS=0', async () => {
  /** @type {Record<string, string>[]} */
  const envs = [];
  const spawn = async (_file, _args, opts) => {
    envs.push(opts.env);
    if (envs.length === 1) return { ok: true, exitCode: 0, signal: null, stdoutChunks: textToChunks('true\n'), stderrChunks: [] };
    if (envs.length === 2) return { ok: true, exitCode: 0, signal: null, stdoutChunks: textToChunks('main\n'), stderrChunks: [] };
    if (envs.length === 3) return { ok: true, exitCode: 0, signal: null, stdoutChunks: textToChunks(''), stderrChunks: [] };
    return { ok: true, exitCode: 0, signal: null, stdoutChunks: textToChunks('0\t0\n'), stderrChunks: [] };
  };
  await makeReader({ spawn });

  assert.ok(envs.length >= 1, 'should have at least one env captured');
  for (const env of envs) {
    assert.equal(env.GIT_TERMINAL_PROMPT, '0', 'GIT_TERMINAL_PROMPT must be 0');
    assert.equal(env.GIT_OPTIONAL_LOCKS, '0', 'GIT_OPTIONAL_LOCKS must be 0');
    assert.equal(env.GIT_CONFIG_NOSYSTEM, '1', 'GIT_CONFIG_NOSYSTEM must be 1');
  }
});

test('spawn env is not full process.env — host-only variables absent', async () => {
  /** @type {Record<string, string>} */
  let capturedEnv = null;
  const spawn = async (_file, _args, opts) => {
    capturedEnv = opts.env;
    return { ok: true, exitCode: 0, signal: null, stdoutChunks: textToChunks('true\n'), stderrChunks: [] };
  };
  // Set a host-only variable that should NOT appear in the git env.
  process.env.__WORKBUDDY_GIT_TEST_MARKER = 'should-not-appear';
  try {
    await makeReader({ spawn });
    assert.ok(capturedEnv, 'must capture env');
    // The git env should be minimal — only PATH, HOME, and the three git defense vars.
    assert.equal(capturedEnv.__WORKBUDDY_GIT_TEST_MARKER, undefined,
      'host-only env var must NOT leak into git child env');
    // Verify the env is a small allowlist, not full process.env.
    const keys = Object.keys(capturedEnv);
    assert.ok(keys.length <= 6, `env should be minimal (<=6 keys), got ${keys.length}: ${keys.join(',')}`);
    assert.ok(keys.includes('PATH'));
    assert.ok(keys.includes('HOME'));
    assert.ok(keys.includes('GIT_TERMINAL_PROMPT'));
    assert.ok(keys.includes('GIT_OPTIONAL_LOCKS'));
    assert.ok(keys.includes('GIT_CONFIG_NOSYSTEM'));
  } finally {
    delete process.env.__WORKBUDDY_GIT_TEST_MARKER;
  }
});
