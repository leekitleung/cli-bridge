// v2.14 ADR-0019-a: contained git status reader.
// child_process.spawn with shell:false, cwd solely from projectWorkspaceRoots[key],
// read-only git commands only, minimal env allowlist, timeout/kill, output cap + discard.
// No network, no credentials, no git writes, no baselineRoot fallback.
// Git status is context only — never pass/fail.

import { spawn, type ChildProcess } from 'node:child_process';
import type { GitStatusView } from '../../../../packages/shared/src/types.ts';

// ── Types ────────────────────────────────────────────────────────

export type GitSpawnFn = (
  file: string,
  args: string[],
  opts: { cwd: string; env: Record<string, string>; timeoutMs: number; outputCapBytes: number },
) => Promise<{
  ok: boolean;
  exitCode: number | null;
  signal: string | null;
  stdoutChunks: Buffer[];
  stderrChunks: Buffer[];
  error?: string;
}>;

export interface GitReaderOptions {
  projectKey: string;
  workspaceRoot: string;
  /** Inject a fake spawn for tests. */
  spawnFn?: GitSpawnFn;
}

export interface GitReaderResult {
  /** Sanitized view. Always present (fail-closed: isGitRepo:false, available:false). */
  view: GitStatusView;
  /** Elapsed time in ms. */
  elapsedMs: number;
  /** True if any spawn/parse error occurred (fail-closed). */
  error?: string;
}

// ── Caps & Env ───────────────────────────────────────────────────

const GIT_TIMEOUT_MS = 15_000;
const GIT_OUTPUT_CAP_BYTES = 64_000;

/** Minimal env for git child — no host env inheritance, plus defense-in-depth. */
function buildGitEnv(): Record<string, string> {
  return {
    PATH: process.env.PATH ?? '/usr/bin:/bin:/usr/local/bin',
    HOME: process.env.HOME ?? process.env.USERPROFILE ?? '',
    // Prevent git from prompting (never relevant here; stdin is not connected).
    GIT_TERMINAL_PROMPT: '0',
    // Reduce lock contention in shared repos.
    GIT_OPTIONAL_LOCKS: '0',
    // Disable repo-config-driven command execution.
    GIT_CONFIG_NOSYSTEM: '1',
  };
}

// ── Git command args ──────────────────────────────────────────────

/** Read-only git args — never mutagenic, never networked. */
const GIT_IS_REPO_ARGS = ['-c', 'core.fsmonitor=', '-c', 'core.hooksPath=', 'rev-parse', '--is-inside-work-tree'];
const GIT_BRANCH_ARGS = ['-c', 'core.fsmonitor=', '-c', 'core.hooksPath=', 'branch', '--show-current'];
const GIT_STATUS_ARGS = ['-c', 'core.fsmonitor=', '-c', 'core.hooksPath=', 'status', '--porcelain'];
// rev-list with @{u}HEAD — purely local; no network.
const GIT_AHEAD_BEHIND_ARGS = ['-c', 'core.fsmonitor=', '-c', 'core.hooksPath=', 'rev-list', '--left-right', '--count', '@{u}...HEAD'];

// ── Parsers ──────────────────────────────────────────────────────

function sanitizeBranch(raw: string): string | null {
  const trimmed = (raw ?? '').split('\n')[0].trim();
  // sanitize: reject empty, control chars, over-length, or obviously non-branch.
  if (trimmed.length === 0 || trimmed.length > 256) return null;
  if (/[\x00-\x1f\x7f]/.test(trimmed)) return null;
  return trimmed;
}

function isGitRepo(output: string): boolean {
  return output.trim() === 'true';
}

function isDirty(output: string): boolean {
  return output.trim().length > 0;
}

function parseAheadBehind(output: string): { ahead: number | null; behind: number | null } {
  const trimmed = output.trim();
  if (!trimmed) return { ahead: null, behind: null };
  // Format: "1\t0" (ahead\tbehind) or "0\t2"
  const parts = trimmed.split('\t');
  if (parts.length !== 2) return { ahead: null, behind: null };
  const a = Number(parts[0]);
  const b = Number(parts[1]);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return { ahead: null, behind: null };
  return { ahead: a, behind: b };
}

// ── Decode output ─────────────────────────────────────────────────

function decodeOutput(chunks: Buffer[]): string {
  if (chunks.length === 0) return '';
  return Buffer.concat(chunks).toString('utf8').slice(0, GIT_OUTPUT_CAP_BYTES);
}

// ── Reader ────────────────────────────────────────────────────────

export async function readGitStatus(opts: GitReaderOptions): Promise<GitReaderResult> {
  const { projectKey, workspaceRoot, spawnFn } = opts;
  const startedAt = Date.now();

  const cwd = workspaceRoot;
  const env = buildGitEnv();
  const effectiveSpawn: GitSpawnFn = spawnFn ?? ((f, a, o) => defaultGitSpawn(f, a, o));

  const failView = (): GitStatusView => ({
    branch: null,
    dirty: false,
    aheadCount: null,
    behindCount: null,
    isGitRepo: false,
    fetchedAt: startedAt,
    available: false,
  });

  // ── Step 1: is inside a git work-tree? ──────────────────────────

  let isRepoResult: Awaited<ReturnType<GitSpawnFn>>;
  try {
    isRepoResult = await effectiveSpawn('git', GIT_IS_REPO_ARGS, {
      cwd,
      env,
      timeoutMs: GIT_TIMEOUT_MS,
      outputCapBytes: GIT_OUTPUT_CAP_BYTES,
    });
  } catch {
    return {
      view: failView(),
      elapsedMs: Date.now() - startedAt,
      error: 'spawn error: git rev-parse',
    };
  }

  if (isRepoResult.error && isRepoResult.signal === null) {
    // Git binary not found or path error → unavailable.
    return {
      view: failView(),
      elapsedMs: Date.now() - startedAt,
      error: isRepoResult.error,
    };
  }

  if (isRepoResult.error) {
    // Timeout or other spawn error → unavailable.
    return {
      view: failView(),
      elapsedMs: Date.now() - startedAt,
      error: isRepoResult.error,
    };
  }

  const isRepoOutput = decodeOutput(isRepoResult.stdoutChunks);
  if (!isGitRepo(isRepoOutput)) {
    // Not a git repository.
    const view: GitStatusView = {
      branch: null,
      dirty: false,
      aheadCount: null,
      behindCount: null,
      isGitRepo: false,
      fetchedAt: startedAt,
      available: true,
    };
    return { view, elapsedMs: Date.now() - startedAt };
  }

  // ── Step 2: read branch, dirty, ahead/behind in parallel ────────

  const [branchResult, statusResult, abResult] = await Promise.allSettled([
    safeSpawn(effectiveSpawn, 'git', GIT_BRANCH_ARGS, cwd, env),
    safeSpawn(effectiveSpawn, 'git', GIT_STATUS_ARGS, cwd, env),
    safeSpawn(effectiveSpawn, 'git', GIT_AHEAD_BEHIND_ARGS, cwd, env),
  ]);

  const branch = branchResult.status === 'fulfilled' && branchResult.value.ok
    ? sanitizeBranch(decodeOutput(branchResult.value.stdoutChunks))
    : null;

  const dirty = statusResult.status === 'fulfilled' && statusResult.value.ok
    ? isDirty(decodeOutput(statusResult.value.stdoutChunks))
    : false;

  const ab = abResult.status === 'fulfilled' && abResult.value.ok
    ? parseAheadBehind(decodeOutput(abResult.value.stdoutChunks))
    : { ahead: null, behind: null };

  const view: GitStatusView = {
    branch,
    dirty,
    aheadCount: ab.ahead,
    behindCount: ab.behind,
    isGitRepo: true,
    fetchedAt: startedAt,
    available: true,
  };

  return { view, elapsedMs: Date.now() - startedAt };
}

// ── Safe spawn wrapper ────────────────────────────────────────────

async function safeSpawn(
  spawnFn: GitSpawnFn,
  file: string,
  args: string[],
  cwd: string,
  env: Record<string, string>,
): Promise<Awaited<ReturnType<GitSpawnFn>>> {
  try {
    return await spawnFn(file, args, {
      cwd,
      env,
      timeoutMs: GIT_TIMEOUT_MS,
      outputCapBytes: GIT_OUTPUT_CAP_BYTES,
    });
  } catch {
    return { ok: false, exitCode: null, signal: null, stdoutChunks: [], stderrChunks: [], error: 'spawn rejected' };
  }
}

// ── Default spawn ─────────────────────────────────────────────────

async function defaultGitSpawn(
  file: string,
  args: string[],
  opts: { cwd: string; env: Record<string, string>; timeoutMs: number; outputCapBytes: number },
): ReturnType<GitSpawnFn> {
  return new Promise((resolve) => {
    const proc: ChildProcess = spawn(file, args, {
      shell: false,
      cwd: opts.cwd,
      env: opts.env,
      stdio: 'pipe',
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let settled = false;

    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        try { proc.kill('SIGTERM'); } catch { /* ignore */ }
        resolve({ ok: false, exitCode: null, signal: 'SIGTERM', stdoutChunks, stderrChunks, error: 'timeout' });
      }
    }, opts.timeoutMs);

    let capped = false;
    proc.stdout?.on('data', (chunk: Buffer) => {
      if (!capped) {
        stdoutChunks.push(chunk);
        if (stdoutChunks.reduce((s, c) => s + c.byteLength, 0) + stderrChunks.reduce((s, c) => s + c.byteLength, 0) > opts.outputCapBytes) capped = true;
      }
    });
    proc.stderr?.on('data', (chunk: Buffer) => {
      if (!capped) {
        stderrChunks.push(chunk);
        if (stdoutChunks.reduce((s, c) => s + c.byteLength, 0) + stderrChunks.reduce((s, c) => s + c.byteLength, 0) > opts.outputCapBytes) capped = true;
      }
    });

    proc.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({ ok: false, exitCode: null, signal: null, stdoutChunks, stderrChunks, error: err.message });
    });

    proc.on('close', (exitCode, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({ ok: exitCode === 0, exitCode, signal, stdoutChunks, stderrChunks });
    });
  });
}
