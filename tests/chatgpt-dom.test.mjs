import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

import {
  fillComposerText,
  findComposerInput,
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

test('fillComposerText returns explicit clipboard fallback when composer is absent', async () => {
  let copiedText = '';
  const clipboard = {
    async writeText(text) {
      copiedText = text;
    },
  };

  const result = await fillComposerText('copy fallback text', {
    root: createFakeRoot([]),
    clipboard,
  });

  assert.deepEqual(result, {
    ok: false,
    status: 'clipboard-fallback',
    reason: 'input-not-found',
    method: 'clipboard',
    clipboard: {
      ok: true,
      status: 'success',
      reason: null,
    },
  });
  assert.equal(copiedText, 'copy fallback text');
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

test('extractPromptText falls back to last assistant without selection or marker', () => {
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
    ok: true,
    status: 'extracted',
    source: 'assistant-fallback',
    text: 'visible text without marker',
    reason: null,
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
    'send-button',
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
    'send-button',
    'CodexManaged',
    'MockAgent',
  ]) {
    assert.equal(wiredSource.includes(snippet), false, `wired source must not contain ${snippet}`);
  }
});

test('Bridge Panel exposes only fill, extract, and copy actions', async () => {
  const source = await readFile(resolve(root, 'apps/extension/src/ui/bridge-panel.tsx'), 'utf8');
  const actionLabels = Array.from(source.matchAll(/textContent = '([^']+)'/g))
    .map((match) => match[1])
    .filter((label) => ['填入', '提取', '复制'].includes(label));

  assert.deepEqual(actionLabels, ['填入', '提取', '复制']);
  // The panel must not present any auto-send / agent-control affordance.
  assert.equal(source.includes('send-button'), false);
  assert.equal(source.includes('requestSubmit'), false);
  assert.equal(source.includes('KeyboardEvent'), false);
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
  ]);
  assert.deepEqual(manifest.background, {
    service_worker: 'dist/background/index.js',
    type: 'module',
  });
  assert.equal(JSON.stringify(manifest).includes('.ts'), false);
});
