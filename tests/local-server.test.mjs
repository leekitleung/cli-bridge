import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

import {
  ALLOWED_EXTENSION_ORIGIN,
  DEFAULT_LOCAL_SERVER_PORT,
  LOCAL_SERVER_HOST,
  LOCAL_SERVER_BASE_URL,
  PAIRING_TOKEN_HEADER,
  PUBLIC_HEALTH_PATH,
  PROTECTED_HEALTH_PATH,
  SERVICE_NAME,
  SERVICE_VERSION,
} from '../packages/shared/src/constants.ts';
import {
  checkPublicHealth,
  checkProtectedHealth,
} from '../apps/extension/src/background/index.ts';
import { startLocalServer } from '../apps/local-server/src/server.ts';
import {
  createPairingToken,
  extractPairingTokenFromRequest,
  verifyPairingToken,
} from '../apps/local-server/src/security/pairing.ts';
import {
  ALLOWED_ORIGINS,
} from '../packages/shared/src/constants.ts';
import {
  getRequestOrigin,
  isAllowedOrigin,
  ORIGIN_HEADER,
} from '../apps/local-server/src/security/origin-guard.ts';

const root = process.cwd();
const sourceFiles = [
  'apps/local-server/src/server.ts',
  'apps/local-server/src/routes/health.ts',
  'apps/local-server/src/routes/bridge-api.ts',
  'apps/local-server/src/security/pairing.ts',
  'apps/local-server/src/security/origin-guard.ts',
  'packages/shared/src/constants.ts',
];

const textFileExtensions = new Set(['.ts', '.mjs', '.json', '.md']);
const ignoredDirectories = new Set(['.git', 'node_modules', 'coverage', 'dist']);

async function collectTextFiles(directory, relativeBase = '') {
  const entries = await readdir(resolve(root, directory), { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (ignoredDirectories.has(entry.name)) {
      continue;
    }

    const relativePath = relativeBase ? `${relativeBase}/${entry.name}` : entry.name;
    const absolutePath = resolve(root, relativePath);

    if (entry.isDirectory()) {
      files.push(...await collectTextFiles(relativePath, relativePath));
      continue;
    }

    if (textFileExtensions.has(relativePath.slice(relativePath.lastIndexOf('.')))) {
      files.push(absolutePath);
    }
  }

  return files;
}

test('local server constants are fixed for W1-1', () => {
  assert.equal(LOCAL_SERVER_HOST, '127.0.0.1');
  assert.equal(typeof DEFAULT_LOCAL_SERVER_PORT, 'number');
  assert.equal(typeof SERVICE_NAME, 'string');
  assert.equal(typeof SERVICE_VERSION, 'string');
  assert.equal(LOCAL_SERVER_BASE_URL, `http://${LOCAL_SERVER_HOST}:${DEFAULT_LOCAL_SERVER_PORT}`);
  assert.equal(PUBLIC_HEALTH_PATH, '/health');
  assert.equal(PROTECTED_HEALTH_PATH, '/health/private');
  assert.equal(PAIRING_TOKEN_HEADER, 'x-cli-bridge-pairing-token');
  assert.equal(ALLOWED_EXTENSION_ORIGIN, 'chrome-extension://__CLI_BRIDGE_EXTENSION_ID__');
});

test('local server source does not contain forbidden endpoint patterns', async () => {
  const content = await Promise.all(
    sourceFiles.map(async (path) => [path, await readFile(resolve(root, path), 'utf8')]),
  );

  // Match forbidden shell-style ENDPOINT ROUTE LITERALS only: a `/exec`,
  // `/command`, `/shell`, or `/run` segment that ends a route (followed by a
  // quote, another slash, or end of line). This intentionally does NOT flag
  // source filenames like `command-review-adapter.ts` (where `/command` is
  // followed by `-`), which are not HTTP endpoints.
  const forbiddenRoute = /\/(exec|command|shell|run)(['"`/]|$)/m;

  for (const [path, text] of content) {
    assert.ok(!text.includes('0.0.0.0'), `${path} must not contain 0.0.0.0`);
    assert.ok(!forbiddenRoute.test(text), `${path} must not expose a shell-style endpoint route`);
  }
});

test('health endpoint returns minimal static service metadata', async (t) => {
  const handle = await startLocalServer(0);

  t.after(async () => {
    await new Promise((resolve, reject) => {
      handle.server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(undefined);
      });
    });
  });

  assert.equal(handle.host, '127.0.0.1');
  assert.match(handle.url, /^http:\/\/127\.0\.0\.1:\d+$/);

  const response = await fetch(`${handle.url}/health`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8');

  const payload = await response.json();
  assert.deepEqual(payload, {
    status: 'ok',
    serviceName: 'CLI Bridge Local Server',
    serviceVersion: '0.1.0',
    host: '127.0.0.1',
    port: handle.port,
  });
});

test('pairing token helpers work without persisting token state', () => {
  const token = createPairingToken();

  assert.equal(typeof token, 'string');
  assert.equal(token.length > 0, true);
  assert.equal(verifyPairingToken(token, token), true);
  assert.equal(verifyPairingToken(null, token), false);
  assert.equal(verifyPairingToken('wrong-token', token), false);

  const request = {
    headers: {
      [PAIRING_TOKEN_HEADER]: token,
    },
  };

  assert.equal(extractPairingTokenFromRequest(request), token);
});

test('origin guard helpers work for allowed, blocked, and missing origins', () => {
  assert.equal(isAllowedOrigin('https://chatgpt.com'), true);
  assert.equal(isAllowedOrigin(ALLOWED_EXTENSION_ORIGIN), true);
  assert.equal(isAllowedOrigin('https://example.com'), false);
  // A missing Origin is allowed: it cannot be a cross-site request, and the
  // pairing token remains the gate.
  assert.equal(isAllowedOrigin(null), true);
  assert.equal(isAllowedOrigin(null, true), true);

  const request = {
    headers: {
      [ORIGIN_HEADER]: 'https://chatgpt.com',
    },
  };

  assert.equal(getRequestOrigin(request), 'https://chatgpt.com');
  assert.equal(ALLOWED_ORIGINS.includes('https://chatgpt.com'), true);
  assert.equal(ALLOWED_ORIGINS.includes(ALLOWED_EXTENSION_ORIGIN), true);
});

test('private health endpoint treats the pairing token as the gate when origin is absent', async (t) => {
  const handle = await startLocalServer(0);

  t.after(async () => {
    await new Promise((resolve, reject) => {
      handle.server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(undefined);
      });
    });
  });

  // No origin + no token -> 401 (token is the gate; origin absence is allowed
  // because it cannot be a cross-site request on a loopback-bound server).
  const missingTokenResponse = await fetch(`${handle.url}/health/private`);
  assert.equal(missingTokenResponse.status, 401);
  assert.deepEqual(await missingTokenResponse.json(), {
    status: 'error',
    message: 'Missing pairing token',
  });

  // No origin + wrong token -> 403.
  const invalidTokenResponse = await fetch(`${handle.url}/health/private`, {
    headers: {
      [PAIRING_TOKEN_HEADER]: 'wrong-token',
    },
  });
  assert.equal(invalidTokenResponse.status, 403);
  assert.deepEqual(await invalidTokenResponse.json(), {
    status: 'error',
    message: 'Invalid pairing token',
  });

  // No origin + valid token -> 200 (this is the same-origin console case).
  const validTokenResponse = await fetch(`${handle.url}/health/private`, {
    headers: {
      [PAIRING_TOKEN_HEADER]: handle.pairingToken,
    },
  });
  assert.equal(validTokenResponse.status, 200);
});

test('private health endpoint requires allowed origin before pairing token', async (t) => {
  const handle = await startLocalServer(0);

  t.after(async () => {
    await new Promise((resolve, reject) => {
      handle.server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(undefined);
      });
    });
  });

  const blockedOriginResponse = await fetch(`${handle.url}/health/private`, {
    headers: {
      origin: 'https://example.com',
      [PAIRING_TOKEN_HEADER]: handle.pairingToken,
    },
  });
  assert.equal(blockedOriginResponse.status, 403);
  assert.deepEqual(await blockedOriginResponse.json(), {
    status: 'error',
    message: 'Invalid origin',
  });

  const allowedOriginMissingTokenResponse = await fetch(`${handle.url}/health/private`, {
    headers: {
      origin: 'https://chatgpt.com',
    },
  });
  assert.equal(allowedOriginMissingTokenResponse.status, 401);
  assert.deepEqual(await allowedOriginMissingTokenResponse.json(), {
    status: 'error',
    message: 'Missing pairing token',
  });

  const allowedOriginInvalidTokenResponse = await fetch(`${handle.url}/health/private`, {
    headers: {
      origin: 'https://chatgpt.com',
      [PAIRING_TOKEN_HEADER]: 'wrong-token',
    },
  });
  assert.equal(allowedOriginInvalidTokenResponse.status, 403);
  assert.deepEqual(await allowedOriginInvalidTokenResponse.json(), {
    status: 'error',
    message: 'Invalid pairing token',
  });

  const allowedOriginValidTokenResponse = await fetch(`${handle.url}/health/private`, {
    headers: {
      origin: 'https://chatgpt.com',
      [PAIRING_TOKEN_HEADER]: handle.pairingToken,
    },
  });
  assert.equal(allowedOriginValidTokenResponse.status, 200);
});

test('private health endpoint with valid token and no origin succeeds (same-origin console)', async (t) => {
  const handle = await startLocalServer(0);

  t.after(async () => {
    await new Promise((resolve, reject) => {
      handle.server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(undefined);
      });
    });
  });

  const noOriginResponse = await fetch(`${handle.url}/health/private`, {
    headers: {
      [PAIRING_TOKEN_HEADER]: handle.pairingToken,
    },
  });

  assert.equal(noOriginResponse.status, 200);
});

test('extension background health helpers handle public success, protected success, and explicit failures', async (t) => {
  const handle = await startLocalServer(0);
  let closed = false;

  const closeServer = async () => {
    if (closed) {
      return;
    }

    closed = true;
    await new Promise((resolve, reject) => {
      handle.server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(undefined);
      });
    });
  };

  t.after(async () => {
    await closeServer();
  });

  const publicHealth = await checkPublicHealth({
    baseUrl: handle.url,
    fetchImpl: fetch,
  });
  assert.deepEqual(publicHealth, {
    ok: true,
    status: 'ok',
    reason: null,
    serviceName: SERVICE_NAME,
    serviceVersion: SERVICE_VERSION,
  });

  const missingToken = await checkProtectedHealth(null, {
    baseUrl: handle.url,
    fetchImpl: fetch,
    origin: ALLOWED_EXTENSION_ORIGIN,
  });
  assert.deepEqual(missingToken, {
    ok: false,
    status: 'error',
    reason: 'missing-token',
  });

  const protectedSuccess = await checkProtectedHealth(handle.pairingToken, {
    baseUrl: handle.url,
    fetchImpl: fetch,
    origin: ALLOWED_EXTENSION_ORIGIN,
  });
  assert.deepEqual(protectedSuccess, {
    ok: true,
    status: 'ok',
    reason: null,
    serviceName: SERVICE_NAME,
    serviceVersion: SERVICE_VERSION,
  });

  const originFailure = await checkProtectedHealth(handle.pairingToken, {
    baseUrl: handle.url,
    fetchImpl: fetch,
    origin: 'https://example.com',
  });
  assert.deepEqual(originFailure, {
    ok: false,
    status: 'error',
    reason: 'origin-failed',
  });

  const pairingFailure = await checkProtectedHealth('wrong-token', {
    baseUrl: handle.url,
    fetchImpl: fetch,
    origin: ALLOWED_EXTENSION_ORIGIN,
  });
  assert.deepEqual(pairingFailure, {
    ok: false,
    status: 'error',
    reason: 'pairing-failed',
  });

  await closeServer();

  const unavailablePublicHealth = await checkPublicHealth({
    baseUrl: handle.url,
    fetchImpl: fetch,
  });
  assert.deepEqual(unavailablePublicHealth, {
    ok: false,
    status: 'error',
    reason: 'network-error',
  });

  const unavailableProtectedHealth = await checkProtectedHealth(handle.pairingToken, {
    baseUrl: handle.url,
    fetchImpl: fetch,
    origin: ALLOWED_EXTENSION_ORIGIN,
  });
  assert.deepEqual(unavailableProtectedHealth, {
    ok: false,
    status: 'error',
    reason: 'network-error',
  });
});

test('extension manifest and background source stay minimal for W1-4', async () => {
  const manifestPath = resolve(root, 'apps/extension/manifest.json');
  const backgroundPath = resolve(root, 'apps/extension/src/background/index.ts');

  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  assert.deepEqual(manifest.background, {
    service_worker: 'dist/background/index.js',
    type: 'module',
  });
  assert.deepEqual(manifest.permissions, ['clipboardWrite', 'storage']);
  assert.deepEqual(manifest.host_permissions, [`${LOCAL_SERVER_BASE_URL}/*`, 'https://chatgpt.com/*']);
  assert.deepEqual(manifest.content_scripts, [
    {
      matches: ['https://chatgpt.com/*'],
      js: ['dist/content/index.js'],
    },
  ]);
  assert.equal(JSON.stringify(manifest).includes('.ts'), false);

  const backgroundSource = await readFile(backgroundPath, 'utf8');
  for (const snippet of [
    'document',
    'window.document',
    'querySelector',
    'localStorage',
    'cookie',
  ]) {
    assert.equal(
      backgroundSource.includes(snippet),
      false,
      `background must not reference ${snippet}`,
    );
  }
});

test('pairing token stays out of tracked source files', async (t) => {
  const handle = await startLocalServer(0);

  t.after(async () => {
    await new Promise((resolve, reject) => {
      handle.server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(undefined);
      });
    });
  });

  const candidateFiles = await collectTextFiles('.');

  for (const absolutePath of candidateFiles) {
    const text = await readFile(absolutePath, 'utf8');
    assert.equal(
      text.includes(handle.pairingToken),
      false,
      `${absolutePath} must not contain pairing token`,
    );
  }
});
