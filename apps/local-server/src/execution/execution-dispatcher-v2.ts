// Unified Execution Dispatcher - 统一任务分发器
//
// 根据任务特征和执行器能力，自动选择最合适的执行器执行任务。
// 支持的执行器：WorkBuddy、OpenCode 等。
//
// 这是新的 ExecutionDispatcher (v2)，基于 ExecutorRegistry 架构。

import type { ExecutorBackend, ExecutorResult, ExecutorTask } from './executor-registry.ts';
import { ExecutorRegistry, getExecutorRegistry } from './executor-registry.ts';
import { logger } from '../utils/structured-logger.ts';

export interface TaskDescriptor {
  /** 任务 ID */
  taskId: string;
  /** 提案 ID */
  proposalId: string;
  /** 任务描述/提示 */
  prompt: string;
  /** 预期输出类型 */
  expectedOutput?: 'cli-output' | 'code' | 'file-modification' | 'any';
  /** 是否需要文件操作 */
  requiresFileOperations?: boolean;
  /** 是否需要网络访问 */
  requiresNetworkAccess?: boolean;
  /** 工作目录 */
  workingDirectory?: string;
  /** 超时 (ms) */
  timeoutMs?: number;
  /** 用户指定的执行器偏好 */
  preferredExecutor?: string;
  /** 用户指定的标签偏好 */
  preferredTags?: string[];
  /** 元数据 */
  metadata?: Record<string, unknown>;
  /** 项目 ID（用于 WorkBuddy 上下文追踪） */
  projectId?: string;
  /** 计划 ID（用于 WorkBuddy 上下文追踪） */
  planId?: string;
  /** 目标 ID（用于 WorkBuddy 上下文追踪） */
  goalId?: string;
}

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
 * 统一任务分发器 (v2)
 *
 * 职责：
 * 1. 分析任务特征
 * 2. 选择最合适的执行器
 * 3. 执行任务并返回结果
 * 4. 记录执行统计
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
    avgDurationMs: number;
  }>();

  constructor(registry?: ExecutorRegistry) {
    this.registry = registry ?? getExecutorRegistry();
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
   * 分发任务到执行器
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

    // 执行
    const dispatchStart = Date.now();
    const result = await this.registry.execute(executorTask, {
      executorId: task.preferredExecutor,
      preferredTags: analysis.tags,
    });
    const dispatchDurationMs = Date.now() - dispatchStart;

    // 记录统计
    this.recordExecution(analysis.selectedExecutor.id, {
      ok: result.ok,
      durationMs: result.durationMs,
    });

    return {
      ok: result.ok,
      executorId: analysis.selectedExecutor.id,
      result,
      dispatchDurationMs,
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
  private recordExecution(executorId: string, result: { ok: boolean; durationMs: number }): void {
    const stats = this.executionStats.get(executorId) ?? {
      total: 0,
      success: 0,
      failure: 0,
      avgDurationMs: 0,
    };

    stats.total++;
    if (result.ok) {
      stats.success++;
    } else {
      stats.failure++;
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
