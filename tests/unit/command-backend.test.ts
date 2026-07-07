// Unit tests for command-backend.ts - shell metacharacter validation

import { test, describe } from 'node:test';
import assert from 'node:assert';
import { createCommandBackend } from '../../apps/local-server/src/workbuddy/command-backend.ts';

describe('command-backend shell metacharacter validation', () => {
  test('should reject command with pipe metacharacter', async () => {
    const backend = createCommandBackend({
      allowlist: ['echo', 'dir'],
      defaultCwd: '/tmp',
      timeoutMs: 5000,
      outputCapBytes: 1024,
    });

    const result = await backend.execute({
      taskId: 'test-1',
      proposalId: 'prop-1',
      prompt: 'echo hello | cat',
    });

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.failureReason, 'shell-metacharacter-detected');
  });

  test('should reject command with semicolon metacharacter', async () => {
    const backend = createCommandBackend({
      allowlist: ['echo', 'dir'],
      defaultCwd: '/tmp',
      timeoutMs: 5000,
      outputCapBytes: 1024,
    });

    const result = await backend.execute({
      taskId: 'test-2',
      proposalId: 'prop-2',
      prompt: 'echo hello; rm -rf /',
    });

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.failureReason, 'shell-metacharacter-detected');
  });

  test('should reject command with command substitution', async () => {
    const backend = createCommandBackend({
      allowlist: ['echo'],
      defaultCwd: '/tmp',
      timeoutMs: 5000,
      outputCapBytes: 1024,
    });

    const result = await backend.execute({
      taskId: 'test-3',
      proposalId: 'prop-3',
      prompt: 'echo $(whoami)',
    });

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.failureReason, 'shell-metacharacter-detected');
  });

  test('should reject command with backtick substitution', async () => {
    const backend = createCommandBackend({
      allowlist: ['echo'],
      defaultCwd: '/tmp',
      timeoutMs: 5000,
      outputCapBytes: 1024,
    });

    const result = await backend.execute({
      taskId: 'test-4',
      proposalId: 'prop-4',
      prompt: 'echo `id`',
    });

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.failureReason, 'shell-metacharacter-detected');
  });

  test('should reject command with AND operator', async () => {
    const backend = createCommandBackend({
      allowlist: ['echo', 'ls'],
      defaultCwd: '/tmp',
      timeoutMs: 5000,
      outputCapBytes: 1024,
    });

    const result = await backend.execute({
      taskId: 'test-5',
      proposalId: 'prop-5',
      prompt: 'echo hello && ls',
    });

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.failureReason, 'shell-metacharacter-detected');
  });

  test('should reject command with OR operator', async () => {
    const backend = createCommandBackend({
      allowlist: ['echo', 'ls'],
      defaultCwd: '/tmp',
      timeoutMs: 5000,
      outputCapBytes: 1024,
    });

    const result = await backend.execute({
      taskId: 'test-6',
      proposalId: 'prop-6',
      prompt: 'echo hello || ls',
    });

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.failureReason, 'shell-metacharacter-detected');
  });

  test('should reject command with redirection', async () => {
    const backend = createCommandBackend({
      allowlist: ['echo'],
      defaultCwd: '/tmp',
      timeoutMs: 5000,
      outputCapBytes: 1024,
    });

    const result = await backend.execute({
      taskId: 'test-7',
      proposalId: 'prop-7',
      prompt: 'echo hello > /tmp/out.txt',
    });

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.failureReason, 'shell-metacharacter-detected');
  });

  test('should accept valid command without metacharacters', async () => {
    const backend = createCommandBackend({
      allowlist: ['echo'],
      defaultCwd: '/tmp',
      timeoutMs: 5000,
      outputCapBytes: 1024,
    });

    const result = await backend.execute({
      taskId: 'test-8',
      proposalId: 'prop-8',
      prompt: 'echo hello world',
    });

    // Note: This may fail due to environment limitations in test, but should NOT fail with shell-metacharacter-detected
    assert.notStrictEqual(result.failureReason, 'shell-metacharacter-detected');
  });

  test('should reject empty prompt', async () => {
    const backend = createCommandBackend({
      allowlist: ['echo'],
      defaultCwd: '/tmp',
      timeoutMs: 5000,
      outputCapBytes: 1024,
    });

    const result = await backend.execute({
      taskId: 'test-9',
      proposalId: 'prop-9',
      prompt: '',
    });

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.failureReason, 'Empty prompt');
  });
});
