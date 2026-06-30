import {
  createServer,
  type IncomingMessage,
  type RequestListener,
  type ServerResponse,
} from 'node:http';
import { pathToFileURL } from 'node:url';

import {
  DEFAULT_LOCAL_SERVER_PORT,
  LOCAL_SERVER_HOST,
  PUBLIC_HEALTH_PATH,
  PROTECTED_HEALTH_PATH,
} from '../../../packages/shared/src/constants.ts';
import { createHealthPayload } from './routes/health.ts';
import {
  CONSOLE_PATH,
} from './routes/console.ts';
import {
  CONSOLE_GOALS_PATH,
} from './routes/console-goals.ts';
import {
  CONSOLE_PROJECT_PATH,
  renderProjectConsoleHtml,
} from './routes/project-console.ts';
import {
  createBridgeRuntime,
  handleBridgeRequest,
  isBridgePath,
  writeBridgeResult,
  type BridgeRuntime,
  type BridgeRuntimeOptions,
} from './routes/bridge-api.ts';
import {
  assertAllowedOrigin,
  getRequestOrigin,
  isAllowedOrigin,
} from './security/origin-guard.ts';
import {
  createPairingToken,
  extractPairingTokenFromRequest,
  verifyPairingToken,
} from './security/pairing.ts';
import {
  createLocalAutoPairSessionStore,
  type LocalAutoPairSessionStore,
} from './security/local-auto-pair-session.ts';

export interface LocalServerHandle {
  server: ReturnType<typeof createServer>;
  host: string;
  port: number;
  url: string;
  pairingToken: string;
}

function isMainModule(): boolean {
  const entryPoint = process.argv[1];
  if (!entryPoint) {
    return false;
  }

  return import.meta.url === pathToFileURL(entryPoint).href;
}

function writeJson(
  statusCode: number,
  payload: unknown,
  response: ServerResponse<IncomingMessage>,
): void {
  response.statusCode = statusCode;
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.end(`${JSON.stringify(payload)}\n`);
}

function parseConsoleSessionCookie(
  request: IncomingMessage,
): string | null {
  const cookieHeader = request.headers.cookie;
  if (typeof cookieHeader !== 'string') return null;
  for (const pair of cookieHeader.split(';')) {
    const [name, ...rest] = pair.trim().split('=');
    if (name === 'cli_bridge_console_session') {
      return rest.join('=') || null;
    }
  }
  return null;
}

function isTestEnvironment(): boolean {
  return process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'node:test';
}

export async function startLocalServer(
  port: number = DEFAULT_LOCAL_SERVER_PORT,
  runtimeOptions?: BridgeRuntimeOptions,
): Promise<LocalServerHandle> {
  const pairingToken = createPairingToken();
  const autoPairStore: LocalAutoPairSessionStore = createLocalAutoPairSessionStore();
  const bridgeRuntime: BridgeRuntime = createBridgeRuntime(runtimeOptions);
  let boundPort = port;

  function checkAuth(
    request: IncomingMessage,
    response: ServerResponse<IncomingMessage>,
  ): boolean {
    const origin = getRequestOrigin(request);
    const originCheck = assertAllowedOrigin(origin, isTestEnvironment());
    if (!originCheck.ok) {
      writeJson(
        originCheck.statusCode,
        { status: 'error', message: originCheck.message },
        response,
      );
      return false;
    }

    // 1. Console cookie auth (same-origin Console requests)
    const consoleSessionToken = parseConsoleSessionCookie(request);
    if (consoleSessionToken && autoPairStore.verifyConsoleSession(consoleSessionToken)) {
      return true;
    }

    // 2. Pairing token header auth (printed pairing token or extension session token)
    const receivedToken = extractPairingTokenFromRequest(request);
    if (!receivedToken) {
      writeJson(
        401,
        { status: 'error', message: 'Missing pairing token' },
        response,
      );
      return false;
    }

    if (verifyPairingToken(receivedToken, pairingToken)) {
      return true;
    }

    if (autoPairStore.verifyExtensionSession(receivedToken)) {
      return true;
    }

    writeJson(
      403,
      { status: 'error', message: 'Invalid pairing token' },
      response,
    );
    return false;
  }

  const requestHandler: RequestListener = (request, response) => {
    const url = new URL(request.url ?? '/', `http://${LOCAL_SERVER_HOST}`);

    if (request.method === 'GET' && url.pathname === PUBLIC_HEALTH_PATH) {
      writeJson(200, createHealthPayload(LOCAL_SERVER_HOST, boundPort), response);
      return;
    }

    if (request.method === 'GET' && url.pathname === PROTECTED_HEALTH_PATH) {
      if (!checkAuth(request, response)) {
        return;
      }

      writeJson(200, createHealthPayload(LOCAL_SERVER_HOST, boundPort), response);
      return;
    }

    if (request.method === 'GET' && url.pathname === CONSOLE_PATH) {
      response.statusCode = 302;
      response.setHeader('location', CONSOLE_PROJECT_PATH);
      response.end();
      return;
    }

    if (request.method === 'GET' && url.pathname === CONSOLE_GOALS_PATH) {
      response.statusCode = 302;
      response.setHeader('location', CONSOLE_PROJECT_PATH);
      response.end();
      return;
    }

    if (request.method === 'GET' && url.pathname === CONSOLE_PROJECT_PATH) {
      const session = autoPairStore.createConsoleSession();
      response.statusCode = 200;
      response.setHeader('content-type', 'text/html; charset=utf-8');
      response.setHeader(
        'set-cookie',
        `cli_bridge_console_session=${session.consoleSessionToken}; HttpOnly; SameSite=Strict; Path=/`,
      );
      response.end(renderProjectConsoleHtml({ extensionClaimNonce: session.extensionClaimNonce }));
      return;
    }

    if (isBridgePath(url.pathname)) {
      if (!checkAuth(request, response)) {
        return;
      }

      handleBridgeRequest(bridgeRuntime, request.method ?? 'GET', url.pathname, request, url.searchParams)
        .then((result) => {
          writeBridgeResult(result, response);
        })
        .catch(() => {
          writeJson(500, { status: 'error', message: 'Internal bridge error' }, response);
        });
      return;
    }

    // ── Local auto-pair routes (narrow, loopback-only) ──

    if (request.method === 'POST' && url.pathname === '/bridge/local-auto-pair/extension-claim') {
      const origin = getRequestOrigin(request);
      if (!isAllowedOrigin(origin, isTestEnvironment())) {
        writeJson(403, { status: 'error', message: 'Claim only allowed from loopback' }, response);
        return;
      }
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString());
          const result = autoPairStore.claimExtensionSession(body.nonce ?? '');
          if (!result.ok) {
            writeJson(409, { status: 'error', message: result.message }, response);
            return;
          }
          writeJson(200, { extensionSessionToken: result.extensionSessionToken }, response);
        } catch {
          writeJson(400, { status: 'error', message: 'Invalid request body' }, response);
        }
      });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/bridge/local-auto-pair/revoke') {
      const origin = getRequestOrigin(request);
      const originCheck = assertAllowedOrigin(origin, isTestEnvironment());
      if (!originCheck.ok) {
        writeJson(
          originCheck.statusCode,
          { status: 'error', message: originCheck.message },
          response,
        );
        return;
      }

      const consoleSessionToken = parseConsoleSessionCookie(request);
      if (consoleSessionToken && autoPairStore.revokeConsoleSession(consoleSessionToken)) {
        response.setHeader('set-cookie', 'cli_bridge_console_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
        writeJson(200, { status: 'ok', message: 'Local session revoked' }, response);
        return;
      }
      const pairingHeader = extractPairingTokenFromRequest(request);
      if (pairingHeader && autoPairStore.revokeExtensionSession(pairingHeader)) {
        writeJson(200, { status: 'ok', message: 'Local session revoked' }, response);
        return;
      }
      writeJson(404, { status: 'error', message: 'No active local session found' }, response);
      return;
    }

    if (url.pathname === PUBLIC_HEALTH_PATH) {
      writeJson(405, { status: 'error', message: 'Method not allowed' }, response);
      return;
    }

    if (url.pathname === PROTECTED_HEALTH_PATH) {
      writeJson(405, { status: 'error', message: 'Method not allowed' }, response);
      return;
    }

    writeJson(404, { status: 'error', message: 'Not found' }, response);
  };

  const server = createServer(requestHandler);

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, LOCAL_SERVER_HOST, () => {
      server.off('error', reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Local server failed to bind to an IPv4 address.');
  }

  boundPort = address.port;
  return {
    server,
    host: LOCAL_SERVER_HOST,
    port: boundPort,
    url: `http://${LOCAL_SERVER_HOST}:${boundPort}`,
    pairingToken,
  };
}

if (isMainModule()) {
  const handle = await startLocalServer();
  console.log(`CLI Bridge local server listening on ${handle.url}`);
  console.log(`Console UI: ${handle.url}/console`);
  console.log(`Goal Console UI: ${handle.url}/console/goals`);
  console.log(`Project Workspace: ${handle.url}/console/project`);
  console.log(`Pairing token: ${handle.pairingToken}`);
}
