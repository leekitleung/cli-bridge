import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ALLOWED_COMMANDS,
  FORBIDDEN_ARG_PATTERNS,
  runAllowlistedCommand,
  validateCommandExecution,
} from '../apps/local-server/src/adapters/command-runner.ts';

function fakeRunner(result, capture) {
  return {
    async run(execution, options) {
      if (capture) {
        capture.execution = execution;
        capture.options = options;
      }
      if (typeof result === 'function') {
        return result(execution, options);
      }
      return result;
    },
  };
}

const okProcess = {
  exitCode: 0,
  stdout: '{"summary":"ok","findings":[]}',
  stderr: '',
  timedOut: false,
};

test('allowlist exposes only codex and claude', () => {
  assert.deepEqual([...ALLOWED_COMMANDS], ['codex', 'claude']);
});

test('validateCommandExecution rejects non-allowlisted commands', () => {
  const result = validateCommandExecution({ command: 'bash', args: ['-c', 'ls'] });
  assert.equal(result.ok, false);
  assert.equal(result.failureReason, 'command-not-allowlisted');
});

test('validateCommandExecution rejects every forbidden bypass flag', () => {
  for (const forbidden of FORBIDDEN_ARG_PATTERNS) {
    const result = validateCommandExecution({
      command: 'codex',
      args: ['exec', `--${forbidden}`],
    });
    assert.equal(result.ok, false, `expected rejection for ${forbidden}`);
    assert.equal(result.failureReason, `forbidden-arg:${forbidden}`);
  }
});

test('validateCommandExecution rejects non-string args', () => {
  const result = validateCommandExecution({ command: 'claude', args: ['-p', 42] });
  assert.equal(result.ok, false);
  assert.equal(result.failureReason, 'arg-not-string');
});

test('validateCommandExecution accepts a clean allowlisted invocation', () => {
  const result = validateCommandExecution({
    command: 'claude',
    args: ['-p', '--output-format', 'json', '--tools', ''],
  });
  assert.equal(result.ok, true);
});

test('runAllowlistedCommand never spawns when validation fails', async () => {
  let runnerCalled = false;
  const runner = {
    async run() {
      runnerCalled = true;
      return okProcess;
    },
  };
  const result = await runAllowlistedCommand(
    { command: 'rm', args: ['-rf', '/'] },
    { runner },
  );
  assert.equal(runnerCalled, false);
  assert.equal(result.ok, false);
  assert.equal(result.failureReason, 'command-not-allowlisted');
});

test('runAllowlistedCommand passes argv array and stdin without a shell string', async () => {
  const capture = {};
  const result = await runAllowlistedCommand(
    {
      command: 'codex',
      args: ['exec', 'review', '--json'],
      stdin: 'review this',
      cwd: '/repo',
    },
    { runner: fakeRunner(okProcess, capture) },
  );

  assert.equal(result.ok, true);
  assert.ok(Array.isArray(capture.execution.args));
  assert.deepEqual(capture.execution.args, ['exec', 'review', '--json']);
  assert.equal(capture.execution.stdin, 'review this');
  assert.equal(capture.execution.cwd, '/repo');
  // The runner contract carries no shell string anywhere.
  assert.equal('shell' in capture.execution, false);
});

test('runAllowlistedCommand surfaces a clean success', async () => {
  const result = await runAllowlistedCommand(
    { command: 'claude', args: ['-p'] },
    { runner: fakeRunner(okProcess) },
  );
  assert.equal(result.ok, true);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, okProcess.stdout);
  assert.equal(result.truncated, false);
});

test('runAllowlistedCommand fails closed on non-zero exit', async () => {
  const result = await runAllowlistedCommand(
    { command: 'codex', args: ['exec', 'review'] },
    { runner: fakeRunner({ exitCode: 1, stdout: '', stderr: 'boom', timedOut: false }) },
  );
  assert.equal(result.ok, false);
  assert.equal(result.failureReason, 'command-nonzero-exit');
  assert.equal(result.exitCode, 1);
});

test('runAllowlistedCommand fails closed on timeout', async () => {
  const result = await runAllowlistedCommand(
    { command: 'claude', args: ['-p'] },
    { runner: fakeRunner({ exitCode: null, stdout: 'partial', stderr: '', timedOut: true }) },
  );
  assert.equal(result.ok, false);
  assert.equal(result.timedOut, true);
  assert.equal(result.failureReason, 'command-timed-out');
});

test('runAllowlistedCommand fails closed when output exceeds the cap', async () => {
  const big = 'x'.repeat(50);
  const result = await runAllowlistedCommand(
    { command: 'claude', args: ['-p'] },
    {
      maxOutputBytes: 50,
      runner: fakeRunner({ exitCode: 0, stdout: big, stderr: '', timedOut: false }),
    },
  );
  assert.equal(result.ok, false);
  assert.equal(result.truncated, true);
  assert.equal(result.failureReason, 'command-output-too-large');
});

test('runAllowlistedCommand fails closed when the runner throws', async () => {
  const runner = {
    async run() {
      throw new Error('spawn failed');
    },
  };
  const result = await runAllowlistedCommand(
    { command: 'codex', args: ['exec'] },
    { runner },
  );
  assert.equal(result.ok, false);
  assert.equal(result.failureReason, 'process-runner-threw');
});
