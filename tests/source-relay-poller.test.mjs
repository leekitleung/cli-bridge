import assert from 'node:assert/strict';
import test from 'node:test';

import {
  setBridgeClientConfig,
  hasPairingToken,
} from '../apps/extension/src/content/bridge-client.ts';
import {
  canCurrentPageClaimSourceRelayTask,
  ensureSourceRelayPoller,
  startSourceRelayPoller,
  stopActiveSourceRelayPoller,
  wakeActiveSourceRelayPoller,
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

async function withFakeOwnerEnvironment(url, visibilityState, fn) {
  const originalChrome = globalThis.chrome;
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const originalLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
  const storage = {};
  globalThis.chrome = {
    storage: {
      session: {
        async get(key) {
          return key in storage ? { [key]: storage[key] } : {};
        },
        async set(values) {
          Object.assign(storage, values);
        },
      },
    },
  };
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { visibilityState },
  });
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: new URL(url),
  });

  return Promise.resolve(fn(storage)).finally(() => {
    globalThis.chrome = originalChrome;
    if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
    else delete globalThis.document;
    if (originalLocation) Object.defineProperty(globalThis, 'location', originalLocation);
    else delete globalThis.location;
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
        startImmediately: false,
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

test('source relay poller still heartbeats while ChatGPT is streaming', async () => {
  setBridgeClientConfig({
    baseUrl: 'http://127.0.0.1:31337',
    pairingToken: 'test-token',
  });

  let heartbeatCount = 0;
  let nextPollCount = 0;
  const events = [];
  const handle = startSourceRelayPoller({
    intervalMs: 60_000,
    setIntervalFn: () => 1,
    clearIntervalFn: () => {},
    startImmediately: false,
    isStreaming: () => true,
    sendHeartbeat: async () => {
      heartbeatCount += 1;
      return { ok: true };
    },
    onEvent(event) {
      events.push(event);
    },
  });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const pathname = new URL(String(url), 'http://localhost').pathname;
    if (pathname === '/bridge/source/chatgpt-web/next') {
      nextPollCount += 1;
      return {
        ok: true,
        status: 200,
        json: async () => ({ task: null }),
      };
    }
    return originalFetch(url, init);
  };

  try {
    await handle.tick();
    await handle.tick();
    handle.stop();

    assert.equal(heartbeatCount, 1);
    assert.equal(nextPollCount, 0, 'must not claim source prompts while streaming');
    assert.deepEqual(events, [
      { type: 'heartbeat', ok: true },
      { type: 'waiting', reason: 'streaming' },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('source relay poller sends heartbeat immediately on start', async () => {
  setBridgeClientConfig({
    baseUrl: 'http://127.0.0.1:31337',
    pairingToken: 'test-token',
  });

  let heartbeatCount = 0;
  const events = [];
  const handle = startSourceRelayPoller({
    intervalMs: 60_000,
    setIntervalFn: () => 1,
    clearIntervalFn: () => {},
    isStreaming: () => false,
    sendHeartbeat: async () => {
      heartbeatCount += 1;
      return { ok: true };
    },
    onEvent(event) {
      events.push(event);
    },
  });

  try {
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(heartbeatCount, 1);
    assert.deepEqual(events, [{ type: 'heartbeat', ok: true }]);
  } finally {
    handle.stop();
  }
});

test('source relay poller does not claim source prompts from inactive tabs', async () => {
  setBridgeClientConfig({
    baseUrl: 'http://127.0.0.1:31337',
    pairingToken: 'test-token',
  });

  let nextPollCount = 0;
  const events = [];
  const handle = startSourceRelayPoller({
    intervalMs: 60_000,
    setIntervalFn: () => 1,
    clearIntervalFn: () => {},
    startImmediately: false,
    isStreaming: () => false,
    sendHeartbeat: async () => ({ ok: true }),
    canClaim: () => false,
    onEvent(event) {
      events.push(event);
    },
  });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const pathname = new URL(String(url), 'http://localhost').pathname;
    if (pathname === '/bridge/source/chatgpt-web/next') {
      nextPollCount += 1;
      return {
        ok: true,
        status: 200,
        json: async () => ({ task: null }),
      };
    }
    return originalFetch(url, init);
  };

  try {
    await handle.tick();
    await handle.tick();
    handle.stop();

    assert.equal(nextPollCount, 0);
    assert.deepEqual(events, [
      { type: 'heartbeat', ok: true },
      { type: 'waiting', reason: 'not-active' },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('source relay owner lock lets the selected ChatGPT tab claim while hidden', async () => {
  await withFakeOwnerEnvironment('https://chatgpt.com/c/source-owner', 'visible', async (storage) => {
    assert.equal(await canCurrentPageClaimSourceRelayTask(1_000), true);
    assert.equal(storage.cliBridgeSourceRelayOwner.ownerKey, 'https://chatgpt.com/c/source-owner');

    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: { visibilityState: 'hidden' },
    });
    assert.equal(await canCurrentPageClaimSourceRelayTask(2_000), true);

    Object.defineProperty(globalThis, 'location', {
      configurable: true,
      value: new URL('https://chatgpt.com/c/other-tab'),
    });
    assert.equal(await canCurrentPageClaimSourceRelayTask(3_000), false);
  });
});

test('source relay poller passes the configured assistant response timeout', async () => {
  setBridgeClientConfig({
    baseUrl: 'http://127.0.0.1:31337',
    pairingToken: 'test-token',
  });

  let capturedWaitOptions;
  const poller = startSourceRelayPoller({
    intervalMs: 60_000,
    responseTimeoutMs: 123_000,
    setIntervalFn: () => 1,
    clearIntervalFn: () => {},
    startImmediately: false,
    isStreaming: () => false,
    sendHeartbeat: async () => ({ ok: true }),
    fillComposerText: async () => ({
      ok: true,
      status: 'filled',
      method: 'textarea',
      reason: null,
    }),
    computeContentHash: async () => 'hash-from-composer',
    submitPrompt: async () => ({ ok: true, reason: null, composerHash: 'hash-from-composer' }),
    waitForAssistantResponse: async (options) => {
      capturedWaitOptions = options;
      return { ok: false, text: '', reason: 'not-found' };
    },
  });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const pathname = new URL(String(url), 'http://localhost').pathname;
    if (pathname === '/bridge/source/chatgpt-web/next') {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          task: {
            id: 'task-timeout',
            prompt: 'timeout prompt',
            projectId: 'test-project',
            sessionId: 'test-session',
            createdAt: Date.now(),
            status: 'pending',
          },
        }),
      };
    }
    return originalFetch(url, init);
  };

  try {
    await poller.tick();
    await poller.tick();
    poller.stop();

    assert.equal(capturedWaitOptions?.timeoutMs, 123_000);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('source relay poller returns non-empty unstable assistant response before server timeout', async () => {
  setBridgeClientConfig({
    baseUrl: 'http://127.0.0.1:31337',
    pairingToken: 'test-token',
  });

  const posts = [];
  const events = [];
  const poller = startSourceRelayPoller({
    intervalMs: 60_000,
    setIntervalFn: () => 1,
    clearIntervalFn: () => {},
    startImmediately: false,
    isStreaming: () => false,
    sendHeartbeat: async () => ({ ok: true }),
    fillComposerText: async () => ({
      ok: true,
      status: 'filled',
      method: 'textarea',
      reason: null,
    }),
    computeContentHash: async () => 'hash-from-composer',
    submitPrompt: async () => ({ ok: true, reason: null, composerHash: 'hash-from-composer' }),
    waitForAssistantResponse: async () => ({
      ok: false,
      text: 'partial but useful answer',
      reason: 'unstable',
    }),
    onEvent(event) {
      events.push(event);
    },
  });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const pathname = new URL(String(url), 'http://localhost').pathname;
    if (pathname === '/bridge/source/chatgpt-web/next') {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          task: {
            id: 'task-unstable',
            prompt: 'slow prompt',
            projectId: 'test-project',
            sessionId: 'test-session',
            createdAt: Date.now(),
            status: 'pending',
          },
        }),
      };
    }
    if (pathname === '/bridge/source/chatgpt-web/results') {
      posts.push(JSON.parse(init.body));
      return {
        ok: true,
        status: 200,
        json: async () => ({ result: { requestId: 'task-unstable', text: posts[0].text } }),
      };
    }
    return originalFetch(url, init);
  };

  try {
    await poller.tick();
    await poller.tick();
    poller.stop();

    assert.deepEqual(posts, [{ requestId: 'task-unstable', text: 'partial but useful answer' }]);
    assert.ok(events.some(event => event.type === 'returned' && event.promptId === 'task-unstable'));
    assert.equal(events.some(event => event.type === 'failed' && event.reason === 'extract-failed'), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('source relay poller passes actual hash to submitPrompt, not empty string (ADR-0035 fix)', async () => {
  setBridgeClientConfig({
    baseUrl: 'http://127.0.0.1:31337',
    pairingToken: 'test-token',
  });

  const testPrompt = 'Hello, ChatGPT!';

  let capturedHash;
  let submitCalled = false;
  let capturedOptions;
  let capturedFillText;

  const poller = startSourceRelayPoller({
    intervalMs: 60_000,
    setIntervalFn: () => 1,
    clearIntervalFn: () => {},
    startImmediately: false,
    isStreaming: () => false,
    sendHeartbeat: async () => ({ ok: true }),
    fillComposerText: async (text, _options) => {
      capturedFillText = text;
      return {
        ok: true,
        status: 'filled',
        method: 'textarea',
        reason: null,
      };
    },
    computeContentHash: async (_root) => {
      return 'fake-content-hash-' + capturedFillText;
    },
    submitPrompt: async (hash, options) => {
      capturedHash = hash;
      capturedOptions = options;
      submitCalled = true;
      return { ok: false, reason: 'test-complete', composerHash: hash };
    },
    waitForAssistantResponse: async () => ({ ok: false, reason: 'test' }),
  });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const pathname = new URL(String(url), 'http://localhost').pathname;
    if (pathname === '/bridge/source/chatgpt-web/heartbeat') {
      return {
        ok: true,
        status: 200,
        json: async () => ({ heartbeat: 'recorded' }),
      };
    }
    if (pathname === '/bridge/source/chatgpt-web/next') {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          task: {
            id: 'task-123',
            prompt: testPrompt,
            projectId: 'test-project',
            sessionId: 'test-session',
            createdAt: Date.now(),
            status: 'pending',
          },
        }),
      };
    }
    if (pathname === '/bridge/source/chatgpt-web/results') {
      return {
        ok: true,
        status: 200,
        json: async () => ({ result: { requestId: 'task-123', text: 'response' } }),
      };
    }
    return originalFetch(url, init);
  };

  try {
    // First tick: heartbeat fires and returns null
    await poller.tick();
    // Second tick: heartbeat check skipped, polling proceeds
    await poller.tick();
    poller.stop();

    assert.equal(submitCalled, true, 'submitPrompt should have been called');
    assert.notEqual(
      capturedHash,
      '',
      'hash must NOT be empty string (this was the ADR-0035 bug: empty hash caused submit to fail)',
    );
    assert.equal(
      capturedHash?.length > 0,
      true,
      'hash should be a non-empty string',
    );
    assert.equal(
      capturedOptions?.expectedPromptText,
      testPrompt,
      'options should include expected prompt text',
    );
    assert.equal(
      capturedFillText,
      testPrompt,
      'composer should be filled with the task prompt',
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('source relay poller can be woken by an extension message instead of waiting for its interval', async () => {
  setBridgeClientConfig({
    baseUrl: 'http://127.0.0.1:31337',
    pairingToken: 'test-token',
  });

  let tickCount = 0;
  const poller = ensureSourceRelayPoller({
    intervalMs: 60_000,
    setIntervalFn: () => 1,
    clearIntervalFn: () => {},
    startImmediately: false,
    isStreaming: () => false,
    sendHeartbeat: async () => {
      tickCount += 1;
      return { ok: true };
    },
  });

  try {
    assert.equal(tickCount, 0);
    assert.deepEqual(await wakeActiveSourceRelayPoller(), { ok: true, active: true });
    assert.equal(tickCount, 1);
  } finally {
    poller.stop();
    stopActiveSourceRelayPoller();
  }
});
