import type { ClipboardFallbackResult } from '../content/clipboard.ts';
import type { ExtractPromptResult } from '../content/extraction.ts';
import type { FillComposerResult } from '../content/chatgpt-dom.ts';

export type BridgePanelStatusKind =
  | 'idle'
  | 'success'
  | 'fallback'
  | 'blocked'
  | 'failed'
  | 'warning';

export type BridgePanelLoopStage =
  | 'codex-output-ready'
  | 'chatgpt-awaiting-user-send'
  | 'pending-prompt-ready'
  | 'pending-prompt-confirmed'
  | 'codex-delivered'
  | 'cancelled'
  | 'failed';

export interface BridgePanelStatus {
  kind: BridgePanelStatusKind;
  label: string;
  detail: string;
}

export interface AutomationMirrorState {
  binding?: {
    planId: string;
    reasoningEndpointId: string;
    executionEndpointId: string;
    reasoningTier: string;
    executionTier: string;
    executionPermissionProfile: string;
    executionWorkingDirectoryRef: string;
    maxSteps: number;
    maxReasoningRounds: number;
    deadlineAt: string;
  } | null;
  proposal?: {
    id: string;
    status: string;
    stepId: string;
    contentHash: string;
  } | null;
  round?: number;
}

export const IDLE_PANEL_STATUS: BridgePanelStatus = {
  kind: 'idle',
  label: 'Pending',
  detail: 'Ready to fill next step content',
};

export function createFillPanelStatus(result: FillComposerResult): BridgePanelStatus {
  if (result.ok) {
      return {
        kind: 'success',
        label: 'Filled',
        detail: 'Content written to ChatGPT, waiting for auto-submit',
    };
  }

  switch (result.reason) {
    case 'input-not-found':
      return {
        kind: 'failed',
        label: 'Input not found',
        detail: 'Open a ChatGPT conversation first; clipboard fallback disabled',
      };
    case 'input-fill-failed':
    case 'input-verify-failed':
      return {
        kind: 'failed',
        label: 'Write failed',
        detail: 'Failed to write to input field; clipboard fallback disabled',
      };
    case 'clipboard-unavailable':
      return {
        kind: 'failed',
        label: 'Clipboard unavailable',
        detail: 'Use the copy button explicitly or select content manually',
      };
    case 'clipboard-write-failed':
      return {
        kind: 'failed',
        label: 'Copy failed',
        detail: 'Clipboard write failed, please select content manually',
      };
    default:
      return {
        kind: 'failed',
        label: 'Write failed',
        detail: 'Please check ChatGPT input and retry',
      };
  }
}

export function createLocatingPanelStatus(): BridgePanelStatus {
  return {
    kind: 'idle',
    label: 'Locating',
    detail: 'Finding ChatGPT input field...',
  };
}

export function createStreamingBlockedPanelStatus(): BridgePanelStatus {
  return {
    kind: 'blocked',
    label: 'ChatGPT generating',
    detail: 'Fill paused, please wait for response to complete',
  };
}

export function createNetworkErrorPanelStatus(): BridgePanelStatus {
  return {
    kind: 'failed',
    label: 'Connection failed',
    detail: 'Cannot connect to local server, please check and retry',
  };
}

export function createExtractRoutePanelStatus(
  routedTo: string | undefined,
  fallbackReason?: string,
): BridgePanelStatus {
  if (routedTo === 'inbound') {
      return {
        kind: 'success',
        label: 'Routed to executor',
        detail: 'Review result returned to task',
      };
  }
  if (routedTo === 'pending-prompt') {
    return {
        kind: 'success',
        label: 'Queued for confirmation',
        detail: fallbackReason === 'endpoint-cannot-receive-inbound'
          ? 'Current task cannot receive directly, awaiting manual confirmation'
          : 'No return context available, awaiting manual confirmation',
    };
  }
  return {
    kind: 'fallback',
    label: 'Extracted',
    detail: 'Result recorded',
  };
}

export type BridgePanelConnectionState =
  | 'unpaired'
  | 'checking'
  | 'connected'
  | 'unauthorized'
  | 'network-error';

export function createConnectionPanelStatus(state: BridgePanelConnectionState): BridgePanelStatus {
  switch (state) {
    case 'unpaired':
      return {
        kind: 'idle',
        label: 'Not paired',
        detail: 'Open Project Console to pair, or use extension popup manual pairing',
      };
    case 'checking':
      return {
        kind: 'idle',
        label: 'Checking',
        detail: 'Verifying connection to local server...',
      };
    case 'connected':
      return {
        kind: 'success',
        label: 'Connected',
        detail: 'Paired and verified with local server',
      };
    case 'unauthorized':
      return {
        kind: 'failed',
        label: 'Invalid token',
        detail: 'Pairing token not accepted by local server, please re-enter',
      };
    case 'network-error':
      return {
        kind: 'failed',
        label: 'Connection failed',
        detail: 'Cannot connect to local server, ensure local server is running',
      };
  }
}

export function getPanelStatusColor(kind: BridgePanelStatusKind, isDark = false): string {
  // WCAG AA compliant colors on white/dark background (4.5:1 minimum)
  if (isDark) {
    // Dark mode colors (on #171717 background)
    switch (kind) {
      case 'success':
        return '#4ade80'; // #4ade80 on #171717 = 7.2:1
      case 'failed':
        return '#f87171'; // #f87171 on #171717 = 5.2:1
      case 'blocked':
      case 'fallback':
        return '#fb923c'; // #fb923c on #171717 = 4.6:1
      case 'warning':
        return '#fbbf24'; // #fbbf24 on #171717 = 11.3:1
      case 'idle':
      default:
        return '#9ca3af'; // #9ca3af on #171717 = 5.3:1
    }
  }
  // Light mode colors (on #ffffff background)
  switch (kind) {
    case 'success':
      return '#166534'; // #166534 on #ffffff = 5.1:1
    case 'failed':
      return '#991b1b'; // #991b1b on #ffffff = 5.1:1
    case 'blocked':
    case 'fallback':
      return '#9a3412'; // #9a3412 on #ffffff = 4.5:1
    case 'warning':
      return '#c2410c'; // #c2410c on #ffffff = 4.5:1
    case 'idle':
    default:
      return '#374151'; // #374151 on #ffffff = 7.5:1
  }
}

export function createExtractPanelStatus(result: ExtractPromptResult): BridgePanelStatus {
  if (result.ok) {
    return {
      kind: 'success',
      label: 'Pending confirmation',
      detail: result.source === 'selection'
        ? 'Extracted from selection, confirm to route back'
        : 'Extracted from marked block, confirm to route back',
    };
  }

  if (result.status === 'blocked') {
    return {
      kind: 'blocked',
      label: 'Cannot extract',
      detail: 'ChatGPT still generating, please wait for completion',
    };
  }

  return {
    kind: 'failed',
    label: 'No content to route',
    detail: 'Select text or use marked block, then retry',
  };
}

export function createCopyPanelStatus(result: ClipboardFallbackResult): BridgePanelStatus {
  if (result.ok) {
    return {
      kind: 'success',
      label: 'Copied',
      detail: 'Content copied to clipboard',
    };
  }

  return {
    kind: 'failed',
    label: 'Copy failed',
    detail: 'Clipboard unavailable, please select content manually',
  };
}

export function createLoopPanelStatus(stage: BridgePanelLoopStage): BridgePanelStatus {
  switch (stage) {
    case 'codex-output-ready':
      return {
        kind: 'idle',
        label: 'Pending',
        detail: 'Ready to fill next step content',
      };
    case 'chatgpt-awaiting-user-send':
      return {
        kind: 'idle',
        label: 'Auto processing',
        detail: 'Submitted to ChatGPT, awaiting auto-return',
      };
    case 'pending-prompt-ready':
      return {
        kind: 'success',
        label: 'Pending confirmation',
        detail: 'Result extracted, please confirm to route back',
      };
    case 'pending-prompt-confirmed':
      return {
        kind: 'success',
        label: 'Confirmed',
        detail: 'Result confirmed by user',
      };
    case 'codex-delivered':
      return {
        kind: 'success',
        label: 'Returned',
        detail: 'Result returned to local task',
      };
    case 'cancelled':
      return {
        kind: 'blocked',
        label: 'Cancelled',
        detail: 'This handover was cancelled',
      };
    case 'failed':
      return {
        kind: 'failed',
        label: 'Handover failed',
        detail: 'Please check connection and retry',
      };
  }
}

export function createAutomationMirrorStatus(state: AutomationMirrorState): BridgePanelStatus {
  if (!state.binding) {
    return {
      kind: 'idle',
      label: 'Automation unbound',
      detail: 'Waiting for server to create dual-endpoint binding',
    };
  }
  const proposalStatus = state.proposal?.status ?? 'none';
  const kind: BridgePanelStatusKind = proposalStatus === 'awaiting-confirmation'
    ? 'blocked'
    : proposalStatus === 'paused'
      ? 'blocked'
      : proposalStatus === 'failed'
        ? 'failed'
        : 'idle';
  return {
    kind,
    label: `自动化 ${proposalStatus}`,
    detail: [
      `${state.binding.reasoningEndpointId} -> ${state.binding.executionEndpointId}`,
      `step ${state.proposal?.stepId ?? 'none'}`,
      `round ${state.round ?? 0}`,
      `tier ${state.binding.reasoningTier}/${state.binding.executionTier}`,
      `profile ${state.binding.executionPermissionProfile}`,
      `hash ${state.proposal?.contentHash ?? 'none'}`,
    ].join(' · '),
  };
}

export interface SourceRelayHealthState {
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
}

export function createSourceRelayStatus(state: SourceRelayHealthState): BridgePanelStatus {
  // Not connected - show warning
  if (!state.isConnected) {
    return {
      kind: 'failed',
      label: 'Source Relay Disconnected',
      detail: 'Waiting for ChatGPT Web pairing',
    };
  }

  // In backoff - show warning with countdown
  if (state.isInBackoff) {
    const secondsLeft = Math.ceil(state.backoffRemainingMs / 1000);
    const intervalDesc = state.currentIntervalMs >= state.maxIntervalMs
      ? 'Max interval reached'
      : `Retry in ${formatInterval(state.currentIntervalMs)}`;
    return {
      kind: 'warning',
      label: 'Reconnecting (backoff)',
      detail: `${state.backoffAttempts} attempts · ${secondsLeft}s · ${intervalDesc}`,
    };
  }

  // Has recent failures but not in backoff
  if (state.consecutiveFailures > 0) {
    return {
      kind: 'warning',
      label: 'Source Relay Unstable',
      detail: `${state.consecutiveFailures} failures · ${state.lastError || 'Waiting for recovery...'}`,
    };
  }

  // Calculate success rate
  const successRate = state.totalRequests > 0
    ? Math.round((state.successCount / state.totalRequests) * 100)
    : 100;

  // Healthy
  return {
    kind: 'success',
    label: 'Source Relay OK',
    detail: state.lastHeartbeatAt
      ? `Heartbeat ${formatTimeSince(state.lastHeartbeatAt)} · Success rate ${successRate}%`
      : `Connected · Success rate ${successRate}%`,
  };
}

function formatInterval(ms: number): string {
  if (ms >= 60_000) return `${Math.floor(ms / 60_000)}m`;
  if (ms >= 1000) return `${Math.floor(ms / 1000)}s`;
  return `${ms}ms`;
}

function formatTimeSince(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}
