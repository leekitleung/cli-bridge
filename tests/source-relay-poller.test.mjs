import assert from 'node:assert/strict';
import test from 'node:test';

import {
  setBridgeClientConfig,
  hasPairingToken,
} from '../apps/extension/src/content/bridge-client.ts';
import {
  startSourceRelayPoller,
} from '../apps/extension/src/content/source-relay-poller.ts';

function withFakeChromeSession(token, fn) {
  const original = globalThis.chrome;
  globalThis.chrome = {
    storage: {
      session: {
        async get(key) {
          return key === 'cliBridgePairingToken' && token
            ? { cliBridgePairingToken: token }
            : {};
        },
      },
    },
  };
  return Promise.resolve(fn()).finally(() => {
    globalThis.chrome = original;
    setBridgeClientConfig({ pairingToken: null });
  });
}

test('source relay poller refreshes session token before declaring itself unpaired', async () => {
  setBridgeClientConfig({
    baseUrl: 'http://127.0.0.1:31337',
    pairingToken: null,
  });

  await withFakeChromeSession('tok-from-session', async () => {
    const originalFetch = globalThis.fetch;
    const calls = [];
    globalThis.fetch = async (url, init = {}) => {
      calls.push({ url: String(url), init });
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true }),
      };
    };

    try {
      const events = [];
      const handle = startSourceRelayPoller({
        intervalMs: 60_000,
        setIntervalFn: () => 1,
        clearIntervalFn: () => {},
        isStreaming: () => false,
        onEvent(event) {
          events.push(event);
        },
      });

      await handle.tick();
      handle.stop();

      assert.equal(hasPairingToken(), true);
      assert.equal(calls.length, 1);
      assert.equal(new URL(calls[0].url).pathname, '/bridge/source/chatgpt-web/heartbeat');
      assert.equal(calls[0].init.headers['x-cli-bridge-pairing-token'], 'tok-from-session');
      assert.deepEqual(events, [{ type: 'heartbeat', ok: true }]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
