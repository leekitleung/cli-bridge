import assert from 'node:assert/strict';
import test from 'node:test';

import {
  InMemoryProjectTeamPresetStore,
  validateProjectTeamPreset,
} from '../apps/local-server/src/storage/project-team-preset-store.ts';

// ── Store CRUD ──

test('upsert and get preset', () => {
  const store = new InMemoryProjectTeamPresetStore();
  const preset = store.upsert({
    projectId: 'proj-a',
    plannerEndpointId: 'claude-code-command',
    executorEndpointId: 'codex-command',
    mode: 'sequential',
    isolation: 'patch-only',
    updatedAt: 0,
  });
  assert.equal(preset.projectId, 'proj-a');
  assert.equal(preset.plannerEndpointId, 'claude-code-command');
  assert.equal(preset.mode, 'sequential');

  const fetched = store.get('proj-a');
  assert.ok(fetched);
  assert.equal(fetched.executorEndpointId, 'codex-command');
  assert.ok(fetched.updatedAt > 0, 'updatedAt should be set');
});

test('upsert replaces existing preset', () => {
  const store = new InMemoryProjectTeamPresetStore();
  store.upsert({
    projectId: 'proj-b',
    plannerEndpointId: 'claude-code-command',
    executorEndpointId: 'codex-command',
    mode: 'sequential',
    isolation: 'patch-only',
    updatedAt: 0,
  });
  const updated = store.upsert({
    projectId: 'proj-b',
    plannerEndpointId: 'workbuddy',
    executorEndpointId: 'claude-code-command',
    mode: 'sequential',
    isolation: 'patch-only',
    updatedAt: 0,
  });
  assert.equal(updated.plannerEndpointId, 'workbuddy');
  assert.equal(updated.executorEndpointId, 'claude-code-command');
  assert.equal(store.listAll().length, 1, 'only one preset per project');
});

test('get returns undefined for unknown project', () => {
  const store = new InMemoryProjectTeamPresetStore();
  assert.equal(store.get('unknown-proj'), undefined);
});

test('delete removes preset', () => {
  const store = new InMemoryProjectTeamPresetStore();
  store.upsert({
    projectId: 'proj-c',
    plannerEndpointId: 'claude-code-command',
    executorEndpointId: 'codex-command',
    mode: 'sequential',
    isolation: 'patch-only',
    updatedAt: 0,
  });
  assert.equal(store.delete('proj-c'), true);
  assert.equal(store.get('proj-c'), undefined);
  assert.equal(store.delete('proj-c'), false, 'double delete returns false');
});

test('listAll returns all presets', () => {
  const store = new InMemoryProjectTeamPresetStore();
  store.upsert({ projectId: 'a', plannerEndpointId: 'p1', executorEndpointId: 'e1', mode: 'sequential', isolation: 'patch-only', updatedAt: 0 });
  store.upsert({ projectId: 'b', plannerEndpointId: 'p2', executorEndpointId: 'e2', mode: 'sequential', isolation: 'patch-only', updatedAt: 0 });
  const all = store.listAll();
  assert.equal(all.length, 2);
  const ids = all.map(p => p.projectId).sort();
  assert.deepEqual(ids, ['a', 'b']);
});

// ── Snapshot persistence ──

test('exportPresets and hydratePreset round-trip', () => {
  const store1 = new InMemoryProjectTeamPresetStore();
  store1.upsert({ projectId: 'snap', plannerEndpointId: 'p1', executorEndpointId: 'e1', mode: 'sequential', isolation: 'patch-only', updatedAt: 0 });
  const exported = store1.exportPresets();
  assert.equal(exported.length, 1);

  const store2 = new InMemoryProjectTeamPresetStore();
  for (const p of exported) store2.hydratePreset(p);
  assert.equal(store2.get('snap').plannerEndpointId, 'p1');
});

test('hydratePreset skips invalid records', () => {
  const store = new InMemoryProjectTeamPresetStore();
  store.hydratePreset({ projectId: '', plannerEndpointId: 'p', executorEndpointId: 'e', mode: 'sequential', isolation: 'patch-only', updatedAt: 0 });
  store.hydratePreset({ projectId: 'valid', plannerEndpointId: '', executorEndpointId: 'e', mode: 'sequential', isolation: 'patch-only', updatedAt: 0 });
  store.hydratePreset({ projectId: 'valid2', plannerEndpointId: 'p', executorEndpointId: '', mode: 'sequential', isolation: 'patch-only', updatedAt: 0 });
  assert.equal(store.listAll().length, 0, 'invalid records skipped');
});

// ── Validation ──

test('validateProjectTeamPreset rejects missing planner', () => {
  const online = new Set(['claude-code-command', 'codex-command']);
  const result = validateProjectTeamPreset({
    projectId: 'test', executorEndpointId: 'codex-command', mode: 'sequential', isolation: 'patch-only',
  }, online);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(e => e.includes('planner')));
});

test('validateProjectTeamPreset rejects offline endpoint', () => {
  const online = new Set(['claude-code-command']); // codex-command not in set
  const result = validateProjectTeamPreset({
    projectId: 'test', plannerEndpointId: 'claude-code-command', executorEndpointId: 'codex-command',
    mode: 'sequential', isolation: 'patch-only',
  }, online);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(e => e.includes('codex-command')));
});

test('validateProjectTeamPreset rejects invalid mode', () => {
  const online = new Set(['claude-code-command', 'codex-command']);
  const result = validateProjectTeamPreset({
    projectId: 'test', plannerEndpointId: 'claude-code-command', executorEndpointId: 'codex-command',
    mode: 'parallel', isolation: 'patch-only',
  }, online);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(e => e.includes('mode')));
});

test('validateProjectTeamPreset accepts valid preset', () => {
  const online = new Set(['claude-code-command', 'codex-command']);
  const result = validateProjectTeamPreset({
    projectId: 'test', plannerEndpointId: 'claude-code-command', executorEndpointId: 'codex-command',
    verifierEndpointId: 'codex-command', mode: 'sequential', isolation: 'patch-only',
  }, online);
  assert.equal(result.ok, true);
  assert.equal(result.errors.length, 0);
});

// ── Isolation from existing goals ──

test('preset mutations do not affect stored presets via get() cloning', () => {
  const store = new InMemoryProjectTeamPresetStore();
  store.upsert({ projectId: 'iso', plannerEndpointId: 'p1', executorEndpointId: 'e1', mode: 'sequential', isolation: 'patch-only', updatedAt: 0 });
  const fetched = store.get('iso');
  fetched.plannerEndpointId = 'p-mutated';
  const fetchedAgain = store.get('iso');
  assert.equal(fetchedAgain.plannerEndpointId, 'p1', 'get() clones prevent mutation');
});
