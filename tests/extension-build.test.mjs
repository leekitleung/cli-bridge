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
  await execFileAsync('npm', ['run', 'build-extension'], {
    cwd: root,
  });

  const distManifestPath = resolve(root, 'apps/extension/dist/manifest.json');
  const backgroundPath = resolve(root, 'apps/extension/dist/background/index.js');
  const contentPath = resolve(root, 'apps/extension/dist/content/index.js');

  assert.equal(existsSync(distManifestPath), true);
  assert.equal(existsSync(backgroundPath), true);
  assert.equal(existsSync(contentPath), true);

  const manifestText = await readFile(distManifestPath, 'utf8');
  const manifest = JSON.parse(manifestText);
  assert.equal(manifestText.includes('.ts'), false);
  assert.deepEqual(manifest.background, {
    service_worker: 'background/index.js',
    type: 'module',
  });
  assert.deepEqual(manifest.content_scripts, [
    {
      matches: ['https://chatgpt.com/*'],
      js: ['content/index.js'],
    },
  ]);
  assert.deepEqual(manifest.permissions, ['clipboardWrite']);
  assert.deepEqual(manifest.host_permissions, [
    'http://127.0.0.1:31337/*',
    'https://chatgpt.com/*',
  ]);

  const contentSource = await readFile(contentPath, 'utf8');
  assert.equal(contentSource.includes('cli-bridge-panel-root'), true);
  assert.equal(contentSource.includes('data-cli-bridge-panel'), true);
  assert.equal(contentSource.includes('\\u586B\\u5165'), true);
  assert.equal(contentSource.includes('\\u63D0\\u53D6'), true);
  assert.equal(contentSource.includes('\\u590D\\u5236'), true);
  assert.equal(contentSource.includes('Pending Prompt'), false);
  assert.equal(contentSource.includes('BridgePacket'), false);
  assert.equal(contentSource.includes('MockAgent'), false);
  assert.equal(contentSource.includes('CodexManaged'), false);
});

test('content runtime entry calls Bridge Panel mount with duplicate guard', async () => {
  const entrySource = await readFile(resolve(root, 'apps/extension/src/content/index.ts'), 'utf8');

  assert.equal(entrySource.includes('function mountOnce()'), true);
  assert.equal(entrySource.includes('mountBridgePanel(document)'), true);
  assert.equal(entrySource.includes('document.getElementById(PANEL_ROOT_ID)'), true);
  assert.equal(entrySource.includes('DOMContentLoaded'), true);
});
