// Goal orchestrator tests (§7.3, ADR-0003).
//
// Covers all 8 required scenarios:
//   1. Plan not approved → advance rejects.
//   2. Non-mutating step → running → done.
//   3. Mutating step → blocked-needs-gate.
//   4. Gated-approved mutating step → can run.
//   5. Step ceiling → stops after N advances.
//   6. Step failure → orchestrator stops.
//   7. Cancel / interruption → no more advance.
//   8. Tier not in permittedTiers → fail-closed.
//
// Bonus:
//   - runAll traces full multi-step sequences.
//   - Mixed plans (non-mutating + mutating) gate correctly.
//   - Idempotent advance on completed plan.

import assert from 'node:assert/strict';
import test from 'node:test';

import { InMemoryGoalStore } from '../apps/local-server/src/storage/goal-store.ts';
import { GoalOrchestrator } from '../apps/local-server/src/goal/goal-orchestrator.ts';

const now = 1791000000000;

// ---- Helpers ----

function setup() {
  return {
    store: new InMemoryGoalStore(),
  };
}

/** Create a goal, attach a plan, return ids. */
function createApprovedPlan(store, steps, opts = {}) {
  const goal = store.createGoal({
    sessionId: 'session-1',
    description: 'Test plan',
    now,
  });
  const plan = store.attachPlan({
    goalId: goal.id,
    steps,
    permittedTiers: opts.permittedTiers ?? ['patch-proposal', 'workspace-write'],
    now: now + 1,
  });
  store.approvePlan(goal.id, now + 2);
  return { goalId: goal.id, planId: plan.id, plan };
}

// ════════════════════════════════════════════════════════════════════
// §1  Plan not approved → advance returns noop
// ════════════════════════════════════════════════════════════════════

test('[§7.3-1a] advance returns noop when plan is awaiting-approval', () => {
  const { store } = setup();
  const goal = store.createGoal({ sessionId: 's1', description: 'Do X', now });
  store.attachPlan({
    goalId: goal.id,
    steps: [{ intent: 'review', kind: 'review', targetEndpointId: 'ep' }],
    now: now + 1,
  });
  // NOT approved.

  const orch = new GoalOrchestrator(store);
  const result = orch.advance(goal.id);

  assert.equal(result.type, 'noop');
  assert.ok(
    result.reason.includes('awaiting-approval') ||
    result.reason.includes('plan-status') ||
    result.reason.includes('goal-status'),
    `unexpected reason: ${result.reason}`,
  );
});

test('[§7.3-1b] advance returns noop when plan is still draft', () => {
  const { store } = setup();
  const goal = store.createGoal({ sessionId: 's1', description: 'Do X', now });
  // No plan attached yet.

  const orch = new GoalOrchestrator(store);
  const result = orch.advance(goal.id);

  assert.equal(result.type, 'noop');
  assert.ok(result.reason.includes('draft') || result.reason.includes('plan'), result.reason);
});

test('[§7.3-1c] runAll returns single noop when plan is not approved', () => {
  const { store } = setup();
  const goal = store.createGoal({ sessionId: 's1', description: 'Do X', now });
  store.attachPlan({
    goalId: goal.id,
    steps: [{ intent: 'review', kind: 'review', targetEndpointId: 'ep' }],
    now: now + 1,
  });

  const orch = new GoalOrchestrator(store);
  const results = orch.runAll(goal.id);

  assert.equal(results.length, 1);
  assert.equal(results[0].type, 'noop');
});

// ════════════════════════════════════════════════════════════════════
// §2  Non-mutating step advances to running → done
// ════════════════════════════════════════════════════════════════════

test('[§7.3-2a] single non-mutating (review) step → step-completed', () => {
  const { store } = setup();
  const { goalId } = createApprovedPlan(store, [
    { intent: 'Review code', kind: 'review', targetEndpointId: 'claude-command' },
  ]);

  const orch = new GoalOrchestrator(store);
  const result = orch.advance(goalId);

  assert.equal(result.type, 'step-completed');
  assert.equal(result.stepKind, 'review');
});

test('[§7.3-2b] non-mutating step completion updates store state', () => {
  const { store } = setup();
  const { goalId } = createApprovedPlan(store, [
    { intent: 'Summarize findings', kind: 'summarize', targetEndpointId: 'claude-command' },
  ]);

  const orch = new GoalOrchestrator(store);
  orch.advance(goalId);

  const plan = store.getPlanByGoal(goalId);
  assert.equal(plan.steps[0].status, 'done');
  assert.equal(plan.status, 'done');
  assert.equal(store.getGoal(goalId).status, 'done');
});

test('[§7.3-2c] non-mutating step records output', () => {
  const { store } = setup();
  const { goalId } = createApprovedPlan(store, [
    { intent: 'Propose a patch', kind: 'propose-patch', targetEndpointId: 'codex-command' },
  ]);

  const orch = new GoalOrchestrator(store);
  const result = orch.advance(goalId, { output: 'patch-v1' });

  assert.equal(result.type, 'step-completed');
  assert.equal(result.output, 'patch-v1');
  assert.equal(store.getPlanByGoal(goalId).steps[0].output, 'patch-v1');
});

test('[§7.3-2d] multiple non-mutating steps run in sequence via runAll', () => {
  const { store } = setup();
  const { goalId } = createApprovedPlan(store, [
    { intent: 'Review A', kind: 'review', targetEndpointId: 'c1' },
    { intent: 'Summarize', kind: 'summarize', targetEndpointId: 'c1' },
    { intent: 'Propose B', kind: 'propose-patch', targetEndpointId: 'c1' },
  ]);

  const orch = new GoalOrchestrator(store);
  const results = orch.runAll(goalId);

  assert.equal(results.length, 4); // 3 completes + 1 plan-completed
  assert.equal(results[0].type, 'step-completed');
  assert.equal(results[0].stepIndex, 0);
  assert.equal(results[1].type, 'step-completed');
  assert.equal(results[1].stepIndex, 1);
  assert.equal(results[2].type, 'step-completed');
  assert.equal(results[2].stepIndex, 2);
  assert.equal(results[3].type, 'plan-completed');

  assert.equal(orch.stepsAdvanced, 3);
  const plan = store.getPlanByGoal(goalId);
  assert.equal(plan.status, 'done');
  assert.equal(store.getGoal(goalId).status, 'done');
});

// ════════════════════════════════════════════════════════════════════
// §3  Mutating step → blocked-needs-gate
// ════════════════════════════════════════════════════════════════════

test('[§7.3-3a] mutating step is blocked at gate (not auto-run)', () => {
  const { store } = setup();
  const { goalId } = createApprovedPlan(store, [
    { intent: 'Write config', kind: 'write-file', targetEndpointId: 'codex-command', tier: 'workspace-write' },
  ], { permittedTiers: ['patch-proposal', 'workspace-write'] });

  const orch = new GoalOrchestrator(store);
  const result = orch.advance(goalId);

  assert.equal(result.type, 'step-gated');
  assert.equal(result.stepKind, 'write-file');

  // Step must be in blocked-needs-gate, NOT running or done.
  const plan = store.getPlanByGoal(goalId);
  assert.equal(plan.steps[0].status, 'blocked-needs-gate');
});

test('[§7.3-3b] runAll stops at first mutating step gate', () => {
  const { store } = setup();
  const { goalId } = createApprovedPlan(store, [
    { intent: 'Review', kind: 'review', targetEndpointId: 'c1' },
    { intent: 'Summarize', kind: 'summarize', targetEndpointId: 'c1' },
    { intent: 'Write file', kind: 'write-file', targetEndpointId: 'codex-command', tier: 'workspace-write' },
    { intent: 'Review again', kind: 'review', targetEndpointId: 'c1' },
  ], { permittedTiers: ['patch-proposal', 'workspace-write'] });

  const orch = new GoalOrchestrator(store);
  const results = orch.runAll(goalId);

  // Should get: step-completed (review), step-completed (summarize), step-gated (write-file)
  assert.ok(results.length >= 3, `expected >=3 results, got ${results.length}`);
  assert.equal(results[0].type, 'step-completed');
  assert.equal(results[1].type, 'step-completed');
  assert.equal(results[2].type, 'step-gated');
  assert.equal(results[2].stepKind, 'write-file');

  // Non-mutating steps are done, mutating step is blocked.
  const plan = store.getPlanByGoal(goalId);
  assert.equal(plan.steps[0].status, 'done');
  assert.equal(plan.steps[1].status, 'done');
  assert.equal(plan.steps[2].status, 'blocked-needs-gate');
  assert.equal(plan.steps[3].status, 'pending'); // not yet touched
});

// ════════════════════════════════════════════════════════════════════
// §4  Gated-approved mutating step → can run
// ════════════════════════════════════════════════════════════════════

test('[§7.3-4a] gated-approved mutating step advances to running → done', () => {
  const { store } = setup();
  const { goalId } = createApprovedPlan(store, [
    { intent: 'Write config', kind: 'write-file', targetEndpointId: 'codex-command', tier: 'workspace-write' },
  ], { permittedTiers: ['patch-proposal', 'workspace-write'] });

  const orch = new GoalOrchestrator(store);

  // First advance: block at gate.
  const gated = orch.advance(goalId);
  assert.equal(gated.type, 'step-gated');

  // Human approves the gate.
  const plan = store.getPlanByGoal(goalId);
  store.approveStepGate(goalId, plan.steps[0].id, now + 10);
  assert.equal(store.getPlanByGoal(goalId).steps[0].status, 'gated-approved');

  // Second advance: now it runs.
  const done = orch.advance(goalId);
  assert.equal(done.type, 'step-completed');
  assert.equal(done.stepKind, 'write-file');

  const finalPlan = store.getPlanByGoal(goalId);
  assert.equal(finalPlan.steps[0].status, 'done');
  assert.equal(finalPlan.status, 'done');
});

test('[§7.3-4b] mutating step cannot run before gate approval', () => {
  const { store } = setup();
  const { goalId } = createApprovedPlan(store, [
    { intent: 'Apply patch', kind: 'apply-patch', targetEndpointId: 'codex-command', tier: 'workspace-write' },
  ], { permittedTiers: ['patch-proposal', 'workspace-write'] });

  const orch = new GoalOrchestrator(store);

  // First advance: blocks at gate.
  const result1 = orch.advance(goalId);
  assert.equal(result1.type, 'step-gated');

  // Advance again WITHOUT gate approval → noop (all steps gated).
  const result2 = orch.advance(goalId);
  assert.equal(result2.type, 'noop');
  assert.ok(result2.reason.includes('gated'), `expected gated reason, got: ${result2.reason}`);
});

test('[§7.3-4c] runAll resumes after gate approval and completes mutating steps', () => {
  const { store } = setup();
  const { goalId } = createApprovedPlan(store, [
    { intent: 'Review', kind: 'review', targetEndpointId: 'c1' },
    { intent: 'Write file', kind: 'write-file', targetEndpointId: 'codex-command', tier: 'workspace-write' },
    { intent: 'Summarize', kind: 'summarize', targetEndpointId: 'c1' },
  ], { permittedTiers: ['patch-proposal', 'workspace-write'] });

  const orch = new GoalOrchestrator(store);

  // First runAll: completes review, gates write-file.
  const results1 = orch.runAll(goalId);
  assert.equal(results1[0].type, 'step-completed'); // review
  assert.equal(results1[1].type, 'step-gated');     // write-file

  // Gate-approve the mutating step.
  const plan = store.getPlanByGoal(goalId);
  store.approveStepGate(goalId, plan.steps[1].id, now + 10);

  // Second runAll: completes write-file and summarize.
  const results2 = orch.runAll(goalId);
  assert.equal(results2[0].type, 'step-completed'); // write-file
  assert.equal(results2[0].stepKind, 'write-file');
  assert.equal(results2[1].type, 'step-completed'); // summarize
  assert.equal(results2[2].type, 'plan-completed');

  const finalPlan = store.getPlanByGoal(goalId);
  assert.equal(finalPlan.status, 'done');
});

// ════════════════════════════════════════════════════════════════════
// §5  Step ceiling
// ════════════════════════════════════════════════════════════════════

test('[§7.3-5a] step ceiling stops advance() after N runs', () => {
  const { store } = setup();
  const { goalId } = createApprovedPlan(store, [
    { intent: 'R1', kind: 'review', targetEndpointId: 'c1' },
    { intent: 'R2', kind: 'review', targetEndpointId: 'c1' },
    { intent: 'R3', kind: 'review', targetEndpointId: 'c1' },
    { intent: 'R4', kind: 'review', targetEndpointId: 'c1' },
    { intent: 'R5', kind: 'review', targetEndpointId: 'c1' },
  ]);

  const orch = new GoalOrchestrator(store, { stepCeiling: 3 });

  const r1 = orch.advance(goalId);
  assert.equal(r1.type, 'step-completed');
  assert.equal(orch.stepsAdvanced, 1);

  const r2 = orch.advance(goalId);
  assert.equal(r2.type, 'step-completed');
  assert.equal(orch.stepsAdvanced, 2);

  const r3 = orch.advance(goalId);
  assert.equal(r3.type, 'step-completed');
  assert.equal(orch.stepsAdvanced, 3);

  // Ceiling hit on the 4th advance.
  const r4 = orch.advance(goalId);
  assert.equal(r4.type, 'ceiling-reached');
  assert.equal(r4.stepCeiling, 3);

  // Subsequent calls keep returning ceiling-reached.
  const r5 = orch.advance(goalId);
  assert.equal(r5.type, 'ceiling-reached');
});

test('[§7.3-5b] default step ceiling is 20', () => {
  const { store } = setup();
  const { goalId } = createApprovedPlan(store,
    Array.from({ length: 25 }, (_, i) => ({
      intent: `Step ${i}`, kind: 'review', targetEndpointId: 'c1',
    })),
  );

  const orch = new GoalOrchestrator(store);
  const results = orch.runAll(goalId);

  const completions = results.filter((r) => r.type === 'step-completed');
  assert.equal(completions.length, 20); // ceiling at 20

  const last = results[results.length - 1];
  assert.equal(last.type, 'ceiling-reached');

  assert.equal(orch.stepsAdvanced, 20);
});

test('[§7.3-5c] ceiling applies across advance() and runAll() calls', () => {
  const { store } = setup();
  const { goalId } = createApprovedPlan(store, [
    { intent: 'R1', kind: 'review', targetEndpointId: 'c1' },
    { intent: 'R2', kind: 'review', targetEndpointId: 'c1' },
    { intent: 'R3', kind: 'review', targetEndpointId: 'c1' },
    { intent: 'R4', kind: 'review', targetEndpointId: 'c1' },
  ]);

  const orch = new GoalOrchestrator(store, { stepCeiling: 2 });

  orch.advance(goalId);
  assert.equal(orch.stepsAdvanced, 1);

  const results = orch.runAll(goalId);
  // runAll should complete step 2, then hit ceiling.
  const completions = results.filter((r) => r.type === 'step-completed');
  assert.ok(completions.length <= 2, `too many completions: ${completions.length}`);
  assert.equal(orch.stepsAdvanced, 2);
  assert.ok(results.some((r) => r.type === 'ceiling-reached'));
});

// ════════════════════════════════════════════════════════════════════
// §6  Step failure → orchestrator stops
// ════════════════════════════════════════════════════════════════════

test('[§7.3-6a] simulateFailure causes step-failed and stops orchestrator', () => {
  const { store } = setup();
  const { goalId } = createApprovedPlan(store, [
    { intent: 'R1', kind: 'review', targetEndpointId: 'c1' },
    { intent: 'R2', kind: 'review', targetEndpointId: 'c1' },
  ]);

  const orch = new GoalOrchestrator(store);

  // First step fails.
  const r1 = orch.advance(goalId, { simulateFailure: 'review timed out' });
  assert.equal(r1.type, 'step-failed');
  assert.equal(r1.failureReason, 'review timed out');

  // Step is in failed state in the store.
  const plan = store.getPlanByGoal(goalId);
  assert.equal(plan.steps[0].status, 'failed');
  assert.equal(plan.steps[0].failureReason, 'review timed out');

  // Second advance detects the failed step and refuses.
  const r2 = orch.advance(goalId);
  assert.equal(r2.type, 'step-failed');
});

test('[§7.3-6b] runAll stops on first failure', () => {
  const { store } = setup();
  const { goalId } = createApprovedPlan(store, [
    { intent: 'R1', kind: 'review', targetEndpointId: 'c1' },
    { intent: 'R2', kind: 'summarize', targetEndpointId: 'c1' },
    { intent: 'R3', kind: 'review', targetEndpointId: 'c1' },
    { intent: 'R4', kind: 'propose-patch', targetEndpointId: 'c1' },
  ]);

  const orch = new GoalOrchestrator(store);
  const results = orch.runAll(goalId, { simulateFailure: 'broken' });

  // First step fails.
  const failures = results.filter((r) => r.type === 'step-failed');
  assert.equal(failures.length, 1);
  assert.equal(failures[0].stepIndex, 0);

  // Only one step was attempted.
  const plan = store.getPlanByGoal(goalId);
  assert.equal(plan.steps[0].status, 'failed');
  assert.equal(plan.steps[1].status, 'pending'); // never touched
});

test('[§7.3-6c] failure on mutating step after gate approval', () => {
  const { store } = setup();
  const { goalId } = createApprovedPlan(store, [
    { intent: 'Apply patch', kind: 'apply-patch', targetEndpointId: 'codex-command', tier: 'workspace-write' },
    { intent: 'Review result', kind: 'review', targetEndpointId: 'c1' },
  ], { permittedTiers: ['patch-proposal', 'workspace-write'] });

  const orch = new GoalOrchestrator(store);

  // Block at gate.
  orch.advance(goalId);
  const plan = store.getPlanByGoal(goalId);
  store.approveStepGate(goalId, plan.steps[0].id, now + 10);

  // Run and fail.
  const result = orch.advance(goalId, { simulateFailure: 'patch failed' });
  assert.equal(result.type, 'step-failed');

  // Subsequent step untouched.
  assert.equal(store.getPlanByGoal(goalId).steps[1].status, 'pending');
});

// ════════════════════════════════════════════════════════════════════
// §7  Cancel / interruption
// ════════════════════════════════════════════════════════════════════

test('[§7.3-7a] advance returns noop after goal is cancelled', () => {
  const { store } = setup();
  const { goalId } = createApprovedPlan(store, [
    { intent: 'Review', kind: 'review', targetEndpointId: 'c1' },
  ]);

  store.cancelGoal(goalId, now + 10);
  assert.equal(store.getGoal(goalId).status, 'cancelled');

  const orch = new GoalOrchestrator(store);
  const result = orch.advance(goalId);

  assert.equal(result.type, 'noop');
  assert.ok(result.reason.includes('cancelled'), result.reason);
});

test('[§7.3-7b] advance returns noop after goal is already done', () => {
  const { store } = setup();
  const { goalId } = createApprovedPlan(store, [
    { intent: 'Review', kind: 'review', targetEndpointId: 'c1' },
  ]);

  // Run to completion.
  const orch1 = new GoalOrchestrator(store);
  orch1.advance(goalId);
  assert.equal(store.getGoal(goalId).status, 'done');

  // New orchestrator sees done goal.
  const orch2 = new GoalOrchestrator(store);
  const result = orch2.advance(goalId);
  assert.equal(result.type, 'plan-completed');
});

test('[§7.3-7c] cancel mid-sequence stops runAll immediately', () => {
  const { store } = setup();
  const { goalId } = createApprovedPlan(store, [
    { intent: 'R1', kind: 'review', targetEndpointId: 'c1' },
    { intent: 'R2', kind: 'review', targetEndpointId: 'c1' },
    { intent: 'R3', kind: 'review', targetEndpointId: 'c1' },
    { intent: 'R4', kind: 'review', targetEndpointId: 'c1' },
  ]);

  const orch = new GoalOrchestrator(store);

  // Advance one step manually.
  orch.advance(goalId);
  assert.equal(orch.stepsAdvanced, 1);

  // Cancel mid-run.
  store.cancelGoal(goalId, now + 10);

  // runAll should stop immediately.
  const results = orch.runAll(goalId);
  assert.ok(results.length >= 1);
  assert.equal(results[0].type, 'noop');
  assert.ok(results[0].reason.includes('cancelled'));

  // No additional steps advanced.
  assert.equal(orch.stepsAdvanced, 1); // unchanged
});

// ════════════════════════════════════════════════════════════════════
// §8  Tier not permitted → fail-closed
// ════════════════════════════════════════════════════════════════════

test('[§7.3-8a] workspace-write step rejected when plan only permits patch-proposal', () => {
  const { store } = setup();
  const goal = store.createGoal({ sessionId: 's1', description: 'Do X', now });
  store.attachPlan({
    goalId: goal.id,
    steps: [
      { intent: 'Write file', kind: 'write-file', targetEndpointId: 'codex-command', tier: 'workspace-write' },
    ],
    permittedTiers: ['patch-proposal'], // workspace-write NOT included
    now: now + 1,
  });
  store.approvePlan(goal.id, now + 2);

  const orch = new GoalOrchestrator(store);
  const result = orch.advance(goal.id);

  assert.equal(result.type, 'tier-violation');
  assert.equal(result.tier, 'workspace-write');
  assert.deepEqual(result.permitted, ['patch-proposal']);
  assert.ok(result.reason.includes('permittedTiers'), result.reason);

  // Step remains pending — never ran.
  const plan = store.getPlanByGoal(goal.id);
  assert.equal(plan.steps[0].status, 'pending');
});

test('[§7.3-8b] tier-violation on any step in a multi-step plan', () => {
  const { store } = setup();
  const goal = store.createGoal({ sessionId: 's1', description: 'Do X', now });
  store.attachPlan({
    goalId: goal.id,
    steps: [
      { intent: 'Review', kind: 'review', targetEndpointId: 'c1' },
      { intent: 'Write file', kind: 'write-file', targetEndpointId: 'codex-command', tier: 'workspace-write' },
      { intent: 'Summarize', kind: 'summarize', targetEndpointId: 'c1' },
    ],
    permittedTiers: ['patch-proposal'], // only patch-proposal
    now: now + 1,
  });
  store.approvePlan(goal.id, now + 2);

  const orch = new GoalOrchestrator(store);

  // First step (review, patch-proposal) runs fine.
  const r1 = orch.advance(goal.id);
  assert.equal(r1.type, 'step-completed');

  // Second step (write-file, workspace-write) rejected.
  const r2 = orch.advance(goal.id);
  assert.equal(r2.type, 'tier-violation');
  assert.equal(r2.tier, 'workspace-write');
});

test('[§7.3-8c] every mutating kind requires workspace-write tier check', () => {
  const { store } = setup();
  const mutatingKinds = ['apply-patch', 'run-command', 'write-file', 'delete-file', 'git-commit', 'git-push'];

  for (const kind of mutatingKinds) {
    const goal = store.createGoal({ sessionId: `s-${kind}`, description: `Do ${kind}`, now });
    store.attachPlan({
      goalId: goal.id,
      steps: [{ intent: kind, kind, targetEndpointId: 'codex-command', tier: 'workspace-write' }],
      permittedTiers: ['patch-proposal'], // workspace-write NOT included
      now: now + 1,
    });
    store.approvePlan(goal.id, now + 2);

    const orch = new GoalOrchestrator(store);
    const result = orch.advance(goal.id);

    assert.equal(
      result.type, 'tier-violation',
      `kind="${kind}" should be rejected, got type="${result.type}"`,
    );
  }
});

test('[§7.3-8d] tier-violation stops runAll', () => {
  const { store } = setup();
  const goal = store.createGoal({ sessionId: 's1', description: 'Do X', now });
  store.attachPlan({
    goalId: goal.id,
    steps: [
      { intent: 'Review', kind: 'review', targetEndpointId: 'c1' },
      { intent: 'Write file', kind: 'write-file', targetEndpointId: 'codex-command', tier: 'workspace-write' },
      { intent: 'Review again', kind: 'review', targetEndpointId: 'c1' },
    ],
    permittedTiers: ['patch-proposal'],
    now: now + 1,
  });
  store.approvePlan(goal.id, now + 2);

  const orch = new GoalOrchestrator(store);
  const results = orch.runAll(goal.id);

  // review completed, then tier-violation.
  assert.equal(results[0].type, 'step-completed');
  assert.equal(results[1].type, 'tier-violation');
  // No third step attempt.
  assert.ok(results.length === 2);
});

// ════════════════════════════════════════════════════════════════════
// §9  Edge cases
// ════════════════════════════════════════════════════════════════════

test('[§7.3-edge] idempotent advance on completed plan returns plan-completed', () => {
  const { store } = setup();
  const { goalId } = createApprovedPlan(store, [
    { intent: 'Review', kind: 'review', targetEndpointId: 'c1' },
  ]);

  const orch = new GoalOrchestrator(store);
  orch.advance(goalId); // completes plan

  const r2 = orch.advance(goalId);
  assert.equal(r2.type, 'plan-completed');

  const r3 = orch.advance(goalId);
  assert.equal(r3.type, 'plan-completed');
});

test('[§7.3-edge] advance on non-existent goal returns noop', () => {
  const { store } = setup();
  const orch = new GoalOrchestrator(store);
  const result = orch.advance('nonexistent');
  assert.equal(result.type, 'noop');
  assert.ok(result.reason.includes('not-found'), result.reason);
});

test('[§7.3-edge] empty plan after approval → plan-completed', () => {
  const { store } = setup();
  const goal = store.createGoal({ sessionId: 's1', description: 'Empty plan', now });
  store.attachPlan({
    goalId: goal.id,
    steps: [],
    now: now + 1,
  });
  store.approvePlan(goal.id, now + 2);

  const orch = new GoalOrchestrator(store);
  const result = orch.advance(goal.id);
  assert.equal(result.type, 'plan-completed');
});

test('[§7.3-edge] goal stays approved while plan executes, then done on completion', () => {
  const { store } = setup();
  const { goalId } = createApprovedPlan(store, [
    { intent: 'R1', kind: 'review', targetEndpointId: 'c1' },
    { intent: 'R2', kind: 'summarize', targetEndpointId: 'c1' },
  ]);

  assert.equal(store.getGoal(goalId).status, 'approved');
  assert.equal(store.getPlanByGoal(goalId).status, 'approved');

  const orch = new GoalOrchestrator(store);
  orch.advance(goalId); // step 0 completes

  // Goal stays approved; plan transitions to executing.
  assert.equal(store.getGoal(goalId).status, 'approved');
  assert.equal(store.getPlanByGoal(goalId).status, 'executing');

  orch.advance(goalId); // step 1 completes → plan done

  assert.equal(store.getGoal(goalId).status, 'done');
  assert.equal(store.getPlanByGoal(goalId).status, 'done');
});

test('[§7.3-edge] reset stepsRun by creating a new orchestrator instance', () => {
  const { store } = setup();
  const { goalId } = createApprovedPlan(store, [
    { intent: 'R1', kind: 'review', targetEndpointId: 'c1' },
    { intent: 'R2', kind: 'review', targetEndpointId: 'c1' },
  ]);

  const orch1 = new GoalOrchestrator(store, { stepCeiling: 2 });
  orch1.advance(goalId);
  orch1.advance(goalId);
  assert.equal(orch1.stepsAdvanced, 2);

  // New orchestrator starts from 0.
  const orch2 = new GoalOrchestrator(store, { stepCeiling: 2 });
  assert.equal(orch2.stepsAdvanced, 0);
  // But plan is done, so advance returns plan-completed.
  const r = orch2.advance(goalId);
  assert.equal(r.type, 'plan-completed');
});
