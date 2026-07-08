// Goals API routes - extracted from bridge-api.ts
// Handles Goal and Plan lifecycle endpoints

import type { IncomingMessage } from 'node:http';
import type { BridgeRuntime, BridgeAuthContext } from '../bridge-api.ts';
import type { BridgeResult } from '../shared.ts';
import {
  ok,
  created,
  badRequest,
  notFound,
  conflict,
  readJsonBody,
  requireString,
  requireArray,
  isRecord,
} from '../shared.ts';
import type { ExecutionTier, PlanStepKind } from '../../../../../packages/shared/src/types.ts';

const GOALS_PATH = '/bridge/goals';
const GOAL_PATH = '/bridge/goals/';
const PLANS_PATH = '/bridge/plans/';

/**
 * Check if pathname matches goals list endpoint
 */
export function isGoalsListPath(pathname: string): boolean {
  return pathname === GOALS_PATH;
}

/**
 * Check if pathname is a goal-specific endpoint
 */
export function isGoalPath(pathname: string): boolean {
  return pathname.startsWith(GOAL_PATH) && !pathname.includes('/plans/');
}

/**
 * Extract goal ID from pathname
 */
export function extractGoalId(pathname: string): string | null {
  const match = pathname.match(/^\/bridge\/goals\/([^/]+)(?:\/|$)/);
  return match ? match[1] : null;
}

/**
 * Handle goals list endpoint
 * GET /bridge/goals
 */
export async function handleGoalsList(
  runtime: BridgeRuntime,
  method: string,
  pathname: string,
  _request: IncomingMessage,
): Promise<BridgeResult | null> {
  if (method !== 'GET' || pathname !== GOALS_PATH) {
    return null;
  }

  const goals = Array.from(runtime.goalStore.listGoals());
  return ok({ goals });
}

/**
 * Handle single goal endpoints
 * GET /bridge/goals/:goalId
 * PUT /bridge/goals/:goalId
 * DELETE /bridge/goals/:goalId
 */
export async function handleGoalRequest(
  runtime: BridgeRuntime,
  method: string,
  pathname: string,
  request: IncomingMessage,
  _authContext: BridgeAuthContext,
): Promise<BridgeResult | null> {
  const goalId = extractGoalId(pathname);
  if (!goalId) {
    return null;
  }

  // Skip plan-specific paths
  if (pathname.includes('/plans/')) {
    return null;
  }

  // GET /bridge/goals/:goalId
  if (method === 'GET') {
    const goal = runtime.goalStore.getGoal(goalId);
    if (!goal) {
      return notFound(`Goal ${goalId} not found`);
    }
    const plan = runtime.goalStore.getPlanByGoal(goalId);
    return ok({ goal, plan: plan ?? null });
  }

  // PUT /bridge/goals/:goalId - Update goal status
  if (method === 'PUT') {
    const parsed = await readJsonBody(request);
    if (!parsed.ok) {
      return badRequest(parsed.message ?? 'Invalid request body');
    }
    const body = parsed.body;
    if (!isRecord(body)) {
      return badRequest('Request body must be an object');
    }

    const newStatus = requireString(body, 'status');
    const currentGoal = runtime.goalStore.getGoal(goalId);

    if (!currentGoal) {
      return notFound(`Goal ${goalId} not found`);
    }

    // Handle status transitions - use approvePlan which updates both goal and plan
    if (newStatus === 'approved') {
      runtime.goalStore.approvePlan(goalId);
      const plan = runtime.goalStore.getPlanByGoal(goalId);
      return ok({ goal: runtime.goalStore.getGoal(goalId), plan: plan ?? null });
    }

    if (newStatus === 'cancelled') {
      runtime.goalStore.cancelGoal(goalId);
      return ok({ goal: runtime.goalStore.getGoal(goalId) });
    }

    return badRequest(`Unsupported status transition to '${newStatus}'`);
  }

  // DELETE /bridge/goals/:goalId
  if (method === 'DELETE') {
    const goal = runtime.goalStore.getGoal(goalId);
    if (!goal) {
      return notFound(`Goal ${goalId} not found`);
    }
    runtime.goalStore.cancelGoal(goalId);
    return ok({ deleted: true, goalId });
  }

  return null;
}

/**
 * Handle plan endpoints
 * GET /bridge/plans/:planId
 * PUT /bridge/plans/:planId
 * POST /bridge/goals/:goalId/plans - Create plan for goal
 */
export async function handlePlanRequest(
  runtime: BridgeRuntime,
  method: string,
  pathname: string,
  request: IncomingMessage,
  _authContext: BridgeAuthContext,
): Promise<BridgeResult | null> {
  // POST /bridge/goals/:goalId/plans - Create plan
  const createMatch = pathname.match(/^\/bridge\/goals\/([^/]+)\/plans$/);
  if (createMatch && method === 'POST') {
    const goalId = createMatch[1];
    const goal = runtime.goalStore.getGoal(goalId);
    if (!goal) {
      return notFound(`Goal ${goalId} not found`);
    }

    const parsed = await readJsonBody(request);
    if (!parsed.ok) {
      return badRequest(parsed.message ?? 'Invalid request body');
    }

    const body = parsed.body;
    if (!isRecord(body)) {
      return badRequest('Request body must be an object');
    }

    const rawSteps = requireArray(body, 'steps');
    if (!rawSteps || rawSteps.length === 0) {
      return badRequest('steps array is required');
    }

    const validKinds = [
      'review',
      'summarize',
      'propose-patch',
      'apply-patch',
      'run-command',
      'write-file',
      'delete-file',
      'git-commit',
      'git-push',
    ] as const satisfies readonly PlanStepKind[];
    const validTiers = ['patch-proposal', 'workspace-write'] as const satisfies readonly ExecutionTier[];

    // Create plan using attachPlan (validates goal is in draft status)
    const plan = runtime.goalStore.attachPlan({
      goalId,
      steps: rawSteps.map((s: unknown) => {
        const step = isRecord(s) ? s : {};
        const kind = validKinds.includes(step.kind as PlanStepKind)
          ? step.kind as PlanStepKind
          : 'review';
        const tier = validTiers.includes(step.tier as ExecutionTier)
          ? step.tier as ExecutionTier
          : 'patch-proposal';
        return {
          intent: typeof step.intent === 'string' ? step.intent : '',
          kind,
          targetEndpointId: typeof step.targetEndpointId === 'string' ? step.targetEndpointId : 'workbuddy',
          tier,
        };
      }),
    });

    if (!plan) {
      return conflict(`Cannot create plan for goal ${goalId} - goal must be in draft status`);
    }

    return created({ plan });
  }

  // GET/PUT /bridge/plans/:planId
  const planMatch = pathname.match(/^\/bridge\/plans\/([^/]+)$/);
  if (planMatch) {
    const planId = planMatch[1];
    const plan = runtime.goalStore.getPlanById(planId);

    if (!plan) {
      return notFound(`Plan ${planId} not found`);
    }

    if (method === 'GET') {
      return ok({ plan });
    }

    if (method === 'PUT') {
      const parsed = await readJsonBody(request);
      if (!parsed.ok) {
        return badRequest(parsed.message ?? 'Invalid request body');
      }

      const body = parsed.body;
      if (!isRecord(body)) {
        return badRequest('Request body must be an object');
      }

      const newStatus = requireString(body, 'status');

      if (newStatus === 'approved') {
        runtime.goalStore.approvePlan(plan.goalId);
        const updatedPlan = runtime.goalStore.getPlanByGoal(plan.goalId);
        return ok({ plan: updatedPlan ?? null });
      }

      return badRequest(`Unsupported status transition to '${newStatus}'`);
    }
  }

  return null;
}

/**
 * Register all goals-related routes
 */
export async function handleGoalsRequest(
  runtime: BridgeRuntime,
  method: string,
  pathname: string,
  request: IncomingMessage,
  authContext: BridgeAuthContext,
): Promise<BridgeResult | null> {
  // Try each handler in order
  return (
    (await handleGoalsList(runtime, method, pathname, request)) ??
    (await handleGoalRequest(runtime, method, pathname, request, authContext)) ??
    (await handlePlanRequest(runtime, method, pathname, request, authContext)) ??
    null
  );
}
