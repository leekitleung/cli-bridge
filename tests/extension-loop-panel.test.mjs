import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

import {
  createLoopPanelStatus,
} from '../apps/extension/src/ui/state.ts';

const root = process.cwd();

test('loop panel status maps bridge loop stages into user-visible status text', () => {
  assert.deepEqual(createLoopPanelStatus('codex-output-ready'), {
    kind: 'idle',
    label: 'loop',
    detail: 'ready-to-fill',
  });
  assert.deepEqual(createLoopPanelStatus('chatgpt-awaiting-user-send'), {
    kind: 'blocked',
    label: 'loop',
    detail: 'awaiting-user-send',
  });
  assert.deepEqual(createLoopPanelStatus('pending-prompt-ready'), {
    kind: 'success',
    label: 'loop',
    detail: 'pending-confirmation',
  });
});

test('Bridge Panel exposes loop status without adding auto-send controls', async () => {
  const source = await readFile(resolve(root, 'apps/extension/src/ui/bridge-panel.tsx'), 'utf8');

  assert.equal(source.includes('data-cli-bridge-loop-status'), true);
  assert.equal(source.includes('requestSubmit'), false);
  assert.equal(source.includes('KeyboardEvent'), false);
  assert.equal(source.includes('send-button'), false);
  assert.equal(source.includes('automatic agent loop'), false);
});
