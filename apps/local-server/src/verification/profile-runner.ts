// v2.13 ADR-0018: contained verification profile runner.
// child_process.spawn with shell:false, cwd containment, env allowlist,
// timeout/kill, output cap + discard, exit-status mapping, single-run lock.
// No git, no network client, no provider integration.

import * as path from 'node:path';
import type { VerifyProfile, VerificationResult, VerificationRunRecord } from '../../../../packages/shared/src/types.ts';
import { runContainedProcess } from '../process/contained-process.ts';

// ── Types ────────────────────────────────────────────────────────

export type SpawnFn = (file: string, args: string[], opts: { cwd: string; env: Record<string, string>; timeoutMs: number; outputCapBytes: number }) => Promise<{
  ok: boolean;
  exitCode: number | null;
  signal: string | null;
  stdoutChunks: Buffer[];
  stderrChunks: Buffer[];
  error?: string;
  truncated?: boolean;
}>;

export interface RunnerOptions {
  profile: VerifyProfile;
  projectKey: string;
  workspaceRoot: string;
  /** Inject a fake spawn for tests. */
  spawnFn?: SpawnFn;
}

export interface RunnerResult {
  ok: boolean;
  record: VerificationRunRecord;
  error?: string;
}

// ── Caps ─────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_CAP_MS = 300_000; // 5 minutes max
const LOCK = new Set<string>();

// ── Helpers ──────────────────────────────────────────────────────

function resolveCwd(root: string, policy?: VerifyProfile['cwdPolicy']): { ok: true; cwd: string } | { ok: false; error: string } {
  if (!policy || policy.kind !== 'project-root') return { ok: true, cwd: root };
  let resolved = root;
  if (policy.subPath) {
    resolved = path.resolve(root, policy.subPath);
    // Containment check: resolved must stay inside root.
    const rootNorm = root.replace(/\\/g, '/');
    const resolvedNorm = resolved.replace(/\\/g, '/');
    if (resolvedNorm !== rootNorm && !resolvedNorm.startsWith(rootNorm + '/')) {
      return { ok: false, error: 'cwd policy subPath escapes project root' };
    }
  }
  return { ok: true, cwd: resolved };
}

function buildEnv(profile: VerifyProfile, procEnv: NodeJS.ProcessEnv): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of profile.env) {
    if (typeof key === 'string' && key.length > 0 && procEnv[key] !== undefined) {
      env[key] = procEnv[key];
    }
  }
  return env;
}

function exitToResult(exitCode: number | null, signal: string | null, spawnError?: string): VerificationResult {
  if (spawnError) return 'errored';
  if (signal !== null) return 'errored';
  if (exitCode === 0) return 'passed';
  if (exitCode !== null && Number.isFinite(exitCode)) return 'failed';
  return 'errored';
}

function sumBytes(chunks: Buffer[]): number {
  let n = 0;
  for (const c of chunks) n += c.byteLength;
  return n;
}

// ── Runner ───────────────────────────────────────────────────────

export async function runVerificationProfile(opts: RunnerOptions): Promise<RunnerResult> {
  const { profile, projectKey, workspaceRoot, spawnFn } = opts;
  const startedAt = Date.now();

  // Lock
  if (LOCK.has(projectKey)) {
    return {
      ok: false,
      record: stubRecord(projectKey, profile, startedAt, 'errored'),
      error: 'Verification already in progress for this project',
    };
  }

  // Cwd containment
  const cwdRes = resolveCwd(workspaceRoot, profile.cwdPolicy);
  if (!cwdRes.ok) {
    return {
      ok: false,
      record: stubRecord(projectKey, profile, startedAt, 'errored'),
      error: cwdRes.error,
    };
  }

  const cwd = cwdRes.cwd;
  const env = buildEnv(profile, process.env);
  const timeoutMs = Math.min(profile.timeoutMs, DEFAULT_TIMEOUT_CAP_MS);
  const capBytes = profile.outputCapBytes;

  LOCK.add(projectKey);

  try {
    const effectiveSpawn: SpawnFn = spawnFn ?? ((f, a, o) => defaultSpawn(f, a, o));
    const spawnResult = await effectiveSpawn(profile.argv[0], profile.argv.slice(1), { cwd, env, timeoutMs, outputCapBytes: capBytes });

    const elapsedMs = Date.now() - startedAt;
    const result = exitToResult(spawnResult.exitCode, spawnResult.signal, spawnResult.error);

    // Cap + discard output (also enforced during collection by defaultSpawn)
    const totalOut = sumBytes(spawnResult.stdoutChunks) + sumBytes(spawnResult.stderrChunks);
    const truncated = spawnResult.truncated === true || totalOut > capBytes;
    const outputDiscarded = true; // always discarded per ADR-0018

    const record: VerificationRunRecord = {
      projectKey,
      profileId: profile.id,
      commandLabel: profile.label,
      result,
      recordedAt: startedAt,
      elapsedMs,
      truncated,
      outputDiscarded,
    };

    const ok = result === 'passed' || result === 'failed';
    return { ok, record };
  } finally {
    LOCK.delete(projectKey);
  }
}

function stubRecord(
  projectKey: string,
  profile: VerifyProfile,
  startedAt: number,
  status: VerificationResult,
): VerificationRunRecord {
  return {
    projectKey,
    profileId: profile.id,
    commandLabel: profile.label,
    result: status,
    recordedAt: startedAt,
    elapsedMs: 0,
    truncated: false,
    outputDiscarded: true,
  };
}

// ── Default spawn ─────────────────────────────────────────────────

async function defaultSpawn(
  file: string,
  args: string[],
  opts: { cwd: string; env: Record<string, string>; timeoutMs: number; outputCapBytes: number },
): ReturnType<SpawnFn> {
  return runContainedProcess(file, args, opts).then((result) => ({
    ok: result.exitCode === 0 && !result.timedOut && !result.error,
    exitCode: result.exitCode,
    signal: result.signal,
    stdoutChunks: result.stdout.length ? [result.stdout] : [],
    stderrChunks: result.stderr.length ? [result.stderr] : [],
    truncated: result.truncated,
    ...(result.timedOut ? { error: 'timeout' } : result.error ? { error: result.error } : {}),
  }));
}
