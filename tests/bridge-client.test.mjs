import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createPacket,
  claimNextOutboundPrompt,
  createPendingPrompt,
  getBridgeClientConfig,
  getMetrics,
  hasPairingToken,
  setBridgeClientConfig,
} from '../apps/extension/src/content/bridge-client.ts';
import { PAIRING_TOKEN_HEADER } from '../packages/shared/src/constants.ts';

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
