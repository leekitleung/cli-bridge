// Goal → Plan generator tests (§7.2, ADR-0003).
//
// Covers:
//   1. Prompt construction (buildGoalPlanPrompt).
//   2. Plan JSON parsing (parseGoalPlanResult):
//      a. Valid Plan from CLI output.
//      b. Bad JSON / unparseable output.
//      c. Workspace-write tier violation → fail-closed (strict mode).
//      d. Workspace-write tier violation → downgrade (downgrade mode).
//      e. Forbidden execution fields rejection.
//      f. Empty / missing output.
//   3. Generator orchestration (generatePlan):
//      a. Valid generation → plan awaiting-approval.
//      b. Goal not draft → rejected.
//      c. Goal not found → rejected.
//      d. CLI failure → fail-closed.
//      e. Status change marking (draft → planned).
//   4. permittedTiers enforcement on generated plans.
//   5. Schema validation edge cases.

import assert from 'node:assert/strict';
import test from 'node:test';

import { buildGoalPlanPrompt } from '../apps/local-server/src/goal/goal-plan-prompt.ts';
import { parseGoalPlanResult } from '../apps/local-server/src/goal/goal-plan-parser.ts';
import { generatePlan } from '../apps/local-server/src/goal/goal-plan-generator.ts';
import { InMemoryAuditLog } from '../apps/local-server/src/storage/audit-log.ts';
import { InMemoryGoalStore } from '../apps/local-server/src/storage/goal-store.ts';
import { validatePlan } from '../packages/shared/src/schemas.ts';

const now = 1790000000000;

// ---- Test fixtures ----

function setup() {
  return {
    store: new InMemoryGoalStore(),
    auditLog: new InMemoryAuditLog(),
  };
}

const fakeLauncherResolver = (command) => ({
  executable: `/fake/${command}`,
  prependArgs: [],
});

function fakeRunner(result) {
  return {
    async run() {
      return typeof result === 'function' ? result() : result;
    },
  };
}

function okRun(stdout) {
  return { exitCode: 0, stdout, stderr: '', timedOut: false };
}

function failRun(reason) {
  return { exitCode: 1, stdout: '', stderr: reason, timedOut: false };
}

/** Minimal command config for test injection. */
function testCommandConfig() {
  return {
    adapterName: 'test-plan-generator',
    command: 'claude',
    argv: ['-p', '--output-format', 'json'],
  };
}

function validPlanJson(overrides = {}) {
  return JSON.stringify({
    id: 'plan-test-1',
    goalId: 'goal-test-1',
    status: 'awaiting-approval',
    permittedTiers: ['patch-proposal'],
    steps: [
      {
        id: 'step-1',
        planId: 'plan-test-1',
        index: 0,
        intent: 'Review the code',
        kind: 'review',
        targetEndpointId: 'claude-code-command',
        tier: 'patch-proposal',
        isStateMutating: false,
        status: 'pending',
      },
      {
        id: 'step-2',
        planId: 'plan-test-1',
        index: 1,
        intent: 'Propose a patch',
        kind: 'propose-patch',
        targetEndpointId: 'codex-command',
        tier: 'patch-proposal',
        isStateMutating: false,
        status: 'pending',
      },
    ],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  });
}

// ════════════════════════════════════════════════════════════════════
// §1  Prompt construction
// ════════════════════════════════════════════════════════════════════

test('buildGoalPlanPrompt includes goal description and context', () => {
  const prompt = buildGoalPlanPrompt({
    goalDescription: 'Add dark mode toggle to settings',
    goalId: 'goal-abc',
    sessionId: 'session-1',
    cwd: '/home/user/project',
    availableEndpoints: ['claude-code-command', 'codex-command'],
  });

  assert.ok(prompt.includes('Add dark mode toggle to settings'));
  assert.ok(prompt.includes('goal-abc'));
  assert.ok(prompt.includes('session-1'));
  assert.ok(prompt.includes('/home/user/project'));
  assert.ok(prompt.includes('claude-code-command'));
  assert.ok(prompt.includes('Caller-permitted tiers: patch-proposal'));
  assert.ok(prompt.includes('You are a Planning Agent'));
  assert.ok(prompt.includes('"awaiting-approval"'));
  assert.ok(prompt.includes('Do not call tools'));
  assert.ok(prompt.includes('CRITICAL tier rules'));
});

test('buildGoalPlanPrompt includes workspace-write scope only when caller permits it', () => {
  const prompt = buildGoalPlanPrompt({
    goalDescription: 'Write a config file',
    goalId: 'goal-ww',
    sessionId: 'session-1',
    permittedTiers: ['patch-proposal', 'workspace-write'],
  });

  assert.ok(prompt.includes('Caller-permitted tiers: patch-proposal, workspace-write'));
  assert.ok(prompt.includes('workspace-write is caller-permitted for this plan'));
});

test('buildGoalPlanPrompt with extra context', () => {
  const prompt = buildGoalPlanPrompt({
    goalDescription: 'Fix login bug',
    goalId: 'goal-1',
    sessionId: 's1',
    extraContext: 'The bug is in auth.ts line 42',
  });

  assert.ok(prompt.includes('auth.ts line 42'));
});

test('buildGoalPlanPrompt with no endpoints falls back to hint', () => {
  const prompt = buildGoalPlanPrompt({
    goalDescription: 'Do X',
    goalId: 'g1',
    sessionId: 's1',
  });

  assert.ok(prompt.includes('review only'));
});

// ════════════════════════════════════════════════════════════════════
// §2  Plan JSON parsing — happy path
// ════════════════════════════════════════════════════════════════════

test('parseGoalPlanResult parses a valid bare Plan JSON', () => {
  const json = validPlanJson();
  const result = parseGoalPlanResult({
    text: json,
    goalId: 'goal-test-1',
    now,
  });

  assert.equal(result.ok, true);
  assert.ok(result.plan);
  assert.equal(result.plan.status, 'awaiting-approval');
  assert.equal(result.plan.goalId, 'goal-test-1');
  assert.equal(result.plan.steps.length, 2);
  assert.deepEqual(result.plan.permittedTiers, ['patch-proposal']);
});

test('parseGoalPlanResult strips markdown fences', () => {
  const json = validPlanJson();
  const fenced = '```json\n' + json + '\n```';
  const result = parseGoalPlanResult({
    text: fenced,
    goalId: 'goal-test-1',
    now,
  });

  assert.equal(result.ok, true);
  assert.equal(result.plan.status, 'awaiting-approval');
});

test('parseGoalPlanResult extracts Plan from mixed output', () => {
  const json = validPlanJson();
  // Agent sometimes adds explanatory text around the JSON.
  const mixed = 'Here is the plan:\n\n' + json + '\n\nHope this looks good!';
  const result = parseGoalPlanResult({
    text: mixed,
    goalId: 'goal-test-1',
    now,
  });

  assert.equal(result.ok, true);
  assert.equal(result.plan.status, 'awaiting-approval');
  assert.equal(result.plan.steps.length, 2);
});

test('parseGoalPlanResult forces status to awaiting-approval', () => {
  // Even if the model outputs 'approved', the parser must force
  // 'awaiting-approval'.
  const json = validPlanJson({ status: 'approved' });
  const result = parseGoalPlanResult({
    text: json,
    goalId: 'goal-test-1',
    now,
  });

  assert.equal(result.ok, true);
  assert.equal(result.plan.status, 'awaiting-approval');
});

test('parseGoalPlanResult forces step statuses to pending', () => {
  const json = validPlanJson({
    steps: [{
      id: 'step-1', planId: 'plan-test-1', index: 0,
      intent: 'x', kind: 'review', targetEndpointId: 'ep', tier: 'patch-proposal',
      isStateMutating: false, status: 'running', // model tried to set running
    }],
  });
  const result = parseGoalPlanResult({
    text: json,
    goalId: 'goal-test-1',
    now,
  });

  assert.equal(result.ok, true);
  assert.equal(result.plan.steps[0].status, 'pending');
});

test('parseGoalPlanResult ensures patch-proposal in permittedTiers', () => {
  // Model output does not grant scope; caller scope defaults to patch-proposal.
  const json = validPlanJson({ permittedTiers: ['workspace-write'] });
  const result = parseGoalPlanResult({
    text: json,
    goalId: 'goal-test-1',
    now,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.plan.permittedTiers, ['patch-proposal']);
});

test('parseGoalPlanResult fails on goalId mismatch', () => {
  const json = validPlanJson({ goalId: 'wrong-goal' });
  const result = parseGoalPlanResult({
    text: json,
    goalId: 'goal-test-1',
    now,
  });

  assert.equal(result.ok, false);
  assert.equal(result.failureReason, 'plan-goal-id-mismatch');
});

// ════════════════════════════════════════════════════════════════════
// §3  Plan JSON parsing — error cases
// ════════════════════════════════════════════════════════════════════

test('parseGoalPlanResult fails on empty text', () => {
  const result = parseGoalPlanResult({
    text: '',
    goalId: 'g1',
    now,
  });

  assert.equal(result.ok, false);
  assert.equal(result.failureReason, 'plan-json-not-found');
});

test('parseGoalPlanResult fails on unparseable JSON', () => {
  const result = parseGoalPlanResult({
    text: 'not valid json at all {{{',
    goalId: 'g1',
    now,
  });

  assert.equal(result.ok, false);
  assert.equal(result.failureReason, 'plan-json-not-found');
});

test('parseGoalPlanResult fails on JSON that is not a Plan', () => {
  const result = parseGoalPlanResult({
    text: '{"foo": "bar"}',
    goalId: 'g1',
    now,
  });

  assert.equal(result.ok, false);
  assert.equal(result.failureReason, 'plan-json-not-found');
});

test('parseGoalPlanResult fails on missing required fields', () => {
  // Missing 'goalId' field — cannot be extracted by the parser.
  const result = parseGoalPlanResult({
    text: '{"id":"p1","status":"awaiting-approval","permittedTiers":["patch-proposal"],"steps":[],"createdAt":1,"updatedAt":1}',
    goalId: 'g1',
    now,
  });

  assert.equal(result.ok, false);
  assert.equal(result.failureReason, 'plan-json-not-found');
});

test('parseGoalPlanResult fails on invalid step kind', () => {
  const json = validPlanJson({
    steps: [{
      id: 's1', planId: 'plan-test-1', index: 0,
      intent: 'x', kind: 'evil-hack', targetEndpointId: 'ep',
      tier: 'patch-proposal', isStateMutating: false, status: 'pending',
    }],
  });
  const result = parseGoalPlanResult({
    text: json,
    goalId: 'goal-test-1',
    now,
  });

  assert.equal(result.ok, false);
  assert.ok(result.failureReason.includes('plan-schema-invalid'));
});

test('parseGoalPlanResult fails on invalid tier value', () => {
  const json = validPlanJson({
    steps: [{
      id: 's1', planId: 'plan-test-1', index: 0,
      intent: 'x', kind: 'review', targetEndpointId: 'ep',
      tier: 'full-access', isStateMutating: false, status: 'pending',
    }],
  });
  const result = parseGoalPlanResult({
    text: json,
    goalId: 'goal-test-1',
    now,
  });

  assert.equal(result.ok, false);
});

// ════════════════════════════════════════════════════════════════════
// §4  Workspace-write tier enforcement
// ════════════════════════════════════════════════════════════════════

test('parseGoalPlanResult fail-closed on workspace-write step without permittedTiers (strict)', () => {
  // Plan only permits patch-proposal, but step uses workspace-write.
  const json = validPlanJson({
    permittedTiers: ['patch-proposal'],
    steps: [{
      id: 's1', planId: 'plan-test-1', index: 0,
      intent: 'Write config file',
      kind: 'write-file',
      targetEndpointId: 'codex-command',
      tier: 'workspace-write',
      isStateMutating: true,
      status: 'pending',
    }],
  });

  const result = parseGoalPlanResult(
    { text: json, goalId: 'goal-test-1', now },
    { tierEnforcement: 'strict' },
  );

  assert.equal(result.ok, false);
  assert.ok(result.failureReason.includes('plan-tier-violation'));
  assert.ok(result.failureReason.includes('workspace-write'));
});

test('parseGoalPlanResult downgrade mode swaps non-mutating workspace-write to patch-proposal', () => {
  const json = validPlanJson({
    permittedTiers: ['patch-proposal'],
    steps: [{
      id: 's1', planId: 'plan-test-1', index: 0,
      intent: 'Review config file',
      kind: 'review',
      targetEndpointId: 'claude-code-command',
      tier: 'workspace-write',
      isStateMutating: false,
      status: 'pending',
    }],
  });

  const result = parseGoalPlanResult(
    { text: json, goalId: 'goal-test-1', now },
    { tierEnforcement: 'downgrade' },
  );

  assert.equal(result.ok, true);
  assert.ok(result.plan);
  assert.equal(result.plan.steps[0].tier, 'patch-proposal');
  assert.equal(result.plan.steps[0].isStateMutating, false);
  assert.ok(result.downgrades);
  assert.equal(result.downgrades.length, 1);
  assert.equal(result.downgrades[0].stepIndex, 0);
  assert.equal(result.downgrades[0].originalTier, 'workspace-write');
  assert.equal(result.downgrades[0].downgradedTo, 'patch-proposal');
});

test('parseGoalPlanResult rejects model self-enabled workspace-write scope', () => {
  const json = validPlanJson({
    permittedTiers: ['patch-proposal', 'workspace-write'],
    steps: [{
      id: 's1', planId: 'plan-test-1', index: 0,
      intent: 'Write config file',
      kind: 'write-file',
      targetEndpointId: 'codex-command',
      tier: 'workspace-write',
      isStateMutating: true,
      status: 'pending',
    }],
  });

  const result = parseGoalPlanResult(
    { text: json, goalId: 'goal-test-1', now },
    { tierEnforcement: 'strict' },
  );

  assert.equal(result.ok, false);
  assert.ok(result.failureReason.includes('plan-tier-violation'));
});

test('parseGoalPlanResult allows workspace-write when caller explicitly permits it', () => {
  const json = validPlanJson({
    permittedTiers: ['patch-proposal', 'workspace-write'],
    steps: [{
      id: 's1',
      planId: 'plan-test-1',
      index: 0,
      intent: 'Write config file',
      kind: 'write-file',
      targetEndpointId: 'codex-command',
      tier: 'workspace-write',
      isStateMutating: true,
      status: 'pending',
    }],
  });

  const result = parseGoalPlanResult(
    {
      text: json,
      goalId: 'goal-test-1',
      permittedTiers: ['patch-proposal', 'workspace-write'],
      now,
    },
    { tierEnforcement: 'strict' },
  );

  assert.equal(result.ok, true);
  assert.equal(result.plan.steps[0].tier, 'workspace-write');
  assert.ok(result.plan.permittedTiers.includes('workspace-write'));
});

// ════════════════════════════════════════════════════════════════════
// §5  Forbidden execution fields
// ════════════════════════════════════════════════════════════════════

test('parseGoalPlanResult rejects plan with executable field', () => {
  const json = validPlanJson({ executable: true });
  const result = parseGoalPlanResult({
    text: json,
    goalId: 'goal-test-1',
    now,
  });

  assert.equal(result.ok, false);
  assert.ok(result.failureReason.includes('forbidden-field'));
  assert.ok(result.failureReason.includes('executable'));
});

test('parseGoalPlanResult rejects plan with canExecute field', () => {
  const json = validPlanJson({ canExecute: true });
  const result = parseGoalPlanResult({
    text: json,
    goalId: 'goal-test-1',
    now,
  });

  assert.equal(result.ok, false);
  assert.ok(result.failureReason.includes('canExecute'));
});

test('parseGoalPlanResult rejects plan with autoSend field', () => {
  const json = validPlanJson({ autoSend: true });
  const result = parseGoalPlanResult({
    text: json,
    goalId: 'goal-test-1',
    now,
  });

  assert.equal(result.ok, false);
  assert.ok(result.failureReason.includes('autoSend'));
});

test('parseGoalPlanResult rejects plan with autoApprove field', () => {
  const json = validPlanJson({ autoApprove: true });
  const result = parseGoalPlanResult({
    text: json,
    goalId: 'goal-test-1',
    now,
  });

  assert.equal(result.ok, false);
});

// ════════════════════════════════════════════════════════════════════
// §6  generatePlan — integration with store
// ════════════════════════════════════════════════════════════════════

test('generatePlan creates plan in awaiting-approval from draft goal', async () => {
  const { store, auditLog } = setup();
  const goal = store.createGoal({
    sessionId: 'session-1',
    description: 'Add dark mode support',
    now,
  });

  const planJson = validPlanJson({
    id: 'plan-auto-1',
    goalId: goal.id,
  });

  const result = await generatePlan(store, auditLog, {
    goalId: goal.id,
    commandConfig: testCommandConfig(),
    cwd: '/test',
    now: now + 1,
    commandOptions: {
      runner: fakeRunner(okRun(planJson)),
      launcherResolver: fakeLauncherResolver,
    },
  });

  assert.equal(result.ok, true);
  assert.ok(result.plan);
  assert.equal(result.plan.status, 'awaiting-approval');
  assert.equal(result.plan.steps.length, 2);
  assert.deepEqual(result.plan.permittedTiers, ['patch-proposal']);

  // Goal moved to 'planned'.
  const updatedGoal = store.getGoal(goal.id);
  assert.equal(updatedGoal.status, 'planned');

  // Plan is attached and retrievable.
  const storedPlan = store.getPlanByGoal(goal.id);
  assert.ok(storedPlan);
  assert.equal(storedPlan.status, 'awaiting-approval');
  assert.equal(storedPlan.steps.length, 2);
});

test('generatePlan refuses non-draft goal', async () => {
  const { store, auditLog } = setup();
  const goal = store.createGoal({
    sessionId: 'session-1',
    description: 'X',
    now,
  });
  // Move goal past draft.
  store.attachPlan({
    goalId: goal.id,
    steps: [{ intent: 'review', kind: 'review', targetEndpointId: 'ep' }],
    now: now + 1,
  });
  // Goal is now 'planned'.

  const result = await generatePlan(store, auditLog, {
    goalId: goal.id,
    commandConfig: testCommandConfig(),
    now: now + 2,
    commandOptions: {
      runner: fakeRunner(okRun(validPlanJson({ id: 'p2', goalId: goal.id }))),
      launcherResolver: fakeLauncherResolver,
    },
  });

  assert.equal(result.ok, false);
  assert.ok(result.failureReason.includes('goal-not-draft'));
});

test('generatePlan refuses non-existent goal', async () => {
  const { store, auditLog } = setup();

  const result = await generatePlan(store, auditLog, {
    goalId: 'nonexistent',
    commandConfig: testCommandConfig(),
    now,
    commandOptions: {
      runner: fakeRunner(okRun('{}')),
      launcherResolver: fakeLauncherResolver,
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.failureReason, 'goal-not-found');
});

test('generatePlan fail-closed on CLI failure', async () => {
  const { store, auditLog } = setup();
  const goal = store.createGoal({
    sessionId: 'session-1',
    description: 'X',
    now,
  });

  const result = await generatePlan(store, auditLog, {
    goalId: goal.id,
    commandConfig: testCommandConfig(),
    now: now + 1,
    commandOptions: {
      runner: fakeRunner(failRun('something broke')),
      launcherResolver: fakeLauncherResolver,
    },
  });

  assert.equal(result.ok, false);
  // Goal should still be 'draft' since no plan was attached.
  assert.equal(store.getGoal(goal.id).status, 'draft');
});

test('generatePlan fail-closed on empty CLI output', async () => {
  const { store, auditLog } = setup();
  const goal = store.createGoal({
    sessionId: 'session-1',
    description: 'X',
    now,
  });

  const result = await generatePlan(store, auditLog, {
    goalId: goal.id,
    commandConfig: testCommandConfig(),
    now: now + 1,
    commandOptions: {
      runner: fakeRunner(okRun('')),
      launcherResolver: fakeLauncherResolver,
    },
  });

  assert.equal(result.ok, false);
  assert.ok(result.failureReason.includes('plan-output-empty'));
});

test('generatePlan fail-closed on workspace-write violation in strict mode', async () => {
  const { store, auditLog } = setup();
  const goal = store.createGoal({
    sessionId: 'session-1',
    description: 'Add git push step',
    now,
  });

  // Plan has workspace-write step but only patch-proposal in permittedTiers.
  const badPlanJson = validPlanJson({
    id: 'bad-plan',
    goalId: goal.id,
    permittedTiers: ['patch-proposal'],
    steps: [{
      id: 's1', planId: 'bad-plan', index: 0,
      intent: 'Push to git',
      kind: 'git-push',
      targetEndpointId: 'codex-command',
      tier: 'workspace-write',
      isStateMutating: true,
      status: 'pending',
    }],
  });

  const result = await generatePlan(store, auditLog, {
    goalId: goal.id,
    commandConfig: testCommandConfig(),
    now: now + 1,
    tierEnforcement: 'strict',
    commandOptions: {
      runner: fakeRunner(okRun(badPlanJson)),
      launcherResolver: fakeLauncherResolver,
    },
  });

  assert.equal(result.ok, false);
  assert.ok(result.failureReason.includes('plan-tier-violation'));
});

test('generatePlan downgrades non-mutating workspace-write steps in downgrade mode', async () => {
  const { store, auditLog } = setup();
  const goal = store.createGoal({
    sessionId: 'session-1',
    description: 'Review a config file',
    now,
  });

  const badPlanJson = validPlanJson({
    id: 'downgrade-plan',
    goalId: goal.id,
    permittedTiers: ['patch-proposal'],
    steps: [{
      id: 's1', planId: 'downgrade-plan', index: 0,
      intent: 'Review the config',
      kind: 'review',
      targetEndpointId: 'claude-code-command',
      tier: 'workspace-write',
      isStateMutating: false,
      status: 'pending',
    }],
  });

  const result = await generatePlan(store, auditLog, {
    goalId: goal.id,
    commandConfig: testCommandConfig(),
    now: now + 1,
    tierEnforcement: 'downgrade',
    commandOptions: {
      runner: fakeRunner(okRun(badPlanJson)),
      launcherResolver: fakeLauncherResolver,
    },
  });

  assert.equal(result.ok, true);
  assert.ok(result.plan);
  assert.equal(result.plan.steps[0].tier, 'patch-proposal');
  assert.equal(result.plan.steps[0].isStateMutating, false);
  assert.ok(result.downgrades);
  assert.equal(result.downgrades.length, 1);
});

test('generatePlan allows workspace-write only when caller scope permits it', async () => {
  const { store, auditLog } = setup();
  const goal = store.createGoal({
    sessionId: 'session-1',
    description: 'Generate a workspace-write plan',
    now,
  });

  const planJson = validPlanJson({
    id: 'workspace-write-plan',
    goalId: goal.id,
    permittedTiers: ['patch-proposal', 'workspace-write'],
    steps: [{
      id: 's1',
      planId: 'workspace-write-plan',
      index: 0,
      intent: 'Write config file',
      kind: 'write-file',
      targetEndpointId: 'codex-command',
      tier: 'workspace-write',
      isStateMutating: true,
      status: 'pending',
    }],
  });

  const result = await generatePlan(store, auditLog, {
    goalId: goal.id,
    commandConfig: testCommandConfig(),
    permittedTiers: ['patch-proposal', 'workspace-write'],
    now: now + 1,
    commandOptions: {
      runner: fakeRunner(okRun(planJson)),
      launcherResolver: fakeLauncherResolver,
    },
  });

  assert.equal(result.ok, true);
  assert.ok(result.plan);
  assert.deepEqual(result.plan.permittedTiers, ['patch-proposal', 'workspace-write']);
  assert.equal(result.plan.steps[0].tier, 'workspace-write');
});

test('generatePlan returns meta on success', async () => {
  const { store, auditLog } = setup();
  const goal = store.createGoal({
    sessionId: 'session-1',
    description: 'X',
    now,
  });

  const result = await generatePlan(store, auditLog, {
    goalId: goal.id,
    commandConfig: testCommandConfig(),
    now: now + 1,
    commandOptions: {
      runner: fakeRunner(okRun(validPlanJson({ id: 'meta-plan', goalId: goal.id }))),
      launcherResolver: fakeLauncherResolver,
    },
  });

  assert.equal(result.ok, true);
  assert.ok(result.meta);
  assert.equal(result.meta.adapterName, 'test-plan-generator');
  assert.equal(result.meta.exitCode, 0);
  assert.equal(result.meta.timedOut, false);
});

test('generatePlan creates audit events', async () => {
  const { store, auditLog } = setup();
  const goal = store.createGoal({
    sessionId: 'session-1',
    description: 'X',
    now,
  });

  await generatePlan(store, auditLog, {
    goalId: goal.id,
    commandConfig: testCommandConfig(),
    now: now + 1,
    commandOptions: {
      runner: fakeRunner(okRun(validPlanJson({ id: 'audit-plan', goalId: goal.id }))),
      launcherResolver: fakeLauncherResolver,
    },
  });

  const events = auditLog.listEvents();
  const sendEvents = events.filter((e) => e.type === 'send_review');
  assert.ok(sendEvents.length >= 1);
  assert.equal(sendEvents[0].source, 'goal-plan-generator');
  assert.equal(sendEvents[0].result.ok, true);
});

// ════════════════════════════════════════════════════════════════════
// §7  Schema validation edge cases
// ════════════════════════════════════════════════════════════════════

test('validatePlan allows workspace-write tier with steps', () => {
  const plan = {
    id: 'p1',
    goalId: 'g1',
    status: 'awaiting-approval',
    permittedTiers: ['patch-proposal', 'workspace-write'],
    steps: [{
      id: 's1', planId: 'p1', index: 0,
      intent: 'Write file',
      kind: 'write-file',
      targetEndpointId: 'ep',
      tier: 'workspace-write',
      isStateMutating: true,
      status: 'pending',
    }],
    createdAt: now,
    updatedAt: now,
  };

  const result = validatePlan(plan);
  assert.equal(result.ok, true);
});

test('validatePlan allows empty steps array', () => {
  const plan = {
    id: 'p1',
    goalId: 'g1',
    status: 'awaiting-approval',
    permittedTiers: ['patch-proposal'],
    steps: [],
    createdAt: now,
    updatedAt: now,
  };

  // Empty steps is actually allowed at the schema level — it's a valid edge case
  // for a plan with no steps yet.
  const result = validatePlan(plan);
  assert.equal(result.ok, true);
});

test('validatePlan rejects plan without permittedTiers', () => {
  const plan = {
    id: 'p1',
    goalId: 'g1',
    status: 'awaiting-approval',
    steps: [],
    createdAt: now,
    updatedAt: now,
  };

  const result = validatePlan(plan);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('permittedTiers')));
});

// ════════════════════════════════════════════════════════════════════
// §8  kind / tier consistency invariant (§7.2 P1 security fix)
//
// A step's kind is the canonical authority on whether it is state-mutating.
// The tier must agree. These tests cover the four cross-product cases:
//
//   Case 1  mutating kind + patch-proposal tier    → violation (Rule A)
//   Case 2  non-mutating kind + workspace-write    → violation (Rule B)
//   Case 3  mutating kind + workspace-write + caller-permitted → OK
//   Case 4  downgrade mode corrects both Rule-A and Rule-B mismatches
// ════════════════════════════════════════════════════════════════════

test('[§8 Case 1] write-file + patch-proposal tier fails in strict mode (Rule A)', () => {
  // Model outputs mutating kind with wrong (too-low) tier.
  const json = validPlanJson({
    permittedTiers: ['patch-proposal', 'workspace-write'],
    steps: [{
      id: 's1',
      planId: 'plan-test-1',
      index: 0,
      intent: 'Write the config',
      kind: 'write-file',
      targetEndpointId: 'codex-command',
      tier: 'patch-proposal',      // ← wrong: mutating kind needs workspace-write
      isStateMutating: true,
      status: 'pending',
    }],
  });

  const result = parseGoalPlanResult(
    {
      text: json,
      goalId: 'goal-test-1',
      permittedTiers: ['patch-proposal', 'workspace-write'],
      now,
    },
    { tierEnforcement: 'strict' },
  );

  assert.equal(result.ok, false, 'should be rejected');
  assert.ok(
    result.failureReason.includes('plan-kind-tier-mismatch'),
    `expected plan-kind-tier-mismatch, got: ${result.failureReason}`,
  );
  assert.ok(result.failureReason.includes('write-file'));
});

test('[§8 Case 1 variants] all mutating kinds with patch-proposal tier fail in strict mode (Rule A)', () => {
  const mutatingKinds = ['apply-patch', 'run-command', 'write-file', 'delete-file', 'git-commit', 'git-push'];

  for (const kind of mutatingKinds) {
    const json = validPlanJson({
      permittedTiers: ['patch-proposal', 'workspace-write'],
      steps: [{
        id: 's1',
        planId: 'plan-test-1',
        index: 0,
        intent: `Do ${kind}`,
        kind,
        targetEndpointId: 'ep',
        tier: 'patch-proposal',  // ← wrong tier for mutating kind
        isStateMutating: true,
        status: 'pending',
      }],
    });

    const result = parseGoalPlanResult(
      {
        text: json,
        goalId: 'goal-test-1',
        permittedTiers: ['patch-proposal', 'workspace-write'],
        now,
      },
      { tierEnforcement: 'strict' },
    );

    assert.equal(result.ok, false, `kind="${kind}" should be rejected`);
    assert.ok(
      result.failureReason.includes('plan-kind-tier-mismatch'),
      `kind="${kind}": expected plan-kind-tier-mismatch, got: ${result.failureReason}`,
    );
  }
});

test('[§8 Case 2] review + workspace-write tier fails in strict mode (Rule B)', () => {
  // Model outputs non-mutating kind with elevated tier — potentially dangerous.
  const json = validPlanJson({
    permittedTiers: ['patch-proposal', 'workspace-write'],
    steps: [{
      id: 's1',
      planId: 'plan-test-1',
      index: 0,
      intent: 'Review the diff',
      kind: 'review',              // ← non-mutating
      targetEndpointId: 'claude-command',
      tier: 'workspace-write',     // ← wrong: non-mutating kind must not be workspace-write
      isStateMutating: false,
      status: 'pending',
    }],
  });

  const result = parseGoalPlanResult(
    {
      text: json,
      goalId: 'goal-test-1',
      permittedTiers: ['patch-proposal', 'workspace-write'],
      now,
    },
    { tierEnforcement: 'strict' },
  );

  assert.equal(result.ok, false, 'should be rejected');
  assert.ok(
    result.failureReason.includes('plan-kind-tier-mismatch'),
    `expected plan-kind-tier-mismatch, got: ${result.failureReason}`,
  );
  assert.ok(result.failureReason.includes('review'));
});

test('[§8 Case 2 variants] all non-mutating kinds with workspace-write tier fail in strict mode (Rule B)', () => {
  const nonMutatingKinds = ['review', 'summarize', 'propose-patch'];

  for (const kind of nonMutatingKinds) {
    const json = validPlanJson({
      permittedTiers: ['patch-proposal', 'workspace-write'],
      steps: [{
        id: 's1',
        planId: 'plan-test-1',
        index: 0,
        intent: `Do ${kind}`,
        kind,
        targetEndpointId: 'ep',
        tier: 'workspace-write',  // ← wrong tier for non-mutating kind
        isStateMutating: false,
        status: 'pending',
      }],
    });

    const result = parseGoalPlanResult(
      {
        text: json,
        goalId: 'goal-test-1',
        permittedTiers: ['patch-proposal', 'workspace-write'],
        now,
      },
      { tierEnforcement: 'strict' },
    );

    assert.equal(result.ok, false, `kind="${kind}" should be rejected`);
    assert.ok(
      result.failureReason.includes('plan-kind-tier-mismatch'),
      `kind="${kind}": expected plan-kind-tier-mismatch, got: ${result.failureReason}`,
    );
  }
});

test('[§8 Case 3] mutating kind + workspace-write + caller-permitted → accepted', () => {
  // The happy path: model correctly classifies a mutating step, caller allows it.
  const json = validPlanJson({
    permittedTiers: ['patch-proposal', 'workspace-write'],
    steps: [{
      id: 's1',
      planId: 'plan-test-1',
      index: 0,
      intent: 'Apply the patch',
      kind: 'apply-patch',
      targetEndpointId: 'codex-command',
      tier: 'workspace-write',    // ← correct for mutating kind
      isStateMutating: true,
      status: 'pending',
    }],
  });

  const result = parseGoalPlanResult(
    {
      text: json,
      goalId: 'goal-test-1',
      permittedTiers: ['patch-proposal', 'workspace-write'],
      now,
    },
    { tierEnforcement: 'strict' },
  );

  assert.equal(result.ok, true, `should be accepted; reason: ${result.failureReason}`);
  assert.equal(result.plan.steps[0].tier, 'workspace-write');
  assert.equal(result.plan.steps[0].isStateMutating, true);
  assert.equal(result.downgrades, undefined);
});

test('[§8 Case 4a] downgrade mode: write-file+patch-proposal still fails when caller lacks workspace-write (Rule A → C)', () => {
  // Rule A fires: mutating kind had wrong tier, corrected to workspace-write.
  // Rule C then fires: caller doesn't permit workspace-write. Even in downgrade
  // mode, this must fail closed because mutating kinds cannot become patch-proposal.
  const json = validPlanJson({
    permittedTiers: ['patch-proposal'],  // caller does NOT permit workspace-write
    steps: [{
      id: 's1',
      planId: 'plan-test-1',
      index: 0,
      intent: 'Write the config',
      kind: 'write-file',
      targetEndpointId: 'codex-command',
      tier: 'patch-proposal',    // ← wrong: mutating kind
      isStateMutating: true,
      status: 'pending',
    }],
  });

  const result = parseGoalPlanResult(
    { text: json, goalId: 'goal-test-1', now },
    { tierEnforcement: 'downgrade' },
  );

  assert.equal(result.ok, false, 'mutating step without workspace-write permission should fail closed');
  assert.ok(
    result.failureReason.includes('plan-tier-violation'),
    `expected plan-tier-violation, got: ${result.failureReason}`,
  );
  assert.ok(
    result.failureReason.includes('cannot be downgraded'),
    `expected no-downgrade explanation, got: ${result.failureReason}`,
  );
});

test('[§8 Case 4b] downgrade mode: review+workspace-write → corrected to patch-proposal (Rule B)', () => {
  // Rule B fires: non-mutating kind had elevated tier, corrected downward.
  const json = validPlanJson({
    permittedTiers: ['patch-proposal', 'workspace-write'],
    steps: [{
      id: 's1',
      planId: 'plan-test-1',
      index: 0,
      intent: 'Review the output',
      kind: 'review',
      targetEndpointId: 'claude-command',
      tier: 'workspace-write',   // ← wrong: non-mutating
      isStateMutating: false,
      status: 'pending',
    }],
  });

  const result = parseGoalPlanResult(
    {
      text: json,
      goalId: 'goal-test-1',
      permittedTiers: ['patch-proposal', 'workspace-write'],
      now,
    },
    { tierEnforcement: 'downgrade' },
  );

  assert.equal(result.ok, true, `should succeed in downgrade mode; reason: ${result.failureReason}`);
  assert.equal(result.plan.steps[0].tier, 'patch-proposal');
  assert.equal(result.plan.steps[0].isStateMutating, false);
  assert.ok(result.downgrades && result.downgrades.length === 1,
    `expected exactly 1 downgrade record, got ${result.downgrades?.length}`);
  assert.ok(
    result.downgrades[0].reason.includes('non-mutating'),
    `expected Rule-B reason; got: ${result.downgrades[0].reason}`,
  );
});

test('[§8] mixed steps: one coherent, one mismatch — strict mode fails on the bad step', () => {
  const json = validPlanJson({
    permittedTiers: ['patch-proposal', 'workspace-write'],
    steps: [
      {
        id: 's1',
        planId: 'plan-test-1',
        index: 0,
        intent: 'Review the diff (ok)',
        kind: 'review',
        targetEndpointId: 'claude-command',
        tier: 'patch-proposal',   // ← correct
        isStateMutating: false,
        status: 'pending',
      },
      {
        id: 's2',
        planId: 'plan-test-1',
        index: 1,
        intent: 'Write the file (bad tier)',
        kind: 'write-file',
        targetEndpointId: 'codex-command',
        tier: 'patch-proposal',   // ← wrong: mutating kind
        isStateMutating: true,
        status: 'pending',
      },
    ],
  });

  const result = parseGoalPlanResult(
    {
      text: json,
      goalId: 'goal-test-1',
      permittedTiers: ['patch-proposal', 'workspace-write'],
      now,
    },
    { tierEnforcement: 'strict' },
  );

  assert.equal(result.ok, false);
  assert.ok(result.failureReason.includes('plan-kind-tier-mismatch'));
  assert.ok(result.failureReason.includes('write-file'));
});
