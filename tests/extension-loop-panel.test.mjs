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
  assert.equal(notFoundWithClipboard.kind, 'fallback');
  assert.equal(notFoundWithClipboard.label, '未找到输入框');

  const verifyFailedWithClipboard = createFillPanelStatus({
    ok: false,
    status: 'clipboard-fallback',
    reason: 'input-verify-failed',
    method: 'clipboard',
    clipboard: { ok: true, status: 'success', reason: null },
  });
  assert.equal(verifyFailedWithClipboard.kind, 'fallback');
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

  // Initial state is rendered so the pairing area is never blank.
  assert.equal(source.includes("renderConnection('unpaired')"), true);
  // Connection status is colorized by kind.
  assert.equal(source.includes('getPanelStatusColor'), true);
  // Paired placeholder communicates the saved state without revealing the token.
  assert.equal(source.includes('已配对'), true);
  // Save click gives immediate feedback before the async health probe resolves.
  assert.equal(source.includes("renderConnection('checking')"), true);
});

test('Bridge Panel exposes pairing controls without adding auto-send controls', async () => {
  const source = await readFile(resolve(root, 'apps/extension/src/ui/bridge-panel.tsx'), 'utf8');

  // Pairing UI is present so users do not need the service-worker console.
  assert.equal(source.includes('data-cli-bridge-pairing-input'), true);
  assert.equal(source.includes('data-cli-bridge-connection-status'), true);
  assert.equal(source.includes('savePairingTokenToStorage'), true);
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
  assert.equal(source.includes('requestSubmit'), false);
  assert.equal(source.includes('KeyboardEvent'), false);
  assert.equal(source.includes('send-button'), false);
  assert.equal(source.includes('automatic agent loop'), false);
});
