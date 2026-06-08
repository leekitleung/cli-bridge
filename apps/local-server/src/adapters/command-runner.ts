// Command Transport safety foundation (v1.5b, see ADR-0002 + v1.5b handoff §3/§5/§6).
//
// This module is the single hardened gate through which any local CLI (Codex /
// Claude Code) review-only invocation must pass. It enforces, fail-closed:
//   - a fixed command allowlist (no arbitrary executables);
//   - argv-array execution only (callers never pass a shell string);
//   - rejection of dangerous permission/sandbox-bypass flags;
//   - a hard timeout and an output-size cap.
//
// It deliberately does NOT know about ReviewResult, endpoints, or ChatGPT. Those
// live in the adapters built on top of this gate. Keeping the gate small and
// logic-free makes it auditable.

import {
  spawn,
} from 'node:child_process';

// Only these base commands may ever be executed. The list is fixed in source;
// it is never derived from request input.
export const ALLOWED_COMMANDS = [
  'codex',
  'claude',
] as const;

export type AllowedCommand = typeof ALLOWED_COMMANDS[number];

// Any argv token containing one of these (case-insensitive) is rejected before
// the process is spawned. These are the permission/sandbox-bypass escapes called
// out as hard non-goals in the v1.5b handoff.
export const FORBIDDEN_ARG_PATTERNS = [
  'dangerously-bypass-approvals-and-sandbox',
  'dangerously-bypass-hook-trust',
  'dangerously-skip-permissions',
  'danger-full-access',
  'bypasspermissions',
] as const;

export const DEFAULT_TIMEOUT_MS = 120_000;
export const DEFAULT_MAX_OUTPUT_BYTES = 1_000_000;

export interface CommandExecution {
  command: AllowedCommand;
  args: string[];
  // Optional stdin payload (e.g. the review prompt). Passed to the process via
  // its stdin stream, never interpolated into argv or a shell string.
  stdin?: string;
  // Working directory. Must be an explicit absolute path chosen by the caller,
  // never taken from untrusted request input.
  cwd?: string;
}

export interface CommandRunOptions {
  timeoutMs?: number;
  maxOutputBytes?: number;
  runner?: ProcessRunner;
}

export interface RawProcessResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

// Injectable boundary so tests drive behaviour with a fake and never spawn a
// real CLI.
export interface ProcessRunner {
  run(execution: CommandExecution, options: ResolvedRunOptions): Promise<RawProcessResult>;
}

export interface ResolvedRunOptions {
  timeoutMs: number;
  maxOutputBytes: number;
}

export interface CommandRunResult {
  ok: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  truncated: boolean;
  durationMs: number;
  failureReason?: string;
}

export interface CommandValidationResult {
  ok: boolean;
  failureReason?: string;
}

function isAllowedCommand(command: string): command is AllowedCommand {
  return (ALLOWED_COMMANDS as readonly string[]).includes(command);
}

export function validateCommandExecution(execution: CommandExecution): CommandValidationResult {
  if (!isAllowedCommand(execution.command)) {
    return { ok: false, failureReason: 'command-not-allowlisted' };
  }

  if (!Array.isArray(execution.args)) {
    return { ok: false, failureReason: 'args-not-array' };
  }

  for (const arg of execution.args) {
    if (typeof arg !== 'string') {
      return { ok: false, failureReason: 'arg-not-string' };
    }
    const lowered = arg.toLowerCase();
    for (const forbidden of FORBIDDEN_ARG_PATTERNS) {
      if (lowered.includes(forbidden)) {
        return { ok: false, failureReason: `forbidden-arg:${forbidden}` };
      }
    }
  }

  return { ok: true };
}

class NodeSpawnRunner implements ProcessRunner {
  async run(
    execution: CommandExecution,
    options: ResolvedRunOptions,
  ): Promise<RawProcessResult> {
    return await new Promise<RawProcessResult>((resolve) => {
      const child = spawn(execution.command, execution.args, {
        cwd: execution.cwd,
        stdio: 'pipe',
        shell: false,
      });

      let stdout = '';
      let stderr = '';
      let timedOut = false;
      let settled = false;

      const cap = (current: string, chunk: string): string =>
        `${current}${chunk}`.slice(0, options.maxOutputBytes);

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, options.timeoutMs);

      child.stdout?.on('data', (chunk: Buffer | string) => {
        stdout = cap(stdout, String(chunk));
      });
      child.stderr?.on('data', (chunk: Buffer | string) => {
        stderr = cap(stderr, String(chunk));
      });

      const finish = (exitCode: number | null): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolve({ exitCode, stdout, stderr, timedOut });
      };

      child.on('error', () => finish(null));
      child.on('close', (code) => finish(code));

      if (typeof execution.stdin === 'string' && child.stdin) {
        child.stdin.end(execution.stdin);
      } else {
        child.stdin?.end();
      }
    });
  }
}

const defaultRunner: ProcessRunner = new NodeSpawnRunner();

// Runs an allowlisted command through the hardened gate. Fail-closed: any
// validation failure, non-zero exit, timeout, or output overflow yields
// `ok: false` with a structured failureReason and never throws.
export async function runAllowlistedCommand(
  execution: CommandExecution,
  options: CommandRunOptions = {},
): Promise<CommandRunResult> {
  const validation = validateCommandExecution(execution);
  if (!validation.ok) {
    return {
      ok: false,
      exitCode: null,
      stdout: '',
      stderr: '',
      timedOut: false,
      truncated: false,
      durationMs: 0,
      failureReason: validation.failureReason,
    };
  }

  const resolved: ResolvedRunOptions = {
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxOutputBytes: options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
  };
  const runner = options.runner ?? defaultRunner;

  const startedAt = Date.now();
  let raw: RawProcessResult;
  try {
    raw = await runner.run(execution, resolved);
  } catch {
    return {
      ok: false,
      exitCode: null,
      stdout: '',
      stderr: '',
      timedOut: false,
      truncated: false,
      durationMs: Date.now() - startedAt,
      failureReason: 'process-runner-threw',
    };
  }

  const durationMs = Date.now() - startedAt;
  const truncated =
    raw.stdout.length >= resolved.maxOutputBytes ||
    raw.stderr.length >= resolved.maxOutputBytes;

  if (raw.timedOut) {
    return {
      ok: false,
      exitCode: raw.exitCode,
      stdout: raw.stdout,
      stderr: raw.stderr,
      timedOut: true,
      truncated,
      durationMs,
      failureReason: 'command-timed-out',
    };
  }

  if (truncated) {
    return {
      ok: false,
      exitCode: raw.exitCode,
      stdout: raw.stdout,
      stderr: raw.stderr,
      timedOut: false,
      truncated: true,
      durationMs,
      failureReason: 'command-output-too-large',
    };
  }

  if (raw.exitCode !== 0) {
    return {
      ok: false,
      exitCode: raw.exitCode,
      stdout: raw.stdout,
      stderr: raw.stderr,
      timedOut: false,
      truncated,
      durationMs,
      failureReason: 'command-nonzero-exit',
    };
  }

  return {
    ok: true,
    exitCode: 0,
    stdout: raw.stdout,
    stderr: raw.stderr,
    timedOut: false,
    truncated: false,
    durationMs,
  };
}
