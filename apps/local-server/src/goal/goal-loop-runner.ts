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
import { verifyStepOutput, VERIFICATION_ERROR_KEYWORDS, requiresVerification } from '../shared/step-verification.ts';
import { randomUUID } from 'node:crypto';
import { logger } from '../utils/structured-logger.ts';

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
  /** Gate 审批超时 (ms)，默认 30 分钟 */
  gateTimeoutMs?: number;
}

/** 默认 Gate 超时: 30 分钟 */
const DEFAULT_GATE_TIMEOUT_MS = 30 * 60 * 1000;

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
  status: 'pending' | 'dispatched' | 'expired';
  dispatchId?: string;
  /** 过期原因 */
  expiredReason?: string;
}

/**
 * 活跃执行记录（Gate 审批后分发到执行器的任务）
 */
interface ActiveExecution {
  executionId: string;
  stepId: string;
  goalId: string;
  planId: string;
  dispatchId: string;
  startedAt: number;
  stepKind: string;
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

  /** 活跃的执行（已分发到执行器的任务） */
  private readonly activeExecutions = new Map<string, ActiveExecution>();

  /** 活跃的 Goal Loop */
  private readonly activeLoops = new Map<string, {
    goalId: string;
    planId: string;
    stopRequested: boolean;
    startedAt: number;
    lastResult: AdvanceResult | null;
  }>();

  /** 轮询定时器 */
  private pollTimers = new Map<string, ReturnType<typeof setTimeout>>();

  /** 清理定时器 */
  private cleanupTimer?: ReturnType<typeof setInterval>;

  /** 清理间隔 (默认 5 分钟) */
  private readonly cleanupIntervalMs: number;

  /** Gate 审批超时 (默认 30 分钟) */
  private readonly gateTimeoutMs: number;

  constructor(
    runtime: BridgeRuntime,
    options: GoalLoopRunnerOptions = {},
  ) {
    this.runtime = runtime;
    this.cleanupIntervalMs = options.cleanupIntervalMs ?? 5 * 60 * 1000;
    this.gateTimeoutMs = options.gateTimeoutMs ?? DEFAULT_GATE_TIMEOUT_MS;
    this.options = {
      stepCeiling: options.stepCeiling ?? 10,
      pollIntervalMs: options.pollIntervalMs ?? 5000,
      autoVerify: options.autoVerify ?? true,
      verifyTimeoutMs: options.verifyTimeoutMs ?? 60_000,
      defaultExecutor: options.defaultExecutor ?? 'auto',
      cleanupIntervalMs: this.cleanupIntervalMs,
      gateTimeoutMs: this.gateTimeoutMs,
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
      goalId,
      planId,
      stopRequested: false,
      startedAt: Date.now(),
      lastResult: null,
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
    this.activeExecutions.clear();

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
        // 记录活跃执行：taskId 在 ExecutorResult 中
        const taskId = approval.executionId; // 使用 approval.executionId 作为 taskId
        this.activeExecutions.set(taskId, {
          executionId,
          stepId: approval.stepId,
          goalId: '', // 由 tick loop 填充
          planId: '', // 由 tick loop 填充
          dispatchId: result.executorId, // 执行器 ID
          startedAt: Date.now(),
          stepKind: approval.stepKind,
        });
        return {
          ok: true,
          taskId,
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
    const loopState = this.activeLoops.get(loopId);

    return {
      goalId,
      planId: plan?.id ?? '',
      currentStepIndex: plan?.steps.findIndex(s => s.status === 'pending' || s.status === 'running') ?? -1,
      totalSteps: plan?.steps.length ?? 0,
      goalStatus: goal?.status ?? 'unknown',
      planStatus: plan?.status ?? 'unknown',
      lastResult: loopState?.lastResult ?? null,
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

    // AR-011/AR-012: 检查活跃执行的结果
    await this.checkActiveExecutions(goalId, planId);

    // 推进 Orchestrator
    const result = this.orchestrator.advance(goalId);

    switch (result.type) {
      case 'step-gated':
        // 需要 Gate 审批
        this.handleStepGated(goalId, result);
        // 更新最后结果
        loopState.lastResult = result;
        // 继续轮询（等待审批）
        this.scheduleNextTick(loopId, goalId, planId);
        break;

      case 'step-completed':
        // 步骤完成，触发验证
        if (this.options.autoVerify && this.shouldVerify(result.stepKind)) {
          this.verifyStepCompletion(goalId, result);
        }
        // 更新最后结果
        loopState.lastResult = result;
        // 继续轮询
        this.scheduleNextTick(loopId, goalId, planId);
        break;

      case 'step-failed':
        // 步骤失败，停止
        loopState.lastResult = result;
        this.runtime.goalStore.cancelGoal(goalId);
        this.runtime.automationLoopStore.cancel(loopId);
        this.activeLoops.delete(loopId);
        break;

      case 'plan-completed':
        // 计划完成
        loopState.lastResult = result;
        this.runtime.goalStore.pausePlan(goalId, 'Goal completed');
        this.runtime.automationLoopStore.cancel(loopId);
        this.activeLoops.delete(loopId);
        break;

      case 'ceiling-reached':
        // 达到步数上限
        loopState.lastResult = result;
        logger.info('[GoalLoopRunner] Step ceiling reached', { stepCeiling: result.stepCeiling });
        this.scheduleNextTick(loopId, goalId, planId);
        break;

      case 'noop':
        // 无事可做（可能是所有步骤都在等待 Gate）
        // 检查 Gate 超时
        this.checkGateTimeouts(loopId);
        // noop 不更新 lastResult，保持上次状态
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
      stepIntent: step.intent,
      stepKind: step.kind,
      workingDirectory: undefined,
      timeoutMs: 120_000,
      createdAt: Date.now(),
      status: 'pending', // 初始状态为待审批
    });

    logger.info('[GoalLoopRunner] Step gated, awaiting approval', { stepId: step.id, stepKind: step.kind });
  }

  /**
   * AR-011/AR-012: 检查活跃执行的结果并更新状态
   *
   * 问题：tickGoalLoop() 从 AutomationLoopStore 读取待处理结果，
   * 但 WorkBuddyExecutionAdapter 是独立的 store。需要同步状态。
   */
  private async checkActiveExecutions(goalId: string, planId: string): Promise<void> {
    // 遍历所有活跃执行
    for (const [taskId, execution] of this.activeExecutions) {
      try {
        // 通过 runtime.workbuddyExecution.getResult() 查询执行结果
        const result = this.runtime.workbuddyExecution.getResult(taskId);
        if (result) {
          // 执行完成，处理结果
          if (result.ok) {
            // 先将步骤状态设为 running（completeStep 需要 running 状态）
            this.runtime.goalStore.markStepRunning(goalId, execution.stepId, Date.now());
            // 更新步骤输出
            const output = typeof result.output === 'string'
              ? result.output
              : (result.stdout ?? '');
            this.runtime.goalStore.completeStep(goalId, execution.stepId, output, Date.now());
            logger.info('[GoalLoopRunner] Step execution completed', {
              stepId: execution.stepId,
              durationMs: Date.now() - execution.startedAt
            });
          } else {
            // 执行失败
            const failureReason = result.failureReason ?? result.stderr ?? 'Execution failed';
            // 先将步骤状态设为 running（failStep 需要 running 状态）
            this.runtime.goalStore.markStepRunning(goalId, execution.stepId, Date.now());
            this.runtime.goalStore.failStep(goalId, execution.stepId, failureReason, Date.now());
            logger.error('[GoalLoopRunner] Step execution failed', {
              stepId: execution.stepId,
              error: failureReason
            });
          }
          // 从活跃执行中移除
          this.activeExecutions.delete(taskId);
        }
      } catch (err) {
        logger.warn('[GoalLoopRunner] Error checking execution result', { taskId, error: err });
      }
    }
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

    // 使用共享的验证函数
    const stepOutput = step.output ?? '';
    const verification = verifyStepOutput(stepOutput, { errorKeywords: VERIFICATION_ERROR_KEYWORDS });

    if (!verification.passed) {
      logger.warn('[GoalLoopRunner] Step verification failed', { stepId, reason: verification.reason });
      this.runtime.goalStore.failStep(goalId, stepId, verification.reason ?? 'Verification failed');
    } else {
      logger.info('[GoalLoopRunner] Step verification passed', { stepId });
    }
  }

  /**
   * 检查 Gate 审批超时
   *
   * 如果 pending gate 等待时间超过 gateTimeoutMs，则自动取消。
   * 这是防止 Gate 永远悬停导致 Loop 卡死的安全机制。
   */
  private checkGateTimeouts(loopId: string): void {
    const now = Date.now();
    const expiredGates: { executionId: string; approval: GateApproval }[] = [];

    for (const [executionId, approval] of this.pendingGateApprovals.entries()) {
      const waitingMs = now - approval.createdAt;
      if (waitingMs > this.gateTimeoutMs) {
        expiredGates.push({ executionId, approval });
        logger.warn('[GoalLoopRunner] Gate approval timed out', {
          executionId,
          stepId: approval.stepId,
          waitingMs,
          timeoutMs: this.gateTimeoutMs,
        });
      }
    }

    // 批量处理过期的 gates
    for (const { executionId, approval } of expiredGates) {
      // 标记 gate 为过期
      approval.status = 'expired';
      approval.expiredReason = `Gate approval timeout after ${this.gateTimeoutMs}ms`;

      // 获取关联的 goalId 并标记步骤失败
      const goalId = this.getGoalIdForLoop(loopId);
      if (goalId) {
        const plan = this.runtime.goalStore.getPlanByGoal(goalId);
        if (plan) {
          const step = plan.steps.find(s => s.id === approval.stepId);
          if (step) {
            this.runtime.goalStore.failStep(goalId, approval.stepId, approval.expiredReason);
            logger.warn('[GoalLoopRunner] Marked step as failed due to gate timeout', {
              goalId,
              stepId: approval.stepId,
              stepIntent: approval.stepIntent,
            });
          }
        }
      }

      // 清理
      this.pendingGateApprovals.delete(executionId);
    }

    if (expiredGates.length > 0) {
      logger.info('[GoalLoopRunner] Cleaned up expired gates', {
        count: expiredGates.length,
        loopId,
      });
    }
  }

  /**
   * 获取关联的 Goal ID
   */
  private getGoalIdForLoop(loopId: string): string | undefined {
    return this.activeLoops.get(loopId)?.goalId;
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
