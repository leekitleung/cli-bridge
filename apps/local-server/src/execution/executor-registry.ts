// Goal Executor Registry - 可插拔的多执行器架构
//
// 每个执行器实现 ExecutorBackend 接口，系统自动选择最合适的执行器执行任务。
// 支持的执行器：WorkBuddy、OpenCode、Claude Code、Codex 等。

import { randomUUID } from 'node:crypto';

/**
 * 执行结果结构 - 所有执行器必须返回此格式
 */
export interface ExecutorResult {
  ok: boolean;
  stdout: string;
  stderr?: string;
  exitCode?: number;
  output?: unknown;
  failureReason?: string;
  durationMs: number;
}

/**
 * 任务结构 - 所有执行器接收的任务格式
 */
export interface ExecutorTask {
  taskId: string;
  proposalId: string;
  prompt: string;
  workingDirectory?: string;
  timeoutMs?: number;
  /** 项目 ID（用于执行器上下文追踪） */
  projectId?: string;
  /** 计划 ID（用于执行器上下文追踪） */
  planId?: string;
  /** 目标 ID（用于执行器上下文追踪） */
  goalId?: string;
}

/**
 * 执行器能力描述 - 与 AgentEndpointCapabilities 保持一致
 */
export interface ExecutorCapabilities {
  /** 执行器唯一标识 */
  id: string;
  /** 执行器名称 */
  name: string;
  /** 传输类型 */
  transport: 'workbuddy' | 'http' | 'cli' | 'stdio' | 'process';
  /** 风险等级 */
  risk?: 'low' | 'medium' | 'high';
  /** 是否支持接收 prompt */
  canAcceptPrompt?: boolean;
  /** 是否支持返回输出 */
  canReturnOutput?: boolean;
  /** 是否支持审查 */
  canReview?: boolean;
  /** 是否支持执行 */
  canExecute?: boolean;
  /** 是否支持摘要 */
  canSummarize?: boolean;
  /** 是否支持流式输出 */
  streaming?: boolean;
  /** 最大并发任务数 */
  maxConcurrency?: number;
  /** 特殊标签 */
  tags?: string[];
}

/**
 * 执行器后端接口 - 所有执行器必须实现此接口
 */
export interface ExecutorBackend {
  /** 执行器唯一标识 */
  readonly id: string;

  /** 返回执行器能力描述 */
  getCapabilities(): ExecutorCapabilities;

  /** 执行任务并返回结果 */
  execute(task: ExecutorTask): Promise<ExecutorResult>;

  /** 健康检查 - 返回 true 表示执行器可用 */
  healthCheck?(): Promise<boolean>;
}

/**
 * 执行器选择策略
 */
export type ExecutorSelectionStrategy =
  | 'auto'           // 自动选择最适合的执行器
  | 'round-robin'     // 轮询选择
  | 'capability-match'; // 按能力匹配

/**
 * 执行器注册表配置
 */
export interface ExecutorRegistryOptions {
  /** 选择策略 */
  selectionStrategy?: ExecutorSelectionStrategy;
  /** 默认执行器 ID */
  defaultExecutorId?: string;
  /** 健康检查间隔 (ms) */
  healthCheckIntervalMs?: number;
}

/**
 * 执行器注册表 - 管理所有可用的执行器
 */
export class ExecutorRegistry {
  private readonly executors = new Map<string, ExecutorBackend>();
  private readonly healthyExecutors = new Set<string>();
  private readonly selectionStrategy: ExecutorSelectionStrategy;
  private readonly defaultExecutorId?: string;
  private healthCheckIntervalMs: number;
  private healthCheckTimer?: ReturnType<typeof setInterval>;
  private roundRobinIndex = 0;

  constructor(options: ExecutorRegistryOptions = {}) {
    this.selectionStrategy = options.selectionStrategy ?? 'auto';
    this.defaultExecutorId = options.defaultExecutorId;
    this.healthCheckIntervalMs = options.healthCheckIntervalMs ?? 30_000;
  }

  /**
   * 注册执行器
   */
  register(executor: ExecutorBackend): void {
    if (this.executors.has(executor.id)) {
      console.warn(`[ExecutorRegistry] Executor ${executor.id} already registered, replacing`);
    }
    this.executors.set(executor.id, executor);
    this.healthyExecutors.add(executor.id);
    console.log(`[ExecutorRegistry] Registered executor: ${executor.id} (${executor.getCapabilities().name})`);
  }

  /**
   * 注销执行器
   */
  unregister(executorId: string): void {
    this.executors.delete(executorId);
    this.healthyExecutors.delete(executorId);
    console.log(`[ExecutorRegistry] Unregistered executor: ${executorId}`);
  }

  /**
   * 获取执行器
   */
  get(executorId: string): ExecutorBackend | undefined {
    return this.executors.get(executorId);
  }

  /**
   * 获取所有已注册的执行器
   */
  list(): ExecutorBackend[] {
    return Array.from(this.executors.values());
  }

  /**
   * 获取健康状态良好的执行器
   */
  listHealthy(): ExecutorBackend[] {
    return this.list().filter(e => this.healthyExecutors.has(e.id));
  }

  /**
   * 根据策略选择执行器
   */
  select(options?: { preferredTags?: string[] }): ExecutorBackend | undefined {
    const healthy = this.listHealthy();
    if (healthy.length === 0) {
      console.warn('[ExecutorRegistry] No healthy executors available');
      return undefined;
    }

    // 如果指定了默认执行器且它健康，优先使用
    if (this.defaultExecutorId && this.healthyExecutors.has(this.defaultExecutorId)) {
      return this.executors.get(this.defaultExecutorId);
    }

    switch (this.selectionStrategy) {
      case 'round-robin':
        return this.selectRoundRobin(healthy);

      case 'capability-match':
        return this.selectByCapability(healthy, options?.preferredTags);

      case 'auto':
      default:
        // 优先选择支持指定标签的执行器，否则返回第一个健康的
        if (options?.preferredTags && options.preferredTags.length > 0) {
          const matched = this.selectByCapability(healthy, options.preferredTags);
          if (matched) return matched;
        }
        return healthy[0];
    }
  }

  private selectRoundRobin(healthy: ExecutorBackend[]): ExecutorBackend {
    const executor = healthy[this.roundRobinIndex % healthy.length];
    this.roundRobinIndex++;
    return executor;
  }

  private selectByCapability(healthy: ExecutorBackend[], tags?: string[]): ExecutorBackend | undefined {
    if (!tags || tags.length === 0) {
      return healthy[0];
    }

    // 找到支持所有指定标签的执行器
    for (const executor of healthy) {
      const caps = executor.getCapabilities();
      const executorTags = new Set(caps.tags ?? []);
      if (tags.every(t => executorTags.has(t))) {
        return executor;
      }
    }

    // 找不到完全匹配的，返回第一个
    return healthy[0];
  }

  /**
   * 执行任务
   */
  async execute(task: ExecutorTask, options?: {
    executorId?: string;
    preferredTags?: string[];
  }): Promise<ExecutorResult> {
    const executor = options?.executorId
      ? this.get(options.executorId)
      : this.select({ preferredTags: options?.preferredTags });

    if (!executor) {
      return {
        ok: false,
        stdout: '',
        failureReason: 'no-available-executor',
        durationMs: 0,
      };
    }

    const startTime = Date.now();
    try {
      const result = await executor.execute(task);
      return {
        ...result,
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      return {
        ok: false,
        stdout: '',
        stderr: String(error),
        failureReason: `executor-error: ${String(error)}`,
        durationMs: Date.now() - startTime,
      };
    }
  }

  /**
   * 更新执行器健康状态
   */
  updateHealth(executorId: string, healthy: boolean): void {
    if (healthy) {
      this.healthyExecutors.add(executorId);
    } else {
      this.healthyExecutors.delete(executorId);
    }
  }

  /**
   * 获取执行器状态摘要
   */
  getStatus(): {
    total: number;
    healthy: number;
    executors: Array<{
      id: string;
      name: string;
      healthy: boolean;
      capabilities: ExecutorCapabilities;
    }>;
  } {
    const executors = this.list();
    return {
      total: executors.length,
      healthy: this.healthyExecutors.size,
      executors: executors.map(e => ({
        id: e.id,
        name: e.getCapabilities().name,
        healthy: this.healthyExecutors.has(e.id),
        capabilities: e.getCapabilities(),
      })),
    };
  }

  /**
   * 启动健康检查循环
   */
  startHealthCheck(onStatusChange?: (status: ReturnType<ExecutorRegistry['getStatus']>) => void): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
    }

    let healthCheckInProgress = false;

    // Use unref() to prevent timer from keeping the process alive
    // This allows the process to exit cleanly when all other work is done
    this.healthCheckTimer = setInterval(async () => {
      // Prevent concurrent health check batches (race condition fix)
      if (healthCheckInProgress) {
        return;
      }
      healthCheckInProgress = true;

      try {
        for (const executor of this.list()) {
          if (executor.healthCheck) {
            try {
              const healthy = await executor.healthCheck();
              this.updateHealth(executor.id, healthy);
            } catch (err) {
              console.error(`[ExecutorRegistry] Health check failed for ${executor.id}:`, err);
              this.updateHealth(executor.id, false);
            }
          }
        }
        onStatusChange?.(this.getStatus());
      } finally {
        healthCheckInProgress = false;
      }
    }, this.healthCheckIntervalMs);
    this.healthCheckTimer.unref();
  }

  /**
   * 停止健康检查循环
   */
  stopHealthCheck(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = undefined;
    }
  }
}

// ─── 全局执行器注册表单例 ───
let globalRegistry: ExecutorRegistry | undefined;

export function getExecutorRegistry(): ExecutorRegistry {
  if (!globalRegistry) {
    globalRegistry = new ExecutorRegistry();
  }
  return globalRegistry;
}

export function setExecutorRegistry(registry: ExecutorRegistry): void {
  globalRegistry = registry;
}
