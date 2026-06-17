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
  hasPairingToken,
  loadPairingTokenFromStorage,
  testPrivateHealth,
} from '../content/bridge-client.ts';
import {
  ensureOutboundPromptPoller,
  stopActiveOutboundPoller,
} from '../content/outbound-poller.ts';
import {
  clearActiveRelaySession,
  getActiveRelaySession,
  submitExtractReturn,
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
    maxWidth: 'calc(100vw - 32px)',
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

  const title = root.createElement('div');
  title.textContent = 'CLI Bridge';
  Object.assign(title.style, {
    fontWeight: '700',
    color: '#111827',
  });

  const scope = root.createElement('div');
  scope.textContent = 'ChatGPT 交接工具 · 配对请点浏览器扩展图标';
  Object.assign(scope.style, {
    color: '#4b5563',
    fontSize: '12px',
  });

  const input = root.createElement('textarea');
  input.setAttribute('aria-label', 'CLI Bridge text');
  input.rows = 4;
  input.placeholder = '粘贴要交给 ChatGPT 的下一步内容';
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

  const testTokenButton = root.createElement('button');
  testTokenButton.type = 'button';
  testTokenButton.textContent = '刷新连接';

  const clearTokenButton = root.createElement('button');
  clearTokenButton.type = 'button';
  clearTokenButton.textContent = '清除配对';

  const connectionActions = root.createElement('div');
  Object.assign(connectionActions.style, {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '8px',
  });

  const connectionStatus = root.createElement('output');
  connectionStatus.setAttribute('data-cli-bridge-connection-status', 'true');
  Object.assign(connectionStatus.style, {
    minHeight: '18px',
    color: '#374151',
    overflowWrap: 'anywhere',
  });

  const fillButton = root.createElement('button');
  fillButton.type = 'button';
  fillButton.textContent = '填入下一步';

  const extractButton = root.createElement('button');
  extractButton.type = 'button';
  extractButton.textContent = '预览回传';

  const returnButton = root.createElement('button');
  returnButton.type = 'button';
  returnButton.textContent = '确认回传';

  const copyButton = root.createElement('button');
  copyButton.type = 'button';
  copyButton.textContent = '复制预览';

  const returnActions = root.createElement('div');
  Object.assign(returnActions.style, {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr 1fr',
    gap: '8px',
  });

  for (const button of [testTokenButton, clearTokenButton, fillButton, extractButton, returnButton, copyButton]) {
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
  Object.assign(fillButton.style, {
    color: '#ffffff',
    background: '#0f766e',
    border: '1px solid #0f766e',
    fontWeight: '700',
  });

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
      ? '回程上下文可用'
      : '暂无回程上下文';
  };

  renderRelayStatus();

  const renderConnection = (state: Parameters<typeof createConnectionPanelStatus>[0]) => {
    const next = createConnectionPanelStatus(state);
    connectionStatus.textContent = `${next.label}: ${next.detail}`;
    connectionStatus.style.color = getPanelStatusColor(next.kind);
    connectionStatus.style.fontWeight = '600';
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

  testTokenButton.addEventListener('click', async () => {
    await loadPairingTokenFromStorage();
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
  let pendingExtractText = '';

  fillButton.addEventListener('click', async () => {
    if (detectStreamingState(root)) {
      renderStatus(createStreamingBlockedPanelStatus());
      return;
    }

    renderStatus(createLocatingPanelStatus());
    latestFillStatus = await fillComposerText(input.value, {
      root,
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
      pendingExtractText = latestExtractStatus.text;
      renderLoopStatus('pending-prompt-ready');
    } else {
      pendingExtractText = '';
    }
  });

  returnButton.addEventListener('click', async () => {
    if (!pendingExtractText) {
      renderStatus({
        kind: 'blocked',
        label: '没有待回传内容',
        detail: '请先预览回传内容',
      });
      return;
    }
    if (!hasPairingToken()) {
      renderConnection('unpaired');
      return;
    }

    const routed = await submitExtractReturn(
      pendingExtractText,
      sessionId,
      createExtractReturn,
    );
    if (!routed.ok) {
      if (routed.error === 'network-error') {
        renderStatus(createNetworkErrorPanelStatus());
      }
      return;
    }
    pendingExtractText = '';
    renderStatus(createExtractRoutePanelStatus(routed.data?.routedTo, routed.data?.fallbackReason));
    renderRelayStatus();
  });

  copyButton.addEventListener('click', async () => {
    const text = preview.textContent || input.value;
    latestCopyStatus = await copyTextToClipboard(text, globalThis.navigator?.clipboard);
    renderStatus(createCopyPanelStatus(latestCopyStatus));
  });

  connectionActions.append(testTokenButton, clearTokenButton);
  returnActions.append(extractButton, returnButton, copyButton);

  panel.append(
    title,
    scope,
    connectionStatus,
    connectionActions,
    input,
    fillButton,
    returnActions,
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
