// OpenCode Executor - 基于 OpenCode CLI 的执行器
//
// OpenCode 是一个本地代码执行工具，可以直接运行命令并返回结果。
// 此执行器将其适配为统一的 ExecutorBackend 接口。

import type { ExecutorBackend, ExecutorResult, ExecutorTask, ExecutorCapabilities } from './executor-registry.ts';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';

export const OPENCODE_CAPABILITIES: ExecutorCapabilities = {
  id: 'opencode',
  name: 'OpenCode',
  transport: 'process',
  risk: 'high',
  canAcceptPrompt: true,
  canReturnOutput: true,
  canExecute: true,
  streaming: false,
  maxConcurrency: 1,
  tags: ['cli-execution', 'file-operations', 'command-runner'],
};

/**
 * OpenCode 执行器配置
 */
export interface OpenCodeExecutorOptions {
  /** OpenCode CLI 路径 */
  openCodePath?: string;
  /** 工作目录 */
  workingDirectory?: string;
  /** 执行超时 (ms) */
  timeoutMs?: number;
  /** 是否模拟执行（用于测试） */
  mockMode?: boolean;
}

/**
 * OpenCode 执行器 - 实现 ExecutorBackend 接口
 *
 * 通过 spawn 调用 OpenCode CLI 执行命令。
 */
export class OpenCodeExecutor implements ExecutorBackend {
  readonly id = 'opencode';
  private readonly options: {
    openCodePath: string;
    workingDirectory: string;
    timeoutMs: number;
    mockMode: boolean;
  };

  constructor(options: OpenCodeExecutorOptions = {}) {
    this.options = {
      openCodePath: options.openCodePath ?? 'opencode',
      workingDirectory: options.workingDirectory ?? process.cwd(),
      timeoutMs: options.timeoutMs ?? 120_000,
      mockMode: options.mockMode ?? false,
    };
  }

  getCapabilities(): ExecutorCapabilities {
    return { ...OPENCODE_CAPABILITIES };
  }

  /**
   * 执行任务 - 实现 ExecutorBackend 接口
   */
  async execute(task: ExecutorTask): Promise<ExecutorResult> {
    const startTime = Date.now();

    // 模拟模式：用于测试
    if (this.options.mockMode) {
      await delay(100); // 模拟执行时间
      return {
        ok: true,
        stdout: `[Mock] Executed: ${task.prompt}`,
        durationMs: Date.now() - startTime,
      };
    }

    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';
      let killed = false;

      const workingDir = task.workingDirectory ?? this.options.workingDirectory;

      // SECURITY FIX: Validate working directory to prevent path traversal
      // Must be a subdirectory of the configured workspace root
      const workspaceRoot = path.resolve(this.options.workingDirectory);
      const resolvedWorkingDir = path.resolve(workingDir);
      if (!resolvedWorkingDir.startsWith(workspaceRoot + path.sep) && resolvedWorkingDir !== workspaceRoot) {
        resolve({
          ok: false,
          stdout: '',
          stderr: `Working directory must be within workspace root: ${workspaceRoot}`,
          failureReason: 'invalid-working-directory',
          durationMs: 0,
        });
        return;
      }

      // SECURITY FIX: 不使用 shell: true 防止命令注入
      // 将 prompt 作为单独参数传递给 OpenCode CLI
      const args = ['exec', '--json', task.prompt];

      // shell: false 防止命令注入攻击
      const proc = spawn(this.options.openCodePath, args, {
        cwd: workingDir,
        env: { ...process.env },
        shell: false,  // SECURITY FIX: 禁用 shell 防止命令注入
      });

      const timeout = setTimeout(() => {
        killed = true;
        proc.kill('SIGKILL');
        resolve({
          ok: false,
          stdout,
          stderr: `Execution timed out after ${this.options.timeoutMs}ms`,
          failureReason: 'timeout',
          durationMs: Date.now() - startTime,
        });
      }, task.timeoutMs ?? this.options.timeoutMs);

      proc.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        clearTimeout(timeout);
        if (killed) return; // 已经超时处理了

        const durationMs = Date.now() - startTime;
        const exitCode = code ?? 0;

        resolve({
          ok: exitCode === 0,
          stdout,
          stderr: stderr || undefined,
          exitCode,
          failureReason: exitCode !== 0 ? `Exit code: ${exitCode}` : undefined,
          durationMs,
        });
      });

      proc.on('error', (err) => {
        clearTimeout(timeout);
        resolve({
          ok: false,
          stdout,
          stderr: err.message,
          failureReason: 'process-error',
          durationMs: Date.now() - startTime,
        });
      });
    });
  }

  /**
   * 健康检查
   */
  async healthCheck(): Promise<boolean> {
    if (this.options.mockMode) return true;

    return new Promise((resolve) => {
      const proc = spawn(this.options.openCodePath, ['--version'], {
        shell: false, // Consistent with execute() - no shell needed for --version
      });

      proc.on('close', (code) => {
        resolve(code === 0);
      });

      proc.on('error', () => {
        resolve(false);
      });
    });
  }
}

/**
 * 创建 OpenCode 执行器
 */
export function createOpenCodeExecutor(options?: OpenCodeExecutorOptions): OpenCodeExecutor {
  return new OpenCodeExecutor(options);
}
