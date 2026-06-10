// Project store tests (Phase B, Task 13).
//
// Covers:
//   1. Default "cli-bridge" project always exists.
//   2. upsert creates/updates projects.
//   3. get / list returns stored projects.
//   4. buildSummary / buildAllSummaries with backfill for records without projectId.
//   5. resolveProjectKey: explicit values use that key; empty/undefined → "cli-bridge".
//   6. Project summaries correctly derive active/idle/unknown status.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_PROJECT_KEY,
} from '../packages/shared/src/types.ts';
import {
  InMemoryProjectStore,
  resolveProjectKey,
  validateProjectKey,
} from '../apps/local-server/src/storage/project-store.ts';

const now = 1793000000000;

// ════════════════════════════════════════════════════════════════════
// §1  Default project
// ════════════════════════════════════════════════════════════════════

test('default "cli-bridge" project exists on creation', () => {
  const store = new InMemoryProjectStore();

  const project = store.get(DEFAULT_PROJECT_KEY);
  assert.ok(project);
  assert.equal(project.key, 'cli-bridge');
  assert.equal(project.label, 'CLI Bridge');
});

test('list returns at least the default project', () => {
  const store = new InMemoryProjectStore();

  const projects = store.list();
  assert.ok(projects.length >= 1);
  assert.ok(projects.some((p) => p.key === DEFAULT_PROJECT_KEY));
});

// ════════════════════════════════════════════════════════════════════
// §2  upsert / get / list
// ════════════════════════════════════════════════════════════════════

test('upsert creates a new project', () => {
  const store = new InMemoryProjectStore();

  const project = store.upsert({
    key: 'my-project',
    label: 'My Project',
    description: 'A custom workspace',
    now,
  });

  assert.equal(project.key, 'my-project');
  assert.equal(project.label, 'My Project');
  assert.equal(project.description, 'A custom workspace');
  assert.equal(project.createdAt, now);
});

test('upsert updates label/description of existing project without changing createdAt', () => {
  const store = new InMemoryProjectStore();

  store.upsert({ key: 'my-project', label: 'V1', now });
  const updated = store.upsert({ key: 'my-project', label: 'V2' });

  assert.equal(updated.label, 'V2');
  assert.equal(updated.createdAt, now); // preserved
});

test('get returns undefined for unknown key', () => {
  const store = new InMemoryProjectStore();
  assert.equal(store.get('no-such-project'), undefined);
});

test('list returns all created projects', () => {
  const store = new InMemoryProjectStore();
  store.upsert({ key: 'p1', label: 'P1', now });
  store.upsert({ key: 'p2', label: 'P2', now });

  const projects = store.list();
  assert.ok(projects.length >= 3); // cli-bridge + p1 + p2
  assert.ok(projects.some((p) => p.key === 'p1'));
  assert.ok(projects.some((p) => p.key === 'p2'));
});

// ════════════════════════════════════════════════════════════════════
// §3  resolveProjectKey
// ════════════════════════════════════════════════════════════════════

test('resolveProjectKey returns explicit value as-is', () => {
  assert.equal(resolveProjectKey('my-proj'), 'my-proj');
  assert.equal(resolveProjectKey('  spaced  '), 'spaced');
});

test('resolveProjectKey returns default for empty/undefined/null', () => {
  assert.equal(resolveProjectKey(undefined), DEFAULT_PROJECT_KEY);
  assert.equal(resolveProjectKey(''), DEFAULT_PROJECT_KEY);
  assert.equal(resolveProjectKey('   '), DEFAULT_PROJECT_KEY);
});

// ════════════════════════════════════════════════════════════════════
// §4  buildSummary — single project
// ════════════════════════════════════════════════════════════════════

test('buildSummary returns undefined for unknown project key', () => {
  const store = new InMemoryProjectStore();
  const summary = store.buildSummary('no-such-project', {});
  assert.equal(summary, undefined);
});

test('buildSummary returns counts of zero for an empty project', () => {
  const store = new InMemoryProjectStore();
  store.upsert({ key: 'empty-proj', label: 'Empty', now });

  const summary = store.buildSummary('empty-proj', {});
  assert.ok(summary);
  assert.equal(summary.goalCount, 0);
  assert.equal(summary.reviewCount, 0);
  assert.equal(summary.promptCount, 0);
  assert.equal(summary.status, 'unknown');
});

test('buildSummary counts records scoped to a project', () => {
  const store = new InMemoryProjectStore();
  store.upsert({ key: 'scope1', label: 'Scope 1', now });

  const summary = store.buildSummary('scope1', {
    goals: [
      { projectId: 'scope1', status: 'draft' },
      { projectId: 'scope1', status: 'done' },
      { projectId: 'other', status: 'draft' }, // not scoped here
    ],
    reviews: [
      { projectId: 'scope1' },
      { projectId: 'scope1' },
    ],
    prompts: [
      { projectId: 'scope1' },
    ],
  });

  assert.equal(summary.goalCount, 2);
  assert.equal(summary.activeGoalCount, 1); // one draft, one done
  assert.equal(summary.reviewCount, 2);
  assert.equal(summary.promptCount, 1);
  assert.equal(summary.status, 'active');
});

test('buildSummary backfills records without projectId to default project', () => {
  const store = new InMemoryProjectStore();

  const summary = store.buildSummary(DEFAULT_PROJECT_KEY, {
    goals: [
      { projectId: undefined, status: 'planned' },
      { projectId: 'custom', status: 'approved' },
    ],
    reviews: [
      { projectId: undefined },
    ],
    prompts: [
      { projectId: undefined },
    ],
  });

  assert.equal(summary.goalCount, 1); // only the un-scoped one
  assert.equal(summary.reviewCount, 1);
  assert.equal(summary.promptCount, 1);
  assert.equal(summary.status, 'active');
});

test('buildSummary returns idle when all goals are done/cancelled/failed', () => {
  const store = new InMemoryProjectStore();
  store.upsert({ key: 'done-proj', label: 'Done Proj', now });

  const summary = store.buildSummary('done-proj', {
    goals: [
      { projectId: 'done-proj', status: 'done' },
      { projectId: 'done-proj', status: 'cancelled' },
      { projectId: 'done-proj', status: 'failed' },
    ],
    reviews: [{ projectId: 'done-proj' }],
    prompts: [],
  });

  assert.equal(summary.goalCount, 3);
  assert.equal(summary.activeGoalCount, 0);
  assert.equal(summary.status, 'idle');
});

// ════════════════════════════════════════════════════════════════════
// §5  buildAllSummaries — multi-project aggregation
// ════════════════════════════════════════════════════════════════════

test('buildAllSummaries returns all known projects plus implicit ones from records', () => {
  const store = new InMemoryProjectStore();
  store.upsert({ key: 'explicit', label: 'Explicit', now });

  const summaries = store.buildAllSummaries({
    goals: [
      { projectId: 'explicit', status: 'executing' },
      { projectId: 'implicit', status: 'draft' },
      { projectId: undefined, status: 'approved' },
    ],
    reviews: [
      { projectId: 'implicit' },
    ],
    prompts: [
      { projectId: undefined },
    ],
  });

  // Should include: cli-bridge (default), explicit, implicit
  assert.ok(summaries.length >= 3);
  assert.ok(summaries.every((s) => typeof s.project.key === 'string'));

  const cliBridge = summaries.find((s) => s.project.key === DEFAULT_PROJECT_KEY);
  assert.ok(cliBridge);
  assert.equal(cliBridge.goalCount, 1); // the un-scoped goal
  assert.equal(cliBridge.promptCount, 1);

  const implicit = summaries.find((s) => s.project.key === 'implicit');
  assert.ok(implicit);
  assert.equal(implicit.goalCount, 1);
  assert.equal(implicit.reviewCount, 1);
});

test('buildAllSummaries sorts by project key', () => {
  const store = new InMemoryProjectStore();
  store.upsert({ key: 'zzz', label: 'ZZZ', now });
  store.upsert({ key: 'aaa', label: 'AAA', now });

  const summaries = store.buildAllSummaries({});
  // 'cli-bridge' comes before 'aaa' comes before 'zzz'
  for (let i = 1; i < summaries.length; i += 1) {
    assert.ok(
      summaries[i - 1].project.key.localeCompare(summaries[i].project.key) <= 0,
      `sort order: ${summaries[i - 1].project.key} should be <= ${summaries[i].project.key}`,
    );
  }
});

// ════════════════════════════════════════════════════════════════════
// §6  Goal/review/prompt carry projectId on create
// ════════════════════════════════════════════════════════════════════

test('createGoal passes projectId through to the created entity', async () => {
  // Integration test — use createBridgeRuntime to exercise the store through
  // its normal creation path.
  const { createBridgeRuntime } = await import(
    '../apps/local-server/src/routes/bridge-api.ts'
  );
  const runtime = createBridgeRuntime();

  const goal = runtime.goalStore.createGoal({
    sessionId: 's1',
    description: 'Task with project',
    projectId: 'my-proj',
  });

  assert.equal(goal.projectId, 'my-proj');
});

test('createGoal without projectId yields undefined projectId', async () => {
  const { createBridgeRuntime } = await import(
    '../apps/local-server/src/routes/bridge-api.ts'
  );
  const runtime = createBridgeRuntime();

  const goal = runtime.goalStore.createGoal({
    sessionId: 's1',
    description: 'Task without project',
  });

  assert.equal(goal.projectId, undefined);
});

test('createReview passes projectId through', async () => {
  const { createBridgeRuntime } = await import(
    '../apps/local-server/src/routes/bridge-api.ts'
  );
  const runtime = createBridgeRuntime();

  const review = runtime.pendingReviewStore.createDraft({
    sessionId: 's1',
    sourceEndpointId: 'codex-command',
    targetEndpointId: 'claude-code-command',
    prompt: 'review this',
    projectId: 'my-proj',
  });

  assert.equal(review.projectId, 'my-proj');
});

test('createPendingPrompt passes projectId through', async () => {
  const { createBridgeRuntime } = await import(
    '../apps/local-server/src/routes/bridge-api.ts'
  );
  const runtime = createBridgeRuntime();

  const prompt = runtime.pendingPromptStore.createPendingPrompt({
    sessionId: 's1',
    prompt: 'test prompt',
    source: 'chatgpt-web',
    transport: 'clipboard',
    projectId: 'my-proj',
  });

  assert.equal(prompt.projectId, 'my-proj');
});

// ════════════════════════════════════════════════════════════════════
// §7  validateProjectKey
// ════════════════════════════════════════════════════════════════════

test('validateProjectKey accepts valid keys', () => {
  assert.equal(validateProjectKey('my-project'), 'my-project');
  assert.equal(validateProjectKey('alpha_2'), 'alpha_2');
  assert.equal(validateProjectKey('a'), 'a');
  assert.equal(validateProjectKey('a'.repeat(64)), 'a'.repeat(64));
  assert.equal(validateProjectKey('123abc'), '123abc');
  assert.equal(validateProjectKey('z'), 'z');
});

test('validateProjectKey rejects invalid keys', () => {
  assert.equal(validateProjectKey(''), null);
  assert.equal(validateProjectKey('   '), null);
  assert.equal(validateProjectKey(null), null);
  assert.equal(validateProjectKey(undefined), null);
  assert.equal(validateProjectKey('a'.repeat(65)), null, 'too long');
  assert.equal(validateProjectKey('/etc/passwd'), null, 'slash');
  assert.equal(validateProjectKey('has space'), null, 'space');
  assert.equal(validateProjectKey('a/b'), null, 'path-segment');
  assert.equal(validateProjectKey('-leading-hyphen'), null, 'must start with alnum');
  assert.equal(validateProjectKey('\x00'), null, 'null char');
  assert.equal(validateProjectKey(123), null, 'non-string');
});
