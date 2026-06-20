export const DEFAULT_EXTRACTION_MARKER = '## Next Prompt for Codex';

export type ExtractPromptSource = 'selection' | 'marker' | 'assistant-fallback';

export type ExtractPromptReason =
  | 'no-selection-or-marker'
  | 'streaming'
  | null;

export interface ExtractPromptResult {
  ok: boolean;
  status: 'extracted' | 'blocked' | 'failed';
  source: ExtractPromptSource | null;
  text: string;
  reason: ExtractPromptReason;
}

export interface ExtractPromptOptions {
  root?: ParentNode;
  marker?: string;
  selection?: Pick<Selection, 'toString'> | null;
}

export interface StableAssistantResponseResult {
  ok: boolean;
  text: string;
  reason: 'streaming' | 'empty' | 'unstable' | 'not-found' | null;
}

const VISIBLE_TEXT_SELECTORS = [
  '[data-message-author-role="assistant"]',
  '[data-testid^="conversation-turn"] [data-message-author-role="assistant"]',
] as const;

const ASSISTANT_MESSAGE_SELECTORS = [
  '[data-message-author-role="assistant"]',
  '[data-testid^="conversation-turn"] [data-message-author-role="assistant"]',
] as const;

const STREAMING_SELECTORS = [
  '[data-testid="stop-button"]',
  'button[aria-label*="Stop"]',
  '[aria-busy="true"]',
  '[data-is-streaming="true"]',
] as const;

function getDefaultRoot(): ParentNode | null {
  return globalThis.document ?? null;
}

function getDefaultSelection(): Pick<Selection, 'toString'> | null {
  return globalThis.getSelection?.() ?? null;
}

function isHiddenElement(element: Element): boolean {
  const style = element.getAttribute('style')?.toLowerCase() ?? '';

  return (
    element.getAttribute('hidden') !== null ||
    element.getAttribute('aria-hidden') === 'true' ||
    style.includes('display: none') ||
    style.includes('visibility: hidden')
  );
}

function getElementText(element: Element): string {
  const candidate = element as Element & {
    innerText?: string;
    textContent?: string | null;
  };

  if (typeof candidate.innerText === 'string') {
    return candidate.innerText;
  }

  return candidate.textContent ?? '';
}

function getVisibleTextBlocks(root: ParentNode): string[] {
  const blocks: string[] = [];
  const seen = new Set<Element>();

  for (const selector of VISIBLE_TEXT_SELECTORS) {
    const elements = Array.from(root.querySelectorAll(selector));

    for (const element of elements) {
      if (seen.has(element) || isHiddenElement(element)) {
        continue;
      }

      seen.add(element);
      const text = getElementText(element).trim();
      if (text.length > 0) {
        blocks.push(text);
      }
    }
  }

  return blocks;
}

function getVisibleAssistantElements(root: ParentNode): Element[] {
  const elements: Element[] = [];
  const seen = new Set<Element>();

  for (const selector of ASSISTANT_MESSAGE_SELECTORS) {
    for (const element of Array.from(root.querySelectorAll(selector))) {
      if (seen.has(element) || isHiddenElement(element)) {
        continue;
      }

      seen.add(element);
      elements.push(element);
    }
  }

  return elements;
}

function getMarkdownHeadingLevel(line: string): number | null {
  const match = /^(#{1,6})\s+/.exec(line.trim());
  return match ? match[1].length : null;
}

export function getUserSelectionText(
  selection: Pick<Selection, 'toString'> | null = getDefaultSelection(),
): string {
  return selection?.toString().trim() ?? '';
}

export function extractMarkedBlock(
  root: ParentNode | null = getDefaultRoot(),
  marker = DEFAULT_EXTRACTION_MARKER,
): ExtractPromptResult {
  if (!root) {
    return {
      ok: false,
      status: 'failed',
      source: null,
      text: '',
      reason: 'no-selection-or-marker',
    };
  }

  const markerLevel = getMarkdownHeadingLevel(marker) ?? 6;

  for (const block of getVisibleTextBlocks(root)) {
    const lines = block.replace(/\r\n/g, '\n').split('\n');
    const markerIndex = lines.findIndex((line) => line.trim() === marker);

    if (markerIndex < 0) {
      continue;
    }

    const extractedLines: string[] = [];
    for (let index = markerIndex + 1; index < lines.length; index += 1) {
      const line = lines[index];
      const headingLevel = getMarkdownHeadingLevel(line);

      if (headingLevel !== null && headingLevel <= markerLevel) {
        break;
      }

      extractedLines.push(line);
    }

    const text = extractedLines.join('\n').trim();
    if (text.length > 0) {
      return {
        ok: true,
        status: 'extracted',
        source: 'marker',
        text,
        reason: null,
      };
    }
  }

  return {
    ok: false,
    status: 'failed',
    source: null,
    text: '',
    reason: 'no-selection-or-marker',
  };
}

export function detectStreamingState(root: ParentNode | null = getDefaultRoot()): boolean {
  if (!root) {
    return false;
  }

  return STREAMING_SELECTORS.some((selector) => (
    Array.from(root.querySelectorAll(selector)).some((element) => !isHiddenElement(element))
  ));
}

export function extractLastCompleteAssistantMessage(
  root: ParentNode | null = getDefaultRoot(),
): ExtractPromptResult {
  if (!root) {
    return {
      ok: false,
      status: 'failed',
      source: null,
      text: '',
      reason: 'no-selection-or-marker',
    };
  }

  const assistantElements = getVisibleAssistantElements(root);
  const lastAssistant = assistantElements.at(-1);
  if (!lastAssistant) {
    return {
      ok: false,
      status: 'failed',
      source: null,
      text: '',
      reason: 'no-selection-or-marker',
    };
  }

  const text = getElementText(lastAssistant).trim();
  if (text.length === 0) {
    return {
      ok: false,
      status: 'failed',
      source: null,
      text: '',
      reason: 'no-selection-or-marker',
    };
  }

  return {
    ok: true,
    status: 'extracted',
    source: 'assistant-fallback',
    text,
    reason: null,
  };
}

function defaultDelay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    if (typeof globalThis.setTimeout === 'function') {
      globalThis.setTimeout(resolve, ms);
    } else {
      resolve();
    }
  });
}

export async function waitForStableAssistantResponse(options: {
  root?: ParentNode;
  timeoutMs?: number;
  pollIntervalMs?: number;
  stablePolls?: number;
  now?: () => number;
  delay?: (ms: number) => Promise<void>;
} = {}): Promise<StableAssistantResponseResult> {
  const root = options.root ?? getDefaultRoot();
  const timeoutMs = options.timeoutMs ?? 60_000;
  const pollIntervalMs = options.pollIntervalMs ?? 1000;
  const stablePolls = options.stablePolls ?? 2;
  const now = options.now ?? (() => Date.now());
  const delay = options.delay ?? defaultDelay;
  const start = now();
  let lastText = '';
  let stableCount = 0;

  while (now() - start <= timeoutMs) {
    if (detectStreamingState(root)) {
      stableCount = 0;
      await delay(pollIntervalMs);
      continue;
    }
    const extracted = extractLastCompleteAssistantMessage(root);
    if (!extracted.ok || extracted.text.trim().length === 0) {
      await delay(pollIntervalMs);
      continue;
    }
    if (extracted.text === lastText) {
      stableCount += 1;
    } else {
      lastText = extracted.text;
      stableCount = 1;
    }
    if (stableCount >= stablePolls) {
      return { ok: true, text: lastText, reason: null };
    }
    await delay(pollIntervalMs);
  }

  if (detectStreamingState(root)) {
    return { ok: false, text: '', reason: 'streaming' };
  }
  if (!lastText) {
    return { ok: false, text: '', reason: 'not-found' };
  }
  return { ok: false, text: lastText, reason: 'unstable' };
}

export function extractPromptText(
  options: ExtractPromptOptions = {},
): ExtractPromptResult {
  const root = options.root ?? getDefaultRoot();
  const selectionText = getUserSelectionText(options.selection ?? getDefaultSelection());
  if (selectionText.length > 0) {
    return {
      ok: true,
      status: 'extracted',
      source: 'selection',
      text: selectionText,
      reason: null,
    };
  }

  const markerResult = extractMarkedBlock(root, options.marker ?? DEFAULT_EXTRACTION_MARKER);
  if (markerResult.ok) {
    return markerResult;
  }

  if (detectStreamingState(root)) {
    return {
      ok: false,
      status: 'blocked',
      source: null,
      text: '',
      reason: 'streaming',
    };
  }

  return {
    ok: false,
    status: 'failed',
    source: null,
    text: '',
    reason: 'no-selection-or-marker',
  };
}
