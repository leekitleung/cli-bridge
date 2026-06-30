// RP-2.18 / EX-2.18-1: operator configured local launcher tests.
// No real process is spawned and no external network is used. Tests 1–2 boot
// startLocalServer on an ephemeral port (port 0) and talk to it over loopback;
// tests 3–5 exercise extracted pure helpers with an injected fetch-like fn.

import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

import { startLocalServer } from '../apps/local-server/src/server.ts';
import {
  parseConfig,
  resolveTokenForProject,
  shouldAccept409,
  bootstrapProjects,
  formatStartupSummary,
  resolveConfigPath,
  shouldAutoOpen,
  buildConsoleOpenTarget,
  loadConfig,
  bootstrapStartedServer,
  installShutdownHandlers,
  openInBrowser,
} from '../scripts/start-local-configured.ts';

const PAIRING_HEADER = 'x-cli-bridge-pairing-token';
const __dirname = dirname(fileURLToPath(import.meta.url));
const EXAMPLE_PATH = resolve(__dirname, '../scripts/local-config.example.json');

test('npm start is the single safe product entrypoint', () => {
  const pkg = JSON.parse(readFileSync(resolve(__dirname, '../package.json'), 'utf8'));
  assert.equal(pkg.scripts.start, 'node --experimental-strip-types scripts/start.ts');
});

function authHeaders(token) {
  return { 'content-type': 'application/json', [PAIRING_HEADER]: token };
}

async function closeServer(handle) {
  await new Promise((res) => handle.server.close(() => res()));
}

// ── RP-2.25 §6: local auto-pair (run first to avoid state interference) ──

test('Project Console auto-pairs with HttpOnly cookie and no token in URL', async () => {
  const handle = await startLocalServer(0);
  try {
    const consoleRes = await fetch(`${handle.url}/console/project`);
    assert.equal(consoleRes.status, 200);
    const html = await consoleRes.text();
    const cookie = consoleRes.headers.getSetCookie?.()?.[0] ?? '';
    assert.match(cookie, /cli_bridge_console_session=/);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);
    assert.equal(html.includes(handle.pairingToken), false);
    assert.equal(consoleRes.url.includes(handle.pairingToken), false);

    const privateRes = await fetch(`${handle.url}/health/private`, {
      headers: {
        cookie,
        origin: handle.url,
      },
    });
    assert.equal(privateRes.status, 200);
  } finally {
    await closeServer(handle);
  }
});

test('extension claim nonce can be used once to obtain extension session token', async () => {
  const handle = await startLocalServer(0);
  try {
    const consoleRes = await fetch(`${handle.url}/console/project`);
    const html = await consoleRes.text();
    const nonce = html.match(/data-extension-claim-nonce="([^"]+)"/)?.[1];
    assert.ok(nonce, 'expected extension claim nonce');

    const claim = await fetch(`${handle.url}/bridge/local-auto-pair/extension-claim`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: handle.url },
      body: JSON.stringify({ nonce }),
    });
    assert.equal(claim.status, 200);
    const payload = await claim.json();
    assert.equal(typeof payload.extensionSessionToken, 'string');
    assert.equal(payload.extensionSessionToken.includes(handle.pairingToken), false);

    const replay = await fetch(`${handle.url}/bridge/local-auto-pair/extension-claim`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: handle.url },
      body: JSON.stringify({ nonce }),
    });
    assert.equal(replay.status, 409);

    const health = await fetch(`${handle.url}/health/private`, {
      headers: {
        'x-cli-bridge-pairing-token': payload.extensionSessionToken,
      },
    });
    assert.equal(health.status, 200);
  } finally {
    await closeServer(handle);
  }
});

test('local auto-pair revoke with extension token invalidates the local session', async () => {
  const handle = await startLocalServer(0);
  try {
    const consoleRes = await fetch(`${handle.url}/console/project`);
    const cookie = consoleRes.headers.getSetCookie?.()?.[0] ?? '';
    const html = await consoleRes.text();
    const nonce = html.match(/data-extension-claim-nonce="([^"]+)"/)?.[1];
    assert.ok(nonce, 'expected extension claim nonce');

    const claim = await fetch(`${handle.url}/bridge/local-auto-pair/extension-claim`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: handle.url },
      body: JSON.stringify({ nonce }),
    });
    assert.equal(claim.status, 200);
    const payload = await claim.json();

    const beforeRevoke = await fetch(`${handle.url}/health/private`, {
      headers: {
        'x-cli-bridge-pairing-token': payload.extensionSessionToken,
      },
    });
    assert.equal(beforeRevoke.status, 200);

    const revoked = await fetch(`${handle.url}/bridge/local-auto-pair/revoke`, {
      method: 'POST',
      headers: {
        origin: handle.url,
        'x-cli-bridge-pairing-token': payload.extensionSessionToken,
      },
    });
    assert.equal(revoked.status, 200);

    const extensionAfterRevoke = await fetch(`${handle.url}/health/private`, {
      headers: {
        'x-cli-bridge-pairing-token': payload.extensionSessionToken,
      },
    });
    assert.equal(extensionAfterRevoke.status, 403);

    const consoleAfterRevoke = await fetch(`${handle.url}/health/private`, {
      headers: { cookie, origin: handle.url },
    });
    assert.equal(consoleAfterRevoke.status, 401);
  } finally {
    await closeServer(handle);
  }
});

test('local auto-pair revoke rejects disallowed origins', async () => {
  const handle = await startLocalServer(0);
  try {
    const consoleRes = await fetch(`${handle.url}/console/project`);
    const cookie = consoleRes.headers.getSetCookie?.()?.[0] ?? '';
    const revoked = await fetch(`${handle.url}/bridge/local-auto-pair/revoke`, {
      method: 'POST',
      headers: { cookie, origin: 'https://example.invalid' },
    });
    assert.equal(revoked.status, 403);
  } finally {
    await closeServer(handle);
  }
});

// ── §5.1 Passthrough: injected runtime options reach the runtime ──

test('startLocalServer(0, options) threads verifyProfiles/roots into the runtime', async () => {
  const handle = await startLocalServer(0, {
    projectWorkspaceRoots: { 'test-proj': process.cwd() },
    verifyProfiles: [
      {
        id: 'node-version',
        label: 'node --version',
        argv: ['node', '--version'],
        cwdPolicy: { kind: 'project-root' },
        env: [],
        timeoutMs: 1000,
        outputCapBytes: 1024,
        networkRisk: 'declared-offline',
        mutationRisk: 'read-only',
      },
    ],
  });
  try {
    const token = handle.pairingToken;
    const create = await fetch(`${handle.url}/bridge/projects`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ key: 'test-proj', label: 'Test' }),
    });
    assert.equal(create.status, 201);

    const patch = await fetch(`${handle.url}/bridge/projects/test-proj`, {
      method: 'PATCH',
      headers: authHeaders(token),
      body: JSON.stringify({ verifyProfileId: 'node-version' }),
    });
    assert.equal(patch.status, 200);

    const res = await fetch(`${handle.url}/bridge/projects/test-proj/verification/profiles`, {
      method: 'GET',
      headers: authHeaders(token),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.workspaceRootAvailable, true);
    assert.equal(body.selectedProfileId, 'node-version');
    assert.ok(body.profiles.some((p) => p.id === 'node-version'));
  } finally {
    await closeServer(handle);
  }
});

// ── §5.2 Default path unchanged: no options → live verification 409 ──

test('startLocalServer() with no options keeps live verification fail-closed (409)', async () => {
  const handle = await startLocalServer(0);
  try {
    const token = handle.pairingToken;
    const create = await fetch(`${handle.url}/bridge/projects`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ key: 'plain-proj', label: 'Plain' }),
    });
    assert.equal(create.status, 201);

    // No profiles configured → verification confirm must 409.
    const confirm = await fetch(`${handle.url}/bridge/projects/plain-proj/verification/confirm`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ confirm: true }),
    });
    assert.equal(confirm.status, 409);

    // Profiles list is empty and no workspace root is available.
    const profiles = await fetch(`${handle.url}/bridge/projects/plain-proj/verification/profiles`, {
      method: 'GET',
      headers: authHeaders(token),
    });
    const body = await profiles.json();
    assert.equal(body.workspaceRootAvailable, false);
    assert.deepEqual(body.profiles, []);
  } finally {
    await closeServer(handle);
  }
});

// ── §5.3 F2: 409 only tolerated for create-project POST ──

test('shouldAccept409 only tolerates the create-project POST', () => {
  assert.equal(shouldAccept409('POST', '/bridge/projects'), true);
  assert.equal(shouldAccept409('post', '/bridge/projects'), true);
  assert.equal(shouldAccept409('PATCH', '/bridge/projects/x'), false);
  assert.equal(shouldAccept409('POST', '/bridge/projects/x/verification/confirm'), false);
  assert.equal(shouldAccept409('GET', '/bridge/projects'), false);
});

test('bootstrapProjects treats POST 409 as idempotent success', async () => {
  const calls = [];
  const fetchFn = async (url, init) => {
    calls.push(`${init.method} ${url}`);
    // POST create → 409 (already exists), PATCH → 200.
    if (init.method === 'POST') return { ok: false, status: 409, text: async () => 'exists' };
    return { ok: true, status: 200, text: async () => '' };
  };
  await bootstrapProjects({
    baseUrl: 'http://127.0.0.1:9',
    pairingToken: 'pair-secret',
    projects: [{ key: 'k', gitStatusEnabled: true }],
    fetchFn,
  });
  assert.equal(calls.length, 2);
});

test('bootstrapProjects fails closed when PATCH returns 409 and leaks no token', async () => {
  const fetchFn = async (url, init) => {
    if (init.method === 'POST') return { ok: true, status: 201, text: async () => '' };
    return { ok: false, status: 409, text: async () => 'conflict' };
  };
  await assert.rejects(
    bootstrapProjects({
      baseUrl: 'http://127.0.0.1:9',
      pairingToken: 'pair-secret',
      projects: [{ key: 'k', verifyProfileId: 'p' }],
      fetchFn,
    }),
    (err) => {
      assert.match(err.message, /bootstrap failed/i);
      assert.match(err.message, /PATCH/);
      assert.match(err.message, /409/);
      assert.ok(!err.message.includes('pair-secret'));
      return true;
    },
  );
});

test('bootstrapProjects redacts a token-like response body from the thrown message', async () => {
  const secret = 'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const fetchFn = async (_url, init) => {
    if (init.method === 'POST') return { ok: true, status: 201, text: async () => '' };
    return { ok: false, status: 500, text: async () => `upstream said ${secret}` };
  };
  await assert.rejects(
    bootstrapProjects({
      baseUrl: 'http://127.0.0.1:9',
      pairingToken: 'pair-secret',
      projects: [{ key: 'k', verifyProfileId: 'p' }],
      fetchFn,
    }),
    (err) => {
      assert.ok(!err.message.includes(secret), 'raw token must not appear in the thrown message');
      assert.match(err.message, /REDACTED_GITHUB_TOKEN/);
      assert.match(err.message, /500/);
      return true;
    },
  );
});

test('bootstrapProjects fails closed on a non-409 error too', async () => {
  const fetchFn = async (_url, init) => {
    if (init.method === 'POST') return { ok: false, status: 500, text: async () => 'boom' };
    return { ok: true, status: 200, text: async () => '' };
  };
  await assert.rejects(
    bootstrapProjects({
      baseUrl: 'http://127.0.0.1:9',
      pairingToken: 'pair-secret',
      projects: [{ key: 'k' }],
      fetchFn,
    }),
    /500/,
  );
});

test('configured launcher closes the listening server when bootstrap fails', async () => {
  const handle = await startLocalServer(0);
  await assert.rejects(
    bootstrapStartedServer(handle, [{ key: 'broken' }], async () => ({
      ok: false,
      status: 500,
      text: async () => 'boom',
    })),
    /bootstrap failed/i,
  );
  assert.equal(handle.server.listening, false);
});

test('configured launcher installs bounded signal shutdown', async () => {
  const handle = await startLocalServer(0);
  const listeners = new Map();
  const processLike = {
    exitCode: undefined,
    once(event, listener) { listeners.set(event, listener); return this; },
    removeListener(event) { listeners.delete(event); return this; },
  };
  const remove = installShutdownHandlers(handle, processLike, 500);
  await listeners.get('SIGTERM')();
  assert.equal(handle.server.listening, false);
  assert.equal(processLike.exitCode, 0);
  remove();
});

// ── §5.4 F1: shipped example is runnable as-shipped (no .cmd/.bat argv[0]) ──

test('local-config.example.json parses and uses directly-spawnable executables', () => {
  const config = parseConfig(readFileSync(EXAMPLE_PATH, 'utf8'));
  assert.ok(Array.isArray(config.verifyProfiles));
  for (const profile of config.verifyProfiles) {
    assert.ok(profile.argv.length >= 1);
    assert.ok(
      !/\.(cmd|bat)$/i.test(profile.argv[0]),
      `profile ${profile.id} argv[0] must not be a .cmd/.bat wrapper (runner is shell:false)`,
    );
  }
  // The selected default profile must be runnable on every OS.
  const selected = config.projects?.[0]?.verifyProfileId;
  const selectedProfile = config.verifyProfiles.find((p) => p.id === selected);
  assert.ok(selectedProfile, 'default project must reference an existing profile');
  assert.equal(selectedProfile.argv[0], 'node');
});

// ── §5.5 Config/token helpers + summary token discipline ──

test('resolveTokenForProject prefers per-project over global, else undefined', () => {
  assert.equal(
    resolveTokenForProject('my-proj', {
      CLI_BRIDGE_GH_TOKEN__my_proj: 'PER',
      CLI_BRIDGE_GH_TOKEN: 'GLOBAL',
    }),
    'PER',
  );
  assert.equal(resolveTokenForProject('my-proj', { CLI_BRIDGE_GH_TOKEN: 'GLOBAL' }), 'GLOBAL');
  assert.equal(resolveTokenForProject('my-proj', {}), undefined);
});

test('parseConfig rejects non-object and bad projects', () => {
  assert.throws(() => parseConfig('not json'), /valid JSON/);
  assert.throws(() => parseConfig('[]'), /JSON object/);
  assert.throws(() => parseConfig('{"projects":{}}'), /must be an array/);
  assert.throws(() => parseConfig('{"projects":[{"label":"x"}]}'), /non-empty string key/);
});

test('formatStartupSummary never includes a github token value', () => {
  const lines = formatStartupSummary(
    { url: 'http://127.0.0.1:31337', pairingToken: 'PAIR' },
    {
      projectWorkspaceRoots: { 'cli-bridge': '/root' },
      projects: [{ key: 'cli-bridge', gitStatusEnabled: true, githubChecksEnabled: true }],
    },
    ['cli-bridge'],
  );
  const joined = lines.join('\n');
  assert.ok(!joined.includes('SECRET_GH_TOKEN'));
  assert.ok(joined.includes('cli-bridge'));
  assert.ok(joined.includes('Pairing token: PAIR'));
});

// ── RP-2.19 §5.1 default config path resolution ──

test('resolveConfigPath honors env override and falls back to the default file', () => {
  const fromEnv = resolveConfigPath({ CLI_BRIDGE_LOCAL_CONFIG: 'some/custom.json' });
  assert.equal(fromEnv.fromEnv, true);
  assert.match(fromEnv.path.replace(/\\/g, '/'), /custom\.json$/);

  const def = resolveConfigPath({});
  assert.equal(def.fromEnv, false);
  assert.match(def.path.replace(/\\/g, '/'), /scripts\/local-config\.json$/);

  const blank = resolveConfigPath({ CLI_BRIDGE_LOCAL_CONFIG: '   ' });
  assert.equal(blank.fromEnv, false);
});

test('loadConfig with neither env nor default file throws an example-pointing error', () => {
  // Use an isolated empty dir so the result never depends on whether a real
  // scripts/local-config.json happens to exist in the developer's working tree.
  const emptyDir = mkdtempSync(join(tmpdir(), 'cli-bridge-cfg-missing-'));
  try {
    assert.throws(
      () => loadConfig({}, emptyDir),
      (err) => {
        assert.match(err.message, /local-config\.example\.json/);
        return true;
      },
    );
  } finally {
    rmSync(emptyDir, { recursive: true, force: true });
  }
});

test('loadConfig loads the default file from the resolved dir when present', () => {
  // Default-exists semantics, exercised in isolation rather than against repo root.
  const dir = mkdtempSync(join(tmpdir(), 'cli-bridge-cfg-default-'));
  try {
    writeFileSync(
      join(dir, 'local-config.json'),
      JSON.stringify({ port: 41337, projects: [{ key: 'demo', label: 'Demo' }] }),
    );
    const config = loadConfig({}, dir);
    assert.equal(config.port, 41337);
    assert.equal(config.projects?.[0]?.key, 'demo');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('loadConfig prefers the env-specified path over the default dir', () => {
  // Env-priority semantics, in isolation: env file wins even if the default dir has one.
  const dir = mkdtempSync(join(tmpdir(), 'cli-bridge-cfg-env-'));
  try {
    const envPath = join(dir, 'custom-config.json');
    writeFileSync(envPath, JSON.stringify({ port: 51337, projects: [{ key: 'env', label: 'Env' }] }));
    writeFileSync(
      join(dir, 'local-config.json'),
      JSON.stringify({ port: 41337, projects: [{ key: 'default', label: 'Default' }] }),
    );
    const config = loadConfig({ CLI_BRIDGE_LOCAL_CONFIG: envPath }, dir);
    assert.equal(config.port, 51337);
    assert.equal(config.projects?.[0]?.key, 'env');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── RP-2.19 §5.2 auto-open is suppressible / inert ──

test('shouldAutoOpen is true by default and false when suppressed', () => {
  assert.equal(shouldAutoOpen({}), true);
  assert.equal(shouldAutoOpen({ CLI_BRIDGE_NO_OPEN: '1' }), false);
  assert.equal(shouldAutoOpen({ CLI_BRIDGE_NO_OPEN: 'true' }), false);
  assert.equal(shouldAutoOpen({ CLI_BRIDGE_NO_OPEN: '' }), true);
});

test('buildConsoleOpenTarget points at the console with no token/query', () => {
  const target = buildConsoleOpenTarget({ url: 'http://127.0.0.1:31337' });
  assert.equal(target, 'http://127.0.0.1:31337/console/project');
  assert.ok(!target.includes('?'));
  assert.ok(!target.includes('#'));
  assert.ok(!target.toLowerCase().includes('token'));
});

test('browser opener handles asynchronous spawn errors without throwing', () => {
  const child = new EventEmitter();
  child.unref = () => child;
  let errorHandled = false;
  child.on('error', () => { errorHandled = true; });
  openInBrowser('http://127.0.0.1:31337/console/project', {
    platform: 'linux',
    spawnFn: () => child,
  });
  child.emit('error', new Error('ENOENT'));
  assert.equal(errorHandled, true);
});

test('Windows launcher preserves npm exit status', () => {
  const   source = readFileSync(resolve(__dirname, '../scripts/start-local.cmd'), 'utf8');
  assert.match(source, /set\s+"exitCode=%ERRORLEVEL%"/i);
  assert.match(source, /exit\s+\/b\s+%exitCode%/i);
});
