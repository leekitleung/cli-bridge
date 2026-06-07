export interface ClipboardFallbackResult {
  ok: boolean;
  status: 'success' | 'failed';
  reason: 'clipboard-unavailable' | 'clipboard-write-failed' | null;
}

export interface ClipboardWriter {
  writeText(text: string): Promise<void>;
}

export async function copyTextToClipboard(
  text: string,
  clipboard: ClipboardWriter | undefined = globalThis.navigator?.clipboard,
): Promise<ClipboardFallbackResult> {
  if (!clipboard) {
    return {
      ok: false,
      status: 'failed',
      reason: 'clipboard-unavailable',
    };
  }

  try {
    await clipboard.writeText(text);
    return {
      ok: true,
      status: 'success',
      reason: null,
    };
  } catch {
    return {
      ok: false,
      status: 'failed',
      reason: 'clipboard-write-failed',
    };
  }
}
