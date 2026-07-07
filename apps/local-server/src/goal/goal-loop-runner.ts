// Goal Loop Runner - 完整的 Goal 驱动执行循环
//
// 整合 GoalOrchestrator、ExecutionDispatcher、WorkBuddy 执行器，
// 实现完整的 Goal → Plan → Gate → Execute → Audit 链路。
//
// ADR-0003 规范:
//   Goal -> Plan -> Approve Plan -> Auto-run Steps (非状态变更)
//   Gate 审批后执行状态变更步骤 -> 验证 -> Audit

import type { BridgeRuntime } from '../routes/bridge-api.ts';
import type { AutomationLoopRun } from '../../../../packages/shared/src/types.ts';
import { GoalOrchestrator, type AdvanceResult } from './goal-orchestrator.ts';
import { ExecutionDispatcher, createExecutionDispatcher } from '../execution/execution-dispatcher-v2.ts';
import { ExecutorRegistry, getExecutorRegistry } from '../execution/executor-registry.ts';
import { WorkBuddyExecutor, createWorkBuddyExecutor } from '../execution/workbuddy-executor.ts';
import { OpenCodeExecutor, createOpenCodeExecutor } from '../execution/opencode-executor.ts';
import { randomUUID } from 'node:crypto';
import { logger } from '../utils/structured-logger.ts';

/**
 * 错误关键词列表（用于检测 stderr 中的失败信号）
 */
const VERIFICATION_ERROR_KEYWORDS = [
  'error', 'failed', 'failure', 'panic', 'exception', 'fatal',
  'critical', 'cannot', 'unable to', 'permission denied',
  'no such file', 'command not found', 'not found',
];

export interface GoalLoopRunnerOptions {
  /** 步数上限 (ADR-0033 默认 10) */
  stepCeiling?: number;
  /** 轮询间隔 (ms) */
  pollIntervalMs?: number;
  /** 自动验证 */
  autoVerify?: boolean;
  /** 验证超时 (ms) */
  verifyTimeoutMs?: number;
  /** 默认执行器 */
  defaultExecutor?: 'workbuddy' | 'opencode' | 'auto';
  /** 清理间隔 (ms)，默认 5 分钟 */
  cleanupIntervalMs?: number;
}

export interface GoalLoopRunnerStatus {
  goalId: string;
  planId: string;
  currentStepIndex: number;
  totalSteps: number;
  goalStatus: string;
  planStatus: string;
  lastResult: AdvanceResult | null;
  executionStats: {
    stepsCompleted: number;
    stepsFailed: number;
    pendingGateApprovals: number;
  };
}

/**
 * Gate 审批记录
 */
interface GateApproval {
  executionId: string;
  stepId: string;
  stepIntent: string;
  stepKind: string;
  workingDirectory?: string;
  timeoutMs: number;
  createdAt: number;
}

/**
 * Goal Loop Runner - 完整的自动化执行循环
 *
 * 职责:
 * 1. 管理 GoalOrchestrator 和 ExecutionDispatcher 的交互
 * 2. 处理 Gate 审批流程
 * 3. 轮询执行结果
 * 4. 触发验证和 Audit
 */
export class GoalLoopRunner {
  private readonly runtime: BridgeRuntime;
  private readonly orchestrator: GoalOrchestrator;
  private readonly dispatcher: ExecutionDispatcher;
  private readonly registry: ExecutorRegistry;
  private readonly options: Required<GoalLoopRunnerOptions>;

  /** 活跃的 Gate 审批 */
  private readonly pendingGateApprovals = new Map<string, GateApproval>();

  /** 活跃的 Goal Loop */
  private readonly activeLoops = new Map<string, {
    stopRequested: boolean;
    startedAt: number;
  }>();

  /** 轮询定时器 */
  private pollTimers = new Map<string, ReturnType<typeof setTimeout>>();

  /** 清理定时器 */
  private cleanupTimer?: ReturnType<typeof setInterval>;

  /** 清理间隔 (默认 5 分钟) */
  private readonly cleanupIntervalMs: number;

  constructor(
    runtime: BridgeRuntime,
    options: GoalLoopRunnerOptions = {},
  ) {
    this.runtime = runtime;
    this.cleanupIntervalMs = options.cleanupIntervalMs ?? 5 * 60 * 1000;
    this.options = {
      stepCeiling: options.stepCeiling ?? 10,
      pollIntervalMs: options.pollIntervalMs ?? 5000,
      autoVerify: options.autoVerify ?? true,
      verifyTimeoutMs: options.verifyTimeoutMs ?? 60_000,
      defaultExecutor: options.defaultExecutor ?? 'auto',
      cleanupIntervalMs: this.cleanupIntervalMs,
    };

    this.orchestrator = new GoalOrchestrator(runtime.goalStore, {
      stepCeiling: this.options.stepCeiling,
    });

    this.registry = getExecutorRegistry();
    this.dispatcher = createExecutionDispatcher(this.registry);

    this.initializeExecutors();
    this.startCleanupTimer();
  }

  /**
   * 初始化执行器
   */
  private initializeExecutors(): void {
    // 注册 WorkBuddy 执行器
    if (!this.registry.get('workbuddy')) {
      const workbuddyExecutor = createWorkBuddyExecutor({
        adapter: this.runtime.workbuddyExecution,
        diagnosticMode: false,
      });
      this.registry.register(workbuddyExecutor);
      logger.info('[GoalLoopRunner] WorkBuddy executor registered');
    }

    // 注册 OpenCode 执行器（模拟模式，除非配置了真实路径）
    if (!this.registry.get('opencode')) {
      const opencodeExecutor = createOpenCodeExecutor({
        mockMode: true, // 默认模拟模式，避免在没有 OpenCode 时失败
      });
      this.registry.register(opencodeExecutor);
      logger.info('[GoalLoopRunner] OpenCode executor registered (mock mode)');
    }

    // 启动健康检查循环（如果尚未启动）
    const healthyCount = this.registry.listHealthy().length;
    logger.info('[GoalLoopRunner] Initial healthy executors', { healthyCount });
  }

  /**
   * 启动 Goal Loop
   */
  async start(goalId: string, planId: string): Promise<{
    ok: boolean;
    loopId?: string;
    error?: string;
  }> {
    const goal = this.runtime.goalStore.getGoal(goalId);
    if (!goal) {
      return { ok: false, error: `Goal ${goalId} not found` };
    }

    if (goal.status !== 'approved' && goal.status !== 'executing') {
      return { ok: false, error: `Goal must be approved or executing, got: ${goal.status}` };
    }

    const plan = this.runtime.goalStore.getPlanByGoal(goalId);
    if (!plan) {
      return { ok: false, error: `Plan for goal ${goalId} not found` };
    }

    // 创建并启动 Automation Loop
    const loop = this.runtime.automationLoopStore.create({
      projectId: 'cli-bridge',
      goalId,
      sourceEndpointId: 'local-orchestrator',
      targetEndpointId: 'local-executor',
      maxCycles: this.options.stepCeiling,
      noProgressLimit: 3,
      deadlineAt: Date.now() + 30 * 60 * 1000, // 30 分钟超时
    });

    // 必须调用 start() 将状态从 'draft' 变为 'running'
    this.runtime.automationLoopStore.start(loop.id);

    // 记录活跃 Loop
    this.activeLoops.set(loop.id, {
      stopRequested: false,
      startedAt: Date.now(),
    });

    // 启动轮询
    this.scheduleNextTick(loop.id, goalId, planId);

    return { ok: true, loopId: loop.id };
  }

  /**
   * 停止 Goal Loop
   */
  stop(loopId: string): void {
    const loop = this.activeLoops.get(loopId);
    if (loop) {
      loop.stopRequested = true;
    }

    // 清除轮询定时器
    const timer = this.pollTimers.get(loopId);
    if (timer) {
      clearTimeout(timer);
      this.pollTimers.delete(loopId);
    }

    this.activeLoops.delete(loopId);
    // 使用 cancel 代替不存在的 stop 方法
    this.runtime.automationLoopStore.cancel(loopId);
  }

  /**
   * 停止所有 Goal Loops 并清理资源
   */
  dispose(): void {
    // 停止所有活跃的 loops
    for (const loopId of this.activeLoops.keys()) {
      this.stop(loopId);
    }

    // 停止清理定时器
    this.stopCleanup();

    // 清理所有 pending gates
    this.pendingGateApprovals.clear();

    logger.info('[GoalLoopRunner] Disposed all resources');
  }

  /**
   * 审批 Gate（用户操作）
   */
  async approveGate(executionId: string): Promise<{
    ok: boolean;
    taskId?: string;
    error?: string;
  }> {
    const approval = this.pendingGateApprovals.get(executionId);
    if (!approval) {
      return { ok: false, error: 'Gate approval not found' };
    }

    try {
      // 分发任务到执行器
      const result = await this.dispatcher.dispatch({
        taskId: approval.executionId,
        proposalId: approval.stepId,
        prompt: approval.stepIntent,
        expectedOutput: 'any',
        workingDirectory: approval.workingDirectory,
        timeoutMs: approval.timeoutMs,
        preferredExecutor: this.options.defaultExecutor === 'auto' ? undefined : this.options.defaultExecutor,
      });

      if (result.ok) {
        return {
          ok: true,
          taskId: result.result.output as string | undefined,
        };
      } else {
        return {
          ok: false,
          error: result.result.failureReason ?? 'Execution failed',
        };
      }
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * 获取待审批的 Gate 列表
   */
  getPendingGates(): Array<{
    executionId: string;
    stepId: string;
    stepIntent: string;
    stepKind: string;
    waitingMs: number;
  }> {
    const now = Date.now();
    return Array.from(this.pendingGateApprovals.entries()).map(([id, a]) => ({
      executionId: id,
      stepId: a.stepId,
      stepIntent: a.stepIntent,
      stepKind: a.stepKind,
      waitingMs: now - a.createdAt,
    }));
  }

  /**
   * 获取 Loop 状态
   */
  getStatus(loopId: string): GoalLoopRunnerStatus | null {
    const loop = this.runtime.automationLoopStore.get(loopId);
    if (!loop) return null;

    const goalId = loop.goalId ?? '';
    const goal = this.runtime.goalStore.getGoal(goalId);
    const plan = goalId ? this.runtime.goalStore.getPlanByGoal(goalId) : null;

    return {
      goalId,
      planId: plan?.id ?? '',
      currentStepIndex: plan?.steps.findIndex(s => s.status === 'pending' || s.status === 'running') ?? -1,
      totalSteps: plan?.steps.length ?? 0,
      goalStatus: goal?.status ?? 'unknown',
      planStatus: plan?.status ?? 'unknown',
      lastResult: null,
      executionStats: {
        stepsCompleted: plan?.steps.filter(s => s.status === 'done').length ?? 0,
        stepsFailed: plan?.steps.filter(s => s.status === 'failed').length ?? 0,
        pendingGateApprovals: this.pendingGateApprovals.size,
      },
    };
  }

  // ─── 私有方法 ───

  /**
   * 调度下一次 Tick
   */
  private scheduleNextTick(loopId: string, goalId: string, planId: string): void {
    const timer = setTimeout(async () => {
      try {
        await this.tick(loopId, goalId, planId);
      } catch (err) {
        logger.error('[GoalLoopRunner] Tick error', { error: err instanceof Error ? err.message : String(err) });
        // Stop the loop on tick error
        this.stop(loopId);
      }
    }, this.options.pollIntervalMs);

    this.pollTimers.set(loopId, timer);
  }

  /**
   * 执行 Tick
   */
  private async tick(loopId: string, goalId: string, planId: string): Promise<void> {
    // 检查 Loop 状态
    const loopState = this.activeLoops.get(loopId);
    if (!loopState || loopState.stopRequested) {
      return;
    }

    const loop = this.runtime.automationLoopStore.get(loopId);
    if (!loop || loop.status === 'done' || loop.status === 'failed' || loop.status === 'cancelled') {
      this.activeLoops.delete(loopId);
      return;
    }

    // 推进 Orchestrator
    const result = this.orchestrator.advance(goalId);

    switch (result.type) {
      case 'step-gated':
        // 需要 Gate 审批
        this.handleStepGated(goalId, result);
        // 继续轮询（等待审批）
        this.scheduleNextTick(loopId, goalId, planId);
        break;

      case 'step-completed':
        // 步骤完成，触发验证
        if (this.options.autoVerify && this.shouldVerify(result.stepKind)) {
          this.verifyStepCompletion(goalId, result);
        }
        // 继续轮询
        this.scheduleNextTick(loopId, goalId, planId);
        break;

      case 'step-failed':
        // 步骤失败，停止
        // 使用 cancelGoal 代替 updateGoalStatus
        this.runtime.goalStore.cancelGoal(goalId);
        this.runtime.automationLoopStore.cancel(loopId);
        this.activeLoops.delete(loopId);
        break;

      case 'plan-completed':
        // 计划完成 - 使用 cancelGoal 并设置 status 为 done
        // 注意: cancelGoal 不会设置 done 状态，需要用其他方式
        // 暂时使用 pausePlan 作为替代
        this.runtime.goalStore.pausePlan(goalId, 'Goal completed');
        this.runtime.automationLoopStore.cancel(loopId);
        this.activeLoops.delete(loopId);
        break;

      case 'ceiling-reached':
        // 达到步数上限
        logger.info('[GoalLoopRunner] Step ceiling reached', { stepCeiling: result.stepCeiling });
        this.scheduleNextTick(loopId, goalId, planId);
        break;

      case 'noop':
        // 无事可做（可能是所有步骤都在等待 Gate）
        this.scheduleNextTick(loopId, goalId, planId);
        break;

      default:
        logger.warn('[GoalLoopRunner] Unknown advance result', { result });
        this.scheduleNextTick(loopId, goalId, planId);
    }
  }

  /**
   * 处理步骤 Gate
   */
  private handleStepGated(goalId: string, result: Extract<AdvanceResult, { type: 'step-gated' }>): void {
    const plan = this.runtime.goalStore.getPlanByGoal(goalId);
    if (!plan) return;

    const step = plan.steps.find(s => s.id === result.stepId);
    if (!step) return;

    // 创建 Gate 审批记录
    const executionId = randomUUID();
    this.pendingGateApprovals.set(executionId, {
      executionId,
      stepId: step.id,
      stepIntent: step.intent, // PlanStep 有 intent 字段
      stepKind: step.kind,
      workingDirectory: undefined, // PlanStep 没有 workingDirectory
      timeoutMs: 120_000, // 默认超时
      createdAt: Date.now(),
    });

    logger.info('[GoalLoopRunner] Step gated, awaiting approval', { stepId: step.id, stepKind: step.kind });
  }

  /**
   * 验证步骤完成
   */
  private async verifyStepCompletion(goalId: string, result: Extract<AdvanceResult, { type: 'step-completed' }>): Promise<void> {
    const stepId = result.stepId;

    // 获取步骤输出（从 PlanStore）
    const plan = this.runtime.goalStore.getPlanByGoal(goalId);
    if (!plan) return;

    const step = plan.steps.find(s => s.id === stepId);
    if (!step) return;

    // 检查 stderr 中的错误关键词
    const stepOutput = step.output ?? '';
    let verificationPassed = true;
    let failureReason = '';

    // 如果步骤包含执行结果，检查错误关键词
    if (stepOutput && typeof stepOutput === 'string') {
      const outputLower = stepOutput.toLowerCase();
      for (const keyword of VERIFICATION_ERROR_KEYWORDS) {
        if (outputLower.includes(keyword)) {
          // 检查误报
          if (!this.isLikelyFalsePositive(keyword, stepOutput)) {
            verificationPassed = false;
            failureReason = `Error keyword "${keyword}" found in output`;
            break;
          }
        }
      }
    }

    if (!verificationPassed) {
      logger.warn('[GoalLoopRunner] Step verification failed', { stepId, reason: failureReason });
      this.runtime.goalStore.failStep(goalId, stepId, failureReason);
    } else {
      logger.info('[GoalLoopRunner] Step verification passed', { stepId });
    }
  }

  /**
   * 检测误报：某些关键词在成功输出中也可能出现
   */
  private isLikelyFalsePositive(keyword: string, output: string): boolean {
    const falsePositivePatterns: Record<string, RegExp[]> = {
      'not found': [/could not find.*but continuing/i, /warning.*not found/i, /file not found.*skipping/i],
      'error': [/no error/i, /error handling/i, /error-codes/i],
      'failed': [/did not fail/i, /test failed.*expected/i],
    };

    const patterns = falsePositivePatterns[keyword.toLowerCase()];
    if (!patterns) return false;

    return patterns.some(pattern => pattern.test(output));
  }

  /**
   * 检查步骤是否需要验证
   */
  private shouldVerify(stepKind: string): boolean {
    return ['run-command', 'apply-patch', 'write-file'].includes(stepKind);
  }

  /**
   * 启动清理定时器 - 定期清理过期的 pending gates
   */
  private startCleanupTimer(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }

    this.cleanupTimer = setInterval(() => {
      this.cleanupStaleGates();
    }, this.cleanupIntervalMs);

    logger.info('[GoalLoopRunner] Cleanup timer started', { intervalMs: this.cleanupIntervalMs });
  }

  /**
   * 清理过期的 pending gates（超过 5 分钟未审批）
   */
  private cleanupStaleGates(): number {
    const now = Date.now();
    const maxAgeMs = this.cleanupIntervalMs;
    let cleaned = 0;

    for (const [id, gate] of this.pendingGateApprovals.entries()) {
      if (now - gate.createdAt > maxAgeMs) {
        this.pendingGateApprovals.delete(id);
        cleaned++;
        logger.warn('[GoalLoopRunner] Stale gate cleaned', { gateId: id, stepId: gate.stepId, ageMs: now - gate.createdAt });
      }
    }

    if (cleaned > 0) {
      logger.info('[GoalLoopRunner] Cleaned stale gates', { count: cleaned });
    }

    return cleaned;
  }

  /**
   * 停止清理定时器
   */
  public stopCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
      logger.info('[GoalLoopRunner] Cleanup timer stopped');
    }
  }

  /**
   * 获取清理统计
   */
  getCleanupStats(): { pendingGates: number; oldestGateMs: number | null } {
    const now = Date.now();
    let oldestAgeMs: number | null = null;

    for (const gate of this.pendingGateApprovals.values()) {
      const age = now - gate.createdAt;
      if (oldestAgeMs === null || age > oldestAgeMs) {
        oldestAgeMs = age;
      }
    }

    return {
      pendingGates: this.pendingGateApprovals.size,
      oldestGateMs: oldestAgeMs,
    };
  }
}

/**
 * 创建 Goal Loop Runner
 */
export function createGoalLoopRunner(
  runtime: BridgeRuntime,
  options?: GoalLoopRunnerOptions,
): GoalLoopRunner {
  return new GoalLoopRunner(runtime, options);
}
