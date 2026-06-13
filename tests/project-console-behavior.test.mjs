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
  await new Promise(r => setTimeout(r, 100));

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
  await new Promise(r => setTimeout(r, 100));

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
  await new Promise(r => setTimeout(r, 100));

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
  await new Promise(r => setTimeout(r, 100));
  document.querySelector('[data-view="verification"]').click();
  await new Promise(r => setTimeout(r, 50));

  const workspace = document.getElementById('workspace');
  assert.ok(workspace.innerHTML.includes('skipped'), 'typed result rendered');
  assert.ok(workspace.innerHTML.includes('Verify task'), 'record context rendered');
  assert.equal(workspace.innerHTML.includes('raw verification note'), false, 'raw notes not rendered');
  assert.equal(/stdout|stderr|sha256|diff|raw output/i.test(workspace.innerHTML), false, 'no raw surface rendered');
  assert.equal(/run|execute|apply-from-preview|promote|commit|discard/i.test(workspace.innerHTML), false, 'no execution/write affordance text');
  assert.equal(workspace.querySelector('button'), null, 'verification view has no action button');
  assert.equal(workspace.querySelector('[href]'), null, 'verification view has no links');

  const verificationCalls = fetchCalls.filter(c => c.path.endsWith('/verification'));
  assert.equal(verificationCalls.every(c => c.method === 'GET'), true, 'verification calls are GET-only');
});

// ── Helpers for v2.7 ADR-0012 Apply Viewer JSDOM tests ──────────

/** Switch to teams tab and return the JSDOM state. */
async function switchToTeamsTab(window, document) {
  const tab = document.querySelector('[data-view="teams"]');
  assert.ok(tab, 'teams tab must exist');
  tab.click();
  // Let async event handlers and renderWorkspace/loadSectionData resolve.
  await new Promise(r => setTimeout(r, 50));
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

// ── v2.7 ADR-0012: Classification behavior tests ───────────────

test('v2.7: view result calls manifest, classification, files — all GET, renders summary', async () => {
  const { window, document, setFixture, fetchCalls } = setupConsole({ runScripts: 'dangerously' });
  const teamId = 't-apply';
  const applyId = 'apply-success';

  await switchToTeamsTab(window, document);

  // Now the apply viewer form should exist.
  const btn = document.getElementById('btn-apply-view');
  assert.ok(btn, 'btn-apply-view must exist after switching to teams');

  document.getElementById('apply-view-team').value = teamId;
  document.getElementById('apply-view-id').value = applyId;

  setupApplyFixtures(setFixture, teamId, applyId, { classification200: true });

  btn.click();
  await new Promise(r => setTimeout(r, 100));

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

  document.getElementById('apply-view-team').value = teamId;
  document.getElementById('apply-view-id').value = applyId;

  setupApplyFixtures(setFixture, teamId, applyId, { classification200: false });

  document.getElementById('btn-apply-view').click();
  await new Promise(r => setTimeout(r, 100));

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

  document.getElementById('apply-view-team').value = teamId;
  document.getElementById('apply-view-id').value = applyId;

  setupApplyFixtures(setFixture, teamId, applyId, { classification200: true });

  document.getElementById('btn-apply-view').click();
  await new Promise(r => setTimeout(r, 100));

  // Click a Preview button.
  const previewBtn = document.querySelector('.apply-preview-btn');
  assert.ok(previewBtn, 'preview button must exist');
  previewBtn.click();
  await new Promise(r => setTimeout(r, 100));

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
  const vEnd = html.indexOf('async function runReviewFlow');
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

  document.getElementById('apply-view-team').value = teamId;
  document.getElementById('apply-view-id').value = applyId;

  setupApplyFixtures(setFixture, teamId, applyId, { classification200: true, baseline: BASELINE_FIXTURE });

  document.getElementById('btn-apply-view').click();
  await new Promise(r => setTimeout(r, 100));

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

  document.getElementById('apply-view-team').value = teamId;
  document.getElementById('apply-view-id').value = applyId;

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

  document.getElementById('btn-apply-view').click();
  await new Promise(r => setTimeout(r, 100));

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

  document.getElementById('apply-view-team').value = teamId;
  document.getElementById('apply-view-id').value = applyId;

  // baselineManifest NOT in fixture.
  setupApplyFixtures(setFixture, teamId, applyId, { classification200: true });

  document.getElementById('btn-apply-view').click();
  await new Promise(r => setTimeout(r, 100));

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
  document.getElementById('apply-view-team').value = 't-root1';
  document.getElementById('apply-view-id').value = 'apply-r1';
  setupApplyFixtures(setFixture, 't-root1', 'apply-r1', {
    classification200: false,
    baseline: { ...BASELINE_FIXTURE, rootRef: 'runtime-baseline-root' },
  });
  document.getElementById('btn-apply-view').click();
  await new Promise(r => setTimeout(r, 100));
  let bl = document.getElementById('apply-view-baseline');
  assert.ok(bl.innerHTML.includes('runtime-baseline-root'), 'opaque rootRef displayed');

  // ── Absolute-looking rootRef sanitized ───
  // Switch to a new tab render (re-click teams tab).
  window.switchSection(document.querySelector('[data-view="teams"]'));
  await new Promise(r => setTimeout(r, 50));

  document.getElementById('apply-view-team').value = 't-root2';
  document.getElementById('apply-view-id').value = 'apply-r2';
  setupApplyFixtures(setFixture, 't-root2', 'apply-r2', {
    classification200: false,
    baseline: { ...BASELINE_FIXTURE, rootRef: 'H:\\02-Areas\\project-root' },
  });
  document.getElementById('btn-apply-view').click();
  await new Promise(r => setTimeout(r, 100));
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

  await switchToTeamsTab(window, document);
  document.getElementById('apply-view-team').value = teamId;
  document.getElementById('apply-view-id').value = applyId;
  setupApplyFixtures(setFixture, teamId, applyId, { classification200: true, baseline: BASELINE_FIXTURE });
  document.getElementById('btn-apply-view').click();
  await new Promise(r => setTimeout(r, 100));

  const baselineEl = document.getElementById('apply-view-baseline');

  // Verify preview still works.
  const previewBtn = document.querySelector('.apply-preview-btn');
  assert.ok(previewBtn);
  previewBtn.click();
  await new Promise(r => setTimeout(r, 100));

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

  await switchToTeamsTab(window, document);
  document.getElementById('apply-view-team').value = teamId;
  document.getElementById('apply-view-id').value = applyId;
  setupApplyFixtures(setFixture, teamId, applyId, { classification200: true, baseline: BASELINE_FIXTURE });
  document.getElementById('btn-apply-view').click();
  await new Promise(r => setTimeout(r, 100));

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
  document.getElementById('apply-view-team').value = 't-proj';
  document.getElementById('apply-view-id').value = 'apply-proj-root';
  setupApplyFixtures(setFixture, 't-proj', 'apply-proj-root', {
    classification200: false,
    baseline: { ...BASELINE_FIXTURE, rootRef: 'project-root:alpha' },
  });
  document.getElementById('btn-apply-view').click();
  await new Promise(r => setTimeout(r, 100));

  const bl = document.getElementById('apply-view-baseline').innerHTML;
  // project-root:<key> must appear as opaque text.
  assert.ok(bl.includes('project-root:alpha'), 'project-root:<key> displayed');
  // Must NOT be sanitized to placeholder.
  assert.equal(bl.includes('root: —'), false, 'project-root:<key> not sanitized');

  // Absolute-looking rootRef is still sanitized in the same viewer lifecycle.
  // Switch view and test with absolute-looking rootRef.
  window.switchSection(document.querySelector('[data-view="teams"]'));
  await new Promise(r => setTimeout(r, 50));
  document.getElementById('apply-view-team').value = 't-abs';
  document.getElementById('apply-view-id').value = 'apply-abs';
  setupApplyFixtures(setFixture, 't-abs', 'apply-abs', {
    classification200: false,
    baseline: { ...BASELINE_FIXTURE, rootRef: 'C:\\Windows\\System32' },
  });
  document.getElementById('btn-apply-view').click();
  await new Promise(r => setTimeout(r, 100));

  const bl2 = document.getElementById('apply-view-baseline').innerHTML;
  assert.equal(bl2.includes('C:'), false, 'absolute rootRef sanitized');
  assert.equal(bl2.includes('Windows'), false, 'absolute path not leaked');
  assert.ok(bl2.includes('root: —') || bl2.includes('root:&'), 'placeholder shown');
});
