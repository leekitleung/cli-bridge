import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

import {
  createConnectionPanelStatus,
  createFillPanelStatus,
  createLocatingPanelStatus,
  createLoopPanelStatus,
  createNetworkErrorPanelStatus,
  createStreamingBlockedPanelStatus,
  getPanelStatusColor,
} from '../apps/extension/src/ui/state.ts';

const root = process.cwd();

test('loop panel status maps bridge loop stages into user-visible status text', () => {
  assert.deepEqual(createLoopPanelStatus('codex-output-ready'), {
    kind: 'idle',
    label: '待处理',
    detail: '可以填入下一条交接内容',
  });
  assert.deepEqual(createLoopPanelStatus('chatgpt-awaiting-user-send'), {
    kind: 'blocked',
    label: '等待发送',
    detail: '内容已填入，请在 ChatGPT 中手动发送',
  });
  assert.deepEqual(createLoopPanelStatus('pending-prompt-ready'), {
    kind: 'success',
    label: '待确认',
    detail: '已提取结果，请确认后回传',
  });
});

test('fill panel status maps results into user-understandable guidance', () => {
  assert.deepEqual(createFillPanelStatus({
    ok: true,
    status: 'filled',
    reason: null,
    method: 'textarea',
  }), {
    kind: 'success',
    label: '已填入',
    detail: '内容已写入 ChatGPT 输入框，请手动点击发送',
  });

  const notFoundWithClipboard = createFillPanelStatus({
    ok: false,
    status: 'clipboard-fallback',
    reason: 'input-not-found',
    method: 'clipboard',
    clipboard: { ok: true, status: 'success', reason: null },
  });
  assert.equal(notFoundWithClipboard.kind, 'failed');
  assert.equal(notFoundWithClipboard.label, '未找到输入框');

  const verifyFailedWithClipboard = createFillPanelStatus({
    ok: false,
    status: 'clipboard-fallback',
    reason: 'input-verify-failed',
    method: 'clipboard',
    clipboard: { ok: true, status: 'success', reason: null },
  });
  assert.equal(verifyFailedWithClipboard.kind, 'failed');
  assert.equal(verifyFailedWithClipboard.label, '写入未生效');

  const clipboardFailed = createFillPanelStatus({
    ok: false,
    status: 'clipboard-fallback',
    reason: 'clipboard-write-failed',
    method: 'clipboard',
    clipboard: { ok: false, status: 'failed', reason: 'clipboard-write-failed' },
  });
  assert.equal(clipboardFailed.kind, 'failed');

  assert.equal(createLocatingPanelStatus().kind, 'idle');
  assert.equal(createStreamingBlockedPanelStatus().kind, 'blocked');
  assert.equal(createNetworkErrorPanelStatus().kind, 'failed');
});

test('connection panel status maps every pairing state to user-visible text', () => {
  assert.equal(createConnectionPanelStatus('unpaired').kind, 'idle');
  assert.equal(createConnectionPanelStatus('checking').kind, 'idle');
  assert.equal(createConnectionPanelStatus('connected').kind, 'success');
  assert.equal(createConnectionPanelStatus('unauthorized').kind, 'failed');
  assert.equal(createConnectionPanelStatus('network-error').kind, 'failed');
  for (const state of ['unpaired', 'checking', 'connected', 'unauthorized', 'network-error']) {
    const status = createConnectionPanelStatus(state);
    assert.ok(status.label.length > 0 && status.detail.length > 0);
  }
});

test('getPanelStatusColor maps each status kind to a distinct, non-empty color', () => {
  const success = getPanelStatusColor('success');
  const failed = getPanelStatusColor('failed');
  const blocked = getPanelStatusColor('blocked');
  const idle = getPanelStatusColor('idle');
  for (const color of [success, failed, blocked, idle]) {
    assert.match(color, /^#[0-9a-fA-F]{6}$/);
  }
  assert.notEqual(success, failed);
  assert.notEqual(success, idle);
  assert.equal(getPanelStatusColor('fallback'), blocked);
});

test('Bridge Panel gives explicit pairing feedback (initial state, color, paired placeholder)', async () => {
  const source = await readFile(resolve(root, 'apps/extension/src/ui/bridge-panel.tsx'), 'utf8');

  // Initial state is rendered so connection status is never blank.
  assert.equal(source.includes("renderConnection('unpaired')"), true);
  // Connection status is colorized by kind.
  assert.equal(source.includes('getPanelStatusColor'), true);
  // Pairing token entry must stay out of the chatgpt.com page DOM.
  assert.equal(source.includes('data-cli-bridge-pairing-input'), false);
  assert.equal(source.includes('savePairingTokenToStorage'), false);
  assert.equal(source.includes('pairingInput'), false);
});

test('Bridge Panel exposes connection status without page-DOM token controls', async () => {
  const source = await readFile(resolve(root, 'apps/extension/src/ui/bridge-panel.tsx'), 'utf8');

  // Pairing happens in an extension-owned surface, not in the shared page DOM.
  assert.equal(source.includes('Pairing token'), false);
  assert.equal(source.includes("type = 'password'"), false);
  assert.equal(source.includes('data-cli-bridge-connection-status'), true);
  assert.equal(source.includes('clearPairingTokenFromStorage'), true);
  assert.equal(source.includes('testPrivateHealth'), true);

  // The security boundary still holds: no auto-send affordance of any kind.
  assert.equal(source.includes('send-button'), false);
  assert.equal(source.includes('requestSubmit'), false);
  assert.equal(source.includes('KeyboardEvent'), false);
});

test('Bridge Panel exposes loop status without adding auto-send controls', async () => {
  const source = await readFile(resolve(root, 'apps/extension/src/ui/bridge-panel.tsx'), 'utf8');

  assert.equal(source.includes('data-cli-bridge-loop-status'), true);
  assert.equal(source.includes('active relay session:'), false);
  assert.equal(source.includes('no active relay session'), false);
  assert.equal(source.includes('requestSubmit'), false);
  assert.equal(source.includes('KeyboardEvent'), false);
  assert.equal(source.includes('send-button'), false);
  assert.equal(source.includes('automatic agent loop'), false);
});
