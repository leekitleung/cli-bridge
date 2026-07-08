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

/**
 * Maximum length for individual arguments to prevent buffer overflow
 */
const MAX_ARG_LENGTH_PER = 1024;

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

  /**
   * Windows built-in commands that can be safely executed via cmd.exe /c
   * These are limited to safe read-only operations
   */
  const WINDOWS_SAFE_BUILTINS = new Set([
    'echo', 'type', 'cd', 'chdir', 'dir', 'path', 'ver', 'vol', 'date', 'time',
    'set', 'prompt', 'cls', 'color', 'title', 'mode', 'net', 'netstat', 'ipconfig',
    'hostname', 'systeminfo', 'tasklist', 'findstr'
  ]);

  function isAllowed(command: string): boolean {
    if (process.platform === 'win32' && command.toLowerCase() === 'cmd.exe') {
      return true; // cmd.exe is allowed, but we'll validate /c arguments below
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

  /**
   * Validate Windows cmd.exe /c arguments to prevent command injection
   */
  function validateWindowsCmdArgs(argv: string[]): { valid: boolean; reason?: string } {
    // argv[0] is 'cmd.exe', argv[1] is '/c', rest are the actual command
    if (argv.length < 3) {
      return { valid: false, reason: 'No command specified after cmd.exe /c' };
    }

    const subCommand = argv[2].toLowerCase();

    // Only allow safe built-in commands
    if (!WINDOWS_SAFE_BUILTINS.has(subCommand)) {
      return {
        valid: false,
        reason: `cmd.exe: '${subCommand}' is not in the safe built-in list. Allowed: ${[...WINDOWS_SAFE_BUILTINS].join(', ')}`
      };
    }

    // Check for path traversal in arguments (Windows + Unix patterns)
    const PATH_TRAVERSAL_PATTERN = /(\.\.\\|\.\.\/|\.\.\\\\|\\\\\.\.|\/\\|\.\\)/;
    for (let i = 3; i < argv.length; i++) {
      if (PATH_TRAVERSAL_PATTERN.test(argv[i])) {
        return { valid: false, reason: 'Path traversal not allowed in cmd.exe arguments' };
      }
    }

    return { valid: true };
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
    // 添加换行符检查防止多行注入攻击
    // 注意: backtick (`) 未在字符类中，因为它在正则表达式中有特殊含义
    // 使用独立的正则或转义来检测 backtick
    const SHELL_METACHARACTERS = /[;|&$`()<>\\\r\n]|&&|\|\||\$\(|\$\{|##|%%|<<|>>/;
    const SHELL_METACHARACTERS_STRICT = /[;|&$`()<>\\\r\n]|&&|\|\||\$\(|\$\{|##|%%|<<|>>/;
    // 检测 backtick（命令替换）和 !（历史扩展）
    const COMMAND_SUBSTITUTION = /[`!]/;
    if (SHELL_METACHARACTERS.test(prompt) || COMMAND_SUBSTITUTION.test(prompt)) {
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

    // Validate individual argument length
    for (const arg of argv) {
      if (arg.length > MAX_ARG_LENGTH_PER) {
        return {
          ok: false,
          stdout: '',
          stderr: `Argument exceeds ${MAX_ARG_LENGTH_PER} byte limit.`,
          exitCode: 1,
          failureReason: `argument-too-long: ${arg.length} > ${MAX_ARG_LENGTH_PER}`,
        };
      }
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

    // Validate Windows cmd.exe commands
    const isWindows = process.platform === 'win32';
    if (isWindows && command.toLowerCase() === 'cmd.exe') {
      const validation = validateWindowsCmdArgs(argv);
      if (!validation.valid) {
        return {
          ok: false,
          stdout: '',
          stderr: validation.reason || 'Invalid cmd.exe arguments',
          exitCode: 1,
          failureReason: `windows-cmd-validation-failed: ${validation.reason}`,
        };
      }
    }

    const workDir = task.workingDirectory ? resolve(task.workingDirectory) : cwd;

    // Validate working directory is within sandbox bounds
    const sandboxRoot = cwd;
    if (!workDir.startsWith(sandboxRoot)) {
      return {
        ok: false,
        stdout: '',
        stderr: 'Working directory must be within sandbox root.',
        exitCode: 1,
        failureReason: 'working-directory-escape-attempt',
      };
    }

    // On Windows, use cmd.exe to execute commands through /c flag
    // This allows built-in commands like echo, type, del to work properly
    const execArgv = isWindows ? ['/c', ...argv] : argv;
    const execCommand = isWindows ? 'cmd.exe' : command;

    // Windows-compatible process termination helper
    function killProcess(pid: number | undefined, force = false): void {
      if (!pid) return;
      if (isWindows) {
        // Windows: use taskkill to terminate process tree
        // /T: kill process and all child processes
        // /F: force termination
        spawn('taskkill', force ? ['/T', '/F', '/PID', String(pid)] : ['/T', '/PID', String(pid)], { shell: false });
      } else {
        // Unix: use SIGTERM, then SIGKILL if force
        process.kill(pid, force ? 'SIGKILL' : 'SIGTERM');
      }
    }

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
        killProcess(child.pid, false);
        // Force kill after 2s if graceful termination doesn't work.
        setTimeout(() => {
          killProcess(child.pid, true);
        }, 2000);
      }, timeoutMs);

      child.stdout.on('data', (chunk: Buffer) => {
        if (outputTruncated) return;
        stdout += chunk.toString('utf8');
        const totalLen = stdout.length + stderr.length;
        if (totalLen > outputCapBytes) {
          outputTruncated = true;
          // Distribute cap proportionally between stdout and stderr
          const stdoutRatio = stdout.length / (stdout.length + stderr.length || 1);
          const stderrRatio = stderr.length / (stdout.length + stderr.length || 1);
          stdout = stdout.slice(0, Math.floor(outputCapBytes * stdoutRatio));
          stderr = stderr.slice(0, Math.floor(outputCapBytes * stderrRatio));
          killProcess(child.pid, false);
        }
      });

      child.stderr.on('data', (chunk: Buffer) => {
        if (outputTruncated) return;
        stderr += chunk.toString('utf8');
        const totalLen = stdout.length + stderr.length;
        if (totalLen > outputCapBytes) {
          outputTruncated = true;
          // Distribute cap proportionally between stdout and stderr
          const stdoutRatio = stdout.length / (stdout.length + stderr.length || 1);
          const stderrRatio = stderr.length / (stdout.length + stderr.length || 1);
          stdout = stdout.slice(0, Math.floor(outputCapBytes * stdoutRatio));
          stderr = stderr.slice(0, Math.floor(outputCapBytes * stderrRatio));
          killProcess(child.pid, false);
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
