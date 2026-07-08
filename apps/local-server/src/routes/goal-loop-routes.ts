// Goal Loop HTTP Routes - 暴露 Goal Loop Runner 的 HTTP 接口
//
// 提供以下端点:
//   POST /bridge/goals/:goalId/loop/start    - 启动 Goal Loop
//   POST /bridge/goals/:goalId/loop/stop     - 停止 Goal Loop
//   GET  /bridge/goals/:goalId/loop/status   - 获取 Loop 状态
//   GET  /bridge/goals/:goalId/loop/gates    - 获取待审批的 Gate
//   POST /bridge/goals/:goalId/loop/approve  - 审批 Gate
//   GET  /bridge/executors                  - 获取执行器状态
//   GET  /bridge/diagnostics/loops           - 列出所有 Loop 详情
//   GET  /bridge/diagnostics/metrics          - 聚合指标
//
// 使用原生 Node.js HTTP Server，与 server.ts 的 requestHandler 模式保持一致。

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { BridgeRuntime } from './bridge-api.ts';
import { createGoalLoopRunner, type GoalLoopRunner } from '../goal/goal-loop-runner.ts';

export interface GoalLoopRouteContext {
  runtime: BridgeRuntime;
  goalLoopRunners: Map<string, GoalLoopRunner>;
}

/**
 * 解析 JSON 请求体（带超时保护）
 */
async function parseJsonBody<T>(req: IncomingMessage, timeoutMs: number = 30_000): Promise<T | null> {
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      req.removeAllListeners('data');
      req.removeAllListeners('end');
      req.removeAllListeners('error');
    };

    timer = setTimeout(() => {
      cleanup();
      // Destroy the request to stop the client from sending more data
      req.destroy();
      resolve(null);
    }, timeoutMs);

    let body = '';
    req.on('data', (chunk: Buffer) => {
      // Limit body size to prevent memory exhaustion (max 1MB)
      if (body.length + chunk.length > 1_000_000) {
        cleanup();
        req.destroy();
        resolve(null);
        return;
      }
      body += chunk.toString();
    });
    req.on('end', () => {
      cleanup();
      try {
        resolve(body ? JSON.parse(body) : null);
      } catch {
        resolve(null);
      }
    });
    req.on('error', () => {
      cleanup();
      resolve(null);
    });
  });
}

/**
 * 发送 JSON 响应
 */
function sendJson(res: ServerResponse, statusCode: number, data: unknown): void {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

/**
 * UUID v4 格式验证正则
 */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * 验证 ID 参数格式，防止 DoS 攻击
 * @param id 要验证的 ID
 * @param name 参数名称（用于错误消息）
 * @returns 验证失败返回错误消息，否则返回 null
 */
function validateIdParam(id: string | undefined, name: string): string | null {
  if (!id) {
    return `${name} is required`;
  }
  // 长度限制（UUID 为 36 字符）
  if (id.length > 64) {
    return `${name} too long (max 64 characters)`;
  }
  // 格式验证（必须是有效的 UUID 或短标识符）
  if (!UUID_REGEX.test(id) && !/^[a-zA-Z][a-zA-Z0-9_-]{0,32}$/.test(id)) {
    return `${name} has invalid format`;
  }
  return null;
}

/**
 * 从 URL 路径中提取 goalId
 * 路径格式: /bridge/goals/:goalId/...
 */
function extractGoalId(pathname: string): string | null {
  const match = pathname.match(/^\/bridge\/goals\/([^/]+)/);
  const goalId = match ? match[1] : null;
  // 验证格式
  if (goalId && validateIdParam(goalId, 'goalId')) {
    return null;
  }
  return goalId;
}

/**
 * Goal Loop 路由处理器
 */
export async function handleGoalLoopRequest(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: GoalLoopRouteContext,
): Promise<boolean> {
  const method = req.method?.toUpperCase() ?? 'GET';
  const url = req.url ?? '/';
  const pathname = new URL(url, 'http://localhost').pathname;

  // 提取 goalId
  const goalId = extractGoalId(pathname);
  if (!goalId) {
    return false; // 不是 Goal Loop 路由
  }

  // 移除 goalId 部分，获取剩余路径
  const remainingPath = pathname.replace(/^\/bridge\/goals\/[^/]+/, '');

  // 获取 Runner
  const runner = ctx.goalLoopRunners.get(goalId);

  // 路由分发
  switch (true) {
    // POST /bridge/goals/:goalId/loop/start
    case method === 'POST' && remainingPath === '/loop/start': {
      const body = await parseJsonBody<{
        planId?: string;
        options?: {
          stepCeiling?: number;
          pollIntervalMs?: number;
          defaultExecutor?: 'workbuddy' | 'opencode' | 'auto';
        };
      }>(req);

      // 获取或创建 Runner
      let runnerInstance = ctx.goalLoopRunners.get(goalId);
      if (!runnerInstance) {
        runnerInstance = createGoalLoopRunner(ctx.runtime, {
          stepCeiling: body?.options?.stepCeiling,
          pollIntervalMs: body?.options?.pollIntervalMs,
          defaultExecutor: body?.options?.defaultExecutor,
        });
        ctx.goalLoopRunners.set(goalId, runnerInstance);
      }

      const planId = body?.planId ?? (() => {
        const plan = ctx.runtime.goalStore.getPlanByGoal(goalId);
        return plan?.id;
      })();

      if (!planId) {
        return sendJson(res, 404, {
          ok: false,
          error: `Plan not found for goal ${goalId}`,
        }), true;
      }

      const result = await runnerInstance.start(goalId, planId);

      if (result.ok) {
        return sendJson(res, 200, {
          ok: true,
          loopId: result.loopId,
          message: `Goal loop started for goal ${goalId}`,
        }), true;
      } else {
        return sendJson(res, 400, {
          ok: false,
          error: result.error,
        }), true;
      }
    }

    // POST /bridge/goals/:goalId/loop/stop
    case method === 'POST' && remainingPath === '/loop/stop': {
      if (!runner) {
        return sendJson(res, 404, {
          ok: false,
          error: `No active loop for goal ${goalId}`,
        }), true;
      }

      // 查找 loopId
      const loops = Array.from(ctx.runtime.automationLoopStore.list())
        .filter(l => l.goalId === goalId && l.status === 'running');

      if (loops.length === 0) {
        return sendJson(res, 404, {
          ok: false,
          error: `No active loop for goal ${goalId}`,
        }), true;
      }

      runner.stop(loops[0].id);
      ctx.goalLoopRunners.delete(goalId);

      return sendJson(res, 200, {
        ok: true,
        message: `Goal loop stopped for goal ${goalId}`,
      }), true;
    }

    // GET /bridge/goals/:goalId/loop/status
    case method === 'GET' && remainingPath === '/loop/status': {
      if (!runner) {
        return sendJson(res, 404, {
          ok: false,
          error: `No active loop for goal ${goalId}`,
        }), true;
      }

      const loops = Array.from(ctx.runtime.automationLoopStore.list())
        .filter(l => l.goalId === goalId && l.status === 'running');

      if (loops.length === 0) {
        return sendJson(res, 404, {
          ok: false,
          error: `No active loop for goal ${goalId}`,
        }), true;
      }

      const status = runner.getStatus(loops[0].id);

      return sendJson(res, 200, {
        ok: true,
        status,
      }), true;
    }

    // GET /bridge/goals/:goalId/loop/gates
    case method === 'GET' && remainingPath === '/loop/gates': {
      if (!runner) {
        return sendJson(res, 200, {
          ok: true,
          gates: [],
        }), true;
      }

      const gates = runner.getPendingGates();

      return sendJson(res, 200, {
        ok: true,
        gates,
        count: gates.length,
      }), true;
    }

    // POST /bridge/goals/:goalId/loop/approve
    case method === 'POST' && remainingPath === '/loop/approve': {
      if (!runner) {
        return sendJson(res, 404, {
          ok: false,
          error: `No active loop for goal ${goalId}`,
        }), true;
      }

      const body = await parseJsonBody<{ executionId: string }>(req);

      const validationError = validateIdParam(body?.executionId, 'executionId');
      if (validationError) {
        return sendJson(res, 400, {
          ok: false,
          error: validationError,
        }), true;
      }

      const result = await runner.approveGate(body!.executionId);

      if (result.ok) {
        return sendJson(res, 200, {
          ok: true,
          taskId: result.taskId,
          message: `Gate approved and execution started`,
        }), true;
      } else {
        return sendJson(res, 400, {
          ok: false,
          error: result.error,
        }), true;
      }
    }

    default:
      return false; // 未匹配的路由
  }
}

/**
 * GET /bridge/executors - 获取执行器状态
 */
export async function handleExecutorsRequest(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: GoalLoopRouteContext,
): Promise<boolean> {
  const method = req.method?.toUpperCase() ?? 'GET';
  const url = req.url ?? '/';
  const pathname = new URL(url, 'http://localhost').pathname;

  if (method !== 'GET' || pathname !== '/bridge/executors') {
    return false;
  }

  const { getExecutorRegistry } = await import('../execution/executor-registry.ts');
  const registry = getExecutorRegistry();
  const status = registry.getStatus();

  return sendJson(res, 200, {
    ok: true,
    ...status,
  }), true;
}

/**
 * GET /bridge/diagnostics/loops - 列出所有 Loop 详情
 */
export async function handleDiagnosticsLoopsRequest(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: GoalLoopRouteContext,
): Promise<boolean> {
  const method = req.method?.toUpperCase() ?? 'GET';
  const url = req.url ?? '/';
  const pathname = new URL(url, 'http://localhost').pathname;

  if (method !== 'GET' || pathname !== '/bridge/diagnostics/loops') {
    return false;
  }

  const loops = ctx.runtime.automationLoopStore.list();
  const now = Date.now();

  const loopDetails = loops.map(loop => {
    const goalId = loop.goalId ?? '';
    const goal = goalId ? ctx.runtime.goalStore.getGoal(goalId) : null;
    const plan = goalId ? ctx.runtime.goalStore.getPlanByGoal(goalId) : null;

    return {
      id: loop.id,
      status: loop.status,
      goalId,
      goalStatus: goal?.status ?? 'unknown',
      planId: plan?.id ?? '',
      planStatus: plan?.status ?? 'unknown',
      cycleCount: loop.cycleCount,
      noProgressCount: loop.noProgressCount,
      maxCycles: loop.maxCycles,
      createdAt: loop.createdAt,
      updatedAt: loop.updatedAt,
      deadlineAt: loop.deadlineAt,
      isExpired: loop.deadlineAt ? loop.deadlineAt < now : false,
      stepsSummary: plan ? {
        total: plan.steps.length,
        done: plan.steps.filter(s => s.status === 'done').length,
        failed: plan.steps.filter(s => s.status === 'failed').length,
        pending: plan.steps.filter(s => s.status === 'pending').length,
        running: plan.steps.filter(s => s.status === 'running').length,
      } : null,
    };
  });

  return sendJson(res, 200, {
    ok: true,
    total: loopDetails.length,
    byStatus: {
      running: loopDetails.filter(l => l.status === 'running').length,
      done: loopDetails.filter(l => l.status === 'done').length,
      failed: loopDetails.filter(l => l.status === 'failed').length,
      cancelled: loopDetails.filter(l => l.status === 'cancelled').length,
    },
    expired: loopDetails.filter(l => l.isExpired).length,
    loops: loopDetails,
  }), true;
}

/**
 * GET /bridge/diagnostics/metrics - 聚合指标
 */
export async function handleDiagnosticsMetricsRequest(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: GoalLoopRouteContext,
): Promise<boolean> {
  const method = req.method?.toUpperCase() ?? 'GET';
  const url = req.url ?? '/';
  const pathname = new URL(url, 'http://localhost').pathname;

  if (method !== 'GET' || pathname !== '/bridge/diagnostics/metrics') {
    return false;
  }

  const { getExecutorRegistry } = await import('../execution/executor-registry.ts');
  const registry = getExecutorRegistry();
  const executorStatus = registry.getStatus();

  // Goal Store metrics - use public API methods
  const goals = ctx.runtime.goalStore.getGoalsArray();
  const plans = ctx.runtime.goalStore.getPlansArray();

  // Loop metrics
  const loops = ctx.runtime.automationLoopStore.list();
  const now = Date.now();

  // Source Relay metrics - use the correct property name from BridgeRuntime
  const sourceRelayMetrics = ctx.runtime.chatGptWebQueue?.getMetrics?.() ?? null;

  // Calculate uptime (approximate from first loop creation)
  const firstCreatedAt = loops.length > 0 ? Math.min(...loops.map(l => l.createdAt)) : null;
  const uptimeMs = firstCreatedAt !== null ? now - firstCreatedAt : 0;

  const metrics = {
    timestamp: now,
    uptime: {
      ms: uptimeMs,
      formatted: formatUptime(uptimeMs),
    },
    goals: {
      total: goals.length,
      byStatus: {
        draft: goals.filter((g) => g.status === 'draft').length,
        planned: goals.filter((g) => g.status === 'planned').length,
        approved: goals.filter((g) => g.status === 'approved').length,
        executing: goals.filter((g) => g.status === 'executing').length,
        done: goals.filter((g) => g.status === 'done').length,
        failed: goals.filter((g) => g.status === 'failed').length,
        cancelled: goals.filter((g) => g.status === 'cancelled').length,
      },
    },
    plans: {
      total: plans.length,
      byStatus: {
        draft: plans.filter((p) => p.status === 'draft').length,
        'awaiting-approval': plans.filter((p) => p.status === 'awaiting-approval').length,
        approved: plans.filter((p) => p.status === 'approved').length,
        executing: plans.filter((p) => p.status === 'executing').length,
        paused: plans.filter((p) => p.status === 'paused').length,
        done: plans.filter((p) => p.status === 'done').length,
        cancelled: plans.filter((p) => p.status === 'cancelled').length,
      },
      totalSteps: plans.reduce((sum, p) => sum + (p.steps?.length ?? 0), 0),
    },
    loops: {
      total: loops.length,
      active: loops.filter(l => l.status === 'running').length,
      expired: loops.filter(l => l.deadlineAt && l.deadlineAt < now).length,
      byStatus: {
        running: loops.filter(l => l.status === 'running').length,
        done: loops.filter(l => l.status === 'done').length,
        failed: loops.filter(l => l.status === 'failed').length,
        cancelled: loops.filter(l => l.status === 'cancelled').length,
      },
      // 使用已完成步骤数作为执行指标（更准确反映 Goal Loop 实际执行）
      totalStepsExecuted: plans.reduce((sum, p) => sum + (p.steps?.filter(s => s.status === 'done').length ?? 0), 0),
    },
    executors: {
      total: executorStatus.total,
      healthy: executorStatus.healthy,
      byId: executorStatus.executors.map(e => ({
        id: e.id,
        name: e.name,
        healthy: e.healthy,
      })),
    },
    sourceRelay: sourceRelayMetrics ? {
      depth: sourceRelayMetrics.depth,
      inFlight: sourceRelayMetrics.inFlight,
      throughput: sourceRelayMetrics.throughput,
      avgWaitTime: sourceRelayMetrics.avgWaitTime,
      extensionConnected: sourceRelayMetrics.extensionConnected,
      lastHeartbeatAt: sourceRelayMetrics.lastHeartbeatAt,
    } : null,
  };

  return sendJson(res, 200, {
    ok: true,
    ...metrics,
  }), true;
}

/**
 * 格式化运行时间
 */
function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

/**
 * 创建 Goal Loop 路由上下文
 *
 * 注意：同时注册执行器到全局注册表，确保诊断端点能获取到执行器状态。
 */
export async function createGoalLoopRouteContext(
  runtime: BridgeRuntime,
): Promise<GoalLoopRouteContext> {
  const { getExecutorRegistry } = await import('../execution/executor-registry.ts');
  const { createWorkBuddyExecutor } = await import('../execution/workbuddy-executor.ts');
  const { createOpenCodeExecutor } = await import('../execution/opencode-executor.ts');

  const registry = getExecutorRegistry();

  // 注册 WorkBuddy 执行器（如果尚未注册）
  if (!registry.get('workbuddy')) {
    const workbuddyExecutor = createWorkBuddyExecutor({
      adapter: runtime.workbuddyExecution,
      diagnosticMode: false,
    });
    registry.register(workbuddyExecutor);
  }

  // 注册 OpenCode 执行器（模拟模式，除非配置了真实路径）
  if (!registry.get('opencode')) {
    const opencodeExecutor = createOpenCodeExecutor({
      mockMode: true,
    });
    registry.register(opencodeExecutor);
  }

  return {
    runtime,
    goalLoopRunners: new Map(),
  };
}
