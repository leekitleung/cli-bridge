import {
  LOCAL_SERVER_BASE_URL,
  PAIRING_TOKEN_HEADER,
  PROTECTED_HEALTH_PATH,
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

export const BRIDGE_FETCH_TIMEOUT_MS = 10_000;

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

/**
 * Whether bridge calls should be relayed through the background service worker.
 * In MV3 the content script cannot fetch the loopback server directly (page
 * CORS blocks it), but the service worker can. In Node/unit environments there
 * is no chrome.runtime, so callers fall back to a direct fetch.
 */
function canUseBackgroundProxy(): boolean {
  return typeof chrome !== 'undefined' && typeof chrome.runtime?.sendMessage === 'function';
}

function sendProxyFetch<T>(
  path: string,
  method: 'GET' | 'POST',
  body: Record<string, unknown> | undefined,
  token: string,
): Promise<BridgeClientResult<T>> {
  return new Promise((resolve) => {
    const timeout = globalThis.setTimeout?.(() => {
      resolve({ ok: false, status: 0, error: 'network-error' });
    }, BRIDGE_FETCH_TIMEOUT_MS);
    try {
      chrome.runtime.sendMessage(
        { type: 'cli-bridge-proxy-fetch', path, method, body, token },
        (response: unknown) => {
          if (timeout) {
            globalThis.clearTimeout?.(timeout);
          }
          if (chrome.runtime?.lastError || !response) {
            resolve({ ok: false, status: 0, error: 'network-error' });
            return;
          }
          resolve(response as BridgeClientResult<T>);
        },
      );
    } catch {
      if (timeout) {
        globalThis.clearTimeout?.(timeout);
      }
      resolve({ ok: false, status: 0, error: 'network-error' });
    }
  });
}

async function bridgeFetch<T>(
  path: string,
  method: 'GET' | 'POST',
  body?: Record<string, unknown>,
): Promise<BridgeClientResult<T>> {
  const token = cachedConfig.pairingToken;
  if (!token) {
    return { ok: false, status: 0, error: 'no-pairing-token' };
  }

  // MV3: relay through the background service worker when available so the
  // loopback request is not blocked by content-script CORS.
  if (canUseBackgroundProxy()) {
    return sendProxyFetch<T>(path, method, body, token);
  }

  const headers: Record<string, string> = {
    [PAIRING_TOKEN_HEADER]: token,
    'content-type': 'application/json',
  };

  try {
    const controller = typeof AbortController === 'function'
      ? new AbortController()
      : null;
    const timeout = controller
      ? globalThis.setTimeout?.(() => controller.abort(), BRIDGE_FETCH_TIMEOUT_MS)
      : null;
    const response = await fetch(`${cachedConfig.baseUrl}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller?.signal,
    });

    const data = await response.json().catch(() => null);
    if (timeout) {
      globalThis.clearTimeout?.(timeout);
    }

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

/**
 * Phase 3 extract→inbound routing: submit an extracted ChatGPT reply for
 * server-side routing. The server resolves the target endpoint from the
 * session's relay context (the body never carries an endpointId) and either
 * creates an inbound message or falls back to a pending prompt. Goes through
 * the background proxy like every other bridge call.
 */
export function createExtractReturn(sessionId: string, content: string) {
  return bridgeFetch<{
    routedTo: 'inbound' | 'pending-prompt';
    fallbackReason?: string;
  }>('/bridge/extract-return', 'POST', { sessionId, content });
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
  claimToken: string;
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
  claimToken: string,
  ok: boolean,
  failureReason?: string | null,
) {
  return bridgeFetch('/bridge/outbound/ack', 'POST', {
    outboundPromptId,
    claimToken,
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
      cachedConfig.pairingToken = null;
    }
  } catch {
    // storage unavailable — test or non-extension environment
  }
  return null;
}

/**
 * Persist the pairing token so the user does not need the service-worker
 * console to pair. Updates the in-memory config first so the current session
 * works even if extension storage is unavailable.
 */
export async function savePairingTokenToStorage(token: string): Promise<boolean> {
  const trimmed = typeof token === 'string' ? token.trim() : '';
  if (trimmed.length === 0) {
    return false;
  }

  cachedConfig.pairingToken = trimmed;

  try {
    if (typeof chrome !== 'undefined' && chrome?.storage?.local) {
      await chrome.storage.local.set({ cliBridgePairingToken: trimmed });
    }
    return true;
  } catch {
    return false;
  }
}

/** Remove the stored pairing token and clear the in-memory config. */
export async function clearPairingTokenFromStorage(): Promise<void> {
  cachedConfig.pairingToken = null;

  try {
    if (typeof chrome !== 'undefined' && chrome?.storage?.local) {
      await chrome.storage.local.remove('cliBridgePairingToken');
    }
  } catch {
    // storage unavailable — nothing else to clear
  }
}

export type ConnectionProbeResult =
  | 'unpaired'
  | 'connected'
  | 'unauthorized'
  | 'network-error';

/**
 * Token-gated reachability check against the protected health endpoint. Used by
 * the panel to verify a pairing token without granting any new capability.
 */
export async function testPrivateHealth(): Promise<ConnectionProbeResult> {
  const token = cachedConfig.pairingToken;
  if (!token) {
    return 'unpaired';
  }

  // Relay through the background service worker when available (MV3 CORS).
  if (canUseBackgroundProxy()) {
    const result = await sendProxyFetch(PROTECTED_HEALTH_PATH, 'GET', undefined, token);
    if (result.ok) {
      return 'connected';
    }
    if (result.status === 401 || result.status === 403) {
      return 'unauthorized';
    }
    return 'network-error';
  }

  try {
    const controller = typeof AbortController === 'function'
      ? new AbortController()
      : null;
    const timeout = controller
      ? globalThis.setTimeout?.(() => controller.abort(), BRIDGE_FETCH_TIMEOUT_MS)
      : null;
    const response = await fetch(`${cachedConfig.baseUrl}${PROTECTED_HEALTH_PATH}`, {
      method: 'GET',
      headers: { [PAIRING_TOKEN_HEADER]: token },
      signal: controller?.signal,
    });
    if (timeout) {
      globalThis.clearTimeout?.(timeout);
    }

    if (response.ok) {
      return 'connected';
    }
    if (response.status === 401 || response.status === 403) {
      return 'unauthorized';
    }
    return 'network-error';
  } catch {
    return 'network-error';
  }
}
