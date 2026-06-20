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
  getRelaySessionSnapshot,
  setActiveRelaySession,
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
            claimToken: 'claim-1',
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
    const events = [];
    const poller = startOutboundPromptPoller({
      root: createFakeRoot([composer]),
      onEvent(event) {
        events.push(event);
      },
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
      claimToken: 'claim-1',
      ok: true,
    });
    assert.equal(timers.length, 1);
    assert.deepEqual(events.map((event) => event.type), ['claimed', 'delivered']);
    assert.equal(getRelaySessionSnapshot().stage, 'waiting-manual-send');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('outbound poller reports acknowledgement failure to the visible event channel', async () => {
  clearActiveRelaySession();
  setBridgeClientConfig({ baseUrl: 'http://127.0.0.1:31337', pairingToken: 'tok-123' });
  const composer = new FakeElement('textarea', { 'data-testid': 'prompt-textarea' });
  const originalFetch = globalThis.fetch;
  let request = 0;
  globalThis.fetch = async () => {
    request += 1;
    if (request === 1) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ outboundPrompt: {
          id: 'out-fail', sessionId: 's-fail', packetId: 'p-fail', claimToken: 'claim-fail',
          prompt: 'review', status: 'claimed', target: 'chatgpt-web',
        } }),
      };
    }
    return { ok: false, status: 503, json: async () => ({ status: 'error' }) };
  };
  try {
    const events = [];
    const poller = startOutboundPromptPoller({
      root: createFakeRoot([composer]),
      onEvent: (event) => events.push(event),
      setIntervalFn: () => 1,
      clearIntervalFn() {},
    });
    await poller.tick();
    poller.stop();
    assert.deepEqual(events.map((event) => event.type), ['claimed', 'failed']);
    assert.equal(events[1].reason, 'ack-failed');
  } finally {
    clearActiveRelaySession();
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
    const events = [];
    const poller = startOutboundPromptPoller({
      root: createFakeRoot([composer]),
      isStreaming: () => true,
      onEvent: (event) => events.push(event),
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
    assert.deepEqual(events, [{ type: 'waiting', reason: 'streaming' }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('outbound poller does not claim another prompt while a reply route is pending', async () => {
  setBridgeClientConfig({ baseUrl: 'http://127.0.0.1:31337', pairingToken: 'tok-123' });
  clearActiveRelaySession();
  setActiveRelaySession({
    sessionId: 'session-pending-reply',
    outboundPromptId: 'out-pending-reply',
    packetId: 'packet-pending-reply',
    updatedAt: Date.now(),
  });
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (...args) => {
    calls.push(args);
    throw new Error('must not claim');
  };
  try {
    const poller = startOutboundPromptPoller({
      root: createFakeRoot([]),
      setIntervalFn() { return 1; },
      clearIntervalFn() {},
    });
    assert.equal(await poller.tick(), null);
    poller.stop();
    assert.equal(calls.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
    clearActiveRelaySession();
  }
});

test('outbound poller reports unpaired wait state without claiming', async () => {
  setBridgeClientConfig({ baseUrl: 'http://127.0.0.1:31337', pairingToken: null });
  clearActiveRelaySession();
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (...args) => {
    calls.push(args);
    throw new Error('must not claim');
  };
  try {
    const events = [];
    const poller = startOutboundPromptPoller({
      root: createFakeRoot([]),
      onEvent: (event) => events.push(event),
      setIntervalFn() { return 1; },
      clearIntervalFn() {},
    });
    assert.equal(await poller.tick(), null);
    poller.stop();
    assert.deepEqual(events[0], { type: 'waiting', reason: 'unpaired' });
    assert.equal(calls.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('outbound poller reports active-session wait state without claiming', async () => {
  setBridgeClientConfig({ baseUrl: 'http://127.0.0.1:31337', pairingToken: 'tok-123' });
  clearActiveRelaySession();
  setActiveRelaySession({
    sessionId: 's-active',
    outboundPromptId: 'out-active',
    packetId: 'pk-active',
    updatedAt: Date.now(),
  });
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (...args) => {
    calls.push(args);
    throw new Error('must not claim');
  };
  try {
    const events = [];
    const poller = startOutboundPromptPoller({
      root: createFakeRoot([]),
      onEvent: (event) => events.push(event),
      setIntervalFn() { return 1; },
      clearIntervalFn() {},
    });
    assert.equal(await poller.tick(), null);
    poller.stop();
    assert.deepEqual(events[0], { type: 'waiting', reason: 'active-session' });
    assert.equal(calls.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
    clearActiveRelaySession();
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
    id: 'out-rel', sessionId: 's-rel', packetId: 'pk-rel', claimToken: 'claim-rel',
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

test('outbound poller auto relay submits once and returns stable assistant response', async () => {
  setBridgeClientConfig({ baseUrl: 'http://127.0.0.1:31337', pairingToken: 'tok-123' });
  clearActiveRelaySession();
  const composer = new FakeElement('textarea', { 'data-testid': 'prompt-textarea' });
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(String(url)).pathname;
    calls.push({ path, body: init.body ? JSON.parse(init.body) : null });
    if (path === '/bridge/outbound/next') {
      return { ok: true, status: 200, json: async () => ({ outboundPrompt: {
        id: 'out-auto',
        sessionId: 's-auto',
        packetId: 'pk-auto',
        claimToken: 'claim-auto',
        prompt: 'auto relay prompt',
        status: 'claimed',
        target: 'chatgpt-web',
        authorization: {
          target: 'chatgpt-web',
          contentHash: 'sha256:auto',
          expiresAt: Date.now() + 60_000,
        },
      } }) };
    }
    if (path === '/bridge/outbound/ack') {
      return { ok: true, status: 200, json: async () => ({ outboundPrompt: { id: 'out-auto', status: 'waiting_manual_send' } }) };
    }
    if (path === '/bridge/outbound/stage') {
      return { ok: true, status: 200, json: async () => ({ outboundPrompt: { id: 'out-auto', status: init.body ? JSON.parse(init.body).stage : 'unknown' } }) };
    }
    if (path === '/bridge/extract-return') {
      return { ok: true, status: 201, json: async () => ({ routedTo: 'inbound' }) };
    }
    throw new Error(`unexpected fetch path ${path}`);
  };
  try {
    const events = [];
    const poller = startOutboundPromptPoller({
      root: createFakeRoot([composer]),
      autoRelay: true,
      submitPrompt: async (contentHash, options) => ({
        ok: contentHash === 'sha256:auto' && options.expectedPromptText === 'auto relay prompt',
        reason: null,
      }),
      waitForAssistantResponse: async () => ({ ok: true, text: 'assistant reply', reason: null }),
      onEvent: (event) => events.push(event),
      setIntervalFn() { return 1; },
      clearIntervalFn() {},
    });
    await poller.tick();
    poller.stop();

    assert.deepEqual(events.map((event) => event.type), ['claimed', 'delivered', 'submitted', 'returned']);
    assert.deepEqual(
      calls.filter((call) => call.path === '/bridge/outbound/stage').map((call) => call.body.stage),
      ['submitted', 'responding', 'response-ready', 'returned'],
    );
    assert.deepEqual(calls.find((call) => call.path === '/bridge/extract-return').body, {
      sessionId: 's-auto',
      content: 'assistant reply',
      operationId: 'out-auto',
    });
    assert.equal(getActiveRelaySession(), null);
  } finally {
    globalThis.fetch = originalFetch;
    clearActiveRelaySession();
  }
});

test('outbound poller marks Stage B prompt failed when response never stabilizes', async () => {
  setBridgeClientConfig({ baseUrl: 'http://127.0.0.1:31337', pairingToken: 'tok-123' });
  const composer = new FakeElement('textarea', {
    'data-testid': 'prompt-textarea',
  });
  composer.value = '';
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(url).pathname;
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ path, body });
    if (path === '/bridge/outbound/next') {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          outboundPrompt: {
            id: 'out-timeout',
            sessionId: 's-timeout',
            packetId: 'packet-timeout',
            prompt: 'timeout prompt',
            claimToken: 'claim-timeout',
            authorization: { contentHash: 'sha256:timeout' },
          },
        }),
      };
    }
    if (path === '/bridge/outbound/ack') {
      return { ok: true, status: 200, json: async () => ({ outboundPrompt: { id: 'out-timeout', status: 'waiting_manual_send' } }) };
    }
    if (path === '/bridge/outbound/stage') {
      return { ok: true, status: 200, json: async () => ({ outboundPrompt: { id: 'out-timeout', status: body.stage } }) };
    }
    throw new Error(`unexpected fetch path ${path}`);
  };

  const poller = startOutboundPromptPoller({
    root: createFakeRoot([composer]),
    autoRelay: true,
    submitPrompt: async () => ({ ok: true, reason: null }),
    waitForAssistantResponse: async () => ({ ok: false, text: '', reason: 'streaming' }),
    setIntervalFn() { return 1; },
    clearIntervalFn() {},
  });
  await poller.tick();
  poller.stop();

  assert.deepEqual(
    calls.filter((call) => call.path === '/bridge/outbound/stage').map((call) => [call.body.stage, call.body.failureReason]),
    [
      ['submitted', undefined],
      ['responding', undefined],
      ['failed', 'streaming'],
    ],
  );
});

test('outbound poller does not record an active relay session while streaming', async () => {
  setBridgeClientConfig({ baseUrl: 'http://127.0.0.1:31337', pairingToken: 'tok-123' });
  clearActiveRelaySession();
  const composer = new FakeElement('textarea', { 'data-testid': 'prompt-textarea' });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = outboundFetchStub({
    id: 'out-x', sessionId: 's-x', packetId: 'pk-x', claimToken: 'claim-x',
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
    id: 'out-f', sessionId: 's-f', packetId: 'pk-f', claimToken: 'claim-f',
    prompt: 'p', status: 'claimed', target: 'chatgpt-web',
  });
  try {
    const poller = startOutboundPromptPoller({
      root: createFakeRoot([composer]),
      clipboard: { async writeText() { throw new Error('must not write clipboard'); } },
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

test('outbound poller never writes outbound prompts to the clipboard automatically', async () => {
  setBridgeClientConfig({ baseUrl: 'http://127.0.0.1:31337', pairingToken: 'tok-123' });
  clearActiveRelaySession();
  let clipboardWrites = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = outboundFetchStub({
    id: 'out-no-clip', sessionId: 's-no-clip', packetId: 'pk-no-clip', claimToken: 'claim-no-clip',
    prompt: 'do not leak me', status: 'claimed', target: 'chatgpt-web',
  });
  try {
    const poller = startOutboundPromptPoller({
      root: createFakeRoot([]),
      clipboard: {
        async writeText() {
          clipboardWrites += 1;
        },
      },
      setIntervalFn() { return 1; },
      clearIntervalFn() {},
    });
    const result = await poller.tick();
    poller.stop();

    assert.equal(result.ok, false);
    assert.equal(result.status, 'failed');
    assert.equal(result.reason, 'input-not-found');
    assert.equal(clipboardWrites, 0);
    assert.equal(getActiveRelaySession(), null);
  } finally {
    globalThis.fetch = originalFetch;
    clearActiveRelaySession();
  }
});
