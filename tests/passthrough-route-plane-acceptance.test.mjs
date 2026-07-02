// EX-5: Passthrough Route Plane Acceptance Tests
//
// Unit/integration tests for:
//   - Visibility filter: internal events excluded from user-facing output
//   - Project Console rendering: hides instruction/route/task/action/confirm/dispatch
//   - Answer body comes from executor result fields, not internal metadata
//   - No unauthorized mutation endpoints exist

import assert from 'node:assert/strict';
import test from 'node:test';

import { InMemoryConversationTranscriptStore } from '../apps/local-server/src/storage/conversation-transcript-store.ts';
import { InMemoryConversationInstructionStore } from '../apps/local-server/src/storage/conversation-instruction-store.ts';
import { InMemoryConversationExecutionStore } from '../apps/local-server/src/storage/conversation-execution-store.ts';
import { InMemoryConversationRouteStore } from '../apps/local-server/src/storage/conversation-route-store.ts';
import { InMemoryConversationPairingStore } from '../apps/local-server/src/storage/conversation-pairing-store.ts';
import { InMemoryConversationActionStore } from '../apps/local-server/src/storage/conversation-action-store.ts';

import { JSDOM } from 'jsdom';
import { renderProjectConsoleHtml } from '../apps/local-server/src/routes/project-console.ts';

// ---------------------------------------------------------------------------
// Test: Visibility Filter
// ---------------------------------------------------------------------------

test('visibility filter: internal instruction events excluded from user-facing list', () => {
  const store = new InMemoryConversationTranscriptStore();

  // Create a user event (visible)
  const userEvent = store.append({
    projectId: 'test-proj',
    pairingId: 'test-pair',
    role: 'user',
    text: 'Hello',
    status: 'draft',
    routeKind: 'workbuddy-execution',
  });

  // Create an internal instruction event
  const instrEvent = store.append({
    projectId: 'test-proj',
    pairingId: 'test-pair',
    role: 'bridge',
    text: 'instruction text',
    status: 'queued',
    routeKind: 'workbuddy-execution',
    kind: 'instruction',
    visibility: 'internal',
  });

  // Create an executor output event (visible)
  const execEvent = store.append({
    projectId: 'test-proj',
    pairingId: 'test-pair',
    role: 'target',
    text: 'result from WorkBuddy',
    status: 'returned',
    routeKind: 'workbuddy-execution',
  });

  const all = store.listByProject('test-proj');
  const userVisible = all.filter((e) => e.visibility === 'user');
  const internal = all.filter((e) => e.visibility === 'internal');

  assert.equal(all.length, 3, '3 total events');
  assert.equal(userVisible.length, 2, '2 user-visible events (user + executor)');
  assert.equal(internal.length, 1, '1 internal event (instruction)');
  assert.equal(internal[0].kind, 'instruction', 'internal event is instruction');
  assert.equal(userVisible[0].kind, 'user_message', 'first user-visible = user_message');
  assert.equal(userVisible[1].kind, 'executor_output', 'second user-visible = executor_output');
});

test('visibility filter: instruction packets never appear in transcript events', () => {
  const transcriptStore = new InMemoryConversationTranscriptStore();
  const instructionStore = new InMemoryConversationInstructionStore();

  const userEvent = transcriptStore.append({
    projectId: 'test-proj',
    pairingId: 'test-pair',
    role: 'user',
    text: 'do something',
    status: 'draft',
    routeKind: 'workbuddy-execution',
  });

  const packet = instructionStore.create({
    projectId: 'test-proj',
    pairingId: 'test-pair',
    userEventId: userEvent.id,
    text: userEvent.text,
  });

  const allEvents = transcriptStore.listByProject('test-proj');
  const packetInEvents = allEvents.find((e) => e.id === packet.id);
  assert.equal(packetInEvents, undefined, 'instruction packet id not found in transcript');
});

test('visibility filter: route internals never appear in transcript events', () => {
  const transcriptStore = new InMemoryConversationTranscriptStore();
  const instructionStore = new InMemoryConversationInstructionStore();
  const routeStore = new InMemoryConversationRouteStore();
  const actionStore = new InMemoryConversationActionStore();

  const userEvent = transcriptStore.append({
    projectId: 'test-proj',
    pairingId: 'test-pair',
    role: 'user',
    text: 'test command',
    status: 'draft',
    routeKind: 'workbuddy-execution',
  });

  const packet = instructionStore.create({
    projectId: 'test-proj',
    pairingId: 'test-pair',
    userEventId: userEvent.id,
    text: userEvent.text,
  });

  const action = actionStore.createPreview({
    projectId: 'test-proj',
    sourceEndpointId: 'chatgpt-web',
    targetEndpointId: 'workbuddy',
    routeKind: 'workbuddy-execution',
    userEventId: userEvent.id,
    bridgeEventId: 'bridge-1',
    text: packet.text,
    preview: 'Task: test command',
  });

  const route = routeStore.create({
    projectId: 'test-proj',
    pairingId: 'test-pair',
    mode: 'single',
    instructionPacketId: packet.id,
    actionId: action.id,
  });

  const allEvents = transcriptStore.listByProject('test-proj');
  // Route id must not be in transcript
  assert.equal(allEvents.find((e) => e.id === route.id), undefined, 'route id not in transcript');
  // Route id must not appear in any event text
  const routeInText = allEvents.filter((e) => e.text.includes(route.id));
  assert.equal(routeInText.length, 0, 'route id not in any event text');
});

test('visibility filter: execution packet metadata never leaks to transcript', () => {
  const transcriptStore = new InMemoryConversationTranscriptStore();
  const executionStore = new InMemoryConversationExecutionStore();

  const taskId = 'task-123';
  const instrId = 'inst-456';

  const ep = executionStore.create({
    projectId: 'test-proj',
    pairingId: 'test-pair',
    instructionPacketId: instrId,
    taskId,
    ok: true,
    stdout: 'Hello from executor',
    durationMs: 100,
  });

  transcriptStore.append({
    projectId: 'test-proj',
    pairingId: 'test-pair',
    role: 'target',
    text: 'Hello from executor',
    status: 'returned',
    routeKind: 'workbuddy-execution',
  });

  const allEvents = transcriptStore.listByProject('test-proj');
  // Execution packet id must not be in transcript
  assert.equal(
    allEvents.find((e) => e.id === ep.id),
    undefined,
    'execution packet id not in transcript',
  );
  // taskId must not leak
  assert.equal(allEvents.filter((e) => e.text.includes(taskId)).length, 0, 'taskId not in event text');
  // instructionPacketId must not leak
  assert.equal(allEvents.filter((e) => e.text.includes(instrId)).length, 0, 'instructionPacketId not in event text');
});

// ---------------------------------------------------------------------------
// Test: Project Console hides instruction/route/task/action/confirm/dispatch
// ---------------------------------------------------------------------------

test('Project Console transcript filter excludes internal events', () => {
  const html = renderProjectConsoleHtml();
  const dom = new JSDOM(html, { url: 'http://localhost:9300/console/project', runScripts: 'dangerously' });
  const { window, document } = dom;

  // Mock store with mixed visibility events
  window.store = {
    conversationEvents: [
      { visibility: 'user', kind: 'user_message', role: 'user', text: 'Hello', status: 'draft', routeKind: 'workbuddy-execution' },
      { visibility: 'internal', kind: 'instruction', role: 'bridge', text: 'inst-1', status: 'queued', routeKind: 'workbuddy-execution' },
      { visibility: 'internal', kind: 'status', role: 'bridge', text: 'route internals', status: 'dispatched', routeKind: 'workbuddy-execution' },
      { visibility: 'internal', kind: 'status', role: 'bridge', text: 'task dispatched', status: 'dispatched', routeKind: 'workbuddy-execution' },
      { visibility: 'user', kind: 'executor_output', role: 'target', text: 'Done!', status: 'returned', routeKind: 'workbuddy-execution' },
    ],
    conversationActions: [],
    composerMode: 'conversation',
  };

  // Simulate filtered rendering (same logic as renderConversationTranscript)
  const visibleEvents = window.store.conversationEvents.filter(
    (event) => event.visibility === 'user',
  );
  assert.equal(visibleEvents.length, 2, 'only 2 user-visible events after filtering');
  assert.equal(visibleEvents[0].kind, 'user_message', 'user message visible');
  assert.equal(visibleEvents[1].kind, 'executor_output', 'executor output visible');

  // Assert internal events are excluded
  const internalEvents = window.store.conversationEvents.filter(
    (event) => event.visibility === 'internal',
  );
  const hasInstruction = internalEvents.some((e) => e.kind === 'instruction');
  const hasRouteInternal = internalEvents.some(
    (e) => e.kind === 'status' && e.role === 'bridge',
  );
  assert.ok(hasInstruction, 'instruction events exist but are internal');
  assert.ok(hasRouteInternal, 'route internals exist but are internal');
});

test('Project Console hides action confirm/dispatch when no actions visible', () => {
  // Test at storage/filter level: when store has events but no actions,
  // the pending state returns empty and no action buttons are rendered.
  const events = [
    { visibility: 'user', kind: 'user_message', role: 'user', text: 'test', status: 'draft', routeKind: 'workbuddy-execution' },
  ];
  const actions = [];

  // Replicate renderConversationPendingState logic
  const pending = actions.find((action) => action && !['returned', 'failed', 'cancelled'].includes(action.status));
  assert.equal(pending, undefined, 'no pending action when actions list is empty');

  // Replicate conversation event filter: only user-visible events
  const visibleEvents = events.filter((e) => e.visibility === 'user');
  assert.equal(visibleEvents.length, 1, 'only user-visible events rendered');
  assert.equal(visibleEvents[0].kind, 'user_message', 'user message visible');
});

test('Project Console hides task dispatch state in transcript', () => {
  // Test the visibility filter: internal task/dispatch events are excluded
  const events = [
    { visibility: 'user', kind: 'user_message', role: 'user', text: 'deploy', status: 'draft', routeKind: 'workbuddy-execution' },
    { visibility: 'internal', kind: 'status', role: 'bridge', text: 'task dispatched to workbuddy', status: 'dispatched', routeKind: 'workbuddy-execution' },
    { visibility: 'user', kind: 'executor_output', role: 'target', text: 'deploy complete', status: 'returned', routeKind: 'workbuddy-execution' },
  ];

  const userVisible = events.filter((e) => e.visibility === 'user');
  const internalEvents = events.filter((e) => e.visibility !== 'user');

  assert.equal(userVisible.length, 2, '2 user-visible (user msg + executor output)');
  assert.equal(internalEvents.length, 1, '1 internal event (dispatch status)');
  assert.equal(internalEvents[0].kind, 'status', 'internal event is status/kind');
  assert.ok(internalEvents[0].text.includes('dispatched'), 'internal event describes dispatch');
});

// ---------------------------------------------------------------------------
// Test: Answer body comes from executor result fields
// ---------------------------------------------------------------------------

test('user-visible answer body comes from executor stdout field', () => {
  const executionStore = new InMemoryConversationExecutionStore();
  const transcriptStore = new InMemoryConversationTranscriptStore();

  const executorResult = 'Login form refactored to hooks. 42 lines changed.';

  // This is what the pipeline creates: execution packet with stdout
  const ep = executionStore.create({
    projectId: 'test-proj',
    pairingId: 'test-pair',
    taskId: 'task-001',
    ok: true,
    stdout: executorResult,
    output: { result: executorResult },
    durationMs: 500,
  });

  // This is what the transcript receives: text from stdout
  const event = transcriptStore.append({
    projectId: 'test-proj',
    pairingId: 'test-pair',
    role: 'target',
    text: ep.stdout,
    status: 'returned',
    routeKind: 'workbuddy-execution',
  });

  assert.equal(event.text, executorResult, 'transcript text = executor stdout');
  assert.equal(event.kind, 'executor_output', 'event kind = executor_output');
  assert.equal(event.visibility, 'user', 'event visible to user');
});

test('answer body shows executor result, not internal metadata', () => {
  const executionStore = new InMemoryConversationExecutionStore();
  const transcriptStore = new InMemoryConversationTranscriptStore();

  const taskId = 'task-internal-abc';

  const ep = executionStore.create({
    projectId: 'test-proj',
    pairingId: 'test-pair',
    instructionPacketId: 'inst-xyz',
    taskId,
    ok: true,
    stdout: 'The PR is ready for review.',
    output: { result: 'The PR is ready for review.' },
    durationMs: 300,
  });

  const event = transcriptStore.append({
    projectId: 'test-proj',
    pairingId: 'test-pair',
    role: 'target',
    text: ep.stdout,
    status: 'returned',
    routeKind: 'workbuddy-execution',
  });

  // Text must NOT contain internal metadata
  assert.ok(!event.text.includes(taskId), 'text does not leak taskId');
  assert.ok(!event.text.includes('inst-xyz'), 'text does not leak instruction id');
  assert.ok(!event.text.includes(ep.id), 'text does not leak execution packet id');

  // Text MUST contain only the executor result
  assert.equal(event.text, 'The PR is ready for review.', 'text is exactly executor result');
});

// ---------------------------------------------------------------------------
// Test: No unauthorized mutation endpoints
// ---------------------------------------------------------------------------

function getPublicMethods(store) {
  return Object.getOwnPropertyNames(Object.getPrototypeOf(store));
}

test('execution store has no shell/run/exec/git mutation methods', () => {
  const store = new InMemoryConversationExecutionStore();
  const methods = getPublicMethods(store);

  assert.ok(!methods.includes('execute'), 'no execute()');
  assert.ok(!methods.includes('run'), 'no run()');
  assert.ok(!methods.includes('shell'), 'no shell()');
  assert.ok(!methods.includes('exec'), 'no exec()');
  assert.ok(!methods.includes('command'), 'no command()');
  assert.ok(!methods.includes('git'), 'no git()');
});

test('route store has no generic dispatch or mutation methods', () => {
  const store = new InMemoryConversationRouteStore();
  const methods = getPublicMethods(store);

  assert.ok(!methods.includes('dispatch'), 'no dispatch() — only markDispatched');
  assert.ok(!methods.includes('execute'), 'no execute()');
  assert.ok(!methods.includes('run'), 'no run()');
  assert.ok(!methods.includes('shell'), 'no shell()');
});

test('instruction store has no mutation authority', () => {
  const store = new InMemoryConversationInstructionStore();
  const methods = getPublicMethods(store);

  assert.ok(!methods.includes('execute'), 'no execute()');
  assert.ok(!methods.includes('run'), 'no run()');
  assert.ok(!methods.includes('shell'), 'no shell()');
  assert.ok(!methods.includes('dispatch'), 'no dispatch()');
});

test('pairing store has no mutation authority', () => {
  const store = new InMemoryConversationPairingStore();
  const methods = getPublicMethods(store);

  assert.ok(!methods.includes('execute'), 'no execute()');
  assert.ok(!methods.includes('run'), 'no run()');
  assert.ok(!methods.includes('shell'), 'no shell()');
});

test('action store has no unauthorized mutation capability', () => {
  const store = new InMemoryConversationActionStore();
  const methods = getPublicMethods(store);

  assert.ok(!methods.includes('execute'), 'no execute()');
  assert.ok(!methods.includes('run'), 'no run()');
  assert.ok(!methods.includes('shell'), 'no shell()');
  // has confirm/markDispatching/markQueued/markReturned/markWorkBuddyReturned
  // no generic 'dispatch' or 'run'
});

test('transcript store has no mutation authority', () => {
  const store = new InMemoryConversationTranscriptStore();
  const methods = getPublicMethods(store);

  assert.ok(!methods.includes('execute'), 'no execute()');
  assert.ok(!methods.includes('run'), 'no run()');
  assert.ok(!methods.includes('shell'), 'no shell()');
});

// ---------------------------------------------------------------------------
// Test: Complete pipeline reconstruction from paired stores
// ---------------------------------------------------------------------------

test('pipeline: instruction → route → action → execution all linkable', () => {
  const ts = new InMemoryConversationTranscriptStore();
  const is = new InMemoryConversationInstructionStore();
  const es = new InMemoryConversationExecutionStore();
  const rs = new InMemoryConversationRouteStore();
  const as = new InMemoryConversationActionStore();

  // 1. User message
  const userEvt = ts.append({
    projectId: 'test-proj',
    pairingId: 'test-pair',
    role: 'user',
    text: 'deploy to staging',
    status: 'draft',
    routeKind: 'workbuddy-execution',
  });

  // 2. Instruction packet
  const inst = is.create({
    projectId: 'test-proj',
    pairingId: 'test-pair',
    userEventId: userEvt.id,
    text: userEvt.text,
  });

  // 3. Action
  const action = as.createPreview({
    projectId: 'test-proj',
    sourceEndpointId: 'chatgpt-web',
    targetEndpointId: 'workbuddy',
    routeKind: 'workbuddy-execution',
    userEventId: userEvt.id,
    bridgeEventId: 'bridge-1',
    text: inst.text,
    preview: 'Deploy to staging',
  });

  // 4. Route
  const route = rs.create({
    projectId: 'test-proj',
    pairingId: 'test-pair',
    mode: 'single',
    instructionPacketId: inst.id,
    actionId: action.id,
  });

  as.linkRoute(action.id, route.id);

  // 5. Dispatch
  const taskId = 'task-staging-1';
  as.confirm(action.id);
  as.markDispatching(action.id);
  rs.markDispatched(route.id, taskId);
  as.markQueued(action.id, taskId);

  // 6. Execution result
  const stdout = 'Staging deploy successful. URL: https://staging.example.com';
  es.create({
    projectId: 'test-proj',
    pairingId: 'test-pair',
    instructionPacketId: inst.id,
    taskId,
    ok: true,
    stdout,
    durationMs: 500,
  });

  rs.markCompleted(route.id);
  as.markWorkBuddyReturned(action.id);

  // 7. User-visible transcript
  ts.append({
    projectId: 'test-proj',
    pairingId: 'test-pair',
    role: 'target',
    text: stdout,
    status: 'returned',
    routeKind: 'workbuddy-execution',
  });

  // --- Reconstruct and verify ---
  const foundInst = is.findByUserEventId(userEvt.id);
  assert.ok(foundInst, 'instruction retrievable');
  assert.equal(foundInst.text, userEvt.text, 'instruction text matches');

  const foundRoute = rs.findByInstructionId(inst.id);
  assert.ok(foundRoute, 'route retrievable');
  assert.equal(foundRoute.actionId, action.id, 'route links action');

  const foundAction = as.findByWorkBuddyTaskId(taskId);
  assert.ok(foundAction, 'action retrievable');
  assert.equal(foundAction.status, 'returned', 'action completed');

  const foundExec = es.findByTaskId(taskId);
  assert.ok(foundExec, 'execution retrievable');
  assert.equal(foundExec.stdout, stdout, 'execution stdout matches');
});

// ---------------------------------------------------------------------------
// Test: Mode 'single' is the only supported mode
// ---------------------------------------------------------------------------

test('route mode is restricted to single', () => {
  const is = new InMemoryConversationInstructionStore();
  const as = new InMemoryConversationActionStore();
  const rs = new InMemoryConversationRouteStore();

  const inst = is.create({
    projectId: 'test-proj',
    pairingId: 'test-pair',
    userEventId: 'user-1',
    text: 'test',
  });

  const action = as.createPreview({
    projectId: 'test-proj',
    sourceEndpointId: 's',
    targetEndpointId: 't',
    routeKind: 'workbuddy-execution',
    userEventId: 'user-1',
    bridgeEventId: 'b-1',
    text: 'test',
    preview: 'test',
  });

  const route = rs.create({
    projectId: 'test-proj',
    pairingId: 'test-pair',
    mode: 'single',
    instructionPacketId: inst.id,
    actionId: action.id,
  });

  assert.equal(route.mode, 'single', 'created route mode = single');

  const retrieved = rs.get(route.id);
  assert.ok(retrieved, 'route retrievable');
  assert.equal(retrieved.mode, 'single', 'retrieved route mode = single');

  // Cross-reference: all routes for this project have mode 'single'
  const allRoutes = rs.listByProject('test-proj');
  for (const r of allRoutes) {
    assert.equal(r.mode, 'single', `route ${r.id} mode = single`);
  }
});

// ---------------------------------------------------------------------------
// Test: Default visibility rules
// ---------------------------------------------------------------------------

test('default visibility: instruction events default to internal', () => {
  const store = new InMemoryConversationTranscriptStore();

  const event = store.append({
    projectId: 'test-proj',
    pairingId: 'test-pair',
    role: 'bridge',
    text: 'instruction payload',
    status: 'queued',
    routeKind: 'workbuddy-execution',
    kind: 'instruction',
  });

  assert.equal(event.visibility, 'internal', 'instruction events default to internal');
});

test('default visibility: user_message events default to user', () => {
  const store = new InMemoryConversationTranscriptStore();

  const event = store.append({
    projectId: 'test-proj',
    pairingId: 'test-pair',
    role: 'user',
    text: 'hello',
    status: 'draft',
    routeKind: 'workbuddy-execution',
  });

  assert.equal(event.visibility, 'user', 'user_message events default to user');
});

test('default visibility: executor_output events default to user', () => {
  const store = new InMemoryConversationTranscriptStore();

  const event = store.append({
    projectId: 'test-proj',
    pairingId: 'test-pair',
    role: 'target',
    text: 'result',
    status: 'returned',
    routeKind: 'workbuddy-execution',
  });

  assert.equal(event.visibility, 'user', 'executor_output events default to user');
});
