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
  getSourceRelayStatus,
  hasPairingToken,
  listOnlineEndpoints,
  loadPairingTokenFromStorage,
  pauseAutomationControl,
  resumeAutomationControl,
  testPrivateHealth,
  PAIRING_TOKEN_HEADER,
} from '../content/bridge-client.ts';
import {
  ensureOutboundPromptPoller,
  stopActiveOutboundPoller,
} from '../content/outbound-poller.ts';
import {
  ensureSourceRelayPoller,
  stopActiveSourceRelayPoller,
} from '../content/source-relay-poller.ts';
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
  createSourceRelayStatus,
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
      --cb-placeholder: #5f6a65;
      color-scheme: light dark;
    }
    #${PANEL_ROOT_ID}[data-cli-bridge-host-theme="dark"] {
      --cb-panel-bg: #171717;
      --cb-surface: #202020;
      --cb-text: #f4f4f5;
      --cb-muted: #9ca3af;
      --cb-border: #303030;
      --cb-placeholder: #9ca3af;
    }
    @media (prefers-color-scheme: dark) {
      #${PANEL_ROOT_ID} {
        --cb-panel-bg: #171717;
        --cb-surface: #202020;
        --cb-text: #f4f4f5;
        --cb-muted: #9ca3af;
        --cb-border: #303030;
        --cb-placeholder: #9ca3af;
      }
    }
    #${PANEL_ROOT_ID} button:focus-visible,
    #${PANEL_ROOT_ID} textarea:focus-visible {
      outline: 2px solid var(--cb-accent);
      outline-offset: 2px;
    }
    #${PANEL_ROOT_ID} button:hover:not(:disabled):not([aria-disabled="true"]) {
      filter: brightness(0.95);
    }
    #${PANEL_ROOT_ID} button:active:not(:disabled):not([aria-disabled="true"]) {
      filter: brightness(0.9);
      transform: translateY(1px);
    }
    #${PANEL_ROOT_ID} button:disabled,
    #${PANEL_ROOT_ID} button[aria-disabled="true"] {
      opacity: 0.5;
      filter: saturate(0.3);
      cursor: not-allowed;
    }
    @media (prefers-color-scheme: dark) {
      #${PANEL_ROOT_ID} button:disabled,
      #${PANEL_ROOT_ID} button[aria-disabled="true"] {
        opacity: 0.4;
        filter: saturate(0.2) brightness(0.8);
      }
    }
    #${PANEL_ROOT_ID} textarea::placeholder {
      color: var(--cb-placeholder);
    }
    #${PANEL_ROOT_ID} textarea::-webkit-input-placeholder {
      color: var(--cb-placeholder);
    }
  `;
  root.head?.append(theme);

  const panel = root.createElement('section');
  panel.id = PANEL_ROOT_ID;
  panel.setAttribute('data-cli-bridge-panel', 'true');
  const isDark = isDarkHost(root);
  if (isDark) {
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
  title.textContent = 'ChatGPT Web Source';
  Object.assign(title.style, {
    fontWeight: '700',
    color: 'var(--cb-text)',
    letterSpacing: '0.08em',
  });

  const collapseButton = root.createElement('button');
  collapseButton.type = 'button';
  collapseButton.setAttribute('aria-label', 'Collapse panel');
  collapseButton.title = 'Collapse';
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
  scope.textContent = 'Connected to local bridge as planner/source. Use Project Console for routing and execution.';
  scope.setAttribute('data-cli-bridge-source-status', 'true');
  Object.assign(scope.style, {
    color: 'var(--cb-muted)',
    fontSize: '12px',
  });

  const input = root.createElement('textarea');
  input.setAttribute('aria-label', 'CLI Bridge text');
  input.rows = 4;
  input.placeholder = 'Paste next step content to send to ChatGPT';
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
  input.style.setProperty('--placeholder-color', 'var(--cb-muted)');

  const testTokenButton = root.createElement('button');
  testTokenButton.type = 'button';
  testTokenButton.textContent = 'Refresh Connection';

  const clearTokenButton = root.createElement('button');
  clearTokenButton.type = 'button';
  clearTokenButton.textContent = 'Clear Pairing';

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
  fillButton.textContent = 'Fill Next Step';

  const extractButton = root.createElement('button');
  extractButton.type = 'button';
  extractButton.textContent = 'Preview Return';

  const returnButton = root.createElement('button');
  returnButton.type = 'button';
  returnButton.textContent = 'Confirm Return';

  const copyButton = root.createElement('button');
  copyButton.type = 'button';
  copyButton.textContent = 'Copy Preview';

  const returnActions = root.createElement('div');
  Object.assign(returnActions.style, {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr 1fr',
    gap: '8px',
  });

  const pauseAutomationButton = root.createElement('button');
  pauseAutomationButton.type = 'button';
  pauseAutomationButton.textContent = 'Pause Automation';

  const resumeAutomationButton = root.createElement('button');
  resumeAutomationButton.type = 'button';
  resumeAutomationButton.textContent = 'Resume Automation';

  const cancelAutomationButton = root.createElement('button');
  cancelAutomationButton.type = 'button';
  cancelAutomationButton.textContent = 'Cancel Automation';

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

  // ADR-0035: Source Relay diagnostics status with queue metrics
  const sourceRelayStatus = root.createElement('output');
  sourceRelayStatus.setAttribute('data-cli-bridge-source-relay-status', 'true');
  sourceRelayStatus.setAttribute('role', 'status');
  sourceRelayStatus.setAttribute('aria-live', 'polite');
  Object.assign(sourceRelayStatus.style, {
    minHeight: '18px',
    color: 'var(--cb-muted)',
    overflowWrap: 'anywhere',
    fontSize: '11px',
  });

  // ADR-0036: Queue metrics status
  const queueMetricsStatus = root.createElement('output');
  queueMetricsStatus.setAttribute('data-cli-bridge-queue-metrics', 'true');
  queueMetricsStatus.setAttribute('role', 'status');
  Object.assign(queueMetricsStatus.style, {
    minHeight: '18px',
    color: 'var(--cb-muted)',
    fontSize: '11px',
  });

  // ADR-0036: Executor endpoints status with health indicators
  const endpointsStatus = root.createElement('output');
  endpointsStatus.setAttribute('data-cli-bridge-endpoints-status', 'true');
  endpointsStatus.setAttribute('role', 'status');
  Object.assign(endpointsStatus.style, {
    minHeight: '18px',
    color: 'var(--cb-muted)',
    fontSize: '11px',
  });

  // ADR-0036: Goal Loop status with progress
  const goalLoopStatus = root.createElement('output');
  goalLoopStatus.setAttribute('data-cli-bridge-goal-loop-status', 'true');
  goalLoopStatus.setAttribute('role', 'status');
  Object.assign(goalLoopStatus.style, {
    minHeight: '18px',
    color: 'var(--cb-muted)',
    fontSize: '11px',
  });

  // ADR-0036: Goal list status
  const goalListStatus = root.createElement('output');
  goalListStatus.setAttribute('data-cli-bridge-goal-list-status', 'true');
  goalListStatus.setAttribute('role', 'status');
  Object.assign(goalListStatus.style, {
    minHeight: '18px',
    color: 'var(--cb-muted)',
    fontSize: '11px',
  });

  // ADR-0036: Performance metrics status
  const perfStatus = root.createElement('output');
  perfStatus.setAttribute('data-cli-bridge-perf-status', 'true');
  perfStatus.setAttribute('role', 'status');
  Object.assign(perfStatus.style, {
    minHeight: '18px',
    color: 'var(--cb-muted)',
    fontSize: '11px',
  });

  // Performance metrics tracking
  interface PerfMetrics {
    lastHeartbeatLatency: number | null;
    lastSourceRelayLatency: number | null;
    heartbeatCount: number;
    relayCount: number;
    errorCount: number;
    errors: Array<{ time: number; reason: string }>;
  }

  let perfMetrics: PerfMetrics = {
    lastHeartbeatLatency: null,
    lastSourceRelayLatency: null,
    heartbeatCount: 0,
    relayCount: 0,
    errorCount: 0,
    errors: [],
  };

  const updatePerfMetrics = () => {
    const errors = perfMetrics.errors.slice(-5); // Keep last 5 errors
    const parts: string[] = [];
    if (perfMetrics.lastHeartbeatLatency !== null) {
      parts.push(`HB: ${perfMetrics.lastHeartbeatLatency}ms`);
    }
    if (perfMetrics.lastSourceRelayLatency !== null) {
      parts.push(`Relay: ${perfMetrics.lastSourceRelayLatency}ms`);
    }
    if (perfMetrics.errorCount > 0) {
      parts.push(`Errors: ${perfMetrics.errorCount}`);
    }
    perfStatus.textContent = parts.length > 0
      ? `Perf: ${parts.join(' | ')}`
      : 'Perf: No data';
  };

  // ADR-0036: Expanded diagnostics panel
  const diagnosticsPanel = root.createElement('details');
  const diagnosticsSummary = root.createElement('summary');
  diagnosticsSummary.textContent = '🔍 Link Diagnostics';
  diagnosticsSummary.style.cursor = 'pointer';
  diagnosticsSummary.style.fontWeight = '600';
  diagnosticsPanel.append(diagnosticsSummary);

  const diagnosticsBody = root.createElement('div');
  Object.assign(diagnosticsBody.style, {
    display: 'grid',
    gap: '6px',
    marginTop: '8px',
    padding: '8px',
    background: 'var(--cb-surface)',
    borderRadius: '6px',
    fontSize: '11px',
  });

  const renderDiagnostics = () => {
    const health = ensureSourceRelayPoller().getHealth();
    const lines: string[] = [];

    // Connection status
    lines.push(`Status: ${health.isRunning ? 'Running' : 'Stopped'}`);
    lines.push(`Endpoints: ${health.consecutiveFailures >= 3 ? 'Offline' : 'Online'}`);

    // Heartbeat status
    if (health.lastHeartbeatAt) {
      const ago = Math.round((Date.now() - health.lastHeartbeatAt) / 1000);
      lines.push(`Last HB: ${ago}s ago`);
    } else {
      lines.push('Last HB: None');
    }

    // Backoff status
    if (health.isInBackoff) {
      lines.push(`Backoff: Retry #${health.backoffAttempts}, next in ${health.currentIntervalMs}ms`);
    }

    // Error history
    if (perfMetrics.errors.length > 0) {
      lines.push('--- Error History ---');
      for (const err of perfMetrics.errors.slice(-3).reverse()) {
        const ago = Math.round((Date.now() - err.time) / 1000);
        lines.push(`[${ago}s ago] ${err.reason}`);
      }
    }

    diagnosticsBody.textContent = lines.join('\n');
  };

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
    font: '12px SFMono-Regular, Consolas, Menlo, monospace',
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
      button.setAttribute('aria-disabled', String(button.disabled));
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
      ? 'Return context available'
      : 'No return context';
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

  // ADR-0036: Show executor endpoints status
  const refreshEndpointsStatus = async () => {
    const result = await listOnlineEndpoints();
    if (!result.ok || !result.data) {
      endpointsStatus.textContent = 'Endpoints: Query failed';
      return;
    }
    const { endpoints } = result.data;
    if (endpoints.length === 0) {
      endpointsStatus.textContent = 'Endpoints: No online executors';
    } else {
      // Show executor status with health indicators
      const statusParts = endpoints.map(e => {
        const healthy = e.online ? '✓' : '✗';
        return `${e.id}:${healthy}`;
      });
      endpointsStatus.textContent = `Executors: ${statusParts.join(' ')}`;
    }
  };
  refreshEndpointsStatus();
  setInterval(refreshEndpointsStatus, 30_000);

  // ADR-0036: Show Goal Loop status from bridge server
  interface GoalLoopStatusData {
    ok: boolean;
    status?: {
      goalId: string;
      goalStatus: string;
      planStatus: string;
      currentStepIndex: number;
      totalSteps: number;
    };
    error?: string;
  }

  let activeGoalLoop: { goalId: string; lastUpdate: number } | null = null;

  const refreshGoalLoopStatus = async (goalId?: string) => {
    // If no goalId provided, try to get from stored active loop
    const targetGoalId = goalId || activeGoalLoop?.goalId;
    if (!targetGoalId) {
      goalLoopStatus.textContent = 'Goal Loop: No active loop';
      return;
    }

    try {
      const response = await fetch(
        `http://127.0.0.1:31337/bridge/goals/${targetGoalId}/loop/status`,
        {
          headers: {
            [PAIRING_TOKEN_HEADER]: (window as any).__cliBridgePairingToken || '',
          },
        }
      );

      if (!response.ok) {
        goalLoopStatus.textContent = 'Goal Loop: Query failed';
        return;
      }

      const data: GoalLoopStatusData = await response.json();
      if (!data.ok || !data.status) {
        goalLoopStatus.textContent = 'Goal Loop: No active loop';
        activeGoalLoop = null;
        return;
      }

      const { status } = data;
      activeGoalLoop = { goalId: status.goalId, lastUpdate: Date.now() };

      // Format progress
      const progress = status.totalSteps > 0
        ? `${status.currentStepIndex + 1}/${status.totalSteps}`
        : '0/0';

      const statusIcon = status.goalStatus === 'executing' ? '▶'
        : status.goalStatus === 'approved' ? '○'
        : status.goalStatus === 'done' ? '✓'
        : status.goalStatus === 'failed' ? '✗'
        : '?';

      goalLoopStatus.textContent = `Loop: ${statusIcon} ${status.goalStatus} [${progress}]`;
    } catch {
      goalLoopStatus.textContent = 'Goal Loop: Connection failed';
    }
  };

  // Poll goal loop status every 5 seconds when active
  setInterval(() => {
    if (activeGoalLoop) {
      refreshGoalLoopStatus();
    }
  }, 5000);

  // ADR-0036: Show recent Goal list from bridge server
  interface GoalListData {
    ok: boolean;
    goals?: Array<{
      id: string;
      status: string;
      description: string;
      createdAt: number;
    }>;
    total?: number;
  }

  const refreshGoalListStatus = async () => {
    try {
      const response = await fetch(
        `http://127.0.0.1:31337/bridge/goals`,
        {
          headers: {
            [PAIRING_TOKEN_HEADER]: (window as any).__cliBridgePairingToken || '',
          },
        }
      );

      if (!response.ok) {
        goalListStatus.textContent = 'Goals: Query failed';
        return;
      }

      const data: GoalListData = await response.json();
      if (!data.ok || !data.goals) {
        goalListStatus.textContent = 'Goals: No data';
        return;
      }

      const { goals, total } = data;
      // Show up to 3 most recent goals
      const recent = goals.slice(0, 3);
      const parts = recent.map(g => {
        const icon = g.status === 'done' ? '✓'
          : g.status === 'failed' ? '✗'
          : g.status === 'executing' ? '▶'
          : g.status === 'approved' ? '○'
          : '·';
        const age = formatAge(g.createdAt);
        return `${icon}${age}`;
      });

      const totalStr = total && total > 3 ? `(+${total - 3})` : '';
      goalListStatus.textContent = parts.length > 0
        ? `Goals: ${parts.join(' ')} ${totalStr}`
        : 'Goals: No records';
    } catch {
      goalListStatus.textContent = 'Goals: Connection failed';
    }
  };

  // Format age from timestamp
  const formatAge = (timestamp: number): string => {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h`;
    return `${Math.floor(hours / 24)}d`;
  };

  refreshGoalListStatus();
  setInterval(refreshGoalListStatus, 30000);

  // ADR-0035: Source Relay health tracking for diagnostics
  const MAX_CONSECUTIVE_HEARTBEAT_FAILURES = 3;
  let sourceRelayHealth: {
    consecutiveFailures: number;
    isInBackoff: boolean;
    lastError: string | null;
    backoffAttempts: number;
    backoffRemainingMs: number;
    currentIntervalMs: number;
    maxIntervalMs: number;
    lastHeartbeatAt: number | null;
    isConnected: boolean;
    totalRequests: number;
    successCount: number;
    failureCount: number;
  } = {
    consecutiveFailures: 0,
    isInBackoff: false,
    lastError: null,
    backoffAttempts: 0,
    backoffRemainingMs: 0,
    currentIntervalMs: 0,
    maxIntervalMs: 0,
    lastHeartbeatAt: null,
    isConnected: false,
    totalRequests: 0,
    successCount: 0,
    failureCount: 0,
  };

  const renderSourceRelayStatus = () => {
    const next = createSourceRelayStatus(sourceRelayHealth);
    sourceRelayStatus.textContent = `${next.label}: ${next.detail}`;
    sourceRelayStatus.style.color = getPanelStatusColor(next.kind, isDark);
  };

  // ADR-0036: Render queue metrics from bridge server
  const renderQueueMetrics = () => {
    // Queue metrics are fetched from the server status endpoint
    // This now shows actual queue data from the server
    if (sourceRelayHealth.isConnected) {
      const successRate = sourceRelayHealth.totalRequests > 0
        ? Math.round((sourceRelayHealth.successCount / sourceRelayHealth.totalRequests) * 100)
        : 100;
      queueMetricsStatus.textContent = `Req: ${sourceRelayHealth.totalRequests} | OK: ${sourceRelayHealth.successCount} | Fail: ${sourceRelayHealth.failureCount} | Rate: ${successRate}%`;
    } else {
      queueMetricsStatus.textContent = 'Queue: Not connected';
    }
  };

  // ADR-0035: Fetch and display detailed queue metrics from bridge server
  const fetchAndDisplayQueueMetrics = async () => {
    try {
      const result = await getSourceRelayStatus();
      if (!result.ok) {
        queueMetricsStatus.textContent = 'Queue: Failed to fetch';
        return;
      }
      const data = result.data as {
        metrics: {
          depth: number;
          inFlight: number;
          completedInWindow: number;
          avgWaitTime: number;
          throughput: number;
          extensionConnected: boolean;
          lastHeartbeatAt: number | null;
        };
        recent: Array<{
          id: string;
          status: string;
          projectId: string;
          prompt: string;
          createdAt: number;
          claimedAt?: number;
          returnedAt?: number;
          failedAt?: number;
        }>;
      };

      const { metrics, recent } = data;
      const parts: string[] = [];

      // Queue depth and in-flight
      parts.push(`Pending: ${metrics.depth}`);
      parts.push(`In-flight: ${metrics.inFlight}`);
      parts.push(`Done: ${metrics.completedInWindow}`);

      // Throughput
      if (metrics.throughput > 0) {
        parts.push(`Tput: ${metrics.throughput.toFixed(1)}/min`);
      }

      // Average wait time
      if (metrics.avgWaitTime > 0) {
        parts.push(`Wait: ${Math.round(metrics.avgWaitTime / 1000)}s`);
      }

      // Connection status
      const connectedLabel = metrics.extensionConnected ? 'Connected' : 'Disconnected';
      parts.push(`Status: ${connectedLabel}`);

      queueMetricsStatus.textContent = parts.join(' | ');

      // Update success/failure counts based on recent activity
      const now = Date.now();
      const oneHourAgo = now - 3600000;
      let recentSuccess = 0;
      let recentFailed = 0;
      for (const item of recent) {
        if (item.createdAt < oneHourAgo) continue;
        if (item.status === 'returned') recentSuccess++;
        if (item.status === 'failed') recentFailed++;
      }
      sourceRelayHealth.totalRequests = recentSuccess + recentFailed;
      sourceRelayHealth.successCount = recentSuccess;
      sourceRelayHealth.failureCount = recentFailed;

    } catch {
      queueMetricsStatus.textContent = 'Queue: Failed to fetch';
    }
  };

  renderSourceRelayStatus();

  const renderConnection = (state: Parameters<typeof createConnectionPanelStatus>[0]) => {
    const next = createConnectionPanelStatus(state);
    connectionStatus.textContent = `${next.label}: ${next.detail}`;
    connectionStatus.style.color = getPanelStatusColor(next.kind, isDark);
    connectionStatus.style.fontWeight = '600';
    isConnected = state === 'connected';
    sourceRelayHealth.isConnected = state === 'connected';
    renderSourceRelayStatus();
    updateActionState();
  };

  // Show an explicit initial state so the pairing area never looks inert.
  renderConnection('unpaired');

  const startSourceRelay = () => {
    // ADR-0035: Source relay must keep running independently of the legacy
    // health probe so long-lived ChatGPT pages can pick up refreshed sessions.
    const handle = ensureSourceRelayPoller({
      root,
      onEvent(event) {
        if (event.type === 'claimed') {
          renderStatus({ kind: 'idle', label: 'Relay', detail: 'Processing console prompt' });
        } else if (event.type === 'returned') {
          renderStatus({ kind: 'success', label: 'Relay', detail: 'Reply sent to console' });
        } else if (event.type === 'heartbeat') {
          renderStatus({
            kind: event.ok ? 'success' : 'failed',
            label: 'Relay',
            detail: event.ok ? 'HB recorded' : 'HB failed',
          });
          if (event.ok) {
            sourceRelayHealth.lastHeartbeatAt = Date.now();
            sourceRelayHealth.consecutiveFailures = 0;
            sourceRelayHealth.isConnected = true;
            renderSourceRelayStatus();
          }
        } else if (event.type === 'failed') {
          // Build diagnostic message from failure reason
          const diagnosticMessages: Record<string, string> = {
            'fill-failed': 'Fill failed - check ChatGPT page',
            'submit-failed': 'Submit failed - try refresh',
            'extract-failed': 'Extract reply failed',
            'return-failed': 'Return failed',
            'heartbeat-failed': 'HB failed - connection error',
            'poll-failed': 'Poll failed - server unreachable',
            'network-unreachable': 'Network unreachable - check bridge server',
            'token-invalid': 'Token invalid - re-pair',
            'timeout': 'Timeout',
            'poller-error': 'Internal error',
          };
          const msg = diagnosticMessages[event.reason] || event.reason;
          renderStatus({ kind: 'failed', label: 'Relay', detail: `${msg}${event.detail ? ': ' + event.detail : ''}` });
          sourceRelayHealth.lastError = event.reason;
        } else if (event.type === 'reconnecting') {
          renderStatus({
            kind: 'warning',
            label: 'Reconnecting',
            detail: `Attempt ${event.attempt}/${event.maxAttempts}, next in ${Math.round(event.nextIntervalMs / 1000)}s`,
          });
          sourceRelayHealth.isInBackoff = true;
          sourceRelayHealth.backoffAttempts = event.attempt;
        } else if (event.type === 'connection-lost') {
          renderStatus({
            kind: 'warning',
            label: 'Connection lost',
            detail: `Retrying (${event.consecutiveFailures} failures)`,
          });
        } else if (event.type === 'connection-restored') {
          renderStatus({ kind: 'success', label: 'Relay', detail: 'Restored' });
          sourceRelayHealth.consecutiveFailures = 0;
          sourceRelayHealth.isInBackoff = false;
          sourceRelayHealth.lastError = null;
          sourceRelayHealth.isConnected = true;
          renderSourceRelayStatus();
        } else if (event.type === 'backoff-reset') {
          sourceRelayHealth.isInBackoff = false;
          sourceRelayHealth.backoffAttempts = 0;
        }

        // ADR-0036: Track performance metrics
        if (event.type === 'heartbeat') {
          perfMetrics.heartbeatCount++;
          updatePerfMetrics();
        } else if (event.type === 'returned') {
          perfMetrics.relayCount++;
          sourceRelayHealth.totalRequests++;
          sourceRelayHealth.successCount++;
          updatePerfMetrics();
        } else if (event.type === 'failed') {
          perfMetrics.errorCount++;
          sourceRelayHealth.totalRequests++;
          sourceRelayHealth.failureCount++;
          perfMetrics.errors.push({ time: Date.now(), reason: event.reason });
          if (perfMetrics.errors.length > 10) {
            perfMetrics.errors = perfMetrics.errors.slice(-10);
          }
          updatePerfMetrics();
          renderDiagnostics();
          renderQueueMetrics();
        }
      },
    });

    // Periodically update diagnostics panel
    setInterval(renderDiagnostics, 10000);

    // Periodically fetch and display queue metrics from bridge server
    setInterval(fetchAndDisplayQueueMetrics, 5000);
    // Also call it once on startup
    fetchAndDisplayQueueMetrics();

    // Periodically update health display
    const updateHealth = () => {
      const health = handle.getHealth();
      sourceRelayHealth = {
        consecutiveFailures: health.consecutiveFailures,
        isInBackoff: health.isInBackoff,
        lastError: health.lastError,
        backoffAttempts: health.backoffAttempts,
        backoffRemainingMs: health.backoffRemainingMs ?? 0,
        currentIntervalMs: health.currentIntervalMs ?? 0,
        maxIntervalMs: health.maxIntervalMs ?? 300000,
        lastHeartbeatAt: health.lastHeartbeatAt,
        isConnected: health.isRunning && health.consecutiveFailures < MAX_CONSECUTIVE_HEARTBEAT_FAILURES,
        totalRequests: health.totalRequests ?? 0,
        successCount: health.successCount ?? 0,
        failureCount: health.failureCount ?? 0,
      };
      renderSourceRelayStatus();
      renderQueueMetrics();
    };
    setInterval(updateHealth, 5000);
  };

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
            renderStatus({ kind: 'idle', label: 'Filling', detail: 'Claiming local handover content' });
          } else if (event.type === 'delivered') {
            renderStatus({ kind: 'success', label: 'Filled', detail: 'Waiting for auto-submit to ChatGPT' });
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
            renderStatus({ kind: 'idle', label: 'Submitted', detail: 'Waiting for ChatGPT response' });
          } else if (event.type === 'returned') {
            renderStatus({ kind: 'success', label: 'Returned', detail: 'Reply queued for local return' });
            renderLoopStatus('codex-delivered');
            renderRelayStatus();
          } else {
            renderStatus({ kind: 'failed', label: 'Auto-fill failed', detail: 'Check connection and retry' });
          }
        },
      });
    }
  };

  // Load any stored token and report connection state before the relay polls.
  loadPairingTokenFromStorage()
    .then(() => {
      startSourceRelay();
      return refreshConnection();
    })
    .catch(() => renderConnection('unpaired'));

  testTokenButton.addEventListener('click', async () => {
    await loadPairingTokenFromStorage();
    startSourceRelay();
    await refreshConnection();
  });

  clearTokenButton.addEventListener('click', async () => {
    await clearPairingTokenFromStorage();
    stopActiveOutboundPoller();
    stopActiveSourceRelayPoller();
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
        label: 'No content to return',
        detail: 'Preview return content first',
      });
      return;
    }
    if (!hasPairingToken()) {
      renderConnection('unpaired');
      return;
    }

    returnInFlight = true;
    updateActionState();
    renderStatus({ kind: 'idle', label: 'Returning', detail: 'Please wait, do not click again' });
    try {
      const routed = await submitExtractReturn(
        pendingExtractText,
        sessionId,
        createExtractReturn,
      );
      if (!routed.ok) {
        renderStatus(routed.error === 'network-error'
          ? createNetworkErrorPanelStatus()
          : { kind: 'failed', label: 'Return failed', detail: 'Check pairing status and retry' });
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

  const openConsoleButton = root.createElement('button');
  openConsoleButton.type = 'button';
  openConsoleButton.textContent = 'Open Project Console';
  Object.assign(openConsoleButton.style, {
    minHeight: '44px',
    color: 'var(--cb-text)',
    background: 'var(--cb-surface)',
    border: '1px solid var(--cb-border)',
    borderRadius: '6px',
    cursor: 'pointer',
    font: 'inherit',
  });

  openConsoleButton.addEventListener('click', () => {
    window.open('http://127.0.0.1:31337/console/project', '_blank', 'noopener,noreferrer');
  });
  returnActions.append(extractButton, returnButton, copyButton);
  automationActions.append(pauseAutomationButton, resumeAutomationButton, cancelAutomationButton);

  const legacyTools = root.createElement('details');
  const legacySummary = root.createElement('summary');
  legacySummary.textContent = 'Relay Tool';
  legacyTools.setAttribute('data-cli-bridge-legacy-tools', 'true');
  legacyTools.append(legacySummary);

  const legacyBody = root.createElement('div');
  Object.assign(legacyBody.style, { display: 'grid', gap: '8px', marginTop: '8px' });
  legacyBody.setAttribute('data-cli-bridge-legacy-body', 'true');
  legacyBody.append(
    input,
    fillButton,
    returnActions,
    loopStatus,
    relayStatus,
    automationStatus,
    sourceRelayStatus,
    queueMetricsStatus,
    endpointsStatus,
    goalLoopStatus,
    goalListStatus,
    perfStatus,
    diagnosticsPanel,
    automationActions,
    status,
    preview,
  );
  legacyTools.append(legacyBody);

  const panelBody = root.createElement('div');
  Object.assign(panelBody.style, { display: 'grid', gap: '8px' });
  panelBody.append(
    scope,
    connectionStatus,
    connectionActions,
    openConsoleButton,
    legacyTools,
  );
  collapseButton.addEventListener('click', () => {
    const collapsed = panelBody.hidden === false;
    panelBody.hidden = collapsed;
    panelBody.style.display = collapsed ? 'none' : 'grid';
    collapseButton.setAttribute('aria-label', collapsed ? 'Expand panel' : 'Collapse panel');
    collapseButton.title = collapsed ? 'Expand' : 'Collapse';
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
