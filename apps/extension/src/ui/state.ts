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
  label: '待处理',
  detail: '可以填入下一条交接内容',
};

export function createFillPanelStatus(result: FillComposerResult): BridgePanelStatus {
  if (result.ok) {
      return {
        kind: 'success',
        label: '已填入',
        detail: '内容已写入 ChatGPT 输入框，请手动点击发送',
    };
  }

  switch (result.reason) {
    case 'input-not-found':
      return {
        kind: 'failed',
        label: '未找到输入框',
        detail: '请打开一个 ChatGPT 对话页后重试；不会自动写入剪贴板',
      };
    case 'input-fill-failed':
    case 'input-verify-failed':
      return {
        kind: 'failed',
        label: '写入未生效',
        detail: '写入输入框失败；不会自动写入剪贴板',
      };
    case 'clipboard-unavailable':
      return {
        kind: 'failed',
        label: '剪贴板不可用',
        detail: '请使用明确的复制按钮，或手动选择内容复制',
      };
    case 'clipboard-write-failed':
      return {
        kind: 'failed',
        label: '复制失败',
        detail: '剪贴板写入失败，请手动选择内容复制',
      };
    default:
      return {
        kind: 'failed',
        label: '写入失败',
        detail: '请检查 ChatGPT 输入框后重试',
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
        detail: '评审结果已交回对应任务',
      };
  }
  if (routedTo === 'pending-prompt') {
    return {
        kind: 'success',
        label: '已存入待确认队列',
        detail: fallbackReason === 'endpoint-cannot-receive-inbound'
          ? '当前任务暂不能直接接收，已等待人工确认'
          : '没有可用回程上下文，已等待人工确认',
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
        detail: '请点击浏览器扩展图标，在扩展弹窗中完成配对',
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
      label: '待确认',
      detail: result.source === 'selection'
        ? '已从选中文本提取，确认后回传'
        : '已从标记块提取，确认后回传',
    };
  }

  if (result.status === 'blocked') {
    return {
      kind: 'blocked',
      label: '暂不可提取',
      detail: 'ChatGPT 仍在生成，请等待完成后重试',
    };
  }

  return {
    kind: 'failed',
    label: '未找到可回传内容',
    detail: '请选择文本，或使用标记块后重试',
  };
}

export function createCopyPanelStatus(result: ClipboardFallbackResult): BridgePanelStatus {
  if (result.ok) {
    return {
      kind: 'success',
      label: '已复制',
      detail: '内容已复制到剪贴板',
    };
  }

  return {
    kind: 'failed',
    label: '复制失败',
    detail: '剪贴板不可用，请手动选择内容复制',
  };
}

export function createLoopPanelStatus(stage: BridgePanelLoopStage): BridgePanelStatus {
  switch (stage) {
    case 'codex-output-ready':
      return {
        kind: 'idle',
        label: '待处理',
        detail: '可以填入下一条交接内容',
      };
    case 'chatgpt-awaiting-user-send':
      return {
        kind: 'blocked',
        label: '等待发送',
        detail: '手动发送后，选择回复并点击预览回传',
      };
    case 'pending-prompt-ready':
      return {
        kind: 'success',
        label: '待确认',
        detail: '已提取结果，请确认后回传',
      };
    case 'pending-prompt-confirmed':
      return {
        kind: 'success',
        label: '已确认',
        detail: '结果已通过人工确认',
      };
    case 'codex-delivered':
      return {
        kind: 'success',
        label: '已交回',
        detail: '结果已交回本地任务',
      };
    case 'cancelled':
      return {
        kind: 'blocked',
        label: '已取消',
        detail: '本次交接已取消',
      };
    case 'failed':
      return {
        kind: 'failed',
        label: '交接失败',
        detail: '请检查连接后重试',
      };
  }
}
