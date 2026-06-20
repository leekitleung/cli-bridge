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


// --- Local server fetch proxy (MV3) ---
// Content scripts on chatgpt.com cannot reach the loopback local server
// directly: MV3 subjects content-script requests to page CORS, and the local
// server intentionally sends no CORS headers. The service worker holds
// host_permissions for the local server and is exempt, so it relays the
// request on the content script's behalf. This is a thin, validated relay; it
// does not widen the local server's surface.

export interface ProxyFetchRequest {
  path: string;
  method: string;
  body?: unknown;
  token?: string | null;
}

export interface ProxyFetchResult {
  ok: boolean;
  status: number;
  data?: unknown;
  error?: string;
}

type SessionStorageAccessLevel = 'TRUSTED_AND_UNTRUSTED_CONTEXTS';

interface ChromeSessionStorageAccess {
  setAccessLevel?: (options: { accessLevel: SessionStorageAccessLevel }) => Promise<void> | void;
}

interface ChromeStorageAccessApi {
  storage?: {
    session?: ChromeSessionStorageAccess;
  };
}

export async function allowContentScriptSessionStorage(
  chromeApi: ChromeStorageAccessApi | undefined,
): Promise<boolean> {
  const session = chromeApi?.storage?.session;
  const setAccessLevel = session?.setAccessLevel;
  if (typeof setAccessLevel !== 'function') {
    return false;
  }

  try {
    await setAccessLevel.call(session, {
      accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS',
    });
    return true;
  } catch {
    return false;
  }
}

export const PROXY_FETCH_TIMEOUT_MS = 10_000;

if (typeof chrome !== 'undefined') {
  void allowContentScriptSessionStorage(chrome as unknown as ChromeStorageAccessApi);
}

function isAllowedProxyPath(path: unknown): path is string {
  if (typeof path !== 'string' || path.length === 0) {
    return false;
  }
  if (!path.startsWith('/') || path.startsWith('//')) {
    return false;
  }
  if (path.includes('://') || /[\r\n]/.test(path)) {
    return false;
  }
  return path === PROTECTED_HEALTH_PATH || path.startsWith('/bridge/');
}

function isAllowedProxyRoute(path: string, method: string): boolean {
  const allowed = new Set([
    `GET ${PROTECTED_HEALTH_PATH}`,
    'POST /bridge/packets',
    'GET /bridge/packets',
    'POST /bridge/pending-prompts',
    'GET /bridge/pending-prompts',
    'POST /bridge/pending-prompts/confirm',
    'POST /bridge/pending-prompts/send',
    'POST /bridge/pending-prompts/cancel',
    'GET /bridge/metrics',
    'POST /bridge/extract-return',
    'POST /bridge/outbound',
    'GET /bridge/outbound/next',
    'POST /bridge/outbound/ack',
    'POST /bridge/outbound/stage',
  ]);
  return allowed.has(`${method} ${path}`);
}

export async function handleProxyFetch(
  request: ProxyFetchRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<ProxyFetchResult> {
  const method = typeof request?.method === 'string' ? request.method.toUpperCase() : '';
  if (method !== 'GET' && method !== 'POST') {
    return { ok: false, status: 0, error: 'invalid-method' };
  }
  if (!isAllowedProxyPath(request?.path)) {
    return { ok: false, status: 0, error: 'invalid-path' };
  }
  if (!isAllowedProxyRoute(request.path, method)) {
    return { ok: false, status: 0, error: 'invalid-path' };
  }

  const hasBody = method === 'POST' && request.body !== undefined && request.body !== null;
  const headers: Record<string, string> = {};
  if (typeof request.token === 'string' && request.token.length > 0) {
    headers[PAIRING_TOKEN_HEADER] = request.token;
  }
  if (hasBody) {
    headers['content-type'] = 'application/json';
  }

  try {
    const controller = typeof AbortController === 'function'
      ? new AbortController()
      : null;
    const timeout = controller
      ? globalThis.setTimeout?.(() => controller.abort(), PROXY_FETCH_TIMEOUT_MS)
      : null;
    const response = await fetchImpl(`${LOCAL_SERVER_BASE_URL}${request.path}`, {
      method,
      headers,
      body: hasBody ? JSON.stringify(request.body) : undefined,
      signal: controller?.signal,
    });
    const data = await response.json().catch(() => null);
    if (timeout) {
      globalThis.clearTimeout?.(timeout);
    }
    if (!response.ok) {
      const message = data && typeof data === 'object'
        && typeof (data as { message?: unknown }).message === 'string'
        ? (data as { message: string }).message
        : `HTTP ${response.status}`;
      return { ok: false, status: response.status, error: message };
    }
    return { ok: true, status: response.status, data };
  } catch {
    return { ok: false, status: 0, error: 'network-error' };
  }
}


// --- Pairing token management ---
// The background script provides a message-based API for the content script
// and popup to set/get the memory-only pairing token for this browser session.

interface PairingMessage {
  type: 'cli-bridge-set-token' | 'cli-bridge-get-token';
  token?: string;
}

if (typeof chrome !== 'undefined' && chrome?.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener(
    (msg: unknown, _sender, sendResponse) => {
      const proxyMessage = msg as { type?: string } & ProxyFetchRequest;
      if (proxyMessage?.type === 'cli-bridge-proxy-fetch') {
        handleProxyFetch(proxyMessage)
          .then((result) => sendResponse(result))
          .catch(() => sendResponse({ ok: false, status: 0, error: 'network-error' }));
        return true; // async response
      }

      const message = msg as PairingMessage;
      if (message.type === 'cli-bridge-set-token' && typeof message.token === 'string') {
        chrome.storage.session.set({ cliBridgePairingToken: message.token }).then(() => {
          sendResponse({ ok: true });
        }).catch(() => {
          sendResponse({ ok: false });
        });
        return true; // async response
      }

      if (message.type === 'cli-bridge-get-token') {
        chrome.storage.session.get('cliBridgePairingToken').then((result) => {
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
