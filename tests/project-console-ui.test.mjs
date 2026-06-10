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

test('project console keeps token in memory and persists only the active project key', () => {
  const html = renderProjectConsoleHtml();

  assert.match(html, /localStorage\.getItem\('cli-bridge-active-project'\)/);
  assert.equal(/localStorage\.[gs]etItem\([^)]*token/i.test(html), false);
  assert.match(html, /const store = \{/);
  assert.match(html, /token: ''/);
});

test('project console is honest about Phase A unavailable data', () => {
  const html = renderProjectConsoleHtml();

  assert.match(html, /unavailable \(Phase B\)/);
  assert.match(html, /No memory store in Phase A/);
  assert.match(html, /derived from metrics and events/);

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

  // Reviews are created in the Reviews section view (Task 8), not from the
  // command bar. The command bar only routes to goal workflow endpoints.
  assert.match(html, /\/bridge\/reviews', 'POST'/);  // present in reviews section, not command bar
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
