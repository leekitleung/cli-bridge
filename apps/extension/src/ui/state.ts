import type { ClipboardFallbackResult } from '../content/clipboard.ts';
import type { ExtractPromptResult } from '../content/extraction.ts';
import type { FillComposerResult } from '../content/chatgpt-dom.ts';

export type BridgePanelStatusKind =
  | 'idle'
  | 'success'
  | 'fallback'
  | 'blocked'
  | 'failed';

export interface BridgePanelStatus {
  kind: BridgePanelStatusKind;
  label: string;
  detail: string;
}

export const IDLE_PANEL_STATUS: BridgePanelStatus = {
  kind: 'idle',
  label: 'idle',
  detail: '',
};

export function createFillPanelStatus(result: FillComposerResult): BridgePanelStatus {
  if (result.ok) {
  return {
    kind: 'success',
    label: 'success',
    detail: `filled:${result.method}`,
  };
  }

  return {
    kind: 'fallback',
    label: 'fallback',
    detail: result.reason ?? 'clipboard-fallback',
  };
}

export function createExtractPanelStatus(result: ExtractPromptResult): BridgePanelStatus {
  if (result.ok) {
    return {
      kind: 'success',
      label: 'success',
      detail: result.source ?? 'extracted',
    };
  }

  if (result.status === 'blocked') {
    return {
      kind: 'blocked',
      label: 'blocked',
      detail: result.reason ?? 'blocked',
    };
  }

  return {
    kind: 'failed',
    label: 'failed',
    detail: 'Select text and retry, or copy the target content manually.',
  };
}

export function createCopyPanelStatus(result: ClipboardFallbackResult): BridgePanelStatus {
  if (result.ok) {
    return {
      kind: 'success',
      label: 'success',
      detail: 'copied',
    };
  }

  return {
    kind: 'failed',
    label: 'failed',
    detail: result.reason ?? 'copy-failed',
  };
}
