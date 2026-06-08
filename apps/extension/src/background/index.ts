import {
  ALLOWED_EXTENSION_ORIGIN,
  LOCAL_SERVER_BASE_URL,
  PAIRING_TOKEN_HEADER,
  PUBLIC_HEALTH_PATH,
  PROTECTED_HEALTH_PATH,
} from '../../../../packages/shared/src/constants.ts';

export type HealthCheckStatus = 'ok' | 'error';

export type HealthCheckReason =
  | 'network-error'
  | 'unexpected-response'
  | 'origin-failed'
  | 'pairing-failed'
  | 'missing-token'
  | null;

export interface HealthCheckResult {
  ok: boolean;
  status: HealthCheckStatus;
  reason: HealthCheckReason;
  serviceName?: string;
  serviceVersion?: string;
}

export interface HealthCheckOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export interface ProtectedHealthCheckOptions extends HealthCheckOptions {
  origin?: string;
}

async function readJsonBody(response: Response): Promise<Record<string, unknown> | null> {
  try {
    const body = (await response.json()) as Record<string, unknown>;
    return body;
  } catch {
    return null;
  }
}

function createNetworkErrorResult(): HealthCheckResult {
  return {
    ok: false,
    status: 'error',
    reason: 'network-error',
  };
}

function createUnexpectedResponseResult(): HealthCheckResult {
  return {
    ok: false,
    status: 'error',
    reason: 'unexpected-response',
  };
}

function createFailureResult(reason: Exclude<HealthCheckReason, null>): HealthCheckResult {
  return {
    ok: false,
    status: 'error',
    reason,
  };
}

function createSuccessResult(body: Record<string, unknown>): HealthCheckResult {
  return {
    ok: true,
    status: 'ok',
    reason: null,
    serviceName: typeof body.serviceName === 'string' ? body.serviceName : undefined,
    serviceVersion: typeof body.serviceVersion === 'string' ? body.serviceVersion : undefined,
  };
}

async function fetchHealthResponse(
  path: string,
  options: HealthCheckOptions & { headers?: HeadersInit } = {},
): Promise<{ response: Response; body: Record<string, unknown> | null } | null> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = options.baseUrl ?? LOCAL_SERVER_BASE_URL;

  try {
    const response = await fetchImpl(new URL(path, baseUrl), {
      headers: options.headers,
    });
    const body = await readJsonBody(response);
    return { response, body };
  } catch {
    return null;
  }
}

function getFailureReasonFromResponse(
  status: number,
  body: Record<string, unknown> | null,
): Exclude<HealthCheckReason, null> {
  const message = typeof body?.message === 'string' ? body.message.toLowerCase() : '';

  if (message.includes('origin')) {
    return 'origin-failed';
  }

  if (status === 401 || status === 403) {
    return 'pairing-failed';
  }

  return 'unexpected-response';
}

export async function checkPublicHealth(
  options: HealthCheckOptions = {},
): Promise<HealthCheckResult> {
  const result = await fetchHealthResponse(PUBLIC_HEALTH_PATH, options);
  if (!result) {
    return createNetworkErrorResult();
  }

  const { response, body } = result;
  if (!response.ok || !body) {
    return createUnexpectedResponseResult();
  }

  return createSuccessResult(body);
}

export async function checkProtectedHealth(
  pairingToken: string | null | undefined,
  options: ProtectedHealthCheckOptions = {},
): Promise<HealthCheckResult> {
  if (!pairingToken) {
    return createFailureResult('missing-token');
  }

  const headers: HeadersInit = {
    [PAIRING_TOKEN_HEADER]: pairingToken,
  };

  if (options.origin) {
    headers.origin = options.origin;
  }

  const result = await fetchHealthResponse(PROTECTED_HEALTH_PATH, {
    baseUrl: options.baseUrl,
    fetchImpl: options.fetchImpl,
    headers,
  });

  if (!result) {
    return createNetworkErrorResult();
  }

  const { response, body } = result;
  if (response.ok && body) {
    return createSuccessResult(body);
  }

  return createFailureResult(getFailureReasonFromResponse(response.status, body));
}

export function buildExtensionOriginHeaders(pairingToken: string): HeadersInit {
  return {
    [PAIRING_TOKEN_HEADER]: pairingToken,
    origin: ALLOWED_EXTENSION_ORIGIN,
  };
}


// --- Pairing token management ---
// The background script provides a message-based API for the content script
// and popup to set/get the pairing token stored in chrome.storage.local.

interface PairingMessage {
  type: 'cli-bridge-set-token' | 'cli-bridge-get-token';
  token?: string;
}

if (typeof chrome !== 'undefined' && chrome?.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener(
    (msg: unknown, _sender, sendResponse) => {
      const message = msg as PairingMessage;
      if (message.type === 'cli-bridge-set-token' && typeof message.token === 'string') {
        chrome.storage.local.set({ cliBridgePairingToken: message.token }).then(() => {
          sendResponse({ ok: true });
        }).catch(() => {
          sendResponse({ ok: false });
        });
        return true; // async response
      }

      if (message.type === 'cli-bridge-get-token') {
        chrome.storage.local.get('cliBridgePairingToken').then((result) => {
          sendResponse({ ok: true, token: result?.cliBridgePairingToken ?? null });
        }).catch(() => {
          sendResponse({ ok: false, token: null });
        });
        return true; // async response
      }

      return false;
    },
  );
}
