import {
  createServer,
  type IncomingMessage,
  type RequestListener,
  type ServerResponse,
} from 'node:http';
import { pathToFileURL } from 'node:url';

import { logger, withCorrelationId, generateCorrelationId } from './utils/structured-logger.ts';

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
  type BridgeAuthContext,
  type BridgeRuntime,
  type BridgeRuntimeOptions,
} from './routes/bridge-api.ts';
import {
  createGoalLoopRouteContext,
  handleGoalLoopRequest,
  handleExecutorsRequest,
  handleDiagnosticsLoopsRequest,
  handleDiagnosticsMetricsRequest,
  type GoalLoopRouteContext,
} from './routes/goal-loop-routes.ts';
import {
  assertAllowedOrigin,
  getRequestOrigin,
  isAllowedClaimOrigin,
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
import {
  createRateLimiter,
  DEFAULT_RATE_LIMIT_CONFIG,
  AUTH_RATE_LIMIT_CONFIG,
  type SimpleRateLimiter,
} from './security/rate-limiter.ts';

export interface LocalServerHandle {
  server: ReturnType<typeof createServer>;
  host: string;
  port: number;
  url: string;
  pairingToken: string;
}

interface SourceRelayBridgeDiagnostics {
  requests: number;
  authSucceeded: number;
  authFailed: number;
  byPath: Record<string, {
    requests: number;
    authSucceeded: number;
    authFailed: number;
    methods: Record<string, number>;
    resultStatus: Record<string, number>;
  }>;
  lastPath: string | null;
  lastMethod: string | null;
  lastResultStatus: number | null;
  lastRequestAt: number | null;
  lastAuthSucceededAt: number | null;
  lastAuthFailedAt: number | null;
  lastResultAt: number | null;
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

function isChatGptWebSourceRelayPath(pathname: string): boolean {
  return pathname.startsWith('/bridge/source/chatgpt-web/');
}

export async function startLocalServer(
  port: number = DEFAULT_LOCAL_SERVER_PORT,
  runtimeOptions?: BridgeRuntimeOptions,
): Promise<LocalServerHandle> {
  // Configure structured logger with file transport if log directory specified
  const logDir = process.env['LOG_DIR'];
  if (logDir) {
    logger.configure({
      logDir,
      logFile: 'cli-bridge',
      maxFileSize: 10 * 1024 * 1024, // 10MB
      maxFiles: 5,
      fileLevel: 'info',
    });
    logger.info('Logger configured', { logDir });
  }

  const pairingToken = createPairingToken();
  const autoPairStore: LocalAutoPairSessionStore = createLocalAutoPairSessionStore();
  const bridgeRuntime: BridgeRuntime = createBridgeRuntime(runtimeOptions);
  const goalLoopRouteContext: GoalLoopRouteContext = await createGoalLoopRouteContext(bridgeRuntime);

  // 速率限制器
  const defaultRateLimiter: SimpleRateLimiter = createRateLimiter(
    DEFAULT_RATE_LIMIT_CONFIG.windowMs,
    DEFAULT_RATE_LIMIT_CONFIG.maxRequests,
  );
  const authRateLimiter: SimpleRateLimiter = createRateLimiter(
    AUTH_RATE_LIMIT_CONFIG.windowMs,
    AUTH_RATE_LIMIT_CONFIG.maxRequests,
  );

  const sourceRelayBridgeDiagnostics: SourceRelayBridgeDiagnostics = {
    requests: 0,
    authSucceeded: 0,
    authFailed: 0,
    byPath: {},
    lastPath: null,
    lastMethod: null,
    lastResultStatus: null,
    lastRequestAt: null,
    lastAuthSucceededAt: null,
    lastAuthFailedAt: null,
    lastResultAt: null,
  };
  let boundPort = port;

  function recordSourceRelayBridgeRequest(
    pathname: string,
    input?: { method?: string; authResult?: 'succeeded' | 'failed'; resultStatus?: number },
  ): void {
    const now = Date.now();
    const pathStats = sourceRelayBridgeDiagnostics.byPath[pathname] ?? {
      requests: 0,
      authSucceeded: 0,
      authFailed: 0,
      methods: {},
      resultStatus: {},
    };
    if (input?.resultStatus !== undefined) {
      const key = String(input.resultStatus);
      sourceRelayBridgeDiagnostics.lastResultStatus = input.resultStatus;
      sourceRelayBridgeDiagnostics.lastResultAt = now;
      pathStats.resultStatus[key] = (pathStats.resultStatus[key] ?? 0) + 1;
    } else if (!input?.authResult) {
      sourceRelayBridgeDiagnostics.requests++;
      sourceRelayBridgeDiagnostics.lastPath = pathname;
      sourceRelayBridgeDiagnostics.lastMethod = input?.method ?? null;
      sourceRelayBridgeDiagnostics.lastRequestAt = now;
      pathStats.requests++;
      if (input?.method) {
        pathStats.methods[input.method] = (pathStats.methods[input.method] ?? 0) + 1;
      }
    } else if (input.authResult === 'succeeded') {
      sourceRelayBridgeDiagnostics.authSucceeded++;
      sourceRelayBridgeDiagnostics.lastAuthSucceededAt = now;
      pathStats.authSucceeded++;
    } else {
      sourceRelayBridgeDiagnostics.authFailed++;
      sourceRelayBridgeDiagnostics.lastAuthFailedAt = now;
      pathStats.authFailed++;
    }
    sourceRelayBridgeDiagnostics.byPath[pathname] = pathStats;
  }

  function checkAuth(
    request: IncomingMessage,
    response: ServerResponse<IncomingMessage>,
  ): BridgeAuthContext | undefined {
    const origin = getRequestOrigin(request);
    const originCheck = assertAllowedOrigin(origin, isTestEnvironment());
    if (!originCheck.ok) {
      writeJson(
        originCheck.statusCode,
        { status: 'error', message: originCheck.message },
        response,
      );
      return undefined;
    }

    // 1. Pairing token header auth (printed pairing token or extension session token).
    // Prefer explicit credentials over the Console cookie: extension background
    // fetches to 127.0.0.1 may carry Console cookies automatically, but source
    // relay endpoints must authenticate as an extension session.
    const receivedToken = extractPairingTokenFromRequest(request);
    if (receivedToken) {
      if (verifyPairingToken(receivedToken, pairingToken)) {
        return { kind: 'pairing-token' };
      }

      if (autoPairStore.verifyExtensionSession(receivedToken)) {
        return { kind: 'extension-session' };
      }

      writeJson(
        403,
        { status: 'error', message: 'Invalid pairing token' },
        response,
      );
      return undefined;
    }

    // 2. Console cookie auth (same-origin Console requests)
    const consoleSessionToken = parseConsoleSessionCookie(request);
    if (consoleSessionToken && autoPairStore.verifyConsoleSession(consoleSessionToken)) {
      return { kind: 'console-cookie' };
    }

    writeJson(
      401,
      { status: 'error', message: 'Missing pairing token' },
      response,
    );
    return undefined;
  }

  const requestHandler: RequestListener = (request, response) => {
    const url = new URL(request.url ?? '/', `http://${LOCAL_SERVER_HOST}`);

    // 获取客户端 IP（不再信任 X-Forwarded-For，防止 IP 欺骗）
    // SECURITY FIX: X-Forwarded-For 可以被攻击者伪造，不再使用
    const clientIp = request.socket.remoteAddress ?? 'unknown';

    // 速率限制检查（公共端点）
    const publicPaths = [PUBLIC_HEALTH_PATH, CONSOLE_PATH, CONSOLE_GOALS_PATH, CONSOLE_PROJECT_PATH];
    const authPaths = ['/bridge/local-auto-pair/extension-claim'];
    const isPublicPath = publicPaths.includes(url.pathname);
    const isAuthPath = authPaths.some(p => url.pathname.startsWith(p));

    if (isPublicPath || isAuthPath) {
      const limiter = isAuthPath ? authRateLimiter : defaultRateLimiter;
      if (!limiter.check(clientIp)) {
        const retryAfter = Math.ceil((limiter.resetAt(clientIp) - Date.now()) / 1000);
        response.writeHead(429, {
          'Content-Type': 'application/json',
          'Retry-After': String(retryAfter),
        });
        response.end(JSON.stringify({ status: 'error', message: 'Too many requests' }));
        return;
      }
    }

    if (request.method === 'GET' && url.pathname === PUBLIC_HEALTH_PATH) {
      writeJson(200, createHealthPayload(LOCAL_SERVER_HOST, boundPort, pairingToken), response);
      return;
    }

    if (request.method === 'GET' && url.pathname === PROTECTED_HEALTH_PATH) {
      if (!checkAuth(request, response)) {
        return;
      }

      writeJson(200, createHealthPayload(LOCAL_SERVER_HOST, boundPort, pairingToken), response);
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

      // SECURITY: 添加安全 Headers 防止 XSS、点击劫持等攻击
      const securityHeaders = {
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:;",
        'X-XSS-Protection': '1; mode=block',
      };

      response.statusCode = 200;
      response.setHeader('content-type', 'text/html; charset=utf-8');
      for (const [key, value] of Object.entries(securityHeaders)) {
        response.setHeader(key, value);
      }
      response.setHeader(
        'set-cookie',
        `cli_bridge_console_session=${session.consoleSessionToken}; HttpOnly; SameSite=Strict; Path=/`,
      );
      response.end(renderProjectConsoleHtml({ extensionClaimNonce: session.extensionClaimNonce }));
      return;
    }

    // ── Goal Loop & Executor routes (async, early exit) ──
    const REQUEST_TIMEOUT_MS = 60_000; // 60 second timeout for all requests
    const requestTimeout = setTimeout(() => {
      if (!response.headersSent) {
        writeJson(504, { status: 'error', code: 'REQUEST_TIMEOUT', message: 'Request timeout - operation took too long' }, response);
      }
      request.destroy();
    }, REQUEST_TIMEOUT_MS);

    (async () => {
      try {
      if (await handleGoalLoopRequest(request, response, goalLoopRouteContext)) {
        clearTimeout(requestTimeout);
        return;
      }
      if (await handleExecutorsRequest(request, response, goalLoopRouteContext)) {
        clearTimeout(requestTimeout);
        return;
      }
      if (await handleDiagnosticsLoopsRequest(request, response, goalLoopRouteContext)) {
        clearTimeout(requestTimeout);
        return;
      }
      if (await handleDiagnosticsMetricsRequest(request, response, goalLoopRouteContext)) {
        clearTimeout(requestTimeout);
        return;
      }

      // ── Bridge API routes ──
      if (isBridgePath(url.pathname)) {
        const sourceRelayPath = isChatGptWebSourceRelayPath(url.pathname);
        if (sourceRelayPath) {
          recordSourceRelayBridgeRequest(url.pathname, { method: request.method ?? 'GET' });
        }
        const authContext = checkAuth(request, response);
        if (!authContext) {
          if (sourceRelayPath) {
            recordSourceRelayBridgeRequest(url.pathname, { authResult: 'failed' });
          }
          clearTimeout(requestTimeout);
          return;
        }
        if (sourceRelayPath) {
          recordSourceRelayBridgeRequest(url.pathname, { authResult: 'succeeded' });
        }

        // Add timeout to bridge request
        const BRIDGE_REQUEST_TIMEOUT_MS = 120_000; // 2 minutes for bridge operations
        const bridgeTimeout = setTimeout(() => {
          if (!response.headersSent) {
            writeJson(504, { status: 'error', code: 'BRIDGE_TIMEOUT', message: 'Bridge request timeout' }, response);
          }
          // Destroy request socket to prevent connection leak
          request.destroy();
        }, BRIDGE_REQUEST_TIMEOUT_MS);

        handleBridgeRequest(bridgeRuntime, request.method ?? 'GET', url.pathname, request, url.searchParams, authContext)
          .then((result) => {
            clearTimeout(bridgeTimeout);
            clearTimeout(requestTimeout);
            if (sourceRelayPath) {
              recordSourceRelayBridgeRequest(url.pathname, { resultStatus: result.statusCode });
            }
            writeBridgeResult(result, response);
          })
          .catch((err) => {
            clearTimeout(bridgeTimeout);
            clearTimeout(requestTimeout);
            logger.error('[Server] Bridge request error:', { error: err instanceof Error ? err.message : String(err), path: url.pathname });
            writeJson(500, { status: 'error', code: 'INTERNAL_ERROR', message: 'Internal bridge error' }, response);
          });
        return;
      }

      // ── Local auto-pair routes ──
      if (request.method === 'GET' && url.pathname === '/bridge/local-auto-pair/status') {
        clearTimeout(requestTimeout);
        if (!checkAuth(request, response)) { return; }
        writeJson(200, { status: 'ok', diagnostics: autoPairStore.getDiagnostics(), sourceRelayBridge: sourceRelayBridgeDiagnostics }, response);
        return;
      }

      if (request.method === 'POST' && url.pathname === '/bridge/local-auto-pair/extension-claim') {
        clearTimeout(requestTimeout);
        const origin = getRequestOrigin(request);
        if (!isAllowedClaimOrigin(origin)) {
          writeJson(403, { status: 'error', code: 'FORBIDDEN', message: 'Claim only allowed from loopback or extension' }, response);
          return;
        }
        const MAX_BODY_SIZE = 1024 * 1024; // 1MB limit
        let totalSize = 0;
        const chunks: Buffer[] = [];
        request.on('data', (chunk: Buffer) => {
          totalSize += chunk.length;
          if (totalSize > MAX_BODY_SIZE) {
            request.destroy();
            return;
          }
          chunks.push(chunk);
        });
        request.on('end', () => {
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString());

            // SECURITY FIX: 验证 nonce 长度和格式，防止资源耗尽攻击
            const nonce = body?.nonce;
            if (typeof nonce !== 'string' || nonce.length < 16 || nonce.length > 256) {
              writeJson(400, { status: 'error', code: 'INVALID_NONCE', message: 'Invalid nonce format' }, response);
              return;
            }

            const result = autoPairStore.claimExtensionSession(nonce);
            if (!result.ok) { writeJson(409, { status: 'error', code: 'CLAIM_FAILED', message: result.message }, response); return; }
            writeJson(200, { extensionSessionToken: result.extensionSessionToken }, response);
          } catch (err) {
            logger.error('[Server] Extension claim error:', { error: err instanceof Error ? err.message : String(err) });
            writeJson(400, { status: 'error', code: 'INVALID_REQUEST', message: 'Invalid request body' }, response);
          }
        });
        return;
      }

      if (request.method === 'POST' && url.pathname === '/bridge/local-auto-pair/revoke') {
        clearTimeout(requestTimeout);
        const origin = getRequestOrigin(request);
        const originCheck = assertAllowedOrigin(origin, isTestEnvironment());
        if (!originCheck.ok) {
          writeJson(originCheck.statusCode, { status: 'error', code: 'FORBIDDEN', message: originCheck.message }, response);
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
        writeJson(404, { status: 'error', code: 'NOT_FOUND', message: 'No active local session found' }, response);
        return;
      }

      if (url.pathname === PUBLIC_HEALTH_PATH || url.pathname === PROTECTED_HEALTH_PATH) {
        clearTimeout(requestTimeout);
        writeJson(405, { status: 'error', code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' }, response);
        return;
      }

      clearTimeout(requestTimeout);
      writeJson(404, { status: 'error', code: 'NOT_FOUND', message: 'Not found' }, response);
      } catch (err) {
        clearTimeout(requestTimeout);
        logger.error('[Server] Unhandled request error:', { error: err instanceof Error ? err.message : String(err), path: url.pathname });
        if (!response.headersSent) {
          writeJson(500, { status: 'error', code: 'INTERNAL_ERROR', message: 'Internal server error' }, response);
        }
      }
    })();
  };

  const server = createServer(requestHandler);

  // Graceful shutdown support
  let isShuttingDown = false;
  const activeRequests = new Set<RequestListener>();

  // Wrap request handler to track active requests
  const wrappedHandler: RequestListener = (req, res) => {
    if (isShuttingDown) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'unavailable', message: 'Server is shutting down' }));
      return;
    }
    activeRequests.add(req as unknown as RequestListener);
    req.on('close', () => activeRequests.delete(req as unknown as RequestListener));
    requestHandler(req, res);
  };

  const shutdown = async (signal: string): Promise<void> => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    logger.info('[Server] Received shutdown signal, starting graceful shutdown...', { signal });

    // Stop accepting new connections
    server.close();

    // Wait for active requests to complete (max 10 seconds)
    const shutdownTimeout = 10_000;
    const startTime = Date.now();

    if (activeRequests.size > 0) {
      logger.info('[Server] Waiting for active requests to complete...', { activeRequests: activeRequests.size });

      await new Promise<void>((resolve) => {
        const checkInterval = setInterval(() => {
          if (activeRequests.size === 0 || Date.now() - startTime > shutdownTimeout) {
            clearInterval(checkInterval);
            resolve();
          }
        }, 100);
      });

      const elapsed = Date.now() - startTime;
      if (activeRequests.size > 0) {
        logger.warn('[Server] Shutdown timeout, forcing exit', { elapsed, activeRequests: activeRequests.size });
      } else {
        logger.info('[Server] All requests completed, shutdown complete', { elapsed });
      }
    }

    // Flush log file before exit
    logger.flush();
    logger.info('[Server] Graceful shutdown complete');
    process.exit(0);
  };

  // Register signal handlers
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

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
  // SECURITY FIX: 不输出配对令牌任何部分，防止信息泄露
  console.log(`Pairing token: [see /health endpoint]`);
  logger.info('Server started', { url: handle.url });
}
