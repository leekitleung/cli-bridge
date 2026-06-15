// RP-2.18 / EX-2.18-1: operator configured local launcher tests.
// No real process is spawned and no external network is used. Tests 1–2 boot
// startLocalServer on an ephemeral port (port 0) and talk to it over loopback;
// tests 3–5 exercise extracted pure helpers with an injected fetch-like fn.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { startLocalServer } from '../apps/local-server/src/server.ts';
import {
  parseConfig,
  resolveTokenForProject,
  shouldAccept409,
  bootstrapProjects,
  formatStartupSummary,
} from '../scripts/start-local-configured.ts';

const PAIRING_HEADER = 'x-cli-bridge-pairing-token';
const __dirname = dirname(fileURLToPath(import.meta.url));
const EXAMPLE_PATH = resolve(__dirname, '../scripts/local-config.example.json');

function authHeaders(token) {
  return { 'content-type': 'application/json', [PAIRING_HEADER]: token };
}

async function closeServer(handle) {
  await new Promise((res) => handle.server.close(() => res()));
}

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
