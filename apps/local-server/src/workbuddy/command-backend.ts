import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * Maximum argument count to prevent DoS via argument list
 */
const MAX_ARG_COUNT = 20;

/**
 * Maximum total argument length to prevent DoS
 */
const MAX_ARG_LENGTH = 4096;

export interface CommandBackendConfig {
  /** Allowlist of command names or absolute paths that may be executed. */
  allowlist: string[];
  /** Default working directory (server-owned). */
  defaultCwd: string;
  /** Maximum execution time in ms (default: 30000). */
  timeoutMs: number;
  /** Maximum output size in bytes (default: 65536). */
  outputCapBytes: number;
  /** Environment variables to pass to the command. */
  env?: Record<string, string>;
}

export interface CommandBackendResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  failureReason?: string;
}

/**
 * ADR-0034: Minimal command-backend for WorkBuddy real execution.
 * Only executes allowlisted commands. Never accepts raw shell from the user.
 * Working directory is server-owned. Timeout and output cap are enforced.
 */
export function createCommandBackend(config: CommandBackendConfig) {
  const cwd = resolve(config.defaultCwd || tmpdir());
  const timeoutMs = config.timeoutMs || 30_000;
  const outputCapBytes = config.outputCapBytes || 65_536;

  function isAllowed(command: string): boolean {
    // On Windows, allow cmd.exe to run built-in commands
    if (process.platform === 'win32' && command.toLowerCase() === 'cmd.exe') {
      return true;
    }
    return config.allowlist.some(entry => {
      if (entry === command) return true;
      // Allow absolute path match.
      try {
        if (resolve(entry) === resolve(command)) return true;
      } catch {
        // ignore path resolution errors
      }
      return false;
    });
  }

  async function execute(task: {
    taskId: string;
    proposalId: string;
    prompt: string;
    workingDirectory?: string;
  }): Promise<CommandBackendResult> {
    // Parse the prompt as argv. First word is the command, rest are args.
    // The prompt format is: command arg1 arg2 ...
    const prompt = (task.prompt || '').trim();
    if (!prompt) {
      return {
        ok: false,
        stdout: '',
        stderr: 'Empty prompt — no command to execute.',
        exitCode: 1,
        failureReason: 'Empty prompt',
      };
    }

    // SECURITY FIX: 检查 shell 元字符防止命令注入
    // 即使 shell: false，也拒绝包含危险元字符的输入
    const SHELL_METACHARACTERS = /[;|&$`()<>\\]|&&|\|\||\$\(|\$\{|##|%%|<<|>>/;
    if (SHELL_METACHARACTERS.test(prompt)) {
      return {
        ok: false,
        stdout: '',
        stderr: 'Command contains forbidden shell metacharacters.',
        exitCode: 1,
        failureReason: 'shell-metacharacter-detected',
      };
    }

    // Parse argv from prompt (respects simple quoting).
    const argv = parseArgv(prompt);
    if (argv.length === 0) {
      return {
        ok: false,
        stdout: '',
        stderr: 'Could not parse command from prompt.',
        exitCode: 1,
        failureReason: 'No command parsed from prompt',
      };
    }

    // Validate argument count to prevent DoS
    if (argv.length > MAX_ARG_COUNT) {
      return {
        ok: false,
        stdout: '',
        stderr: `Too many arguments (max ${MAX_ARG_COUNT}).`,
        exitCode: 1,
        failureReason: `too-many-arguments: ${argv.length} > ${MAX_ARG_COUNT}`,
      };
    }

    // Validate total argument length
    const totalLength = argv.reduce((sum, arg) => sum + arg.length, 0);
    if (totalLength > MAX_ARG_LENGTH) {
      return {
        ok: false,
        stdout: '',
        stderr: `Total argument length exceeds ${MAX_ARG_LENGTH} bytes.`,
        exitCode: 1,
        failureReason: `arguments-too-long: ${totalLength} > ${MAX_ARG_LENGTH}`,
      };
    }

    const command = argv[0];
    if (!isAllowed(command)) {
      return {
        ok: false,
        stdout: '',
        stderr: `Command "${command}" is not in the allowlist.`,
        exitCode: 1,
        failureReason: `Command not allowed: ${command}`,
      };
    }

    const workDir = task.workingDirectory ? resolve(task.workingDirectory) : cwd;

    // On Windows, use cmd.exe to execute commands through /c flag
    // This allows built-in commands like echo, type, del to work properly
    const isWindows = process.platform === 'win32';
    const execArgv = isWindows ? ['/c', ...argv] : argv;
    const execCommand = isWindows ? 'cmd.exe' : command;

    return new Promise<CommandBackendResult>((resolveResult) => {
      const child = spawn(execCommand, execArgv, {
        cwd: workDir,
        env: config.env ? { ...process.env, ...config.env } : process.env,
        shell: false,
        timeout: timeoutMs,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      let outputTruncated = false;
      let timedOut = false;

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
        // Force kill after 2s if SIGTERM doesn't work.
        setTimeout(() => {
          if (!child.killed) child.kill('SIGKILL');
        }, 2000);
      }, timeoutMs);

      child.stdout.on('data', (chunk: Buffer) => {
        if (outputTruncated) return;
        stdout += chunk.toString('utf8');
        if (stdout.length + stderr.length > outputCapBytes) {
          outputTruncated = true;
          stdout = stdout.slice(0, outputCapBytes);
          child.kill('SIGTERM');
        }
      });

      child.stderr.on('data', (chunk: Buffer) => {
        if (outputTruncated) return;
        stderr += chunk.toString('utf8');
        if (stdout.length + stderr.length > outputCapBytes) {
          outputTruncated = true;
          stderr = stderr.slice(0, outputCapBytes);
          child.kill('SIGTERM');
        }
      });

      child.on('close', (exitCode, signal) => {
        clearTimeout(timer);

        if (timedOut) {
          resolveResult({
            ok: false,
            stdout: stdout.slice(0, outputCapBytes),
            stderr: `Command timed out after ${timeoutMs}ms.${stderr ? '\n' + stderr : ''}`.slice(0, outputCapBytes),
            exitCode: -1,
            failureReason: `Timed out after ${timeoutMs}ms`,
          });
          return;
        }

        if (outputTruncated) {
          resolveResult({
            ok: false,
            stdout: stdout.slice(0, outputCapBytes),
            stderr: `Output exceeded ${outputCapBytes} byte cap.${stderr ? '\n' + stderr : ''}`.slice(0, outputCapBytes),
            exitCode: -1,
            failureReason: `Output exceeded ${outputCapBytes} byte cap`,
          });
          return;
        }

        if (signal) {
          resolveResult({
            ok: false,
            stdout,
            stderr: `Command killed by signal ${signal}.${stderr ? '\n' + stderr : ''}`,
            exitCode: exitCode ?? -1,
            failureReason: `Killed by signal ${signal}`,
          });
          return;
        }

        resolveResult({
          ok: exitCode === 0,
          stdout,
          stderr,
          exitCode: exitCode ?? -1,
          failureReason: exitCode === 0 ? undefined : `Exit code ${exitCode}`,
        });
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        resolveResult({
          ok: false,
          stdout,
          stderr: err.message,
          exitCode: -1,
          failureReason: `Spawn error: ${err.message}`,
        });
      });
    });
  }

  return { execute };
}

/**
 * Parse a command string into argv, respecting single and double quotes.
 * Does not support shell features like pipes, redirects, or variable expansion.
 */
function parseArgv(input: string): string[] {
  const argv: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
    } else if (ch === '"' || ch === "'") {
      quote = ch as '"' | "'";
    } else if (ch === ' ' || ch === '\t') {
      if (current) {
        argv.push(current);
        current = '';
      }
    } else {
      current += ch;
    }
  }
  if (current) argv.push(current);
  return argv;
}
