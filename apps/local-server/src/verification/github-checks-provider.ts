// v2.14 ADR-0019-b — Read-only GitHub check-runs status provider.
//
// Single provider family (GitHub-compatible), single read-only endpoint:
// GET {apiBaseUrl}/repos/{owner}/{repo}/commits/{ref}/check-runs
// (Accept: application/vnd.github+json).
//
// Hard constraints:
// - HTTPS only + standard platform certificate validation (no insecure agent).
// - owner/repo MUST match ^[A-Za-z0-9._-]+$ (fail-closed 409).
// - ref MUST be non-empty, no control chars, no .. , inserted as single encodeURIComponent segment.
// - AbortController timeout ≤10s.
// - Response body size cap.
// - No cross-host redirect (3xx to different host → error).
// - ≤1 retry on transient 5xx/network error.
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

function buildUrl(config: GithubChecksProviderConfig, ref: string): string | null {
  // Validate operator-configured fields.
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

// ── Parsing / mapping ─────────────────────────────────────────────

function mapConclusionToResult(checkRuns: GithubCheckRun[]): { result: VerificationResult; summary: string | null } {
  if (!checkRuns || checkRuns.length === 0) {
    return { result: 'unknown', summary: 'no check runs' };
  }

  const conclusions = checkRuns.map(r => r.conclusion);

  // Any failure/timed_out/cancelled/action_required/stale → failed.
  const failedConclusions = ['failure', 'timed_out', 'cancelled', 'action_required', 'stale'];
  if (conclusions.some(c => c && failedConclusions.includes(c))) {
    return { result: 'failed', summary: 'check run(s) failed' };
  }

  // Any queued/in_progress/null → unknown (still running).
  const pendingConclusions = ['queued', 'in_progress', null, undefined];
  if (conclusions.some(c => pendingConclusions.includes(c as string | null | undefined))) {
    return { result: 'unknown', summary: 'check runs still in progress' };
  }

  // ≥1 success → passed.
  if (conclusions.includes('success')) {
    return { result: 'passed', summary: 'check runs passed' };
  }

  // All skipped/neutral, no success → skipped.
  if (conclusions.every(c => c === 'skipped' || c === 'neutral')) {
    return { result: 'skipped', summary: 'all check runs skipped' };
  }

  return { result: 'unknown', summary: 'unexpected check run state' };
}

// ── Bounded body read ─────────────────────────────────────────────
// Reads at most `cap` bytes from a streaming response body and stops (cancels)
// once exceeded — a real containment limit. Oversized → rejected, never parsed.
// Falls back to text() only for injected test doubles lacking a stream body,
// and still rejects (does not silently truncate) when over the cap.

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

  // Fallback for injected test doubles without a streaming body.
  if (typeof response.text === 'function') {
    const text = await response.text();
    if (text.length > cap) return { ok: false, error: 'response too large' };
    return { ok: true, text };
  }

  return { ok: false, error: 'no readable body' };
}

// ── Safe fetch ────────────────────────────────────────────────────

async function safeFetchJson(
  url: string,
  token: string,
  fetchFn: typeof fetch,
  baseUrl: string,
): Promise<GithubChecksFetchResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), GITHUB_TIMEOUT_MS);

  try {
    const response = await fetchFn(url, {
      method: 'GET',
      headers: {
        'Accept': ACCEPT_HEADER,
        'Authorization': `Bearer ${token}`,
      },
      signal: controller.signal,
      redirect: 'manual', // No cross-host redirect
    });

    // Check for redirect
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (location) {
        try {
          const redirectUrl = new URL(location);
          const baseHost = new URL(baseUrl).host;
          if (redirectUrl.host !== baseHost) {
            return { ok: false, status: response.status, data: null, error: 'cross-host redirect rejected' };
          }
        } catch {
          return { ok: false, status: response.status, data: null, error: 'invalid redirect location' };
        }
      }
    }

    if (!response.ok) {
      return { ok: false, status: response.status, data: null, error: `HTTP ${response.status}` };
    }

    // Bounded body read — never buffer more than the cap. This is a real
    // containment limit (stop reading at the cap), not post-hoc truncation of
    // an already fully-read body.
    const bodyRead = await readCappedBody(response, GITHUB_BODY_CAP_BYTES);
    if (!bodyRead.ok) {
      return { ok: false, status: response.status, data: null, error: bodyRead.error };
    }

    let data: GithubChecksApiResponse;
    try {
      data = JSON.parse(bodyRead.text);
    } catch {
      return { ok: false, status: response.status, data: null, error: 'invalid json response' };
    }

    if (!data || !Array.isArray(data.check_runs)) {
      return { ok: false, status: response.status, data: null, error: 'unexpected response shape' };
    }

    return { ok: true, status: response.status, data };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return { ok: false, status: 0, data: null, error: 'timeout' };
    }
    return { ok: false, status: 0, data: null, error: err instanceof Error ? err.message : 'fetch error' };
  } finally {
    clearTimeout(timeoutId);
  }
}

function isRetryable(error: string | undefined, status: number): boolean {
  if (!error && (status === 0 || status >= 500)) return true;
  // 5xx is always retryable (transient server error), even when error is set.
  if (status >= 500) return true;
  if (error === 'timeout') return true;
  if (error && (error.includes('fetch') || error.includes('network') || error.includes('ECONN'))) return true;
  return false;
}

function redactError(error: string): string {
  // Run through redaction to strip any token-bearing content.
  const result = redactSensitiveContent(error);
  return result.processedContent;
}

// ── Public API ────────────────────────────────────────────────────

export async function fetchGithubChecks(opts: {
  projectKey: string;
  config: GithubChecksProviderConfig;
  token: string;
  ref: string;
  fetchFn?: typeof fetch;
}): Promise<GithubChecksResult> {
  const { projectKey, config, token, ref } = opts;
  const startedAt = Date.now();
  const effectiveFetch = opts.fetchFn ?? fetch;

  // Config validation
  if (!config.apiBaseUrl || !config.apiBaseUrl.startsWith('https://')) {
    return githubChecksError('invalid apiBaseUrl: HTTPS required', startedAt);
  }

  const url = buildUrl(config, ref);
  if (!url) {
    return githubChecksError('invalid path: owner/repo/ref validation failed', startedAt);
  }

  // Single-run lock
  if (inFlight.has(projectKey)) {
    return githubChecksError('another fetch in progress', startedAt);
  }
  inFlight.add(projectKey);
  try {
    let result = await safeFetchJson(url, token, effectiveFetch, config.apiBaseUrl);

    // ≤1 retry on transient errors
    let retries = 0;
    while (!result.ok && isRetryable(result.error, result.status) && retries < MAX_RETRIES) {
      retries++;
      result = await safeFetchJson(url, token, effectiveFetch, config.apiBaseUrl);
    }

    if (!result.ok || !result.data) {
      const mapped = mapNonOkStatus(result.status, result.error);
      return {
        view: {
          result: mapped.result,
          conclusionSummary: mapped.summary,
          checkRunCount: 0,
          fetchedAt: startedAt,
          available: false,
          elapsedMs: Date.now() - startedAt,
          commandLabel: 'github-checks',
        },
        elapsedMs: Date.now() - startedAt,
        error: redactError(result.error ?? 'unknown error'),
      };
    }

    const { result: vr, summary } = mapConclusionToResult(result.data.check_runs);

    return {
      view: {
        result: vr,
        conclusionSummary: summary,
        checkRunCount: result.data.total_count,
        fetchedAt: startedAt,
        available: true,
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

function mapNonOkStatus(status: number, error?: string): { result: VerificationResult; summary: string | null } {
  // 401/403 → errored (auth)
  if (status === 401 || status === 403) return { result: 'errored', summary: `auth error (${status})` };
  // 404/422 → unknown (not found / invalid ref)
  if (status === 404 || status === 422) return { result: 'unknown', summary: `not found (${status})` };
  // 429 rate limit → errored
  if (status === 429) return { result: 'errored', summary: 'rate limited' };
  // timeout / network → errored
  if (error === 'timeout' || status === 0) return { result: 'errored', summary: 'network error or timeout' };
  return { result: 'errored', summary: error ?? `http ${status}` };
}
