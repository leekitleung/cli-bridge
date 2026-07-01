import assert from 'node:assert/strict';
import test from 'node:test';

import { InMemoryConversationTranscriptStore } from '../apps/local-server/src/storage/conversation-transcript-store.ts';

const PROJECT_ID = 'test-project';
const PAIRING_ID = 'test-pairing';

test('Conversation Transcript Visibility', async (t) => {
  let store;

  t.beforeEach(() => {
    store = new InMemoryConversationTranscriptStore();
  });

  await t.test('append with explicit kind and visibility', () => {
    const event = store.append({
      projectId: PROJECT_ID,
      pairingId: PAIRING_ID,
      role: 'bridge',
      text: 'instruction text',
      status: 'queued',
      routeKind: 'passthrough',
      kind: 'instruction',
      visibility: 'internal',
    });

    assert.equal(event.kind, 'instruction');
    assert.equal(event.visibility, 'internal');
    assert.ok(typeof event.id === 'string');
    assert.ok(typeof event.createdAt === 'number');
  });

  await t.test('append with explicit kind and visibility user', () => {
    const event = store.append({
      projectId: PROJECT_ID,
      pairingId: PAIRING_ID,
      role: 'user',
      text: 'hello',
      status: 'draft',
      routeKind: 'passthrough',
    });

    // Defaults
    assert.equal(event.kind, 'user_message');
    assert.equal(event.visibility, 'user');
  });

  await t.test('append defaults kind to user_message when role is user', () => {
    const event = store.append({
      projectId: PROJECT_ID,
      pairingId: PAIRING_ID,
      role: 'user',
      text: 'user input',
      status: 'draft',
      routeKind: 'passthrough',
    });

    assert.equal(event.kind, 'user_message');
  });

  await t.test('append defaults kind to status when role is bridge', () => {
    const event = store.append({
      projectId: PROJECT_ID,
      pairingId: PAIRING_ID,
      role: 'bridge',
      text: 'preview created',
      status: 'awaiting-manual-confirmation',
      routeKind: 'passthrough',
    });

    assert.equal(event.kind, 'status');
  });

  await t.test('append defaults kind to executor_output when role is target', () => {
    const event = store.append({
      projectId: PROJECT_ID,
      pairingId: PAIRING_ID,
      role: 'target',
      text: 'output from target',
      status: 'returned',
      routeKind: 'passthrough',
    });

    assert.equal(event.kind, 'executor_output');
  });

  await t.test('default visibility is user', () => {
    const event = store.append({
      projectId: PROJECT_ID,
      pairingId: PAIRING_ID,
      role: 'target',
      text: 'output',
      status: 'returned',
      routeKind: 'passthrough',
    });

    assert.equal(event.visibility, 'user');
  });

  await t.test('legacy hydration: event without kind gets correct default based on role', () => {
    store.hydrateEvent({
      id: 'legacy-event-1',
      projectId: PROJECT_ID,
      pairingId: PAIRING_ID,
      role: 'user',
      text: 'old user message',
      status: 'queued',
      routeKind: 'passthrough',
      createdAt: 1000,
    });

    const events = store.listByProject(PROJECT_ID);
    const hydrated = events.find(e => e.id === 'legacy-event-1');
    assert.ok(hydrated);
    assert.equal(hydrated.kind, 'user_message');
    assert.equal(hydrated.visibility, 'user');
  });

  await t.test('legacy hydration: bridge event gets kind status', () => {
    store.hydrateEvent({
      id: 'legacy-bridge-event',
      projectId: PROJECT_ID,
      pairingId: PAIRING_ID,
      role: 'bridge',
      text: 'preview created',
      status: 'awaiting-manual-confirmation',
      routeKind: 'passthrough',
      createdAt: 1000,
    });

    const events = store.listByProject(PROJECT_ID);
    const hydrated = events.find(e => e.id === 'legacy-bridge-event');
    assert.ok(hydrated);
    assert.equal(hydrated.kind, 'status');
    assert.equal(hydrated.visibility, 'user');
  });

  await t.test('legacy hydration: target event gets kind executor_output', () => {
    store.hydrateEvent({
      id: 'legacy-target-event',
      projectId: PROJECT_ID,
      pairingId: PAIRING_ID,
      role: 'target',
      text: 'returned output',
      status: 'returned',
      routeKind: 'passthrough',
      createdAt: 1000,
    });

    const events = store.listByProject(PROJECT_ID);
    const hydrated = events.find(e => e.id === 'legacy-target-event');
    assert.ok(hydrated);
    assert.equal(hydrated.kind, 'executor_output');
    assert.equal(hydrated.visibility, 'user');
  });

  await t.test('kind instruction events default to visibility internal', () => {
    const event = store.append({
      projectId: PROJECT_ID,
      pairingId: PAIRING_ID,
      role: 'bridge',
      text: 'system instruction',
      status: 'queued',
      routeKind: 'passthrough',
      kind: 'instruction',
    });

    assert.equal(event.kind, 'instruction');
    assert.equal(event.visibility, 'internal');
  });

  await t.test('visibility internal events stored but filterable from user visible', () => {
    store.append({
      projectId: PROJECT_ID,
      pairingId: PAIRING_ID,
      role: 'user',
      text: 'user message',
      status: 'queued',
      routeKind: 'passthrough',
      kind: 'user_message',
      visibility: 'user',
    });

    store.append({
      projectId: PROJECT_ID,
      pairingId: PAIRING_ID,
      role: 'bridge',
      text: 'internal instruction',
      status: 'queued',
      routeKind: 'passthrough',
      kind: 'instruction',
      visibility: 'internal',
    });

    store.append({
      projectId: PROJECT_ID,
      pairingId: PAIRING_ID,
      role: 'target',
      text: 'output',
      status: 'returned',
      routeKind: 'passthrough',
      kind: 'executor_output',
      visibility: 'user',
    });

    const allEvents = store.listByProject(PROJECT_ID);
    const userVisibleEvents = allEvents.filter(e => e.visibility === 'user');
    const internalEvents = allEvents.filter(e => e.visibility === 'internal');

    assert.equal(allEvents.length, 3);
    assert.equal(userVisibleEvents.length, 2);
    assert.equal(internalEvents.length, 1);
    assert.equal(internalEvents[0].kind, 'instruction');
  });

  await t.test('user_message and executor_output with visibility user pass through', () => {
    store.append({
      projectId: PROJECT_ID,
      pairingId: PAIRING_ID,
      role: 'user',
      text: 'user input',
      status: 'queued',
      routeKind: 'passthrough',
      kind: 'user_message',
      visibility: 'user',
    });

    store.append({
      projectId: PROJECT_ID,
      pairingId: PAIRING_ID,
      role: 'target',
      text: 'returned output',
      status: 'returned',
      routeKind: 'passthrough',
      kind: 'executor_output',
      visibility: 'user',
    });

    const userVisible = store.listByProject(PROJECT_ID).filter(e => e.visibility === 'user');
    assert.equal(userVisible.length, 2);
    assert.ok(userVisible.every(e => e.visibility === 'user'));
  });
});
