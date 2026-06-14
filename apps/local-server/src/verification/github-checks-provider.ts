// v2.14 ADR-0019-b + v2.17 ADR-0022 — Read-only GitHub commit-status provider.
//
// Two read-only endpoints under the same provider family (GitHub-compatible):
// 1. GET /repos/{owner}/{repo}/commits/{ref}/check-runs (v2.14)
// 2. GET /repos/{owner}/{repo}/commits/{ref}/status   (v2.17)
//
// Both sources are normalized to a closed signal set and merged via the
// ADR-0022 ladder into one typed VerificationResult.
//
// Hard constraints (both calls):
// - HTTPS only + standard platform certificate validation (no insecure agent).
// - owner/repo MUST match ^[A-Za-z0-9._-]+$ (fail-closed).
// - ref MUST be non-empty, no control chars, no .. , inserted as single encodeURIComponent segment.
// - AbortController timeout ≤10s.
// - Response body size cap.
// - No cross-host redirect (3xx to different host → error).
// - ≤1 retry per call on transient 5xx/network error.
// - Injectable fetchFn for tests (never hits real network in tests).
// - Token from memory-only store, NEVER persisted/audited/echoed.
// - Redacted error/timeout surfaces — no Authorization header value, no token-bearing URL.

import type { VerificationResult } from '../../../../packages/shared/src/types.ts';
import type { GithubChecksProviderConfig } from '../../../../packages/shared/src/types.ts';
import { redactSensitiveContent } from '../security/redaction.ts';

// ── Types ────────────────────────────────────────────────────────

export interface GithubCheckRun {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
}

export interface GithubChecksApiResponse {
  total_count: number;
  check_runs: GithubCheckRun[];
}

export interface GithubStatusApiResponse {
  state: string;
  total_count: number;
}

export interface GithubChecksFetchResult {
  ok: boolean;
  status: number;
  data: GithubChecksApiResponse | null;
  error?: string;
}

export interface GithubChecksResult {
  view: import('../../../../packages/shared/src/types.ts').GithubChecksView;
  elapsedMs: number;
  error?: string;
}

// ── Source signal (closed enum) ───────────────────────────────────

type SourceSignal = 'failed' | 'errored' | 'pending' | 'passed' | 'skipped' | 'none';

// ── Constants ─────────────────────────────────────────────────────

const GITHUB_TIMEOUT_MS = 10_000;
const GITHUB_BODY_CAP_BYTES = 256_000;
const MAX_RETRIES = 1;
const OWNER_REPO_RE = /^[A-Za-z0-9._-]+$/;
const ACCEPT_HEADER = 'application/vnd.github+json';

// ── In-flight lock per project ────────────────────────────────────

const inFlight = new Set<string>();

// ── Path containment ──────────────────────────────────────────────

function validateOwnerRepo(value: string, field: string): string | null {
  if (!OWNER_REPO_RE.test(value)) return `invalid ${field}: must match ^[A-Za-z0-9._-]+$`;
  return null;
}

function validateRef(ref: string): string | null {
  if (!ref || ref.trim().length === 0) return 'invalid ref: empty';
  if (/[\x00-\x1f\x7f]/.test(ref)) return 'invalid ref: control characters';
  if (ref.includes('..')) return 'invalid ref: path traversal';
  return null;
}

function buildCheckRunsUrl(config: GithubChecksProviderConfig, ref: string): string | null {
  if (!config.apiBaseUrl.startsWith('https://')) return null; // HTTPS-only
  const ownerErr = validateOwnerRepo(config.owner, 'owner');
  if (ownerErr) return null;
  const repoErr = validateOwnerRepo(config.repo, 'repo');
  if (repoErr) return null;
  const refErr = validateRef(ref);
  if (refErr) return null;

  const base = config.apiBaseUrl.replace(/\/$/, '');
  const encodedRef = encodeURIComponent(ref);
  return `${base}/repos/${config.owner}/${config.repo}/commits/${encodedRef}/check-runs`;
}

function buildStatusUrl(config: GithubChecksProviderConfig, ref: string): string | null {
  if (!config.apiBaseUrl.startsWith('https://')) return null;
  const ownerErr = validateOwnerRepo(config.owner, 'owner');
  if (ownerErr) return null;
  const repoErr = validateOwnerRepo(config.repo, 'repo');
  if (repoErr) return null;
  const refErr = validateRef(ref);
  if (refErr) return null;

  const base = config.apiBaseUrl.replace(/\/$/, '');
  const encodedRef = encodeURIComponent(ref);
  return `${base}/repos/${config.owner}/${config.repo}/commits/${encodedRef}/status`;
}

// ── Bounded body read ─────────────────────────────────────────────

async function readCappedBody(
  response: { body?: unknown; text?: () => Promise<string> },
  cap: number,
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const body = response.body as
    | { getReader?: () => { read: () => Promise<{ done: boolean; value?: Uint8Array }>; cancel: () => Promise<void> } }
    | undefined;

  if (body && typeof body.getReader === 'function') {
    const reader = body.getReader();
    const chunks: Buffer[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value && value.byteLength > 0) {
        total += value.byteLength;
        if (total > cap) {
          try { await reader.cancel(); } catch { /* ignore */ }
          return { ok: false, error: 'response too large' };
        }
        chunks.push(Buffer.from(value));
      }
    }
    return { ok: true, text: Buffer.concat(chunks).toString('utf8') };
  }

  if (typeof response.text === 'function') {
    const text = await response.text();
    if (text.length > cap) return { ok: false, error: 'response too large' };
    return { ok: true, text };
  }

  return { ok: false, error: 'no readable body' };
}

// ── Safe fetch (generalized, returns capped text) ─────────────────

async function safeFetchText(
  url: string,
  token: string,
  fetchFn: typeof fetch,
  baseUrl: string,
  timeoutMs: number,
): Promise<{ ok: true; text: string; status: number } | { ok: false; error: string; status: number }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchFn(url, {
      method: 'GET',
      headers: {
        'Accept': ACCEPT_HEADER,
        'Authorization': `Bearer ${token}`,
      },
      signal: controller.signal,
      redirect: 'manual',
    });

    // Check for redirect (timeout still armed).
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (location) {
        try {
          const redirectUrl = new URL(location);
          const baseHost = new URL(baseUrl).host;
          if (redirectUrl.host !== baseHost) {
            return { ok: false, error: 'cross-host redirect rejected', status: response.status };
          }
        } catch {
          return { ok: false, error: 'invalid redirect location', status: response.status };
        }
      }
    }

    if (!response.ok) {
      return { ok: false, error: `HTTP ${response.status}`, status: response.status };
    }

    // The abort timer stays armed through body consumption, so a slow/hung
    // streaming body is bounded by the same timeout. (Regression guard: do NOT
    // clear the timer before reading the body — only in finally.)
    const bodyRead = await readCappedBody(response, GITHUB_BODY_CAP_BYTES);
    if (!bodyRead.ok) {
      return { ok: false, error: bodyRead.error, status: response.status };
    }

    return { ok: true, text: bodyRead.text, status: response.status };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return { ok: false, error: 'timeout', status: 0 };
    }
    return { ok: false, error: err instanceof Error ? err.message : 'fetch error', status: 0 };
  } finally {
    clearTimeout(timeoutId);
  }
}

function isRetryable(error: string, status: number): boolean {
  if (status >= 500) return true;
  if (status === 0) return true;
  if (error === 'timeout') return true;
  if (error.includes('fetch') || error.includes('network') || error.includes('ECONN')) return true;
  return false;
}

function redactError(error: string): string {
  const result = redactSensitiveContent(error);
  return result.processedContent;
}

// ── Fetch with retry ──────────────────────────────────────────────

async function safeFetchWithRetry(
  url: string,
  token: string,
  fetchFn: typeof fetch,
  baseUrl: string,
  timeoutMs: number,
): Promise<{ ok: true; text: string; status: number } | { ok: false; error: string; status: number }> {
  let result = await safeFetchText(url, token, fetchFn, baseUrl, timeoutMs);
  let retries = 0;
  while (!result.ok && isRetryable(result.error, result.status) && retries < MAX_RETRIES) {
    retries++;
    result = await safeFetchText(url, token, fetchFn, baseUrl, timeoutMs);
  }
  return result;
}

// ── Source signal mapping ─────────────────────────────────────────

function checkRunsSignal(
  fetchResult: { ok: boolean; error: string; status: number },
  data: GithubChecksApiResponse | null,
): SourceSignal {
  if (!fetchResult.ok) {
    if (fetchResult.status === 404 || fetchResult.status === 422) return 'none';
    return 'errored';
  }

  if (!data || !Array.isArray(data.check_runs)) return 'errored';
  const runs = data.check_runs;
  if (runs.length === 0) return 'none';

  const conclusions = runs.map(r => r.conclusion);
  const failedSet = new Set(['failure', 'timed_out', 'cancelled', 'action_required', 'stale']);
  if (conclusions.some(c => c && failedSet.has(c))) return 'failed';

  const pendingSet = new Set(['queued', 'in_progress', null, undefined]);
  if (conclusions.some(c => pendingSet.has(c as string | null | undefined))) return 'pending';

  if (conclusions.includes('success')) return 'passed';

  if (conclusions.every(c => c === 'skipped' || c === 'neutral')) return 'skipped';

  return 'none';
}

function statusSignal(
  fetchResult: { ok: boolean; error: string; status: number },
  data: GithubStatusApiResponse | null,
): SourceSignal {
  if (!fetchResult.ok) {
    if (fetchResult.status === 404 || fetchResult.status === 422) return 'none';
    return 'errored';
  }

  if (!data) return 'errored';

  const state = data.state;
  const total = data.total_count;

  if (state === 'failure') return 'failed';
  if (state === 'success') return 'passed';
  if (state === 'pending') {
    if (total === 0) return 'none';
    return 'pending';
  }

  // Unknown / empty / missing state → none (fail-closed).
  return 'none';
}

// ── Merge ladder (ADR-0022) ───────────────────────────────────────

function mergeLadder(cr: SourceSignal, st: SourceSignal): { result: VerificationResult; summary: string } {
  // 1. failed
  if (cr === 'failed' || st === 'failed') return { result: 'failed', summary: 'check(s) failed' };
  // 2. errored
  if (cr === 'errored' || st === 'errored') return { result: 'errored', summary: 'source error' };
  // 3. pending
  if (cr === 'pending' || st === 'pending') return { result: 'unknown', summary: 'checks still pending' };
  // 4. passed
  if (cr === 'passed' || st === 'passed') return { result: 'passed', summary: 'checks passed' };
  // 5. skipped
  if (cr === 'skipped' || st === 'skipped') return { result: 'skipped', summary: 'checks skipped' };
  // 6. both none
  return { result: 'unknown', summary: 'no check data available' };
}

// ── Public API ────────────────────────────────────────────────────

export async function fetchGithubChecks(opts: {
  projectKey: string;
  config: GithubChecksProviderConfig;
  token: string;
  ref: string;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}): Promise<GithubChecksResult> {
  const { projectKey, config, token, ref } = opts;
  const startedAt = Date.now();
  const effectiveFetch = opts.fetchFn ?? fetch;
  const effectiveTimeout = opts.timeoutMs ?? GITHUB_TIMEOUT_MS;

  // Config validation
  if (!config.apiBaseUrl || !config.apiBaseUrl.startsWith('https://')) {
    return githubChecksError('invalid apiBaseUrl: HTTPS required', startedAt);
  }

  const crUrl = buildCheckRunsUrl(config, ref);
  const stUrl = buildStatusUrl(config, ref);
  if (!crUrl || !stUrl) {
    return githubChecksError('invalid path: owner/repo/ref validation failed', startedAt);
  }

  // Single-run lock
  if (inFlight.has(projectKey)) {
    return githubChecksError('another fetch in progress', startedAt);
  }
  inFlight.add(projectKey);

  try {
    // Fetch both sources sequentially under the lock.
    const crFetch = await safeFetchWithRetry(crUrl, token, effectiveFetch, config.apiBaseUrl, effectiveTimeout);
    const stFetch = await safeFetchWithRetry(stUrl, token, effectiveFetch, config.apiBaseUrl, effectiveTimeout);

    // Parse check-runs.
    let crData: GithubChecksApiResponse | null = null;
    if (crFetch.ok) {
      try {
        const parsed = JSON.parse(crFetch.text);
        if (parsed && Array.isArray(parsed.check_runs)) crData = parsed;
      } catch { /* parse error → crData stays null */ }
    }

    // Parse combined status — only top-level state + total_count.
    let stData: GithubStatusApiResponse | null = null;
    if (stFetch.ok) {
      try {
        const parsed = JSON.parse(stFetch.text);
        // Accept any parseable JSON; missing/unexpected state → empty string (mapped to none).
        stData = { state: typeof parsed.state === 'string' ? parsed.state : '', total_count: typeof parsed.total_count === 'number' ? parsed.total_count : 0 };
      } catch { /* parse error → stData stays null → errored */ }
    }

    const crSignal = checkRunsSignal(
      { ok: crFetch.ok, error: crFetch.ok ? '' : crFetch.error, status: crFetch.status },
      crData,
    );
    const stSignal = statusSignal(
      { ok: stFetch.ok, error: stFetch.ok ? '' : stFetch.error, status: stFetch.status },
      stData,
    );

    const { result, summary } = mergeLadder(crSignal, stSignal);
    const checkRunCount = crData ? crData.total_count : 0;

    return {
      view: {
        result,
        conclusionSummary: summary,
        checkRunCount,
        fetchedAt: startedAt,
        available: crFetch.ok || stFetch.ok,
        elapsedMs: Date.now() - startedAt,
        commandLabel: 'github-checks',
      },
      elapsedMs: Date.now() - startedAt,
    };
  } finally {
    inFlight.delete(projectKey);
  }
}

function githubChecksError(error: string, startedAt: number): GithubChecksResult {
  return {
    view: {
      result: 'errored',
      conclusionSummary: null,
      checkRunCount: 0,
      fetchedAt: startedAt,
      available: false,
      elapsedMs: Date.now() - startedAt,
      commandLabel: 'github-checks',
    },
    elapsedMs: Date.now() - startedAt,
    error: redactError(error),
  };
}
