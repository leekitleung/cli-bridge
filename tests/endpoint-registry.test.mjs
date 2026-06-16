import assert from 'node:assert/strict';
import test from 'node:test';

import {
  InMemoryEndpointRegistry,
} from '../apps/local-server/src/endpoints/endpoint-registry.ts';
import {
  DEFAULT_AGENT_ENDPOINTS,
  MOCK_INBOUND_AGENT_ENDPOINT,
} from '../apps/local-server/src/endpoints/mock-endpoints.ts';

test('registry register/list/get works', () => {
  const registry = new InMemoryEndpointRegistry();
  const registered = registry.register(DEFAULT_AGENT_ENDPOINTS[0]);

  assert.equal(registered.ok, true);
  assert.deepEqual(registry.list().map((endpoint) => endpoint.id), ['mock-agent']);
  assert.equal(registry.get('mock-agent')?.label, 'Mock Agent');
});

test('registry denies duplicate and unknown endpoints', () => {
  const registry = new InMemoryEndpointRegistry();
  registry.register(DEFAULT_AGENT_ENDPOINTS[0]);

  assert.deepEqual(registry.register(DEFAULT_AGENT_ENDPOINTS[0]), {
    ok: false,
    failureReason: 'duplicate-endpoint-id',
  });
  assert.deepEqual(registry.validateAction('unknown', 'accept-prompt'), {
    ok: false,
    failureReason: 'endpoint-not-found',
  });
});

test('registry denies capability false and allows capability true', () => {
  const registry = new InMemoryEndpointRegistry(DEFAULT_AGENT_ENDPOINTS);

  assert.equal(registry.can('mock-agent', 'accept-prompt'), true);
  assert.equal(registry.can('mock-agent', 'review'), false);
  assert.equal(registry.can('mock-agent', 'execute'), false);
  assert.deepEqual(registry.validateAction('mock-agent', 'review'), {
    ok: false,
    failureReason: 'capability-denied',
  });
  assert.deepEqual(registry.validateAction('mock-agent', 'accept-prompt'), {
    ok: true,
  });
});

test('default registry metadata preserves v0.4 endpoint boundaries', () => {
  const registry = new InMemoryEndpointRegistry(DEFAULT_AGENT_ENDPOINTS);

  assert.equal(registry.can('codex-cli', 'accept-prompt'), true);
  assert.equal(registry.can('codex-cli', 'execute'), false);
  assert.equal(registry.get('codex-cli')?.experimental, true);
  assert.equal(registry.can('chatgpt-web', 'accept-prompt'), true);
  assert.equal(registry.can('chatgpt-web', 'return-output'), true);
  assert.equal(registry.can('mock-review-agent', 'review'), false);
});

test('mock-inbound-agent can receive inbound while default executors cannot', () => {
  // The manual/local E2E endpoint is the only inbound-capable one, and it is NOT
  // part of the default executor set.
  assert.equal(MOCK_INBOUND_AGENT_ENDPOINT.id, 'mock-inbound-agent');
  assert.equal(MOCK_INBOUND_AGENT_ENDPOINT.capabilities.canReceiveInbound, true);
  assert.equal(
    DEFAULT_AGENT_ENDPOINTS.some((endpoint) => endpoint.id === 'mock-inbound-agent'),
    false,
    'manual E2E endpoint must not leak into DEFAULT_AGENT_ENDPOINTS',
  );

  const registry = new InMemoryEndpointRegistry([
    ...DEFAULT_AGENT_ENDPOINTS,
    MOCK_INBOUND_AGENT_ENDPOINT,
  ]);
  assert.equal(registry.can('mock-inbound-agent', 'receive-inbound'), true);
  // No real/default executor was made inbound-capable.
  for (const endpoint of DEFAULT_AGENT_ENDPOINTS) {
    assert.equal(
      registry.can(endpoint.id, 'receive-inbound'),
      false,
      `${endpoint.id} must not be inbound-capable`,
    );
  }
});
