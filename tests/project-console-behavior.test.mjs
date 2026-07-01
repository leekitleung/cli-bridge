// Project Workspace Console behavior-level tests (Step 3).
//
// Uses jsdom to load the console HTML and exercise real
// click/input/event flows with a mocked fetch backend.
// Verifies that projectId scoping, loading states, and
// bridge-only fetch paths hold at runtime.

import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { renderProjectConsoleHtml } from '../apps/local-server/src/routes/project-console.ts';

// ---- Helpers ----

/** Poll until predicate returns true or timeout expires. */
async function waitFor(predicate, timeoutMs = 500) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await new Promise(r => setTimeout(r, 10));
  }
  throw new Error('waitFor timeout after ' + timeoutMs + 'ms');
}

/** Create a jsdom window loaded with the console HTML and mocked APIs. */
function setupConsole(options = {}) {
  const html = renderProjectConsoleHtml();
  const dom = new JSDOM(html, {
    url: 'http://localhost:9300/console/project',
    runScripts: 'dangerously',
    resources: 'usable',
    ...options,
  });

  const { window } = dom;
  const { document } = window;

  // Mock localStorage.
  const storage = {};
  Object.defineProperty(window, 'localStorage', {
    value: {
      getItem: (key) => storage[key] ?? null,
      setItem: (key, value) => { storage[key] = value; },
    },
    writable: true,
  });

  // Mock fetch — returns controlled responses from a fixture map.
  const fetchCalls = [];
  const fetchFixtures = {};

  function setFixture(path, response) {
    fetchFixtures[path] = response;
  }

  window.fetch = async (url, init = {}) => {
    const path = typeof url === 'string' ? new URL(url).pathname : url;
    const body = init.body ? JSON.parse(init.body) : null;
    fetchCalls.push({ path, method: init.method || 'GET', body });
    const fixture = fetchFixtures[path];
    if (fixture) {
      return {
        ok: fixture.ok !== false,
        status: fixture.status ?? 200,
        json: async () => fixture.payload ?? {},
      };
    }
    // Default: success with empty response.
    return { ok: true, status: 200, json: async () => ({}) };
  };

  return { window, document, dom, fetchCalls, setFixture, storage };
}

async function runCommand(document, command, waitMs = 200) {
  const input = document.getElementById('command-input');
  input.value = command;
  input.dispatchEvent(new document.defaultView.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await new Promise(r => setTimeout(r, waitMs));
}

test('composer plus inserts project-create command template without mutating state', () => {
  const { document, fetchCalls } = setupConsole();
  document.getElementById('composer-new-project').click();

  assert.equal(document.getElementById('command-input').value, 'project create <key>');
  assert.equal(document.getElementById('command-status').textContent, 'edit project key, then send');
  assert.equal(
    fetchCalls.some((call) => call.path === '/bridge/projects' && call.method === 'POST'),
    false,
    'plus shortcut must not create a project until the operator sends the command',
  );
});

/** Default project list fixture. */
function defaultProjectsFixture() {
  return {
    ok: true,
    payload: {
      projects: [
        {
          project: { key: 'cli-bridge', label: 'CLI Bridge', createdAt: 1 },
          goalCount: 0, activeGoalCount: 0, reviewCount: 0, promptCount: 0, status: 'unknown',
        },
        {
          project: { key: 'alpha', label: 'Alpha', createdAt: 1 },
          goalCount: 2, activeGoalCount: 1, reviewCount: 0, promptCount: 0, status: 'active',
        },
      ],
    },
  };
}

/** Default project detail fixture. */
function defaultDetailFixture(key) {
  return {
    ok: true,
    payload: {
      project: { key, label: key === 'cli-bridge' ? 'CLI Bridge' : 'Alpha', createdAt: 1 },
      summary: { project: { key, label: key }, goalCount: key === 'alpha' ? 2 : 0, activeGoalCount: key === 'alpha' ? 1 : 0, reviewCount: 0, promptCount: 0, status: key === 'alpha' ? 'active' : 'unknown' },
      goals: key === 'alpha' ? [
        { goal: { id: 'g1', description: 'Alpha goal 1', status: 'executing', sessionId: 's1', createdAt: 1, updatedAt: 1 }, plan: null },
        { goal: { id: 'g2', description: 'Alpha goal 2', status: 'done', sessionId: 's1', createdAt: 1, updatedAt: 1 }, plan: null },
      ] : [],
      reviews: [],
      pendingPrompts: [],
      auditEvents: [],
      status: {
        progress: null,
        activeGoal: key === 'alpha' ? { id: 'g1', description: 'Alpha goal 1', status: 'executing' } : null,
        goalsSummary: key === 'alpha' ? [
          { id: 'g1', description: 'Alpha goal 1', status: 'executing' },
          { id: 'g2', description: 'Alpha goal 2', status: 'done' },
        ] : [],
        blockedGate: null,
        latestAudit: null,
        memory: [],
      },
    },
  };
}

test('/goals and /reviews open native contexts inside Project Workspace', async () => {
  const { document, setFixture, fetchCalls } = setupConsole();
  setFixture('/bridge/metrics', { ok: true, payload: {} });
  setFixture('/bridge/projects', defaultProjectsFixture());
  setFixture('/bridge/projects/cli-bridge', defaultDetailFixture('cli-bridge'));
  setFixture('/bridge/execution-proposals', { ok: true, payload: { bindings: [], proposals: [] } });

  document.getElementById('token').value = 'test-token';
  document.getElementById('connect').click();
  await new Promise(r => setTimeout(r, 200));

  await runCommand(document, '/goals');
  assert.ok(document.getElementById('goals-context'));
  assert.equal(document.getElementById('goal-card').style.display, 'none');
  assert.equal(document.getElementById('timeline-container').style.display, 'none');

  await runCommand(document, '/reviews');
  assert.ok(document.getElementById('reviews-context'));
  assert.ok(document.getElementById('review-context-target'));
  assert.ok(document.getElementById('review-context-content'));

  await runCommand(document, '/project');
  assert.equal(document.getElementById('goals-context'), null);
  assert.equal(document.getElementById('reviews-context'), null);
  assert.equal(document.getElementById('goal-card').style.display, '');
  assert.equal(fetchCalls.some(call => call.path.startsWith('/console/')), false);
});

test('/reviews form dispatches through governed review APIs using the selected endpoint', async () => {
  const { document, setFixture, fetchCalls } = setupConsole();
  setFixture('/bridge/metrics', { ok: true, payload: {} });
  setFixture('/bridge/projects', defaultProjectsFixture());
  setFixture('/bridge/projects/cli-bridge', defaultDetailFixture('cli-bridge'));
  setFixture('/bridge/reviews', { ok: true, payload: { review: { id: 'review-1' } } });
  setFixture('/bridge/reviews/confirm', { ok: true, payload: { review: { id: 'review-1', status: 'confirmed' } } });
  setFixture('/bridge/reviews/dispatch', { ok: true, payload: { review: { id: 'review-1', status: 'returned' }, result: { summary: 'reviewed' }, nextPrompt: null } });

  document.getElementById('token').value = 'test-token';
  document.getElementById('connect').click();
  await new Promise(r => setTimeout(r, 200));
  await runCommand(document, '/reviews');

  document.getElementById('review-context-target').value = 'codex-command';
  document.getElementById('review-context-content').value = 'Review the current project plan';
  document.getElementById('review-context-run').click();
  await waitFor(() => document.getElementById('review-context-result'));

  const create = fetchCalls.find(call => call.path === '/bridge/reviews' && call.method === 'POST');
  assert.equal(create.body.targetEndpointId, 'codex-command');
  assert.equal(create.body.sourceEndpointId, 'claude-code-command');
  assert.deepEqual(
    fetchCalls.filter(call => call.path.startsWith('/bridge/reviews')).map(call => call.path),
    ['/bridge/reviews', '/bridge/reviews/confirm', '/bridge/reviews/dispatch'],
  );
  assert.match(document.getElementById('review-context-result').textContent, /reviewed/);
});

test('/goals renders binding and proposal controls, then confirms with server-owned authority fields', async () => {
  const { document, setFixture, fetchCalls } = setupConsole();
  const detail = defaultDetailFixture('cli-bridge');
  detail.payload.goals = [{
    goal: { id: 'goal-1', description: 'Ship the bounded change', status: 'executing', projectId: 'cli-bridge' },
    plan: { id: 'plan-1', status: 'executing', steps: [{ id: 'step-1', index: 1, intent: 'Apply reviewed patch', tier: 'high', status: 'ready' }] },
  }];
  const proposal = {
    id: 'proposal-1', planId: 'plan-1', stepId: 'step-1', artifactId: 'artifact-1',
    contentHash: 'sha256:content', bindingHash: 'sha256:binding',
    executionEndpointId: 'codex-command', executionPermissionProfile: 'workspace-write',
    projectId: 'cli-bridge', preview: 'Apply only the reviewed patch', stdin: 'bounded input',
    status: 'awaiting-confirmation',
  };
  setFixture('/bridge/metrics', { ok: true, payload: {} });
  setFixture('/bridge/projects', defaultProjectsFixture());
  setFixture('/bridge/projects/cli-bridge', detail);
  const currentBinding = {
      reasoningEndpointId: 'claude-code-command', executionEndpointId: 'codex-command',
      reasoningTier: 'high', executionTier: 'bounded', executionWorkingDirectoryRef: 'project-root:cli-bridge',
      executionPermissionProfile: 'workspace-write', maxSteps: 4, maxReasoningRounds: 2, deadlineAt: '2026-06-21T00:00:00Z',
      planId: 'plan-1',
  };
  setFixture('/bridge/execution-proposals', { ok: true, payload: {
    bindings: [{ ...currentBinding, planId: 'old-plan', executionEndpointId: 'wrong-endpoint' }, currentBinding],
    proposals: [{ ...proposal, id: 'cancelled-old', preview: 'stale proposal', status: 'cancelled' }, proposal],
    currentBinding,
    currentProposal: proposal,
  } });
  setFixture('/bridge/execution-proposals/confirm', { ok: true, payload: { proposal: { ...proposal, status: 'confirmed' } } });

  document.getElementById('token').value = 'test-token';
  document.getElementById('connect').click();
  await new Promise(r => setTimeout(r, 200));
  await runCommand(document, '/goals');

  assert.match(document.getElementById('goals-context').textContent, /claude-code-command/);
  assert.match(document.getElementById('goals-context').textContent, /Apply only the reviewed patch/);
  assert.doesNotMatch(document.getElementById('goals-context').textContent, /stale proposal|wrong-endpoint/);
  document.querySelector('[data-proposal-action="confirm"]').click();
  await waitFor(() => fetchCalls.some(call => call.path === '/bridge/execution-proposals/confirm'));

  const confirm = fetchCalls.find(call => call.path === '/bridge/execution-proposals/confirm');
  assert.deepEqual(confirm.body, {
    proposalId: 'proposal-1', planId: 'plan-1', stepId: 'step-1', artifactId: 'artifact-1',
    contentHash: 'sha256:content', bindingHash: 'sha256:binding', executionEndpointId: 'codex-command',
    executionPermissionProfile: 'workspace-write', projectId: 'cli-bridge',
  });
});

// ════════════════════════════════════════════════════════════════════
// §1  Project switch loads detail and clears loading state
// ════════════════════════════════════════════════════════════════════

test('switching project displays loading and then renders new detail', async () => {
  const { window, document, fetchCalls, setFixture } = setupConsole();

  // Set up fixtures.
  setFixture('/bridge/metrics', { ok: true, payload: {} });
  setFixture('/bridge/projects', defaultProjectsFixture());
  setFixture('/bridge/projects/cli-bridge', defaultDetailFixture('cli-bridge'));
  setFixture('/bridge/projects/alpha', defaultDetailFixture('alpha'));

  // Simulate connect.
  const tokenInput = document.getElementById('token');
  tokenInput.value = 'test-token';
  document.getElementById('connect').click();

  // Wait for the async refresh to complete.
  await new Promise(r => setTimeout(r, 200));

  // Verify initial state: cli-bridge loaded, no loading state.
  const loadingBefore = document.getElementById('goal-content').textContent;
  assert.ok(!loadingBefore.includes('Loading project detail'),
    'should not show loading after initial load');

  // Find the alpha project item and click it.
  const alphaItem = document.querySelector('[data-key="alpha"]');
  assert.ok(alphaItem, 'alpha project item must exist');

  // Click alpha to switch.
  alphaItem.click();

  // Loading should appear.
  const loadingDuring = document.getElementById('goal-content').textContent;
  assert.match(loadingDuring, /Loading project detail/,
    'loading indicator must appear during switch');

  // Wait for async refresh — loading must disappear.
  await waitFor(() => !document.getElementById('goal-content').textContent.includes('Loading project detail'), 500);

  // Verify fetches.
  assert.ok(fetchCalls.some(c => c.path === '/bridge/projects/alpha'),
    'must fetch alpha project detail');
});

// ════════════════════════════════════════════════════════════════════
// §2  Goal creation in non-default project passes projectId
// ════════════════════════════════════════════════════════════════════

test('creating a goal passes active projectId', async () => {
  const { window, document, fetchCalls, setFixture } = setupConsole();

  setFixture('/bridge/metrics', { ok: true, payload: {} });
  setFixture('/bridge/projects', defaultProjectsFixture());
  setFixture('/bridge/projects/cli-bridge', defaultDetailFixture('cli-bridge'));
  setFixture('/bridge/goals', { ok: true, status: 201, payload: { goal: { id: 'new-goal', status: 'draft' } } });

  // Connect.
  document.getElementById('token').value = 'test-token';
  document.getElementById('connect').click();
  await new Promise(r => setTimeout(r, 200));

  // Switch to alpha project via localStorage (simpler than clicking).
  const alphaItem = document.querySelector('[data-key="alpha"]');
  alphaItem.click();
  await new Promise(r => setTimeout(r, 200));

  // Type a goal and send.
  const cmdInput = document.getElementById('command-input');
  cmdInput.value = 'goal Build a new feature';
  document.getElementById('command-send').click();
  await new Promise(r => setTimeout(r, 200));

  // Verify the POST included projectId.
  const goalCreate = fetchCalls.find(c => c.path === '/bridge/goals' && c.method === 'POST');
  assert.ok(goalCreate, 'must POST to /bridge/goals');
  assert.ok(goalCreate.body.projectId, 'must include projectId in body');
  assert.equal(goalCreate.body.projectId, 'alpha', 'projectId must be the active project key');
  assert.equal(goalCreate.body.description, 'Build a new feature');
});

test('plain task text creates a project-scoped goal', async () => {
  const { document, fetchCalls, setFixture } = setupConsole();

  setFixture('/bridge/metrics', { ok: true, payload: {} });
  setFixture('/bridge/projects', defaultProjectsFixture());
  setFixture('/bridge/projects/cli-bridge', defaultDetailFixture('cli-bridge'));
  setFixture('/bridge/goals', { ok: true, status: 201, payload: { goal: { id: 'new-goal', status: 'draft' } } });

  document.getElementById('token').value = 'test-token';
  document.getElementById('connect').click();
  await new Promise(r => setTimeout(r, 200));

  await runCommand(document, '修复中间层输入框，让普通对话自动创建任务');

  const goalCreate = fetchCalls.find(c => c.path === '/bridge/goals' && c.method === 'POST');
  assert.ok(goalCreate, 'plain task text must POST to /bridge/goals');
  assert.equal(goalCreate.body.projectId, 'cli-bridge');
  assert.equal(goalCreate.body.description, '修复中间层输入框，让普通对话自动创建任务');
});

test('short plain task text creates a project-scoped goal', async () => {
  const { document, fetchCalls, setFixture } = setupConsole();

  setFixture('/bridge/metrics', { ok: true, payload: {} });
  setFixture('/bridge/projects', defaultProjectsFixture());
  setFixture('/bridge/projects/cli-bridge', defaultDetailFixture('cli-bridge'));
  setFixture('/bridge/goals', { ok: true, status: 201, payload: { goal: { id: 'new-goal', status: 'draft' } } });

  document.getElementById('token').value = 'test-token';
  document.getElementById('connect').click();
  await new Promise(r => setTimeout(r, 200));

  await runCommand(document, 'fix');

  const goalCreate = fetchCalls.find(c => c.path === '/bridge/goals' && c.method === 'POST');
  assert.ok(goalCreate, 'short plain task text must POST to /bridge/goals');
  assert.equal(goalCreate.body.description, 'fix');
});

test('typo input creates a goal instead of failing closed', async () => {
  const { document, fetchCalls, setFixture } = setupConsole();

  setFixture('/bridge/metrics', { ok: true, payload: {} });
  setFixture('/bridge/projects', defaultProjectsFixture());
  setFixture('/bridge/projects/cli-bridge', defaultDetailFixture('cli-bridge'));
  setFixture('/bridge/goals', { ok: true, status: 201, payload: { goal: { id: 'new-goal', status: 'draft' } } });

  document.getElementById('token').value = 'test-token';
  document.getElementById('connect').click();
  await new Promise(r => setTimeout(r, 200));

  await runCommand(document, 'verfy');

  const goalCreate = fetchCalls.find(c => c.path === '/bridge/goals' && c.method === 'POST');
  assert.ok(goalCreate, 'typo text must create a goal as natural language');
  assert.equal(goalCreate.body.description, 'verfy');
  // Must not show "Unknown command" message.
  assert.ok(!document.getElementById('command-log').textContent.includes('Unknown command'));
});

test('unknown slash input strips leading slash and creates a goal', async () => {
  const { document, fetchCalls, setFixture } = setupConsole();

  setFixture('/bridge/metrics', { ok: true, payload: {} });
  setFixture('/bridge/projects', defaultProjectsFixture());
  setFixture('/bridge/projects/cli-bridge', defaultDetailFixture('cli-bridge'));
  setFixture('/bridge/goals', { ok: true, status: 201, payload: { goal: { id: 'new-goal', status: 'draft' } } });

  document.getElementById('token').value = 'test-token';
  document.getElementById('connect').click();
  await new Promise(r => setTimeout(r, 200));

  await runCommand(document, '/not-a-command');

  const goalCreate = fetchCalls.find(c => c.path === '/bridge/goals' && c.method === 'POST');
  assert.ok(goalCreate, 'unknown slash input must create a goal');
  assert.equal(goalCreate.body.description, 'not-a-command', 'leading slash is stripped');
});

test('command-first workspace renders goal, plan, and next action in the main area', async () => {
  const { document, setFixture } = setupConsole();

  setFixture('/bridge/metrics', { ok: true, payload: {} });
  setFixture('/bridge/projects', defaultProjectsFixture());
  setFixture('/bridge/projects/cli-bridge', {
    ok: true,
    payload: {
      project: { key: 'cli-bridge', label: 'CLI Bridge', createdAt: 1 },
      summary: { project: { key: 'cli-bridge', label: 'CLI Bridge' }, goalCount: 1, activeGoalCount: 1, reviewCount: 0, promptCount: 0, status: 'active' },
      goals: [{
        goal: { id: 'g-plan', description: 'Optimize middle-layer UI', status: 'planned', sessionId: 's1', createdAt: 1, updatedAt: 1 },
        plan: {
          id: 'p1', status: 'awaiting-approval',
          steps: [{ id: 's1', index: 1, intent: 'Update command-first layout', kind: 'review', tier: 'patch-proposal', status: 'pending', isStateMutating: false }],
        },
      }],
      reviews: [],
      pendingPrompts: [],
      auditEvents: [],
      status: { progress: { completed: 0, total: 1 }, activeGoal: { id: 'g-plan', description: 'Optimize middle-layer UI', status: 'planned' }, goalsSummary: [], blockedGate: null },
    },
  });

  document.getElementById('token').value = 'test-token';
  document.getElementById('connect').click();
  await new Promise(r => setTimeout(r, 200));

  const workspace = document.getElementById('workspace');
  assert.ok(workspace.querySelector('[data-current-goal="true"]'), 'current goal must be in main workspace');
  assert.ok(workspace.querySelector('[data-active-project-plan="true"]'), 'active plan must be in main workspace');
  assert.ok(workspace.querySelector('[data-next-action="true"]'), 'next action must be in main workspace');
  assert.match(workspace.textContent, /Optimize middle-layer UI/);
  assert.match(workspace.textContent, /approve plan/i);
});

test('approve plan command routes to the existing controlled goal approval endpoint', async () => {
  const { document, fetchCalls, setFixture } = setupConsole();

  setFixture('/bridge/metrics', { ok: true, payload: {} });
  setFixture('/bridge/projects', defaultProjectsFixture());
  setFixture('/bridge/projects/cli-bridge', {
    ok: true,
    payload: {
      project: { key: 'cli-bridge', label: 'CLI Bridge', createdAt: 1 },
      summary: { project: { key: 'cli-bridge', label: 'CLI Bridge' }, goalCount: 1, activeGoalCount: 1, reviewCount: 0, promptCount: 0, status: 'active' },
      goals: [{
        goal: { id: 'g-approve', description: 'Approve this plan', status: 'planned', sessionId: 's1', createdAt: 1, updatedAt: 1 },
        plan: { id: 'p1', status: 'awaiting-approval', steps: [] },
      }],
      reviews: [],
      pendingPrompts: [],
      auditEvents: [],
      status: { progress: { completed: 0, total: 0 }, activeGoal: { id: 'g-approve', description: 'Approve this plan', status: 'planned' }, goalsSummary: [], blockedGate: null },
    },
  });
  setFixture('/bridge/goals/approve', { ok: true, payload: { ok: true } });

  document.getElementById('token').value = 'test-token';
  document.getElementById('connect').click();
  await new Promise(r => setTimeout(r, 200));

  const cmdInput = document.getElementById('command-input');
  cmdInput.value = 'approve plan';
  document.getElementById('command-send').click();
  await new Promise(r => setTimeout(r, 200));

  const approval = fetchCalls.find(c => c.path === '/bridge/goals/approve' && c.method === 'POST');
  assert.ok(approval, 'must POST to /bridge/goals/approve');
  assert.equal(approval.body.goalId, 'g-approve');
  assert.equal(fetchCalls.some(c => /\/(exec|shell|run|command)$/.test(c.path)), false);
});

// ════════════════════════════════════════════════════════════════════
// §3  Review creation in non-default project passes projectId
// ════════════════════════════════════════════════════════════════════

test('creating a review passes active projectId', async () => {
  const { window, document, fetchCalls, setFixture } = setupConsole();

  setFixture('/bridge/metrics', { ok: true, payload: {} });
  setFixture('/bridge/projects', defaultProjectsFixture());
  setFixture('/bridge/projects/cli-bridge', defaultDetailFixture('cli-bridge'));
  setFixture('/bridge/reviews', {
    ok: true, status: 201,
    payload: { review: { id: 'rev-1', status: 'previewed', projectId: 'alpha' } },
  });
  setFixture('/bridge/reviews/confirm', { ok: true, payload: { review: { id: 'rev-1', status: 'confirmed' } } });
  setFixture('/bridge/reviews/dispatch', {
    ok: true,
    payload: { review: { id: 'rev-1', status: 'returned' }, result: {}, nextPrompt: null },
  });

  // Connect.
  document.getElementById('token').value = 'test-token';
  document.getElementById('connect').click();
  await new Promise(r => setTimeout(r, 200));

  // Switch to alpha project.
  const alphaItem = document.querySelector('[data-key="alpha"]');
  alphaItem.click();
  await new Promise(r => setTimeout(r, 200));

  // Create a review through the composer.
  await runCommand(document, 'review Review this code');
  await new Promise(r => setTimeout(r, 200));

  // Verify the POST included projectId.
  const reviewCreate = fetchCalls.find(c => c.path === '/bridge/reviews' && c.method === 'POST');
  assert.ok(reviewCreate, 'must POST to /bridge/reviews');
  assert.ok(reviewCreate.body.projectId, 'must include projectId in body');
  assert.equal(reviewCreate.body.projectId, 'alpha', 'projectId must be the active project key');
});

// ════════════════════════════════════════════════════════════════════
// §4  Same-project click is short-circuited
// ════════════════════════════════════════════════════════════════════

test('clicking the already-active project does not trigger a fetch', async () => {
  const { window, document, fetchCalls, setFixture } = setupConsole();

  setFixture('/bridge/metrics', { ok: true, payload: {} });
  setFixture('/bridge/projects', defaultProjectsFixture());
  setFixture('/bridge/projects/cli-bridge', defaultDetailFixture('cli-bridge'));

  // Connect.
  document.getElementById('token').value = 'test-token';
  document.getElementById('connect').click();
  await new Promise(r => setTimeout(r, 200));

  const countBefore = fetchCalls.length;

  // Click the already-active cli-bridge project.
  const cliBridgeItem = document.querySelector('[data-key="cli-bridge"]');
  assert.ok(cliBridgeItem, 'cli-bridge item must exist');
  cliBridgeItem.click();
  await new Promise(r => setTimeout(r, 20));

  // No additional fetches should have been made.
  const countAfter = fetchCalls.length;
  assert.equal(countAfter, countBefore, 'same-project click must not trigger fetches');
});

// ════════════════════════════════════════════════════════════════════
// §5  Project management — archive/unarchive, includeArchived, inline edit
// ════════════════════════════════════════════════════════════════════

test('archiving a project hides it from default list', async () => {
  const { window, document, fetchCalls, setFixture } = setupConsole();

  setFixture('/bridge/metrics', { ok: true, payload: {} });
  setFixture('/bridge/projects', {
    ok: true,
    payload: {
      projects: [
        {
          project: { key: 'cli-bridge', label: 'CLI Bridge', createdAt: 1 },
          goalCount: 0, activeGoalCount: 0, reviewCount: 0, promptCount: 0, status: 'unknown',
        },
        {
          project: { key: 'alpha', label: 'Alpha', createdAt: 1 },
          goalCount: 1, activeGoalCount: 0, reviewCount: 0, promptCount: 0, status: 'idle',
        },
      ],
    },
  });
  setFixture('/bridge/projects/cli-bridge', defaultDetailFixture('cli-bridge'));
  setFixture('/bridge/projects/alpha/archive', { ok: true, status: 200, payload: { project: { key: 'alpha', label: 'Alpha', archivedAt: Date.now() } } });

  // Connect.
  document.getElementById('token').value = 'test-token';
  document.getElementById('connect').click();
  await new Promise(r => setTimeout(r, 200));

  // Alpha should be visible in the list.
  let items = document.querySelectorAll('.project-item');
  assert.ok(Array.from(items).some(el => el.dataset.key === 'alpha'), 'alpha must be visible before archive');

  assert.equal(document.querySelector('.archive-btn[data-key="alpha"]'), null, 'archive button must not exist');
  await runCommand(document, 'project archive alpha');
  await new Promise(r => setTimeout(r, 200));

  // After archive, the project list should no longer show alpha.
  const archiveCall = fetchCalls.find(c => c.path === '/bridge/projects/alpha/archive');
  assert.ok(archiveCall, 'must POST to archive endpoint');
});

test('includeArchived toggle fetches projects with query param', async () => {
  const { window, document, fetchCalls, setFixture } = setupConsole();
  setFixture('/bridge/metrics', { ok: true, payload: {} });
  setFixture('/bridge/projects', defaultProjectsFixture());
  setFixture('/bridge/projects/cli-bridge', defaultDetailFixture('cli-bridge'));

  document.getElementById('token').value = 'test-token';
  document.getElementById('connect').click();

  await waitFor(() => document.getElementById('toggle-archived') !== null, 1000);
  await new Promise(r => setTimeout(r, 200));

  const beforeCount = fetchCalls.length;

  // Simulate toggle checked + refresh via global refreshAll.
  document.getElementById('toggle-archived').checked = true;
  await window.refreshAll();

  assert.ok(fetchCalls.length > beforeCount, 'toggle checked + refreshAll triggers additional fetches');
});

test('project rename command sends PATCH to update project label', async () => {
  const { window, document, fetchCalls, setFixture } = setupConsole();

  setFixture('/bridge/metrics', { ok: true, payload: {} });
  setFixture('/bridge/projects', defaultProjectsFixture());
  setFixture('/bridge/projects/cli-bridge', defaultDetailFixture('cli-bridge'));
  setFixture('/bridge/projects/cli-bridge', {
    ok: true,
    payload: {
      project: { key: 'cli-bridge', label: 'Updated Bridge', createdAt: 1 },
      summary: { project: { key: 'cli-bridge', label: 'Updated Bridge' }, goalCount: 0, activeGoalCount: 0, reviewCount: 0, promptCount: 0, status: 'unknown' },
      goals: [], reviews: [], pendingPrompts: [], auditEvents: [],
      status: { progress: null, activeGoal: null, goalsSummary: [], blockedGate: null, memory: [] },
    },
  });
  // PATCH endpoint fixture.
  window.fetch = async (url, init = {}) => {
    const path = typeof url === 'string' ? new URL(url).pathname : url;
    const body = init.body ? JSON.parse(init.body) : null;
    fetchCalls.push({ path, method: init.method || 'GET', body });
    if (path === '/bridge/projects/cli-bridge' && init.method === 'PATCH') {
      return { ok: true, status: 200, json: async () => ({ project: { key: 'cli-bridge', label: body?.label || 'CLI Bridge', createdAt: 1 } }) };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  };

  document.getElementById('token').value = 'test-token';
  document.getElementById('connect').click();
  await new Promise(r => setTimeout(r, 200));

  assert.equal(document.getElementById('inline-edit-save'), null, 'inline save button must not exist');
  await runCommand(document, 'project rename cli-bridge Updated Bridge');
  await new Promise(r => setTimeout(r, 200));

  // Check PATCH call.
  const patchCall = fetchCalls.find(c => c.method === 'PATCH');
  assert.ok(patchCall, 'must send PATCH request');
  assert.equal(patchCall.body.label, 'Updated Bridge');
});

// B3: stale cache after project switch with partial observability failure.
test('project switch clears old observability cache when fetches fail', async () => {
  const { window, document, setFixture } = setupConsole();

  // Set up metrics so connect works.
  setFixture('/bridge/metrics', { ok: true, payload: {} });

  // Initial project (cli-bridge) fixtures — needed because console starts on cli-bridge.
  setFixture('/bridge/projects/cli-bridge', {
    ok: true,
    payload: { project: { key: 'cli-bridge', label: 'CLI Bridge' }, summary: { status: 'unknown', goalCount: 0, activeGoalCount: 0, reviewCount: 0, promptCount: 0 }, goals: [], reviews: [], pendingPrompts: [], auditEvents: [], status: { progress: null, activeGoal: null, goalsSummary: [], blockedGate: null, latestAudit: null, memory: [] } },
  });
  setFixture('/bridge/projects/cli-bridge/timeline', { ok: true, payload: { projectId: 'cli-bridge', entries: [] } });
  setFixture('/bridge/projects/cli-bridge/audit', { ok: true, payload: { projectId: 'cli-bridge', total: 0, returning: 0, entries: [] } });
  setFixture('/bridge/projects/cli-bridge/memory', { ok: true, payload: { projectId: 'cli-bridge', entries: [] } });
  setFixture('/bridge/projects/cli-bridge/verification', { ok: true, payload: { projectId: 'cli-bridge', records: [], status: 'unavailable' } });

  // Seed alpha project with timeline/audit/memory data.
  setFixture('/bridge/projects', {
    ok: true,
    payload: {
      projects: [
        { project: { key: 'cli-bridge', label: 'CLI Bridge', createdAt: 1 }, goalCount: 0, activeGoalCount: 0, reviewCount: 0, promptCount: 0, status: 'unknown' },
        { project: { key: 'alpha', label: 'Alpha', createdAt: 1 }, goalCount: 1, activeGoalCount: 1, reviewCount: 0, promptCount: 0, status: 'active' },
        { project: { key: 'beta', label: 'Beta', createdAt: 1 }, goalCount: 0, activeGoalCount: 0, reviewCount: 0, promptCount: 0, status: 'unknown' },
      ],
    },
  });
  setFixture('/bridge/projects/alpha', {
    ok: true,
    payload: { project: { key: 'alpha', label: 'Alpha' }, summary: { status: 'active', goalCount: 1, activeGoalCount: 1, reviewCount: 0, promptCount: 0 }, goals: [], reviews: [], pendingPrompts: [], auditEvents: [], status: { progress: null, activeGoal: null, goalsSummary: [], blockedGate: null, latestAudit: null, memory: [] } },
  });
  setFixture('/bridge/projects/alpha/timeline', {
    ok: true,
    payload: { projectId: 'alpha', entries: [{ id: 't1', projectId: 'alpha', source: 'goal', kind: 'goal_created', label: 'Alpha Goal', timestamp: 1, links: {} }] },
  });
  setFixture('/bridge/projects/alpha/audit', { ok: true, payload: { projectId: 'alpha', total: 1, returning: 1, entries: [] } });
  setFixture('/bridge/projects/alpha/memory', { ok: true, payload: { projectId: 'alpha', entries: [{ sourceKind: 'goal', sourceId: 'g1', timestamp: 1, fact: '1 active goal' }] } });
  setFixture('/bridge/projects/alpha/verification', { ok: true, payload: { projectId: 'alpha', records: [], status: 'unavailable' } });

  // Beta: projects list + detail OK, but observability endpoints fail.
  setFixture('/bridge/projects/beta', {
    ok: true,
    payload: { project: { key: 'beta', label: 'Beta' }, summary: { status: 'unknown', goalCount: 0, activeGoalCount: 0, reviewCount: 0, promptCount: 0 }, goals: [], reviews: [], pendingPrompts: [], auditEvents: [], status: { progress: null, activeGoal: null, goalsSummary: [], blockedGate: null, latestAudit: null, memory: [] } },
  });
  setFixture('/bridge/projects/beta/timeline', { ok: false, status: 500, payload: {} });
  setFixture('/bridge/projects/beta/audit', { ok: false, status: 500, payload: {} });
  setFixture('/bridge/projects/beta/memory', { ok: false, status: 500, payload: {} });
  setFixture('/bridge/projects/beta/verification', { ok: false, status: 500, payload: {} });

  // Connect first.
  const tokenInput = document.getElementById('token');
  tokenInput.value = 'test-token';
  document.getElementById('connect').click();
  await new Promise(r => setTimeout(r, 200));

  // Switch to beta by clicking the beta project item.
  const betaItem = document.querySelector('[data-key="beta"]');
  assert.ok(betaItem, 'beta project item must exist');
  betaItem.click();
  await new Promise(r => setTimeout(r, 200));

  // After switching to beta with failed observability fetches, the timeline
  // should not contain alpha's data.
  const timeline = document.getElementById('timeline');
  assert.ok(timeline, 'timeline element must exist');
  const html = timeline.innerHTML;
  assert.equal(html.includes('Alpha Goal'), false,
    'alpha timeline data must not appear after switching to beta with failed fetches');

  // Memory should not show alpha's data.
  const memory = document.getElementById('status-memory');
  assert.ok(memory, 'status-memory element must exist');
  assert.equal(memory.innerHTML.includes('1 active goal'), false,
    'alpha memory must not appear after switching to beta');
});

// ── v2.11 ADR-0016: Verification summary status panel ───────────

test('v2.11: verification status panel renders summary without raw notes', async () => {
  const { document, setFixture, fetchCalls } = setupConsole();

  setFixture('/bridge/metrics', { ok: true, payload: {} });
  setFixture('/bridge/projects', defaultProjectsFixture());
  setFixture('/bridge/projects/cli-bridge', defaultDetailFixture('cli-bridge'));
  setFixture('/bridge/projects/cli-bridge/timeline', { ok: true, payload: { projectId: 'cli-bridge', entries: [] } });
  setFixture('/bridge/projects/cli-bridge/audit', { ok: true, payload: { projectId: 'cli-bridge', total: 0, returning: 0, entries: [] } });
  setFixture('/bridge/projects/cli-bridge/memory', { ok: true, payload: { projectId: 'cli-bridge', entries: [] } });
  setFixture('/bridge/projects/cli-bridge/verification', {
    ok: true,
    payload: {
      projectId: 'cli-bridge',
      status: 'recorded',
      summary: { evidenceCount: 1, lastRecordedAt: 800, doneStepCount: 1, totalStepCount: 2 },
      records: [{ harnessStatus: 'recorded', notes: 'npm test passed', createdAt: 800 }],
    },
  });

  document.getElementById('token').value = 'test-token';
  document.getElementById('connect').click();
  await new Promise(r => setTimeout(r, 200));

  const panel = document.getElementById('status-verification');
  assert.ok(panel.innerHTML.includes('1 evidence record'), 'summary evidence count rendered');
  assert.ok(panel.innerHTML.includes('1 / 2 steps done'), 'summary step counts rendered');
  assert.ok(panel.innerHTML.includes('1970-01-01T00:00:00.800Z'), 'summary recency rendered');
  assert.equal(panel.innerHTML.includes('npm test passed'), false, 'raw notes not rendered');
  assert.equal(/pass|fail|green|red/i.test(panel.innerHTML), false, 'no inferred outcome text');

  const verificationCalls = fetchCalls.filter(c => c.path.endsWith('/verification'));
  assert.equal(verificationCalls.length, 1, 'uses existing verification fetch only');
  assert.equal(verificationCalls[0].method, 'GET');
});

test('v2.11: malformed verification summary fails closed and does not render notes', async () => {
  const { document, setFixture } = setupConsole();

  setFixture('/bridge/metrics', { ok: true, payload: {} });
  setFixture('/bridge/projects', defaultProjectsFixture());
  setFixture('/bridge/projects/cli-bridge', defaultDetailFixture('cli-bridge'));
  setFixture('/bridge/projects/cli-bridge/timeline', { ok: true, payload: { projectId: 'cli-bridge', entries: [] } });
  setFixture('/bridge/projects/cli-bridge/audit', { ok: true, payload: { projectId: 'cli-bridge', total: 0, returning: 0, entries: [] } });
  setFixture('/bridge/projects/cli-bridge/memory', { ok: true, payload: { projectId: 'cli-bridge', entries: [] } });
  setFixture('/bridge/projects/cli-bridge/verification', {
    ok: true,
    payload: {
      projectId: 'cli-bridge',
      status: 'recorded',
      summary: { evidenceCount: 'bad' },
      records: [{ harnessStatus: 'recorded', notes: 'npm test passed', createdAt: 800 }],
    },
  });

  document.getElementById('token').value = 'test-token';
  document.getElementById('connect').click();
  await new Promise(r => setTimeout(r, 200));

  const panel = document.getElementById('status-verification');
  assert.ok(panel.innerHTML.includes('not yet available'), 'malformed summary renders unavailable');
  assert.equal(panel.innerHTML.includes('npm test passed'), false, 'raw notes not rendered on fail-closed path');
});

test('v2.12: verification status panel renders typed result counts without raw notes', async () => {
  const { document, setFixture, fetchCalls } = setupConsole();

  setFixture('/bridge/metrics', { ok: true, payload: {} });
  setFixture('/bridge/projects', defaultProjectsFixture());
  setFixture('/bridge/projects/cli-bridge', defaultDetailFixture('cli-bridge'));
  setFixture('/bridge/projects/cli-bridge/timeline', { ok: true, payload: { projectId: 'cli-bridge', entries: [] } });
  setFixture('/bridge/projects/cli-bridge/audit', { ok: true, payload: { projectId: 'cli-bridge', total: 0, returning: 0, entries: [] } });
  setFixture('/bridge/projects/cli-bridge/memory', { ok: true, payload: { projectId: 'cli-bridge', entries: [] } });
  setFixture('/bridge/projects/cli-bridge/verification', {
    ok: true,
    payload: {
      projectId: 'cli-bridge',
      status: 'recorded',
      summary: {
        evidenceCount: 2,
        lastRecordedAt: 900,
        doneStepCount: 1,
        totalStepCount: 2,
        resultCounts: { passed: 1, failed: 1, skipped: 0, errored: 0, unknown: 0 },
      },
      records: [
        { harnessStatus: 'recorded', result: 'passed', notes: 'npm test passed', createdAt: 900 },
      ],
    },
  });

  document.getElementById('token').value = 'test-token';
  document.getElementById('connect').click();
  await new Promise(r => setTimeout(r, 200));

  const panel = document.getElementById('status-verification');
  assert.ok(panel.innerHTML.includes('2 evidence records'), 'evidence count rendered');
  assert.ok(panel.innerHTML.includes('typed: passed: 1, failed: 1'), 'typed counts rendered');
  assert.equal(panel.innerHTML.includes('npm test passed'), false, 'raw notes not rendered');
  assert.equal(panel.innerHTML.includes('sha256'), false, 'no hash displayed');
  assert.equal(panel.querySelector('button'), null, 'no run/write button in status panel');

  const verificationCalls = fetchCalls.filter(c => c.path.endsWith('/verification'));
  assert.equal(verificationCalls.length, 1, 'uses existing verification fetch only');
  assert.equal(verificationCalls[0].method, 'GET');
});

test('v2.12: verification tab renders typed result inertly and adds no execution affordance', async () => {
  const { document, setFixture, fetchCalls } = setupConsole();

  setFixture('/bridge/metrics', { ok: true, payload: {} });
  setFixture('/bridge/projects', defaultProjectsFixture());
  setFixture('/bridge/projects/cli-bridge', defaultDetailFixture('cli-bridge'));
  setFixture('/bridge/projects/cli-bridge/timeline', { ok: true, payload: { projectId: 'cli-bridge', entries: [] } });
  setFixture('/bridge/projects/cli-bridge/audit', { ok: true, payload: { projectId: 'cli-bridge', total: 0, returning: 0, entries: [] } });
  setFixture('/bridge/projects/cli-bridge/memory', { ok: true, payload: { projectId: 'cli-bridge', entries: [] } });
  setFixture('/bridge/projects/cli-bridge/verification', {
    ok: true,
    payload: {
      projectId: 'cli-bridge',
      status: 'recorded',
      summary: {
        evidenceCount: 1,
        doneStepCount: 1,
        totalStepCount: 2,
        resultCounts: { passed: 0, failed: 0, skipped: 1, errored: 0, unknown: 0 },
      },
      records: [
        {
          stepIndex: 1,
          stepIntent: 'Verify task',
          harnessStatus: 'recorded',
          result: 'skipped',
          verificationEvidence: { result: 'skipped', commandLabel: 'manual-check' },
          notes: 'raw verification note should stay hidden from typed display',
        },
      ],
    },
  });

  document.getElementById('token').value = 'test-token';
  document.getElementById('connect').click();
  await new Promise(r => setTimeout(r, 200));
  await runCommand(document, 'verify');

  const workspace = document.getElementById('workspace');
  assert.ok(workspace.innerHTML.includes('skipped'), 'typed result rendered');
  assert.ok(workspace.innerHTML.includes('Verify task'), 'record context rendered');
  assert.equal(workspace.innerHTML.includes('raw verification note'), false, 'raw notes not rendered');
  assert.equal(/stdout|stderr|sha256|diff|raw output/i.test(workspace.innerHTML), false, 'no raw surface rendered');
  // Strip inert display flag text ([truncated], [discarded]) before checking for execution controls.
  const sanitizedHtml = workspace.innerHTML.replace(/\[truncated\]|\[discarded\]/gi, '');
  assert.equal(/run|execute|apply-from-preview|promote|commit|discard/i.test(sanitizedHtml), false, 'no execution/write affordance text');
  const buttons = [...workspace.querySelectorAll('button')].map(b => b.textContent || '').join(' ');
  assert.equal(buttons.trim(), '', 'verification context is composer-only, no buttons');
  assert.equal(workspace.querySelector('[href]'), null, 'verification view has no links');

  const verificationCalls = fetchCalls.filter(c => c.path.endsWith('/verification'));
  assert.equal(verificationCalls.every(c => c.method === 'GET'), true, 'verification calls are GET-only');
});

// ── v2.13-h: live verification gate behavior ──────────────────────

test('v2.13: verification view fetches /profiles without auto-triggering confirm', async () => {
  const { document, fetchCalls, setFixture } = setupConsole();
  setFixture('/bridge/metrics', { ok: true, payload: {} });
  setFixture('/bridge/projects', defaultProjectsFixture());
  setFixture('/bridge/projects/cli-bridge', defaultDetailFixture('cli-bridge'));
  setFixture('/bridge/projects/cli-bridge/timeline', { ok: true, payload: { projectId: 'cli-bridge', entries: [] } });
  setFixture('/bridge/projects/cli-bridge/audit', { ok: true, payload: { projectId: 'cli-bridge', total: 0, entries: [] } });
  setFixture('/bridge/projects/cli-bridge/memory', { ok: true, payload: { projectId: 'cli-bridge', entries: [] } });
  setFixture('/bridge/projects/cli-bridge/verification', { ok: true, payload: { projectId: 'cli-bridge', status: 'recorded', records: [] } });
  setFixture('/bridge/projects/cli-bridge/verification/profiles', { ok: true, payload: { profiles: [{ id: 'ut', label: 'Unit', networkRisk: 'low', mutationRisk: 'read-only', available: true, selected: false }], selectedProfileId: null, workspaceRootAvailable: true } });

  document.getElementById('token').value = 'test';
  document.getElementById('connect').click();
  await new Promise(r => setTimeout(r, 200));
  await runCommand(document, 'verify');

  const profilesCalls = fetchCalls.filter(c => c.path.endsWith('/verification/profiles'));
  assert.ok(profilesCalls.length >= 1, 'must fetch profiles');
  const confirmCalls = fetchCalls.filter(c => c.path.endsWith('/verification/confirm'));
  assert.equal(confirmCalls.length, 0, 'must not auto-trigger confirm');
});

test('v2.13: verification gate displays profile label + networkRisk + mutationRisk', async () => {
  const { document, setFixture } = setupConsole();
  setFixture('/bridge/metrics', { ok: true, payload: {} });
  setFixture('/bridge/projects', defaultProjectsFixture());
  setFixture('/bridge/projects/cli-bridge', defaultDetailFixture('cli-bridge'));
  setFixture('/bridge/projects/cli-bridge/timeline', { ok: true, payload: { projectId: 'cli-bridge', entries: [] } });
  setFixture('/bridge/projects/cli-bridge/audit', { ok: true, payload: { projectId: 'cli-bridge', total: 0, entries: [] } });
  setFixture('/bridge/projects/cli-bridge/memory', { ok: true, payload: { projectId: 'cli-bridge', entries: [] } });
  setFixture('/bridge/projects/cli-bridge/verification', { ok: true, payload: { projectId: 'cli-bridge', status: 'recorded', records: [] } });
  setFixture('/bridge/projects/cli-bridge/verification/profiles', { ok: true, payload: { profiles: [{ id: 'ut', label: 'Unit Tests', networkRisk: 'unknown', mutationRisk: 'read-only', available: true, selected: true }], selectedProfileId: 'ut', workspaceRootAvailable: true } });

  document.getElementById('token').value = 'test';
  document.getElementById('connect').click();
  await new Promise(r => setTimeout(r, 200));
  await runCommand(document, 'verify');

  const html = document.getElementById('workspace').innerHTML;
  assert.ok(html.includes('Unit Tests'), 'must show profile label');
  assert.ok(html.includes('unknown'), 'must show networkRisk');
  assert.ok(html.includes('read-only'), 'must show mutationRisk');
});

test('v2.13: verification view has no command/cwd/env free-form input', async () => {
  const { document, setFixture } = setupConsole();
  setFixture('/bridge/metrics', { ok: true, payload: {} });
  setFixture('/bridge/projects', defaultProjectsFixture());
  setFixture('/bridge/projects/cli-bridge', defaultDetailFixture('cli-bridge'));
  setFixture('/bridge/projects/cli-bridge/timeline', { ok: true, payload: { projectId: 'cli-bridge', entries: [] } });
  setFixture('/bridge/projects/cli-bridge/audit', { ok: true, payload: { projectId: 'cli-bridge', total: 0, entries: [] } });
  setFixture('/bridge/projects/cli-bridge/memory', { ok: true, payload: { projectId: 'cli-bridge', entries: [] } });
  setFixture('/bridge/projects/cli-bridge/verification', { ok: true, payload: { projectId: 'cli-bridge', status: 'recorded', records: [] } });
  setFixture('/bridge/projects/cli-bridge/verification/profiles', { ok: true, payload: { profiles: [{ id: 'ut', label: 'Unit', networkRisk: 'unknown', mutationRisk: 'read-only', available: true, selected: true }], selectedProfileId: 'ut', workspaceRootAvailable: true } });

  document.getElementById('token').value = 'test';
  document.getElementById('connect').click();
  await new Promise(r => setTimeout(r, 200));
  await runCommand(document, 'verify');

  const workspace = document.getElementById('workspace');
  const inputs = workspace.querySelectorAll('input, textarea');
  // Only confirm/refresh buttons, no free-form input
  for (const inp of inputs) {
    const id = (inp.id || '').toLowerCase();
    const name = (inp.name || '').toLowerCase();
    const label = (inp.labels?.[0]?.textContent || '').toLowerCase();
    const combined = id + name + label;
    for (const banned of ['command', 'argv', 'cwd', 'env', 'shell', 'root', 'output', 'stdout', 'stderr']) {
      assert.equal(combined.includes(banned), false, `no ${banned} input`);
    }
  }
  // No apply/commit/discard/promote controls
  const html = workspace.innerHTML.toLowerCase();
  for (const banned of ['apply', 'commit', 'discard', 'promote']) {
    assert.equal(html.includes(banned), false, `no ${banned} control`);
  }
});

// ── v2.14 ADR-0019-a: Git status console display tests ────────────

test('v2.14: verification view fetches git-status and displays branch/dirty/ahead-behind', async () => {
  const { document, fetchCalls, setFixture } = setupConsole();
  setFixture('/bridge/metrics', { ok: true, payload: {} });
  setFixture('/bridge/projects', defaultProjectsFixture());
  setFixture('/bridge/projects/cli-bridge', defaultDetailFixture('cli-bridge'));
  setFixture('/bridge/projects/cli-bridge/timeline', { ok: true, payload: { projectId: 'cli-bridge', entries: [] } });
  setFixture('/bridge/projects/cli-bridge/audit', { ok: true, payload: { projectId: 'cli-bridge', total: 0, entries: [] } });
  setFixture('/bridge/projects/cli-bridge/memory', { ok: true, payload: { projectId: 'cli-bridge', entries: [] } });
  setFixture('/bridge/projects/cli-bridge/verification', { ok: true, payload: { projectId: 'cli-bridge', status: 'recorded', records: [] } });
  // git-status fixture — healthy repo
  setFixture('/bridge/projects/cli-bridge/verification/git-status', {
    ok: true,
    payload: {
      branch: 'feat/my-branch',
      dirty: false,
      aheadCount: 5,
      behindCount: 2,
      isGitRepo: true,
      fetchedAt: Date.now(),
      available: true,
      elapsedMs: 42,
    },
  });

  document.getElementById('token').value = 'test';
  document.getElementById('connect').click();
  await new Promise(r => setTimeout(r, 200));
  await runCommand(document, 'verify');

  const gitCalls = fetchCalls.filter(c => c.path.endsWith('/verification/git-status'));
  assert.ok(gitCalls.length >= 1, 'must fetch git-status');

  const metaEl = document.getElementById('git-status-meta');
  assert.ok(metaEl, 'git-status-meta element must exist');
  const html = metaEl.innerHTML;
  assert.ok(html.includes('feat/my-branch'), 'branch name displayed');
  assert.ok(html.includes('clean'), 'clean status displayed');
  assert.ok(html.includes('ahead 5'), 'ahead count displayed');
  assert.ok(html.includes('behind 2'), 'behind count displayed');
  assert.equal(html.includes('commit'), false, 'no commit hash');
  assert.equal(html.includes('https://'), false, 'no URL');
  assert.equal(html.includes('sha256'), false, 'no hash');
  assert.equal(html.includes('stdout'), false, 'no raw output');
});

test('v2.14: git-status unavailable shows inert unavailable text', async () => {
  const { document, setFixture } = setupConsole();
  setFixture('/bridge/metrics', { ok: true, payload: {} });
  setFixture('/bridge/projects', defaultProjectsFixture());
  setFixture('/bridge/projects/cli-bridge', defaultDetailFixture('cli-bridge'));
  setFixture('/bridge/projects/cli-bridge/timeline', { ok: true, payload: { projectId: 'cli-bridge', entries: [] } });
  setFixture('/bridge/projects/cli-bridge/audit', { ok: true, payload: { projectId: 'cli-bridge', total: 0, entries: [] } });
  setFixture('/bridge/projects/cli-bridge/memory', { ok: true, payload: { projectId: 'cli-bridge', entries: [] } });
  setFixture('/bridge/projects/cli-bridge/verification', { ok: true, payload: { projectId: 'cli-bridge', status: 'recorded', records: [] } });
  setFixture('/bridge/projects/cli-bridge/verification/git-status', {
    ok: true,
    payload: { branch: null, dirty: false, aheadCount: null, behindCount: null, isGitRepo: false, fetchedAt: Date.now(), available: false, elapsedMs: 5 },
  });

  document.getElementById('token').value = 'test';
  document.getElementById('connect').click();
  await new Promise(r => setTimeout(r, 200));
  await runCommand(document, 'verify');

  const metaEl = document.getElementById('git-status-meta');
  assert.ok(metaEl, 'git-status-meta element must exist');
  assert.ok(metaEl.innerHTML.includes('unavailable'), 'unavailable text displayed');
});

test('v2.14: git-status fetch failure shows inert unavailable, no throw', async () => {
  const { document, setFixture } = setupConsole();
  setFixture('/bridge/metrics', { ok: true, payload: {} });
  setFixture('/bridge/projects', defaultProjectsFixture());
  setFixture('/bridge/projects/cli-bridge', defaultDetailFixture('cli-bridge'));
  setFixture('/bridge/projects/cli-bridge/timeline', { ok: true, payload: { projectId: 'cli-bridge', entries: [] } });
  setFixture('/bridge/projects/cli-bridge/audit', { ok: true, payload: { projectId: 'cli-bridge', total: 0, entries: [] } });
  setFixture('/bridge/projects/cli-bridge/memory', { ok: true, payload: { projectId: 'cli-bridge', entries: [] } });
  setFixture('/bridge/projects/cli-bridge/verification', { ok: true, payload: { projectId: 'cli-bridge', status: 'recorded', records: [] } });
  // git-status fetch fails.
  setFixture('/bridge/projects/cli-bridge/verification/git-status', {
    ok: false, status: 409, payload: { status: 'error', message: 'Git status is not enabled for this project' },
  });

  document.getElementById('token').value = 'test';
  document.getElementById('connect').click();
  await new Promise(r => setTimeout(r, 200));
  await runCommand(document, 'verify');

  const metaEl = document.getElementById('git-status-meta');
  assert.ok(metaEl, 'git-status-meta element must exist');
  assert.ok(metaEl.innerHTML.includes('unavailable') || metaEl.innerHTML.includes('not enabled'),
    'should show unavailable or error message on fetch failure');
  // Verify no throw by checking the element still exists (nothing crashed).
  assert.ok(document.getElementById('workspace'), 'workspace still present after git-status fetch failure');
});

test('v2.14: git-status display has no write/execute controls, GET-only', async () => {
  const { document, fetchCalls, setFixture } = setupConsole();
  setFixture('/bridge/metrics', { ok: true, payload: {} });
  setFixture('/bridge/projects', defaultProjectsFixture());
  setFixture('/bridge/projects/cli-bridge', defaultDetailFixture('cli-bridge'));
  setFixture('/bridge/projects/cli-bridge/timeline', { ok: true, payload: { projectId: 'cli-bridge', entries: [] } });
  setFixture('/bridge/projects/cli-bridge/audit', { ok: true, payload: { projectId: 'cli-bridge', total: 0, entries: [] } });
  setFixture('/bridge/projects/cli-bridge/memory', { ok: true, payload: { projectId: 'cli-bridge', entries: [] } });
  setFixture('/bridge/projects/cli-bridge/verification', { ok: true, payload: { projectId: 'cli-bridge', status: 'recorded', records: [] } });
  setFixture('/bridge/projects/cli-bridge/verification/git-status', {
    ok: true,
    payload: { branch: 'main', dirty: true, aheadCount: 1, behindCount: 0, isGitRepo: true, fetchedAt: Date.now(), available: true, elapsedMs: 10 },
  });

  document.getElementById('token').value = 'test';
  document.getElementById('connect').click();
  await new Promise(r => setTimeout(r, 200));
  await runCommand(document, 'verify');

  const gitCalls = fetchCalls.filter(c => c.path.endsWith('/verification/git-status'));
  assert.ok(gitCalls.length >= 1, 'must have git-status calls');
  for (const c of gitCalls) {
    assert.equal(c.method, 'GET', 'git-status calls must be GET');
  }

  const section = document.getElementById('git-status-section');
  assert.ok(section, 'git-status-section must exist');
  const sectionHtml = section.innerHTML.toLowerCase();
  // No write/execute controls.
  for (const banned of ['run', 'execute', 'commit', 'apply', 'discard', 'promote', 'confirm']) {
    assert.equal(sectionHtml.includes(banned), false, `no ${banned} in git-status section`);
  }
  // No command-like inputs in git-status section.
  const inputs = section.querySelectorAll('input, textarea');
  for (const inp of inputs) {
    const combined = (inp.id || '') + (inp.name || '') + (inp.type || '');
    for (const banned of ['command', 'argv', 'cwd', 'env', 'shell', 'root', 'output']) {
      assert.equal(combined.toLowerCase().includes(banned), false, `no ${banned} input in git-status section`);
    }
  }
  const buttons = section.querySelectorAll('button');
  assert.equal(buttons.length, 0, 'git-status section has no buttons; refresh goes through composer');
});

test('v2.14: git-status branch name is HTML-escaped', async () => {
  const { document, setFixture } = setupConsole();
  setFixture('/bridge/metrics', { ok: true, payload: {} });
  setFixture('/bridge/projects', defaultProjectsFixture());
  setFixture('/bridge/projects/cli-bridge', defaultDetailFixture('cli-bridge'));
  setFixture('/bridge/projects/cli-bridge/timeline', { ok: true, payload: { projectId: 'cli-bridge', entries: [] } });
  setFixture('/bridge/projects/cli-bridge/audit', { ok: true, payload: { projectId: 'cli-bridge', total: 0, entries: [] } });
  setFixture('/bridge/projects/cli-bridge/memory', { ok: true, payload: { projectId: 'cli-bridge', entries: [] } });
  setFixture('/bridge/projects/cli-bridge/verification', { ok: true, payload: { projectId: 'cli-bridge', status: 'recorded', records: [] } });
  setFixture('/bridge/projects/cli-bridge/verification/git-status', {
    ok: true,
    payload: { branch: '<script>alert(1)</script>', dirty: false, aheadCount: 0, behindCount: 0, isGitRepo: true, fetchedAt: Date.now(), available: true, elapsedMs: 10 },
  });

  document.getElementById('token').value = 'test';
  document.getElementById('connect').click();
  await new Promise(r => setTimeout(r, 200));
  await runCommand(document, 'verify');

  const metaEl = document.getElementById('git-status-meta');
  assert.ok(metaEl, 'git-status-meta must exist');
  const html = metaEl.innerHTML;
  // The raw HTML tag must not appear as literal HTML — must be escaped.
  assert.equal(html.includes('<script>'), false, 'script tag must be escaped');
  // The escaped entity must be present.
  assert.ok(html.includes('&lt;script&gt;'), 'branch name must be HTML-escaped (contains &lt;script&gt;)');
});

// ── Helpers for v2.7 ADR-0012 Apply Viewer JSDOM tests ──────────

/** Show teams context through the command composer. */
async function switchToTeamsTab(window, document) {
  if (!document.getElementById('conn-dot')?.classList.contains('ok')) {
    document.getElementById('token').value = 'test';
    document.getElementById('connect').click();
    await new Promise(r => setTimeout(r, 200));
  }
  await runCommand(document, 'teams');
  // After switching, the apply viewer form should be present.
}

/** Set apply viewer input values and mock fixtures for apply-requests calls. */
function setupApplyFixtures(setFixture, teamId, applyId, opts = {}) {
  const base = '/bridge/projects/cli-bridge/teams/' + teamId + '/apply-requests/' + applyId;

  // Manifest fixture (with optional baselineManifest).
  setFixture(base, {
    ok: true,
    payload: {
      apply: {
        applyId, status: 'applied', isolatedDirId: 'id1',
        fileCount: opts.fileCount ?? 2, byteTotal: 20,
        ...(opts.baseline ? { baselineManifest: opts.baseline } : {}),
      },
    },
  });

  // Classification fixture (200 or 409).
  if (opts.classification200) {
    setFixture(base + '/classification', {
      ok: true,
      payload: {
        files: [
          { path: 'src/a.ts', size: 10, classification: 'unchanged' },
          { path: 'src/b.ts', size: 20, classification: 'modified' },
        ],
        summary: { new: 0, modified: 1, unchanged: 1, unreadableBaseline: 0, total: 2 },
      },
    });
  } else {
    setFixture(base + '/classification', {
      ok: false, status: 409,
      payload: { status: 'error', message: 'Baseline manifest not captured for this apply request' },
    });
  }

  // Files fixture.
  setFixture(base + '/files', {
    ok: true,
    payload: { files: [{ path: 'src/a.ts', size: 10 }, { path: 'src/b.ts', size: 20 }] },
  });

  // Preview fixture — the mock strips query string, so key is just the pathname.
  setFixture(base + '/files/preview', {
    ok: true,
    payload: { path: 'src/a.ts', size: 10, truncated: false, redacted: false, content: '// a content' },
  });
}

async function runApplyView(document, teamId, applyId) {
  await runCommand(document, 'apply view ' + teamId + ' ' + applyId);
  await new Promise(r => setTimeout(r, 200));
}

async function runApplyPreview(document, relPath) {
  await runCommand(document, 'apply preview ' + relPath);
  await new Promise(r => setTimeout(r, 200));
}

// ── v2.7 ADR-0012: Classification behavior tests ───────────────

test('v2.7: view result calls manifest, classification, files — all GET, renders summary', async () => {
  const { window, document, setFixture, fetchCalls } = setupConsole({ runScripts: 'dangerously' });
  const teamId = 't-apply';
  const applyId = 'apply-success';

  await switchToTeamsTab(window, document);

  assert.equal(document.getElementById('btn-apply-view'), null, 'apply view button must not exist');

  setupApplyFixtures(setFixture, teamId, applyId, { classification200: true });
  await runApplyView(document, teamId, applyId);

  // Verify all three GET calls.
  const applyCalls = fetchCalls.filter(c => c.path.includes('/apply-requests/'));
  assert.ok(applyCalls.some(c => c.path.endsWith('/' + applyId) && c.method === 'GET'), 'manifest GET');
  assert.ok(applyCalls.some(c => c.path.endsWith('/classification') && c.method === 'GET'), 'classification GET');
  assert.ok(applyCalls.some(c => c.path.endsWith('/files') && c.method === 'GET'), 'files GET');
  for (const c of applyCalls) {
    assert.equal(c.method, 'GET', 'all apply calls must be GET');
  }

  // Classification summary renders.
  const classEl = document.getElementById('apply-view-classification');
  assert.ok(classEl.innerHTML.includes('modified 1'), 'summary shows modified count');
  assert.ok(classEl.innerHTML.includes('unchanged 1'), 'summary shows unchanged count');

  // File table shows per-file labels.
  const filesEl = document.getElementById('apply-view-files');
  assert.ok(filesEl.innerHTML.includes('unchanged'), 'file table has unchanged');
  assert.ok(filesEl.innerHTML.includes('modified'), 'file table has modified');

  // No forbidden display in the apply viewer elements only.
  const viewerHtml = [classEl, filesEl, document.getElementById('apply-view-manifest'), document.getElementById('apply-view-preview')]
    .map(el => el ? el.innerHTML : '').join('');
  assert.equal(/[^"]sha256[^"]/.test(viewerHtml), false, 'no sha256 in viewer');
  assert.equal(viewerHtml.includes('rawContent'), false, 'no rawContent');
  assert.equal(viewerHtml.includes('baselineContent'), false, 'no baselineContent');
  assert.equal(viewerHtml.includes('originalContent'), false, 'no originalContent');
  assert.equal(/[^"]lineDetail[^"]/.test(viewerHtml), false, 'no lineDetail');
  assert.equal(viewerHtml.includes('/confirm'), false, 'no /confirm path in viewer');
  assert.equal(viewerHtml.includes('/discard'), false, 'no /discard path in viewer');
  assert.equal(/promote|apply-from-preview/i.test(viewerHtml), false, 'no promote/write in viewer');
});

test('v2.7: classification 409 shows unavailable, manifest and files still render', async () => {
  const { window, document, setFixture } = setupConsole({ runScripts: 'dangerously' });
  const teamId = 't-no-baseline';
  const applyId = 'apply-no-bl';

  await switchToTeamsTab(window, document);

  setupApplyFixtures(setFixture, teamId, applyId, { classification200: false });

  await runApplyView(document, teamId, applyId);

  // Classification shows unavailable.
  const classEl = document.getElementById('apply-view-classification');
  assert.ok(classEl.innerHTML.includes('unavailable'), 'classification shows unavailable');

  // Manifest still visible.
  const manifestEl = document.getElementById('apply-view-manifest');
  assert.ok(manifestEl.innerHTML.includes(applyId), 'manifest shows applyId');

  // Files still visible.
  const filesEl = document.getElementById('apply-view-files');
  assert.ok(filesEl.innerHTML.includes('src/a.ts'), 'files show paths');
});

test('v2.7: preview still works and shows content, unaffected by classification', async () => {
  const { window, document, setFixture, fetchCalls } = setupConsole({ runScripts: 'dangerously' });
  const teamId = 't-preview';
  const applyId = 'apply-prev';

  await switchToTeamsTab(window, document);

  setupApplyFixtures(setFixture, teamId, applyId, { classification200: true });

  await runApplyView(document, teamId, applyId);

  // Click a Preview button.
  assert.equal(document.querySelector('.apply-preview-btn'), null, 'preview button must not exist');
  await runApplyPreview(document, 'src/a.ts');

  // Preview GET was called.
  assert.ok(fetchCalls.some(c => c.path.includes('/files/preview') && c.method === 'GET'), 'preview GET');

  // Preview displays content.
  const previewEl = document.getElementById('apply-view-preview');
  assert.ok(previewEl.textContent.includes('// a content'), 'preview shows file content');
  assert.ok(previewEl.textContent.includes('size 10'), 'preview shows size');
});

// ── v2.7 ADR-0012: Source-level boundary checks ────────────────

test('v2.7: classification viewer source has no write verbs, forbidden display, or controls', () => {
  const html = renderProjectConsoleHtml();
  assert.match(html, /\/classification/, 'console HTML must contain /classification endpoint');

  const vStart = html.indexOf('async function viewApplyResult');
  const vEnd = html.indexOf('async function runReviewCommand');
  const viewer = html.slice(vStart, vEnd);

  assert.equal(/'POST'|'PUT'|'DELETE'|'PATCH'/.test(viewer), false, 'viewer still GET-only');
  assert.equal(/sha256/i.test(viewer), false, 'no sha256 in viewer');
  assert.equal(/rawContent|baselineContent|originalContent/.test(viewer), false, 'no raw content keys');
  assert.equal(/diff|lineDetail/i.test(viewer), false, 'no diff/lineDetail');
  assert.equal(/promote|apply-from-preview/i.test(viewer), false, 'no promote/write');
  assert.equal(/apply-requests[^\n]*\/confirm/.test(viewer), false, 'no confirm');
  assert.equal(/apply-requests[^\n]*\/discard/.test(viewer), false, 'no discard');
});

// ── v2.8 ADR-0013: Baseline summary behavior tests ──────────────

const BASELINE_FIXTURE = {
  capturedAt: 1718000000000,
  rootRef: 'runtime-baseline-root',
  fileCount: 2,
  readableCount: 2,
  missingCount: 0,
  unreadableCount: 0,
  byteTotal: 30,
};

test('v2.8: baseline summary renders all 7 fields including 0-counts, no extra fetch', async () => {
  const { window, document, setFixture, fetchCalls } = setupConsole({ runScripts: 'dangerously' });
  const teamId = 't-baseline';
  const applyId = 'apply-bl';

  await switchToTeamsTab(window, document);

  setupApplyFixtures(setFixture, teamId, applyId, { classification200: true, baseline: BASELINE_FIXTURE });

  await runApplyView(document, teamId, applyId);

  // Baseline element renders.
  const baselineEl = document.getElementById('apply-view-baseline');
  assert.ok(baselineEl, 'baseline element exists');

  // All 7 fields must be present, including 0-value counts.
  assert.ok(baselineEl.innerHTML.includes('2 files'), 'field: fileCount');
  assert.ok(baselineEl.innerHTML.includes('2 readable'), 'field: readableCount');
  assert.ok(baselineEl.innerHTML.includes('0 missing'), 'field: missingCount (0)');
  assert.ok(baselineEl.innerHTML.includes('0 unreadable'), 'field: unreadableCount (0)');
  assert.ok(baselineEl.innerHTML.includes('byteTotal: 30'), 'field: byteTotal');
  assert.ok(baselineEl.innerHTML.includes('capturedAt:'), 'field: capturedAt');
  assert.ok(baselineEl.innerHTML.includes('runtime-baseline-root'), 'field: rootRef');

  // No extra baseline fetch; only manifest + classification + files.
  const fetches = fetchCalls.filter(c => c.path.includes('/apply-requests/'));
  assert.equal(fetches.some(c => c.path.includes('/baseline')), false, 'no baseline endpoint fetch');

  // No entries/sha256/raw content.
  assert.equal(baselineEl.innerHTML.includes('entries'), false, 'no entries');
  assert.equal(baselineEl.innerHTML.includes('sha256'), false, 'no sha256');
  assert.equal(baselineEl.innerHTML.includes('rawContent'), false, 'no rawContent');
});

test('v2.8: malformed baseline summary shows unavailable, does not block classification/files', async () => {
  const { window, document, setFixture } = setupConsole({ runScripts: 'dangerously' });
  const teamId = 't-malformed';
  const applyId = 'apply-mal';

  await switchToTeamsTab(window, document);

  // Malformed: null capturedAt and string counts.
  setupApplyFixtures(setFixture, teamId, applyId, {
    classification200: true,
    baseline: {
      capturedAt: null,          // invalid — will cause RangeError if not guarded
      rootRef: 'runtime-baseline-root',
      fileCount: 'bad',          // not a number
      readableCount: 2,
      missingCount: 0,
      unreadableCount: 0,
      byteTotal: 30,
    },
  });

  await runApplyView(document, teamId, applyId);

  // Malformed baseline shows unavailable (fail-closed, no throw).
  const baselineEl = document.getElementById('apply-view-baseline');
  assert.ok(baselineEl.innerHTML.includes('unavailable'), 'malformed baseline shows unavailable');

  // Classification must still render (NOT blocked by baseline failure).
  const classEl = document.getElementById('apply-view-classification');
  assert.ok(classEl.innerHTML.includes('modified'), 'classification still shows after malformed baseline');

  // Files must still render.
  const filesEl = document.getElementById('apply-view-files');
  assert.ok(filesEl.innerHTML.includes('src/a.ts'), 'files still show after malformed baseline');
});

test('v2.8: absent baselineManifest shows unavailable, classification/files still work', async () => {
  const { window, document, setFixture } = setupConsole({ runScripts: 'dangerously' });
  const teamId = 't-no-bl';
  const applyId = 'apply-nobl';

  await switchToTeamsTab(window, document);

  // baselineManifest NOT in fixture.
  setupApplyFixtures(setFixture, teamId, applyId, { classification200: true });

  await runApplyView(document, teamId, applyId);

  // Baseline unavailable.
  const baselineEl = document.getElementById('apply-view-baseline');
  assert.ok(baselineEl.innerHTML.includes('not captured'), 'shows not captured');

  // Classification still renders.
  const classEl = document.getElementById('apply-view-classification');
  assert.ok(classEl.innerHTML.includes('modified'), 'classification still shows');

  // Files still render.
  const filesEl = document.getElementById('apply-view-files');
  assert.ok(filesEl.innerHTML.includes('src/a.ts'), 'files still show');
});

test('v2.8: rootRef opaque — absolute-looking value sanitized, opaque value displayed', async () => {
  const { window, document, setFixture } = setupConsole({ runScripts: 'dangerously' });

  // ── Opaque rootRef renders normally ───
  await switchToTeamsTab(window, document);
  setupApplyFixtures(setFixture, 't-root1', 'apply-r1', {
    classification200: false,
    baseline: { ...BASELINE_FIXTURE, rootRef: 'runtime-baseline-root' },
  });
  await runApplyView(document, 't-root1', 'apply-r1');
  let bl = document.getElementById('apply-view-baseline');
  assert.ok(bl.innerHTML.includes('runtime-baseline-root'), 'opaque rootRef displayed');

  // ── Absolute-looking rootRef sanitized ───
  // Switch to a new tab render (re-click teams tab).
  await runCommand(document, 'teams');

  setupApplyFixtures(setFixture, 't-root2', 'apply-r2', {
    classification200: false,
    baseline: { ...BASELINE_FIXTURE, rootRef: 'H:\\02-Areas\\project-root' },
  });
  await runApplyView(document, 't-root2', 'apply-r2');
  bl = document.getElementById('apply-view-baseline');
  const blHtml = bl.innerHTML;
  assert.ok(blHtml.includes('root:'), 'root label present');
  assert.equal(blHtml.includes('H:'), false, 'drive letter not in rendered output');
  assert.equal(blHtml.includes('C:'), false, 'drive letter not in rendered output');
  assert.equal(blHtml.includes('02-Areas'), false, 'absolute dir not leaked');
  assert.equal(blHtml.includes('\\\\'), false, 'no raw backslashes leaked');
  // rootRef is sanitized to — placeholder.
  assert.ok(blHtml.includes('root: —') || blHtml.includes('root:&'), 'root placeholder after sanitization');
});

test('v2.8: baseline display is GET-only, preview unchanged, no write controls', async () => {
  const { window, document, setFixture } = setupConsole({ runScripts: 'dangerously' });
  const teamId = 't-baseline3';
  const applyId = 'apply-bl3';

  await switchToTeamsTab(window, document);  setupApplyFixtures(setFixture, teamId, applyId, { classification200: true, baseline: BASELINE_FIXTURE });
  await runApplyView(document, teamId, applyId);

  const baselineEl = document.getElementById('apply-view-baseline');

  // Verify preview still works.
  assert.equal(document.querySelector('.apply-preview-btn'), null, 'preview button must not exist');
  await runApplyPreview(document, 'src/a.ts');

  const previewEl = document.getElementById('apply-view-preview');
  assert.ok(previewEl.textContent.includes('// a content'), 'preview still shows content');

  // No write controls in baseline display.
  assert.equal(baselineEl.innerHTML.includes('/confirm'), false, 'no confirm');
  assert.equal(baselineEl.innerHTML.includes('/discard'), false, 'no discard');
  assert.equal(baselineEl.innerHTML.includes('button'), false, 'no button in baseline');
  assert.equal(/promote|apply-from-preview/i.test(baselineEl.innerHTML), false, 'no promote');
});

// ── v2.8 Contract convergence boundary test ─────────────────────

test('v2.8: baseline viewer boundary — no extra fetch, no forbidden fields, no write paths', async () => {
  const { window, document, setFixture, fetchCalls } = setupConsole({ runScripts: 'dangerously' });
  const teamId = 't-boundary';
  const applyId = 'apply-boundary';

  await switchToTeamsTab(window, document);  setupApplyFixtures(setFixture, teamId, applyId, { classification200: true, baseline: BASELINE_FIXTURE });
  await runApplyView(document, teamId, applyId);

  // 1) No extra baseline endpoint call.
  const fetches = fetchCalls.map(c => c.path);
  assert.equal(fetches.some(p => p.includes('/baseline') && !p.includes('/classification')), false,
    'no standalone /baseline endpoint fetch');

  // 2) All viewer calls are GET.
  const viewerCalls = fetchCalls.filter(c => c.path.includes('/apply-requests/'));
  for (const c of viewerCalls) assert.equal(c.method, 'GET', 'all viewer calls GET');

  // 3) Baseline rendered output — no forbidden fields.
  const bl = document.getElementById('apply-view-baseline').innerHTML;
  for (const banned of ['entries', 'sha256', 'rawContent', 'baselineContent', 'originalContent',
    'diff', 'lineDetail', '/confirm', '/discard']) {
    assert.equal(bl.includes(banned), false, 'baseline output must not contain ' + banned);
  }

  // 4) No button/link/write controls.
  assert.equal(bl.includes('<button'), false, 'no button element in baseline');
  assert.equal(bl.includes('href='), false, 'no href in baseline');
  assert.equal(bl.includes('src='), false, 'no src in baseline');
  assert.equal(bl.includes('onclick='), false, 'no onclick in baseline');

  // 5) rootRef rendered but not as a clickable link.
  assert.ok(bl.includes('runtime-baseline-root'), 'opaque rootRef present');
  assert.equal(bl.includes('file:'), false, 'no file: protocol');

  // 6) Manifest and files still functional.
  assert.ok(document.getElementById('apply-view-manifest').innerHTML.includes(applyId));
  assert.ok(document.getElementById('apply-view-files').innerHTML.includes('src/a.ts'));
});

// ── v2.10 ADR-0015: project-root:<key> display in console ──────

test('v2.10: project-root:<key> rendered as opaque text, not sanitized', async () => {
  const { window, document, setFixture } = setupConsole({ runScripts: 'dangerously' });

  await switchToTeamsTab(window, document);
  setupApplyFixtures(setFixture, 't-proj', 'apply-proj-root', {
    classification200: false,
    baseline: { ...BASELINE_FIXTURE, rootRef: 'project-root:alpha' },
  });
  await runApplyView(document, 't-proj', 'apply-proj-root');

  const bl = document.getElementById('apply-view-baseline').innerHTML;
  // project-root:<key> must appear as opaque text.
  assert.ok(bl.includes('project-root:alpha'), 'project-root:<key> displayed');
  // Must NOT be sanitized to placeholder.
  assert.equal(bl.includes('root: —'), false, 'project-root:<key> not sanitized');

  // Absolute-looking rootRef is still sanitized in the same viewer lifecycle.
  // Switch view and test with absolute-looking rootRef.
  await runCommand(document, 'teams');
  setupApplyFixtures(setFixture, 't-abs', 'apply-abs', {
    classification200: false,
    baseline: { ...BASELINE_FIXTURE, rootRef: 'C:\\Windows\\System32' },
  });
  await runApplyView(document, 't-abs', 'apply-abs');

  const bl2 = document.getElementById('apply-view-baseline').innerHTML;
  assert.equal(bl2.includes('C:'), false, 'absolute rootRef sanitized');
  assert.equal(bl2.includes('Windows'), false, 'absolute path not leaked');
  assert.ok(bl2.includes('root: —') || bl2.includes('root:&'), 'placeholder shown');
});

// ── v2.14 ADR-0019-a: read-only git status console rendering ──────

function setupGitStatusFixtures(setFixture, gitStatusPayload) {
  setFixture('/bridge/metrics', { ok: true, payload: {} });
  setFixture('/bridge/projects', defaultProjectsFixture());
  setFixture('/bridge/projects/cli-bridge', defaultDetailFixture('cli-bridge'));
  setFixture('/bridge/projects/cli-bridge/timeline', { ok: true, payload: { projectId: 'cli-bridge', entries: [] } });
  setFixture('/bridge/projects/cli-bridge/audit', { ok: true, payload: { projectId: 'cli-bridge', total: 0, entries: [] } });
  setFixture('/bridge/projects/cli-bridge/memory', { ok: true, payload: { projectId: 'cli-bridge', entries: [] } });
  setFixture('/bridge/projects/cli-bridge/verification', { ok: true, payload: { projectId: 'cli-bridge', status: 'recorded', records: [] } });
  setFixture('/bridge/projects/cli-bridge/verification/profiles', { ok: true, payload: { profiles: [], selectedProfileId: null, workspaceRootAvailable: true } });
  setFixture('/bridge/projects/cli-bridge/verification/git-status', { ok: true, payload: gitStatusPayload });
}

test('v2.14: verification view renders read-only git status, escaped, GET-only, no write controls', async () => {
  const { document, fetchCalls, setFixture } = setupConsole();
  setupGitStatusFixtures(setFixture, {
    branch: 'feat/<script>', dirty: true, aheadCount: 2, behindCount: 1,
    isGitRepo: true, fetchedAt: 123, available: true,
  });

  document.getElementById('token').value = 'test';
  document.getElementById('connect').click();
  await new Promise(r => setTimeout(r, 200));
  await runCommand(document, 'verify');

  const meta = document.getElementById('git-status-meta');
  assert.ok(meta, 'git-status-meta exists');
  const html = meta.innerHTML;
  assert.ok(html.includes('dirty'), 'shows dirty');
  assert.ok(html.includes('ahead 2'), 'shows ahead count');
  assert.ok(html.includes('behind 1'), 'shows behind count');
  assert.equal(html.includes('<script>'), false, 'branch name must be HTML-escaped');

  const section = document.getElementById('git-status-section');
  assert.equal(section.querySelectorAll('input, textarea').length, 0, 'no free-form input');
  const btnText = [...section.querySelectorAll('button')].map(b => b.textContent || '').join(' ');
  assert.equal(/run|execute|commit|apply|promote|discard/i.test(btnText), false, 'no write/execute control labels');

  const gsCalls = fetchCalls.filter(c => c.path.endsWith('/verification/git-status'));
  assert.ok(gsCalls.length >= 1, 'git status fetched');
  assert.ok(gsCalls.every(c => c.method === 'GET'), 'git status calls are GET-only');
});

test('v2.14: git status renders inert unavailable without throwing', async () => {
  const { document, setFixture } = setupConsole();
  setupGitStatusFixtures(setFixture, { available: false, isGitRepo: false, branch: null, dirty: false, aheadCount: null, behindCount: null, fetchedAt: 1 });

  document.getElementById('token').value = 'test';
  document.getElementById('connect').click();
  await new Promise(r => setTimeout(r, 200));
  await runCommand(document, 'verify');

  const meta = document.getElementById('git-status-meta');
  assert.ok(meta.innerHTML.includes('unavailable'), 'renders inert unavailable');
});

// ── v2.14b ADR-0019-b: GitHub checks console gate (human-triggered) ──

function setupGithubChecksFixtures(setFixture, confirmPayload) {
  setFixture('/bridge/metrics', { ok: true, payload: {} });
  setFixture('/bridge/projects', defaultProjectsFixture());
  setFixture('/bridge/projects/cli-bridge', defaultDetailFixture('cli-bridge'));
  setFixture('/bridge/projects/cli-bridge/timeline', { ok: true, payload: { projectId: 'cli-bridge', entries: [] } });
  setFixture('/bridge/projects/cli-bridge/audit', { ok: true, payload: { projectId: 'cli-bridge', total: 0, entries: [] } });
  setFixture('/bridge/projects/cli-bridge/memory', { ok: true, payload: { projectId: 'cli-bridge', entries: [] } });
  setFixture('/bridge/projects/cli-bridge/verification', { ok: true, payload: { projectId: 'cli-bridge', status: 'recorded', records: [] } });
  setFixture('/bridge/projects/cli-bridge/verification/profiles', { ok: true, payload: { profiles: [], selectedProfileId: null, workspaceRootAvailable: true } });
  setFixture('/bridge/projects/cli-bridge/verification/git-status', { ok: true, payload: { available: false, isGitRepo: false, branch: null, dirty: false, aheadCount: null, behindCount: null, fetchedAt: 1 } });
  setFixture('/bridge/projects/cli-bridge/verification/github-checks/confirm', { ok: true, payload: confirmPayload });
}

test('v2.14b: github checks gate is human-triggered (no auto-fire) and renders inert result', async () => {
  const { document, fetchCalls, setFixture } = setupConsole();
  setupGithubChecksFixtures(setFixture, {
    profileId: 'github-checks', commandLabel: 'github-checks', result: 'passed',
    recordedAt: 1, elapsedMs: 12, truncated: false, outputDiscarded: true,
    hostDisclosure: 'read-only network call to https://api.github.com using a stored credential',
  });

  document.getElementById('token').value = 'test';
  document.getElementById('connect').click();
  await new Promise(r => setTimeout(r, 200));
  await runCommand(document, 'verify');

  // Must NOT auto-fire the credentialed call on view load.
  let ghCalls = fetchCalls.filter(c => c.path.endsWith('/verification/github-checks/confirm'));
  assert.equal(ghCalls.length, 0, 'credentialed call must not fire before explicit click');

  // No free-form input / no write-execute controls in the section.
  const section = document.getElementById('github-checks-section');
  assert.ok(section, 'github-checks-section exists');
  assert.equal(section.querySelectorAll('input, textarea').length, 0, 'no free-form input');
  const btnText = [...section.querySelectorAll('button')].map(b => b.textContent || '').join(' ');
  assert.equal(/\b(run|execute|commit|apply|promote|discard)\b/i.test(btnText), false, 'no write/execute control labels');

  // Explicit composer command triggers exactly one POST.
  await runCommand(document, 'fetch checks');
  await new Promise(r => setTimeout(r, 200));

  ghCalls = fetchCalls.filter(c => c.path.endsWith('/verification/github-checks/confirm'));
  assert.equal(ghCalls.length, 1, 'one call after click');
  assert.equal(ghCalls[0].method, 'POST', 'confirm is POST');

  const meta = document.getElementById('github-checks-meta').innerHTML;
  assert.ok(meta.includes('passed'), 'renders typed result');
  assert.equal(meta.includes('ghp_'), false, 'no token in DOM');
});

// ── v2.15 ADR-0020: Verification run history console tests ─────

function verificationFixtureWithRunHistory(runs) {
  return {
    ok: true,
    payload: {
      projectId: 'cli-bridge',
      status: 'recorded',
      summary: { evidenceCount: runs.length, doneStepCount: 1, totalStepCount: 2, resultCounts: { passed: 1, failed: 0, skipped: 0, errored: 0, unknown: 0 } },
      records: [],
      liveRunRecords: runs ?? [],
    },
  };
}

function defaultRunHistoryFixtures(setFixture) {
  setFixture('/bridge/metrics', { ok: true, payload: {} });
  setFixture('/bridge/projects', defaultProjectsFixture());
  setFixture('/bridge/projects/cli-bridge', defaultDetailFixture('cli-bridge'));
  setFixture('/bridge/projects/cli-bridge/timeline', { ok: true, payload: { projectId: 'cli-bridge', entries: [] } });
  setFixture('/bridge/projects/cli-bridge/audit', { ok: true, payload: { projectId: 'cli-bridge', total: 0, entries: [] } });
  setFixture('/bridge/projects/cli-bridge/memory', { ok: true, payload: { projectId: 'cli-bridge', entries: [] } });
}

test('v2.15: verification view renders run history', async () => {
  const { document, setFixture } = setupConsole();
  defaultRunHistoryFixtures(setFixture);
  setFixture('/bridge/projects/cli-bridge/verification', verificationFixtureWithRunHistory([
    { projectKey: 'cli-bridge', profileId: 'ut', commandLabel: 'Unit Tests', result: 'passed', recordedAt: 1718000000000, elapsedMs: 142, truncated: false, outputDiscarded: true },
    { projectKey: 'cli-bridge', profileId: 'gh', commandLabel: 'github-checks', result: 'failed', recordedAt: 1718000001000, elapsedMs: 342, truncated: true, outputDiscarded: true },
  ]));
  document.getElementById('token').value = 'test';
  document.getElementById('connect').click();
  await new Promise(r => setTimeout(r, 200));
  await runCommand(document, 'verify');
  const section = document.getElementById('history-section');
  assert.ok(section, 'history-section exists');
  const html = section.innerHTML;
  assert.ok(html.includes('Unit Tests'), 'command label rendered');
  assert.ok(html.includes('github-checks'), 'github-checks label rendered');
  assert.ok(html.includes('passed'), 'passed result');
  assert.ok(html.includes('failed'), 'failed result');
  assert.ok(html.includes('142ms'), 'elapsed');
  assert.ok(html.includes('[truncated]'), 'truncated flag');
  assert.ok(html.includes('[discarded]'), 'discarded flag');
  for (const banned of ['stdout', 'stderr', 'token', 'sha256', 'Bearer', 'owner', 'repo', 'ref', 'remote']) {
    assert.equal(html.includes(banned), false, 'must not contain ' + banned);
  }
  const sectionButtons = section.querySelectorAll('button');
  assert.equal(sectionButtons.length, 0, 'no buttons in history section');
});

test('v2.15: command label is HTML-escaped', async () => {
  const { document, setFixture } = setupConsole();
  defaultRunHistoryFixtures(setFixture);
  setFixture('/bridge/projects/cli-bridge/verification', verificationFixtureWithRunHistory([
    { projectKey: 'cli-bridge', profileId: 'xss', commandLabel: '<script>alert(1)</script>', result: 'passed', recordedAt: 1718000000000, elapsedMs: 100, truncated: false, outputDiscarded: true },
  ]));
  document.getElementById('token').value = 'test';
  document.getElementById('connect').click();
  await new Promise(r => setTimeout(r, 200));
  await runCommand(document, 'verify');
  const html = document.getElementById('history-section').innerHTML;
  assert.equal(html.includes('<script>'), false, 'script tag escaped');
  assert.ok(html.includes('&lt;script&gt;'), 'escaped script present');
});

test('v2.15: empty liveRunRecords renders no records', async () => {
  const { document, setFixture } = setupConsole();
  defaultRunHistoryFixtures(setFixture);
  setFixture('/bridge/projects/cli-bridge/verification', verificationFixtureWithRunHistory([]));
  document.getElementById('token').value = 'test';
  document.getElementById('connect').click();
  await new Promise(r => setTimeout(r, 200));
  await runCommand(document, 'verify');
  const html = document.getElementById('history-section').innerHTML;
  assert.ok(html.includes('no records'), 'empty message');
});

test('v2.15: missing liveRunRecords renders no records', async () => {
  const { document, setFixture } = setupConsole();
  defaultRunHistoryFixtures(setFixture);
  setFixture('/bridge/projects/cli-bridge/verification', { ok: true, payload: { projectId: 'cli-bridge', status: 'recorded', records: [] } });
  document.getElementById('token').value = 'test';
  document.getElementById('connect').click();
  await new Promise(r => setTimeout(r, 200));
  await runCommand(document, 'verify');
  const html = document.getElementById('history-section').innerHTML;
  assert.ok(html.includes('no records'), 'missing message');
});

test('v2.15: capped at 20 newest first', async () => {
  const { document, setFixture } = setupConsole();
  defaultRunHistoryFixtures(setFixture);
  const runs = [];
  for (let i = 0; i < 25; i++) runs.push({ projectKey: 'cli-bridge', profileId: 'p' + i, commandLabel: 'Test ' + i, result: 'passed', recordedAt: 1718000000000 + i * 1000, elapsedMs: 10 + i, truncated: false, outputDiscarded: true });
  setFixture('/bridge/projects/cli-bridge/verification', verificationFixtureWithRunHistory(runs));
  document.getElementById('token').value = 'test';
  document.getElementById('connect').click();
  await new Promise(r => setTimeout(r, 200));
  await runCommand(document, 'verify');
  const html = document.getElementById('history-section').innerHTML;
  assert.ok(html.includes('showing latest 20 of 25'), 'capped message');
  assert.ok(html.indexOf('Test 24') < html.indexOf('Test 5'), 'newest first');
  assert.equal(html.includes('Test 0'), false, 'oldest hidden');
});

test('v2.15: extra sensitive fields not in DOM', async () => {
  const { document, setFixture } = setupConsole();
  defaultRunHistoryFixtures(setFixture);
  setFixture('/bridge/projects/cli-bridge/verification', verificationFixtureWithRunHistory([{
    projectKey: 'cli-bridge', profileId: 's', commandLabel: 'Safe', result: 'passed', recordedAt: 1718000000000, elapsedMs: 100, truncated: false, outputDiscarded: true,
    token: 'ghp_SECRET', rawOutput: 'x', cwd: '/tmp', branch: 'b', owner: 'o', repo: 'r',
  }]));
  document.getElementById('token').value = 'test';
  document.getElementById('connect').click();
  await new Promise(r => setTimeout(r, 200));
  await runCommand(document, 'verify');
  const html = document.getElementById('history-section').innerHTML;
  assert.ok(html.includes('Safe'), 'safe label');
  for (const banned of ['ghp_SECRET', 'rawOutput', '/tmp', 'owner', 'repo']) {
    assert.equal(html.includes(banned), false, 'must not leak ' + banned);
  }
});

test('v2.15: no extra fetch beyond existing calls', async () => {
  const { document, fetchCalls, setFixture } = setupConsole();
  defaultRunHistoryFixtures(setFixture);
  setFixture('/bridge/projects/cli-bridge/verification', verificationFixtureWithRunHistory([
    { projectKey: 'cli-bridge', profileId: 'ut', commandLabel: 'UT', result: 'passed', recordedAt: 1718000000000, elapsedMs: 10, truncated: false, outputDiscarded: true },
  ]));
  document.getElementById('token').value = 'test';
  document.getElementById('connect').click();
  await new Promise(r => setTimeout(r, 200));
  const before = fetchCalls.length;
  await runCommand(document, 'verify');
  const urls = fetchCalls.slice(before).map(c => c.path);
  const unexpected = urls.filter(u => !u.endsWith('/verification') && !u.endsWith('/verification/profiles') && !u.endsWith('/verification/git-status'));
  assert.equal(unexpected.length, 0, 'no unexpected fetch: ' + unexpected.join(','));
});

// ── v2.16 ADR-0021: Per-step verification result indicator tests ─

function goalWithSteps(key, steps) {
  return {
    ok: true,
    payload: {
      project: { key, label: 'Test', createdAt: 1 },
      summary: { project: { key, label: 'Test' }, goalCount: 1, activeGoalCount: 1, reviewCount: 0, promptCount: 0, status: 'active' },
      goals: [{
        goal: { id: 'g', description: 'Test Goal', status: 'executing', sessionId: 's', createdAt: 1, updatedAt: 1 },
        plan: { id: 'gp', status: 'executing', goalId: 'g', steps: steps || [
          { index: 1, id: 's1', intent: 'Step 1', kind: 'code', tier: 'core', status: 'done', isStateMutating: false },
        ] },
      }],
      reviews: [], pendingPrompts: [], auditEvents: [],
      status: { progress: null, activeGoal: { id: 'g', description: 'Test Goal', status: 'executing' }, goalsSummary: [], blockedGate: null, latestAudit: null, memory: [] },
    },
  };
}

function verificationFixtureWithRecords(records) {
  return {
    ok: true,
    payload: {
      projectId: 'cli-bridge',
      status: 'recorded',
      records: records || [],
      liveRunRecords: [],
    },
  };
}

test('v2.16: step with matching enum record renders typed pill', async () => {
  const { document, setFixture } = setupConsole();
  setFixture('/bridge/metrics', { ok: true, payload: {} });
  setFixture('/bridge/projects', defaultProjectsFixture());
  setFixture('/bridge/projects/cli-bridge', goalWithSteps('cli-bridge'));
  setFixture('/bridge/projects/cli-bridge/verification', verificationFixtureWithRecords([
    { stepId: 's1', result: 'passed', createdAt: 1000 },
  ]));
  document.getElementById('token').value = 'test';
  document.getElementById('connect').click();
  await new Promise(r => setTimeout(r, 200));
  const goalEl = document.getElementById('goal-content');
  assert.ok(goalEl.innerHTML.includes('passed'), 'passed pill rendered');
  assert.ok(goalEl.innerHTML.includes('Step 1'), 'step intent rendered');
});

test('v2.16: step with no matching record renders dash', async () => {
  const { document, setFixture } = setupConsole();
  setFixture('/bridge/metrics', { ok: true, payload: {} });
  setFixture('/bridge/projects', defaultProjectsFixture());
  setFixture('/bridge/projects/cli-bridge', goalWithSteps('cli-bridge'));
  setFixture('/bridge/projects/cli-bridge/verification', verificationFixtureWithRecords([]));
  document.getElementById('token').value = 'test';
  document.getElementById('connect').click();
  await new Promise(r => setTimeout(r, 200));
  const goalEl = document.getElementById('goal-content');
  assert.ok(goalEl.innerHTML.includes('\u2014'), 'dash rendered for no match');
});

test('v2.16: non-enum result renders dash, not displayed', async () => {
  const { document, setFixture } = setupConsole();
  setFixture('/bridge/metrics', { ok: true, payload: {} });
  setFixture('/bridge/projects', defaultProjectsFixture());
  setFixture('/bridge/projects/cli-bridge', goalWithSteps('cli-bridge'));
  setFixture('/bridge/projects/cli-bridge/verification', verificationFixtureWithRecords([
    { stepId: 's1', result: 'weird', createdAt: 1000 },
  ]));
  document.getElementById('token').value = 'test';
  document.getElementById('connect').click();
  await new Promise(r => setTimeout(r, 200));
  const goalEl = document.getElementById('goal-content');
  assert.equal(goalEl.innerHTML.includes('weird'), false, 'non-enum result not rendered');
  assert.ok(goalEl.innerHTML.includes('\u2014'), 'dash rendered');
});

test('v2.16: multiple records pick greatest createdAt', async () => {
  const { document, setFixture } = setupConsole();
  setFixture('/bridge/metrics', { ok: true, payload: {} });
  setFixture('/bridge/projects', defaultProjectsFixture());
  setFixture('/bridge/projects/cli-bridge', goalWithSteps('cli-bridge'));
  setFixture('/bridge/projects/cli-bridge/verification', verificationFixtureWithRecords([
    { stepId: 's1', result: 'unknown', createdAt: 100 },
    { stepId: 's1', result: 'passed', createdAt: 200 },
    { stepId: 's1', result: 'failed', createdAt: 300 },
  ]));
  document.getElementById('token').value = 'test';
  document.getElementById('connect').click();
  await new Promise(r => setTimeout(r, 200));
  const goalEl = document.getElementById('goal-content');
  assert.ok(goalEl.innerHTML.includes('failed'), 'newest record (failed) selected');
  assert.equal(goalEl.innerHTML.includes('passed'), false, 'older passed not selected');
});

test('v2.16: tied createdAt picks earlier array order', async () => {
  const { document, setFixture } = setupConsole();
  setFixture('/bridge/metrics', { ok: true, payload: {} });
  setFixture('/bridge/projects', defaultProjectsFixture());
  setFixture('/bridge/projects/cli-bridge', goalWithSteps('cli-bridge'));
  setFixture('/bridge/projects/cli-bridge/verification', verificationFixtureWithRecords([
    { stepId: 's1', result: 'passed', createdAt: 100 },
    { stepId: 's1', result: 'failed', createdAt: 100 },
  ]));
  document.getElementById('token').value = 'test';
  document.getElementById('connect').click();
  await new Promise(r => setTimeout(r, 200));
  const goalEl = document.getElementById('goal-content');
  assert.ok(goalEl.innerHTML.includes('passed'), 'first in array (passed) selected on tie');
  assert.equal(goalEl.innerHTML.includes('failed'), false, 'second record not selected');
});

test('v2.16: no raw notes/output/token/identity in step row', async () => {
  const { document, setFixture } = setupConsole();
  setFixture('/bridge/metrics', { ok: true, payload: {} });
  setFixture('/bridge/projects', defaultProjectsFixture());
  setFixture('/bridge/projects/cli-bridge', goalWithSteps('cli-bridge'));
  setFixture('/bridge/projects/cli-bridge/verification', verificationFixtureWithRecords([{
    stepId: 's1', result: 'passed', createdAt: 100,
    notes: 'secret notes', rawOutput: 'x', token: 't', branch: 'b', owner: 'o', repo: 'r',
  }]));
  document.getElementById('token').value = 'test';
  document.getElementById('connect').click();
  await new Promise(r => setTimeout(r, 200));
  const stepHtml = document.getElementById('goal-content').innerHTML;
  assert.ok(stepHtml.includes('passed'), 'result rendered');
  for (const banned of ['secret', 'rawOutput', 'token', 'branch', 'owner', 'repo']) {
    assert.equal(stepHtml.includes(banned), false, 'must not contain ' + banned);
  }
});

test('v2.16: verify column has no write controls, no extra fetch', async () => {
  const { document, fetchCalls, setFixture } = setupConsole();
  setFixture('/bridge/metrics', { ok: true, payload: {} });
  setFixture('/bridge/projects', defaultProjectsFixture());
  setFixture('/bridge/projects/cli-bridge', goalWithSteps('cli-bridge'));
  setFixture('/bridge/projects/cli-bridge/verification', verificationFixtureWithRecords([
    { stepId: 's1', result: 'passed', createdAt: 100 },
  ]));
  document.getElementById('token').value = 'test';
  document.getElementById('connect').click();
  await new Promise(r => setTimeout(r, 200));
  const before = fetchCalls.length;
  // Re-render through the command composer.
  await runCommand(document, 'status');
  const urls = fetchCalls.slice(before);
  // Only expected: detail fetch for project switch. No extra verification/profiles/git-status fetch.
  assert.ok(urls.length <= 2, 'at most existing fetches');
  // Verify column has no buttons/links/inputs
  const goalEl = document.getElementById('goal-content');
  const cells = goalEl.querySelectorAll('td');
  var ok = true;
  cells.forEach(function(td) { if (td.querySelector('button,a,input,textarea')) ok = false; });
  assert.ok(ok, 'verify column has no controls');
});

// ═══════════════════════════════════════════════════════════════════
// RP-2.19  Console pairing-token discipline (localStorage convenience)
// ═══════════════════════════════════════════════════════════════════
//
// Self-contained jsdom setup: seeds localStorage BEFORE scripts run (via
// beforeParse) and captures the raw fetch url + headers so we can assert the
// token is sent only in the pairing header — never in a request URL/query,
// never as visible DOM text — and that manual entry remains the default.

const RP219_TOKEN = 'TOKxyz123SECRETvalue';

function setupConsoleRp219(seed = {}) {
  const html = renderProjectConsoleHtml();
  const calls = [];
  const storage = { ...seed };
  const storageApi = {
    getItem: (k) => (k in storage ? storage[k] : null),
    setItem: (k, v) => { storage[k] = String(v); },
    removeItem: (k) => { delete storage[k]; },
  };
  const dom = new JSDOM(html, {
    url: 'http://localhost:9300/console/project',
    runScripts: 'dangerously',
    resources: 'usable',
    beforeParse(win) {
      Object.defineProperty(win, 'localStorage', {
        value: storageApi,
        configurable: true,
        writable: true,
      });
      win.fetch = async (url, init = {}) => {
        calls.push({ url: String(url), headers: init.headers || {}, method: init.method || 'GET' });
        return { ok: true, status: 200, json: async () => ({}) };
      };
    },
  });
  return { window: dom.window, document: dom.window.document, calls, storage };
}

test('RP-2.19: stored pairing token does not pre-fill and unpaired send only shows inline guidance', () => {
  const { document, calls } = setupConsoleRp219({ 'cli-bridge-pairing-token': RP219_TOKEN });
  assert.equal(document.getElementById('token').value, '');
  // Manual entry contract: not connected until the operator clicks Connect.
  assert.equal(document.getElementById('conn-status').textContent || '', '');
  assert.equal(document.getElementById('command-send').disabled, false);

  document.getElementById('command-input').value = 'fix README';
  document.getElementById('command-send').click();

  assert.equal(document.getElementById('command-status').textContent, 'connect required');
  assert.match(document.getElementById('command-log').textContent, /Connect with the pairing token first/);
  assert.equal(calls.some((c) => c.url.includes('/bridge/goals')), false);
});

test('RP-2.19: connect keeps token in memory and sends it only in the pairing header', async () => {
  const { document, calls, storage } = setupConsoleRp219();
  document.getElementById('token').value = RP219_TOKEN;
  document.getElementById('connect').dispatchEvent(new (document.defaultView.MouseEvent)('click'));

  await waitFor(() => document.getElementById('conn-dot').classList.contains('ok'));
  assert.equal(document.getElementById('conn-status').textContent || '', '');
  assert.equal(document.getElementById('token').value, '');

  // Pairing token must not be persisted to localStorage.
  assert.equal(storage['cli-bridge-pairing-token'], undefined);

  // The metrics call carried the token in the pairing header.
  const metrics = calls.find((c) => c.url.includes('/bridge/metrics'));
  assert.ok(metrics, 'expected a /bridge/metrics request');
  assert.equal(metrics.headers['x-cli-bridge-pairing-token'], RP219_TOKEN);

  // The token must never appear in any request URL/query.
  for (const c of calls) {
    assert.ok(!c.url.includes(RP219_TOKEN), `token leaked into URL: ${c.url}`);
  }

  // The token must never be rendered as visible DOM text.
  assert.ok(!document.body.textContent.includes(RP219_TOKEN));
});

test('pairing button opens visible pairing controls before connection', async () => {
  const { document, fetchCalls } = setupConsole();

  document.getElementById('composer-pairing').click();

  await waitFor(() => document.getElementById('conversation-pairing-context'));
  assert.match(document.getElementById('conversation-pairing-context').textContent, /Conversation Pairing/);
  assert.match(document.getElementById('conversation-pairing-context').textContent, /Connect with the pairing token first/);
  assert.equal(document.getElementById('command-status').textContent, 'connect required for pairing');
  assert.equal(fetchCalls.some((call) => call.path.includes('/team-preset')), false);
});

test('pairing UI saves conversation pairing to new endpoint', async () => {
  const { document, fetchCalls, setFixture } = setupConsole();
  setFixture('/bridge/endpoints', {
    ok: true,
    payload: {
      endpoints: [
        {
          id: 'chatgpt-web',
          label: 'ChatGPT Web',
          transport: 'web-dom',
          status: 'online',
          capabilities: { canAcceptPrompt: true, canReturnOutput: true, canReview: false, canExecute: false, canSummarize: false },
        },
        {
          id: 'claude-code-command',
          label: 'Claude Code Review',
          transport: 'command',
          status: 'online',
          capabilities: { canReview: true, canExecute: false, canAcceptPrompt: false, canReturnOutput: true, canSummarize: false },
        },
        {
          id: 'workbuddy',
          label: 'WorkBuddy Executor',
          transport: 'workbuddy',
          status: 'online',
          capabilities: { canReview: true, canExecute: true, canAcceptPrompt: true, canReturnOutput: true, canSummarize: false },
        },
      ],
    },
  });
  setFixture('/bridge/projects/cli-bridge/conversation-pairing', {
    ok: true,
    payload: { pairing: null },
  });

  document.getElementById('token').value = 'test';
  document.getElementById('connect').click();
  await waitFor(() => document.getElementById('conn-dot').classList.contains('ok'));

  document.getElementById('composer-pairing').click();
  await waitFor(() => document.getElementById('pairing-save'));
  document.getElementById('conversation-source').value = 'chatgpt-web';
  document.getElementById('conversation-target').value = 'workbuddy';

  setFixture('/bridge/projects/cli-bridge/conversation-pairing', {
    ok: true,
    payload: {
      pairing: {
        projectId: 'cli-bridge',
        sourceEndpointId: 'chatgpt-web',
        targetEndpointId: 'workbuddy',
        targetRouteKind: 'workbuddy-execution',
        status: 'ready',
        scope: 'project',
        updatedAt: 1,
      },
    },
  });
  document.getElementById('pairing-save').click();

  await waitFor(() => document.getElementById('command-status').textContent === 'pairing saved');
  const saveCall = fetchCalls.find((call) => call.path === '/bridge/projects/cli-bridge/conversation-pairing' && call.method === 'PUT');
  assert.ok(saveCall, 'expected PUT /conversation-pairing');
  assert.deepEqual(saveCall.body, {
    sourceEndpointId: 'chatgpt-web',
    targetEndpointId: 'workbuddy',
  });
  assert.match(document.getElementById('fact-pairing').textContent, /chatgpt-web/);
  assert.match(document.getElementById('fact-pairing').textContent, /workbuddy/);
  assert.equal(document.getElementById('composer-mode-toggle').textContent, 'Conversation');
  assert.equal(document.getElementById('conversation-pairing-context'), null);
  assert.match(document.getElementById('conversation-transcript').textContent, /No conversation messages yet/);
});

test('clicking active project exits pairing context back to conversation main view', async () => {
  const { document, setFixture } = setupConsole();
  setFixture('/bridge/projects', defaultProjectsFixture());
  setFixture('/bridge/projects/cli-bridge', defaultDetailFixture('cli-bridge'));
  setFixture('/bridge/endpoints', {
    ok: true,
    payload: { endpoints: [] },
  });
  setFixture('/bridge/projects/cli-bridge/conversation-pairing', {
    ok: true,
    payload: { pairing: null },
  });

  document.getElementById('token').value = 'test';
  document.getElementById('connect').click();
  await waitFor(() => document.getElementById('conn-dot').classList.contains('ok'));

  document.getElementById('composer-pairing').click();
  await waitFor(() => document.getElementById('conversation-pairing-context'));

  document.querySelector('[data-key="cli-bridge"]').click();

  await waitFor(() => document.getElementById('conversation-pairing-context') === null);
  assert.equal(document.getElementById('composer-mode-toggle').textContent, 'Conversation');
  assert.match(document.getElementById('conversation-transcript').textContent, /No conversation messages yet/);
});

// ── ADR-0025 Task 3: auto-pair token discipline ──

test('local auto-pair bootstrap does not expose raw token in URL, visible DOM, or localStorage', () => {
  const html = renderProjectConsoleHtml({ extensionClaimNonce: 'claim-abc' });
  const storage = {};
  const dom = new JSDOM(html, {
    url: 'http://127.0.0.1:31337/console/project',
    runScripts: 'dangerously',
    resources: 'usable',
    beforeParse(win) {
      Object.defineProperty(win, 'localStorage', {
        value: {
          getItem: key => storage[key] ?? null,
          setItem: (key, value) => { storage[key] = value; },
          removeItem: key => { delete storage[key]; },
        },
        configurable: true,
      });
      win.fetch = async (url, init = {}) => {
        const path = new URL(String(url)).pathname;
        if (path === '/health/private') {
          return { ok: true, status: 200, json: async () => ({ ok: true }) };
        }
        return { ok: true, status: 200, json: async () => ({}) };
      };
    },
  });

  assert.equal(dom.window.location.href.includes('claim-abc'), false);
  assert.equal(dom.window.document.body.textContent.includes('claim-abc'), false);
  assert.equal(storage['cli-bridge-pairing-token'], undefined);
  assert.ok(dom.window.document.querySelector('[data-extension-claim-nonce="claim-abc"]'));
});

test('console revoke calls local auto-pair revoke without exposing token', async () => {
  const html = renderProjectConsoleHtml({ extensionClaimNonce: 'claim-abc' });
  const calls = [];
  const dom = new JSDOM(html, {
    url: 'http://127.0.0.1:31337/console/project',
    runScripts: 'dangerously',
    resources: 'usable',
    beforeParse(win) {
      Object.defineProperty(win, 'localStorage', {
        value: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
        configurable: true,
      });
      win.fetch = async (url, init = {}) => {
        const path = new URL(String(url)).pathname;
        calls.push({ path, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null });
        return { ok: true, status: 200, json: async () => ({ ok: true }) };
      };
    },
  });

  dom.window.document.getElementById('revoke-local-session').click();
  await waitFor(() => calls.some(c => c.path === '/bridge/local-auto-pair/revoke'));
  assert.equal(JSON.stringify(calls).includes('claim-abc'), false);
});

// ── ADR-0025 Task 5: source-level safety scan ──

test('local auto-pairing does not add URL token parsing or localStorage token storage', () => {
  const consoleSource = readFileSync(
    resolve(process.cwd(), 'apps/local-server/src/routes/project-console.ts'),
    'utf8',
  );
  // No URL-based token transport
  assert.equal(consoleSource.includes('location.hash'), false);
  assert.equal(consoleSource.includes('URLSearchParams(location.search)'), false);
  // No localStorage persistence of pairing credentials (the header name
  // 'x-cli-bridge-pairing-token' is expected; the dangerous pattern is
  // using it as a localStorage key).
  assert.equal(consoleSource.includes("localStorage.setItem('cli-bridge-pairing-token'"), false);
  assert.equal(consoleSource.includes("localStorage.getItem('cli-bridge-pairing-token'"), false);
});
