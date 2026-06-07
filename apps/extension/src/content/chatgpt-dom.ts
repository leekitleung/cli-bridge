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
  const input = findComposerInput(options.root ?? getDefaultRoot());
  if (!input) {
    return fallbackToClipboard(text, 'input-not-found', options.clipboard);
  }

  try {
    const method = getInputMethod(input);
    dispatchBeforeInput(input, text);
    if (method === 'textarea') {
      fillTextarea(input, text);
    } else {
      fillContentEditable(input, text);
    }

    dispatchComposerEvent(input, 'input');
    dispatchComposerEvent(input, 'change');

    return {
      ok: true,
      status: 'filled',
      reason: null,
      method,
    };
  } catch {
    return fallbackToClipboard(text, 'input-fill-failed', options.clipboard);
  }
}
