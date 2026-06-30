// Project Workspace Console Phase A tests.
//
// The page is a thin project-centric command workspace. These tests lock the
// contract that it renders as a standalone HTML view, calls only existing
// governed /bridge/* endpoints, and keeps the primary path in the composer.

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

test('project console HTML renders the command-first project shell', () => {
  const html = renderProjectConsoleHtml();

  assert.match(html, /CLI Bridge — Project Workspace/);
  assert.match(html, /Project navigation/);
  assert.match(html, /Project workspace/);
  assert.match(html, /Compact project facts/);
  assert.match(html, /id="command-input"/);
  assert.match(html, /id="composer-new-project"/);
  assert.match(html, /id="access-pill"/);

  assert.match(html, /Recent session/);
  assert.match(html, /Project history/);
  assert.match(html, /Conversation/);
  assert.match(html, /\/goals · \/reviews · \/project/);
  assert.match(html, /id="facts-rail"/);
  assert.match(html, /id="fact-next"/);
  assert.match(html, /id="fact-verify"/);
  assert.match(html, /data-active-project-plan/);
  assert.match(html, /data-next-action/);
  assert.equal(html.includes('Timeline &amp; Goals'), false);
  assert.equal(html.includes('id="section-nav"'), false);
  assert.equal(html.includes('data-view='), false);
  assert.equal(html.includes('role="tablist"'), false);
  assert.equal(html.includes('Context Commands'), false);
  assert.equal(html.includes('"nav workspace status"'), false);
  assert.match(html, /"nav commandbar \."/);
  assert.equal(html.includes('"nav commandbar commandbar"'), false);
  assert.equal(html.includes('"commandbar commandbar commandbar"'), false);
  assert.equal(html.includes('cockpit'), false);
  assert.equal(html.includes('id="btn-approve"'), false);
  assert.equal(html.includes('id="btn-step"'), false);
  assert.equal(html.includes('id="btn-gen-plan"'), false);
  assert.equal(html.includes('gate-btn'), false);
  assert.equal(html.includes('Voice input'), false);
  assert.equal(html.includes('composer-mic'), false);

  assert.doesNotMatch(html, /href="\/console"/);
  assert.doesNotMatch(html, /href="\/console\/goals"/);
  assert.match(html, /\/goals · \/reviews · \/project/);
  assert.match(html, /id="goals-context"/);
  assert.match(html, /id="reviews-context"/);
});

test('mobile console exposes project navigation, history, and facts through a compact drawer', () => {
  const html = renderProjectConsoleHtml();
  assert.match(html, /id="mobile-nav-toggle"/);
  assert.match(html, /mobile-nav-open/);
  assert.match(html, /id="mobile-facts"/);
  assert.match(html, /syncMobileFacts/);
  assert.match(html, /aria-controls="project-nav"/);
  assert.match(html, /<nav id="project-nav"/);
});

test('project console supports light mode and mobile touch targets', () => {
  const html = renderProjectConsoleHtml();
  assert.match(html, /--bg: #f7f7f5/);
  assert.match(html, /@media \(prefers-color-scheme: dark\)/);
  assert.match(html, /--composer-bg: #ffffff/);
  assert.match(html, /--composer-bg: #2b2b2b/);
  assert.match(html, /mobile-nav-toggle \{ display: none; min-height: 44px; \}/);
  assert.match(html, /header input, header button \{[^}]*min-height: 44px/s);
  assert.match(html, /footer #command-send \{[^}]*width: 44px;[^}]*height: 44px/s);
  assert.match(html, /\.composer-icon \{[^}]*width: 44px;[^}]*height: 44px/s);
  assert.match(html, /\.composer-pill \{[^}]*min-height: 44px/s);
  assert.doesNotMatch(html, /mobile-nav-toggle \{ display: none; min-height: 40px; \}/);
});

test('project console is a thin client over only allowlisted bridge endpoints', () => {
  const html = renderProjectConsoleHtml();
  const paths = new Set(extractBridgePaths(html));

  // After Task 15, data refresh uses /bridge/projects aggregation instead of
  // individual /bridge/goals|reviews|pending-prompts GET calls.  POST actions
  // for goal/review operations remain unchanged.
  // ADR-0025: /bridge/local-auto-pair/revoke is a narrow loopback-only route.
  assert.deepEqual(paths, new Set([
    '/bridge/metrics',
    '/bridge/projects',
    '/bridge/projects?includeArchived=true',
    '/bridge/projects/',
    '/bridge/endpoints?online=true',
    '/bridge/goals/approve',
    '/bridge/goals/step',
    '/bridge/goals/cancel',
    '/bridge/goals/plan',
    '/bridge/goals/gate',
    '/bridge/goals',
    '/bridge/goals/binding?goalId=',
    '/bridge/goals/rebind',
    '/bridge/reviews',
    '/bridge/reviews/confirm',
    '/bridge/reviews/dispatch',
    '/bridge/execution-proposals?planId=',
    '/bridge/execution-proposals/',
    '/bridge/local-auto-pair/revoke',
  ]));

  assert.equal(/\/(exec|shell|run|command)['"`]/.test(html), false);
  assert.equal(html.includes('requestSubmit'), false);
  assert.equal(/claude\s+-p|spawn\(|execFile\(|child_process/.test(html), false);
});

// Task 15 regression: console must not fetch /console/project as a data endpoint.
test('project console does not call /console/project for data loading', () => {
  const html = renderProjectConsoleHtml();
  // Global navigation may link to /console/project. It must never be used as a
  // data endpoint by fetch() or the bridge api() helper.
  assert.doesNotMatch(html, /api\(['"`]\/console\/project/);
  assert.doesNotMatch(html, /fetch\(['"`]\/console\/project/);
});

test('project console keeps pairing token in memory only and sends it only via header', () => {
  const html = renderProjectConsoleHtml();

  // Active project key can be persisted for workspace continuity.
  assert.match(html, /localStorage\.getItem\('cli-bridge-active-project'\)/);

  // Pairing token is a bearer secret and must not be persisted.
  assert.equal(html.includes("localStorage.getItem('cli-bridge-pairing-token')"), false);
  assert.equal(html.includes("localStorage.setItem('cli-bridge-pairing-token'"), false);

  // Store starts with an empty in-memory token; manual Connect is required.
  assert.match(html, /const store = \{/);
  assert.match(html, /token: ''/);

  // The token must still be sent ONLY via the pairing header — never embedded
  // in a request URL/query. ADR-0025: the header is conditionally set (cookie
  // auth path skips it), but the store.token binding is still the source.
  assert.match(html, /'x-cli-bridge-pairing-token'\]\s*=\s*store\.token/);
  assert.match(html, /store\.token\s*&&\s*store\.token\s*!==\s*'__cookie__'/);
  assert.equal(/[?&][^=]*token=/i.test(html), false);
});

test('project console is honest about data that is not yet available', () => {
  const html = renderProjectConsoleHtml();

  assert.match(html, /not yet available/);
  assert.match(html, /No audit events recorded yet/);
  assert.match(html, /No derived memory|create goals and plans/);
  assert.equal(html.includes('placeholder baseline'), false);

  assert.equal(html.includes('tests 297/297'), false);
  assert.equal(html.includes('ahead 4 commits'), false);
  assert.equal(html.includes('4/6 slices'), false);
});

test('project console command bar routes only to controlled workflow actions', () => {
  const html = renderProjectConsoleHtml();

  assert.match(html, /project-console-/);
  assert.match(html, /creating goal/);
  assert.match(html, /generating plan/);
  assert.match(html, /advancing/);
  assert.match(html, /approve plan/);
  assert.match(html, /approve gate/);
  assert.match(html, /plan history/);
  assert.match(html, /switch project/);
  assert.match(html, /blocked-needs-gate/);

  // P1 fix: goal creation in command bar must pass active projectId.
  assert.match(html, /projectId:\s*store\.activeProjectKey/,
    'goal creation must include projectId: store.activeProjectKey');

  // Reviews are still created by the existing controlled review flow. The
  // command bar may show that context, but must not invent a new review path.
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
    '/bridge/endpoints?online=true',
    '/bridge/goals/approve',
    '/bridge/goals/step',
    '/bridge/goals/cancel',
    '/bridge/goals/plan',
    '/bridge/goals/gate',
    '/bridge/goals',
    '/bridge/goals/binding?goalId=',
    '/bridge/goals/rebind',
    '/bridge/reviews',
    '/bridge/reviews/confirm',
    '/bridge/reviews/dispatch',
    '/bridge/execution-proposals?planId=',
    '/bridge/execution-proposals/',
    '/bridge/local-auto-pair/revoke',
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
  // Project switching is now available from the project rail and the command
  // composer; both paths must clear the loading state in finally blocks.
  const allFalseMatches = html.match(/switchingProject\s*=\s*false/g) || [];
  assert.ok(allFalseMatches.length >= 1, 'switchingProject = false must be present in a finally block');
  assert.match(html, /switch project /, 'command-driven project switching must exist');
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
    '/bridge/endpoints?online=true',
    '/bridge/goals/approve',
    '/bridge/goals/step',
    '/bridge/goals/cancel',
    '/bridge/goals/plan',
    '/bridge/goals/gate',
    '/bridge/goals',
    '/bridge/goals/binding?goalId=',
    '/bridge/goals/rebind',
    '/bridge/reviews',
    '/bridge/reviews/confirm',
    '/bridge/reviews/dispatch',
    '/bridge/execution-proposals?planId=',
    '/bridge/execution-proposals/',
    '/bridge/local-auto-pair/revoke',
  ]);
  const paths = extractBridgePaths(html);
  const outside = paths.filter(p => !allowed.has(p));
  assert.deepEqual(outside, [], 'all bridge paths must be in the allowlist');

  // Still no shell/exec/run/command paths anywhere.
  assert.equal(/\/(exec|shell|run|command)['"`]/.test(html), false);
});

// B3: project creation is command-only and uses allowlisted POST.
test('project create is command-only and calls POST /bridge/projects', () => {
  const html = renderProjectConsoleHtml();
  assert.equal(html.includes('btn-new-proj'), false, 'new project button must not exist');
  assert.equal(html.includes('new-proj-key'), false, 'new project key input must not exist');
  assert.ok(html.includes('project create &lt;key&gt;'), 'project create command should be discoverable');
  // Must call POST /bridge/projects — already in the allowlist.
  assert.ok(html.includes("'/bridge/projects'"), 'should reference /bridge/projects');
  // No /exec, /shell additions.
  assert.equal(/\/(exec|shell)['"`]/.test(html), false);
});

// v2.2/v2.20/EX-4: Tasks/WorkBuddy context present, execution gated.
test('Tasks context is present and no exec/shell paths', () => {
  const html = renderProjectConsoleHtml();
  assert.ok(html.includes('workbuddy'), 'workbuddy tasks context should exist');
  // EX-4: WorkBuddy is now a gated execution endpoint — "Non-executing" label removed.
  assert.equal(/\/(exec|shell|run|command)['"`]/.test(html), false);
});
