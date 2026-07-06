// ADR-0035: Source Adapter Registry tests.

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SourceAdapterRegistry,
} from '../apps/local-server/src/conversation/source-adapter.ts';
import { createBridgeRuntime } from '../apps/local-server/src/routes/bridge-api.ts';
import {
  ChatGptWebSourceQueue,
  createChatGptWebSourceAdapter,
} from '../apps/local-server/src/conversation/chatgpt-web-source-adapter.ts';

test('registry resolves adapter by endpoint id', () => {
  const registry = new SourceAdapterRegistry();
  registry.register({
    endpointId: 'codex-cli',
    kind: 'codex-cli',
    isAvailable() { return true; },
    async plan() {
      return {
        id: 'out-1',
        sessionId: 's1',
        plannerEndpointId: 'codex-cli',
        visibleText: 'Codex answer',
        intent: 'answer',
        createdAt: new Date().toISOString(),
      };
    },
  });

  const resolved = registry.resolve('codex-cli');
  assert.ok(resolved, 'should resolve codex-cli adapter');
  assert.equal(resolved.endpointId, 'codex-cli');
  assert.equal(resolved.kind, 'codex-cli');
});

test('registry returns undefined for unknown endpoint', () => {
  const registry = new SourceAdapterRegistry();
  const resolved = registry.resolve('unknown-endpoint');
  assert.equal(resolved, undefined, 'unknown endpoint should return undefined');
});

test('registry lists all registered adapters', () => {
  const registry = new SourceAdapterRegistry();
  registry.register({
    endpointId: 'codex-cli',
    kind: 'codex-cli',
    isAvailable() { return true; },
    async plan() {
      return { id: '1', sessionId: 's', plannerEndpointId: 'codex-cli', visibleText: '', intent: 'answer', createdAt: '' };
    },
  });
  registry.register({
    endpointId: 'chatgpt-web',
    kind: 'chatgpt-web',
    isAvailable() { return false; },
    async plan() {
      return { id: '2', sessionId: 's', plannerEndpointId: 'chatgpt-web', visibleText: '', intent: 'blocked', createdAt: '' };
    },
  });

  const list = registry.list();
  assert.equal(list.length, 2);
  const kinds = list.map(a => a.kind).sort();
  assert.deepEqual(kinds, ['chatgpt-web', 'codex-cli']);
});

test('registry overwrites adapter on re-register', () => {
  const registry = new SourceAdapterRegistry();
  registry.register({
    endpointId: 'codex-cli',
    kind: 'codex-cli',
    isAvailable() { return true; },
    async plan() {
      return { id: '1', sessionId: 's', plannerEndpointId: 'codex-cli', visibleText: 'v1', intent: 'answer', createdAt: '' };
    },
  });

  registry.register({
    endpointId: 'codex-cli',
    kind: 'codex-cli',
    isAvailable() { return true; },
    async plan() {
      return { id: '2', sessionId: 's', plannerEndpointId: 'codex-cli', visibleText: 'v2', intent: 'answer', createdAt: '' };
    },
  });

  assert.equal(registry.list().length, 1, 're-register should overwrite, not duplicate');
});

test('isAvailable is checked per adapter', () => {
  const registry = new SourceAdapterRegistry();
  let checked = false;
  registry.register({
    endpointId: 'chatgpt-web',
    kind: 'chatgpt-web',
    isAvailable(input) {
      checked = true;
      return input.endpointId === 'chatgpt-web';
    },
    async plan() {
      return { id: '1', sessionId: 's', plannerEndpointId: 'chatgpt-web', visibleText: '', intent: 'answer', createdAt: '' };
    },
  });

  const adapter = registry.resolve('chatgpt-web');
  assert.ok(adapter);
  assert.equal(adapter.isAvailable({ projectId: 'p1', endpointId: 'chatgpt-web' }), true);
  assert.equal(checked, true);
});

test('chatgpt-web source queue atomically claims next request', () => {
  const queue = new ChatGptWebSourceQueue();
  queue.enqueue({ projectId: 'p1', sessionId: 's1', prompt: 'hello' });

  const first = queue.claimNext();
  const second = queue.claimNext();

  assert.ok(first, 'first claim receives pending request');
  assert.equal(first.status, 'claimed');
  assert.equal(second, undefined, 'second claim must not receive the same request');
});

test('chatgpt-web source queue can mark stale claimed requests failed', () => {
  const queue = new ChatGptWebSourceQueue();
  const enqueued = queue.enqueue({ projectId: 'p1', sessionId: 's1', prompt: 'hello' });
  const claimed = queue.claim(enqueued.id);
  assert.equal(claimed?.status, 'claimed');

  const failed = queue.fail(enqueued.id);
  assert.equal(failed?.status, 'failed');
  assert.equal(typeof failed?.failedAt, 'number');
  assert.equal(queue.recordResult(enqueued.id, 'late'), undefined);
});

test('chatgpt-web source adapter marks request failed when result times out', async () => {
  const queue = new ChatGptWebSourceQueue();
  const adapter = createChatGptWebSourceAdapter({
    queue,
    config: { resultTimeoutMs: 1 },
  });

  const result = await adapter.plan({
    projectId: 'p1',
    sessionId: 's1',
    userText: 'hello',
  });

  assert.equal(result.intent, 'blocked');
  const [recent] = queue.listRecent(1);
  assert.equal(recent.status, 'failed');
  assert.equal(typeof recent.failedAt, 'number');
});

test('default bridge runtime registers built-in conversation source adapters', () => {
  const runtime = createBridgeRuntime();

  assert.ok(runtime.sourceAdapterRegistry.resolve('chatgpt-web'));
  assert.ok(runtime.sourceAdapterRegistry.resolve('codex-cli'));
  assert.ok(runtime.sourceAdapterRegistry.resolve('claude-code'));
});
