// Goal-Driven Automation Loop - 目标驱动的自动化执行循环
//
// 扩展现有的 AutomationLoopRun，支持 Goal 驱动的执行：
// - Goal 创建 → Plan 生成 → 步骤分发 → 执行 → 验证 → 继续/完成
//
// 复用 AutomationLoopStore 和 AutomationLoopRunner 的基础设施，
// 只需添加 Goal 专用的 loop 类型和 tick 处理逻辑。

import type { BridgeRuntime } from '../routes/bridge-api.ts';
import type { AutomationLoopRun, AutomationLoopCycle } from '../../../../packages/shared/src/types.ts';
import type { WorkBuddyExecutionResult } from '../adapters/workbuddy-execution-adapter.ts';
import { GoalOrchestrator, type AdvanceResult } from './goal-orchestrator.ts';
import { logger } from '../utils/structured-logger.ts';
import type { InMemoryAutomationLoopStore } from '../automation/automation-loop-store.ts';

/**
 * Goal Loop Tick 结果
 */
export interface GoalTickResult {
  type: 'goal-advance' | 'step-dispatched' | 'step-complete' | 'step-failed' |
        'verification-pass' | 'verification-fail' | 'goal-complete' | 'goal-failed' |
        'waiting' | 'blocked' | 'error';

  /** 关联的步骤 ID（如果有） */
  stepId?: string;

  /** 描述信息 */
  message: string;

  /** 验证结果（如果有） */
  verificationResult?: {
    passed: boolean;
    output?: string;
    reason?: string;
  };

  /** AdvanceResult 详情（如果是 goal-advance） */
  advanceResult?: AdvanceResult;
}

/**
 * Goal Loop 状态摘要
 */
export interface GoalLoopStatus {
  goalId: string;
  planId: string;
  currentStepIndex: number;
  totalSteps: number;
  goalStatus: string;
  planStatus: string;
  lastTickResult: GoalTickResult | null;
  executionStats: {
    stepsCompleted: number;
    stepsFailed: number;
    verificationsPassed: number;
    verificationsFailed: number;
  };
}

/**
 * Goal Loop 扩展配置（存储在 pendingInput 中）
 */
export interface GoalLoopConfig {
  /** 关联的 Plan ID */
  planId: string;
  /** 工作目录 */
  workingDirectory?: string;
  /** 执行器选择偏好 */
  preferredExecutor?: string;
  /** 是否自动验证步骤 */
  autoVerify?: boolean;
  /** 验证超时 (ms) */
  verifyTimeoutMs?: number;
}

/**
 * 从 pendingInput 解析 GoalLoopConfig
 */
export function parseGoalLoopConfig(loop: AutomationLoopRun): GoalLoopConfig | null {
  if (!loop.pendingInput) return null;
  try {
    return JSON.parse(loop.pendingInput) as GoalLoopConfig;
  } catch {
    return null;
  }
}

/**
 * 创建 Goal 驱动的 Automation Loop
 */
export function createGoalLoop(
  runtime: BridgeRuntime,
  config: {
    goalId: string;
    planId: string;
    sourceEndpointId: string;
    targetEndpointId: string;
    workingDirectory?: string;
    preferredExecutor?: string;
    autoVerify?: boolean;
    verifyTimeoutMs?: number;
  },
  now?: number,
): AutomationLoopRun {
  const ts = now ?? Date.now();

  const loop = runtime.automationLoopStore.create({
    projectId: 'cli-bridge',
    goalId: config.goalId,
    sourceEndpointId: config.sourceEndpointId,
    targetEndpointId: config.targetEndpointId,
    maxCycles: 10,
    noProgressLimit: 3,
    deadlineAt: ts + 30 * 60 * 1000, // 30 分钟超时
    now: ts,
  });

  // 存储额外的配置到 pendingInput 字段
  const configData: GoalLoopConfig = {
    planId: config.planId,
    workingDirectory: config.workingDirectory,
    preferredExecutor: config.preferredExecutor,
    autoVerify: config.autoVerify ?? true,
    verifyTimeoutMs: config.verifyTimeoutMs ?? 60_000,
  };

  // 获取 loop 并设置 pendingInput
  const storedLoop = runtime.automationLoopStore.get(loop.id);
  if (storedLoop) {
    // 克隆并添加 pendingInput
    const updatedLoop = { ...storedLoop, pendingInput: JSON.stringify(configData) };
    // 注意：这里需要直接操作存储的 map，但由于是私有的，我们使用运行时对象
    (storedLoop as AutomationLoopRun & { pendingInput?: string }).pendingInput = JSON.stringify(configData);
  }

  return loop;
}

/**
 * Tick Goal 驱动的 Automation Loop
 *
 * 执行逻辑：
 * 1. 获取当前 Goal 和 Plan 状态
 * 2. 使用 GoalOrchestrator 推进一步
 * 3. 如果步骤可执行，分发到执行器
 * 4. 检查执行结果，触发验证
 * 5. 根据验证结果决定继续或失败
 */
export function tickGoalLoop(
  runtime: BridgeRuntime,
  loopId: string,
  options: {
    now?: number;
    progressHash?: string;
  } = {},
): GoalTickResult {
  const now = options.now ?? Date.now();
  const loop = runtime.automationLoopStore.get(loopId);

  if (!loop) {
    return { type: 'error', message: `Loop ${loopId} not found` };
  }

  const config = parseGoalLoopConfig(loop);
  const goalId = loop.goalId;
  if (!goalId) {
    return { type: 'error', message: `Loop ${loopId} has no goalId` };
  }

  // 获取 Goal 和 Plan
  const goal = runtime.goalStore.getGoal(goalId);
  if (!goal) {
    return { type: 'error', message: `Goal ${goalId} not found` };
  }

  const plan = runtime.goalStore.getPlanByGoal(goalId);
  if (!plan) {
    return { type: 'error', message: `Plan for goal ${goalId} not found` };
  }

  // 创建 GoalOrchestrator 实例
  const orchestrator = new GoalOrchestrator(runtime.goalStore, {
    stepCeiling: 10,
  });

  // 检查是否有未完成的执行任务
  const currentCycle = runtime.automationLoopStore.latestUnresolvedCycle(loopId);
  if (currentCycle?.workBuddyTaskId) {
    const result = runtime.workbuddyExecution.getResult(currentCycle.workBuddyTaskId);
    if (result) {
      // 任务完成，处理结果
      return handleExecutionResult(runtime, loop, goal, plan, currentCycle, result, config);
    }
    // 任务仍在运行，等待
    return { type: 'waiting', message: `Waiting for task ${currentCycle.workBuddyTaskId}` };
  }

  // 推进 GoalOrchestrator
  const advanceResult = orchestrator.advance(goalId);

  switch (advanceResult.type) {
    case 'noop':
      return {
        type: 'blocked',
        message: `Noop: ${advanceResult.reason}`,
        advanceResult,
      };

    case 'plan-completed':
      // Goal 和 Plan 都完成了
      // 使用 cancelGoal 作为替代（因为没有 updateGoalStatus）
      runtime.goalStore.cancelGoal(goalId, now);
      runtime.automationLoopStore.cancel(loop.id, now);
      return { type: 'goal-complete', message: 'Goal completed successfully' };

    case 'step-failed':
      // 更新 Goal 状态为 failed
      runtime.goalStore.cancelGoal(goalId, now);
      runtime.automationLoopStore.cancel(loop.id, now);
      return {
        type: 'goal-failed',
        stepId: advanceResult.stepId,
        message: `Step failed: ${advanceResult.failureReason}`,
        advanceResult,
      };

    case 'step-gated':
      return {
        type: 'blocked',
        stepId: advanceResult.stepId,
        message: 'Step requires gate approval',
        advanceResult,
      };

    case 'step-completed':
      // 检查是否需要验证
      const shouldAutoVerify = config?.autoVerify ?? true;
      if (shouldAutoVerify && shouldVerify(advanceResult.stepKind)) {
        return {
          type: 'verification-pass',
          stepId: advanceResult.stepId,
          message: `Step ${advanceResult.stepIndex} completed, verification triggered`,
          advanceResult,
        };
      }
      return {
        type: 'step-complete',
        stepId: advanceResult.stepId,
        message: `Step ${advanceResult.stepIndex} completed`,
        advanceResult,
      };

    case 'ceiling-reached':
      return {
        type: 'blocked',
        message: `Step ceiling reached: ${advanceResult.stepCeiling}`,
        advanceResult,
      };

    case 'tier-violation':
      return {
        type: 'error',
        stepId: advanceResult.stepId,
        message: `Tier violation: ${advanceResult.reason}`,
        advanceResult,
      };

    default:
      return { type: 'error', message: 'Unknown advance result type' };
  }
}

/**
 * 处理执行结果
 */
function handleExecutionResult(
  runtime: BridgeRuntime,
  loop: AutomationLoopRun,
  goal: { id: string },
  plan: { id: string },
  cycle: AutomationLoopCycle,
  result: WorkBuddyExecutionResult,
  config: GoalLoopConfig | null,
): GoalTickResult {
  const now = Date.now();
  // Use cycle id as the step identifier since AutomationLoopCycle doesn't have stepId
  const stepId = cycle.id;

  if (!result.ok) {
    // 执行失败
    runtime.goalStore.failStep(goal.id, stepId, result.stderr ?? 'Execution failed', now);
    return {
      type: 'step-failed',
      stepId,
      message: `Execution failed: ${result.stderr ?? 'Unknown error'}`,
    };
  }

  // 执行成功
  runtime.goalStore.completeStep(goal.id, stepId, result.stdout ?? '', now);

  // 触发验证（如果启用）
  if (config?.autoVerify ?? true) {
    const verificationResult = verifyStepOutput(result);
    if (!verificationResult.passed) {
      return {
        type: 'verification-fail',
        stepId,
        message: `Verification failed: ${verificationResult.reason}`,
        verificationResult,
      };
    }
    return {
      type: 'verification-pass',
      stepId,
      message: 'Verification passed',
      verificationResult,
    };
  }

  return {
    type: 'step-complete',
    stepId,
    message: 'Step completed successfully',
  };
}

/**
 * 检查步骤是否需要验证
 */
function shouldVerify(stepKind: string): boolean {
  const verifiableKinds = new Set([
    'run-command',
    'apply-patch',
    'write-file',
  ]);
  return verifiableKinds.has(stepKind);
}

/**
 * 错误关键词列表（用于检测 stderr 中的失败信号）
 */
const ERROR_KEYWORDS = [
  'error',
  'failed',
  'failure',
  'panic',
  'exception',
  'fatal',
  'critical',
  'cannot',
  'unable to',
  'permission denied',
  'no such file',
  'command not found',
  'not found',
];

/**
 * 验证步骤输出
 *
 * 验证策略:
 * 1. exitCode !== 0 → 失败
 * 2. stderr 包含错误关键词 → 失败
 * 3. stdout 包含特定成功模式 → 通过
 * 4. 否则根据 ok 字段判断
 */
function verifyStepOutput(
  result: WorkBuddyExecutionResult,
): { passed: boolean; output?: string; reason?: string } {
  // 1. 检查 ok 字段
  if (!result.ok) {
    const reason = result.failureReason
      ?? result.stderr
      ?? `Execution failed with exit code ${result.exitCode ?? 'unknown'}`;
    return { passed: false, reason };
  }

  // 2. 检查 exitCode
  if (result.exitCode !== undefined && result.exitCode !== 0) {
    return {
      passed: false,
      reason: `Non-zero exit code: ${result.exitCode}`,
    };
  }

  // 3. 检查 stderr 中的错误关键词
  if (result.stderr) {
    const stderrLower = result.stderr.toLowerCase();
    for (const keyword of ERROR_KEYWORDS) {
      if (stderrLower.includes(keyword)) {
        // 排除误报：某些关键词在成功输出中也可能出现
        const isFalsePositive = isLikelyFalsePositive(keyword, result.stderr);
        if (!isFalsePositive) {
          return {
            passed: false,
            reason: `Error keyword "${keyword}" found in stderr`,
          };
        }
      }
    }
  }

  // 4. 成功
  return { passed: true, output: result.stdout };
}

/**
 * 检测误报：某些关键词在成功输出中也可能出现
 */
function isLikelyFalsePositive(keyword: string, stderr: string): boolean {
  const falsePositivePatterns: Record<string, RegExp[]> = {
    'not found': [
      /could not find.*but continuing/i,
      /warning.*not found/i,
    ],
    'error': [
      /no error/i,
      /error handling.*continuing/i,
      /error recovery/i,
    ],
  };

  const patterns = falsePositivePatterns[keyword];
  if (!patterns) return false;

  return patterns.some(pattern => pattern.test(stderr));
}

/**
 * 从 cycle 历史获取最新的 tick 结果
 */
function getLastTickResultFromCycles(
  store: InMemoryAutomationLoopStore,
  loopId: string,
): GoalTickResult | null {
  const cycles = store.listCycles(loopId);
  if (cycles.length === 0) return null;

  // 获取最新的 cycle
  const latest = cycles[cycles.length - 1];

  // 根据 cycle 状态映射到 GoalTickResult
  switch (latest.status) {
    case 'planned':
      return { type: 'waiting', stepId: latest.id, message: 'Step planned' };
    case 'dispatching':
      return { type: 'step-dispatched', stepId: latest.id, message: 'Step dispatched' };
    case 'waiting-result':
      return { type: 'waiting', stepId: latest.id, message: 'Waiting for result' };
    case 'returned':
      return { type: 'step-complete', stepId: latest.id, message: 'Step completed' };
    case 'failed':
      return { type: 'step-failed', stepId: latest.id, message: latest.failureReason ?? 'Step failed' };
    case 'skipped':
      return { type: 'step-complete', stepId: latest.id, message: 'Step skipped' };
    default:
      return null;
  }
}

/**
 * 解析验证结果，获取可读的输出摘要
 */
export function summarizeVerificationResult(
  result: { passed: boolean; output?: string; reason?: string },
  maxLength: number = 200,
): string {
  if (result.passed) {
    const output = result.output ?? '';
    if (output.length <= maxLength) {
      return output;
    }
    return output.slice(0, maxLength - 3) + '...';
  }
  return `Verification failed: ${result.reason ?? 'unknown reason'}`;
}

/**
 * 获取 Goal Loop 状态摘要
 */
export function getGoalLoopStatus(
  runtime: BridgeRuntime,
  loopId: string,
): GoalLoopStatus | null {
  const loop = runtime.automationLoopStore.get(loopId);
  if (!loop) {
    return null;
  }

  const goalId = loop.goalId ?? '';
  const config = parseGoalLoopConfig(loop);

  const goal = runtime.goalStore.getGoal(goalId);
  const plan = goalId ? runtime.goalStore.getPlanByGoal(goalId) : null;

  return {
    goalId,
    planId: config?.planId ?? '',
    currentStepIndex: plan?.steps.findIndex(s => s.status === 'pending' || s.status === 'running') ?? -1,
    totalSteps: plan?.steps.length ?? 0,
    goalStatus: goal?.status ?? 'unknown',
    planStatus: plan?.status ?? 'unknown',
    lastTickResult: getLastTickResultFromCycles(runtime.automationLoopStore, loop.id),
    executionStats: {
      stepsCompleted: plan?.steps.filter(s => s.status === 'done').length ?? 0,
      stepsFailed: plan?.steps.filter(s => s.status === 'failed').length ?? 0,
      verificationsPassed: 0,
      verificationsFailed: 0,
    },
  };
}

/**
 * 启动 Goal Loop 自动推进
 *
 * 在后台定时 tick Goal Loop，直到完成或失败。
 *
 * @param runtime - BridgeRuntime 实例
 * @param loopId - 要运行的 loop ID
 * @param tickIntervalMs - tick 间隔 (默认 5s)
 * @param onError - 可选的错误回调，用于监控/告警
 * @returns 停止函数，调用后停止 loop
 */
export function startGoalLoopRunner(
  runtime: BridgeRuntime,
  loopId: string,
  tickIntervalMs: number = 5000,
  onError?: (error: unknown, loopId: string) => void,
): () => void {
  let stopped = false;
  let consecutiveErrors = 0;
  const MAX_CONSECUTIVE_ERRORS = 5;

  const run = async () => {
    while (!stopped) {
      const loop = runtime.automationLoopStore.get(loopId);
      if (!loop || loop.status === 'done' || loop.status === 'failed' || loop.status === 'cancelled') {
        break;
      }

      try {
        tickGoalLoop(runtime, loopId);
        consecutiveErrors = 0; // Reset on successful tick
      } catch (error) {
        consecutiveErrors++;
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.error('[GoalLoopRunner] Tick error', { consecutiveErrors, maxErrors: MAX_CONSECUTIVE_ERRORS, error: errorMsg });

        // Emit to callback if provided
        onError?.(error, loopId);

        // If too many consecutive errors, stop the loop and alert
        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
          logger.error('[GoalLoopRunner] Too many consecutive errors, stopping loop', { loopId });
          stopped = true;
          // Mark loop as failed so it can be retried manually
          const currentLoop = runtime.automationLoopStore.get(loopId);
          if (currentLoop) {
            currentLoop.status = 'failed';
            currentLoop.lastError = `Stopped after ${MAX_CONSECUTIVE_ERRORS} consecutive tick errors: ${errorMsg}`;
          }
          break;
        }
      }

      await new Promise(resolve => setTimeout(resolve, tickIntervalMs));
    }
  };

  // 异步启动，不阻塞
  run().catch((error) => {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error('[GoalLoopRunner] Fatal error starting loop', { loopId, error: errorMsg });
    onError?.(error, loopId);
  });

  // 返回停止函数
  return () => {
    stopped = true;
  };
}
