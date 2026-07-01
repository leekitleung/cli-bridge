import assert from 'node:assert/strict';
import test from 'node:test';
import { InMemoryAutomationLoopStore } from '../apps/local-server/src/automation/automation-loop-store.ts';

const now = 1793000000000;

function setup() {
  return new InMemoryAutomationLoopStore();
}

function createLoop(store, overrides = {}) {
  return store.create({
    projectId: 'cli-bridge',
    sourceEndpointId: 'chatgpt-web',
    targetEndpointId: 'workbuddy',
    maxCycles: 5,
    noProgressLimit: 2,
    deadlineAt: now + 600_000,
    now,
    ...overrides,
  });
}

// --- Creation ---

test('create initializes a draft loop', () => {
  const store = setup();
  const loop = createLoop(store);
  assert.equal(loop.status, 'draft');
  assert.equal(loop.cycleCount, 0);
  assert.equal(loop.noProgressCount, 0);
  assert.equal(loop.stopReason, undefined);
  assert.equal(loop.projectId, 'cli-bridge');
});

test('get returns the loop or undefined', () => {
  const store = setup();
  const loop = createLoop(store);
  const found = store.get(loop.id);
  assert.equal(found.id, loop.id);
  assert.equal(store.get('nonexistent'), undefined);
});

test('list returns all loops', () => {
  const store = setup();
  const a = createLoop(store);
  const b = createLoop(store);
  const all = store.list();
  assert.equal(all.length, 2);
});

test('listByProject filters by projectId', () => {
  const store = setup();
  createLoop(store);
  store.create({
    projectId: 'other-project',
    sourceEndpointId: 'chatgpt-web',
    targetEndpointId: 'workbuddy',
    maxCycles: 1,
    noProgressLimit: 1,
    deadlineAt: now + 600_000,
    now,
  });
  assert.equal(store.listByProject('cli-bridge').length, 1);
  assert.equal(store.listByProject('other-project').length, 1);
  assert.equal(store.listByProject('unknown').length, 0);
});

// --- Lifecycle transitions ---

test('start moves draft to running', () => {
  const store = setup();
  const loop = createLoop(store);
  const started = store.start(loop.id, now + 1000);
  assert.equal(started.status, 'running');
  assert.ok(started.startedAt);
});

test('start refuses non-draft loops', () => {
  const store = setup();
  const loop = createLoop(store);
  store.start(loop.id);
  assert.equal(store.start(loop.id, now + 2000), undefined);
});

test('pause moves running to paused', () => {
  const store = setup();
  const loop = createLoop(store);
  store.start(loop.id);
  const paused = store.pause(loop.id, now + 1000);
  assert.equal(paused.status, 'paused');
});

test('pause refuses non-running loops', () => {
  const store = setup();
  const loop = createLoop(store);
  assert.equal(store.pause(loop.id), undefined);
});

test('resume moves paused back to running', () => {
  const store = setup();
  const loop = createLoop(store);
  store.start(loop.id);
  store.pause(loop.id);
  const resumed = store.resume(loop.id, now + 2000);
  assert.equal(resumed.status, 'running');
});

test('cancel sets cancelled status', () => {
  const store = setup();
  const loop = createLoop(store);
  store.start(loop.id);
  const cancelled = store.cancel(loop.id);
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.stopReason, 'cancelled');
});

test('cancel is idempotent on terminal states', () => {
  const store = setup();
  const loop = createLoop(store);
  store.cancel(loop.id);
  assert.equal(store.cancel(loop.id), undefined);
});

// --- Cycles ---

test('beginCycle creates a planned cycle and increments count', () => {
  const store = setup();
  const loop = createLoop(store);
  store.start(loop.id);
  const cycle = store.beginCycle(loop.id, { promptHash: 'sha256:abc', now: now + 1000 });
  assert.equal(cycle.status, 'planned');
  assert.equal(cycle.index, 1);
  assert.equal(cycle.loopId, loop.id);

  const updated = store.get(loop.id);
  assert.equal(updated.cycleCount, 1);
});

test('beginCycle refuses non-running loops', () => {
  const store = setup();
  const loop = createLoop(store);
  assert.equal(store.beginCycle(loop.id, { promptHash: 'sha256:abc' }), undefined);
});

test('markCycleReturned updates cycle and progress', () => {
  const store = setup();
  const loop = createLoop(store);
  store.start(loop.id);
  const cycle = store.beginCycle(loop.id, { promptHash: 'sha256:abc' });

  const updated = store.markCycleReturned(loop.id, cycle.id, {
    progressHash: 'sha256:result1',
    now: now + 2000,
  });
  assert.equal(updated.status, 'returned');
  assert.equal(updated.progressHash, 'sha256:result1');

  const loopAfter = store.get(loop.id);
  assert.equal(loopAfter.lastProgressHash, 'sha256:result1');
  assert.equal(loopAfter.noProgressCount, 1);
});

test('markCycleFailed updates cycle', () => {
  const store = setup();
  const loop = createLoop(store);
  store.start(loop.id);
  const cycle = store.beginCycle(loop.id, { promptHash: 'sha256:abc' });

  const updated = store.markCycleFailed(loop.id, cycle.id, {
    progressHash: 'sha256:error',
    now: now + 2000,
  });
  assert.equal(updated.status, 'failed');
});

test('getCycles returns all cycles for a loop', () => {
  const store = setup();
  const loop = createLoop(store);
  store.start(loop.id);
  store.beginCycle(loop.id, { promptHash: 'sha256:a' });
  store.beginCycle(loop.id, { promptHash: 'sha256:b' });

  const cycles = store.getCycles(loop.id);
  assert.equal(cycles.length, 2);
});

// --- Stop condition: max-cycles ---

test('evaluateStop returns max-cycles when cycleCount reaches maxCycles', () => {
  const store = setup();
  const loop = createLoop(store, { maxCycles: 2 });
  store.start(loop.id);

  const c1 = store.beginCycle(loop.id, { promptHash: 'sha256:a' });
  store.markCycleReturned(loop.id, c1.id, { progressHash: 'sha256:r1' });
  const c2 = store.beginCycle(loop.id, { promptHash: 'sha256:b' });
  store.markCycleReturned(loop.id, c2.id, { progressHash: 'sha256:r2' });

  const result = store.evaluateStop(loop.id, { now: now + 3000 });
  assert.equal(result.stop, true);
  assert.equal(result.reason, 'max-cycles');

  const loopAfter = store.get(loop.id);
  assert.equal(loopAfter.status, 'done');
  assert.equal(loopAfter.stopReason, 'max-cycles');
});

// --- Stop condition: no-progress ---

test('evaluateStop returns no-progress after repeated same hash', () => {
  const store = setup();
  const loop = createLoop(store, { noProgressLimit: 2 });
  store.start(loop.id);

  const c1 = store.beginCycle(loop.id, { promptHash: 'sha256:a' });
  store.markCycleReturned(loop.id, c1.id, { progressHash: 'sha256:same' });
  const c2 = store.beginCycle(loop.id, { promptHash: 'sha256:b' });
  store.markCycleReturned(loop.id, c2.id, { progressHash: 'sha256:same' });

  const result = store.evaluateStop(loop.id, { now: now + 3000 });
  assert.equal(result.stop, true);
  assert.equal(result.reason, 'no-progress');
});

test('no-progress resets when hash changes', () => {
  const store = setup();
  const loop = createLoop(store, { noProgressLimit: 2 });
  store.start(loop.id);

  const c1 = store.beginCycle(loop.id, { promptHash: 'sha256:a' });
  store.markCycleReturned(loop.id, c1.id, { progressHash: 'sha256:same' });
  const c2 = store.beginCycle(loop.id, { promptHash: 'sha256:b' });
  store.markCycleReturned(loop.id, c2.id, { progressHash: 'sha256:different' });

  const pre = store.get(loop.id);
  assert.equal(pre.noProgressCount, 1);

  const result = store.evaluateStop(loop.id, { now: now + 3000 });
  assert.equal(result.stop, false);
});

// --- Stop condition: deadline ---

test('evaluateStop returns deadline when past deadline', () => {
  const store = setup();
  const loop = createLoop(store, { deadlineAt: now + 1000 });
  store.start(loop.id, now + 500);

  const result = store.evaluateStop(loop.id, { now: now + 2000 });
  assert.equal(result.stop, true);
  assert.equal(result.reason, 'deadline');

  const loopAfter = store.get(loop.id);
  assert.equal(loopAfter.status, 'failed');
});

// --- Stop condition: goal states ---

test('evaluateStop returns goal-done', () => {
  const store = setup();
  const loop = createLoop(store);
  store.start(loop.id);

  const result = store.evaluateStop(loop.id, { goalStatus: 'done' });
  assert.equal(result.stop, true);
  assert.equal(result.reason, 'goal-done');
});

test('evaluateStop returns goal-cancelled', () => {
  const store = setup();
  const loop = createLoop(store);
  store.start(loop.id);

  const result = store.evaluateStop(loop.id, { goalStatus: 'cancelled' });
  assert.equal(result.stop, true);
  assert.equal(result.reason, 'goal-cancelled');
});

test('evaluateStop returns goal-failed', () => {
  const store = setup();
  const loop = createLoop(store);
  store.start(loop.id);

  const result = store.evaluateStop(loop.id, { goalStatus: 'failed' });
  assert.equal(result.stop, true);
  assert.equal(result.reason, 'goal-failed');
});

// --- Stop condition: paused / cancelled ---

test('evaluateStop returns manual-pause for paused loop', () => {
  const store = setup();
  const loop = createLoop(store);
  store.start(loop.id);
  store.pause(loop.id);

  const result = store.evaluateStop(loop.id);
  assert.equal(result.stop, true);
  assert.equal(result.reason, 'manual-pause');
});

test('evaluateStop returns cancelled for cancelled loop', () => {
  const store = setup();
  const loop = createLoop(store);
  store.cancel(loop.id);

  const result = store.evaluateStop(loop.id);
  assert.equal(result.stop, true);
  assert.equal(result.reason, 'cancelled');
});

test('evaluateStop returns cancelled for unknown loop', () => {
  const store = setup();
  const result = store.evaluateStop('nonexistent');
  assert.equal(result.stop, true);
  assert.equal(result.reason, 'cancelled');
});

// --- Stop condition: endpoint-unavailable ---

test('evaluateStop returns endpoint-unavailable', () => {
  const store = setup();
  const loop = createLoop(store);
  store.start(loop.id);

  const result = store.evaluateStop(loop.id, { endpointAvailable: false });
  assert.equal(result.stop, true);
  assert.equal(result.reason, 'endpoint-unavailable');
});

// --- Persistence ---

test('exportLoops and exportCycles return all data', () => {
  const store = setup();
  const loop = createLoop(store);
  store.start(loop.id);
  const cycle = store.beginCycle(loop.id, { promptHash: 'sha256:abc' });

  const loops = store.exportLoops();
  assert.equal(loops.length, 1);
  assert.equal(loops[0].id, loop.id);

  const cycles = store.exportCycles();
  assert.equal(cycles.length, 1);
  assert.equal(cycles[0].id, cycle.id);
});

test('hydrateLoop and hydrateCycle restore state', () => {
  const store1 = setup();
  const loop = createLoop(store1);
  store1.start(loop.id);

  const store2 = setup();
  const ok = store2.hydrateLoop(store1.exportLoops()[0]);
  assert.equal(ok, true);
  assert.equal(store2.get(loop.id).status, 'running');

  const ok2 = store2.hydrateCycle({
    id: 'cycle-1',
    loopId: loop.id,
    index: 1,
    status: 'returned',
    promptHash: 'sha256:abc',
    createdAt: now,
    updatedAt: now,
  });
  assert.equal(ok2, true);
  assert.equal(store2.getCycles(loop.id).length, 1);
});

test('hydrateLoop rejects invalid data', () => {
  const store = setup();
  assert.equal(store.hydrateLoop(null), false);
  assert.equal(store.hydrateLoop({}), false);
});

test('hydrateCycle rejects invalid data', () => {
  const store = setup();
  assert.equal(store.hydrateCycle(null), false);
  assert.equal(store.hydrateCycle({}), false);
});
