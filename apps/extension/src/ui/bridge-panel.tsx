import { copyTextToClipboard, type ClipboardFallbackResult } from '../content/clipboard.ts';
import {
  detectStreamingState,
  extractPromptText,
  type ExtractPromptResult,
} from '../content/extraction.ts';
import { fillComposerText, type FillComposerResult } from '../content/chatgpt-dom.ts';
import {
  cancelAutomationControl,
  clearPairingTokenFromStorage,
  createExtractReturn,
  createPacket,
  getAutomationControlStatus,
  hasPairingToken,
  loadPairingTokenFromStorage,
  pauseAutomationControl,
  resumeAutomationControl,
  testPrivateHealth,
} from '../content/bridge-client.ts';
import {
  ensureOutboundPromptPoller,
  stopActiveOutboundPoller,
} from '../content/outbound-poller.ts';
import {
  cancelActiveRelaySession,
  getActiveRelaySession,
  submitExtractReturn,
} from '../content/active-relay-session.ts';
import {
  createConnectionPanelStatus,
  createCopyPanelStatus,
  createExtractPanelStatus,
  createExtractRoutePanelStatus,
  createFillPanelStatus,
  createAutomationMirrorStatus,
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
  let pendingExtractText = '';
  let latestAutomationProposalId = '';
  let isConnected = false;
  let returnInFlight = false;

  const theme = root.createElement('style');
  theme.textContent = `
    #${PANEL_ROOT_ID} {
      --cb-panel-bg: #ffffff;
      --cb-surface: #f1f3f2;
      --cb-text: #181a19;
      --cb-muted: #5f6a65;
      --cb-border: #d7ddd9;
      --cb-accent: #10a37f;
      color-scheme: light dark;
    }
    #${PANEL_ROOT_ID}[data-cli-bridge-host-theme="dark"] {
      --cb-panel-bg: #171717;
      --cb-surface: #202020;
      --cb-text: #f4f4f5;
      --cb-muted: #a1a1aa;
      --cb-border: #303030;
    }
    @media (prefers-color-scheme: dark) {
      #${PANEL_ROOT_ID} {
        --cb-panel-bg: #171717;
        --cb-surface: #202020;
        --cb-text: #f4f4f5;
        --cb-muted: #a1a1aa;
        --cb-border: #303030;
      }
    }
    #${PANEL_ROOT_ID} button:focus-visible,
    #${PANEL_ROOT_ID} textarea:focus-visible {
      outline: 2px solid var(--cb-accent);
      outline-offset: 2px;
    }
  `;
  root.head?.append(theme);

  const panel = root.createElement('section');
  panel.id = PANEL_ROOT_ID;
  panel.setAttribute('data-cli-bridge-panel', 'true');
  if (isDarkHost(root)) {
    panel.setAttribute('data-cli-bridge-host-theme', 'dark');
  }
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
    color: 'var(--cb-text)',
    background: 'var(--cb-panel-bg)',
    border: '1px solid var(--cb-border)',
    borderRadius: '8px',
    boxShadow: '0 16px 40px rgba(0, 0, 0, 0.18)',
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    fontSize: '13px',
  });

  const title = root.createElement('div');
  title.textContent = 'CLI BRIDGE';
  Object.assign(title.style, {
    fontWeight: '700',
    color: 'var(--cb-text)',
    letterSpacing: '0.08em',
  });

  const collapseButton = root.createElement('button');
  collapseButton.type = 'button';
  collapseButton.setAttribute('aria-label', '收起面板');
  collapseButton.title = '收起';
  collapseButton.setAttribute('aria-expanded', 'true');
  const collapseIcon = createLucideChevronIcon(root, 'up');
  collapseButton.append(collapseIcon);

  const panelHeader = root.createElement('div');
  Object.assign(panelHeader.style, {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '8px',
  });
  panelHeader.append(title, collapseButton);

  const scope = root.createElement('div');
  scope.textContent = '1 连接 · 2 发送至 ChatGPT · 3 选择并预览 · 4 确认回传';
  Object.assign(scope.style, {
    color: 'var(--cb-muted)',
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
    color: 'var(--cb-text)',
    background: 'var(--cb-panel-bg)',
    border: '1px solid var(--cb-border)',
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
  connectionStatus.setAttribute('role', 'status');
  connectionStatus.setAttribute('aria-live', 'polite');
  Object.assign(connectionStatus.style, {
    minHeight: '18px',
    color: 'var(--cb-muted)',
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

  const pauseAutomationButton = root.createElement('button');
  pauseAutomationButton.type = 'button';
  pauseAutomationButton.textContent = '暂停自动化';

  const resumeAutomationButton = root.createElement('button');
  resumeAutomationButton.type = 'button';
  resumeAutomationButton.textContent = '恢复自动化';

  const cancelAutomationButton = root.createElement('button');
  cancelAutomationButton.type = 'button';
  cancelAutomationButton.textContent = '取消自动化';

  const automationActions = root.createElement('div');
  Object.assign(automationActions.style, {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr 1fr',
    gap: '8px',
  });

  for (const button of [
    testTokenButton,
    clearTokenButton,
    fillButton,
    extractButton,
    returnButton,
    copyButton,
    pauseAutomationButton,
    resumeAutomationButton,
    cancelAutomationButton,
  ]) {
    Object.assign(button.style, {
      minHeight: '44px',
      color: 'var(--cb-text)',
      background: 'var(--cb-surface)',
      border: '1px solid var(--cb-border)',
      borderRadius: '6px',
      cursor: 'pointer',
      font: 'inherit',
    });
  }
  const status = root.createElement('output');
  status.textContent = latestPanelStatus.label;
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  Object.assign(status.style, {
    minHeight: '18px',
    color: 'var(--cb-muted)',
    overflowWrap: 'anywhere',
  });

  const loopStatus = root.createElement('output');
  loopStatus.setAttribute('data-cli-bridge-loop-status', 'true');
  loopStatus.setAttribute('role', 'status');
  loopStatus.setAttribute('aria-live', 'polite');
  Object.assign(loopStatus.style, {
    minHeight: '18px',
    color: 'var(--cb-muted)',
    overflowWrap: 'anywhere',
  });

  // Observability for the multi-executor relay: surfaces which session the
  // panel will use for extract-return. The content script never shows or
  // accepts a routing target (endpoint); only the session is displayed.
  const relayStatus = root.createElement('output');
  relayStatus.setAttribute('data-cli-bridge-relay-status', 'true');
  relayStatus.setAttribute('role', 'status');
  Object.assign(relayStatus.style, {
    minHeight: '18px',
    color: 'var(--cb-muted)',
    overflowWrap: 'anywhere',
  });

  const automationStatus = root.createElement('output');
  automationStatus.setAttribute('data-cli-bridge-automation-status', 'true');
  automationStatus.setAttribute('role', 'status');
  automationStatus.setAttribute('aria-live', 'polite');
  Object.assign(automationStatus.style, {
    minHeight: '18px',
    color: 'var(--cb-muted)',
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
    color: 'var(--cb-text)',
    background: 'var(--cb-surface)',
    borderRadius: '6px',
    font: '12px ui-monospace, SFMono-Regular, Menlo, monospace',
  });

  Object.assign(collapseButton.style, {
    width: '44px',
    height: '44px',
    minHeight: '44px',
    padding: '0',
    display: 'inline-grid',
    placeItems: 'center',
    color: 'var(--cb-text)',
    background: 'var(--cb-surface)',
    border: '1px solid var(--cb-border)',
    borderRadius: '6px',
    cursor: 'pointer',
    font: 'inherit',
  });

  const setPrimary = (button: HTMLButtonElement, primary: boolean) => {
    button.style.color = primary ? '#ffffff' : 'var(--cb-text)';
    button.style.background = primary ? 'var(--cb-accent)' : 'var(--cb-surface)';
    button.style.borderColor = primary ? 'var(--cb-accent)' : 'var(--cb-border)';
    button.style.fontWeight = primary ? '700' : '500';
  };

  const updateActionState = () => {
    const canPreviewReturn = latestLoopStage === 'chatgpt-awaiting-user-send'
      || latestLoopStage === 'pending-prompt-ready';
    fillButton.disabled = !isConnected || latestLoopStage !== 'codex-output-ready';
    extractButton.disabled = !isConnected || !canPreviewReturn;
    returnButton.disabled = !isConnected || !pendingExtractText || returnInFlight;
    copyButton.disabled = preview.textContent?.length === 0;
    pauseAutomationButton.disabled = !isConnected || !latestAutomationProposalId;
    resumeAutomationButton.disabled = !isConnected || !latestAutomationProposalId;
    cancelAutomationButton.disabled = !isConnected || !latestAutomationProposalId;
    for (const button of [
      fillButton,
      extractButton,
      returnButton,
      copyButton,
      pauseAutomationButton,
      resumeAutomationButton,
      cancelAutomationButton,
    ]) {
      button.style.cursor = button.disabled ? 'not-allowed' : 'pointer';
      button.style.opacity = button.disabled ? '0.55' : '1';
    }
    setPrimary(fillButton, !fillButton.disabled);
    setPrimary(extractButton, !extractButton.disabled && latestLoopStage === 'chatgpt-awaiting-user-send');
    setPrimary(returnButton, !returnButton.disabled);
    setPrimary(copyButton, false);
    setPrimary(pauseAutomationButton, false);
    setPrimary(resumeAutomationButton, false);
    setPrimary(cancelAutomationButton, false);
  };

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
    updateActionState();
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

  const refreshAutomationMirror = async () => {
    if (!hasPairingToken()) {
      latestAutomationProposalId = '';
      const next = createAutomationMirrorStatus({});
      automationStatus.textContent = `${next.label}: ${next.detail}`;
      updateActionState();
      return;
    }
    const result = await getAutomationControlStatus();
    if (!result.ok) {
      latestAutomationProposalId = '';
      const next = createAutomationMirrorStatus({});
      automationStatus.textContent = `${next.label}: ${next.detail}`;
      updateActionState();
      return;
    }
    const data = result.data as {
      bindings?: Parameters<typeof createAutomationMirrorStatus>[0]['binding'][];
      proposals?: Parameters<typeof createAutomationMirrorStatus>[0]['proposal'][];
      currentBinding?: Parameters<typeof createAutomationMirrorStatus>[0]['binding'];
      currentProposal?: Parameters<typeof createAutomationMirrorStatus>[0]['proposal'];
    };
    const proposal = data.currentProposal ?? null;
    latestAutomationProposalId = proposal?.id ?? '';
    const next = createAutomationMirrorStatus({
      binding: data.currentBinding ?? null,
      proposal,
      round: 0,
    });
    automationStatus.textContent = `${next.label}: ${next.detail}`;
    updateActionState();
  };
  refreshAutomationMirror();

  const renderConnection = (state: Parameters<typeof createConnectionPanelStatus>[0]) => {
    const next = createConnectionPanelStatus(state);
    connectionStatus.textContent = `${next.label}: ${next.detail}`;
    connectionStatus.style.color = getPanelStatusColor(next.kind);
    connectionStatus.style.fontWeight = '600';
    isConnected = state === 'connected';
    updateActionState();
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
      await refreshAutomationMirror();
      ensureOutboundPromptPoller({
        root,
        clipboard: globalThis.navigator?.clipboard,
        autoRelay: true,
        onEvent(event) {
          if (event.type === 'claimed') {
            renderStatus({ kind: 'idle', label: '正在填入', detail: '已领取本地交接内容' });
          } else if (event.type === 'delivered') {
            renderStatus({ kind: 'success', label: '已填入', detail: '请在 ChatGPT 中手动发送' });
            renderLoopStatus('chatgpt-awaiting-user-send');
            renderRelayStatus();
          } else if (event.type === 'waiting') {
            if (event.reason === 'streaming') {
              renderStatus(createStreamingBlockedPanelStatus());
            } else if (event.reason === 'unpaired') {
              renderConnection('unpaired');
            } else if (event.reason === 'active-session') {
              renderRelayStatus();
            }
          } else if (event.type === 'submitted') {
            renderStatus({ kind: 'idle', label: '已提交', detail: '正在等待 ChatGPT 回复' });
          } else if (event.type === 'returned') {
            renderStatus({ kind: 'success', label: '已回传', detail: '回复已进入本地回程队列' });
            renderLoopStatus('codex-delivered');
            renderRelayStatus();
          } else {
            renderStatus({ kind: 'failed', label: '自动填入失败', detail: '请检查连接后重试' });
          }
        },
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
    cancelActiveRelaySession('pairing-cleared');
    renderConnection('unpaired');
    renderRelayStatus();
    await refreshAutomationMirror();
  });

  pauseAutomationButton.addEventListener('click', async () => {
    if (!latestAutomationProposalId) return;
    await pauseAutomationControl(latestAutomationProposalId, 'operator-pause');
    await refreshAutomationMirror();
  });

  resumeAutomationButton.addEventListener('click', async () => {
    if (!latestAutomationProposalId) return;
    await resumeAutomationControl(latestAutomationProposalId);
    await refreshAutomationMirror();
  });

  cancelAutomationButton.addEventListener('click', async () => {
    if (!latestAutomationProposalId) return;
    await cancelAutomationControl(latestAutomationProposalId, 'operator-cancel');
    await refreshAutomationMirror();
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
      updateActionState();
    }
  });

  returnButton.addEventListener('click', async () => {
    if (returnInFlight) return;
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

    returnInFlight = true;
    updateActionState();
    renderStatus({ kind: 'idle', label: '正在回传', detail: '请稍候，不要重复点击' });
    try {
      const routed = await submitExtractReturn(
        pendingExtractText,
        sessionId,
        createExtractReturn,
      );
      if (!routed.ok) {
        renderStatus(routed.error === 'network-error'
          ? createNetworkErrorPanelStatus()
          : { kind: 'failed', label: '回传失败', detail: '请检查配对状态后重试' });
        return;
      }
      pendingExtractText = '';
      renderStatus(createExtractRoutePanelStatus(routed.data?.routedTo, routed.data?.fallbackReason));
      renderLoopStatus('codex-delivered');
      renderRelayStatus();
    } finally {
      returnInFlight = false;
      updateActionState();
    }
  });

  copyButton.addEventListener('click', async () => {
    const text = preview.textContent || input.value;
    latestCopyStatus = await copyTextToClipboard(text, globalThis.navigator?.clipboard);
    renderStatus(createCopyPanelStatus(latestCopyStatus));
  });

  connectionActions.append(testTokenButton, clearTokenButton);
  returnActions.append(extractButton, returnButton, copyButton);
  automationActions.append(pauseAutomationButton, resumeAutomationButton, cancelAutomationButton);

  const panelBody = root.createElement('div');
  Object.assign(panelBody.style, { display: 'grid', gap: '8px' });
  panelBody.append(
    scope,
    connectionStatus,
    connectionActions,
    input,
    fillButton,
    returnActions,
    loopStatus,
    relayStatus,
    automationStatus,
    automationActions,
    status,
    preview,
  );
  collapseButton.addEventListener('click', () => {
    const collapsed = panelBody.hidden === false;
    panelBody.hidden = collapsed;
    panelBody.style.display = collapsed ? 'none' : 'grid';
    collapseButton.setAttribute('aria-label', collapsed ? '展开面板' : '收起面板');
    collapseButton.title = collapsed ? '展开' : '收起';
    collapseButton.setAttribute('aria-expanded', String(!collapsed));
    renderLucideChevronIcon(collapseIcon, collapsed ? 'down' : 'up');
  });

  panel.append(
    panelHeader,
    panelBody,
  );
  root.body.append(panel);
  updateActionState();

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

function isDarkHost(root: Document): boolean {
  const background = globalThis.getComputedStyle?.(root.body).backgroundColor ?? '';
  const match = background.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!match) {
    return false;
  }
  const [, r, g, b] = match.map(Number);
  return (0.2126 * r) + (0.7152 * g) + (0.0722 * b) < 128;
}

function createLucideChevronIcon(root: Document, direction: 'up' | 'down'): SVGSVGElement {
  const icon = root.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('width', '18');
  icon.setAttribute('height', '18');
  icon.setAttribute('fill', 'none');
  icon.setAttribute('stroke', 'currentColor');
  icon.setAttribute('stroke-width', '2');
  icon.setAttribute('stroke-linecap', 'round');
  icon.setAttribute('stroke-linejoin', 'round');
  icon.setAttribute('aria-hidden', 'true');
  icon.style.display = 'block';
  renderLucideChevronIcon(icon, direction);
  return icon;
}

function renderLucideChevronIcon(icon: SVGSVGElement, direction: 'up' | 'down') {
  const root = icon.ownerDocument;
  icon.replaceChildren();
  const path = root.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', direction === 'up' ? 'm18 15-6-6-6 6' : 'm6 9 6 6 6-6');
  icon.append(path);
}
