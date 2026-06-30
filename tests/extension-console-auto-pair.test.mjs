// ADR-0025 Task 4: Extension console auto-pair tests.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const root = process.cwd();

test('manifest injects console auto-pair script only on local Project Console', () => {
  const manifest = JSON.parse(
    readFileSync(resolve(root, 'apps/extension/manifest.json'), 'utf8'),
  );
  const script = manifest.content_scripts.find((s) =>
    (s.js || []).some((p) => p.includes('console-auto-pair')),
  );
  assert.ok(script, 'expected console auto-pair content script');
  assert.deepEqual(script.matches, ['http://127.0.0.1:31337/console/project']);
});

test('console auto-pair source uses only claim nonce and never localStorage', () => {
  const source = readFileSync(
    resolve(root, 'apps/extension/src/content/console-auto-pair.ts'),
    'utf8',
  );
  assert.match(source, /data-extension-claim-nonce/);
  assert.match(source, /cli-bridge-claim-local-session/);
  assert.equal(source.includes('localStorage'), false);
  assert.equal(source.includes('cliBridgePairingToken'), false);
});
