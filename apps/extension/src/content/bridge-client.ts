import {
  LOCAL_SERVER_BASE_URL,
  PAIRING_TOKEN_HEADER,
} from '../../../../packages/shared/src/constants.ts';

export interface BridgeClientConfig {
  baseUrl: string;
  pairingToken: string | null;
}

export interface BridgeClientResult<T = unknown> {
  ok: boolean;
  status: number;
  data?: T;
  error?: string;
}

let cachedConfig: BridgeClientConfig = {
  baseUrl: LOCAL_SERVER_BASE_URL,
  pairingToken: null,
};

export function setBridgeClientConfig(config: Partial<BridgeClientConfig>): void {
  cachedConfig = { ...cachedConfig, ...config };
}

export function getBridgeClientConfig(): BridgeClientConfig {
  return { ...cachedConfig };
}

export function hasPairingToken(): boolean {
  return typeof cachedConfig.pairingToken === 'string' && cachedConfig.pairingToken.length > 0;
}

async function bridgeFetch<T>(
  path: string,
  method: 'GET' | 'POST',
  body?: Record<string, unknown>,
): Promise<BridgeClientResult<T>> {
  if (!cachedConfig.pairingToken) {
    return { ok: false, status: 0, error: 'no-pairing-token' };
  }

  const headers: Record<string, string> = {
    [PAIRING_TOKEN_HEADER]: cachedConfig.pairingToken,
    'content-type': 'application/json',
  };

  try {
    const response = await fetch(`${cachedConfig.baseUrl}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    const data = await response.json().catch(() => null);

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error: data?.message ?? `HTTP ${response.status}`,
      };
    }

    return { ok: true, status: response.status, data: data as T };
  } catch {
    return { ok: false, status: 0, error: 'network-error' };
  }
}

export function createPacket(sessionId: string, content: string) {
  return bridgeFetch('/bridge/packets', 'POST', { sessionId, content });
}

export function createPendingPrompt(sessionId: string, prompt: string) {
  return bridgeFetch('/bridge/pending-prompts', 'POST', { sessionId, prompt });
}

export function confirmPendingPrompt(promptId: string) {
  return bridgeFetch('/bridge/pending-prompts/confirm', 'POST', { promptId });
}

export function sendPendingPrompt(promptId: string) {
  return bridgeFetch('/bridge/pending-prompts/send', 'POST', { promptId });
}

export function cancelPendingPrompt(promptId: string) {
  return bridgeFetch('/bridge/pending-prompts/cancel', 'POST', { promptId });
}

export interface OutboundPromptPayload {
  id: string;
  sessionId: string;
  packetId: string;
  prompt: string;
  status: string;
  target: 'chatgpt-web';
}

export function createOutboundPrompt(sessionId: string, prompt: string) {
  return bridgeFetch('/bridge/outbound', 'POST', { sessionId, prompt });
}

export function claimNextOutboundPrompt() {
  return bridgeFetch<{ outboundPrompt: OutboundPromptPayload | null }>(
    '/bridge/outbound/next',
    'GET',
  );
}

export function acknowledgeOutboundPrompt(
  outboundPromptId: string,
  ok: boolean,
  failureReason?: string | null,
) {
  return bridgeFetch('/bridge/outbound/ack', 'POST', {
    outboundPromptId,
    ok,
    ...(failureReason ? { failureReason } : {}),
  });
}

export function getMetrics() {
  return bridgeFetch<{ metrics: Record<string, number> }>('/bridge/metrics', 'GET');
}

export function listPendingPrompts() {
  return bridgeFetch('/bridge/pending-prompts', 'GET');
}

export function listPackets() {
  return bridgeFetch('/bridge/packets', 'GET');
}

export async function loadPairingTokenFromStorage(): Promise<string | null> {
  try {
    if (typeof chrome !== 'undefined' && chrome?.storage?.local) {
      const result = await chrome.storage.local.get('cliBridgePairingToken');
      const token = result?.cliBridgePairingToken;
      if (typeof token === 'string' && token.length > 0) {
        cachedConfig.pairingToken = token;
        return token;
      }
    }
  } catch {
    // storage unavailable — test or non-extension environment
  }
  return null;
}
