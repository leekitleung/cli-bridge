import assert from 'node:assert/strict';
import test from 'node:test';

import {
  setBridgeClientConfig,
} from '../apps/extension/src/content/bridge-client.ts';
import {
  startOutboundPromptPoller,
} from '../apps/extension/src/content/outbound-poller.ts';
import {
  clearActiveRelaySession,
  getActiveRelaySession,
} from '../apps/extension/src/content/active-relay-session.ts';

class FakeElement extends EventTarget {
  constructor(tagName, attributes = {}) {
    super();
    this.tagName = tagName.toUpperCase();
    this.value = '';
    this.textContent = '';
    this.attributes = new Map(Object.entries(attributes));
    this.rect = { width: 100, height: 20 };
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  closest() {
    return null;
  }

  focus() {}

  getBoundingClientRect() {
    return this.rect;
  }
}

function selectorMatches(element, selector) {
  const tagName = element.tagName.toLowerCase();
  if (selector.includes('textarea') && tagName !== 'textarea') {
    return false;
  }
  if (selector.includes('[data-testid="prompt-textarea"]')) {
    return element.getAttribute('data-testid') === 'prompt-textarea';
  }
  return selector === 'textarea' || selector.includes('textarea');
}

function createFakeRoot(elements) {
  return {
    querySelectorAll(selector) {
      return elements.filter((element) => selectorMatches(element, selector));
    },
  };
}

test('outbound poller fills composer and acknowledges delivery without submitting', async () => {
  setBridgeClientConfig({ baseUrl: 'http://127.0.0.1:31337', pairingToken: 'tok-123' });
  const composer = new FakeElement('textarea', {
    'data-testid': 'prompt-textarea',
  });
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith('/bridge/outbound/next')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          outboundPrompt: {
            id: 'out-1',
            sessionId: 's1',
            packetId: 'p1',
            prompt: 'review this output',
            status: 'claimed',
            target: 'chatgpt-web',
          },
        }),
      };
    }

    return {
      ok: true,
      status: 200,
      json: async () => ({ outboundPrompt: { id: 'out-1', status: 'delivered' } }),
    };
  };

  try {
    const timers = [];
    const poller = startOutboundPromptPoller({
      root: createFakeRoot([composer]),
      setIntervalFn(fn) {
        timers.push(fn);
        return 1;
      },
      clearIntervalFn() {},
    });

    const result = await poller.tick();
    poller.stop();

    assert.equal(result.ok, true);
    assert.equal(composer.value, 'review this output');
    assert.equal(calls.length, 2);
    assert.equal(calls[0].url, 'http://127.0.0.1:31337/bridge/outbound/next');
    assert.equal(calls[1].url, 'http://127.0.0.1:31337/bridge/outbound/ack');
    assert.deepEqual(JSON.parse(calls[1].init.body), {
      outboundPromptId: 'out-1',
      ok: true,
    });
    assert.equal(timers.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('outbound poller skips claiming and filling while ChatGPT is streaming', async () => {
  setBridgeClientConfig({ baseUrl: 'http://127.0.0.1:31337', pairingToken: 'tok-123' });
  const composer = new FakeElement('textarea', {
    'data-testid': 'prompt-textarea',
  });
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return {
      ok: true,
      status: 200,
      json: async () => ({ outboundPrompt: null }),
    };
  };

  try {
    const poller = startOutboundPromptPoller({
      root: createFakeRoot([composer]),
      isStreaming: () => true,
      setIntervalFn() {
        return 1;
      },
      clearIntervalFn() {},
    });

    const result = await poller.tick();
    poller.stop();

    assert.equal(result, null);
    assert.equal(calls.length, 0, 'must not hit the bridge while streaming');
    assert.equal(composer.value, '', 'must not fill the composer while streaming');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function outboundFetchStub(prompt) {
  return async (url) => {
    if (String(url).endsWith('/bridge/outbound/next')) {
      return { ok: true, status: 200, json: async () => ({ outboundPrompt: prompt }) };
    }
    return { ok: true, status: 200, json: async () => ({ outboundPrompt: { id: prompt.id, status: 'delivered' } }) };
  };
}

test('outbound poller records the active relay session after successful fill + ack', async () => {
  setBridgeClientConfig({ baseUrl: 'http://127.0.0.1:31337', pairingToken: 'tok-123' });
  clearActiveRelaySession();
  const composer = new FakeElement('textarea', { 'data-testid': 'prompt-textarea' });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = outboundFetchStub({
    id: 'out-rel', sessionId: 's-rel', packetId: 'pk-rel',
    prompt: 'review this', status: 'claimed', target: 'chatgpt-web',
  });
  try {
    const poller = startOutboundPromptPoller({
      root: createFakeRoot([composer]),
      setIntervalFn() { return 1; },
      clearIntervalFn() {},
    });
    await poller.tick();
    poller.stop();

    const active = getActiveRelaySession();
    assert.equal(active.sessionId, 's-rel');
    assert.equal(active.outboundPromptId, 'out-rel');
    assert.equal(active.packetId, 'pk-rel');
  } finally {
    globalThis.fetch = originalFetch;
    clearActiveRelaySession();
  }
});

test('outbound poller does not record an active relay session while streaming', async () => {
  setBridgeClientConfig({ baseUrl: 'http://127.0.0.1:31337', pairingToken: 'tok-123' });
  clearActiveRelaySession();
  const composer = new FakeElement('textarea', { 'data-testid': 'prompt-textarea' });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = outboundFetchStub({
    id: 'out-x', sessionId: 's-x', packetId: 'pk-x',
    prompt: 'p', status: 'claimed', target: 'chatgpt-web',
  });
  try {
    const poller = startOutboundPromptPoller({
      root: createFakeRoot([composer]),
      isStreaming: () => true,
      setIntervalFn() { return 1; },
      clearIntervalFn() {},
    });
    await poller.tick();
    poller.stop();
    assert.equal(getActiveRelaySession(), null);
  } finally {
    globalThis.fetch = originalFetch;
    clearActiveRelaySession();
  }
});

test('outbound poller does not record an active relay session when the fill fails', async () => {
  setBridgeClientConfig({ baseUrl: 'http://127.0.0.1:31337', pairingToken: 'tok-123' });
  clearActiveRelaySession();
  // Composer present but focus throws → fill fails fast (no slow locate wait).
  const composer = new FakeElement('textarea', { 'data-testid': 'prompt-textarea' });
  composer.focus = () => { throw new Error('focus denied'); };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = outboundFetchStub({
    id: 'out-f', sessionId: 's-f', packetId: 'pk-f',
    prompt: 'p', status: 'claimed', target: 'chatgpt-web',
  });
  try {
    const poller = startOutboundPromptPoller({
      root: createFakeRoot([composer]),
      clipboard: { async writeText() { throw new Error('no clipboard'); } },
      setIntervalFn() { return 1; },
      clearIntervalFn() {},
    });
    const result = await poller.tick();
    poller.stop();
    assert.equal(result.ok, false);
    assert.equal(getActiveRelaySession(), null);
  } finally {
    globalThis.fetch = originalFetch;
    clearActiveRelaySession();
  }
});
