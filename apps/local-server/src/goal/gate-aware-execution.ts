// Gate-Aware Execution Integration - Gate 审批后触发执行
//
// 将 GoalOrchestrator 的 step-gated 结果连接到 ExecutionDispatcher，
// 实现 Gate 审批后的自动执行。
//
// 流程:
//   1. tickGoalLoop 返回 step-gated
//   2. 等待用户 Gate 审批 (通过 /bridge/goals/:id/steps/:stepId/gate-approve)
//   3. 审批后，dispatcher 执行任务
//   4. 执行结果通过 inbox/next 传递给 WorkBuddy/Codex
//   5. 结果写入 result store
//   6. tickGoalLoop 检测结果，继续推进

import type { BridgeRuntime } from '../routes/bridge-api.ts';
import type { AutomationLoopRun } from '../../../../packages/shared/src/types.ts';
import { GoalLoopConfig, parseGoalLoopConfig, tickGoalLoop } from './goal-automation-loop.ts';
import { ExecutionDispatcher, createExecutionDispatcher } from '../execution/execution-dispatcher-v2.ts';
import { randomUUID } from 'node:crypto';

/**
 * Gate-Aware Execution Integration
 *
 * 负责:
 * 1. 监听 step-gated 事件
 * 2. 等待 Gate 审批
 * 3. 触发执行
 * 4. 轮询执行结果
 */
export class GateAwareExecutionIntegration {
  private readonly runtime: BridgeRuntime;
  private readonly dispatcher: ExecutionDispatcher;
  private readonly pendingGateApprovals = new Map<string, {
    goalId: string;
    stepId: string;
    planId: string;
    prompt: string;
    workingDirectory?: string;
    timeoutMs: number;
    createdAt: number;
  }>();

  constructor(runtime: BridgeRuntime, dispatcher?: ExecutionDispatcher) {
    this.runtime = runtime;
    this.dispatcher = dispatcher ?? createExecutionDispatcher();
  }

  /**
   * 注册 Gate 审批后的执行
   *
   * 当 tickGoalLoop 返回 step-gated 时调用此方法。
   * 返回一个 pending 的执行任务 ID。
   */
  registerPendingGateExecution(params: {
    goalId: string;
    stepId: string;
    planId: string;
    prompt: string;
    workingDirectory?: string;
    timeoutMs?: number;
  }): string {
    const executionId = randomUUID();

    this.pendingGateApprovals.set(executionId, {
      goalId: params.goalId,
      stepId: params.stepId,
      planId: params.planId,
      prompt: params.prompt,
      workingDirectory: params.workingDirectory,
      timeoutMs: params.timeoutMs ?? 120_000,
      createdAt: Date.now(),
    });

    return executionId;
  }

  /**
   * 执行 Gate 审批的任务
   *
   * 当用户审批 Gate 时调用。
   * 分发任务到执行器（WorkBuddy 或 Codex）。
   */
  async executeApprovedGate(executionId: string): Promise<{
    ok: boolean;
    taskId?: string;
    error?: string;
  }> {
    const pending = this.pendingGateApprovals.get(executionId);
    if (!pending) {
      return { ok: false, error: 'Execution not found or already processed' };
    }

    try {
      // 通过 WorkBuddy 分发任务
      const result = await this.dispatcher.dispatch({
        taskId: randomUUID(),
        proposalId: pending.stepId,
        prompt: pending.prompt,
        expectedOutput: 'any',
        workingDirectory: pending.workingDirectory,
        timeoutMs: pending.timeoutMs,
        preferredExecutor: 'workbuddy',
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
   * 检查执行结果
   */
  getExecutionResult(executionId: string): {
    pending: boolean;
    result?: {
      ok: boolean;
      stdout?: string;
      stderr?: string;
      exitCode?: number;
    };
  } {
    const pending = this.pendingGateApprovals.get(executionId);
    if (!pending) {
      return { pending: false };
    }

    // 从 WorkBuddy adapter 获取结果
    const taskId = pending.stepId; // 使用 stepId 作为 taskId
    const result = this.runtime.workbuddyExecution.getResult(taskId);

    if (result) {
      // 任务已完成，清理 pending
      this.pendingGateApprovals.delete(executionId);
      return {
        pending: false,
        result: {
          ok: result.ok,
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode,
        },
      };
    }

    return { pending: true };
  }

  /**
   * 获取所有待审批的执行
   */
  getPendingExecutions(): Array<{
    executionId: string;
    goalId: string;
    stepId: string;
    planId: string;
    prompt: string;
    createdAt: number;
    waitingMs: number;
  }> {
    const now = Date.now();
    return Array.from(this.pendingGateApprovals.entries()).map(([id, p]) => ({
      executionId: id,
      goalId: p.goalId,
      stepId: p.stepId,
      planId: p.planId,
      prompt: p.prompt,
      createdAt: p.createdAt,
      waitingMs: now - p.createdAt,
    }));
  }

  /**
   * 清理过期的 pending 执行（超过 5 分钟）
   */
  cleanupExpiredExecutions(maxAgeMs = 5 * 60 * 1000): number {
    const now = Date.now();
    let cleaned = 0;

    for (const [id, p] of this.pendingGateApprovals.entries()) {
      if (now - p.createdAt > maxAgeMs) {
        this.pendingGateApprovals.delete(id);
        cleaned++;
      }
    }

    return cleaned;
  }
}

/**
 * 创建 Gate-Aware Execution Integration
 */
export function createGateAwareExecutionIntegration(
  runtime: BridgeRuntime,
  dispatcher?: ExecutionDispatcher,
): GateAwareExecutionIntegration {
  return new GateAwareExecutionIntegration(runtime, dispatcher);
}

// ─── 全局实例 ───
let globalIntegration: GateAwareExecutionIntegration | undefined;

export function getGateAwareExecutionIntegration(runtime: BridgeRuntime): GateAwareExecutionIntegration {
  if (!globalIntegration) {
    globalIntegration = createGateAwareExecutionIntegration(runtime);
  }
  return globalIntegration;
}
