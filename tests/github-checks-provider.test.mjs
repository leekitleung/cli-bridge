// v2.14 ADR-0019-b + v2.17 ADR-0022: GitHub checks/status provider tests.
// Uses injected fake fetchFn — never hits the real network.
// Verifies: HTTPS-only, TLS, owner/repo whitelist, ref containment,
// mapping, merge ladder, ≤1 retry, no-cross-host redirect, single-run lock,
// token redaction, fail-closed paths, status endpoint containment.

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

// Unconditional fake fetch — same response for both endpoints.
function fakeFetch(result) {
  const defaultText = JSON.stringify({ total_count: 0, check_runs: [] });
  const bodyText = result.body ?? (result.json ? JSON.stringify(result.json) : defaultText);
  return async (url, init) => ({
    ok: result.ok ?? true,
    status: result.status ?? 200,
    text: async () => bodyText,
    headers: { get: (name) => result.headers?.[name?.toLowerCase()] ?? null },
  });
}

// Check-runs only helper: maps to okFetch for backward-compat tests.
function okFetch(checkRuns) {
  return fakeFetch({
    ok: true, status: 200,
    json: { total_count: checkRuns.length, check_runs: checkRuns ?? [] },
  });
}

// Dual-endpoint fake fetch: route-aware, different responses per URL.
function dualFetch(opts) {
  return async (url, init) => {
    const isStatus = url.includes('/status');
    const result = isStatus ? (opts.statusResult ?? {}) : (opts.crResult ?? {});
    const r = typeof result === 'function' ? result() : result;
    const defText = JSON.stringify(isStatus ? { state: 'success', total_count: 0 } : { total_count: 0, check_runs: [] });
    const bodyText = r.body ?? (r.json ? JSON.stringify(r.json) : defText);
    // For retry counting: reset per-call.
    if (isStatus && opts.onStatusCall) opts.onStatusCall(url);
    if (!isStatus && opts.onCrCall) opts.onCrCall(url);
    return {
      ok: r.ok ?? true,
      status: r.status ?? 200,
      text: async () => bodyText,
      headers: { get: (name) => r.headers?.[name?.toLowerCase()] ?? null },
    };
  };
}

// ── v2.14 existing tests (backward compat) ───────────────────────

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
    return { ok: true, status: 200, text: async () => JSON.stringify({ total_count: 0, check_runs: [] }), headers: { get: () => null } };
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

test('cross-host redirect rejected (check-runs)', async () => {
  const result = await fetchGithubChecks({
    projectKey: 'test',
    config: CONFIG,
    token: 'ghp_test',
    ref: 'main',
    fetchFn: fakeFetch({ ok: false, status: 302, headers: { location: 'https://evil.com/check-runs' } }),
  });
  // Both calls get the same fake with 302 → both errored → result errored.
  assert.equal(result.view.result, 'errored');
});

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
  // Both sources return none → unknown.
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

test('401 → errored, no token leak in error', async () => {
  const result = await fetchGithubChecks({
    projectKey: 'test',
    config: CONFIG,
    token: 'ghp_SECRET_TOKEN_1234567890abcdef',
    ref: 'main',
    fetchFn: fakeFetch({ ok: false, status: 401 }),
  });
  assert.equal(result.view.result, 'errored');
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

test('transient 5xx retries once per call, then errored', async () => {
  let crCount = 0; let stCount = 0;
  const result = await fetchGithubChecks({
    projectKey: 'test',
    config: CONFIG,
    token: 'ghp_test',
    ref: 'main',
    fetchFn: async (url, init) => {
      if (url.endsWith('/check-runs')) crCount++;
      else if (url.endsWith('/status')) stCount++;
      return { ok: false, status: 500, text: async () => '', headers: { get: () => null } };
    },
  });
  // ≤1 retry per call: each endpoint = 1 initial + 1 retry = exactly 2; total 4.
  assert.equal(crCount, 2, `check-runs must be exactly 2 calls, got ${crCount}`);
  assert.equal(stCount, 2, `status must be exactly 2 calls, got ${stCount}`);
  assert.equal(crCount + stCount, 4, 'no retry storm: total exactly 4');
  assert.equal(result.view.result, 'errored');
});

test('timeout spans body consumption (hung streaming body is aborted)', async () => {
  // A response whose body stream never resolves unless the abort signal fires.
  // With the abort timer armed through body read, a small timeout must abort it.
  let aborted = false;
  const hangingBodyFetch = async (url, init) => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    body: {
      getReader: () => ({
        read: () => new Promise((resolve, reject) => {
          if (init && init.signal) {
            init.signal.addEventListener('abort', () => {
              aborted = true;
              reject(new DOMException('aborted', 'AbortError'));
            });
          }
          // otherwise never resolves
        }),
        cancel: async () => {},
      }),
    },
    text: async () => { throw new Error('should not use text() on stream path'); },
  });

  const start = Date.now();
  const result = await fetchGithubChecks({
    projectKey: 'timeout-test',
    config: CONFIG,
    token: 'ghp_test',
    ref: 'main',
    fetchFn: hangingBodyFetch,
    timeoutMs: 50,
  });
  const elapsed = Date.now() - start;

  assert.equal(aborted, true, 'abort signal must fire during body read');
  assert.equal(result.view.available, false, 'hung body → unavailable');
  assert.equal(result.view.result, 'errored', 'hung body → errored (timeout)');
  // Bounded: returned well under the default 10s, proving the timer spans body read.
  assert.ok(elapsed < 5000, `must abort near the injected timeout, took ${elapsed}ms`);
});

test('response view never contains raw payload', async () => {
  const result = await fetchGithubChecks({
    projectKey: 'test',
    config: CONFIG,
    token: 'ghp_test',
    ref: 'main',
    fetchFn: okFetch([{ id: 1, name: 'ci', status: 'completed', conclusion: 'success' }]),
  });
  const viewJson = JSON.stringify(result.view);
  assert.equal(viewJson.includes('statuses'), false, 'no statuses array');
  assert.equal(viewJson.includes('sha256'), false, 'no hash');
  assert.equal(viewJson.includes('token'), false, 'no token');
  assert.equal(viewJson.includes('Bearer'), false, 'no Bearer');
  assert.equal(viewJson.includes('Authorization'), false, 'no Authorization');
});

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
});

test('fetchFn is injected, not global fetch', async () => {
  let injectedUsed = false;
  await fetchGithubChecks({
    projectKey: 'test',
    config: CONFIG,
    token: 'ghp_test',
    ref: 'main',
    fetchFn: async () => {
      injectedUsed = true;
      return { ok: true, status: 200, text: async () => JSON.stringify({ total_count: 0, check_runs: [] }), headers: { get: () => null } };
    },
  });
  assert.ok(injectedUsed, 'injected fetchFn must be called');
});

test('token is not present in request URLs', async () => {
  const urls = [];
  await fetchGithubChecks({
    projectKey: 'test',
    config: CONFIG,
    token: 'ghp_test1234567890',
    ref: 'main',
    fetchFn: async (url, init) => {
      urls.push(url);
      return { ok: true, status: 200, text: async () => JSON.stringify({ total_count: 0, check_runs: [] }), headers: { get: () => null } };
    },
  });
  for (const u of urls) {
    assert.equal(u.includes('ghp_test'), false, 'token must not be in URL');
    assert.equal(u.includes('1234567890'), false, 'token must not be in URL');
  }
});

// ── v2.17 ADR-0022: Combined status tests ──────────────────────

// 1. Status-only success: zero check-runs + status success → passed.

test('v2.17: zero check-runs + status success → passed', async () => {
  const result = await fetchGithubChecks({
    projectKey: 'test', config: CONFIG, token: 'ghp_test', ref: 'main',
    fetchFn: dualFetch({
      crResult: { ok: true, status: 200, json: { total_count: 0, check_runs: [] } },
      statusResult: { ok: true, status: 200, json: { state: 'success', total_count: 1 } },
    }),
  });
  assert.equal(result.view.result, 'passed');
});

// 2. Check-runs pending + status success → unknown.

test('v2.17: cr pending + st success → unknown', async () => {
  const result = await fetchGithubChecks({
    projectKey: 'test', config: CONFIG, token: 'ghp_test', ref: 'main',
    fetchFn: dualFetch({
      crResult: { ok: true, status: 200, json: { total_count: 1, check_runs: [{ id: 1, name: 'ci', status: 'queued', conclusion: null }] } },
      statusResult: { ok: true, status: 200, json: { state: 'success', total_count: 2 } },
    }),
  });
  assert.equal(result.view.result, 'unknown');
});

// 3. Status pending,total_count:0 → none fallback.

test('v2.17: st pending total_count=0 → none, depends on cr', async () => {
  const result = await fetchGithubChecks({
    projectKey: 'test', config: CONFIG, token: 'ghp_test', ref: 'main',
    fetchFn: dualFetch({
      crResult: { ok: true, status: 200, json: { total_count: 1, check_runs: [{ id: 1, name: 'ci', status: 'completed', conclusion: 'success' }] } },
      statusResult: { ok: true, status: 200, json: { state: 'pending', total_count: 0 } },
    }),
  });
  assert.equal(result.view.result, 'passed');
});

// 4. Status pending,total_count>0 → unknown.

test('v2.17: st pending total_count>0 → unknown', async () => {
  const result = await fetchGithubChecks({
    projectKey: 'test', config: CONFIG, token: 'ghp_test', ref: 'main',
    fetchFn: dualFetch({
      crResult: { ok: true, status: 200, json: { total_count: 0, check_runs: [] } },
      statusResult: { ok: true, status: 200, json: { state: 'pending', total_count: 3 } },
    }),
  });
  assert.equal(result.view.result, 'unknown');
});

// 5. Check-runs failed + status success → failed.

test('v2.17: cr failed + st success → failed', async () => {
  const result = await fetchGithubChecks({
    projectKey: 'test', config: CONFIG, token: 'ghp_test', ref: 'main',
    fetchFn: dualFetch({
      crResult: { ok: true, status: 200, json: { total_count: 1, check_runs: [{ id: 1, name: 'ci', status: 'completed', conclusion: 'failure' }] } },
      statusResult: { ok: true, status: 200, json: { state: 'success', total_count: 2 } },
    }),
  });
  assert.equal(result.view.result, 'failed');
});

// 6. One source errored + other passed → errored.

test('v2.17: cr errored + st passed → errored', async () => {
  const result = await fetchGithubChecks({
    projectKey: 'test', config: CONFIG, token: 'ghp_test', ref: 'main',
    fetchFn: dualFetch({
      crResult: { ok: false, status: 401 },
      statusResult: { ok: true, status: 200, json: { state: 'success', total_count: 1 } },
    }),
  });
  assert.equal(result.view.result, 'errored');
});

// 7. Both none → unknown.

test('v2.17: cr none + st none → unknown', async () => {
  const result = await fetchGithubChecks({
    projectKey: 'test', config: CONFIG, token: 'ghp_test', ref: 'main',
    fetchFn: dualFetch({
      crResult: { ok: true, status: 200, json: { total_count: 0, check_runs: [] } },
      statusResult: { ok: false, status: 404 },
    }),
  });
  assert.equal(result.view.result, 'unknown');
});

// 8. Status 404/422 → none, not failure.

test('v2.17: st 404 → none', async () => {
  const result = await fetchGithubChecks({
    projectKey: 'test', config: CONFIG, token: 'ghp_test', ref: 'main',
    fetchFn: dualFetch({
      crResult: { ok: true, status: 200, json: { total_count: 1, check_runs: [{ id: 1, name: 'ci', status: 'completed', conclusion: 'success' }] } },
      statusResult: { ok: false, status: 404 },
    }),
  });
  assert.equal(result.view.result, 'passed');
});

test('v2.17: st 422 → none', async () => {
  const result = await fetchGithubChecks({
    projectKey: 'test', config: CONFIG, token: 'ghp_test', ref: 'main',
    fetchFn: dualFetch({
      crResult: { ok: true, status: 200, json: { total_count: 1, check_runs: [{ id: 1, name: 'ci', status: 'completed', conclusion: 'success' }] } },
      statusResult: { ok: false, status: 422 },
    }),
  });
  assert.equal(result.view.result, 'passed');
});

// 9. Status path URL containment.

test('v2.17: status URL uses same containment rules', async () => {
  const urls = [];
  await fetchGithubChecks({
    projectKey: 'test', config: CONFIG, token: 'ghp_test', ref: 'feature/my',
    fetchFn: async (url, init) => {
      urls.push(url);
      return { ok: true, status: 200, text: async () => JSON.stringify({ total_count: 0, check_runs: [] }), headers: { get: () => null } };
    },
  });
  assert.ok(urls.length >= 2, 'both endpoints called');
  const statusUrl = urls.find(u => u.includes('/status'));
  assert.ok(statusUrl, 'status url present');
  assert.ok(statusUrl.includes('commits/feature%2Fmy/status'), 'ref encoded in status URL');
  assert.ok(statusUrl.includes('https://api.github.com/'), 'same host');
});

// 10. Cross-host redirect rejected for status.

test('v2.17: cross-host redirect rejected on status', async () => {
  const result = await fetchGithubChecks({
    projectKey: 'test', config: CONFIG, token: 'ghp_test', ref: 'main',
    fetchFn: dualFetch({
      crResult: { ok: true, status: 200, json: { total_count: 1, check_runs: [{ id: 1, name: 'ci', status: 'completed', conclusion: 'success' }] } },
      statusResult: { ok: false, status: 302, headers: { location: 'https://evil.com/status' } },
    }),
  });
  // cr passed + st cross-host redirect (errored) → errored (ladder step 2).
  assert.equal(result.view.result, 'errored');
});

// 11. Oversized status response fails closed.

test('v2.17: oversized status response → errored', async () => {
  const CAP = 256_000;
  const result = await fetchGithubChecks({
    projectKey: 'test', config: CONFIG, token: 'ghp_test', ref: 'main',
    fetchFn: dualFetch({
      crResult: { ok: true, status: 200, json: { total_count: 0, check_runs: [] } },
      statusResult: { ok: true, status: 200, body: 'x'.repeat(CAP + 1) },
    }),
  });
  assert.equal(result.view.result, 'errored');
});

// 12. Token never appears in response/error/view.

test('v2.17: no token leak in merged result', async () => {
  const result = await fetchGithubChecks({
    projectKey: 'test', config: CONFIG, token: 'ghp_SECRET12345', ref: 'main',
    fetchFn: dualFetch({
      crResult: { ok: false, status: 500 },
      statusResult: { ok: false, status: 500 },
    }),
  });
  const all = JSON.stringify(result);
  assert.equal(all.includes('ghp_SECRET'), false, 'no token in result');
  assert.equal(all.includes('Bearer'), false, 'no Bearer');
  assert.equal(all.includes('Authorization'), false, 'no Authorization');
});

// 13. View shape sanitized — no statuses[], URL, owner/repo, SHA.

test('v2.17: view shape sanitized, no statuses/payload', async () => {
  const result = await fetchGithubChecks({
    projectKey: 'test', config: CONFIG, token: 'ghp_test', ref: 'main',
    fetchFn: dualFetch({
      crResult: { ok: true, status: 200, json: { total_count: 0, check_runs: [] } },
      statusResult: { ok: true, status: 200, json: { state: 'success', total_count: 1 } },
    }),
  });
  const allowed = new Set(['result', 'conclusionSummary', 'checkRunCount', 'fetchedAt', 'available', 'elapsedMs', 'commandLabel']);
  const viewStr = JSON.stringify(result.view);
  for (const key of Object.keys(result.view)) {
    assert.ok(allowed.has(key), `view must not contain '${key}'`);
  }
  assert.equal(result.view.result, 'passed');
  assert.equal(viewStr.includes('state'), false, 'no raw state');
  assert.equal(viewStr.includes('statuses'), false, 'no statuses');
  assert.equal(viewStr.includes('my-org'), false, 'no owner');
  assert.equal(viewStr.includes('my-repo'), false, 'no repo');
});
