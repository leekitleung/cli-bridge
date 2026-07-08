// Unified Execution Dispatcher - 统一任务分发器
//
// 根据任务特征和执行器能力，自动选择最合适的执行器执行任务。
// 支持的执行器：WorkBuddy、OpenCode 等。
//
// 这是新的 ExecutionDispatcher (v2)，基于 ExecutorRegistry 架构。

import type { ExecutorBackend, ExecutorResult, ExecutorTask } from './executor-registry.ts';
import { ExecutorRegistry, getExecutorRegistry } from './executor-registry.ts';
import { logger } from '../utils/structured-logger.ts';

// TaskDescriptor 已迁移到 executor-registry.ts，统一使用 ExecutorTask
export type TaskDescriptor = ExecutorTask;

export interface DispatchResult {
  ok: boolean;
  executorId: string;
  result: ExecutorResult;
  dispatchDurationMs: number;
}

/**
 * 任务特征到执行器标签的映射
 */
const TASK_TAG_MAPPING: Record<Exclude<TaskDescriptor['expectedOutput'], undefined>, string[]> = {
  'cli-output': ['cli-execution'],
  'code': ['code-generation', 'ai-native'],
  'file-modification': ['file-operations', 'cli-execution'],
  'any': [],
};

/**
 * 执行重试配置
 */
export interface RetryConfig {
  /** 最大重试次数 */
  maxRetries: number;
  /** 初始延迟 (ms) */
  initialDelayMs: number;
  /** 最大延迟 (ms) */
  maxDelayMs: number;
  /** 指数退避基数 */
  backoffMultiplier: number;
  /** 可重试的错误类型 */
  retryableErrors?: string[];
}

/** 默认重试配置 */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
};

/**
 * 判断错误是否可重试
 */
function isRetryableError(error: string, config: RetryConfig): boolean {
  // 网络相关错误默认可重试
  const defaultRetryable = [
    'timeout',
    'network',
    'ECONNREFUSED',
    'ETIMEDOUT',
    'ENOTFOUND',
    'ECONNRESET',
    'workbuddy-timeout',
  ];

  const retryable = config.retryableErrors ?? defaultRetryable;
  return retryable.some(pattern => error.toLowerCase().includes(pattern.toLowerCase()));
}

/**
 * 计算退避延迟
 */
function calculateBackoff(attempt: number, config: RetryConfig): number {
  const delay = config.initialDelayMs * Math.pow(config.backoffMultiplier, attempt - 1);
  return Math.min(delay, config.maxDelayMs);
}

/**
 * 统一任务分发器 (v2)
 *
 * 职责：
 * 1. 分析任务特征
 * 2. 选择最合适的执行器
 * 3. 执行任务并返回结果
 * 4. 记录执行统计
 * 5. 支持自动重试
 *
 * 与 v1 (proposal-dispatcher.ts) 的区别：
 * - v1: 与 Store 耦合，处理 Proposal 生命周期
 * - v2: 与 ExecutorRegistry 耦合，纯执行逻辑
 */
export class ExecutionDispatcher {
  private readonly registry: ExecutorRegistry;
  private readonly executionStats = new Map<string, {
    total: number;
    success: number;
    failure: number;
    retries: number;
    avgDurationMs: number;
  }>();
  private readonly retryConfig: RetryConfig;

  constructor(registry?: ExecutorRegistry, retryConfig?: Partial<RetryConfig>) {
    this.registry = registry ?? getExecutorRegistry();
    this.retryConfig = { ...DEFAULT_RETRY_CONFIG, ...retryConfig };
  }

  /**
   * 分析任务并选择执行器
   */
  analyzeTask(task: TaskDescriptor): {
    selectedExecutor: ExecutorBackend | undefined;
    matchReason: string;
    tags: string[];
  } {
    // 1. 如果用户指定了执行器，优先使用
    if (task.preferredExecutor) {
      const executor = this.registry.get(task.preferredExecutor);
      if (executor) {
        return {
          selectedExecutor: executor,
          matchReason: `user-specified:${task.preferredExecutor}`,
          tags: [],
        };
      }
      logger.warn('[ExecutionDispatcher] Preferred executor not found', { preferredExecutor: task.preferredExecutor });
    }

    // 2. 根据任务特征计算需要的标签
    const requiredTags = this.getRequiredTags(task);

    // 3. 选择执行器
    const executor = this.registry.select({ preferredTags: requiredTags });

    return {
      selectedExecutor: executor,
      matchReason: executor ? 'capability-match' : 'fallback-first-healthy',
      tags: requiredTags,
    };
  }

  /**
   * 分发任务到执行器（带自动重试）
   */
  async dispatch(task: TaskDescriptor): Promise<DispatchResult> {
    const startTime = Date.now();

    // 分析任务
    const analysis = this.analyzeTask(task);

    if (!analysis.selectedExecutor) {
      const durationMs = Date.now() - startTime;
      return {
        ok: false,
        executorId: 'none',
        result: {
          ok: false,
          stdout: '',
          failureReason: 'no-executor-available',
          durationMs,
        },
        dispatchDurationMs: durationMs,
      };
    }

    // 构建执行器任务
    const executorTask: ExecutorTask = {
      taskId: task.taskId,
      proposalId: task.proposalId,
      prompt: task.prompt,
      workingDirectory: task.workingDirectory,
      timeoutMs: task.timeoutMs,
      projectId: task.projectId,
      planId: task.planId,
      goalId: task.goalId,
    };

    // 执行（带重试）
    let lastError: string = '';
    let attempts = 0;

    while (attempts <= this.retryConfig.maxRetries) {
      attempts++;

      const dispatchStart = Date.now();
      const result = await this.registry.execute(executorTask, {
        executorId: task.preferredExecutor,
        preferredTags: analysis.tags,
      });
      const dispatchDurationMs = Date.now() - dispatchStart;

      // 成功
      if (result.ok) {
        this.recordExecution(analysis.selectedExecutor.id, {
          ok: true,
          durationMs: result.durationMs,
          retries: attempts - 1,
        });

        return {
          ok: true,
          executorId: analysis.selectedExecutor.id,
          result,
          dispatchDurationMs,
        };
      }

      // 失败
      lastError = result.failureReason ?? 'unknown-error';

      // 检查是否可重试
      if (attempts <= this.retryConfig.maxRetries && isRetryableError(lastError, this.retryConfig)) {
        const backoffMs = calculateBackoff(attempts, this.retryConfig);
        logger.info('[ExecutionDispatcher] Retrying failed task', {
          taskId: task.taskId,
          attempt: attempts,
          error: lastError,
          backoffMs,
        });

        // 等待后退
        await new Promise(resolve => setTimeout(resolve, backoffMs));
        continue;
      }

      // 不可重试或已达最大次数
      this.recordExecution(analysis.selectedExecutor.id, {
        ok: false,
        durationMs: result.durationMs,
        retries: attempts - 1,
      });

      return {
        ok: false,
        executorId: analysis.selectedExecutor.id,
        result: {
          ...result,
          failureReason: `failed-after-${attempts}-attempts: ${lastError}`,
        },
        dispatchDurationMs,
      };
    }

    // 不应该到达这里
    return {
      ok: false,
      executorId: analysis.selectedExecutor.id,
      result: {
        ok: false,
        stdout: '',
        failureReason: lastError,
        durationMs: Date.now() - startTime,
      },
      dispatchDurationMs: Date.now() - startTime,
    };
  }

  /**
   * 获取任务所需的标签
   */
  private getRequiredTags(task: TaskDescriptor): string[] {
    const tags: string[] = [];

    // 添加输出类型标签
    if (task.expectedOutput && task.expectedOutput !== 'any') {
      const outputTags = TASK_TAG_MAPPING[task.expectedOutput];
      if (outputTags) {
        tags.push(...outputTags);
      }
    }

    // 添加文件操作标签
    if (task.requiresFileOperations) {
      tags.push('file-operations');
    }

    // 添加网络访问标签
    if (task.requiresNetworkAccess) {
      tags.push('network-access');
    }

    // 合并用户指定的标签
    if (task.preferredTags) {
      tags.push(...task.preferredTags);
    }

    return [...new Set(tags)]; // 去重
  }

  /**
   * 记录执行统计
   */
  private recordExecution(
    executorId: string,
    result: { ok: boolean; durationMs: number; retries?: number },
  ): void {
    const stats = this.executionStats.get(executorId) ?? {
      total: 0,
      success: 0,
      failure: 0,
      retries: 0,
      avgDurationMs: 0,
    };

    stats.total++;
    if (result.ok) {
      stats.success++;
    } else {
      stats.failure++;
    }

    // 累加重试次数
    if (result.retries !== undefined) {
      stats.retries += result.retries;
    }

    // 计算移动平均
    stats.avgDurationMs = Math.round(
      (stats.avgDurationMs * (stats.total - 1) + result.durationMs) / stats.total
    );

    this.executionStats.set(executorId, stats);
  }

  /**
   * 获取执行统计
   */
  getStats(): {
    executorStats: Record<string, {
      total: number;
      success: number;
      failure: number;
      successRate: string;
      avgDurationMs: number;
    }>;
    registryStatus: ReturnType<ExecutorRegistry['getStatus']>;
  } {
    const executorStats: Record<string, {
      total: number;
      success: number;
      failure: number;
      successRate: string;
      avgDurationMs: number;
    }> = {};

    for (const [executorId, stats] of this.executionStats) {
      executorStats[executorId] = {
        ...stats,
        successRate: stats.total > 0
          ? `${Math.round((stats.success / stats.total) * 100)}%`
          : 'N/A',
      };
    }

    return {
      executorStats,
      registryStatus: this.registry.getStatus(),
    };
  }

  /**
   * 获取执行器注册表
   */
  getRegistry(): ExecutorRegistry {
    return this.registry;
  }
}

/**
 * 创建执行分发器
 */
export function createExecutionDispatcher(registry?: ExecutorRegistry): ExecutionDispatcher {
  return new ExecutionDispatcher(registry);
}

// ─── 全局执行分发器 ───
let globalDispatcher: ExecutionDispatcher | undefined;

export function getExecutionDispatcher(): ExecutionDispatcher {
  if (!globalDispatcher) {
    globalDispatcher = new ExecutionDispatcher();
  }
  return globalDispatcher;
}
