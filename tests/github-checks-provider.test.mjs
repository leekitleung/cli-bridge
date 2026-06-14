// v2.14 ADR-0019-b: GitHub checks provider tests.
// Uses injected fake fetchFn — never hits the real network.
// Verifies: HTTPS-only, TLS, owner/repo whitelist, ref containment,
// mapping, ≤1 retry, no-cross-host redirect, single-run lock,
// token redaction, fail-closed paths.

import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchGithubChecks } from '../apps/local-server/src/verification/github-checks-provider.ts';

// ── Helpers ──────────────────────────────────────────────────────

const CONFIG = {
  kind: 'github',
  apiBaseUrl: 'https://api.github.com',
  owner: 'my-org',
  repo: 'my-repo',
};

function fakeFetch(result) {
  const defaultText = JSON.stringify({ total_count: 0, check_runs: [] });
  const bodyText = result.body ?? (result.json ? JSON.stringify(result.json) : defaultText);
  return async (url, init) => {
    return {
      ok: result.ok ?? true,
      status: result.status ?? 200,
      text: async () => bodyText,
      json: async () => result.json ?? { total_count: 0, check_runs: [] },
      headers: {
        get: (name) => result.headers?.[name?.toLowerCase()] ?? null,
      },
    };
  };
}

function okFetch(checkRuns) {
  return fakeFetch({
    ok: true, status: 200,
    json: { total_count: checkRuns.length, check_runs: checkRuns ?? [] },
  });
}

// ── Tests: HTTPS-only / TLS ──────────────────────────────────────

test('non-HTTPS apiBaseUrl rejected', async () => {
  const result = await fetchGithubChecks({
    projectKey: 'test',
    config: { ...CONFIG, apiBaseUrl: 'http://api.github.com' },
    token: 'ghp_test',
    ref: 'main',
    fetchFn: fakeFetch({ ok: true, status: 200 }),
  });
  assert.equal(result.view.available, false);
  assert.equal(result.view.result, 'errored');
});

// ── Tests: owner/repo whitelist ──────────────────────────────────

test('owner with invalid chars rejected', async () => {
  const result = await fetchGithubChecks({
    projectKey: 'test',
    config: { ...CONFIG, owner: 'bad/owner' },
    token: 'ghp_test',
    ref: 'main',
    fetchFn: fakeFetch({ ok: true, status: 200 }),
  });
  assert.equal(result.view.available, false);
  assert.equal(result.view.result, 'errored');
  assert.ok(result.error?.includes('owner') || result.error?.includes('invalid'));
});

test('repo with invalid chars rejected', async () => {
  const result = await fetchGithubChecks({
    projectKey: 'test',
    config: { ...CONFIG, repo: 'bad/repo' },
    token: 'ghp_test',
    ref: 'main',
    fetchFn: fakeFetch({ ok: true, status: 200 }),
  });
  assert.equal(result.view.available, false);
  assert.equal(result.view.result, 'errored');
});

// ── Tests: ref containment ───────────────────────────────────────

test('detached HEAD (empty ref) rejected', async () => {
  const result = await fetchGithubChecks({
    projectKey: 'test',
    config: CONFIG,
    token: 'ghp_test',
    ref: '',
    fetchFn: fakeFetch({ ok: true, status: 200 }),
  });
  assert.equal(result.view.available, false);
});

test('ref with .. rejected', async () => {
  const result = await fetchGithubChecks({
    projectKey: 'test',
    config: CONFIG,
    token: 'ghp_test',
    ref: 'bad/../../../etc',
    fetchFn: fakeFetch({ ok: true, status: 200 }),
  });
  assert.equal(result.view.available, false);
  assert.equal(result.view.result, 'errored');
});

test('ref with control chars rejected', async () => {
  const result = await fetchGithubChecks({
    projectKey: 'test',
    config: CONFIG,
    token: 'ghp_test',
    ref: 'bad\x00branch',
    fetchFn: fakeFetch({ ok: true, status: 200 }),
  });
  assert.equal(result.view.available, false);
});

test('ref is URL-encoded in path', async () => {
  let capturedUrl = null;
  const captureFetch = async (url, init) => {
    capturedUrl = url;
    return { ok: true, status: 200, text: async () => JSON.stringify({ total_count: 0, check_runs: [] }), json: async () => ({ total_count: 0, check_runs: [] }), headers: { get: () => null } };
  };
  await fetchGithubChecks({
    projectKey: 'test',
    config: CONFIG,
    token: 'ghp_test',
    ref: 'feature/my-branch',
    fetchFn: captureFetch,
  });
  assert.ok(capturedUrl.includes('feature%2Fmy-branch'), 'ref must be URL-encoded: ' + capturedUrl);
});

// ── Tests: no cross-host redirect ────────────────────────────────

test('cross-host redirect rejected', async () => {
  const result = await fetchGithubChecks({
    projectKey: 'test',
    config: CONFIG,
    token: 'ghp_test',
    ref: 'main',
    fetchFn: fakeFetch({
      ok: false, status: 302,
      headers: { location: 'https://evil.com/check-runs' },
    }),
  });
  assert.equal(result.view.available, false);
});

// ── Tests: mapping ───────────────────────────────────────────────

test('all success → passed', async () => {
  const result = await fetchGithubChecks({
    projectKey: 'test',
    config: CONFIG,
    token: 'ghp_test',
    ref: 'main',
    fetchFn: okFetch([{ id: 1, name: 'ci', status: 'completed', conclusion: 'success' }]),
  });
  assert.equal(result.view.result, 'passed');
  assert.equal(result.view.available, true);
  assert.equal(result.view.checkRunCount, 1);
});

test('one failure → failed', async () => {
  const result = await fetchGithubChecks({
    projectKey: 'test',
    config: CONFIG,
    token: 'ghp_test',
    ref: 'main',
    fetchFn: okFetch([
      { id: 1, name: 'ci', status: 'completed', conclusion: 'success' },
      { id: 2, name: 'lint', status: 'completed', conclusion: 'failure' },
    ]),
  });
  assert.equal(result.view.result, 'failed');
});

test('in_progress → unknown', async () => {
  const result = await fetchGithubChecks({
    projectKey: 'test',
    config: CONFIG,
    token: 'ghp_test',
    ref: 'main',
    fetchFn: okFetch([{ id: 1, name: 'ci', status: 'in_progress', conclusion: null }]),
  });
  assert.equal(result.view.result, 'unknown');
});

test('no check runs → unknown', async () => {
  const result = await fetchGithubChecks({
    projectKey: 'test',
    config: CONFIG,
    token: 'ghp_test',
    ref: 'main',
    fetchFn: okFetch([]),
  });
  assert.equal(result.view.result, 'unknown');
});

test('all skipped → skipped', async () => {
  const result = await fetchGithubChecks({
    projectKey: 'test',
    config: CONFIG,
    token: 'ghp_test',
    ref: 'main',
    fetchFn: okFetch([{ id: 1, name: 'ci', status: 'completed', conclusion: 'skipped' }]),
  });
  assert.equal(result.view.result, 'skipped');
});

// ── Tests: error paths ───────────────────────────────────────────

test('401 → errored, no token leak in error', async () => {
  const result = await fetchGithubChecks({
    projectKey: 'test',
    config: CONFIG,
    token: 'ghp_SECRET_TOKEN_1234567890abcdef',
    ref: 'main',
    fetchFn: fakeFetch({ ok: false, status: 401 }),
  });
  assert.equal(result.view.result, 'errored');
  assert.equal(result.view.available, false);
  const errorStr = JSON.stringify(result);
  assert.equal(errorStr.includes('SECRET_TOKEN'), false, 'token must not leak in error surface');
});

test('429 rate limit → errored', async () => {
  const result = await fetchGithubChecks({
    projectKey: 'test',
    config: CONFIG,
    token: 'ghp_test',
    ref: 'main',
    fetchFn: fakeFetch({ ok: false, status: 429 }),
  });
  assert.equal(result.view.result, 'errored');
});

// ── Tests: ≤1 retry ──────────────────────────────────────────────

test('transient 5xx retries once, then errored', async () => {
  let callCount = 0;
  const result = await fetchGithubChecks({
    projectKey: 'test',
    config: CONFIG,
    token: 'ghp_test',
    ref: 'main',
    fetchFn: async (url, init) => {
      callCount++;
      return { ok: false, status: 500, text: async () => '', json: async () => null, headers: { get: () => null } };
    },
  });
  assert.equal(callCount, 2, 'should retry exactly once (1 initial + 1 retry)');
  assert.equal(result.view.result, 'errored');
});

// ── Tests: response body cap / no raw payload returned ───────────

test('response view never contains raw payload', async () => {
  const result = await fetchGithubChecks({
    projectKey: 'test',
    config: CONFIG,
    token: 'ghp_test',
    ref: 'main',
    fetchFn: okFetch([{ id: 1, name: 'ci', status: 'completed', conclusion: 'success' }]),
  });
  const viewJson = JSON.stringify(result.view);
  assert.equal(viewJson.includes('raw'), false, 'no raw payload');
  assert.equal(viewJson.includes('sha256'), false, 'no hash');
  assert.equal(viewJson.includes('token'), false, 'no token');
  assert.equal(viewJson.includes('Bearer'), false, 'no Bearer');
  assert.equal(viewJson.includes('Authorization'), false, 'no Authorization');
});

// ── Tests: view fields sanitized ─────────────────────────────────

test('view contains only allowed fields', async () => {
  const result = await fetchGithubChecks({
    projectKey: 'test',
    config: CONFIG,
    token: 'ghp_test',
    ref: 'main',
    fetchFn: okFetch([{ id: 1, name: 'ci', status: 'completed', conclusion: 'success' }]),
  });
  const allowed = new Set(['result', 'conclusionSummary', 'checkRunCount', 'fetchedAt', 'available', 'elapsedMs', 'commandLabel']);
  for (const key of Object.keys(result.view)) {
    assert.ok(allowed.has(key), `view must not contain '${key}'`);
  }
  assert.equal(result.view.commandLabel, 'github-checks');
  assert.equal(typeof result.view.fetchedAt, 'number');
  assert.equal(typeof result.view.elapsedMs, 'number');
});

// ── Tests: no real network (fetchFn injected) ────────────────────

test('fetchFn is injected, not global fetch', async () => {
  let injectedUsed = false;
  const result = await fetchGithubChecks({
    projectKey: 'test',
    config: CONFIG,
    token: 'ghp_test',
    ref: 'main',
    fetchFn: async (url, init) => {
      injectedUsed = true;
      return { ok: true, status: 200, text: async () => JSON.stringify({ total_count: 0, check_runs: [] }), json: async () => ({ total_count: 0, check_runs: [] }), headers: { get: () => null } };
    },
  });
  assert.ok(injectedUsed, 'injected fetchFn must be called');
});

// ── Tests: token never in URL ────────────────────────────────────

test('token is not present in the request URL', async () => {
  let capturedUrl = null;
  const result = await fetchGithubChecks({
    projectKey: 'test',
    config: CONFIG,
    token: 'ghp_test1234567890',
    ref: 'main',
    fetchFn: async (url, init) => {
      capturedUrl = url;
      return { ok: true, status: 200, text: async () => JSON.stringify({ total_count: 0, check_runs: [] }), json: async () => ({ total_count: 0, check_runs: [] }), headers: { get: () => null } };
    },
  });
  assert.equal(capturedUrl.includes('ghp_test'), false, 'token must not be in URL');
  assert.equal(capturedUrl.includes('1234567890'), false, 'token must not be in URL');
});

// ── Tests: real bounded body read (oversized response) ───────────

test('oversized response body is capped by bounded read, rejected (not truncated)', async () => {
  const CHUNK = 64 * 1024;
  const CAP = 256_000;
  let pulledBytes = 0;
  // An effectively unbounded body stream; a true bounded read must cancel it
  // once the cap is exceeded (an unbounded read would never terminate).
  const stream = new ReadableStream({
    pull(controller) {
      pulledBytes += CHUNK;
      controller.enqueue(new Uint8Array(CHUNK).fill(120)); // 'x'
    },
  });
  const fetchFn = async () => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    body: stream,
    // text() must NOT be used when a streaming body exists (would defeat the cap).
    text: async () => { throw new Error('text() must not be called on the stream path'); },
  });

  const result = await fetchGithubChecks({
    projectKey: 'oversized', config: CONFIG, token: 'ghp_test', ref: 'main', fetchFn,
  });

  assert.equal(result.view.available, false, 'oversized → unavailable');
  assert.equal(result.view.result, 'errored', 'oversized → errored, not parsed');
  // Bounded: stopped reading shortly after exceeding the cap, never buffered the
  // whole (unbounded) body.
  assert.ok(pulledBytes <= CAP + 2 * CHUNK, `must stop near cap (pulled ${pulledBytes})`);
  // No token leak in the error surface.
  assert.equal((result.error ?? '').includes('ghp_test'), false, 'no token in error');
});

test('fallback text() path also rejects oversized (no silent truncation)', async () => {
  const CAP = 256_000;
  const fetchFn = async () => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    // no streaming body → fallback path; oversized text must be rejected, not sliced
    text: async () => 'x'.repeat(CAP + 1),
  });
  const result = await fetchGithubChecks({
    projectKey: 'oversized-fallback', config: CONFIG, token: 'ghp_test', ref: 'main', fetchFn,
  });
  assert.equal(result.view.available, false);
  assert.equal(result.view.result, 'errored');
});

test('timeout still applies while reading a streaming body', async () => {
  const realSetTimeout = global.setTimeout;
  try {
    global.setTimeout = (fn, ms, ...args) => realSetTimeout(fn, ms === 10_000 ? 5 : ms, ...args);

    let readCalls = 0;
    let cancelled = false;
    const fetchFn = async (url, init) => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      body: {
        getReader() {
          return {
            read() {
              readCalls++;
              return new Promise((_, reject) => {
                const signal = init.signal;
                if (signal?.aborted) {
                  reject(new DOMException('Aborted', 'AbortError'));
                  return;
                }
                signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
              });
            },
            async cancel() { cancelled = true; },
          };
        },
      },
      text: async () => { throw new Error('text() must not be called on the stream path'); },
    });

    const result = await fetchGithubChecks({
      projectKey: 'timeout-body',
      config: CONFIG,
      token: 'ghp_test',
      ref: 'main',
      fetchFn,
    });

    assert.equal(result.view.available, false);
    assert.equal(result.view.result, 'errored');
    assert.ok(readCalls >= 1, 'stream body was read');
    assert.equal(cancelled, false, 'timeout should abort before explicit cancel is needed');
    assert.equal((result.error ?? '').includes('timeout'), true, 'timeout must surface as timeout');
  } finally {
    global.setTimeout = realSetTimeout;
  }
});
