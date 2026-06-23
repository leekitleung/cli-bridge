import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import test from 'node:test';
import { JSDOM } from 'jsdom';

import {
  classifyError,
  disconnectConnectedBrowser,
  findAvailablePort,
  hasChatGptComposerForHarness,
  parseArgs,
  selectCliBridgeExtensionId,
  sanitizeEvidence,
} from '../scripts/web-auto-release-e2e.ts';

test('web auto release harness parses explicit CLI args', () => {
  const args = parseArgs([
    '--scenario',
    'stage-c-two-rounds',
    '--profile-dir',
    'output/playwright/profile',
    '--chrome-path',
    '/Applications/Chrome.app/Contents/MacOS/Chrome',
    '--remote-debugging-port',
    '9224',
    '--base-port',
    '31337',
    '--output-dir',
    'output/playwright/release',
    '--keep-browser',
    '--dry-run',
  ]);

  assert.equal(args.scenario, 'stage-c-two-rounds');
  assert.equal(args.profileDir, 'output/playwright/profile');
  assert.equal(args.chromePath, '/Applications/Chrome.app/Contents/MacOS/Chrome');
  assert.equal(args.remoteDebuggingPort, 9224);
  assert.equal(args.basePort, 31337);
  assert.equal(args.outputDir, 'output/playwright/release');
  assert.equal(args.keepBrowser, true);
  assert.equal(args.dryRun, true);
});

test('web auto release harness supports existing CDP browser mode', () => {
  const args = parseArgs([
    '--scenario',
    'all',
    '--connect-cdp',
    'http://127.0.0.1:9224',
    '--base-port',
    '31337',
  ]);

  assert.equal(args.scenario, 'all');
  assert.equal(args.profileDir, undefined);
  assert.equal(args.connectCdp, 'http://127.0.0.1:9224');
  assert.equal(args.basePort, 31337);
});

test('web auto release harness selects CLI Bridge from multiple extension workers', async () => {
  const workers = [
    {
      url: () => 'chrome-extension://other-extension/background.js',
      evaluate: async () => ({ name: 'Other Extension' }),
    },
    {
      url: () => 'chrome-extension://cli-bridge/background/index.js',
      evaluate: async () => ({ name: 'CLI Bridge' }),
    },
  ];

  assert.equal(await selectCliBridgeExtensionId(workers), 'cli-bridge');
});

test('web auto release harness configures the server-owned inbound route', async () => {
  const source = await readFile(new URL('../scripts/web-auto-release-e2e.ts', import.meta.url), 'utf8');

  assert.match(
    source,
    /startLocalServer\(serverPort,\s*\{\s*inboundRelayEndpointId:\s*INBOUND_ENDPOINT_ID\s*\}\)/,
  );
});

test('web auto release harness awaits connected-browser disconnect cleanup', async () => {
  let disconnected = false;
  const browser = {
    async disconnect() {
      await new Promise((resolve) => setTimeout(resolve, 5));
      disconnected = true;
    },
  };

  await disconnectConnectedBrowser(browser);
  assert.equal(disconnected, true);
});

test('web auto release harness closes the Playwright CDP browser handle', async () => {
  let browserHandleClosed = false;
  const browser = {
    async close() {
      browserHandleClosed = true;
    },
  };

  await disconnectConnectedBrowser(browser);
  assert.equal(browserHandleClosed, true);
});

test('web auto release harness rejects missing profile and invalid scenario', () => {
  assert.throws(() => parseArgs(['--scenario', 'all']), /profile-dir, connect-cdp, or connect-active-chrome is required/);
  assert.throws(
    () => parseArgs(['--scenario', 'bad', '--profile-dir', 'profile']),
    /scenario must be/,
  );
  assert.throws(
    () => parseArgs(['--scenario', 'all', '--profile-dir', 'profile', '--connect-cdp', 'http://127.0.0.1:9224']),
    /mutually exclusive/,
  );
});

test('web auto release evidence redacts pairing token and cookies', () => {
  const sanitized = sanitizeEvidence({
    pairingToken: 'tok-secret',
    nested: {
      text: 'token tok-secret cookie="abc" cliBridgePairingToken:"tok-secret"',
      setCookie: 'session=abc',
    },
  }, ['tok-secret']);

  const json = JSON.stringify(sanitized);
  assert.equal(json.includes('tok-secret'), false);
  assert.equal(json.includes('session=abc'), false);
  assert.match(json, /REDACTED/);
});

test('web auto release failure classification is stable', () => {
  assert.equal(classifyError(new Error('ChatGPT profile is not logged in')).code, 'not-logged-in');
  assert.equal(classifyError(new Error('extension id could not be discovered')).code, 'extension-id-missing');
  assert.equal(classifyError(new Error('Stage C hard stop failed')).code, 'hard-stop-failed');
  assert.equal(classifyError(new Error('timeout waiting for returned outbound')).code, 'chatgpt-timeout');
  assert.equal(classifyError(new Error('ChatGPT composer did not become ready')).code, 'chatgpt-timeout');
});

test('web auto release composer readiness helper accepts stable composer only', () => {
  const ready = new JSDOM('<body><div contenteditable="true" data-testid="prompt-textarea"></div></body>');
  assert.equal(hasChatGptComposerForHarness(ready.window.document), true);

  const streaming = new JSDOM('<body>Stop generating<div contenteditable="true" data-testid="prompt-textarea"></div></body>');
  assert.equal(hasChatGptComposerForHarness(streaming.window.document), false);

  const missing = new JSDOM('<body><main>loading</main></body>');
  assert.equal(hasChatGptComposerForHarness(missing.window.document), false);
});

test('web auto release port helper rejects occupied requested port and releases ephemeral ports', async () => {
  const port = await findAvailablePort();
  await findAvailablePort(port);

  const server = createServer();
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  await assert.rejects(() => findAvailablePort(port), /already in use/);
  await new Promise((resolve) => server.close(resolve));
  await findAvailablePort(port);
});
