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
