import {
  copyTextToClipboard,
  type ClipboardFallbackResult,
  type ClipboardWriter,
} from './clipboard.ts';

export type ComposerInput = HTMLTextAreaElement | HTMLElement;

export type FillComposerStatus = 'filled' | 'clipboard-fallback' | 'failed';

export type FillComposerReason =
  | 'input-not-found'
  | 'input-fill-failed'
  | 'input-verify-failed'
  | 'clipboard-unavailable'
  | 'clipboard-write-failed'
  | null;

export interface FillComposerResult {
  ok: boolean;
  status: FillComposerStatus;
  reason: FillComposerReason;
  method: 'textarea' | 'contenteditable' | 'clipboard' | 'none';
  clipboard?: ClipboardFallbackResult;
}

export interface FillComposerOptions {
  root?: ParentNode;
  clipboard?: ClipboardWriter;
  /**
   * How long to keep looking for the composer before giving up. The composer
   * can mount asynchronously after navigation, so we retry within this window
   * instead of failing on the first miss. Defaults to
   * {@link DEFAULT_COMPOSER_LOCATE_TIMEOUT_MS}. A value of 0 performs a single
   * lookup and reports `input-not-found` immediately on a miss.
   */
  timeoutMs?: number;
  /** Delay between locate attempts while waiting for the composer to mount. */
  pollIntervalMs?: number;
  /** Injectable clock for deterministic tests. Defaults to Date.now. */
  now?: () => number;
  /** Injectable delay for deterministic tests. Defaults to setTimeout. */
  delay?: (ms: number) => Promise<void>;
  /** How long to wait for the composer DOM to reflect a successful write. */
  verifyTimeoutMs?: number;
  /** Clipboard writes are only allowed for explicit user copy/fallback actions. */
  allowClipboardFallback?: boolean;
}

export type SubmitPromptReason =
  | 'composer-not-found'
  | 'composer-hash-mismatch'
  | 'send-control-not-found'
  | 'send-control-ambiguous'
  | 'send-control-disabled'
  | 'send-click-failed'
  | 'submit-not-observed'
  | null;

export interface SubmitPromptResult {
  ok: boolean;
  reason: SubmitPromptReason;
  composerHash?: string;
}

export const DEFAULT_COMPOSER_LOCATE_TIMEOUT_MS = 3000;
export const DEFAULT_COMPOSER_LOCATE_POLL_INTERVAL_MS = 150;
export const DEFAULT_COMPOSER_VERIFY_TIMEOUT_MS = 750;
export const DEFAULT_COMPOSER_VERIFY_POLL_INTERVAL_MS = 50;
export const DEFAULT_SUBMIT_OBSERVE_TIMEOUT_MS = 5000;
export const DEFAULT_SUBMIT_OBSERVE_POLL_INTERVAL_MS = 150;

export interface LocateComposerOptions {
  timeoutMs?: number;
  pollIntervalMs?: number;
  now?: () => number;
  delay?: (ms: number) => Promise<void>;
}

const TEXTAREA_SELECTORS = [
  'textarea[data-testid="prompt-textarea"]',
  'textarea[placeholder]',
  'textarea',
] as const;

const CONTENTEDITABLE_SELECTORS = [
  '[contenteditable="true"][data-testid="prompt-textarea"]',
  '#prompt-textarea[contenteditable="true"]',
  '.ProseMirror[contenteditable="true"]',
  '[role="textbox"][contenteditable="true"]',
  'div[contenteditable="true"]',
] as const;

const SEND_BUTTON_SELECTORS = [
  'button[data-testid="send-button"]',
  'button[aria-label="Send prompt"]',
  'button[aria-label="Send message"]',
  'button[aria-label="发送提示"]',
  'button[aria-label="发送消息"]',
] as const;

function getDefaultRoot(): ParentNode | null {
  return globalThis.document ?? null;
}

function isElementDisabled(element: Element): boolean {
  return (
    element.getAttribute('disabled') !== null ||
    element.getAttribute('aria-disabled') === 'true'
  );
}

function isInsideBridgePanel(element: Element): boolean {
  return Boolean(element.closest?.('[data-cli-bridge-panel="true"]'));
}

function isVisibleElement(element: Element): boolean {
  const rect = element.getBoundingClientRect();
  const style = globalThis.getComputedStyle?.(element);

  return (
    rect.width > 0 &&
    rect.height > 0 &&
    element.getAttribute('hidden') === null &&
    element.getAttribute('aria-hidden') !== 'true' &&
    style?.display !== 'none' &&
    style?.visibility !== 'hidden'
  );
}

function isUsableComposerInput(element: Element): element is ComposerInput {
  if (isElementDisabled(element) || isInsideBridgePanel(element) || !isVisibleElement(element)) {
    return false;
  }

  const tagName = element.tagName.toLowerCase();
  if (tagName === 'textarea') {
    return true;
  }

  return element.getAttribute('contenteditable') === 'true';
}

function findBySelectors(root: ParentNode, selectors: readonly string[]): ComposerInput | null {
  for (const selector of selectors) {
    const candidates = Array.from(root.querySelectorAll(selector));
    const match = candidates.find(isUsableComposerInput);
    if (match) {
      return match;
    }
  }

  return null;
}

export function findComposerInput(root: ParentNode | null = getDefaultRoot()): ComposerInput | null {
  if (!root) {
    return null;
  }

  return (
    findBySelectors(root, CONTENTEDITABLE_SELECTORS) ??
    findBySelectors(root, TEXTAREA_SELECTORS)
  );
}

function defaultLocateDelay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    if (typeof globalThis.setTimeout === 'function') {
      globalThis.setTimeout(resolve, ms);
    } else {
      resolve();
    }
  });
}

/**
 * Repeatedly looks for the composer until it appears or the timeout elapses.
 * Always performs at least one lookup. With `timeoutMs <= 0` it performs that
 * single lookup and returns immediately. We never report a miss before the
 * timeout window has fully elapsed.
 */
export async function locateComposerInput(
  root: ParentNode | null = getDefaultRoot(),
  options: LocateComposerOptions = {},
): Promise<ComposerInput | null> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_COMPOSER_LOCATE_TIMEOUT_MS;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_COMPOSER_LOCATE_POLL_INTERVAL_MS;
  const now = options.now ?? (() => Date.now());
  const delay = options.delay ?? defaultLocateDelay;

  const start = now();
  let input = findComposerInput(root);
  if (input || timeoutMs <= 0) {
    return input;
  }

  while (now() - start < timeoutMs) {
    await delay(pollIntervalMs);
    input = findComposerInput(root);
    if (input) {
      return input;
    }
  }

  return null;
}

function dispatchComposerEvent(input: ComposerInput, eventName: 'input' | 'change'): void {
  input.dispatchEvent(new Event(eventName, {
    bubbles: true,
    cancelable: true,
  }));
}

function dispatchBeforeInput(input: ComposerInput, text: string): void {
  if (typeof InputEvent !== 'function') {
    return;
  }

  input.dispatchEvent(new InputEvent('beforeinput', {
    bubbles: true,
    cancelable: true,
    inputType: 'insertText',
    data: text,
  }));
}

function fillTextarea(input: ComposerInput, text: string): void {
  const textarea = input as HTMLTextAreaElement;
  textarea.focus();
  const valueSetter = typeof HTMLTextAreaElement === 'function'
    ? Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
    : undefined;

  if (valueSetter) {
    valueSetter.call(textarea, text);
  } else {
    textarea.value = text;
  }

  textarea.selectionStart = text.length;
  textarea.selectionEnd = text.length;
}

function fillContentEditable(input: ComposerInput, text: string): void {
  input.focus();

  // ProseMirror (used by ChatGPT) manages its own state via beforeinput
  // event handlers. Direct DOM manipulation (insertNode, textContent) does
  // not trigger ProseMirror's transaction system, so the React layer never
  // sees the new content and the send button stays disabled.
  //
  // document.execCommand('insertText') fires a real beforeinput event with
  // inputType 'insertText' that ProseMirror captures, making the fill
  // behave identically to a user typing. execCommand is deprecated but
  // remains the only synchronous API that triggers ProseMirror's input
  // pipeline from a content script.
  try {
    const selection = globalThis.getSelection?.();
    if (selection) {
      selection.removeAllRanges();
      const range = document.createRange();
      range.selectNodeContents(input);
      selection.addRange(range);
    }
    if (typeof document.execCommand === 'function' && document.execCommand('insertText', false, text)) {
      return;
    }
  } catch {
    // execCommand not available or failed; fall through to DOM fallback.
  }

  // Fallback: direct DOM manipulation. This works for simple contenteditable
  // elements but will NOT trigger ProseMirror state updates.
  if (!globalThis.document?.createRange) {
    input.textContent = text;
    return;
  }

  const selection = globalThis.getSelection?.();
  const range = document.createRange();
  range.selectNodeContents(input);
  range.deleteContents();
  range.insertNode(document.createTextNode(text));
  range.collapse(false);

  if (selection) {
    selection.removeAllRanges();
    selection.addRange(range);
  }
}

function getInputMethod(input: ComposerInput): 'textarea' | 'contenteditable' {
  return input.tagName.toLowerCase() === 'textarea' ? 'textarea' : 'contenteditable';
}

function readComposerText(input: ComposerInput, method: 'textarea' | 'contenteditable'): string {
  if (method === 'textarea') {
    return (input as HTMLTextAreaElement).value ?? '';
  }

  const element = input as HTMLElement & { innerText?: string };
  return typeof element.innerText === 'string' ? element.innerText : (element.textContent ?? '');
}

function normalizeComposerText(text: string): string {
  return text.replace(/\r\n/g, '\n').trim();
}

async function waitForComposerText(
  input: ComposerInput,
  method: 'textarea' | 'contenteditable',
  expectedText: string,
  options: {
    timeoutMs?: number;
    pollIntervalMs?: number;
    now?: () => number;
    delay?: (ms: number) => Promise<void>;
  } = {},
): Promise<boolean> {
  const expected = normalizeComposerText(expectedText);
  const timeoutMs = options.timeoutMs ?? DEFAULT_COMPOSER_VERIFY_TIMEOUT_MS;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_COMPOSER_VERIFY_POLL_INTERVAL_MS;
  const now = options.now ?? (() => Date.now());
  const delay = options.delay ?? defaultLocateDelay;

  const matches = () => normalizeComposerText(readComposerText(input, method)) === expected;
  if (matches()) {
    return true;
  }
  if (timeoutMs <= 0) {
    return false;
  }

  const start = now();
  while (now() - start < timeoutMs) {
    await delay(pollIntervalMs);
    if (matches()) {
      return true;
    }
  }
  return false;
}

async function createBrowserContentHash(text: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error('crypto-subtle-unavailable');
  }
  const bytes = new TextEncoder().encode(text);
  const digest = await subtle.digest('SHA-256', bytes);
  const hex = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  return `sha256:${hex}`;
}

function getRootVisibleText(root: ParentNode | null): string {
  if (!root) {
    return '';
  }
  const element = typeof Document !== 'undefined' && root instanceof Document ? root.body : root;
  const textSource = element as HTMLElement & { innerText?: string };
  return typeof textSource.innerText === 'string'
    ? textSource.innerText
    : (element.textContent ?? '');
}

export async function getComposerContentHash(
  root: ParentNode | null = getDefaultRoot(),
): Promise<string | null> {
  const input = findComposerInput(root);
  if (!input) {
    return null;
  }
  return createBrowserContentHash(normalizeComposerText(readComposerText(input, getInputMethod(input))));
}

async function waitForSubmittedPromptEvidence(
  expectedContentHash: string,
  expectedPromptText: string,
  root: ParentNode | null,
  options: {
    timeoutMs?: number;
    pollIntervalMs?: number;
  } = {},
): Promise<boolean> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_SUBMIT_OBSERVE_TIMEOUT_MS;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_SUBMIT_OBSERVE_POLL_INTERVAL_MS;
  const start = Date.now();

  while (Date.now() - start <= timeoutMs) {
    const composerHash = await getComposerContentHash(root);
    const composerNoLongerHoldsPrompt = composerHash !== expectedContentHash;
    if (
      composerNoLongerHoldsPrompt &&
      getRootVisibleText(root).includes(expectedPromptText)
    ) {
      return true;
    }
    await defaultLocateDelay(pollIntervalMs);
  }
  return false;
}

function findSendButtonCandidates(root: ParentNode): HTMLElement[] {
  const seen = new Set<Element>();
  const candidates: HTMLElement[] = [];
  for (const selector of SEND_BUTTON_SELECTORS) {
    for (const element of Array.from(root.querySelectorAll(selector))) {
      if (seen.has(element)) {
        continue;
      }
      seen.add(element);
      if (
        element.tagName.toLowerCase() === 'button' &&
        !isInsideBridgePanel(element) &&
        isVisibleElement(element)
      ) {
        candidates.push(element as HTMLElement);
      }
    }
  }
  return candidates;
}

export function findUniqueSendButton(
  root: ParentNode | null = getDefaultRoot(),
): HTMLElement | SubmitPromptReason {
  if (!root) {
    return 'send-control-not-found';
  }
  const candidates = findSendButtonCandidates(root);
  if (candidates.length === 0) {
    return 'send-control-not-found';
  }
  if (candidates.length > 1) {
    return 'send-control-ambiguous';
  }
  const [button] = candidates;
  if (!button) {
    return 'send-control-not-found';
  }
  if (isElementDisabled(button)) {
    return 'send-control-disabled';
  }
  return button;
}

export async function submitAuthorizedPrompt(
  expectedContentHash: string,
  options: {
    root?: ParentNode;
    expectedPromptText?: string;
    submitObserveTimeoutMs?: number;
    submitObservePollIntervalMs?: number;
  } = {},
): Promise<SubmitPromptResult> {
  const root = options.root ?? getDefaultRoot();
  const composerHash = await getComposerContentHash(root);
  if (!composerHash) {
    return { ok: false, reason: 'composer-not-found' };
  }
  if (composerHash !== expectedContentHash) {
    return { ok: false, reason: 'composer-hash-mismatch', composerHash };
  }
  const button = findUniqueSendButton(root);
  if (!button) {
    return { ok: false, reason: 'send-control-not-found', composerHash };
  }
  if (typeof button === 'string') {
    return { ok: false, reason: button, composerHash };
  }
  try {
    button.click();
  } catch {
    return { ok: false, reason: 'send-click-failed', composerHash };
  }
  if (options.expectedPromptText) {
    const observed = await waitForSubmittedPromptEvidence(
      expectedContentHash,
      options.expectedPromptText,
      root,
      {
        timeoutMs: options.submitObserveTimeoutMs,
        pollIntervalMs: options.submitObservePollIntervalMs,
      },
    );
    if (!observed) {
      return { ok: false, reason: 'submit-not-observed', composerHash };
    }
  }
  return { ok: true, reason: null, composerHash };
}

async function fallbackToClipboard(
  text: string,
  reason: Exclude<FillComposerReason, null>,
  clipboard?: ClipboardWriter,
  allowClipboardFallback = false,
): Promise<FillComposerResult> {
  if (!allowClipboardFallback) {
    return {
      ok: false,
      status: 'failed',
      reason,
      method: 'none',
    };
  }

  const clipboardResult = await copyTextToClipboard(text, clipboard);

  return {
    ok: false,
    status: 'clipboard-fallback',
    reason: clipboardResult.reason ?? reason,
    method: 'clipboard',
    clipboard: clipboardResult,
  };
}

export async function fillComposerText(
  text: string,
  options: FillComposerOptions = {},
): Promise<FillComposerResult> {
  const input = await locateComposerInput(options.root ?? getDefaultRoot(), {
    timeoutMs: options.timeoutMs,
    pollIntervalMs: options.pollIntervalMs,
    now: options.now,
    delay: options.delay,
  });
  if (!input) {
    return fallbackToClipboard(
      text,
      'input-not-found',
      options.clipboard,
      options.allowClipboardFallback,
    );
  }

  const method = getInputMethod(input);
  try {
    dispatchBeforeInput(input, text);
    if (method === 'textarea') {
      fillTextarea(input, text);
    } else {
      fillContentEditable(input, text);
    }

    dispatchComposerEvent(input, 'input');
    dispatchComposerEvent(input, 'change');
  } catch {
    return fallbackToClipboard(
      text,
      'input-fill-failed',
      options.clipboard,
      options.allowClipboardFallback,
    );
  }

  // Verify the text actually landed in the composer rather than trusting that
  // the write path ran. If the DOM rejected or transformed our input, fall
  // back to the clipboard so the content is never silently lost.
  const verified = await waitForComposerText(input, method, text, {
    timeoutMs: options.verifyTimeoutMs,
    now: options.now,
    delay: options.delay,
  });
  if (!verified) {
    return fallbackToClipboard(
      text,
      'input-verify-failed',
      options.clipboard,
      options.allowClipboardFallback,
    );
  }

  return {
    ok: true,
    status: 'filled',
    reason: null,
    method,
  };
}
