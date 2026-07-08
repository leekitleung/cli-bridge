// Unit tests for executor-registry.ts

import { test, describe } from 'node:test';
import assert from 'node:assert';

// Mock executor for testing
function createMockExecutor(id: string, healthy = true) {
  return {
    id,
    getCapabilities: () => ({
      id,
      name: `Mock ${id}`,
      transport: 'cli' as const,
      tags: ['test'],
    }),
    execute: async () => ({ ok: true, stdout: 'ok', durationMs: 10 }),
    healthCheck: async () => healthy,
  };
}

describe('ExecutorRegistry mock', () => {
  test('should create mock executor with correct id', () => {
    const executor = createMockExecutor('test-executor');
    assert.strictEqual(executor.id, 'test-executor');
  });

  test('should return correct capabilities', () => {
    const executor = createMockExecutor('test');
    const caps = executor.getCapabilities();
    assert.strictEqual(caps.id, 'test');
    assert.strictEqual(caps.name, 'Mock test');
    assert.ok(Array.isArray(caps.tags));
  });

  test('should execute successfully', async () => {
    const executor = createMockExecutor('test');
    const result = await executor.execute({ taskId: 't1', proposalId: 'p1', prompt: 'test' });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.stdout, 'ok');
  });

  test('should report health status', async () => {
    const healthy = createMockExecutor('healthy', true);
    const unhealthy = createMockExecutor('unhealthy', false);

    assert.strictEqual(await healthy.healthCheck!(), true);
    assert.strictEqual(await unhealthy.healthCheck!(), false);
  });

  test('should support tags', () => {
    const executor = createMockExecutor('tagged');
    const caps = executor.getCapabilities();
    assert.ok(caps.tags!.includes('test'));
  });
});

describe('Executor capabilities types', () => {
  test('should support all transport types', () => {
    const transports = ['workbuddy', 'http', 'cli', 'stdio', 'process'] as const;
    for (const t of transports) {
      const caps = { id: 't', name: 't', transport: t };
      assert.strictEqual(caps.transport, t);
    }
  });

  test('should support risk levels', () => {
    const risks = ['low', 'medium', 'high'] as const;
    for (const r of risks) {
      const caps = { id: 't', name: 't', risk: r };
      assert.strictEqual(caps.risk, r);
    }
  });

  test('should support optional fields', () => {
    const minimal = { id: 't', name: 't', transport: 'cli' as const };
    const full = {
      id: 't',
      name: 't',
      transport: 'cli' as const,
      risk: 'low' as const,
      canAcceptPrompt: true,
      canReturnOutput: true,
      canReview: false,
      canExecute: true,
      canSummarize: false,
      streaming: true,
      maxConcurrency: 5,
      tags: ['test', 'cli'],
    };
    assert.ok(minimal.transport);
    assert.ok(full.maxConcurrency);
    assert.strictEqual(full.tags!.length, 2);
  });
});
