import assert from 'node:assert/strict';
import test from 'node:test';

import { isAllowedOrigin, isLoopbackOrigin } from '../apps/local-server/src/security/origin-guard.ts';
import { CONSOLE_PATH, renderConsoleHtml } from '../apps/local-server/src/routes/console.ts';
import { PAIRING_TOKEN_HEADER } from '../packages/shared/src/constants.ts';
import { startLocalServer } from '../apps/local-server/src/server.ts';

function closer(handle) {
  return async () => {
    await new Promise((resolve, reject) => {
      handle.server.close((error) => (error ? reject(error) : resolve(undefined)));
    });
  };
}

test('loopback origins are allowed; non-loopback non-allowlisted are not', () => {
  assert.equal(isLoopbackOrigin('http://127.0.0.1:31337'), true);
  assert.equal(isLoopbackOrigin('http://localhost:8080'), true);
  assert.equal(isLoopbackOrigin('https://evil.example'), false);
  assert.equal(isAllowedOrigin('http://127.0.0.1:5000'), true);
  assert.equal(isAllowedOrigin('https://evil.example'), false);
});

test('legacy console renderer returns the single Project Workspace shell', () => {
  const html = renderConsoleHtml();
  assert.match(html, /CLI Bridge — Project Workspace/);
  assert.match(html, /id="reviews-context"/);
  assert.match(html, /lc === '\/reviews'/);
  assert.match(html, /\/bridge\/reviews/);
  assert.match(html, /\/bridge\/reviews\/confirm/);
  assert.match(html, /\/bridge\/reviews\/dispatch/);
  assert.doesNotMatch(html, /class="project-ui-nav"/);
  assert.equal(/\/(exec|shell|run|command)['"`]/.test(html), false);
  assert.equal(html.includes('requestSubmit'), false);
});

test('legacy review console redirects to the Project Workspace', async (t) => {
  const handle = await startLocalServer(0);
  t.after(closer(handle));

  const res = await fetch(`${handle.url}${CONSOLE_PATH}`, { redirect: 'manual' });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/console/project');
});

test('bridge endpoints accept a loopback origin with the pairing token', async (t) => {
  const handle = await startLocalServer(0);
  t.after(closer(handle));

  // Simulate the console page calling its own server from a loopback origin.
  const res = await fetch(`${handle.url}/bridge/metrics`, {
    headers: { origin: handle.url, [PAIRING_TOKEN_HEADER]: handle.pairingToken },
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(data.metrics);
});

test('console-origin bridge call still rejects a missing/invalid token', async (t) => {
  const handle = await startLocalServer(0);
  t.after(closer(handle));

  const noToken = await fetch(`${handle.url}/bridge/metrics`, { headers: { origin: handle.url } });
  assert.equal(noToken.status, 401);

  const badToken = await fetch(`${handle.url}/bridge/metrics`, {
    headers: { origin: handle.url, [PAIRING_TOKEN_HEADER]: 'wrong' },
  });
  assert.equal(badToken.status, 403);
});
