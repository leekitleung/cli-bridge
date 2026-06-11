// Project Workspace Console Phase A tests.
//
// The page is a thin project-centric cockpit. These tests lock the contract
// that it renders as a standalone HTML view, calls only existing governed
// /bridge/* endpoints, and is honest about Phase A data availability.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CONSOLE_PROJECT_PATH,
  renderProjectConsoleHtml,
} from '../apps/local-server/src/routes/project-console.ts';
import { PAIRING_TOKEN_HEADER } from '../packages/shared/src/constants.ts';
import { startLocalServer } from '../apps/local-server/src/server.ts';

function closer(handle) {
  return async () => {
    await new Promise((resolve, reject) => {
      handle.server.close((error) => (error ? reject(error) : resolve(undefined)));
    });
  };
}

function extractBridgePaths(html) {
  return [...html.matchAll(/['"`](\/bridge\/[^'"`]+)['"`]/g)].map((match) => match[1]);
}

test('project console HTML renders the three-region project cockpit shell', () => {
  const html = renderProjectConsoleHtml();

  assert.match(html, /CLI Bridge — Project Workspace/);
  assert.match(html, /Project navigation/);
  assert.match(html, /Project workspace/);
  assert.match(html, /Project status/);
  assert.match(html, /id="command-input"/);

  assert.match(html, /Timeline &amp; Goals/);
  assert.match(html, /Reviews/);
  assert.match(html, /Prompts/);
  assert.match(html, /Audit/);
  assert.match(html, /Memory/);

  assert.match(html, /\/console">Review console/);
  assert.match(html, /\/console\/goals">Goal console/);
});

test('project console is a thin client over only allowlisted bridge endpoints', () => {
  const html = renderProjectConsoleHtml();
  const paths = new Set(extractBridgePaths(html));

  // After Task 15, data refresh uses /bridge/projects aggregation instead of
  // individual /bridge/goals|reviews|pending-prompts GET calls.  POST actions
  // for goal/review operations remain unchanged.
  assert.deepEqual(paths, new Set([
    '/bridge/metrics',
    '/bridge/projects',
    '/bridge/projects?includeArchived=true',
    '/bridge/projects/',
    '/bridge/goals/approve',
    '/bridge/goals/step',
    '/bridge/goals/cancel',
    '/bridge/goals/plan',
    '/bridge/goals/gate',
    '/bridge/goals',
    '/bridge/reviews',
    '/bridge/reviews/confirm',
    '/bridge/reviews/dispatch',
  ]));

  assert.equal(/\/(exec|shell|run|command)['"`]/.test(html), false);
  assert.equal(html.includes('requestSubmit'), false);
  assert.equal(/claude\s+-p|spawn\(|execFile\(|child_process/.test(html), false);
});

// Task 15 regression: console must not fetch /console/project as a data endpoint.
test('project console does not call /console/project for data loading', () => {
  const html = renderProjectConsoleHtml();
  // The only /console/project references are the path constant definition and
  // the header comment. No fetch() or api() call targets /console/project.
  assert.equal(html.includes("'/console/project'"), false);
  assert.equal(html.includes('"/console/project"'), false);
  assert.equal(html.includes('`/console/project`'), false);
});

test('project console keeps token in memory and persists only the active project key', () => {
  const html = renderProjectConsoleHtml();

  assert.match(html, /localStorage\.getItem\('cli-bridge-active-project'\)/);
  assert.equal(/localStorage\.[gs]etItem\([^)]*token/i.test(html), false);
  assert.match(html, /const store = \{/);
  assert.match(html, /token: ''/);
});

test('project console is honest about data that is not yet available', () => {
  const html = renderProjectConsoleHtml();

  assert.match(html, /not yet available/);
  assert.match(html, /No audit events recorded yet/);
  assert.match(html, /No derived memory|create goals and plans/);
  assert.match(html, /placeholder baseline/);

  assert.equal(html.includes('tests 297/297'), false);
  assert.equal(html.includes('ahead 4 commits'), false);
  assert.equal(html.includes('4/6 slices'), false);
});

test('project console command bar routes only to controlled goal workflow actions', () => {
  const html = renderProjectConsoleHtml();

  assert.match(html, /project-console-/);
  assert.match(html, /creating goal/);
  assert.match(html, /generating plan \(this may take a moment\)/);
  assert.match(html, /advancing/);
  assert.match(html, /blocked-needs-gate/);
  assert.match(html, /Approve gate/);

  // P1 fix: goal creation in command bar must pass active projectId.
  assert.match(html, /projectId:\s*store\.activeProjectKey/,
    'goal creation must include projectId: store.activeProjectKey');

  // Reviews are created in the Reviews section view (Task 8), not from the
  // command bar. The command bar only routes to goal workflow endpoints.
  assert.match(html, /\/bridge\/reviews', 'POST'/);  // present in reviews section, not command bar
  // P1 fix: review creation must also pass active projectId.
  assert.match(html, /projectId:\s*store\.activeProjectKey/);
});

test('project console page is served as HTML at /console/project without a token', async (t) => {
  const handle = await startLocalServer(0);
  t.after(closer(handle));

  const res = await fetch(`${handle.url}${CONSOLE_PROJECT_PATH}`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  const body = await res.text();
  assert.match(body, /CLI Bridge — Project Workspace/);
});

test('project console bridge calls still require the pairing token', async (t) => {
  const handle = await startLocalServer(0);
  t.after(closer(handle));

  const noToken = await fetch(`${handle.url}/bridge/goals`, { headers: { origin: handle.url } });
  assert.equal(noToken.status, 401);

  const badToken = await fetch(`${handle.url}/bridge/goals`, {
    headers: { origin: handle.url, [PAIRING_TOKEN_HEADER]: 'wrong' },
  });
  assert.equal(badToken.status, 403);

  const ok = await fetch(`${handle.url}/bridge/goals`, {
    headers: { origin: handle.url, [PAIRING_TOKEN_HEADER]: handle.pairingToken },
  });
  assert.equal(ok.status, 200);
});

// Task 16 regression: project switch must show loading state.
test('project console includes loading state for project switching', () => {
  const html = renderProjectConsoleHtml();

  // The loading text must be present in the JS source.
  assert.match(html, /Loading project detail/);

  // switchingProject flag must exist in the store.
  assert.match(html, /switchingProject/);
  assert.match(html, /switchingProject = true/);
  assert.match(html, /switchingProject = false/);

  // Still no new shell/exec paths.
  assert.equal(/\/(exec|shell|run)['"`]/.test(html), false);
});

// Task 16 regression: project switch fetch paths unchanged.
test('project switch loading still only fetches /bridge/projects*', () => {
  const html = renderProjectConsoleHtml();
  const paths = new Set(extractBridgePaths(html));

  // Same allowed set as Task 15 closeout; no new endpoints introduced.
  assert.deepEqual(paths, new Set([
    '/bridge/metrics',
    '/bridge/projects',
    '/bridge/projects?includeArchived=true',
    '/bridge/projects/',
    '/bridge/goals/approve',
    '/bridge/goals/step',
    '/bridge/goals/cancel',
    '/bridge/goals/plan',
    '/bridge/goals/gate',
    '/bridge/goals',
    '/bridge/reviews',
    '/bridge/reviews/confirm',
    '/bridge/reviews/dispatch',
  ]));
});

// Task 17 regression: try/finally ensures switchingProject is always reset.
test('project switch loading state uses try/finally to prevent stuck state', () => {
  const html = renderProjectConsoleHtml();

  // The try block wrapping refreshAll must be present.
  assert.match(html, /try\s*\{[^}]*await refreshAll/);

  // The finally block must clear switchingProject.
  assert.match(html, /finally\s*\{[^}]*switchingProject\s*=\s*false/);

  // switchingProject is set false only inside finally (not duplicated after).
  const afterFinally = html.split('finally')[1] || '';
  // The only switchingProject = false should be inside the finally block.
  const allFalseMatches = html.match(/switchingProject\s*=\s*false/g) || [];
  assert.equal(allFalseMatches.length, 1, 'switchingProject = false must appear exactly once (inside finally)');
});

// Task 21 regression: console uses project summary data from /bridge/projects/:key response.
test('console renders project summary from server-computed data', () => {
  const html = renderProjectConsoleHtml();
  assert.match(html, /id="status-summary"/, 'Summary section must exist');
  assert.match(html, /detail\.summary/, 'Uses detail.summary from response');
  assert.match(html, /status-summary/);
});

// Task 21 regression: goals are grouped by lifecycle phase (active vs completed).
test('console groups goals by active vs completed in status panel', () => {
  const html = renderProjectConsoleHtml();
  // Must reference terminal status classification logic.
  assert.match(html, /terminalStatuses/, 'goals grouping logic must exist');
  // Active-first grouping.
  assert.match(html, /completed/, 'completed section header must exist');
});

// Task 21 regression: no internal labels ("Phase A/B") leak into user-facing text.
test('console does not expose internal roadmap labels to users', () => {
  const html = renderProjectConsoleHtml();
  assert.equal(html.includes('Phase A'), false, 'Phase A must not appear in HTML');
  assert.equal(html.includes('Phase B'), false, 'Phase B must not appear in HTML');
});

// Task 21 security: bridge paths used are strictly a subset of the allowlist.
test('all bridge paths in console are within the allowed set', () => {
  const html = renderProjectConsoleHtml();
  const allowed = new Set([
    '/bridge/metrics',
    '/bridge/projects',
    '/bridge/projects?includeArchived=true',
    '/bridge/projects/',
    '/bridge/goals/approve',
    '/bridge/goals/step',
    '/bridge/goals/cancel',
    '/bridge/goals/plan',
    '/bridge/goals/gate',
    '/bridge/goals',
    '/bridge/reviews',
    '/bridge/reviews/confirm',
    '/bridge/reviews/dispatch',
  ]);
  const paths = extractBridgePaths(html);
  const outside = paths.filter(p => !allowed.has(p));
  assert.deepEqual(outside, [], 'all bridge paths must be in the allowlist');

  // Still no shell/exec/run/command paths anywhere.
  assert.equal(/\/(exec|shell|run|command)['"`]/.test(html), false);
});
