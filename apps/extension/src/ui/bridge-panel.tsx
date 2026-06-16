import { copyTextToClipboard, type ClipboardFallbackResult } from '../content/clipboard.ts';
import {
  detectStreamingState,
  extractPromptText,
  type ExtractPromptResult,
} from '../content/extraction.ts';
import { fillComposerText, type FillComposerResult } from '../content/chatgpt-dom.ts';
import {
  clearPairingTokenFromStorage,
  createExtractReturn,
  createPacket,
  getMetrics,
  hasPairingToken,
  loadPairingTokenFromStorage,
  savePairingTokenToStorage,
  testPrivateHealth,
} from '../content/bridge-client.ts';
import {
  ensureOutboundPromptPoller,
  stopActiveOutboundPoller,
} from '../content/outbound-poller.ts';
import {
  clearActiveRelaySession,
  getActiveRelaySession,
} from '../content/active-relay-session.ts';
import {
  createConnectionPanelStatus,
  createCopyPanelStatus,
  createExtractPanelStatus,
  createExtractRoutePanelStatus,
  createFillPanelStatus,
  createLocatingPanelStatus,
  createLoopPanelStatus,
  createNetworkErrorPanelStatus,
  createStreamingBlockedPanelStatus,
  getPanelStatusColor,
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

  const pairingInput = root.createElement('input');
  pairingInput.type = 'password';
  pairingInput.setAttribute('aria-label', 'Pairing token');
  pairingInput.setAttribute('data-cli-bridge-pairing-input', 'true');
  const PAIRING_TOKEN_PLACEHOLDER = '粘贴 local server 的 pairing token';
  const PAIRED_TOKEN_PLACEHOLDER = '已配对（点清除可更换 token）';
  pairingInput.placeholder = PAIRING_TOKEN_PLACEHOLDER;
  Object.assign(pairingInput.style, {
    width: '100%',
    boxSizing: 'border-box',
    color: '#111827',
    background: '#ffffff',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    padding: '6px 8px',
    font: 'inherit',
  });

  const saveTokenButton = root.createElement('button');
  saveTokenButton.type = 'button';
  saveTokenButton.textContent = '保存';

  const testTokenButton = root.createElement('button');
  testTokenButton.type = 'button';
  testTokenButton.textContent = '测试';

  const clearTokenButton = root.createElement('button');
  clearTokenButton.type = 'button';
  clearTokenButton.textContent = '清除';

  const connectionStatus = root.createElement('output');
  connectionStatus.setAttribute('data-cli-bridge-connection-status', 'true');
  Object.assign(connectionStatus.style, {
    minHeight: '18px',
    color: '#374151',
    overflowWrap: 'anywhere',
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

  for (const button of [saveTokenButton, testTokenButton, clearTokenButton, fillButton, extractButton, copyButton]) {
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

  // Observability for the multi-executor relay: surfaces which session the
  // panel will use for extract-return. The content script never shows or
  // accepts a routing target (endpoint); only the session is displayed.
  const relayStatus = root.createElement('output');
  relayStatus.setAttribute('data-cli-bridge-relay-status', 'true');
  Object.assign(relayStatus.style, {
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

  // Reflect the active relay session (set by the outbound poller after a
  // successful fill + ack). No endpoint is ever shown; routing is server-side.
  const renderRelayStatus = () => {
    const active = getActiveRelaySession();
    relayStatus.textContent = active
      ? `active relay session: ${active.sessionId}`
      : 'no active relay session';
  };

  renderRelayStatus();

  const renderConnection = (state: Parameters<typeof createConnectionPanelStatus>[0]) => {
    const next = createConnectionPanelStatus(state);
    connectionStatus.textContent = `${next.label}: ${next.detail}`;
    connectionStatus.style.color = getPanelStatusColor(next.kind);
    connectionStatus.style.fontWeight = '600';
    pairingInput.placeholder = state === 'connected'
      ? PAIRED_TOKEN_PLACEHOLDER
      : PAIRING_TOKEN_PLACEHOLDER;
  };

  // Show an explicit initial state so the pairing area never looks inert.
  renderConnection('unpaired');

  const refreshConnection = async () => {
    if (!hasPairingToken()) {
      renderConnection('unpaired');
      return;
    }
    renderConnection('checking');
    const probe = await testPrivateHealth();
    renderConnection(probe);
    if (probe === 'connected') {
      ensureOutboundPromptPoller({
        root,
        clipboard: globalThis.navigator?.clipboard,
      });
    }
    renderRelayStatus();
  };

  // Load any stored token and report connection state (no auto-send involved).
  loadPairingTokenFromStorage()
    .then(() => refreshConnection())
    .catch(() => renderConnection('unpaired'));

  saveTokenButton.addEventListener('click', async () => {
    if (pairingInput.value.trim().length === 0) {
      renderConnection('unpaired');
      return;
    }
    // Immediate feedback so the click is never silent.
    renderConnection('checking');
    const saved = await savePairingTokenToStorage(pairingInput.value);
    pairingInput.value = '';
    if (!saved) {
      renderConnection('unpaired');
      return;
    }
    await refreshConnection();
  });

  testTokenButton.addEventListener('click', async () => {
    await refreshConnection();
  });

  clearTokenButton.addEventListener('click', async () => {
    await clearPairingTokenFromStorage();
    stopActiveOutboundPoller();
    clearActiveRelaySession();
    renderConnection('unpaired');
    renderRelayStatus();
  });

  const sessionId = `panel-${Date.now()}`;

  fillButton.addEventListener('click', async () => {
    if (detectStreamingState(root)) {
      renderStatus(createStreamingBlockedPanelStatus());
      return;
    }

    renderStatus(createLocatingPanelStatus());
    latestFillStatus = await fillComposerText(input.value, {
      root,
      clipboard: globalThis.navigator?.clipboard,
    });
    renderStatus(createFillPanelStatus(latestFillStatus));
    if (latestFillStatus.ok) {
      renderLoopStatus('chatgpt-awaiting-user-send');
      // Sync to server: record the content for the loop
      if (hasPairingToken()) {
        const syncResult = await createPacket(sessionId, input.value);
        if (!syncResult.ok && syncResult.error === 'network-error') {
          renderStatus(createNetworkErrorPanelStatus());
        }
      }
    }
  });

  extractButton.addEventListener('click', async () => {
    latestExtractStatus = extractPromptText({
      root,
    });
    preview.textContent = latestExtractStatus.text;
    renderStatus(createExtractPanelStatus(latestExtractStatus));
    // Reflect the session that will be used for routing before we send it.
    renderRelayStatus();
    if (latestExtractStatus.ok) {
      renderLoopStatus('pending-prompt-ready');
      // Route the extracted reply server-side: inbound when a relay context
      // resolves, else fall back to a pending prompt. The panel never supplies
      // a routing target; the server decides from the session context.
      if (hasPairingToken()) {
        // Prefer the session of the most recent successfully-filled outbound so
        // the server can resolve a relay context; otherwise use the panel's own
        // session, which falls back to a pending prompt (v0.2 behavior).
        const relaySession = getActiveRelaySession();
        const extractSessionId = relaySession?.sessionId ?? sessionId;
        const routed = await createExtractReturn(extractSessionId, latestExtractStatus.text);
        if (!routed.ok) {
          if (routed.error === 'network-error') {
            renderStatus(createNetworkErrorPanelStatus());
          }
        } else {
          renderStatus(createExtractRoutePanelStatus(routed.data?.routedTo, routed.data?.fallbackReason));
        }
      }
    }
  });

  copyButton.addEventListener('click', async () => {
    const text = preview.textContent || input.value;
    latestCopyStatus = await copyTextToClipboard(text, globalThis.navigator?.clipboard);
    renderStatus(createCopyPanelStatus(latestCopyStatus));
  });

  panel.append(
    pairingInput,
    saveTokenButton,
    testTokenButton,
    clearTokenButton,
    connectionStatus,
    input,
    fillButton,
    extractButton,
    copyButton,
    loopStatus,
    relayStatus,
    status,
    preview,
  );
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
