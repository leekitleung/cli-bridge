// WorkBuddy Executor Adapter - 将 WorkBuddy 适配到统一执行器注册表
//
// WorkBuddy 通过 inbox/next 拉取任务，通过 POST /results 提交结果。
// 此适配器将其包装为标准的 ExecutorBackend 接口。

import type { ExecutorBackend, ExecutorResult, ExecutorTask, ExecutorCapabilities } from './executor-registry.ts';
import type { WorkBuddyExecutionAdapter } from '../adapters/workbuddy-execution-adapter.ts';
import { createWorkBuddyWorker, type WorkBuddyWorker } from '../workbuddy/workbuddy-worker.ts';
import { PAIRING_TOKEN_HEADER } from '../../../../packages/shared/src/constants.ts';
import { logger } from '../utils/structured-logger.ts';

export const WORKBUDDY_CAPABILITIES: ExecutorCapabilities = {
  id: 'workbuddy',
  name: 'WorkBuddy',
  transport: 'workbuddy',
  risk: 'medium',
  canAcceptPrompt: true,
  canReturnOutput: true,
  canExecute: true,
  streaming: false,
  maxConcurrency: 1,
  tags: ['cli-execution', 'file-operations', 'command-runner'],
};

export interface WorkBuddyExecutorOptions {
  /** WorkBuddy 适配器实例 */
  adapter: WorkBuddyExecutionAdapter;
  /** Local Server 基础 URL */
  baseUrl?: string;
  /** 配对 Token */
  pairingToken?: string;
  /** 轮询间隔 (ms) */
  pollIntervalMs?: number;
  /** 工作目录 */
  workingDirectory?: string;
  /** 执行超时 (ms) */
  timeoutMs?: number;
  /** 是否启用诊断模式 */
  diagnosticMode?: boolean;
}

/**
 * WorkBuddy 执行器 - 实现 ExecutorBackend 接口
 *
 * 将 WorkBuddy 的 inbox/next + POST /results 协议适配为统一的 execute() 接口。
 */
export class WorkBuddyExecutor implements ExecutorBackend {
  readonly id = 'workbuddy';
  private readonly adapter: WorkBuddyExecutionAdapter;
  private readonly options: {
    baseUrl: string;
    pairingToken: string;
    pollIntervalMs: number;
    workingDirectory: string;
    timeoutMs: number;
    diagnosticMode: boolean;
  };
  private worker?: WorkBuddyWorker;
  private workerInterval?: ReturnType<typeof setInterval>;

  constructor(options: WorkBuddyExecutorOptions) {
    this.adapter = options.adapter;
    this.options = {
      baseUrl: options.baseUrl ?? 'http://127.0.0.1:31337',
      pairingToken: options.pairingToken ?? '',
      pollIntervalMs: options.pollIntervalMs ?? 5000,
      workingDirectory: options.workingDirectory ?? process.cwd(),
      timeoutMs: options.timeoutMs ?? 120_000,
      diagnosticMode: options.diagnosticMode ?? false,
    };
  }

  getCapabilities(): ExecutorCapabilities {
    return { ...WORKBUDDY_CAPABILITIES };
  }

  /**
   * 启动 WorkBuddy Worker
   *
   * Worker 负责轮询 WorkBuddy 的 inbox 并处理任务。
   * 需要在 execute() 之前调用，或者由外部自动启动。
   */
  startWorker(): void {
    if (this.worker) {
      logger.debug('[WorkBuddyExecutor] Worker already running');
      return;
    }

    this.worker = createWorkBuddyWorker({
      endpointId: 'local-workbuddy',
      baseUrl: this.options.baseUrl,
      pairingToken: this.options.pairingToken,
      pollIntervalMs: this.options.pollIntervalMs,
      mode: this.options.diagnosticMode ? 'diagnostic' : undefined,
      fetchFn: this.fetchWrapper,
    });

    // 启动轮询
    this.workerInterval = setInterval(() => {
      void this.pollAndProcess();
    }, this.options.pollIntervalMs);

    logger.info('[WorkBuddyExecutor] Worker started');
  }

  /**
   * 停止 WorkBuddy Worker
   */
  stopWorker(): void {
    if (this.workerInterval) {
      clearInterval(this.workerInterval);
      this.workerInterval = undefined;
    }
    this.worker = undefined;
    logger.info('[WorkBuddyExecutor] Worker stopped');
  }

  /**
   * 执行任务 - 实现 ExecutorBackend 接口
   *
   * 将任务放入 WorkBuddy 的 inbox，等待执行结果。
   */
  async execute(task: ExecutorTask): Promise<ExecutorResult> {
    const startTime = Date.now();

    // 创建任务
    const workbuddyTask = this.adapter.enqueue({
      endpointId: 'local-workbuddy',
      projectId: task.projectId ?? 'default',
      proposalId: task.proposalId,
      planId: task.planId ?? task.taskId,
      goalId: task.goalId ?? task.taskId,
      bindingHash: task.taskId,
      prompt: task.prompt,
      workingDirectory: task.workingDirectory ?? this.options.workingDirectory,
      timeoutMs: task.timeoutMs ?? this.options.timeoutMs,
    });

    // 轮询结果 - 使用 2s 间隔减少 CPU 占用
    // 注: 事件驱动需要 WorkBuddy 支持 WebSocket/Server-Sent Events，
    // 当前采用轮询模式是出于兼容性和简单性考虑
    const timeoutAt = startTime + (task.timeoutMs ?? this.options.timeoutMs);
    const pollIntervalMs = 2000; // 从 1000ms 增加到 2000ms 减少 CPU 占用

    while (Date.now() < timeoutAt) {
      const result = this.adapter.getResult(workbuddyTask.taskId);
      if (result) {
        return {
          ok: result.ok,
          stdout: result.stdout ?? '',
          stderr: result.stderr,
          exitCode: result.exitCode,
          output: result.output,
          failureReason: result.failureReason,
          durationMs: Date.now() - startTime,
        };
      }

      // 等待后再检查
      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    }

    // 超时
    return {
      ok: false,
      stdout: '',
      stderr: `Task timed out after ${Date.now() - startTime}ms`,
      failureReason: 'workbuddy-timeout',
      durationMs: Date.now() - startTime,
    };
  }

  /**
   * 健康检查
   *
   * 检查 WorkBuddy 是否可达且正在轮询。
   */
  async healthCheck(): Promise<boolean> {
    // 检查最后 claim 时间，如果在 2 分钟内，说明 WorkBuddy 活跃
    const lastClaimed = this.adapter.getLastClaimedAt();
    if (lastClaimed === 0) {
      return false; // 从未 claim 过，可能 WorkBuddy 未连接
    }

    const staleMs = Date.now() - lastClaimed;
    return staleMs < 120_000; // 2 分钟内有活动
  }

  /**
   * 获取执行器状态
   */
  getStatus(): {
    ready: boolean;
    lastClaimedAt: number;
    lastHeartbeatAt: number;
    lastResultAt: number;
    lastFailureReason?: string;
  } {
    return {
      ready: this.adapter.getExecutorReady(),
      lastClaimedAt: this.adapter.getLastClaimedAt(),
      lastHeartbeatAt: this.adapter.getLastHeartbeatAt(),
      lastResultAt: this.adapter.getLastResultAt(),
      lastFailureReason: this.adapter.getLastFailureReason(),
    };
  }

  // ─── 内部方法 ───

  private fetchWrapper = async (
    url: string,
    init: { method: string; headers: Record<string, string>; body?: string; timeoutMs?: number },
  ): Promise<{
    ok: boolean;
    status: number;
    text(): Promise<string>;
  }> => {
    const timeoutMs = init.timeoutMs ?? 30_000; // Default 30 second timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        method: init.method,
        headers: {
          ...init.headers,
          [PAIRING_TOKEN_HEADER]: this.options.pairingToken,
        },
        body: init.body,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      return {
        ok: res.ok,
        status: res.status,
        text: () => res.text(),
      };
    } catch (err) {
      clearTimeout(timeoutId);
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error(`Fetch timeout after ${timeoutMs}ms`);
      }
      throw err;
    }
  };

  private async pollAndProcess(): Promise<void> {
    if (!this.worker) return;

    try {
      // 轮询下一个任务
      const task = this.adapter.claimNext('local-workbuddy');
      if (!task) {
        // 没有待处理任务
        return;
      }

      // 处理任务（通过 WorkBuddy 后端执行）
      if (this.worker.backend) {
        const result = await this.worker.backend.execute({
          taskId: task.taskId,
          proposalId: task.proposalId,
          prompt: task.prompt,
          workingDirectory: task.workingDirectory,
        });

        // 记录结果
        this.adapter.recordResult(task.taskId, {
          proposalId: task.proposalId,
          ok: result.ok,
          stdout: result.stdout ?? '',
          stderr: result.stderr,
          exitCode: result.exitCode,
          output: result.output,
          failureReason: result.failureReason,
          durationMs: 0, // 由 adapter 计算
        });
      } else {
        // 没有后端，将任务标记为失败
        this.adapter.recordResult(task.taskId, {
          proposalId: task.proposalId,
          ok: false,
          failureReason: 'no-executor-backend',
          durationMs: 0,
        });
      }
    } catch (error) {
      logger.error('[WorkBuddyExecutor] Poll error', { error: error instanceof Error ? error.message : String(error) });
    }
  }
}

/**
 * 创建 WorkBuddy 执行器工厂
 */
export function createWorkBuddyExecutor(options: WorkBuddyExecutorOptions): WorkBuddyExecutor {
  return new WorkBuddyExecutor(options);
}
