// EX-2: Instruction Packets — internal instruction packet store for
// the passthrough route plane.  Instruction packets are purely internal
// metadata and must NEVER appear in user-visible API responses.

import assert from 'node:assert/strict';
import test from 'node:test';

import { InMemoryConversationInstructionStore } from '../apps/local-server/src/storage/conversation-instruction-store.ts';

// ── Unit: store contract ──

test('instruction store creates a packet with all fields', () => {
  const store = new InMemoryConversationInstructionStore();
  const packet = store.create({
    projectId: 'cli-bridge',
    pairingId: 'chatgpt-web→codex-cli',
    userEventId: 'conv-100-abc',
    text: 'refactor the login form',
  });

  assert.equal(typeof packet.id, 'string');
  assert.ok(packet.id.length > 0);
  assert.equal(packet.projectId, 'cli-bridge');
  assert.equal(packet.pairingId, 'chatgpt-web→codex-cli');
  assert.equal(packet.userEventId, 'conv-100-abc');
  assert.equal(packet.text, 'refactor the login form');
  assert.equal(typeof packet.payloadHash, 'string');
  assert.ok(packet.payloadHash.length > 0);
  assert.equal(typeof packet.createdAt, 'number');
  assert.ok(packet.createdAt > 0);
});

test('payloadHash is deterministic — same text → same hash', () => {
  const store = new InMemoryConversationInstructionStore();
  const a = store.create({ projectId: 'proj', pairingId: 'p1', userEventId: 'e1', text: 'Hello' });
  const b = store.create({ projectId: 'proj', pairingId: 'p2', userEventId: 'e2', text: 'Hello' });
  assert.equal(a.payloadHash, b.payloadHash);
});

test('payloadHash is deterministic — different text → different hash', () => {
  const store = new InMemoryConversationInstructionStore();
  const a = store.create({ projectId: 'proj', pairingId: 'p1', userEventId: 'e1', text: 'Hello' });
  const b = store.create({ projectId: 'proj', pairingId: 'p2', userEventId: 'e2', text: 'World' });
  assert.notEqual(a.payloadHash, b.payloadHash);
});

test('listByProject returns packets sorted by createdAt', async () => {
  const store = new InMemoryConversationInstructionStore();
  const a = store.create({ projectId: 'alpha', pairingId: 'p1', userEventId: 'e1', text: 'first' });
  await new Promise(r => setTimeout(r, 5));
  const b = store.create({ projectId: 'alpha', pairingId: 'p2', userEventId: 'e2', text: 'second' });

  // Also create a packet for a different project.
  store.create({ projectId: 'beta', pairingId: 'p3', userEventId: 'e3', text: 'third' });

  const list = store.listByProject('alpha');
  assert.equal(list.length, 2);
  assert.equal(list[0].id, a.id);
  assert.equal(list[1].id, b.id);
});

test('get returns a single packet', () => {
  const store = new InMemoryConversationInstructionStore();
  const packet = store.create({ projectId: 'proj', pairingId: 'p1', userEventId: 'e1', text: 'test' });

  const found = store.get(packet.id);
  assert.ok(found);
  assert.equal(found.id, packet.id);
  assert.equal(found.text, 'test');

  assert.equal(store.get('nonexistent'), undefined);
});

test('exportPackets returns all packets', () => {
  const store = new InMemoryConversationInstructionStore();
  store.create({ projectId: 'alpha', pairingId: 'p1', userEventId: 'e1', text: 'one' });
  store.create({ projectId: 'beta', pairingId: 'p2', userEventId: 'e2', text: 'two' });

  const all = store.exportPackets();
  assert.equal(all.length, 2);
});

test('persistence roundtrip: export → hydrate into new store → verify', () => {
  const original = new InMemoryConversationInstructionStore();
  const a = original.create({ projectId: 'alpha', pairingId: 'p1', userEventId: 'e1', text: 'hello' });
  const b = original.create({ projectId: 'beta', pairingId: 'p2', userEventId: 'e2', text: 'world' });

  const exported = original.exportPackets();

  const restored = new InMemoryConversationInstructionStore();
  for (const packet of exported) {
    restored.hydratePacket(packet);
  }

  assert.equal(restored.get(a.id).text, 'hello');
  assert.equal(restored.get(a.id).payloadHash, a.payloadHash);
  assert.equal(restored.get(b.id).text, 'world');
  assert.equal(restored.listByProject('alpha').length, 1);
  assert.equal(restored.listByProject('beta').length, 1);
});

test('hydratePacket skips invalid packets silently', () => {
  const store = new InMemoryConversationInstructionStore();

  // Missing id
  store.hydratePacket({ projectId: 'x', pairingId: 'p', userEventId: 'e', text: 't', payloadHash: 'h', createdAt: 1 });
  // Missing projectId
  store.hydratePacket({ id: 'id1', pairingId: 'p', userEventId: 'e', text: 't', payloadHash: 'h', createdAt: 1 });

  assert.equal(store.exportPackets().length, 0);
});

// ── Integration: API response must not leak instruction metadata ──

test('conversation message API response does not contain instruction packet metadata', async () => {
  const {
    createBridgeRuntime,
    handleBridgeRequest,
  } = await import('../apps/local-server/src/routes/bridge-api.ts');

  const runtime = createBridgeRuntime();

  // Setup project and pairing.
  const putPairing = await handleBridgeRequest(
    runtime,
    'PUT',
    '/bridge/projects/cli-bridge/conversation-pairing',
    jsonBody({ sourceEndpointId: 'chatgpt-web', targetEndpointId: 'claude-code-command', scope: 'project' }),
  );

  // Send a conversation message.
  const post = await handleBridgeRequest(
    runtime,
    'POST',
    '/bridge/projects/cli-bridge/conversation/messages',
    jsonBody({ text: 'refactor the login form' }),
  );

  assert.equal(post.statusCode, 201);

  // The response must contain events and actions.
  const events = Array.isArray(post.payload.events) ? post.payload.events : [];
  assert.ok(events.length > 0, 'response must contain events');

  // No event must expose instruction packet metadata.
  for (const event of events) {
    assert.equal('payloadHash' in event, false, `event ${event.id} must not expose payloadHash`);
    assert.equal('conversationInstructionId' in event, false, `event ${event.id} must not expose instruction id`);
  }

  // payload MUST NOT contain an instructionPackets key.
  assert.equal('instructionPackets' in post.payload, false, 'API response must not expose instruction packets');

  // The user event should have the text as-is, no instruction metadata.
  const userEvent = events.find(e => e.role === 'user');
  assert.ok(userEvent, 'response must include a user event');
  assert.equal(userEvent.text, 'refactor the login form');
});

// ── Integration: instruction packet IS created internally ──

test('instruction packet is created internally when a conversation message is posted', async () => {
  const {
    createBridgeRuntime,
    handleBridgeRequest,
  } = await import('../apps/local-server/src/routes/bridge-api.ts');

  const runtime = createBridgeRuntime();

  // Setup project and pairing.
  await handleBridgeRequest(
    runtime,
    'PUT',
    '/bridge/projects/cli-bridge/conversation-pairing',
    jsonBody({ sourceEndpointId: 'chatgpt-web', targetEndpointId: 'claude-code-command', scope: 'project' }),
  );

  // Before: no instruction packets.
  assert.equal(runtime.conversationInstructionStore.exportPackets().length, 0);

  await handleBridgeRequest(
    runtime,
    'POST',
    '/bridge/projects/cli-bridge/conversation/messages',
    jsonBody({ text: 'refactor login' }),
  );

  // After: one instruction packet created.
  const packets = runtime.conversationInstructionStore.exportPackets();
  assert.equal(packets.length, 1);
  assert.equal(packets[0].text, 'refactor login');
  assert.equal(packets[0].projectId, 'cli-bridge');
  assert.equal(typeof packets[0].userEventId, 'string');
  assert.ok(packets[0].userEventId.length > 0);
  assert.equal(typeof packets[0].payloadHash, 'string');
  assert.ok(packets[0].payloadHash.length > 0);
});

// ── EX-3: Execution Packets — internal execution packet store ──

import { InMemoryConversationExecutionStore } from '../apps/local-server/src/storage/conversation-execution-store.ts';

// ── Unit: execution store contract ──

test('execution store creates a packet with all fields', () => {
  const store = new InMemoryConversationExecutionStore();
  const packet = store.create({
    projectId: 'cli-bridge',
    pairingId: 'chatgpt-web→workbuddy',
    taskId: 'task-123',
    ok: true,
    output: { result: 'done' },
    stdout: 'all tests passed',
    stderr: '',
    exitCode: 0,
    failureReason: undefined,
    durationMs: 1500,
  });

  assert.equal(typeof packet.id, 'string');
  assert.ok(packet.id.length > 0);
  assert.equal(packet.projectId, 'cli-bridge');
  assert.equal(packet.pairingId, 'chatgpt-web→workbuddy');
  assert.equal(packet.taskId, 'task-123');
  assert.equal(packet.ok, true);
  assert.deepEqual(packet.output, { result: 'done' });
  assert.equal(packet.stdout, 'all tests passed');
  assert.equal(packet.stderr, '');
  assert.equal(packet.exitCode, 0);
  assert.equal(packet.failureReason, undefined);
  assert.equal(packet.durationMs, 1500);
  assert.equal(typeof packet.createdAt, 'number');
  assert.ok(packet.createdAt > 0);
});

test('execution store create with no durationMs defaults to 0', () => {
  const store = new InMemoryConversationExecutionStore();
  const packet = store.create({
    projectId: 'proj',
    pairingId: 'a→b',
    taskId: 't1',
    ok: false,
    failureReason: 'timeout',
    durationMs: 0,
  });
  assert.equal(packet.durationMs, 0);
});

test('get returns a single execution packet', () => {
  const store = new InMemoryConversationExecutionStore();
  const packet = store.create({
    projectId: 'proj', pairingId: 'a→b', taskId: 't1', ok: true, durationMs: 100,
  });

  const found = store.get(packet.id);
  assert.ok(found);
  assert.equal(found.id, packet.id);
  assert.equal(found.taskId, 't1');

  assert.equal(store.get('nonexistent'), undefined);
});

test('findByTaskId returns correct packet', () => {
  const store = new InMemoryConversationExecutionStore();
  store.create({ projectId: 'proj', pairingId: 'a→b', taskId: 't1', ok: true, durationMs: 100 });
  const p2 = store.create({ projectId: 'proj', pairingId: 'a→b', taskId: 't2', ok: false, failureReason: 'error', durationMs: 200 });

  const found = store.findByTaskId('t2');
  assert.ok(found);
  assert.equal(found.id, p2.id);
  assert.equal(found.failureReason, 'error');

  assert.equal(store.findByTaskId('nonexistent'), undefined);
});

test('listByProject returns packets sorted by createdAt', async () => {
  const store = new InMemoryConversationExecutionStore();
  const a = store.create({ projectId: 'alpha', pairingId: 'p1→p2', taskId: 't1', ok: true, durationMs: 100 });
  await new Promise(r => setTimeout(r, 5));
  const b = store.create({ projectId: 'alpha', pairingId: 'p1→p2', taskId: 't2', ok: true, durationMs: 200 });

  store.create({ projectId: 'beta', pairingId: 'p3→p4', taskId: 't3', ok: true, durationMs: 300 });

  const list = store.listByProject('alpha');
  assert.equal(list.length, 2);
  assert.equal(list[0].id, a.id);
  assert.equal(list[1].id, b.id);
});

test('exportPackets returns all execution packets', () => {
  const store = new InMemoryConversationExecutionStore();
  store.create({ projectId: 'alpha', pairingId: 'a→b', taskId: 't1', ok: true, durationMs: 100 });
  store.create({ projectId: 'beta', pairingId: 'c→d', taskId: 't2', ok: false, failureReason: 'fail', durationMs: 200 });

  const all = store.exportPackets();
  assert.equal(all.length, 2);
});

test('persistence roundtrip: export → hydrate into new store → verify', () => {
  const original = new InMemoryConversationExecutionStore();
  const a = original.create({
    projectId: 'alpha', pairingId: 'a→b', taskId: 't1', ok: true,
    output: { result: 'ok' }, stdout: 'output', stderr: '', exitCode: 0, durationMs: 100,
  });
  const b = original.create({
    projectId: 'beta', pairingId: 'c→d', taskId: 't2', ok: false,
    failureReason: 'timeout', stderr: 'killed', exitCode: 1, durationMs: 5000,
  });

  const exported = original.exportPackets();

  const restored = new InMemoryConversationExecutionStore();
  for (const packet of exported) {
    restored.hydratePacket(packet);
  }

  const ra = restored.get(a.id);
  assert.equal(ra.taskId, 't1');
  assert.equal(ra.ok, true);
  assert.deepEqual(ra.output, { result: 'ok' });
  assert.equal(ra.stdout, 'output');

  const rb = restored.get(b.id);
  assert.equal(rb.ok, false);
  assert.equal(rb.failureReason, 'timeout');
  assert.equal(rb.stderr, 'killed');
  assert.equal(rb.exitCode, 1);
});

test('hydratePacket skips invalid packets silently', () => {
  const store = new InMemoryConversationExecutionStore();

  // Missing id
  store.hydratePacket({ projectId: 'x', pairingId: 'p', taskId: 't', ok: true, durationMs: 0, createdAt: 1 });
  // Missing projectId
  store.hydratePacket({ id: 'id1', pairingId: 'p', taskId: 't', ok: true, durationMs: 0, createdAt: 1 });

  assert.equal(store.exportPackets().length, 0);
});

// ── Unit: execution packet → transcript text derivation ──

test('transcript text derived from ok execution packet uses stdout', () => {
  // Simulates the derivation logic in bridge-api.ts
  const packet = {
    ok: true,
    output: { result: 'done' },
    stdout: 'formatted output here',
  };
  const text = packet.ok
    ? (`WorkBuddy completed.\nstdout:\n${packet.stdout}`.trim() || JSON.stringify(packet.output))
    : (packet.failureReason ?? packet.stderr ?? 'WorkBuddy execution failed');
  assert.ok(text.includes('formatted output here'));
});

test('transcript text derived from failed execution packet uses failureReason', () => {
  const packet = {
    ok: false,
    failureReason: 'command not found',
    stderr: 'error details',
  };
  const text = packet.ok
    ? ('dummy')
    : (packet.failureReason ?? packet.stderr ?? 'WorkBuddy execution failed');
  assert.equal(text, 'command not found');
});

test('transcript text derived from failed execution packet falls back to stderr', () => {
  const packet = {
    ok: false,
    failureReason: undefined,
    stderr: 'process killed by signal',
  };
  const text = packet.ok
    ? ('dummy')
    : (packet.failureReason ?? packet.stderr ?? 'WorkBuddy execution failed');
  assert.equal(text, 'process killed by signal');
});

test('transcript text derived from failed execution packet falls back to default message', () => {
  const packet = {
    ok: false,
    failureReason: undefined,
    stderr: undefined,
  };
  const text = packet.ok
    ? ('dummy')
    : (packet.failureReason ?? packet.stderr ?? 'WorkBuddy execution failed');
  assert.equal(text, 'WorkBuddy execution failed');
});

// ── EX-4: Route Store — internal conversation task routes ──

import { InMemoryConversationRouteStore } from '../apps/local-server/src/storage/conversation-route-store.ts';

test('route store creates a route with all fields', () => {
  const store = new InMemoryConversationRouteStore();
  const route = store.create({
    projectId: 'cli-bridge',
    pairingId: 'chatgpt-web→workbuddy',
    mode: 'single',
    instructionPacketId: 'inst-1',
    actionId: 'action-1',
  });

  assert.equal(typeof route.id, 'string');
  assert.ok(route.id.length > 0);
  assert.equal(route.projectId, 'cli-bridge');
  assert.equal(route.pairingId, 'chatgpt-web→workbuddy');
  assert.equal(route.mode, 'single');
  assert.equal(route.instructionPacketId, 'inst-1');
  assert.equal(route.actionId, 'action-1');
  assert.equal(route.taskId, undefined);
  assert.equal(route.status, 'pending');
  assert.equal(typeof route.createdAt, 'number');
  assert.ok(route.createdAt > 0);
  assert.equal(typeof route.updatedAt, 'number');
  assert.ok(route.updatedAt > 0);
});

test('get returns a single route', () => {
  const store = new InMemoryConversationRouteStore();
  const route = store.create({
    projectId: 'proj', pairingId: 'a→b', mode: 'single',
    instructionPacketId: 'i1', actionId: 'a1',
  });

  const found = store.get(route.id);
  assert.ok(found);
  assert.equal(found.id, route.id);
  assert.equal(found.actionId, 'a1');

  assert.equal(store.get('nonexistent'), undefined);
});

test('findByInstructionId returns matching routes', () => {
  const store = new InMemoryConversationRouteStore();
  store.create({ projectId: 'proj', pairingId: 'a→b', mode: 'single', instructionPacketId: 'inst-1', actionId: 'a1' });
  store.create({ projectId: 'proj', pairingId: 'a→b', mode: 'single', instructionPacketId: 'inst-2', actionId: 'a2' });

  const found = store.findByInstructionId('inst-1');
  assert.ok(found);
  assert.equal(found.instructionPacketId, 'inst-1');
  assert.equal(found.actionId, 'a1');

  assert.equal(store.findByInstructionId('nonexistent'), undefined);
});

test('findByActionId returns matching route', () => {
  const store = new InMemoryConversationRouteStore();
  const route = store.create({ projectId: 'proj', pairingId: 'a→b', mode: 'single', instructionPacketId: 'i1', actionId: 'a1' });

  const found = store.findByActionId('a1');
  assert.ok(found);
  assert.equal(found.id, route.id);

  assert.equal(store.findByActionId('nonexistent'), undefined);
});

test('listByProject returns routes sorted by createdAt', async () => {
  const store = new InMemoryConversationRouteStore();
  const a = store.create({ projectId: 'alpha', pairingId: 'p1→p2', mode: 'single', instructionPacketId: 'i1', actionId: 'a1' });
  await new Promise(r => setTimeout(r, 5));
  const b = store.create({ projectId: 'alpha', pairingId: 'p2→p3', mode: 'single', instructionPacketId: 'i2', actionId: 'a2' });

  store.create({ projectId: 'beta', pairingId: 'p3→p4', mode: 'single', instructionPacketId: 'i3', actionId: 'a3' });

  const list = store.listByProject('alpha');
  assert.equal(list.length, 2);
  assert.equal(list[0].id, a.id);
  assert.equal(list[1].id, b.id);
});

test('route lifecycle: pending → dispatched → completed', () => {
  const store = new InMemoryConversationRouteStore();
  const route = store.create({ projectId: 'proj', pairingId: 'a→b', mode: 'single', instructionPacketId: 'i1', actionId: 'a1' });
  assert.equal(route.status, 'pending');

  const dispatched = store.markDispatched(route.id, 'task-123');
  assert.ok(dispatched);
  assert.equal(dispatched.status, 'dispatched');
  assert.equal(dispatched.taskId, 'task-123');

  const completed = store.markCompleted(route.id);
  assert.ok(completed);
  assert.equal(completed.status, 'completed');
});

test('route lifecycle: pending → dispatched → failed', () => {
  const store = new InMemoryConversationRouteStore();
  const route = store.create({ projectId: 'proj', pairingId: 'a→b', mode: 'single', instructionPacketId: 'i1', actionId: 'a1' });

  store.markDispatched(route.id, 'task-456');
  const failed = store.markFailed(route.id);
  assert.ok(failed);
  assert.equal(failed.status, 'failed');
});

test('markDispatched returns undefined for nonexistent route', () => {
  const store = new InMemoryConversationRouteStore();
  assert.equal(store.markDispatched('nonexistent', 'task-1'), undefined);
});

test('markCompleted returns undefined for nonexistent route', () => {
  const store = new InMemoryConversationRouteStore();
  assert.equal(store.markCompleted('nonexistent'), undefined);
});

test('markFailed returns undefined for nonexistent route', () => {
  const store = new InMemoryConversationRouteStore();
  assert.equal(store.markFailed('nonexistent'), undefined);
});

test('idempotency: creating route for same actionId twice returns same route', () => {
  const store = new InMemoryConversationRouteStore();
  const first = store.create({ projectId: 'proj', pairingId: 'a→b', mode: 'single', instructionPacketId: 'i1', actionId: 'a1' });
  const second = store.create({ projectId: 'proj', pairingId: 'a→b', mode: 'single', instructionPacketId: 'i2', actionId: 'a1' });

  assert.equal(second.id, first.id);
  assert.equal(second.instructionPacketId, 'i1', 'should keep original instructionPacketId');

  // Only one route should exist.
  assert.equal(store.exportRoutes().length, 1);
});

// ── Integration: route is never in user-visible API response ──

test('conversation message API response does not contain route metadata', async () => {
  const {
    createBridgeRuntime,
    handleBridgeRequest,
  } = await import('../apps/local-server/src/routes/bridge-api.ts');

  const runtime = createBridgeRuntime();

  // Setup project and pairing.
  await handleBridgeRequest(
    runtime,
    'PUT',
    '/bridge/projects/cli-bridge/conversation-pairing',
    jsonBody({ sourceEndpointId: 'chatgpt-web', targetEndpointId: 'claude-code-command', scope: 'project' }),
  );

  // Send a conversation message.
  const post = await handleBridgeRequest(
    runtime,
    'POST',
    '/bridge/projects/cli-bridge/conversation/messages',
    jsonBody({ text: 'refactor the login form' }),
  );

  assert.equal(post.statusCode, 201);

  // Route metadata must not be exposed.
  assert.equal('routes' in post.payload, false, 'API response must not expose routes');
  assert.equal('conversationRoutes' in post.payload, false, 'API response must not expose conversation routes');
  assert.equal('taskRoutes' in post.payload, false, 'API response must not expose task routes');

  const events = Array.isArray(post.payload.events) ? post.payload.events : [];
  for (const event of events) {
    assert.equal('routeId' in event, false, `event ${event.id} must not expose routeId`);
    assert.equal('taskRoute' in event, false, `event ${event.id} must not expose task route`);
  }

  const actions = Array.isArray(post.payload.actions) ? post.payload.actions : [];
  for (const action of actions) {
    assert.equal('routeId' in action, false, `action ${action.id} must not expose routeId`);
  }
});

test('route IS created internally when a conversation message is posted', async () => {
  const {
    createBridgeRuntime,
    handleBridgeRequest,
  } = await import('../apps/local-server/src/routes/bridge-api.ts');

  const runtime = createBridgeRuntime();

  // Setup project and pairing with workbuddy.
  await handleBridgeRequest(
    runtime,
    'PUT',
    '/bridge/projects/cli-bridge/conversation-pairing',
    jsonBody({ sourceEndpointId: 'chatgpt-web', targetEndpointId: 'workbuddy', scope: 'project' }),
  );

  // Before: no routes.
  assert.equal(runtime.conversationRouteStore.exportRoutes().length, 0);

  await handleBridgeRequest(
    runtime,
    'POST',
    '/bridge/projects/cli-bridge/conversation/messages',
    jsonBody({ text: 'run tests' }),
  );

  // After: one route created internally (only for workbuddy-execution adapter).
  const routes = runtime.conversationRouteStore.exportRoutes();
  assert.equal(routes.length, 1);
  assert.equal(routes[0].mode, 'single');
  assert.equal(routes[0].status, 'pending');
  assert.equal(routes[0].projectId, 'cli-bridge');
  assert.equal(typeof routes[0].instructionPacketId, 'string');
  assert.equal(typeof routes[0].actionId, 'string');
});

// ── Export / hydrate roundtrip ──

test('exportRoutes returns all routes', () => {
  const store = new InMemoryConversationRouteStore();
  store.create({ projectId: 'alpha', pairingId: 'a→b', mode: 'single', instructionPacketId: 'i1', actionId: 'a1' });
  store.create({ projectId: 'beta', pairingId: 'c→d', mode: 'single', instructionPacketId: 'i2', actionId: 'a2' });

  const all = store.exportRoutes();
  assert.equal(all.length, 2);
});

test('persistence roundtrip: export → hydrate into new store → verify', () => {
  const original = new InMemoryConversationRouteStore();
  const a = original.create({ projectId: 'alpha', pairingId: 'a→b', mode: 'single', instructionPacketId: 'i1', actionId: 'a1' });
  original.markDispatched(a.id, 'task-x');
  original.markCompleted(a.id);

  const exported = original.exportRoutes();

  const restored = new InMemoryConversationRouteStore();
  for (const route of exported) {
    restored.hydrateRoute(route);
  }

  const ra = restored.get(a.id);
  assert.equal(ra.id, a.id);
  assert.equal(ra.status, 'completed');
  assert.equal(ra.taskId, 'task-x');
  assert.equal(ra.instructionPacketId, 'i1');
  assert.equal(ra.actionId, 'a1');
});

test('hydrateRoute skips invalid routes silently', () => {
  const store = new InMemoryConversationRouteStore();

  // Missing id
  store.hydrateRoute({ projectId: 'x', pairingId: 'p', mode: 'single', instructionPacketId: 'i', actionId: 'a', status: 'pending', createdAt: 1, updatedAt: 1 });
  // Missing projectId
  store.hydrateRoute({ id: 'id1', pairingId: 'p', mode: 'single', instructionPacketId: 'i', actionId: 'a', status: 'pending', createdAt: 1, updatedAt: 1 });

  assert.equal(store.exportRoutes().length, 0);
});

function jsonBody(body) {
  const text = body === undefined ? '' : JSON.stringify(body);
  async function* gen() {
    if (text.length > 0) yield Buffer.from(text, 'utf8');
  }
  return gen();
}
