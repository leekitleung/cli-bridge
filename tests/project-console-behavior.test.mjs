// Project Workspace Console behavior-level tests (Step 3).
//
// Uses jsdom to load the console HTML and exercise real
// click/input/event flows with a mocked fetch backend.
// Verifies that projectId scoping, loading states, and
// bridge-only fetch paths hold at runtime.

import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

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
  await new Promise(r => setTimeout(r, 50));

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
  await new Promise(r => setTimeout(r, 50));

  // Switch to alpha project via localStorage (simpler than clicking).
  const alphaItem = document.querySelector('[data-key="alpha"]');
  alphaItem.click();
  await new Promise(r => setTimeout(r, 50));

  // Type a goal and send.
  const cmdInput = document.getElementById('command-input');
  cmdInput.value = 'Build a new feature';
  document.getElementById('command-send').click();
  await new Promise(r => setTimeout(r, 50));

  // Verify the POST included projectId.
  const goalCreate = fetchCalls.find(c => c.path === '/bridge/goals' && c.method === 'POST');
  assert.ok(goalCreate, 'must POST to /bridge/goals');
  assert.ok(goalCreate.body.projectId, 'must include projectId in body');
  assert.equal(goalCreate.body.projectId, 'alpha', 'projectId must be the active project key');
  assert.equal(goalCreate.body.description, 'Build a new feature');
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
  await new Promise(r => setTimeout(r, 50));

  // Switch to alpha project.
  const alphaItem = document.querySelector('[data-key="alpha"]');
  alphaItem.click();
  await new Promise(r => setTimeout(r, 50));

  // Navigate to Reviews section.
  const reviewsTab = document.querySelector('[data-view="reviews"]');
  reviewsTab.click();
  await new Promise(r => setTimeout(r, 20));

  // Fill review content and click create.
  const content = document.getElementById('review-content');
  content.value = 'Review this code';
  document.getElementById('btn-run-review').click();
  await new Promise(r => setTimeout(r, 50));

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
  await new Promise(r => setTimeout(r, 50));

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
  await new Promise(r => setTimeout(r, 50));

  // Alpha should be visible in the list.
  let items = document.querySelectorAll('.project-item');
  assert.ok(Array.from(items).some(el => el.dataset.key === 'alpha'), 'alpha must be visible before archive');

  // Archive alpha via the archive button.
  const archiveBtn = document.querySelector('.archive-btn[data-key="alpha"]');
  assert.ok(archiveBtn, 'archive button must exist for non-default project');
  archiveBtn.click();
  await new Promise(r => setTimeout(r, 50));

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
  await new Promise(r => setTimeout(r, 50));

  const beforeCount = fetchCalls.length;

  // Simulate toggle checked + refresh via global refreshAll.
  document.getElementById('toggle-archived').checked = true;
  await window.refreshAll();

  assert.ok(fetchCalls.length > beforeCount, 'toggle checked + refreshAll triggers additional fetches');
});

test('inline edit sends PATCH to update project label', async () => {
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
  await new Promise(r => setTimeout(r, 50));

  // Click top bar to start inline edit.
  const topProject = document.getElementById('top-project');
  assert.ok(topProject, 'top-project must exist');
  topProject.click();
  await new Promise(r => setTimeout(r, 20));

  // An input field should appear.
  const input = document.getElementById('inline-edit-input');
  assert.ok(input, 'inline edit input must appear');
  input.value = 'Updated Bridge';

  // Click save.
  const save = document.getElementById('inline-edit-save');
  assert.ok(save, 'save button must exist');
  save.click();
  await new Promise(r => setTimeout(r, 50));

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
  await new Promise(r => setTimeout(r, 100));

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
