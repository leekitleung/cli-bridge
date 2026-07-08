// Automation API routes - extracted from bridge-api.ts
// Handles automation loops and bindings

import type { IncomingMessage } from 'node:http';
import type { BridgeRuntime, BridgeAuthContext } from '../bridge-api.ts';
import type { BridgeResult } from '../shared.ts';
import {
  ok,
  created,
  badRequest,
  notFound,
  readJsonBody,
  requireString,
  requireObject,
  isRecord,
} from '../shared.ts';
import { tickAutomationLoop, runAutomationLoop } from '../../automation/automation-loop-runner.ts';
import type {
  AutomationExecutionTier,
  AutomationReasoningTier,
} from '../../../../../packages/shared/src/types.ts';

/**
 * Check if pathname is automation endpoint
 */
export function isAutomationPath(pathname: string): boolean {
  return pathname.startsWith('/bridge/automation');
}

/**
 * List automation bindings
 * GET /bridge/automation/bindings
 */
export async function handleAutomationBindings(
  runtime: BridgeRuntime,
  method: string,
  pathname: string,
  _request: IncomingMessage,
  _authContext: BridgeAuthContext,
): Promise<BridgeResult | null> {
  if (method !== 'GET' || pathname !== '/bridge/automation/bindings') {
    return null;
  }

  const bindings = runtime.automationBindingStore.listBindings();
  return ok({ bindings });
}

/**
 * Create automation binding
 * POST /bridge/automation/bindings
 */
export async function handleAutomationBindingsCreate(
  runtime: BridgeRuntime,
  method: string,
  pathname: string,
  request: IncomingMessage,
  _authContext: BridgeAuthContext,
): Promise<BridgeResult | null> {
  if (method !== 'POST' || pathname !== '/bridge/automation/bindings') {
    return null;
  }

  const parsed = await readJsonBody(request);
  if (!parsed.ok) {
    return badRequest(parsed.message ?? 'Invalid request body');
  }

  const body = parsed.body;
  if (!isRecord(body)) {
    return badRequest('Request body must be an object');
  }

  const projectId = requireString(body, 'projectId');
  const goalId = requireString(body, 'goalId');
  const planId = requireString(body, 'planId');
  const reasoningEndpointId = requireString(body, 'reasoningEndpointId');
  const executionEndpointId = requireString(body, 'executionEndpointId');
  const executionPermissionProfile = requireString(body, 'executionPermissionProfile') ?? 'patch-proposal';
  const requestedWorkingDirectoryRef = requireString(body, 'executionWorkingDirectoryRef');
  const deadlineAt = requireString(body, 'deadlineAt') ?? new Date(Date.now() + 30 * 60 * 1000).toISOString();

  if (!projectId || !goalId || !planId || !reasoningEndpointId || !executionEndpointId) {
    return badRequest('projectId, goalId, planId, reasoningEndpointId and executionEndpointId are required');
  }
  const executionWorkingDirectoryRef = requestedWorkingDirectoryRef ?? projectId;

  const reasoningTier: AutomationReasoningTier = body.reasoningTier === 'high' ? 'high' : 'high';
  const executionTier: AutomationExecutionTier = body.executionTier === 'medium' || body.executionTier === 'low'
    ? body.executionTier
    : 'low';

  const maxSteps = typeof body.maxSteps === 'number' && Number.isInteger(body.maxSteps)
    ? body.maxSteps
    : 10;
  const maxReasoningRounds = typeof body.maxReasoningRounds === 'number' && Number.isInteger(body.maxReasoningRounds)
    ? body.maxReasoningRounds
    : 3;

  try {
    const binding = runtime.automationBindingStore.createBinding({
      goalId,
      planId,
      reasoningEndpointId,
      executionEndpointId,
      reasoningTier,
      executionTier,
      executionPermissionProfile,
      executionWorkingDirectoryRef,
      maxSteps,
      maxReasoningRounds,
      deadlineAt,
    });
    runtime.persist();
    return created({ binding });
  } catch (err) {
    return badRequest(err instanceof Error ? err.message : 'Automation binding rejected');
  }
}

/**
 * Get automation loop status
 * GET /bridge/automation/loops/:loopId
 */
export async function handleAutomationLoopGet(
  runtime: BridgeRuntime,
  method: string,
  pathname: string,
  _request: IncomingMessage,
  _authContext: BridgeAuthContext,
): Promise<BridgeResult | null> {
  const match = pathname.match(/^\/bridge\/automation\/loops\/([^/]+)$/);
  if (!match) {
    return null;
  }

  if (method !== 'GET') {
    return null;
  }

  const loopId = match[1];
  const loop = runtime.automationLoopStore.get(loopId);

  if (!loop) {
    return notFound(`Automation loop ${loopId} not found`);
  }

  return ok({ loop });
}

/**
 * Create automation loop
 * POST /bridge/automation/loops
 */
export async function handleAutomationLoopCreate(
  runtime: BridgeRuntime,
  method: string,
  pathname: string,
  request: IncomingMessage,
  _authContext: BridgeAuthContext,
): Promise<BridgeResult | null> {
  if (method !== 'POST' || pathname !== '/bridge/automation/loops') {
    return null;
  }

  const parsed = await readJsonBody(request);
  if (!parsed.ok) {
    return badRequest(parsed.message ?? 'Invalid request body');
  }

  const body = parsed.body;
  if (!isRecord(body)) {
    return badRequest('Request body must be an object');
  }

  const projectId = requireString(body, 'projectId');
  if (!projectId) {
    return badRequest('projectId is required');
  }

  const loop = runtime.automationLoopStore.create({
    projectId,
    goalId: requireString(body, 'goalId'),
    sourceEndpointId: requireString(body, 'sourceEndpointId') ?? 'cli-bridge',
    targetEndpointId: requireString(body, 'targetEndpointId') ?? 'workbuddy',
    maxCycles: (body.maxCycles as number) ?? 10,
    noProgressLimit: (body.noProgressLimit as number) ?? 3,
    deadlineAt: (body.deadlineAt as number) ?? (Date.now() + 30 * 60 * 1000),
  });

  return created({ loop });
}

/**
 * Tick automation loop
 * POST /bridge/automation/loops/:loopId/tick
 */
export async function handleAutomationLoopTick(
  runtime: BridgeRuntime,
  method: string,
  pathname: string,
  _request: IncomingMessage,
  _authContext: BridgeAuthContext,
): Promise<BridgeResult | null> {
  const match = pathname.match(/^\/bridge\/automation\/loops\/([^/]+)\/tick$/);
  if (!match) {
    return null;
  }

  if (method !== 'POST') {
    return null;
  }

  const loopId = match[1];
  const loop = runtime.automationLoopStore.get(loopId);

  if (!loop) {
    return notFound(`Automation loop ${loopId} not found`);
  }

  const result = tickAutomationLoop(runtime, loopId, {
    authKind: 'console-cookie',
  });
  return ok({ result });
}

/**
 * Register all automation routes
 */
export async function handleAutomationRequest(
  runtime: BridgeRuntime,
  method: string,
  pathname: string,
  request: IncomingMessage,
  authContext: BridgeAuthContext,
): Promise<BridgeResult | null> {
  return (
    (await handleAutomationBindings(runtime, method, pathname, request, authContext)) ??
    (await handleAutomationBindingsCreate(runtime, method, pathname, request, authContext)) ??
    (await handleAutomationLoopGet(runtime, method, pathname, request, authContext)) ??
    (await handleAutomationLoopCreate(runtime, method, pathname, request, authContext)) ??
    (await handleAutomationLoopTick(runtime, method, pathname, request, authContext)) ??
    null
  );
}
