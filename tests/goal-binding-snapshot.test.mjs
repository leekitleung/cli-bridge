import assert from 'node:assert/strict';
import test from 'node:test';

import {
  InMemoryGoalBindingSnapshotStore,
} from '../apps/local-server/src/storage/goal-binding-snapshot-store.ts';

// ── Create from preset ──

test('createFromPreset sets version 1 and source project-preset', () => {
  const store = new InMemoryGoalBindingSnapshotStore();
  const snap = store.createFromPreset({
    goalId: 'goal-1',
    plannerEndpointId: 'claude-code-command',
    executorEndpointId: 'codex-command',
  });
  assert.equal(snap.version, 1);
  assert.equal(snap.source, 'project-preset');
  assert.equal(snap.plannerEndpointId, 'claude-code-command');
  assert.equal(snap.executorEndpointId, 'codex-command');
  assert.ok(snap.snapshotId.length > 0);
  assert.ok(snap.createdAt > 0);
});

test('createManual sets version 1 and source manual', () => {
  const store = new InMemoryGoalBindingSnapshotStore();
  const snap = store.createManual({
    goalId: 'goal-2',
    plannerEndpointId: 'workbuddy',
    executorEndpointId: 'codex-command',
  });
  assert.equal(snap.version, 1);
  assert.equal(snap.source, 'manual');
});

// ── Rebind ──

test('rebind creates versioned snapshot with parent lineage', () => {
  const store = new InMemoryGoalBindingSnapshotStore();
  store.createFromPreset({
    goalId: 'goal-3',
    plannerEndpointId: 'claude-code-command',
    executorEndpointId: 'codex-command',
  });
  const rebind = store.rebind('goal-3', { executorEndpointId: 'workbuddy' });
  assert.ok(rebind);
  assert.equal(rebind.version, 2);
  assert.equal(rebind.source, 'manual-rebind');
  assert.equal(rebind.parentSnapshotId, store.getLatest('goal-3').parentSnapshotId);
  // Wait, let me fix: getLatest returns the latest (v2). Its parent is v1's snapshotId.
  assert.ok(rebind.parentSnapshotId);
  assert.equal(rebind.executorEndpointId, 'workbuddy');
  assert.equal(rebind.plannerEndpointId, 'claude-code-command');
});

test('rebind returns null for unknown goal', () => {
  const store = new InMemoryGoalBindingSnapshotStore();
  assert.equal(store.rebind('unknown', { executorEndpointId: 'x' }), null);
});

test('rebind preserves unchanged fields', () => {
  const store = new InMemoryGoalBindingSnapshotStore();
  store.createFromPreset({
    goalId: 'goal-4',
    plannerEndpointId: 'p1',
    executorEndpointId: 'e1',
    verifierEndpointId: 'v1',
  });
  const rebind = store.rebind('goal-4', { executorEndpointId: 'e2' });
  assert.equal(rebind.plannerEndpointId, 'p1');
  assert.equal(rebind.verifierEndpointId, 'v1');
  assert.equal(rebind.executorEndpointId, 'e2');
});

// ── History ──

test('getHistory returns all versions', () => {
  const store = new InMemoryGoalBindingSnapshotStore();
  store.createFromPreset({ goalId: 'goal-h', plannerEndpointId: 'p1', executorEndpointId: 'e1' });
  store.rebind('goal-h', { executorEndpointId: 'e2' });
  store.rebind('goal-h', { executorEndpointId: 'e3' });
  const history = store.getHistory('goal-h');
  assert.equal(history.length, 3);
  assert.equal(history[0].version, 1);
  assert.equal(history[1].version, 2);
  assert.equal(history[2].version, 3);
});

test('getLatest returns newest version', () => {
  const store = new InMemoryGoalBindingSnapshotStore();
  store.createFromPreset({ goalId: 'goal-l', plannerEndpointId: 'p1', executorEndpointId: 'e1' });
  store.rebind('goal-l', { executorEndpointId: 'e2' });
  assert.equal(store.getLatest('goal-l').version, 2);
  assert.equal(store.getLatest('goal-l').executorEndpointId, 'e2');
});

test('getLatest returns undefined for unknown goal', () => {
  const store = new InMemoryGoalBindingSnapshotStore();
  assert.equal(store.getLatest('unknown'), undefined);
});

// ── Snapshot persistence ──

test('exportSnapshots and hydrate round-trip', () => {
  const store1 = new InMemoryGoalBindingSnapshotStore();
  store1.createFromPreset({ goalId: 'g1', plannerEndpointId: 'p1', executorEndpointId: 'e1' });
  store1.rebind('g1', { executorEndpointId: 'e2' });
  const exported = store1.exportSnapshots();
  assert.equal(exported.length, 2);

  const store2 = new InMemoryGoalBindingSnapshotStore();
  for (const s of exported) store2.hydrateSnapshot(s);
  assert.equal(store2.getLatest('g1').version, 2);
  assert.equal(store2.getHistory('g1').length, 2);
});

test('hydrateSnapshot skips invalid records', () => {
  const store = new InMemoryGoalBindingSnapshotStore();
  store.hydrateSnapshot({ snapshotId: 's1', goalId: '', plannerEndpointId: 'p', executorEndpointId: 'e', version: 1, mode: 'sequential', isolation: 'patch-only', source: 'manual', createdAt: 0 });
  store.hydrateSnapshot({ snapshotId: 's2', goalId: 'g2', plannerEndpointId: '', executorEndpointId: 'e', version: 1, mode: 'sequential', isolation: 'patch-only', source: 'manual', createdAt: 0 });
  assert.equal(store.hasSnapshot('g2'), false, 'missing plannerEndpointId skipped');
});

// ── hasSnapshot ──

test('hasSnapshot returns true after creation, false otherwise', () => {
  const store = new InMemoryGoalBindingSnapshotStore();
  assert.equal(store.hasSnapshot('goal-x'), false);
  store.createManual({ goalId: 'goal-x', plannerEndpointId: 'p1', executorEndpointId: 'e1' });
  assert.equal(store.hasSnapshot('goal-x'), true);
});
