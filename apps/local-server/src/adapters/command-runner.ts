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

import { existsSync } from 'node:fs';
import { delimiter as pathDelimiter, join as joinPath } from 'node:path';
import { runContainedProcess } from '../process/contained-process.ts';

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
  launcherResolver?: LauncherResolver;
}

// Resolves an allowlisted command name to a concrete, directly-spawnable
// executable plus any args that must precede the caller's argv. This exists
// because on Windows the PATH entry for `claude` / `codex` is a `.cmd` shim,
// which CreateProcess cannot run with `shell: false`. The resolver locates the
// real `.exe` or the `node` + JS entry so we keep `shell: false` and never fall
// back to a shell or to executing the `.cmd`.
//
// Returns null when it cannot resolve a concrete launcher; the runner then
// fails closed with `launcher-not-resolved`. It NEVER returns a `.cmd` path and
// NEVER signals a shell fallback.
export interface ResolvedLauncher {
  executable: string;
  prependArgs: string[];
}

export type LauncherResolver = (command: AllowedCommand) => ResolvedLauncher | null;

export interface RawProcessResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  truncated?: boolean;
}

// Injectable boundary so tests drive behaviour with a fake and never spawn a
// real CLI. The launcher is the concrete executable resolved from the command
// name; the runner spawns it directly with `shell: false`.
export interface ProcessRunner {
  run(
    execution: CommandExecution,
    launcher: ResolvedLauncher,
    options: ResolvedRunOptions,
  ): Promise<RawProcessResult>;
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
    launcher: ResolvedLauncher,
    options: ResolvedRunOptions,
  ): Promise<RawProcessResult> {
    const result = await runContainedProcess(
      launcher.executable,
      [...launcher.prependArgs, ...execution.args],
      {
        cwd: execution.cwd,
        stdin: execution.stdin,
        timeoutMs: options.timeoutMs,
        outputCapBytes: options.maxOutputBytes,
      },
    );
    return {
      exitCode: result.exitCode,
      stdout: result.stdout.toString('utf8'),
      stderr: result.stderr.toString('utf8'),
      timedOut: result.timedOut,
      truncated: result.truncated,
    };
  }
}

const defaultRunner: ProcessRunner = new NodeSpawnRunner();

// Default launcher resolver. On non-Windows, the bare command name is directly
// spawnable, so we use it as-is. On Windows, the PATH entry is a `.cmd` shim
// that CreateProcess cannot run with `shell: false`, so we resolve to a concrete
// launcher:
//   - claude: the real `claude.exe` next to the shim.
//   - codex:  `node` + the package's JS entry next to the shim.
// Resolution is best-effort and fail-closed: if the concrete launcher cannot be
// located, it returns null and the caller fails with `launcher-not-resolved`.
// It never returns a `.cmd` path and never enables a shell.
export function defaultLauncherResolver(command: AllowedCommand): ResolvedLauncher | null {
  if (process.platform !== 'win32') {
    return { executable: command, prependArgs: [] };
  }

  const shimDir = findShimDir(command);
  if (!shimDir) {
    return null;
  }

  if (command === 'claude') {
    const exe = resolvePath(shimDir, ['node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe']);
    return exe ? { executable: exe, prependArgs: [] } : null;
  }

  // codex: run the package JS entry via node.
  const jsEntry = resolvePath(shimDir, ['node_modules', '@openai', 'codex', 'bin', 'codex.js']);
  return jsEntry ? { executable: process.execPath, prependArgs: [jsEntry] } : null;
}

function findShimDir(command: AllowedCommand): string | null {
  const pathEnv = process.env.PATH ?? process.env.Path ?? '';
  for (const dir of pathEnv.split(pathDelimiter)) {
    if (!dir) {
      continue;
    }
    if (existsSync(joinPath(dir, `${command}.cmd`)) || existsSync(joinPath(dir, `${command}.exe`))) {
      return dir;
    }
  }
  return null;
}

function resolvePath(baseDir: string, segments: string[]): string | null {
  const full = joinPath(baseDir, ...segments);
  return existsSync(full) ? full : null;
}

// Runs an allowlisted command through the hardened gate. Fail-closed: any
// validation failure, unresolved launcher, non-zero exit, timeout, or output
// overflow yields `ok: false` with a structured failureReason and never throws.
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

  const resolveLauncher = options.launcherResolver ?? defaultLauncherResolver;
  const launcher = resolveLauncher(execution.command);
  if (!launcher) {
    return {
      ok: false,
      exitCode: null,
      stdout: '',
      stderr: '',
      timedOut: false,
      truncated: false,
      durationMs: 0,
      failureReason: 'launcher-not-resolved',
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
    raw = await runner.run(execution, launcher, resolved);
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
    raw.truncated === true ||
    Buffer.byteLength(raw.stdout) + Buffer.byteLength(raw.stderr) >= resolved.maxOutputBytes;

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
