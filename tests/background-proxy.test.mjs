import assert from 'node:assert/strict';
import test from 'node:test';

import {
  allowContentScriptSessionStorage,
  handleProxyFetch,
  handleSourceRelayOwnerRegister,
  handleSourceRelayOwnerWake,
} from '../apps/extension/src/background/index.ts';
import {
  SOURCE_RELAY_TICK_MESSAGE,
} from '../apps/extension/src/source-relay-messages.ts';
import { PAIRING_TOKEN_HEADER, LOCAL_SERVER_BASE_URL } from '../packages/shared/src/constants.ts';

function stubFetch(impl) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    return impl(url, init);
  };
  return { calls, fetchImpl };
}

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

test('allowContentScriptSessionStorage exposes session storage to content scripts', async () => {
  const calls = [];
  const session = {
    async setAccessLevel(options) {
      calls.push({ thisArg: this, options });
    },
  };

  const ok = await allowContentScriptSessionStorage({ storage: { session } });

  assert.equal(ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].thisArg, session);
  assert.deepEqual(calls[0].options, {
    accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS',
  });
});

test('allowContentScriptSessionStorage no-ops when access level API is unavailable', async () => {
  assert.equal(await allowContentScriptSessionStorage(undefined), false);
  assert.equal(await allowContentScriptSessionStorage({ storage: { session: {} } }), false);
});

test('allowContentScriptSessionStorage fails closed when Chrome rejects access level setup', async () => {
  const ok = await allowContentScriptSessionStorage({
    storage: {
      session: {
        async setAccessLevel() {
          throw new Error('unsupported');
        },
      },
    },
  });

  assert.equal(ok, false);
});

test('handleProxyFetch accepts /health/private GET and attaches the pairing token', async () => {
  const { calls, fetchImpl } = stubFetch(() => jsonResponse(200, { status: 'ok' }));
  const result = await handleProxyFetch(
    { path: '/health/private', method: 'GET', token: 'tok-123' },
    fetchImpl,
  );

  assert.deepEqual(result, { ok: true, status: 200, data: { status: 'ok' } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${LOCAL_SERVER_BASE_URL}/health/private`);
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(calls[0].init.headers[PAIRING_TOKEN_HEADER], 'tok-123');
  assert.equal(calls[0].init.body, undefined);
});

test('handleProxyFetch accepts /bridge/outbound POST and serializes the body', async () => {
  const { calls, fetchImpl } = stubFetch(() => jsonResponse(201, { outboundPrompt: { id: 'o1' } }));
  const result = await handleProxyFetch(
    { path: '/bridge/outbound', method: 'POST', body: { sessionId: 's1', prompt: 'p' }, token: 'tok' },
    fetchImpl,
  );

  assert.equal(result.ok, true);
  assert.equal(result.status, 201);
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers['content-type'], 'application/json');
  assert.deepEqual(JSON.parse(calls[0].init.body), { sessionId: 's1', prompt: 'p' });
});

test('handleProxyFetch accepts Stage B outbound stage route', async () => {
  const { calls, fetchImpl } = stubFetch(() => jsonResponse(200, { outboundPrompt: { id: 'o1' } }));
  const result = await handleProxyFetch(
    {
      path: '/bridge/outbound/stage',
      method: 'POST',
      body: { outboundPromptId: 'o1', stage: 'submitted' },
      token: 'tok',
    },
    fetchImpl,
  );

  assert.equal(result.ok, true);
  assert.equal(calls[0].url, `${LOCAL_SERVER_BASE_URL}/bridge/outbound/stage`);
  assert.deepEqual(JSON.parse(calls[0].init.body), { outboundPromptId: 'o1', stage: 'submitted' });
});

test('handleProxyFetch rejects a full URL as path', async () => {
  const { calls, fetchImpl } = stubFetch(() => jsonResponse(200, {}));
  const result = await handleProxyFetch(
    { path: 'http://evil.example/steal', method: 'GET', token: 'tok' },
    fetchImpl,
  );
  assert.deepEqual(result, { ok: false, status: 0, error: 'invalid-path' });
  assert.equal(calls.length, 0, 'must not fetch a rejected path');
});

test('handleProxyFetch rejects protocol-relative and newline paths', async () => {
  const { calls, fetchImpl } = stubFetch(() => jsonResponse(200, {}));
  assert.equal((await handleProxyFetch({ path: '//evil/x', method: 'GET' }, fetchImpl)).error, 'invalid-path');
  assert.equal((await handleProxyFetch({ path: '/bridge/x\nHost: y', method: 'GET' }, fetchImpl)).error, 'invalid-path');
  assert.equal(calls.length, 0);
});

test('handleProxyFetch rejects an unsupported path outside /health/private and /bridge/*', async () => {
  const { calls, fetchImpl } = stubFetch(() => jsonResponse(200, {}));
  const result = await handleProxyFetch({ path: '/secret', method: 'GET', token: 'tok' }, fetchImpl);
  assert.deepEqual(result, { ok: false, status: 0, error: 'invalid-path' });
  assert.equal(calls.length, 0);
});

test('handleProxyFetch rejects unlisted /bridge paths even though they share the prefix', async () => {
  const { calls, fetchImpl } = stubFetch(() => jsonResponse(200, {}));
  const result = await handleProxyFetch({ path: '/bridge/projects', method: 'GET', token: 'tok' }, fetchImpl);
  assert.deepEqual(result, { ok: false, status: 0, error: 'invalid-path' });
  assert.equal(calls.length, 0);
});

test('handleProxyFetch rejects an unsupported method', async () => {
  const { calls, fetchImpl } = stubFetch(() => jsonResponse(200, {}));
  const result = await handleProxyFetch({ path: '/bridge/outbound', method: 'DELETE', token: 'tok' }, fetchImpl);
  assert.deepEqual(result, { ok: false, status: 0, error: 'invalid-method' });
  assert.equal(calls.length, 0);
});

test('handleProxyFetch maps a fetch throw to network-error', async () => {
  const fetchImpl = async () => {
    throw new Error('boom');
  };
  const result = await handleProxyFetch({ path: '/health/private', method: 'GET', token: 'tok' }, fetchImpl);
  assert.deepEqual(result, { ok: false, status: 0, error: 'network-error' });
});

test('handleProxyFetch maps a non-2xx response to an error result with the server message', async () => {
  const { fetchImpl } = stubFetch(() => jsonResponse(403, { status: 'error', message: 'Invalid pairing token' }));
  const result = await handleProxyFetch({ path: '/health/private', method: 'GET', token: 'bad' }, fetchImpl);
  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
  assert.equal(result.error, 'Invalid pairing token');
});

test('handleProxyFetch omits the token header when no token is provided', async () => {
  const { calls, fetchImpl } = stubFetch(() => jsonResponse(200, {}));
  await handleProxyFetch({ path: '/health/private', method: 'GET' }, fetchImpl);
  assert.equal(calls[0].init.headers[PAIRING_TOKEN_HEADER], undefined);
});

// ── ADR-0025 Task 4: extension claim from local console ──

test('background exchanges console claim nonce and stores extension session token', async () => {
  const stored = {};
  global.chrome = {
    storage: {
      session: {
        set: async (value) => Object.assign(stored, value),
        get: async (key) => ({ [key]: stored[key] }),
      },
    },
    runtime: { onMessage: { addListener: () => {} } },
  };

  const { handleConsoleAutoPairClaim } = await import(
    '../apps/extension/src/background/index.ts'
  );

  const result = await handleConsoleAutoPairClaim('claim-abc', async (_url, init) => {
    assert.equal(init.method, 'POST');
    assert.equal(JSON.parse(init.body).nonce, 'claim-abc');
    // The background must NOT manually set an Origin header; the browser
    // controls it automatically for extension service worker requests.
    assert.equal('origin' in (init.headers || {}), false);
    return { ok: true, status: 200, json: async () => ({ extensionSessionToken: 'ext-session' }) };
  });

  assert.equal(result.ok, true);
  assert.equal(stored.cliBridgePairingToken, 'ext-session');
});

// ── ADR-0025 Task 5: background clear local session ──

test('background clears local session token on revoke', async () => {
  // Simulate a token already stored, then clear it.
  const stored = { cliBridgePairingToken: 'ext-session' };

  global.chrome = {
    storage: {
      session: {
        set: async () => {},
        get: async (key) => ({ [key]: stored[key] }),
        remove: async (key) => { delete stored[key]; },
      },
    },
    runtime: { onMessage: { addListener: () => {} } },
  };

  const { handleClearLocalSession } = await import(
    '../apps/extension/src/background/index.ts'
  );

  assert.equal(stored.cliBridgePairingToken, 'ext-session');
  const result = await handleClearLocalSession();
  assert.equal(result.ok, true);
  assert.equal(stored.cliBridgePairingToken, undefined);
});

test('background wakes the registered ChatGPT source relay owner tab', async () => {
  const sentMessages = [];
  const chromeApi = {
    tabs: {
      async sendMessage(tabId, message) {
        sentMessages.push({ tabId, message });
        return { ok: true };
      },
    },
  };

  const registered = handleSourceRelayOwnerRegister({ tab: { id: 42 } });
  assert.deepEqual(registered, { ok: true, registered: true });

  const wake = await handleSourceRelayOwnerWake(chromeApi);

  assert.deepEqual(wake, { ok: true });
  assert.deepEqual(sentMessages, [
    { tabId: 42, message: { type: SOURCE_RELAY_TICK_MESSAGE } },
  ]);
});

test('background reports no source relay owner before a ChatGPT tab registers', async () => {
  handleSourceRelayOwnerRegister({ tab: { id: 77 } });
  const chromeApi = {
    tabs: {
      async sendMessage() {
        throw new Error('closed');
      },
    },
  };

  assert.deepEqual(await handleSourceRelayOwnerWake(chromeApi), {
    ok: false,
    reason: 'send-failed',
  });
  assert.deepEqual(await handleSourceRelayOwnerWake(chromeApi), {
    ok: false,
    reason: 'no-owner',
  });
});

// ── ADR-0033: Extension proxy must not expose WorkBuddy executor routes ──

test('extension proxy does not expose WorkBuddy executor routes', async () => {
  const { calls, fetchImpl } = stubFetch(() => jsonResponse(200, {}));

  const inbox = await handleProxyFetch({
    path: '/bridge/endpoints/workbuddy/inbox/next',
    method: 'GET',
    token: 'tok',
  }, fetchImpl);
  const result = await handleProxyFetch({
    path: '/bridge/endpoints/workbuddy/results',
    method: 'POST',
    token: 'tok',
    body: { taskId: 'task-1', ok: true },
  }, fetchImpl);
  const log = await handleProxyFetch({
    path: '/bridge/endpoints/workbuddy/log',
    method: 'POST',
    token: 'tok',
    body: { taskId: 'task-1', message: 'x' },
  }, fetchImpl);

  assert.equal(inbox.error, 'invalid-path');
  assert.equal(result.error, 'invalid-path');
  assert.equal(log.error, 'invalid-path');
  assert.equal(calls.length, 0);
});
