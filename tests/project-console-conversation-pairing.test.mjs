// Conversation Pairing — UI contract tests.
// These verify the conversation pairing feature end-to-end through jsdom.

import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

import { renderProjectConsoleHtml } from '../apps/local-server/src/routes/project-console.ts';

async function waitFor(predicate, timeoutMs = 500) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await new Promise(r => setTimeout(r, 10));
  }
  throw new Error('waitFor timeout after ' + timeoutMs + 'ms');
}

function setupConsole() {
  const html = renderProjectConsoleHtml();
  const dom = new JSDOM(html, {
    url: 'http://localhost:9300/console/project',
    runScripts: 'dangerously',
    resources: 'usable',
  });
  const { window } = dom;
  const { document } = window;
  const storage = {};
  Object.defineProperty(window, 'localStorage', {
    value: {
      getItem: (key) => storage[key] ?? null,
      setItem: (key, value) => { storage[key] = value; },
    },
    writable: true,
  });
  const fetchCalls = [];
  const fetchFixtures = {};
  function setFixture(path, response) { fetchFixtures[path] = response; }
  window.fetch = async (url, init = {}) => {
    const path = typeof url === 'string' ? new URL(url).pathname : url;
    const body = init.body ? JSON.parse(init.body) : null;
    fetchCalls.push({ path, method: init.method || 'GET', body });
    const fixture = fetchFixtures[path];
    if (fixture) {
      return { ok: fixture.ok !== false, status: fixture.status ?? 200, json: async () => fixture.payload ?? {} };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  };
  return { window, document, dom, fetchCalls, setFixture, storage };
}

// ─── Tests ────────────────────────────────────────────────

test('conversation pairing heading and endpoint selectors appear', async () => {
  const { document, setFixture } = setupConsole();

  setFixture('/bridge/metrics', { ok: true, payload: {} });
  setFixture('/bridge/status', { ok: true, payload: { connected: false } });

  document.getElementById('token').value = 'test';
  document.getElementById('connect').click();
  await waitFor(() => document.getElementById('conn-dot').classList.contains('ok'));

  setFixture('/bridge/endpoints', {
    ok: true,
    payload: {
      endpoints: [
        { id: 'chatgpt-web', label: 'ChatGPT Web', transport: 'web-dom', status: 'online', capabilities: { canAcceptPrompt: true, canReturnOutput: true } },
        { id: 'codex-cli', label: 'Codex CLI', transport: 'managed-pty', status: 'online', capabilities: { canAcceptPrompt: true, canReturnOutput: true } },
        { id: 'claude-code-command', label: 'Claude Code Review', transport: 'command', status: 'online', capabilities: { canReview: true, canReturnOutput: true } },
        { id: 'codex-command', label: 'Codex Review', transport: 'command', status: 'online', capabilities: { canReview: true, canReturnOutput: true } },
        { id: 'workbuddy', label: 'WorkBuddy Executor', transport: 'workbuddy', status: 'online', capabilities: { canExecute: true, canAcceptPrompt: true, canReturnOutput: true } },
      ],
    },
  });
  setFixture('/bridge/projects/cli-bridge/conversation-pairing', { ok: true, payload: { pairing: null } });

  document.getElementById('composer-pairing').click();
  await waitFor(() => document.getElementById('conversation-pairing-context'));

  const heading = document.getElementById('conversation-pairing-context').textContent;
  assert.match(heading, /Conversation Pairing/);

  const sourceSelect = document.getElementById('conversation-source');
  const targetSelect = document.getElementById('conversation-target');
  assert.ok(sourceSelect, 'source selector exists');
  assert.ok(targetSelect, 'target selector exists');

  const sourceText = sourceSelect.textContent;
  const targetText = targetSelect.textContent;
  assert.match(sourceText, /ChatGPT Web/);
  assert.match(targetText, /Codex CLI/);
  assert.match(targetText, /Claude Code Review/);
  assert.match(targetText, /Codex Review/);
  assert.match(targetText, /WorkBuddy Executor/);
});

test('pairing save uses conversation-pairing endpoint not team-preset', async () => {
  const { document, fetchCalls, setFixture } = setupConsole();

  setFixture('/bridge/metrics', { ok: true, payload: {} });
  setFixture('/bridge/status', { ok: true, payload: { connected: false } });

  document.getElementById('token').value = 'test';
  document.getElementById('connect').click();
  await waitFor(() => document.getElementById('conn-dot').classList.contains('ok'));

  setFixture('/bridge/endpoints', {
    ok: true,
    payload: {
      endpoints: [
        { id: 'chatgpt-web', label: 'ChatGPT Web', transport: 'web-dom', status: 'online', capabilities: { canAcceptPrompt: true, canReturnOutput: true } },
        { id: 'workbuddy', label: 'WorkBuddy Executor', transport: 'workbuddy', status: 'online', capabilities: { canExecute: true, canAcceptPrompt: true, canReturnOutput: true } },
      ],
    },
  });
  setFixture('/bridge/projects/cli-bridge/conversation-pairing', { ok: true, payload: { pairing: null } });

  document.getElementById('composer-pairing').click();
  await waitFor(() => document.getElementById('pairing-save'));

  document.getElementById('conversation-source').value = 'chatgpt-web';
  document.getElementById('conversation-target').value = 'workbuddy';

  setFixture('/bridge/projects/cli-bridge/conversation-pairing', {
    ok: true,
    payload: {
      pairing: { projectId: 'cli-bridge', sourceEndpointId: 'chatgpt-web', targetEndpointId: 'workbuddy' },
    },
  });
  document.getElementById('pairing-save').click();

  await waitFor(() => document.getElementById('command-status').textContent === 'pairing saved');

  const saveCall = fetchCalls.find(
    (call) => call.path === '/bridge/projects/cli-bridge/conversation-pairing' && call.method === 'PUT'
  );
  assert.ok(saveCall, 'expected PUT /conversation-pairing');

  // Must NOT call the old team-preset endpoint from pairing UI
  const legacyCall = fetchCalls.find(
    (call) => call.path === '/bridge/projects/cli-bridge/team-preset'
  );
  assert.equal(legacyCall, undefined, 'must not call /team-preset from pairing UI');
});

test('conversation mode routes text to message endpoint and renders transcript', async () => {
  const { document, fetchCalls, setFixture } = setupConsole();

  setFixture('/bridge/metrics', { ok: true, payload: {} });
  setFixture('/bridge/status', { ok: true, payload: { connected: false } });

  document.getElementById('token').value = 'test';
  document.getElementById('connect').click();
  await waitFor(() => document.getElementById('conn-dot').classList.contains('ok'));

  setFixture('/bridge/projects/cli-bridge/conversation-pairing', {
    ok: true,
    payload: { pairing: { sourceEndpointId: 'chatgpt-web', targetEndpointId: 'workbuddy' } },
  });
  setFixture('/bridge/projects/cli-bridge/conversation/messages', {
    ok: true,
    payload: {
      events: [
        { id: 'ev-1', projectId: 'cli-bridge', role: 'user', text: 'hi draft', status: 'queued', routeKind: 'workbuddy-execution', kind: 'user_message', visibility: 'user', createdAt: Date.now() },
        { id: 'ev-2', projectId: 'cli-bridge', role: 'bridge', text: 'Queued for WorkBuddy execution flow.', status: 'queued', routeKind: 'workbuddy-execution', kind: 'status', visibility: 'user', createdAt: Date.now() },
      ],
    },
  });

  document.getElementById('composer-mode-toggle').click();
  await waitFor(() => document.getElementById('composer-mode-toggle').textContent === 'Conversation');

  document.getElementById('command-input').value = 'hi draft';
  document.getElementById('command-send').click();

  await waitFor(() => {
    const el = document.getElementById('conversation-transcript');
    return el && el.style.display !== 'none' && el.textContent.includes('hi draft');
  });

  const post = fetchCalls.find(
    (call) => call.path === '/bridge/projects/cli-bridge/conversation/messages' && call.method === 'POST'
  );
  assert.ok(post, 'expected conversation message POST');
  assert.equal(post.body.text, 'hi draft');
  assert.equal(fetchCalls.some(c => c.path === '/bridge/goals' && c.method === 'POST'), false);
});
