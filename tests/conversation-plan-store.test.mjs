// Conversation Plan Proposal Store tests (ADR-0030 EX-1).
//
// Covers:
//   1. Create proposal with all fields.
//   2. Accept/reject state transitions (valid + invalid paths).
//   3. accepted cannot be rejected again.
//   4. rejected cannot dispatch (markDispatching returns undefined).
//   5. Export → hydrate roundtrip.
//   6. Supersede creates new version, old becomes superseded.
//   7. Cannot accept superseded plan.
//   8. Cannot supersede accepted/dispatching/dispatched/returned/failed plan.
//   9. getFrozenSnapshot returns immutable copy.
//  10. Execution lifecycle: dispatching → dispatched → returned / failed.

import assert from 'node:assert/strict';
import test from 'node:test';
import { InMemoryPlanProposalStore } from '../apps/local-server/src/storage/conversation-plan-store.ts';

const now = 1793000000000;

function makeParams(overrides = {}) {
  return {
    projectId: 'test-proj',
    sessionId: 'session-1',
    sourceEndpointId: 'src-1',
    plannerEndpointId: 'planner-1',
    executorEndpointIds: ['exec-1'],
    userEventId: 'evt-1',
    title: 'Test Plan',
    body: 'Do the thing',
    steps: ['Step 1', 'Step 2'],
    constraints: ['No shell command'],
    riskNotes: ['Risk A'],
    now,
    ...overrides,
  };
}

// ════════════════════════════════════════════════════════════════════
// 1. Create proposal
// ════════════════════════════════════════════════════════════════════

test('create proposal with all fields', () => {
  const store = new InMemoryPlanProposalStore();
  const plan = store.create(makeParams());

  assert.equal(plan.projectId, 'test-proj');
  assert.equal(plan.sessionId, 'session-1');
  assert.equal(plan.version, 1);
  assert.equal(plan.title, 'Test Plan');
  assert.equal(plan.body, 'Do the thing');
  assert.deepEqual(plan.steps, ['Step 1', 'Step 2']);
  assert.deepEqual(plan.constraints, ['No shell command']);
  assert.deepEqual(plan.riskNotes, ['Risk A']);
  assert.equal(plan.status, 'proposed');
  assert.equal(plan.createdAt, now);
  assert.equal(plan.updatedAt, now);
  assert.ok(plan.id.startsWith('plan-'));
});

test('created plan is always version 1 and proposed', () => {
  const store = new InMemoryPlanProposalStore();
  const plan = store.create(makeParams());
  assert.equal(plan.version, 1);
  assert.equal(plan.status, 'proposed');
});

test('arrays are defensive copies on create', () => {
  const store = new InMemoryPlanProposalStore();
  const steps = ['Step 1'];
  const plan = store.create(makeParams({ steps }));

  // Mutate original array
  steps.push('Step 2');
  assert.deepEqual(plan.steps, ['Step 1']);
});

// ════════════════════════════════════════════════════════════════════
// 2. Accept / reject transitions
// ════════════════════════════════════════════════════════════════════

test('accept transitions proposed → accepted', () => {
  const store = new InMemoryPlanProposalStore();
  const plan = store.create(makeParams());
  const result = store.accept(plan.id, now + 1);

  assert.equal(result.ok, true);
  assert.equal(result.plan.status, 'accepted');
  assert.equal(result.plan.updatedAt, now + 1);
});

test('reject transitions proposed → rejected', () => {
  const store = new InMemoryPlanProposalStore();
  const plan = store.create(makeParams());
  const rejected = store.reject(plan.id);

  assert.ok(rejected);
  assert.equal(rejected.status, 'rejected');
});

test('accept fails for non-existent plan', () => {
  const store = new InMemoryPlanProposalStore();
  const result = store.accept('no-such-plan');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'plan not found');
});

test('reject returns undefined for non-existent plan', () => {
  const store = new InMemoryPlanProposalStore();
  const result = store.reject('no-such-plan');
  assert.equal(result, undefined);
});

// ════════════════════════════════════════════════════════════════════
// 3. Already accepted cannot be rejected
// ════════════════════════════════════════════════════════════════════

test('accepted plan cannot be rejected', () => {
  const store = new InMemoryPlanProposalStore();
  const plan = store.create(makeParams());
  store.accept(plan.id);

  const rejected = store.reject(plan.id);
  assert.equal(rejected, undefined);

  const fetched = store.get(plan.id);
  assert.equal(fetched.status, 'accepted');
});

test('accepted plan cannot be accepted again', () => {
  const store = new InMemoryPlanProposalStore();
  const plan = store.create(makeParams());
  store.accept(plan.id);

  const result = store.accept(plan.id);
  assert.equal(result.ok, false);
  assert.match(result.reason, /must be proposed/);
});

// ════════════════════════════════════════════════════════════════════
// 4. Rejected cannot dispatch
// ════════════════════════════════════════════════════════════════════

test('rejected plan cannot mark dispatching', () => {
  const store = new InMemoryPlanProposalStore();
  const plan = store.create(makeParams());
  store.reject(plan.id);

  const result = store.markDispatching(plan.id);
  assert.equal(result, undefined);
});

test('rejected plan cannot mark dispatched', () => {
  const store = new InMemoryPlanProposalStore();
  const plan = store.create(makeParams());
  store.reject(plan.id);

  const result = store.markDispatched(plan.id);
  assert.equal(result, undefined);
});

// ════════════════════════════════════════════════════════════════════
// 5. Snapshot roundtrip
// ════════════════════════════════════════════════════════════════════

test('exportProposals returns all plans', () => {
  const store = new InMemoryPlanProposalStore();
  store.create(makeParams({ projectId: 'p1' }));
  store.create(makeParams({ projectId: 'p2' }));

  const exported = store.exportProposals();
  assert.equal(exported.length, 2);
  assert.ok(exported.some(p => p.projectId === 'p1'));
  assert.ok(exported.some(p => p.projectId === 'p2'));
});

test('hydrateProposal restores a stored plan', () => {
  const store = new InMemoryPlanProposalStore();
  const plan = store.create(makeParams());
  store.accept(plan.id);

  // Simulate hydration into a fresh store
  const store2 = new InMemoryPlanProposalStore();
  const exported = store.exportProposals();
  for (const p of exported) {
    store2.hydrateProposal(p);
  }

  const restored = store2.get(plan.id);
  assert.ok(restored);
  assert.equal(restored.status, 'accepted');
  assert.equal(restored.title, 'Test Plan');
  assert.equal(restored.version, 1);
});

test('hydrateProposal rejects malformed data', () => {
  const store = new InMemoryPlanProposalStore();
  store.hydrateProposal({ id: 'bad', projectId: 'x' }); // missing fields
  store.hydrateProposal(null);
  store.hydrateProposal(undefined);
  store.hydrateProposal({ id: 'bad2', status: 'invalid-status' });
  assert.equal(store.exportProposals().length, 0);
});

// ════════════════════════════════════════════════════════════════════
// 6. Supersede creates new version
// ════════════════════════════════════════════════════════════════════

test('supersede creates new version, old becomes superseded', () => {
  const store = new InMemoryPlanProposalStore();
  const v1 = store.create(makeParams({ title: 'Plan v1' }));

  const v2 = store.supersede(v1.id, {
    title: 'Plan v2',
    body: 'Updated body',
    steps: ['Step A', 'Step B'],
    constraints: ['Updated constraint'],
    riskNotes: ['Updated risk'],
  }, now + 1000);

  assert.ok(v2);
  assert.equal(v2.version, 2);
  assert.equal(v2.title, 'Plan v2');
  assert.equal(v2.status, 'proposed');

  const oldV1 = store.get(v1.id);
  assert.equal(oldV1.status, 'superseded');
  assert.equal(oldV1.supersededById, v2.id);
});

test('supersede increments version correctly', () => {
  const store = new InMemoryPlanProposalStore();
  const v1 = store.create(makeParams({ title: 'v1' }));
  const v2 = store.supersede(v1.id, { title: 'v2', body: 'b', steps: [], constraints: [], riskNotes: [] });
  const v3 = store.supersede(v2.id, { title: 'v3', body: 'b', steps: [], constraints: [], riskNotes: [] });

  assert.equal(v1.version, 1);
  assert.equal(v2.version, 2);
  assert.equal(v3.version, 3);
  assert.equal(store.get(v1.id).status, 'superseded');
  assert.equal(store.get(v2.id).status, 'superseded');
  assert.equal(store.get(v3.id).status, 'proposed');
});

test('listBySession returns all versions sorted', () => {
  const store = new InMemoryPlanProposalStore();
  const v1 = store.create(makeParams({ title: 'v1' }));
  const v2 = store.supersede(v1.id, { title: 'v2', body: 'b', steps: [], constraints: [], riskNotes: [] });
  const v3 = store.supersede(v2.id, { title: 'v3', body: 'b', steps: [], constraints: [], riskNotes: [] });

  const plans = store.listBySession('session-1');
  assert.equal(plans.length, 3);
  assert.equal(plans[0].version, 1);
  assert.equal(plans[1].version, 2);
  assert.equal(plans[2].version, 3);
});

test('getLatestBySession returns newest version', () => {
  const store = new InMemoryPlanProposalStore();
  const v1 = store.create(makeParams({ title: 'v1' }));
  const v2 = store.supersede(v1.id, { title: 'v2', body: 'b', steps: [], constraints: [], riskNotes: [] });

  const latest = store.getLatestBySession('session-1');
  assert.equal(latest.id, v2.id);
  assert.equal(latest.version, 2);
});

// ════════════════════════════════════════════════════════════════════
// 7. Cannot accept superseded plan
// ════════════════════════════════════════════════════════════════════

test('superseded plan cannot be accepted', () => {
  const store = new InMemoryPlanProposalStore();
  const v1 = store.create(makeParams({ title: 'v1' }));
  store.supersede(v1.id, { title: 'v2', body: 'b', steps: [], constraints: [], riskNotes: [] });

  const result = store.accept(v1.id);
  assert.equal(result.ok, false);
  assert.match(result.reason, /plan status is superseded/);
});

test('only latest version (proposed) is accept-eligible', () => {
  const store = new InMemoryPlanProposalStore();
  const v1 = store.create(makeParams({ title: 'v1' }));
  const v2 = store.supersede(v1.id, { title: 'v2', body: 'b', steps: [], constraints: [], riskNotes: [] });

  const acceptV1 = store.accept(v1.id);
  assert.equal(acceptV1.ok, false);

  const acceptV2 = store.accept(v2.id);
  assert.equal(acceptV2.ok, true);
});

// ════════════════════════════════════════════════════════════════════
// 8. Cannot supersede accepted/dispatching/dispatched/returned/failed
// ════════════════════════════════════════════════════════════════════

test('cannot supersede accepted plan', () => {
  const store = new InMemoryPlanProposalStore();
  const plan = store.create(makeParams());
  store.accept(plan.id);

  const v2 = store.supersede(plan.id, { title: 'v2', body: 'b', steps: [], constraints: [], riskNotes: [] });
  assert.equal(v2, undefined);
});

test('cannot supersede rejected plan', () => {
  const store = new InMemoryPlanProposalStore();
  const plan = store.create(makeParams());
  store.reject(plan.id);

  const v2 = store.supersede(plan.id, { title: 'v2', body: 'b', steps: [], constraints: [], riskNotes: [] });
  assert.equal(v2, undefined);
});

test('cannot supersede non-existent plan', () => {
  const store = new InMemoryPlanProposalStore();
  const v2 = store.supersede('no-such-plan', { title: 'v2', body: 'b', steps: [], constraints: [], riskNotes: [] });
  assert.equal(v2, undefined);
});

// ════════════════════════════════════════════════════════════════════
// 9. getFrozenSnapshot returns immutable copy
// ════════════════════════════════════════════════════════════════════

test('getFrozenSnapshot returns plan data as snapshot', () => {
  const store = new InMemoryPlanProposalStore();
  const plan = store.create(makeParams());
  store.accept(plan.id);

  const snapshot = store.getFrozenSnapshot(plan.id);
  assert.ok(snapshot);
  assert.equal(snapshot.planId, plan.id);
  assert.equal(snapshot.version, plan.version);
  assert.equal(snapshot.title, 'Test Plan');
  assert.equal(snapshot.body, 'Do the thing');
  assert.deepEqual(snapshot.steps, ['Step 1', 'Step 2']);
  assert.deepEqual(snapshot.constraints, ['No shell command']);
  assert.deepEqual(snapshot.riskNotes, ['Risk A']);
  assert.deepEqual(snapshot.executorEndpointIds, ['exec-1']);
  assert.ok(typeof snapshot.frozenAt === 'number');
});

test('getFrozenSnapshot returns undefined for unknown plan', () => {
  const store = new InMemoryPlanProposalStore();
  assert.equal(store.getFrozenSnapshot('no-such-plan'), undefined);
});

test('getFrozenSnapshot arrays are defensive copies', () => {
  const store = new InMemoryPlanProposalStore();
  const plan = store.create(makeParams());
  store.accept(plan.id);

  const snapshot = store.getFrozenSnapshot(plan.id);
  snapshot.steps.push('injected');
  assert.deepEqual(store.get(plan.id).steps, ['Step 1', 'Step 2']);
});

// ════════════════════════════════════════════════════════════════════
// 10. Execution lifecycle
// ════════════════════════════════════════════════════════════════════

test('full execution lifecycle: proposed → accepted → dispatching → dispatched → returned', () => {
  const store = new InMemoryPlanProposalStore();
  const plan = store.create(makeParams());

  const accepted = store.accept(plan.id);
  assert.equal(accepted.ok, true);
  assert.equal(accepted.plan.status, 'accepted');

  const dispatching = store.markDispatching(plan.id);
  assert.equal(dispatching.status, 'dispatching');

  const dispatched = store.markDispatched(plan.id);
  assert.equal(dispatched.status, 'dispatched');

  const returned = store.markReturned(plan.id);
  assert.equal(returned.status, 'returned');
});

test('full execution lifecycle: proposed → accepted → dispatching → dispatched → failed', () => {
  const store = new InMemoryPlanProposalStore();
  const plan = store.create(makeParams());
  store.accept(plan.id);
  store.markDispatching(plan.id);
  store.markDispatched(plan.id);

  const failed = store.markFailed(plan.id);
  assert.equal(failed.status, 'failed');
});

test('cannot mark dispatching before accept', () => {
  const store = new InMemoryPlanProposalStore();
  const plan = store.create(makeParams());

  const result = store.markDispatching(plan.id);
  assert.equal(result, undefined);
});

test('markReturned works from dispatching state too', () => {
  const store = new InMemoryPlanProposalStore();
  const plan = store.create(makeParams());
  store.accept(plan.id);
  store.markDispatching(plan.id);

  const returned = store.markReturned(plan.id);
  assert.equal(returned.status, 'returned');
});

// ════════════════════════════════════════════════════════════════════
// 11. Immutability: proposed content is frozen
// ════════════════════════════════════════════════════════════════════

test('store clones on read so external mutations do not affect stored plan', () => {
  const store = new InMemoryPlanProposalStore();
  const plan = store.create(makeParams());

  const fetched = store.get(plan.id);
  fetched.title = 'hacked title';
  fetched.steps.push('hacked step');

  const reFetched = store.get(plan.id);
  assert.equal(reFetched.title, 'Test Plan');
  assert.deepEqual(reFetched.steps, ['Step 1', 'Step 2']);
});

test('body content preserved through lifecycle transitions', () => {
  const store = new InMemoryPlanProposalStore();
  const plan = store.create(makeParams({ body: 'Original body content' }));

  store.accept(plan.id);
  store.markDispatching(plan.id);
  store.markDispatched(plan.id);
  store.markReturned(plan.id);

  const final = store.get(plan.id);
  assert.equal(final.body, 'Original body content');
  assert.equal(final.status, 'returned');
});

// ════════════════════════════════════════════════════════════════════
// 12. findByUserEventId
// ════════════════════════════════════════════════════════════════════

test('findByUserEventId locates plan by user event', () => {
  const store = new InMemoryPlanProposalStore();
  const plan = store.create(makeParams({ userEventId: 'evt-42' }));

  const found = store.findByUserEventId('evt-42');
  assert.ok(found);
  assert.equal(found.id, plan.id);
});

test('findByUserEventId returns undefined for unknown event', () => {
  const store = new InMemoryPlanProposalStore();
  store.create(makeParams({ userEventId: 'evt-1' }));
  assert.equal(store.findByUserEventId('evt-unknown'), undefined);
});
