import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

import {
  fillComposerText,
  findComposerInput,
  findUniqueSendButton,
  getComposerContentHash,
  submitAuthorizedPrompt,
} from '../apps/extension/src/content/chatgpt-dom.ts';
import {
  copyTextToClipboard,
} from '../apps/extension/src/content/clipboard.ts';
import {
  DEFAULT_EXTRACTION_MARKER,
  detectStreamingState,
  extractLastCompleteAssistantMessage,
  extractMarkedBlock,
  extractPromptText,
  getUserSelectionText,
  waitForStableAssistantResponse,
} from '../apps/extension/src/content/extraction.ts';

const root = process.cwd();

class FakeElement extends EventTarget {
  constructor(tagName, attributes = {}) {
    super();
    this.tagName = tagName.toUpperCase();
    this.value = '';
    this.textContent = '';
    this.attributes = new Map(Object.entries(attributes));
    this.dispatchedEvents = [];
    this.rect = { width: 100, height: 20 };
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  closest(selector) {
    if (selector === '[data-cli-bridge-panel="true"]') {
      return this.getAttribute('data-cli-bridge-panel') === 'true' ? this : null;
    }

    return null;
  }

  dispatchEvent(event) {
    this.dispatchedEvents.push(event.type);
    return super.dispatchEvent(event);
  }

  focus() {}

  click() {
    this.clicked = true;
  }

  getBoundingClientRect() {
    return this.rect;
  }
}

function selectorMatches(element, selector) {
  const tagName = element.tagName.toLowerCase();

  if (selector.includes('textarea') && tagName !== 'textarea') {
    return false;
  }

  if (selector.includes('contenteditable') && element.getAttribute('contenteditable') !== 'true') {
    return false;
  }

  if (selector.includes('[role="textbox"]') && element.getAttribute('role') !== 'textbox') {
    return false;
  }

  if (selector === '#prompt-textarea[contenteditable="true"]') {
    return element.getAttribute('id') === 'prompt-textarea' &&
      element.getAttribute('contenteditable') === 'true';
  }

  if (selector === '.ProseMirror[contenteditable="true"]') {
    return (element.getAttribute('class')?.split(/\s+/).includes('ProseMirror') ?? false) &&
      element.getAttribute('contenteditable') === 'true';
  }

  if (selector.includes('[data-testid="prompt-textarea"]')) {
    return element.getAttribute('data-testid') === 'prompt-textarea';
  }

  if (selector.includes('[data-testid^="conversation-turn"]')) {
    return element.getAttribute('data-testid')?.startsWith('conversation-turn') ?? false;
  }

  if (selector.includes('[data-message-author-role="assistant"]')) {
    return element.getAttribute('data-message-author-role') === 'assistant';
  }

  if (selector === '[data-testid="stop-button"]') {
    return element.getAttribute('data-testid') === 'stop-button';
  }

  if (selector === '[aria-busy="true"]') {
    return element.getAttribute('aria-busy') === 'true';
  }

  if (selector === '[data-is-streaming="true"]') {
    return element.getAttribute('data-is-streaming') === 'true';
  }

  if (selector === 'button[aria-label*="Stop"]') {
    return tagName === 'button' && (element.getAttribute('aria-label')?.includes('Stop') ?? false);
  }

  if (selector === 'button[data-testid="send-button"]') {
    return tagName === 'button' && element.getAttribute('data-testid') === 'send-button';
  }

  if (selector === 'button[aria-label="Send prompt"]') {
    return tagName === 'button' && element.getAttribute('aria-label') === 'Send prompt';
  }

  if (selector === 'button[aria-label="Send message"]') {
    return tagName === 'button' && element.getAttribute('aria-label') === 'Send message';
  }

  if (selector.includes('[placeholder]')) {
    return element.getAttribute('placeholder') !== null;
  }

  if (selector === 'article' || selector === 'main' || selector === 'body') {
    return tagName === selector;
  }

  return true;
}

function createFakeRoot(elements) {
  return {
    querySelectorAll(selector) {
      return elements.filter((element) => selectorMatches(element, selector));
    },
  };
}

test('findComposerInput prefers ChatGPT textarea selectors', () => {
  const panelTextarea = new FakeElement('textarea', {
    'data-cli-bridge-panel': 'true',
  });
  const composer = new FakeElement('textarea', {
    'data-testid': 'prompt-textarea',
  });
  const rootNode = createFakeRoot([panelTextarea, composer]);

  assert.equal(findComposerInput(rootNode), composer);
});

test('findComposerInput prefers visible contenteditable composer over textarea fallbacks', () => {
  const strayTextarea = new FakeElement('textarea', {
    placeholder: 'Search',
  });
  const composer = new FakeElement('div', {
    class: 'ProseMirror',
    contenteditable: 'true',
  });
  const rootNode = createFakeRoot([strayTextarea, composer]);

  assert.equal(findComposerInput(rootNode), composer);
});

test('findComposerInput ignores hidden textarea candidates', () => {
  const hiddenTextarea = new FakeElement('textarea', {
    'data-testid': 'prompt-textarea',
  });
  hiddenTextarea.rect = { width: 0, height: 0 };
  const composer = new FakeElement('div', {
    id: 'prompt-textarea',
    contenteditable: 'true',
  });
  const rootNode = createFakeRoot([hiddenTextarea, composer]);

  assert.equal(findComposerInput(rootNode), composer);
});

test('fillComposerText fills textarea and dispatches input/change events', async () => {
  const composer = new FakeElement('textarea', {
    'data-testid': 'prompt-textarea',
  });
  const rootNode = createFakeRoot([composer]);

  const result = await fillComposerText('review this diff', { root: rootNode });

  assert.deepEqual(result, {
    ok: true,
    status: 'filled',
    reason: null,
    method: 'textarea',
  });
  assert.equal(composer.value, 'review this diff');
  assert.deepEqual(composer.dispatchedEvents, ['input', 'change']);
});

test('submitAuthorizedPrompt verifies composer hash and clicks exactly one native send button', async () => {
  const composer = new FakeElement('textarea', { 'data-testid': 'prompt-textarea' });
  const sendButton = new FakeElement('button', { 'data-testid': 'send-button' });
  const rootNode = createFakeRoot([composer, sendButton]);
  await fillComposerText('authorized text', { root: rootNode });
  const hash = await getComposerContentHash(rootNode);

  assert.equal(findUniqueSendButton(rootNode), sendButton);
  const result = await submitAuthorizedPrompt(hash, { root: rootNode });
  assert.equal(result.ok, true);
  assert.equal(sendButton.clicked, true);
});

test('submitAuthorizedPrompt waits for submitted prompt page evidence', async () => {
  const composer = new FakeElement('textarea', { 'data-testid': 'prompt-textarea' });
  const sendButton = new FakeElement('button', { 'data-testid': 'send-button' });
  const rootNode = createFakeRoot([composer, sendButton]);
  rootNode.textContent = '';
  sendButton.click = () => {
    sendButton.clicked = true;
    composer.value = '';
    rootNode.textContent = 'authorized observed text';
  };
  await fillComposerText('authorized observed text', { root: rootNode });
  const hash = await getComposerContentHash(rootNode);

  const result = await submitAuthorizedPrompt(hash, {
    root: rootNode,
    expectedPromptText: 'authorized observed text',
  });

  assert.equal(result.ok, true);
  assert.equal(sendButton.clicked, true);
});

test('submitAuthorizedPrompt fails closed on hash mismatch or ambiguous send controls', async () => {
  const composer = new FakeElement('textarea', { 'data-testid': 'prompt-textarea' });
  const sendA = new FakeElement('button', { 'data-testid': 'send-button' });
  const sendB = new FakeElement('button', { 'aria-label': 'Send prompt' });
  const rootNode = createFakeRoot([composer, sendA, sendB]);
  await fillComposerText('authorized text', { root: rootNode });

  const mismatch = await submitAuthorizedPrompt('sha256:not-the-right-hash', { root: rootNode });
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.reason, 'composer-hash-mismatch');

  const hash = await getComposerContentHash(rootNode);
  const ambiguous = await submitAuthorizedPrompt(hash, { root: rootNode });
  assert.equal(ambiguous.ok, false);
  assert.equal(ambiguous.reason, 'send-control-ambiguous');
  assert.equal(sendA.clicked, undefined);
  assert.equal(sendB.clicked, undefined);
});

test('fillComposerText falls back to contenteditable composer', async () => {
  const composer = new FakeElement('div', {
    contenteditable: 'true',
    role: 'textbox',
  });
  const rootNode = createFakeRoot([composer]);

  const result = await fillComposerText('use contenteditable', { root: rootNode });

  assert.deepEqual(result, {
    ok: true,
    status: 'filled',
    reason: null,
    method: 'contenteditable',
  });
  assert.equal(composer.textContent, 'use contenteditable');
  assert.deepEqual(composer.dispatchedEvents, ['input', 'change']);
});

test('fillComposerText does not write clipboard by default when composer is absent', async () => {
  let copiedText = '';
  const clipboard = {
    async writeText(text) {
      copiedText = text;
    },
  };

  const result = await fillComposerText('copy fallback text', {
    root: createFakeRoot([]),
    clipboard,
    timeoutMs: 0,
  });

  assert.deepEqual(result, {
    ok: false,
    status: 'failed',
    reason: 'input-not-found',
    method: 'none',
  });
  assert.equal(copiedText, '');
});

test('fillComposerText with timeout=0 reports composer-not-found immediately without waiting', async () => {
  let delayCalls = 0;
  let copied = '';
  const clipboard = {
    async writeText(text) {
      copied = text;
    },
  };

  const result = await fillComposerText('immediate miss', {
    root: createFakeRoot([]),
    clipboard,
    timeoutMs: 0,
    now: () => 0,
    delay: async () => {
      delayCalls += 1;
    },
  });

  assert.equal(delayCalls, 0, 'must not wait when timeout is 0');
  assert.equal(result.status, 'failed');
  assert.equal(result.reason, 'input-not-found');
  assert.equal(copied, '');
});

test('fillComposerText waits across the timeout window before reporting composer-not-found', async () => {
  let clock = 0;
  let delayCalls = 0;
  const result = await fillComposerText('waited miss', {
    root: createFakeRoot([]),
    timeoutMs: 1000,
    pollIntervalMs: 200,
    now: () => clock,
    delay: async (ms) => {
      delayCalls += 1;
      clock += ms;
    },
  });

  assert.ok(delayCalls > 0, 'must retry while waiting for the composer to mount');
  assert.equal(result.status, 'failed');
  assert.equal(result.reason, 'input-not-found');
});

test('fillComposerText fills a composer that mounts after a few retries', async () => {
  let clock = 0;
  const composer = new FakeElement('textarea', {
    'data-testid': 'prompt-textarea',
  });
  const lateRoot = {
    querySelectorAll(selector) {
      if (clock < 400) {
        return [];
      }
      return [composer].filter((element) => selectorMatches(element, selector));
    },
  };

  const result = await fillComposerText('late composer', {
    root: lateRoot,
    timeoutMs: 2000,
    pollIntervalMs: 200,
    now: () => clock,
    delay: async (ms) => {
      clock += ms;
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.method, 'textarea');
  assert.equal(composer.value, 'late composer');
});

test('fillComposerText uses execCommand insertText to drive ProseMirror beforeinput pipeline', async () => {
  const composer = new FakeElement('div', {
    contenteditable: 'true',
    role: 'textbox',
  });
  const rootNode = createFakeRoot([composer]);

  const execCommandCalls = [];
  const originalDocument = globalThis.document;
  globalThis.document = {
    execCommand(command, showDefaultUI, value) {
      execCommandCalls.push({ command, value });
      if (command === 'insertText') {
        composer.textContent = value;
      }
      return true;
    },
  };

  try {
    const result = await fillComposerText('prosemirror text', { root: rootNode });
    assert.equal(result.ok, true);
    assert.equal(result.method, 'contenteditable');
    assert.equal(composer.textContent, 'prosemirror text');
    assert.ok(
      execCommandCalls.some((call) => call.command === 'insertText' && call.value === 'prosemirror text'),
      'fillComposerText must call execCommand("insertText") for contenteditable composers',
    );
  } finally {
    if (originalDocument === undefined) {
      delete globalThis.document;
    } else {
      globalThis.document = originalDocument;
    }
  }
});

test('fillComposerText contenteditable fill fires beforeinput via execCommand or InputEvent dispatch', async () => {
  // The fillContentEditable path must use execCommand('insertText') (which
  // fires a native beforeinput) OR the dispatchBeforeInput helper must fire a
  // beforeinput InputEvent. Either way, the beforeinput pipeline is triggered.
  // This test verifies the execCommand path; when execCommand is unavailable,
  // dispatchBeforeInput is called unconditionally before the fill.
  const composer = new FakeElement('div', {
    contenteditable: 'true',
    role: 'textbox',
  });
  const rootNode = createFakeRoot([composer]);

  const originalDocument = globalThis.document;
  let insertTextCalled = false;
  globalThis.document = {
    execCommand(command) {
      if (command === 'insertText') {
        insertTextCalled = true;
        composer.textContent = 'beforeinput proof';
      }
      return true;
    },
  };

  try {
    const result = await fillComposerText('beforeinput proof', { root: rootNode });
    assert.equal(result.ok, true);
    assert.equal(insertTextCalled, true, 'execCommand("insertText") must be invoked for ProseMirror beforeinput');
  } finally {
    if (originalDocument === undefined) {
      delete globalThis.document;
    } else {
      globalThis.document = originalDocument;
    }
  }
});

test('chatgpt-dom.ts source contains no submission or keyboard simulation patterns', async () => {
  const source = await readFile(resolve(root, 'apps/extension/src/content/chatgpt-dom.ts'), 'utf8');

  // Forbidden patterns: submission mechanisms and keyboard simulation.
  // Do NOT scan for bare "Enter" — it produces false positives on words like
  // "center", "enter", "EnterText", and comments.
  const forbiddenPatterns = [
    { name: 'KeyboardEvent', regex: /KeyboardEvent/ },
    { name: 'keydown', regex: /keydown/ },
    { name: 'keypress', regex: /keypress/ },
    { name: 'requestSubmit', regex: /requestSubmit/ },
    { name: '.submit(', regex: /\.submit\(/ },
    { name: 'form.submit', regex: /form\.submit/ },
    { name: 'click.*send', regex: /click.*send/ },
    { name: 'dispatchEvent.*submit', regex: /dispatchEvent.*submit/ },
  ];

  for (const { name, regex } of forbiddenPatterns) {
    const matches = source.match(new RegExp(regex.source, 'g'));
    assert.equal(matches, null, `chatgpt-dom.ts must not contain forbidden pattern: ${name}`);
  }
});

test('fillComposerText does not write clipboard by default when direct fill throws', async () => {
  let copied = '';
  const composer = new FakeElement('textarea', {
    'data-testid': 'prompt-textarea',
  });
  composer.focus = () => {
    throw new Error('focus rejected');
  };
  const clipboard = {
    async writeText(text) {
      copied = text;
    },
  };

  const result = await fillComposerText('explodes', {
    root: createFakeRoot([composer]),
    clipboard,
    timeoutMs: 0,
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.reason, 'input-fill-failed');
  assert.equal(copied, '');
});

test('fillComposerText does not write clipboard by default when post-fill verification mismatches', async () => {
  let copied = '';
  const composer = new FakeElement('textarea', {
    'data-testid': 'prompt-textarea',
  });
  Object.defineProperty(composer, 'value', {
    get() {
      return 'stale residue';
    },
    set() {},
    configurable: true,
  });
  const clipboard = {
    async writeText(text) {
      copied = text;
    },
  };

  const result = await fillComposerText('fresh target text', {
    root: createFakeRoot([composer]),
    clipboard,
    timeoutMs: 0,
    verifyTimeoutMs: 0,
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.reason, 'input-verify-failed');
  assert.equal(copied, '');
});

test('fillComposerText waits for asynchronous composer verification', async () => {
  let currentValue = 'stale residue';
  let delayCalls = 0;
  let now = 0;
  const composer = new FakeElement('textarea', {
    'data-testid': 'prompt-textarea',
  });
  Object.defineProperty(composer, 'value', {
    get() {
      return currentValue;
    },
    set() {},
    configurable: true,
  });

  const result = await fillComposerText('eventual target text', {
    root: createFakeRoot([composer]),
    timeoutMs: 0,
    verifyTimeoutMs: 200,
    now: () => now,
    delay: async (ms) => {
      delayCalls += 1;
      now += ms;
      currentValue = 'eventual target text';
    },
  });

  assert.equal(result.status, 'filled');
  assert.equal(result.reason, null);
  assert.equal(delayCalls, 1);
});

test('fillComposerText writes clipboard only when explicit fallback is enabled', async () => {
  let copied = '';
  const result = await fillComposerText('explicit copy fallback', {
    root: createFakeRoot([]),
    clipboard: {
      async writeText(text) {
        copied = text;
      },
    },
    allowClipboardFallback: true,
    timeoutMs: 0,
  });

  assert.equal(result.status, 'clipboard-fallback');
  assert.equal(result.reason, 'input-not-found');
  assert.equal(result.method, 'clipboard');
  assert.equal(copied, 'explicit copy fallback');
});

test('copyTextToClipboard returns structured success and failure states', async () => {
  let copiedText = '';
  const success = await copyTextToClipboard('copy action text', {
    async writeText(text) {
      copiedText = text;
    },
  });

  assert.deepEqual(success, {
    ok: true,
    status: 'success',
    reason: null,
  });
  assert.equal(copiedText, 'copy action text');

  const failed = await copyTextToClipboard('copy action text', {
    async writeText() {
      throw new Error('denied');
    },
  });

  assert.deepEqual(failed, {
    ok: false,
    status: 'failed',
    reason: 'clipboard-write-failed',
  });
});

test('getUserSelectionText returns trimmed user selection text', () => {
  const selection = {
    toString() {
      return '  selected prompt text  ';
    },
  };

  assert.equal(getUserSelectionText(selection), 'selected prompt text');
});

test('extractPromptText gives user selection priority over marker blocks', () => {
  const assistant = new FakeElement('article', {
    'data-message-author-role': 'assistant',
  });
  assistant.textContent = [
    DEFAULT_EXTRACTION_MARKER,
    'marker prompt text',
  ].join('\n');

  const result = extractPromptText({
    root: createFakeRoot([assistant]),
    selection: {
      toString() {
        return 'selected prompt text';
      },
    },
  });

  assert.deepEqual(result, {
    ok: true,
    status: 'extracted',
    source: 'selection',
    text: 'selected prompt text',
    reason: null,
  });
});

test('extractMarkedBlock extracts marker text until next same-level heading', () => {
  const assistant = new FakeElement('article', {
    'data-message-author-role': 'assistant',
  });
  assistant.textContent = [
    '# Earlier',
    DEFAULT_EXTRACTION_MARKER,
    'line one',
    'line two',
    '## Other Section',
    'do not include',
  ].join('\n');

  const result = extractMarkedBlock(createFakeRoot([assistant]));

  assert.deepEqual(result, {
    ok: true,
    status: 'extracted',
    source: 'marker',
    text: 'line one\nline two',
    reason: null,
  });
});

test('extractMarkedBlock ignores hidden marker text', () => {
  const hiddenAssistant = new FakeElement('article', {
    'data-message-author-role': 'assistant',
    hidden: '',
  });
  hiddenAssistant.textContent = [
    DEFAULT_EXTRACTION_MARKER,
    'hidden prompt text',
  ].join('\n');

  const visibleAssistant = new FakeElement('article', {
    'data-message-author-role': 'assistant',
  });
  visibleAssistant.textContent = 'visible text without marker';

  const result = extractMarkedBlock(createFakeRoot([hiddenAssistant, visibleAssistant]));

  assert.deepEqual(result, {
    ok: false,
    status: 'failed',
    source: null,
    text: '',
    reason: 'no-selection-or-marker',
  });
});

test('extractPromptText fails without explicit selection or marker', () => {
  const assistant = new FakeElement('article', {
    'data-message-author-role': 'assistant',
  });
  assistant.textContent = 'visible text without marker';

  const result = extractPromptText({
    root: createFakeRoot([assistant]),
    selection: {
      toString() {
        return '';
      },
    },
  });

  assert.deepEqual(result, {
    ok: false,
    status: 'failed',
    source: null,
    text: '',
    reason: 'no-selection-or-marker',
  });
});

test('extractPromptText fails when selection, marker, and assistant fallback are absent', () => {
  const result = extractPromptText({
    root: createFakeRoot([]),
    selection: {
      toString() {
        return '';
      },
    },
  });

  assert.deepEqual(result, {
    ok: false,
    status: 'failed',
    source: null,
    text: '',
    reason: 'no-selection-or-marker',
  });
});

test('detectStreamingState detects visible generating controls', () => {
  const stopButton = new FakeElement('button', {
    'data-testid': 'stop-button',
  });

  assert.equal(detectStreamingState(createFakeRoot([stopButton])), true);
});

test('extractPromptText blocks last assistant fallback while streaming', () => {
  const assistant = new FakeElement('article', {
    'data-message-author-role': 'assistant',
  });
  assistant.textContent = 'partial assistant text';
  const stopButton = new FakeElement('button', {
    'data-testid': 'stop-button',
  });

  const result = extractPromptText({
    root: createFakeRoot([assistant, stopButton]),
    selection: {
      toString() {
        return '';
      },
    },
  });

  assert.deepEqual(result, {
    ok: false,
    status: 'blocked',
    source: null,
    text: '',
    reason: 'streaming',
  });
});

test('extractPromptText still returns selection while streaming', () => {
  const stopButton = new FakeElement('button', {
    'data-testid': 'stop-button',
  });

  const result = extractPromptText({
    root: createFakeRoot([stopButton]),
    selection: {
      toString() {
        return 'selected text wins';
      },
    },
  });

  assert.deepEqual(result, {
    ok: true,
    status: 'extracted',
    source: 'selection',
    text: 'selected text wins',
    reason: null,
  });
});

test('extractPromptText keeps marker priority over last assistant fallback', () => {
  const assistant = new FakeElement('article', {
    'data-message-author-role': 'assistant',
  });
  assistant.textContent = [
    DEFAULT_EXTRACTION_MARKER,
    'marked prompt',
    '## End',
    'assistant fallback text',
  ].join('\n');

  const result = extractPromptText({
    root: createFakeRoot([assistant]),
    selection: {
      toString() {
        return '';
      },
    },
  });

  assert.deepEqual(result, {
    ok: true,
    status: 'extracted',
    source: 'marker',
    text: 'marked prompt',
    reason: null,
  });
});

test('extractMarkedBlock does not scan broad main or body containers', () => {
  const body = new FakeElement('body');
  body.textContent = [
    DEFAULT_EXTRACTION_MARKER,
    'page-level text must not be extracted',
  ].join('\n');

  const result = extractMarkedBlock(createFakeRoot([body]));

  assert.deepEqual(result, {
    ok: false,
    status: 'failed',
    source: null,
    text: '',
    reason: 'no-selection-or-marker',
  });
});

test('extractLastCompleteAssistantMessage returns only the last visible assistant message', () => {
  const firstAssistant = new FakeElement('article', {
    'data-message-author-role': 'assistant',
  });
  firstAssistant.textContent = 'older assistant text';

  const hiddenAssistant = new FakeElement('article', {
    'data-message-author-role': 'assistant',
    'aria-hidden': 'true',
  });
  hiddenAssistant.textContent = 'hidden assistant text';

  const lastAssistant = new FakeElement('article', {
    'data-message-author-role': 'assistant',
  });
  lastAssistant.textContent = 'last assistant text';

  const result = extractLastCompleteAssistantMessage(createFakeRoot([
    firstAssistant,
    hiddenAssistant,
    lastAssistant,
  ]));

  assert.deepEqual(result, {
    ok: true,
    status: 'extracted',
    source: 'assistant-fallback',
    text: 'last assistant text',
    reason: null,
  });
});

test('waitForStableAssistantResponse returns only stable complete assistant text', async () => {
  let clock = 0;
  const assistant = new FakeElement('article', {
    'data-message-author-role': 'assistant',
  });
  assistant.textContent = 'stable reply';
  const rootNode = createFakeRoot([assistant]);

  const result = await waitForStableAssistantResponse({
    root: rootNode,
    now: () => clock,
    delay: async (ms) => {
      clock += ms;
    },
    pollIntervalMs: 10,
    stablePolls: 2,
  });

  assert.equal(result.ok, true);
  assert.equal(result.text, 'stable reply');
});

test('W2 extension source does not send, read browser secrets, or implement later scopes', async () => {
  // Files that must remain pure DOM/clipboard helpers with no server vocabulary.
  const purePaths = [
    'apps/extension/src/content/chatgpt-dom.ts',
    'apps/extension/src/content/clipboard.ts',
    'apps/extension/src/content/extraction.ts',
    'apps/extension/src/ui/state.ts',
  ];

  const pureSource = (await Promise.all(
    purePaths.map((path) => readFile(resolve(root, path), 'utf8')),
  )).join('\n');

  for (const snippet of [
    'localStorage',
    'cookie',
    'document.cookie',
    'KeyboardEvent',
    'requestSubmit',
    '.submit(',
    'PendingPrompt',
    'BridgePacket',
    'CodexManaged',
    'MockAgent',
    'Send to',
    'Agent',
    'Packet',
    'Audit',
    'WorkBuddy',
    'MCP',
  ]) {
    assert.equal(pureSource.includes(snippet), false, `pure W2 source must not contain ${snippet}`);
  }

  // The panel and bridge-client legitimately sync to /bridge endpoints in v1.2,
  // but the hard security boundaries still apply everywhere: no page secret
  // reads, no auto-send, no keyboard simulation.
  const wiredPaths = [
    'apps/extension/src/content/index.ts',
    'apps/extension/src/content/outbound-poller.ts',
    'apps/extension/src/ui/bridge-panel.tsx',
    'apps/extension/src/content/bridge-client.ts',
  ];

  const wiredSource = (await Promise.all(
    wiredPaths.map((path) => readFile(resolve(root, path), 'utf8')),
  )).join('\n');

  for (const snippet of [
    'localStorage',
    'document.cookie',
    'KeyboardEvent',
    'requestSubmit',
    '.submit(',
    'CodexManaged',
    'MockAgent',
  ]) {
    assert.equal(wiredSource.includes(snippet), false, `wired source must not contain ${snippet}`);
  }
});

test('Bridge Panel keeps automation actions manual and confirmation-gated', async () => {
  const source = await readFile(resolve(root, 'apps/extension/src/ui/bridge-panel.tsx'), 'utf8');
  const automationActionLabels = Array.from(source.matchAll(/textContent = '([^']+)'/g))
    .map((match) => match[1])
    .filter((label) => ['填入下一步', '预览回传', '确认回传', '复制预览'].includes(label));

  assert.deepEqual(automationActionLabels, ['填入下一步', '预览回传', '确认回传', '复制预览']);
  // The panel must not present any auto-send / agent-control affordance.
  assert.equal(source.includes('send-button'), false);
  assert.equal(source.includes('requestSubmit'), false);
  assert.equal(source.includes('KeyboardEvent'), false);
  const returnHandlerIndex = source.indexOf("returnButton.addEventListener('click'");
  assert.ok(source.lastIndexOf('createExtractReturn') > returnHandlerIndex);
});

test('extension manifest adds ChatGPT content script, clipboard and storage permissions', async () => {
  const manifest = JSON.parse(await readFile(resolve(root, 'apps/extension/manifest.json'), 'utf8'));

  assert.deepEqual(manifest.permissions, ['clipboardWrite', 'storage']);
  assert.deepEqual(manifest.host_permissions, [
    'http://127.0.0.1:31337/*',
    'https://chatgpt.com/*',
  ]);
  assert.deepEqual(manifest.content_scripts, [
    {
      matches: ['https://chatgpt.com/*'],
      js: ['dist/content/index.js'],
    },
    {
      matches: ['http://127.0.0.1:31337/console/project'],
      js: ['dist/content/console-auto-pair.js'],
    },
  ]);
  assert.deepEqual(manifest.background, {
    service_worker: 'dist/background/index.js',
    type: 'module',
  });
  assert.equal(manifest.action.default_popup, 'dist/popup/index.html');
  assert.equal(JSON.stringify(manifest).includes('.ts'), false);
});
