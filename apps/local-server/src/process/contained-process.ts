import { spawn, spawnSync } from 'node:child_process';

export interface ContainedProcessOptions {
  cwd?: string;
  env?: Record<string, string>;
  stdin?: string;
  timeoutMs: number;
  killGraceMs?: number;
  outputCapBytes: number;
}

export interface ContainedProcessResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: Buffer;
  stderr: Buffer;
  timedOut: boolean;
  truncated: boolean;
  error?: string;
}

const DEFAULT_KILL_GRACE_MS = 500;

export async function runContainedProcess(
  file: string,
  args: string[],
  options: ContainedProcessOptions,
): Promise<ContainedProcessResult> {
  return await new Promise((resolve) => {
    const detached = process.platform !== 'win32';
    const child = spawn(file, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: 'pipe',
      shell: false,
      detached,
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let capturedBytes = 0;
    let truncated = false;
    let timedOut = false;
    let spawnError: string | undefined;
    let escalation: ReturnType<typeof setTimeout> | undefined;

    const capture = (target: Buffer[], raw: Buffer | string): void => {
      const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
      const remaining = Math.max(0, options.outputCapBytes - capturedBytes);
      if (chunk.byteLength > remaining) truncated = true;
      if (remaining > 0) {
        const kept = chunk.subarray(0, remaining);
        target.push(kept);
        capturedBytes += kept.byteLength;
      }
    };

    const signalTree = (force: boolean): void => {
      if (!child.pid) return;
      try {
        if (process.platform === 'win32') {
          spawnSync('taskkill', ['/PID', String(child.pid), '/T', ...(force ? ['/F'] : [])], {
            shell: false,
            stdio: 'ignore',
          });
        } else {
          process.kill(-child.pid, force ? 'SIGKILL' : 'SIGTERM');
        }
      } catch {
        try { child.kill(force ? 'SIGKILL' : 'SIGTERM'); } catch { /* already closed */ }
      }
    };

    const timeout = setTimeout(() => {
      timedOut = true;
      signalTree(false);
      escalation = setTimeout(
        () => signalTree(true),
        options.killGraceMs ?? DEFAULT_KILL_GRACE_MS,
      );
    }, options.timeoutMs);

    child.stdout?.on('data', (chunk) => capture(stdoutChunks, chunk));
    child.stderr?.on('data', (chunk) => capture(stderrChunks, chunk));
    child.on('error', (error) => {
      spawnError = error.message;
    });
    child.on('close', (exitCode, signal) => {
      clearTimeout(timeout);
      if (escalation) clearTimeout(escalation);
      resolve({
        exitCode,
        signal,
        stdout: Buffer.concat(stdoutChunks),
        stderr: Buffer.concat(stderrChunks),
        timedOut,
        truncated,
        ...(spawnError ? { error: spawnError } : {}),
      });
    });

    if (typeof options.stdin === 'string') child.stdin?.end(options.stdin);
    else child.stdin?.end();
  });
}
