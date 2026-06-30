import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const root = process.cwd();

test('extension build emits Chrome-loadable JS manifest and scripts', async () => {
  await execFileAsync(process.execPath, ['scripts/build-extension.mjs'], {
    cwd: root,
  });

  const distManifestPath = resolve(root, 'apps/extension/dist/manifest.json');
  const backgroundPath = resolve(root, 'apps/extension/dist/background/index.js');
  const contentPath = resolve(root, 'apps/extension/dist/content/index.js');
  const popupHtmlPath = resolve(root, 'apps/extension/dist/popup/index.html');
  const popupScriptPath = resolve(root, 'apps/extension/dist/popup/index.js');
  const consoleAutoPairPath = resolve(root, 'apps/extension/dist/content/console-auto-pair.js');

  assert.equal(existsSync(distManifestPath), true);
  assert.equal(existsSync(backgroundPath), true);
  assert.equal(existsSync(contentPath), true);
  assert.equal(existsSync(consoleAutoPairPath), true);
  assert.equal(existsSync(popupHtmlPath), true);
  assert.equal(existsSync(popupScriptPath), true);

  const manifestText = await readFile(distManifestPath, 'utf8');
  const manifest = JSON.parse(manifestText);
  assert.equal(manifestText.includes('.ts'), false);
  assert.deepEqual(manifest.background, {
    service_worker: 'background/index.js',
    type: 'module',
  });
  assert.equal(manifest.action.default_popup, 'popup/index.html');
  assert.deepEqual(manifest.content_scripts, [
    {
      matches: ['https://chatgpt.com/*'],
      js: ['content/index.js'],
    },
    {
      matches: ['http://127.0.0.1:31337/console/project'],
      js: ['content/console-auto-pair.js'],
    },
  ]);
  assert.deepEqual(manifest.permissions, ['clipboardWrite', 'storage']);
  assert.deepEqual(manifest.host_permissions, [
    'http://127.0.0.1:31337/*',
    'https://chatgpt.com/*',
  ]);

  const contentSource = await readFile(contentPath, 'utf8');
  assert.equal(contentSource.includes('cli-bridge-panel-root'), true);
  assert.equal(contentSource.includes('data-cli-bridge-panel'), true);
  assert.equal(contentSource.includes('data-cli-bridge-pairing-input'), false);
  assert.equal(contentSource.includes('\\u586B\\u5165'), true);
  assert.equal(contentSource.includes('\\u9884\\u89C8\\u56DE\\u4F20'), true);
  assert.equal(contentSource.includes('\\u786E\\u8BA4\\u56DE\\u4F20'), true);
  assert.equal(contentSource.includes('\\u590D\\u5236'), true);
  assert.equal(contentSource.includes('Pending Prompt'), false);
  assert.equal(contentSource.includes('BridgePacket'), false);
  assert.equal(contentSource.includes('MockAgent'), false);
  assert.equal(contentSource.includes('CodexManaged'), false);

  const popupSource = await readFile(popupScriptPath, 'utf8');
  assert.equal(popupSource.includes('chrome.storage.session'), true);
  assert.equal(popupSource.includes('chrome.storage.local'), false);
});

test('content runtime entry calls Bridge Panel mount with duplicate guard', async () => {
  const entrySource = await readFile(resolve(root, 'apps/extension/src/content/index.ts'), 'utf8');

  assert.equal(entrySource.includes('function mountOnce()'), true);
  assert.equal(entrySource.includes('mountBridgePanel(document)'), true);
  assert.equal(entrySource.includes('document.getElementById(PANEL_ROOT_ID)'), true);
  assert.equal(entrySource.includes('DOMContentLoaded'), true);
});
