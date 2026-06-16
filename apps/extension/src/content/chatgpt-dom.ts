import {
  copyTextToClipboard,
  type ClipboardFallbackResult,
  type ClipboardWriter,
} from './clipboard.ts';

export type ComposerInput = HTMLTextAreaElement | HTMLElement;

export type FillComposerStatus = 'filled' | 'clipboard-fallback';

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
  method: 'textarea' | 'contenteditable' | 'clipboard';
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
}

export const DEFAULT_COMPOSER_LOCATE_TIMEOUT_MS = 3000;
export const DEFAULT_COMPOSER_LOCATE_POLL_INTERVAL_MS = 150;

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

async function fallbackToClipboard(
  text: string,
  reason: Exclude<FillComposerReason, null>,
  clipboard?: ClipboardWriter,
): Promise<FillComposerResult> {
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
    return fallbackToClipboard(text, 'input-not-found', options.clipboard);
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
    return fallbackToClipboard(text, 'input-fill-failed', options.clipboard);
  }

  // Verify the text actually landed in the composer rather than trusting that
  // the write path ran. If the DOM rejected or transformed our input, fall
  // back to the clipboard so the content is never silently lost.
  if (normalizeComposerText(readComposerText(input, method)) !== normalizeComposerText(text)) {
    return fallbackToClipboard(text, 'input-verify-failed', options.clipboard);
  }

  return {
    ok: true,
    status: 'filled',
    reason: null,
    method,
  };
}
