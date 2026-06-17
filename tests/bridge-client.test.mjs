import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createPacket,
  claimNextOutboundPrompt,
  clearPairingTokenFromStorage,
  createPendingPrompt,
  getBridgeClientConfig,
  getMetrics,
  hasPairingToken,
  loadPairingTokenFromStorage,
  savePairingTokenToStorage,
  setBridgeClientConfig,
  testPrivateHealth,
} from '../apps/extension/src/content/bridge-client.ts';
import { PAIRING_TOKEN_HEADER } from '../packages/shared/src/constants.ts';

function withFakeChromeStorage(initial = {}) {
  const store = { ...initial };
  const original = globalThis.chrome;
  globalThis.chrome = {
    storage: {
      local: {
        async get(key) {
          return key in store ? { [key]: store[key] } : {};
        },
        async set(obj) {
          Object.assign(store, obj);
        },
        async remove(key) {
          delete store[key];
        },
      },
    },
  };
  return {
    store,
    restore() {
      globalThis.chrome = original;
    },
  };
}

function withStubbedFetch(fn) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return {
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    };
  };
  return Promise.resolve(fn(calls)).finally(() => {
    globalThis.fetch = original;
  });
}

test('bridge client does not call fetch without a pairing token', async () => {
  setBridgeClientConfig({ baseUrl: 'http://127.0.0.1:31337', pairingToken: null });
  assert.equal(hasPairingToken(), false);

  await withStubbedFetch(async (calls) => {
    const result = await createPacket('s1', 'hello');
    assert.equal(result.ok, false);
    assert.equal(result.error, 'no-pairing-token');
    assert.equal(calls.length, 0, 'must not call fetch when unpaired');
  });
});

test('bridge client sends pairing token header and JSON body when paired', async () => {
  setBridgeClientConfig({ baseUrl: 'http://127.0.0.1:31337', pairingToken: 'tok-123' });
  assert.equal(hasPairingToken(), true);

  await withStubbedFetch(async (calls) => {
    const result = await createPendingPrompt('s1', 'next prompt');
    assert.equal(result.ok, true);
    assert.equal(calls.length, 1);
    const [call] = calls;
    assert.equal(call.url, 'http://127.0.0.1:31337/bridge/pending-prompts');
    assert.equal(call.init.method, 'POST');
    assert.equal(call.init.headers[PAIRING_TOKEN_HEADER], 'tok-123');
    assert.deepEqual(JSON.parse(call.init.body), { sessionId: 's1', prompt: 'next prompt' });
  });
});

test('bridge client uses GET without a body for metrics', async () => {
  setBridgeClientConfig({ baseUrl: 'http://127.0.0.1:31337', pairingToken: 'tok-123' });

  await withStubbedFetch(async (calls) => {
    await getMetrics();
    const [call] = calls;
    assert.equal(call.url, 'http://127.0.0.1:31337/bridge/metrics');
    assert.equal(call.init.method, 'GET');
    assert.equal(call.init.body, undefined);
  });
});

test('bridge client can claim next outbound prompt with GET', async () => {
  setBridgeClientConfig({ baseUrl: 'http://127.0.0.1:31337', pairingToken: 'tok-123' });

  await withStubbedFetch(async (calls) => {
    await claimNextOutboundPrompt();
    const [call] = calls;
    assert.equal(call.url, 'http://127.0.0.1:31337/bridge/outbound/next');
    assert.equal(call.init.method, 'GET');
    assert.equal(call.init.body, undefined);
  });
});

test('bridge client reports network errors without throwing', async () => {
  setBridgeClientConfig({ baseUrl: 'http://127.0.0.1:31337', pairingToken: 'tok-123' });
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error('boom');
  };
  try {
    const result = await createPacket('s1', 'hello');
    assert.equal(result.ok, false);
    assert.equal(result.error, 'network-error');
  } finally {
    globalThis.fetch = original;
  }
});

test('bridge client config is readable and resettable', () => {
  setBridgeClientConfig({ baseUrl: 'http://127.0.0.1:9999', pairingToken: 'abc' });
  const config = getBridgeClientConfig();
  assert.equal(config.baseUrl, 'http://127.0.0.1:9999');
  assert.equal(config.pairingToken, 'abc');
  setBridgeClientConfig({ pairingToken: null });
  assert.equal(getBridgeClientConfig().pairingToken, null);
});

test('savePairingTokenToStorage writes chrome.storage.local and updates cached config', async () => {
  setBridgeClientConfig({ baseUrl: 'http://127.0.0.1:31337', pairingToken: null });
  const fake = withFakeChromeStorage();
  try {
    const ok = await savePairingTokenToStorage('  tok-xyz  ');
    assert.equal(ok, true);
    assert.equal(getBridgeClientConfig().pairingToken, 'tok-xyz', 'trims and caches token');
    assert.equal(fake.store.cliBridgePairingToken, 'tok-xyz', 'persists to storage');
    assert.equal(hasPairingToken(), true);
  } finally {
    fake.restore();
  }
});

test('savePairingTokenToStorage rejects an empty token', async () => {
  setBridgeClientConfig({ baseUrl: 'http://127.0.0.1:31337', pairingToken: null });
  const fake = withFakeChromeStorage();
  try {
    const ok = await savePairingTokenToStorage('   ');
    assert.equal(ok, false);
    assert.equal(hasPairingToken(), false);
    assert.equal('cliBridgePairingToken' in fake.store, false);
  } finally {
    fake.restore();
  }
});

test('clearPairingTokenFromStorage removes storage and clears cached config', async () => {
  setBridgeClientConfig({ baseUrl: 'http://127.0.0.1:31337', pairingToken: 'tok-xyz' });
  const fake = withFakeChromeStorage({ cliBridgePairingToken: 'tok-xyz' });
  try {
    await clearPairingTokenFromStorage();
    assert.equal(getBridgeClientConfig().pairingToken, null);
    assert.equal('cliBridgePairingToken' in fake.store, false);
    assert.equal(hasPairingToken(), false);
  } finally {
    fake.restore();
  }
});

test('loadPairingTokenFromStorage clears a stale cached token when storage is empty', async () => {
  setBridgeClientConfig({ baseUrl: 'http://127.0.0.1:31337', pairingToken: 'stale-token' });
  const fake = withFakeChromeStorage();
  try {
    assert.equal(await loadPairingTokenFromStorage(), null);
    assert.equal(hasPairingToken(), false);
  } finally {
    fake.restore();
  }
});

test('testPrivateHealth maps unpaired, connected, unauthorized, and network-error', async () => {
  setBridgeClientConfig({ baseUrl: 'http://127.0.0.1:31337', pairingToken: null });
  assert.equal(await testPrivateHealth(), 'unpaired');

  setBridgeClientConfig({ pairingToken: 'tok-123' });
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({ ok: true, status: 200 });
    assert.equal(await testPrivateHealth(), 'connected');

    globalThis.fetch = async () => ({ ok: false, status: 403 });
    assert.equal(await testPrivateHealth(), 'unauthorized');

    globalThis.fetch = async () => ({ ok: false, status: 500 });
    assert.equal(await testPrivateHealth(), 'network-error');

    globalThis.fetch = async () => {
      throw new Error('down');
    };
    assert.equal(await testPrivateHealth(), 'network-error');
  } finally {
    globalThis.fetch = original;
  }
});

function withFakeChromeRuntime(handler) {
  const original = globalThis.chrome;
  globalThis.chrome = {
    runtime: {
      lastError: undefined,
      sendMessage(message, cb) {
        handler(message, cb);
      },
    },
  };
  return {
    restore() {
      globalThis.chrome = original;
    },
  };
}

test('bridgeFetch delegates to the background proxy when chrome.runtime.sendMessage exists', async () => {
  setBridgeClientConfig({ baseUrl: 'http://127.0.0.1:31337', pairingToken: 'tok-123' });
  let captured = null;
  const fetchCalls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (...args) => {
    fetchCalls.push(args);
    return { ok: true, status: 200, json: async () => ({}) };
  };
  const fake = withFakeChromeRuntime((message, cb) => {
    captured = message;
    cb({ ok: true, status: 201, data: { outboundPrompt: { id: 'o1' } } });
  });
  try {
    const result = await createPacket('s1', 'hello');
    assert.equal(result.ok, true);
    assert.equal(result.status, 201);
    assert.equal(captured.type, 'cli-bridge-proxy-fetch');
    assert.equal(captured.path, '/bridge/packets');
    assert.equal(captured.method, 'POST');
    assert.equal(captured.token, 'tok-123');
    assert.deepEqual(captured.body, { sessionId: 's1', content: 'hello' });
    assert.equal(fetchCalls.length, 0, 'must not direct-fetch when proxying');
  } finally {
    fake.restore();
    globalThis.fetch = originalFetch;
  }
});

test('bridgeFetch reports network-error when the proxy returns no response', async () => {
  setBridgeClientConfig({ baseUrl: 'http://127.0.0.1:31337', pairingToken: 'tok-123' });
  const fake = withFakeChromeRuntime((_message, cb) => cb(undefined));
  try {
    const result = await getMetrics();
    assert.equal(result.ok, false);
    assert.equal(result.error, 'network-error');
  } finally {
    fake.restore();
  }
});

test('testPrivateHealth uses the background proxy and maps its results', async () => {
  setBridgeClientConfig({ baseUrl: 'http://127.0.0.1:31337', pairingToken: 'tok-123' });
  let lastPath = null;
  let response = { ok: true, status: 200 };
  const fake = withFakeChromeRuntime((message, cb) => {
    lastPath = message.path;
    cb(response);
  });
  try {
    response = { ok: true, status: 200 };
    assert.equal(await testPrivateHealth(), 'connected');
    assert.equal(lastPath, '/health/private');

    response = { ok: false, status: 403, error: 'Invalid pairing token' };
    assert.equal(await testPrivateHealth(), 'unauthorized');

    response = { ok: false, status: 0, error: 'network-error' };
    assert.equal(await testPrivateHealth(), 'network-error');
  } finally {
    fake.restore();
  }
});
