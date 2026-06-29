import assert from 'node:assert/strict';
import test from 'node:test';

import {
  InMemoryEndpointRegistry,
} from '../apps/local-server/src/endpoints/endpoint-registry.ts';
import {
  validateEndpointRegistration,
  validateEndpointStatus,
} from '../packages/shared/src/schemas.ts';
import {
  DEFAULT_AGENT_ENDPOINTS,
  MOCK_INBOUND_AGENT_ENDPOINT,
  WORKBUDDY_EXECUTOR_ENDPOINT,
} from '../apps/local-server/src/endpoints/mock-endpoints.ts';

test('registry register/list/get works', () => {
  const registry = new InMemoryEndpointRegistry();
  const registered = registry.register(DEFAULT_AGENT_ENDPOINTS[0]);

  assert.equal(registered.ok, true);
  assert.deepEqual(registry.list().map((endpoint) => endpoint.id), ['mock-agent']);
  assert.equal(registry.get('mock-agent')?.label, 'Mock Agent');
});

test('registry accepts re-registration (heartbeat-like) and lists correctly', () => {
  const registry = new InMemoryEndpointRegistry();
  registry.register(DEFAULT_AGENT_ENDPOINTS[0]);

  // Re-registration with same id should succeed (updates existing, not rejects).
  const reRegistered = registry.register(DEFAULT_AGENT_ENDPOINTS[0]);
  assert.equal(reRegistered.ok, true);
  assert.equal(registry.get('mock-agent')?.status, 'online');

  // Unknown endpoint validation still fails.
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

// ── EX-1: Endpoint Session Registry (registration, heartbeat, offline, discovery) ──

test('EX-1: register endpoint → status online, lastSeenAt set', () => {
  const registry = new InMemoryEndpointRegistry();
  const result = registry.register(DEFAULT_AGENT_ENDPOINTS[0]);
  assert.equal(result.ok, true);
  const endpoint = registry.get('mock-agent');
  assert.equal(endpoint.status, 'online');
  assert.ok(typeof endpoint.lastSeenAt === 'number');
  assert.ok(endpoint.lastSeenAt > 0);
});

test('EX-1: heartbeat updates lastSeenAt', async () => {
  const registry = new InMemoryEndpointRegistry();
  registry.register(DEFAULT_AGENT_ENDPOINTS[0]);
  const before = registry.get('mock-agent').lastSeenAt;
  // Small delay to guarantee timestamp difference.
  await new Promise(resolve => setTimeout(resolve, 5));
  const result = registry.heartbeat('mock-agent');
  assert.equal(result.ok, true);
  const after = registry.get('mock-agent').lastSeenAt;
  assert.ok(after > before, 'lastSeenAt should increase after heartbeat');
});

test('EX-1: offline sets status offline', () => {
  const registry = new InMemoryEndpointRegistry();
  registry.register(DEFAULT_AGENT_ENDPOINTS[0]);
  const result = registry.offline('mock-agent');
  assert.equal(result.ok, true);
  assert.equal(registry.get('mock-agent').status, 'offline');
});

test('EX-1: listOnline excludes offline endpoints', () => {
  const registry = new InMemoryEndpointRegistry();
  registry.register(DEFAULT_AGENT_ENDPOINTS[0]); // mock-agent → online
  registry.register({ ...DEFAULT_AGENT_ENDPOINTS[1], id: 'offline-test' }); // clipboard variant → online
  registry.offline('offline-test');
  const online = registry.listOnline();
  assert.equal(online.length, 1);
  assert.equal(online[0].id, 'mock-agent');
});

test('EX-1: listByProject filters correctly', () => {
  const registry = new InMemoryEndpointRegistry();
  registry.register({ ...DEFAULT_AGENT_ENDPOINTS[0], projectRef: 'project-a' });
  registry.register({ ...DEFAULT_AGENT_ENDPOINTS[1], id: 'ep-b', projectRef: 'project-b' });
  registry.register({ ...DEFAULT_AGENT_ENDPOINTS[1], id: 'ep-a2', projectRef: 'project-a' });
  const a = registry.listByProject('project-a');
  assert.equal(a.length, 2);
  assert.deepEqual(a.map(e => e.id).sort(), ['ep-a2', 'mock-agent']);
});

test('EX-1: heartbeat on offline endpoint returns error', () => {
  const registry = new InMemoryEndpointRegistry();
  registry.register(DEFAULT_AGENT_ENDPOINTS[0]);
  registry.offline('mock-agent');
  const result = registry.heartbeat('mock-agent');
  assert.equal(result.ok, false);
  assert.equal(result.failureReason, 'endpoint-offline');
});

test('EX-1: workbuddy executor endpoint registers with correct capabilities', () => {
  const registry = new InMemoryEndpointRegistry();
  const result = registry.register(WORKBUDDY_EXECUTOR_ENDPOINT);
  assert.equal(result.ok, true);
  const ep = registry.get('workbuddy-executor');
  assert.equal(ep.transport, 'workbuddy');
  assert.equal(ep.capabilities.canExecute, false, 'stays false until EX-4');
  assert.equal(ep.capabilities.canReview, true);
  assert.equal(ep.status, 'online');
});

test('EX-1: transport validation rejects unknown values', () => {
  const result = validateEndpointRegistration({
    endpointId: 'test',
    label: 'Test',
    transport: 'unknown-transport',
    capabilities: { canAcceptPrompt: true, canReturnOutput: true, canReview: false, canExecute: false, canSummarize: false },
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(e => e.includes('transport')));
});

test('EX-1: status validation rejects invalid values', () => {
  assert.equal(validateEndpointStatus('online').ok, true);
  assert.equal(validateEndpointStatus('offline').ok, true);
  assert.equal(validateEndpointStatus('busy').ok, true);
  assert.equal(validateEndpointStatus('unknown').ok, false);
  assert.equal(validateEndpointStatus('').ok, false);
});

test('EX-1: re-registration updates existing endpoint', () => {
  const registry = new InMemoryEndpointRegistry();
  registry.register(DEFAULT_AGENT_ENDPOINTS[0]);
  // Re-register with different label.
  const updated = { ...DEFAULT_AGENT_ENDPOINTS[0], label: 'Updated Mock Agent' };
  const result = registry.register(updated);
  assert.equal(result.ok, true);
  assert.equal(registry.get('mock-agent').label, 'Updated Mock Agent');
  assert.equal(registry.get('mock-agent').status, 'online');
});

test('EX-1: offline twice returns already-offline error', () => {
  const registry = new InMemoryEndpointRegistry();
  registry.register(DEFAULT_AGENT_ENDPOINTS[0]);
  registry.offline('mock-agent');
  const second = registry.offline('mock-agent');
  assert.equal(second.ok, false);
  assert.equal(second.failureReason, 'endpoint-already-offline');
});

test('EX-1: validateAction rejects offline endpoint', () => {
  const registry = new InMemoryEndpointRegistry();
  registry.register(DEFAULT_AGENT_ENDPOINTS[0]);
  registry.offline('mock-agent');
  const result = registry.validateAction('mock-agent', 'accept-prompt');
  assert.equal(result.ok, false);
  assert.equal(result.failureReason, 'endpoint-offline');
});

test('EX-1: hydrateEndpoint sets status to offline', () => {
  const registry = new InMemoryEndpointRegistry();
  registry.hydrateEndpoint({ ...DEFAULT_AGENT_ENDPOINTS[0], status: 'online', lastSeenAt: 1000 });
  const ep = registry.get('mock-agent');
  assert.equal(ep.status, 'offline', 'hydrated endpoints must heartbeat to come online');
});

test('EX-1: exportEndpoints returns all endpoints', () => {
  const registry = new InMemoryEndpointRegistry();
  registry.register(DEFAULT_AGENT_ENDPOINTS[0]);
  registry.register({ ...DEFAULT_AGENT_ENDPOINTS[1], id: 'ep-2' });
  const exported = registry.exportEndpoints();
  assert.equal(exported.length, 2);
  assert.deepEqual(exported.map(e => e.id).sort(), ['ep-2', 'mock-agent']);
});
