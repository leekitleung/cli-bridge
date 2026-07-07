// Unit tests for executor-registry.ts

import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  ExecutorRegistry,
  getExecutorRegistry,
  setExecutorRegistry,
  type ExecutorBackend,
  type ExecutorTask,
  type ExecutorCapabilities,
} from '../../apps/local-server/src/execution/executor-registry.ts';

// Mock executor for testing
function createMockExecutor(
  id: string,
  healthy: boolean = true,
  capabilities: Partial<ExecutorCapabilities> = {},
): ExecutorBackend {
  const defaultCaps: ExecutorCapabilities = {
    id,
    name: `Mock Executor ${id}`,
    transport: 'http',
    canExecute: true,
    canReturnOutput: true,
    ...capabilities,
  };

  return {
    id,
    getCapabilities: () => defaultCaps,
    execute: async (task: ExecutorTask) => ({
      ok: true,
      stdout: `Executed: ${task.prompt}`,
      durationMs: 100,
    }),
    healthCheck: async () => healthy,
  };
}

describe('ExecutorRegistry', () => {
  test('should register and retrieve executor', () => {
    const registry = new ExecutorRegistry();
    const executor = createMockExecutor('test-1');

    registry.register(executor);
    const retrieved = registry.get('test-1');

    assert.strictEqual(retrieved?.id, 'test-1');
  });

  test('should list all registered executors', () => {
    const registry = new ExecutorRegistry();
    registry.register(createMockExecutor('exec-1'));
    registry.register(createMockExecutor('exec-2'));

    const executors = registry.list();

    assert.strictEqual(executors.length, 2);
  });

  test('should select default executor', () => {
    const registry = new ExecutorRegistry({ defaultExecutorId: 'default-exec' });
    registry.register(createMockExecutor('other'));
    registry.register(createMockExecutor('default-exec'));

    const selected = registry.select();

    assert.strictEqual(selected?.id, 'default-exec');
  });

  test('should select first healthy executor when default is unhealthy', () => {
    const registry = new ExecutorRegistry({ defaultExecutorId: 'sick' });
    registry.register(createMockExecutor('sick', true)); // Registered as healthy initially
    registry.register(createMockExecutor('healthy', true));

    // Manually mark 'sick' as unhealthy
    registry.updateHealth('sick', false);

    const selected = registry.select();

    assert.strictEqual(selected?.id, 'healthy');
  });

  test('should round-robin select executors', () => {
    const registry = new ExecutorRegistry({ selectionStrategy: 'round-robin' });
    registry.register(createMockExecutor('a'));
    registry.register(createMockExecutor('b'));

    const selected1 = registry.select();
    const selected2 = registry.select();

    assert.notStrictEqual(selected1?.id, selected2?.id);
  });

  test('should select by capability tags', () => {
    const registry = new ExecutorRegistry({ selectionStrategy: 'capability-match' });
    registry.register(createMockExecutor('exec-1', true, { tags: ['cli'] }));
    registry.register(createMockExecutor('exec-2', true, { tags: ['cli', 'docker'] }));

    const selected = registry.select({ preferredTags: ['docker'] });

    assert.strictEqual(selected?.id, 'exec-2');
  });

  test('should execute task with selected executor', async () => {
    const registry = new ExecutorRegistry();
    registry.register(createMockExecutor('exec'));

    const result = await registry.execute({
      taskId: 'task-1',
      proposalId: 'prop-1',
      prompt: 'test prompt',
    });

    assert.strictEqual(result.ok, true);
    assert.ok(result.stdout.includes('test prompt'));
  });

  test('should return error when no executor available', async () => {
    const registry = new ExecutorRegistry();

    const result = await registry.execute({
      taskId: 'task-1',
      proposalId: 'prop-1',
      prompt: 'test prompt',
    });

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.failureReason, 'no-available-executor');
  });

  test('should update health status', () => {
    const registry = new ExecutorRegistry();
    registry.register(createMockExecutor('exec', true));

    let status = registry.getStatus();
    assert.strictEqual(status.healthy, 1);

    registry.updateHealth('exec', false);
    status = registry.getStatus();
    assert.strictEqual(status.healthy, 0);
  });

  test('should unregister executor', () => {
    const registry = new ExecutorRegistry();
    registry.register(createMockExecutor('exec'));

    registry.unregister('exec');

    assert.strictEqual(registry.get('exec'), undefined);
    assert.strictEqual(registry.list().length, 0);
  });
});

describe('Global registry singleton', () => {
  test('should create global registry on first call', () => {
    // Clear any existing registry
    setExecutorRegistry(undefined as any);

    const registry = getExecutorRegistry();

    assert.ok(registry instanceof ExecutorRegistry);
  });

  test('should return same instance on subsequent calls', () => {
    const registry1 = getExecutorRegistry();
    const registry2 = getExecutorRegistry();

    assert.strictEqual(registry1, registry2);
  });

  test('should allow setting custom registry', () => {
    const custom = new ExecutorRegistry();
    setExecutorRegistry(custom);

    assert.strictEqual(getExecutorRegistry(), custom);

    // Reset
    setExecutorRegistry(new ExecutorRegistry());
  });
});
