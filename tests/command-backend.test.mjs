import assert from 'node:assert/strict';
import test from 'node:test';
import { tmpdir } from 'node:os';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { createCommandBackend } from '../apps/local-server/src/workbuddy/command-backend.ts';

test('command backend executes allowlisted command successfully', async () => {
  const backend = createCommandBackend({
    allowlist: ['node', 'echo'],
    defaultCwd: tmpdir(),
    timeoutMs: 10_000,
    outputCapBytes: 65_536,
  });

  const result = await backend.execute({
    taskId: 'task-1',
    proposalId: 'prop-1',
    prompt: 'echo hello world',
  });

  assert.equal(result.ok, true);
  assert.match(result.stdout, /hello world/);
  assert.equal(result.stderr, '');
  assert.equal(result.exitCode, 0);
});

test('command backend rejects non-allowlisted command', async () => {
  const backend = createCommandBackend({
    allowlist: ['echo'],
    defaultCwd: tmpdir(),
    timeoutMs: 5_000,
    outputCapBytes: 65_536,
  });

  const result = await backend.execute({
    taskId: 'task-1',
    proposalId: 'prop-1',
    prompt: 'rm -rf /',
  });

  assert.equal(result.ok, false);
  assert.match(result.failureReason, /not allowed/);
  assert.match(result.stderr, /not in the allowlist/);
  assert.equal(result.exitCode, 1);
});

test('command backend returns failure for empty prompt', async () => {
  const backend = createCommandBackend({
    allowlist: ['echo'],
    defaultCwd: tmpdir(),
    timeoutMs: 5_000,
    outputCapBytes: 65_536,
  });

  const result = await backend.execute({
    taskId: 'task-1',
    proposalId: 'prop-1',
    prompt: '   ',
  });

  assert.equal(result.ok, false);
  assert.match(result.failureReason, /Empty prompt/);
});

test('command backend reports exit code for failed command', async () => {
  const backend = createCommandBackend({
    allowlist: ['node', 'ls'],
    defaultCwd: tmpdir(),
    timeoutMs: 5_000,
    outputCapBytes: 65_536,
  });

  const result = await backend.execute({
    taskId: 'task-1',
    proposalId: 'prop-1',
    prompt: 'ls /nonexistent/path/abc123',
  });

  assert.equal(result.ok, false);
  assert.ok(result.exitCode !== 0, 'non-zero exit code expected');
});

test('command backend times out long-running command', async () => {
  const backend = createCommandBackend({
    allowlist: ['node'],
    defaultCwd: tmpdir(),
    timeoutMs: 500, // very short timeout
    outputCapBytes: 65_536,
  });

  const result = await backend.execute({
    taskId: 'task-1',
    proposalId: 'prop-1',
    prompt: 'node -e "setTimeout(() => {}, 10000)"',
  });

  assert.equal(result.ok, false);
  assert.match(result.failureReason, /Timed out/);
  assert.equal(result.exitCode, -1);
});

test('command backend caps output size', async () => {
  const backend = createCommandBackend({
    allowlist: ['node'],
    defaultCwd: tmpdir(),
    timeoutMs: 5_000,
    outputCapBytes: 100, // very small cap
  });

  const result = await backend.execute({
    taskId: 'task-1',
    proposalId: 'prop-1',
    prompt: 'node -e "console.log(\'x\'.repeat(500))"',
  });

  assert.equal(result.ok, false);
  assert.match(result.failureReason, /Output exceeded/);
});

test('command backend uses server-owned working directory', async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'cli-bridge-backend-test-'));
  const testFile = join(tmpDir, 'test.txt');
  writeFileSync(testFile, 'server-owned-content');

  try {
    const backend = createCommandBackend({
      allowlist: ['cat', 'node'],
      defaultCwd: tmpDir,
      timeoutMs: 5_000,
      outputCapBytes: 65_536,
    });

    const result = await backend.execute({
      taskId: 'task-1',
      proposalId: 'prop-1',
      prompt: 'cat test.txt',
    });

    assert.equal(result.ok, true);
    assert.match(result.stdout, /server-owned-content/);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('command backend respects per-task workingDirectory', async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'cli-bridge-backend-wd-'));
  const testFile = join(tmpDir, 'task-scoped.txt');
  writeFileSync(testFile, 'task-scoped-content');

  try {
    const backend = createCommandBackend({
      allowlist: ['cat'],
      defaultCwd: tmpdir(), // different from task cwd
      timeoutMs: 5_000,
      outputCapBytes: 65_536,
    });

    const result = await backend.execute({
      taskId: 'task-1',
      proposalId: 'prop-1',
      prompt: 'cat task-scoped.txt',
      workingDirectory: tmpDir,
    });

    assert.equal(result.ok, true);
    assert.match(result.stdout, /task-scoped-content/);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('command backend captures stderr', async () => {
  const backend = createCommandBackend({
    allowlist: ['node'],
    defaultCwd: tmpdir(),
    timeoutMs: 5_000,
    outputCapBytes: 65_536,
  });

  const result = await backend.execute({
    taskId: 'task-1',
    proposalId: 'prop-1',
    prompt: 'node -e "console.error(\'stderr output\')"',
  });

  assert.match(result.stderr, /stderr output/);
});

test('command backend handles quoted arguments', async () => {
  const backend = createCommandBackend({
    allowlist: ['node'],
    defaultCwd: tmpdir(),
    timeoutMs: 5_000,
    outputCapBytes: 65_536,
  });

  const result = await backend.execute({
    taskId: 'task-1',
    proposalId: 'prop-1',
    prompt: 'node -e "console.log(\'hello world\')"',
  });

  assert.equal(result.ok, true);
  assert.match(result.stdout, /hello world/);
});

test('command backend handles command not found', async () => {
  const backend = createCommandBackend({
    allowlist: ['nonexistent-command-xyz'],
    defaultCwd: tmpdir(),
    timeoutMs: 5_000,
    outputCapBytes: 65_536,
  });

  const result = await backend.execute({
    taskId: 'task-1',
    proposalId: 'prop-1',
    prompt: 'nonexistent-command-xyz arg1',
  });

  assert.equal(result.ok, false);
  assert.match(result.failureReason, /Spawn error/);
});
