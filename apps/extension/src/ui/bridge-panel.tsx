import { copyTextToClipboard, type ClipboardFallbackResult } from '../content/clipboard.ts';
import { extractPromptText, type ExtractPromptResult } from '../content/extraction.ts';
import { fillComposerText, type FillComposerResult } from '../content/chatgpt-dom.ts';
import {
  createCopyPanelStatus,
  createExtractPanelStatus,
  createFillPanelStatus,
  createLoopPanelStatus,
  IDLE_PANEL_STATUS,
  type BridgePanelStatus,
  type BridgePanelLoopStage,
} from './state.ts';

export const PANEL_ROOT_ID = 'cli-bridge-panel-root';

export interface BridgePanelHandle {
  element: HTMLElement;
  getFillStatus(): FillComposerResult | null;
  getExtractStatus(): ExtractPromptResult | null;
  getCopyStatus(): ClipboardFallbackResult | null;
  getPanelStatus(): BridgePanelStatus;
}

export function mountBridgePanel(root: Document = document): BridgePanelHandle {
  let latestFillStatus: FillComposerResult | null = null;
  let latestExtractStatus: ExtractPromptResult | null = null;
  let latestCopyStatus: ClipboardFallbackResult | null = null;
  let latestPanelStatus: BridgePanelStatus = IDLE_PANEL_STATUS;
  let latestLoopStage: BridgePanelLoopStage = 'codex-output-ready';

  const panel = root.createElement('section');
  panel.id = PANEL_ROOT_ID;
  panel.setAttribute('data-cli-bridge-panel', 'true');
  Object.assign(panel.style, {
    position: 'fixed',
    right: '16px',
    bottom: '16px',
    zIndex: '2147483647',
    width: '320px',
    boxSizing: 'border-box',
    padding: '12px',
    display: 'grid',
    gap: '8px',
    color: '#111827',
    background: '#ffffff',
    border: '1px solid #d1d5db',
    borderRadius: '8px',
    boxShadow: '0 16px 40px rgba(0, 0, 0, 0.18)',
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    fontSize: '13px',
  });

  const input = root.createElement('textarea');
  input.setAttribute('aria-label', 'CLI Bridge text');
  input.rows = 4;
  Object.assign(input.style, {
    width: '100%',
    minHeight: '80px',
    boxSizing: 'border-box',
    resize: 'vertical',
    color: '#111827',
    background: '#ffffff',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    padding: '8px',
    font: 'inherit',
  });

  const fillButton = root.createElement('button');
  fillButton.type = 'button';
  fillButton.textContent = '填入';

  const extractButton = root.createElement('button');
  extractButton.type = 'button';
  extractButton.textContent = '提取';

  const copyButton = root.createElement('button');
  copyButton.type = 'button';
  copyButton.textContent = '复制';

  for (const button of [fillButton, extractButton, copyButton]) {
    Object.assign(button.style, {
      minHeight: '32px',
      color: '#111827',
      background: '#f9fafb',
      border: '1px solid #d1d5db',
      borderRadius: '6px',
      cursor: 'pointer',
      font: 'inherit',
    });
  }

  const status = root.createElement('output');
  status.textContent = latestPanelStatus.label;
  Object.assign(status.style, {
    minHeight: '18px',
    color: '#374151',
    overflowWrap: 'anywhere',
  });

  const loopStatus = root.createElement('output');
  loopStatus.setAttribute('data-cli-bridge-loop-status', 'true');
  Object.assign(loopStatus.style, {
    minHeight: '18px',
    color: '#4b5563',
    overflowWrap: 'anywhere',
  });

  const preview = root.createElement('pre');
  preview.textContent = '';
  Object.assign(preview.style, {
    maxHeight: '160px',
    margin: '0',
    padding: '8px',
    overflow: 'auto',
    whiteSpace: 'pre-wrap',
    color: '#111827',
    background: '#f3f4f6',
    borderRadius: '6px',
    font: '12px ui-monospace, SFMono-Regular, Menlo, monospace',
  });

  const renderStatus = (nextStatus: BridgePanelStatus) => {
    latestPanelStatus = nextStatus;
    status.textContent = nextStatus.detail
      ? `${nextStatus.label}: ${nextStatus.detail}`
      : nextStatus.label;
  };

  const renderLoopStatus = (nextStage: BridgePanelLoopStage) => {
    latestLoopStage = nextStage;
    const nextStatus = createLoopPanelStatus(nextStage);
    loopStatus.textContent = `${nextStatus.label}: ${nextStatus.detail}`;
  };

  renderLoopStatus(latestLoopStage);

  fillButton.addEventListener('click', async () => {
    latestFillStatus = await fillComposerText(input.value, {
      root,
      clipboard: globalThis.navigator?.clipboard,
    });
    renderStatus(createFillPanelStatus(latestFillStatus));
    if (latestFillStatus.ok) {
      renderLoopStatus('chatgpt-awaiting-user-send');
    }
  });

  extractButton.addEventListener('click', () => {
    latestExtractStatus = extractPromptText({
      root,
    });
    preview.textContent = latestExtractStatus.text;
    renderStatus(createExtractPanelStatus(latestExtractStatus));
    if (latestExtractStatus.ok) {
      renderLoopStatus('pending-prompt-ready');
    }
  });

  copyButton.addEventListener('click', async () => {
    const text = preview.textContent || input.value;
    latestCopyStatus = await copyTextToClipboard(text, globalThis.navigator?.clipboard);
    renderStatus(createCopyPanelStatus(latestCopyStatus));
  });

  panel.append(input, fillButton, extractButton, copyButton, loopStatus, status, preview);
  root.body.append(panel);

  return {
    element: panel,
    getFillStatus() {
      return latestFillStatus;
    },
    getExtractStatus() {
      return latestExtractStatus;
    },
    getCopyStatus() {
      return latestCopyStatus;
    },
    getPanelStatus() {
      return latestPanelStatus;
    },
  };
}
