import type { ClipboardFallbackResult } from '../content/clipboard.ts';
import type { ExtractPromptResult } from '../content/extraction.ts';
import type { FillComposerResult } from '../content/chatgpt-dom.ts';

export type BridgePanelStatusKind =
  | 'idle'
  | 'success'
  | 'fallback'
  | 'blocked'
  | 'failed';

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

export const IDLE_PANEL_STATUS: BridgePanelStatus = {
  kind: 'idle',
  label: 'idle',
  detail: '',
};

export function createFillPanelStatus(result: FillComposerResult): BridgePanelStatus {
  if (result.ok) {
    return {
      kind: 'success',
      label: '已填入',
      detail: '内容已写入 ChatGPT 输入框，请手动点击发送',
    };
  }

  const clipboardOk = result.clipboard?.ok === true;

  switch (result.reason) {
    case 'input-not-found':
      return {
        kind: clipboardOk ? 'fallback' : 'failed',
        label: '未找到输入框',
        detail: clipboardOk
          ? '请打开一个 ChatGPT 对话页后重试；内容已复制到剪贴板，可手动粘贴'
          : '请打开一个 ChatGPT 对话页后重试',
      };
    case 'input-fill-failed':
    case 'input-verify-failed':
      return {
        kind: clipboardOk ? 'fallback' : 'failed',
        label: '写入未生效',
        detail: clipboardOk
          ? '已复制到剪贴板，请手动粘贴到输入框'
          : '写入输入框失败，请重试',
      };
    case 'clipboard-unavailable':
      return {
        kind: 'failed',
        label: '剪贴板不可用',
        detail: '无法自动写入，请手动复制目标内容',
      };
    case 'clipboard-write-failed':
      return {
        kind: 'failed',
        label: '复制失败',
        detail: '写入输入框与剪贴板均失败，请重试',
      };
    default:
      return {
        kind: 'fallback',
        label: '回退',
        detail: result.reason ?? 'clipboard-fallback',
      };
  }
}

export function createLocatingPanelStatus(): BridgePanelStatus {
  return {
    kind: 'idle',
    label: '定位中',
    detail: '正在寻找 ChatGPT 输入框…',
  };
}

export function createStreamingBlockedPanelStatus(): BridgePanelStatus {
  return {
    kind: 'blocked',
    label: 'ChatGPT 正在生成',
    detail: '已暂停填入，请等待回答完成后重试',
  };
}

export function createNetworkErrorPanelStatus(): BridgePanelStatus {
  return {
    kind: 'failed',
    label: '连接失败',
    detail: '无法连接本地服务，请检查 local server 后重试',
  };
}

export function createExtractRoutePanelStatus(
  routedTo: string | undefined,
  fallbackReason?: string,
): BridgePanelStatus {
  if (routedTo === 'inbound') {
    return {
      kind: 'success',
      label: '已回传执行端',
      detail: '评审结果已作为 inbound 投递给对应执行端',
    };
  }
  if (routedTo === 'pending-prompt') {
    return {
      kind: 'success',
      label: '已存入待确认队列',
      detail: fallbackReason === 'endpoint-cannot-receive-inbound'
        ? '该执行端暂不支持回程，已存为待确认提示'
        : '暂无回程上下文，已存为待确认提示',
    };
  }
  return {
    kind: 'fallback',
    label: '已提取',
    detail: '结果已记录',
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
        label: '未配对',
        detail: '请粘贴 local server 打印的 pairing token 并点击保存',
      };
    case 'checking':
      return {
        kind: 'idle',
        label: '检测中',
        detail: '正在验证与本地服务的连接…',
      };
    case 'connected':
      return {
        kind: 'success',
        label: '已连接',
        detail: '已配对并通过本地服务验证',
      };
    case 'unauthorized':
      return {
        kind: 'failed',
        label: 'token 无效',
        detail: 'pairing token 不被本地服务接受，请重新输入',
      };
    case 'network-error':
      return {
        kind: 'failed',
        label: '连接失败',
        detail: '无法连接本地服务，请确认 local server 已启动后重试',
      };
  }
}

export function getPanelStatusColor(kind: BridgePanelStatusKind): string {
  switch (kind) {
    case 'success':
      return '#15803d';
    case 'failed':
      return '#b91c1c';
    case 'blocked':
    case 'fallback':
      return '#b45309';
    case 'idle':
    default:
      return '#374151';
  }
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

export function createLoopPanelStatus(stage: BridgePanelLoopStage): BridgePanelStatus {
  switch (stage) {
    case 'codex-output-ready':
      return {
        kind: 'idle',
        label: 'loop',
        detail: 'ready-to-fill',
      };
    case 'chatgpt-awaiting-user-send':
      return {
        kind: 'blocked',
        label: 'loop',
        detail: 'awaiting-user-send',
      };
    case 'pending-prompt-ready':
      return {
        kind: 'success',
        label: 'loop',
        detail: 'pending-confirmation',
      };
    case 'pending-prompt-confirmed':
      return {
        kind: 'success',
        label: 'loop',
        detail: 'confirmed',
      };
    case 'codex-delivered':
      return {
        kind: 'success',
        label: 'loop',
        detail: 'delivered',
      };
    case 'cancelled':
      return {
        kind: 'blocked',
        label: 'loop',
        detail: 'cancelled',
      };
    case 'failed':
      return {
        kind: 'failed',
        label: 'loop',
        detail: 'failed',
      };
  }
}
