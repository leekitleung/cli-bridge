import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';

import { setBridgeClientConfig } from '../apps/extension/src/content/bridge-client.ts';
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

let bridgePanelModulePromise;

async function loadBridgePanelModule() {
  if (!bridgePanelModulePromise) {
    bridgePanelModulePromise = (async () => {
      const dir = await mkdtemp(join(tmpdir(), 'cli-bridge-panel-test-'));
      const outfile = join(dir, 'bridge-panel.mjs');
      await build({
        entryPoints: [resolve(root, 'apps/extension/src/ui/bridge-panel.tsx')],
        outfile,
        bundle: true,
        format: 'esm',
        platform: 'node',
        logLevel: 'silent',
      });
      const mod = await import(`${outfile}?t=${Date.now()}`);
      await rm(dir, { recursive: true, force: true });
      return mod;
    })();
  }
  return bridgePanelModulePromise;
}

async function waitForPanel(predicate, timeoutMs = 500) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('waitForPanel timeout');
}

function setupPanelDom() {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
    url: 'https://chatgpt.com/c/test',
    pretendToBeVisual: true,
  });
  const { window } = dom;
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const originalHTMLElement = globalThis.HTMLElement;
  const originalHTMLTextAreaElement = globalThis.HTMLTextAreaElement;
  const originalEvent = globalThis.Event;
  const originalInputEvent = globalThis.InputEvent;
  const originalFetch = globalThis.fetch;
  const originalChrome = globalThis.chrome;
  const originalGetComputedStyle = globalThis.getComputedStyle;
  const originalGetSelection = globalThis.getSelection;

  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.HTMLTextAreaElement = window.HTMLTextAreaElement;
  globalThis.Event = window.Event;
  globalThis.InputEvent = window.InputEvent;
  globalThis.getComputedStyle = window.getComputedStyle.bind(window);
  globalThis.getSelection = () => ({ toString: () => 'selected ChatGPT reply' });

  Object.defineProperty(window.HTMLElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    value() {
      return { width: 100, height: 24, top: 0, right: 100, bottom: 24, left: 0 };
    },
  });

  return {
    window,
    document: window.document,
    restore() {
      globalThis.document = originalDocument;
      globalThis.window = originalWindow;
      globalThis.HTMLElement = originalHTMLElement;
      globalThis.HTMLTextAreaElement = originalHTMLTextAreaElement;
      globalThis.Event = originalEvent;
      globalThis.InputEvent = originalInputEvent;
      globalThis.fetch = originalFetch;
      globalThis.chrome = originalChrome;
      globalThis.getComputedStyle = originalGetComputedStyle;
      globalThis.getSelection = originalGetSelection;
      setBridgeClientConfig({ pairingToken: null });
      dom.window.close();
    },
  };
}

test('loop panel status maps bridge loop stages into user-visible status text', () => {
  assert.deepEqual(createLoopPanelStatus('codex-output-ready'), {
    kind: 'idle',
    label: '待处理',
    detail: '可以填入下一条交接内容',
  });
  assert.deepEqual(createLoopPanelStatus('chatgpt-awaiting-user-send'), {
    kind: 'blocked',
    label: '等待发送',
    detail: '手动发送后，选择回复并点击预览回传',
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

test('Bridge Panel source implements the approved four-stage guarded utility UI', async () => {
  const source = await readFile(resolve(root, 'apps/extension/src/ui/bridge-panel.tsx'), 'utf8');

  assert.match(source, /1 连接 · 2 发送至 ChatGPT · 3 选择并预览 · 4 确认回传/);
  assert.match(source, /collapseButton/);
  assert.match(source, /createLucideChevronIcon/);
  assert.match(source, /renderLucideChevronIcon/);
  assert.match(source, /prefers-color-scheme: dark/);
  assert.match(source, /aria-live/);
  assert.match(source, /returnInFlight/);
  assert.match(source, /updateActionState/);
  assert.match(source, /onEvent/);
  assert.match(source, /data-cli-bridge-host-theme/);
  assert.match(source, /isDarkHost/);
  assert.match(source, /minHeight: '44px'/);
  assert.equal(source.includes('requestSubmit'), false);
  assert.equal(source.includes('KeyboardEvent'), false);
});

test('Bridge Panel disables guarded actions while unpaired and keeps one active primary action', async () => {
  const { mountBridgePanel } = await loadBridgePanelModule();
  const env = setupPanelDom();
  try {
    const handle = mountBridgePanel(env.document);
    const buttons = Array.from(handle.element.querySelectorAll('button'));
    const actionButtons = buttons.filter((button) => [
      '填入下一步',
      '预览回传',
      '确认回传',
      '复制预览',
    ].includes(button.textContent ?? ''));

    assert.deepEqual(actionButtons.map((button) => button.disabled), [true, true, true, true]);
    assert.equal(actionButtons.filter((button) => button.style.fontWeight === '700').length, 0);
  } finally {
    env.restore();
  }
});

test('Bridge Panel collapse hides the workflow body despite inline layout styles', async () => {
  const { mountBridgePanel } = await loadBridgePanelModule();
  const env = setupPanelDom();
  try {
    const handle = mountBridgePanel(env.document);
    const collapse = handle.element.querySelector('button[aria-label="收起面板"]');
    const body = Array.from(handle.element.children)
      .find((child) => child.tagName === 'DIV' && child !== handle.element.firstElementChild);

    assert.equal(collapse.title, '收起');
    assert.match(collapse.querySelector('path').getAttribute('d'), /m18 15-6-6-6 6/);
    collapse.click();
    assert.equal(collapse.getAttribute('aria-label'), '展开面板');
    assert.equal(collapse.title, '展开');
    assert.equal(collapse.getAttribute('aria-expanded'), 'false');
    assert.match(collapse.querySelector('path').getAttribute('d'), /m6 9 6 6 6-6/);
    assert.equal(body.hidden, true);
    assert.equal(body.style.display, 'none');

    collapse.click();
    assert.equal(collapse.getAttribute('aria-label'), '收起面板');
    assert.equal(collapse.title, '收起');
    assert.equal(collapse.getAttribute('aria-expanded'), 'true');
    assert.match(collapse.querySelector('path').getAttribute('d'), /m18 15-6-6-6 6/);
    assert.equal(body.hidden, false);
    assert.equal(body.style.display, 'grid');
  } finally {
    env.restore();
  }
});

test('Bridge Panel connected workflow exposes one primary action per stage and locks return retries', async () => {
  const { mountBridgePanel } = await loadBridgePanelModule();
  const env = setupPanelDom();
  const calls = [];
  let releaseReturn;
  let handle;
  try {
    globalThis.chrome = {
      storage: {
        session: {
          get: async () => ({ cliBridgePairingToken: 'tok-123' }),
          remove: async () => {},
        },
      },
    };
    globalThis.fetch = async (url, init = {}) => {
      const path = new URL(String(url)).pathname;
      calls.push({ path, method: init.method ?? 'GET' });
      if (path === '/health/private') {
        return { ok: true, status: 200, json: async () => ({ status: 'ok' }) };
      }
      if (path === '/bridge/packets') {
        return { ok: true, status: 201, json: async () => ({ packet: { id: 'pkt-1' } }) };
      }
      if (path === '/bridge/outbound/next') {
        return { ok: true, status: 200, json: async () => ({ outboundPrompt: null }) };
      }
      if (path === '/bridge/extract-return') {
        await new Promise((resolve) => { releaseReturn = resolve; });
        return { ok: true, status: 201, json: async () => ({ routedTo: 'pending-prompt' }) };
      }
      throw new Error(`unexpected fetch path ${path}`);
    };

    const composer = env.document.createElement('textarea');
    composer.setAttribute('data-testid', 'prompt-textarea');
    env.document.body.append(composer);

    handle = mountBridgePanel(env.document);
    const byLabel = (label) => Array.from(handle.element.querySelectorAll('button'))
      .find((button) => button.textContent === label);
    const primaryLabels = () => Array.from(handle.element.querySelectorAll('button'))
      .filter((button) => button.style.fontWeight === '700')
      .map((button) => button.textContent);

    await waitForPanel(() => primaryLabels().includes('填入下一步'));
    assert.deepEqual(primaryLabels(), ['填入下一步']);

    byLabel('填入下一步').click();
    await waitForPanel(() => primaryLabels().includes('预览回传'));
    assert.deepEqual(primaryLabels(), ['预览回传']);

    byLabel('预览回传').click();
    assert.deepEqual(primaryLabels(), ['确认回传']);
    assert.equal(byLabel('预览回传').disabled, false);

    byLabel('确认回传').click();
    byLabel('确认回传').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(calls.filter((call) => call.path === '/bridge/extract-return').length, 1);
    assert.equal(byLabel('确认回传').disabled, true);

    releaseReturn();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(byLabel('确认回传').disabled, true);
  } finally {
    handle?.element.querySelectorAll('button').forEach((button) => {
      if (button.textContent === '清除配对') {
        button.click();
      }
    });
    env.restore();
  }
});

test('extension popup follows host theme and exposes accessible status feedback', async () => {
  const source = await readFile(resolve(root, 'apps/extension/src/popup/index.ts'), 'utf8');
  assert.match(source, /color-scheme: light dark/);
  assert.match(source, /prefers-color-scheme: dark/);
  assert.match(source, /aria-live/);
  assert.match(source, /minHeight: '44px'/);
});
