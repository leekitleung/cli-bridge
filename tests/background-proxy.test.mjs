import assert from 'node:assert/strict';
import test from 'node:test';

import {
  allowContentScriptSessionStorage,
  handleProxyFetch,
} from '../apps/extension/src/background/index.ts';
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
