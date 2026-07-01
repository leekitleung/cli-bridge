import { createHash } from 'node:crypto';
import { resolveConversationRouteAdapter } from '../conversation/conversation-route-registry.ts';
import type { BridgeRuntime, BridgeAuthKind } from '../routes/bridge-api.ts';
import type { AutomationLoopRun, AutomationLoopCycle } from '../../../../packages/shared/src/types.ts';

export type TickAuthKind = 'console-cookie' | 'extension-session';

export interface TickAutomationLoopInput {
  input?: string;
  authKind: TickAuthKind;
  now?: number;
  progressHash?: string;
  cycleIndex?: number;
}

export type TickResult =
  | { type: 'dispatched'; cycle: AutomationLoopCycle; loop: AutomationLoopRun }
  | { type: 'waiting'; cycle: AutomationLoopCycle; loop: AutomationLoopRun }
  | { type: 'stopped'; reason: string; loop: AutomationLoopRun }
  | { type: 'blocked'; reason: string; loop?: AutomationLoopRun }
  | { type: 'error'; reason: string; loop?: AutomationLoopRun };

export interface RunAutomationLoopInput {
  input?: string;
  authKind: TickAuthKind;
  maxTicksPerRun?: number;
  now?: number;
  progressHash?: string;
}

function promptHash(text: string): string {
  return `sha256:${createHash('sha256').update(text).digest('hex')}`;
}

function hashUnknown(value: unknown): string {
  return promptHash(JSON.stringify(value ?? null));
}

/**
 * Advance one tick of an automation loop: evaluate stop conditions,
 * begin a cycle, create and dispatch a governed action, and return.
 * At most one action is dispatched per tick.
 */
export function tickAutomationLoop(
  runtime: BridgeRuntime,
  loopId: string,
  input: TickAutomationLoopInput,
): TickResult {
  // Auth guard: only console-cookie may tick/run loops.
  if (input.authKind !== 'console-cookie') {
    const loop = runtime.automationLoopStore.get(loopId);
    return { type: 'blocked', reason: 'console-cookie-required', loop };
  }

  let loop = runtime.automationLoopStore.get(loopId);
  if (!loop) {
    return { type: 'error', reason: 'loop-not-found' };
  }

  // Reject terminal states
  if (loop.status === 'cancelled' || loop.status === 'done' || loop.status === 'failed') {
    return { type: 'blocked', reason: `loop-${loop.status}`, loop };
  }

  // Reject paused
  if (loop.status === 'paused') {
    return { type: 'blocked', reason: 'loop-paused', loop };
  }

  // Auto-start draft loops
  if (loop.status === 'draft') {
    runtime.automationLoopStore.start(loopId, input.now);
    loop = runtime.automationLoopStore.get(loopId)!;
  }

  const unresolved = runtime.automationLoopStore.latestUnresolvedCycle(loopId);
  if (unresolved) {
    const returnedTask = unresolved.workBuddyTaskId
      ? runtime.workbuddyExecution.getResult(unresolved.workBuddyTaskId)
      : undefined;
    if (!returnedTask) {
      return { type: 'waiting', cycle: unresolved, loop };
    }
    const recorded = recordAutomationLoopResult(runtime, loopId, unresolved.id, {
      workBuddyTaskId: unresolved.workBuddyTaskId,
      now: input.now,
    });
    if (recorded?.status === 'failed') {
      return { type: 'stopped', reason: 'action-failed', loop: runtime.automationLoopStore.get(loopId)! };
    }
    loop = runtime.automationLoopStore.get(loopId)!;
  }

  const target = runtime.endpointRegistry.get(loop.targetEndpointId);
  const endpointStatus = !target ? 'missing' : target.status === 'offline' ? 'offline' : 'online';

  // Evaluate stop conditions before dispatch
  const goalStatus = loop.goalId ? runtime.goalStore.getGoal(loop.goalId)?.status : undefined;
  const stop = runtime.automationLoopStore.evaluateStop(loopId, { now: input.now, goalStatus, endpointStatus });
  if (stop.stop) {
    return { type: 'stopped', reason: stop.reason ?? 'unknown', loop: runtime.automationLoopStore.get(loopId)! };
  }

  if (!target) {
    return { type: 'stopped', reason: 'endpoint-unavailable', loop: runtime.automationLoopStore.get(loopId)! };
  }
  if (target.status === 'offline') {
    runtime.automationLoopStore.evaluateStop(loopId, { now: input.now, endpointStatus: 'offline' });
    return { type: 'stopped', reason: 'endpoint-unavailable', loop: runtime.automationLoopStore.get(loopId)! };
  }

  const resolution = resolveConversationRouteAdapter(target);
  if (!resolution.adapter) {
    runtime.automationLoopStore.evaluateStop(loopId, { now: input.now, awaitingGate: true });
    return { type: 'stopped', reason: 'awaiting-gate', loop: runtime.automationLoopStore.get(loopId)! };
  }

  const nextInput = typeof input.input === 'string' && input.input.trim().length > 0
    ? input.input
    : loop.pendingInput;
  if (!nextInput) {
    runtime.automationLoopStore.evaluateStop(loopId, { now: input.now, awaitingGate: true });
    return { type: 'stopped', reason: 'awaiting-input', loop: runtime.automationLoopStore.get(loopId)! };
  }

  const nextCycleIndex = input.cycleIndex ?? (runtime.automationLoopStore.getCycles(loopId).length + 1);
  const dispatchKey = `${loopId}:${nextCycleIndex}`;
  const existing = runtime.automationLoopStore.findCycleByDispatchKey(dispatchKey);
  if (existing) {
    return { type: 'waiting', cycle: existing, loop: runtime.automationLoopStore.get(loopId)! };
  }

  // Begin a new cycle
  const now = input.now ?? Date.now();
  const ph = promptHash(nextInput);
  const cycle = runtime.automationLoopStore.beginCycle(loopId, { promptHash: ph, dispatchKey, now });
  if (!cycle) {
    return { type: 'error', reason: 'cannot-begin-cycle', loop };
  }

  const userEvent = runtime.conversationTranscriptStore.append({
    projectId: loop.projectId,
    pairingId: `${loop.sourceEndpointId}→${loop.targetEndpointId}`,
    role: 'user',
    text: nextInput,
    status: 'queued',
    routeKind: resolution.kind,
  });
  const bridgeEvent = runtime.conversationTranscriptStore.append({
    projectId: loop.projectId,
    pairingId: `${loop.sourceEndpointId}→${loop.targetEndpointId}`,
    role: 'bridge',
    text: `Automation loop cycle ${cycle.index} dispatching through ${resolution.kind}.`,
    status: 'awaiting-manual-confirmation',
    routeKind: resolution.kind,
  });

  // Create conversation action
  const action = resolution.adapter.createAction({
    runtime,
    projectId: loop.projectId,
    sourceEndpointId: loop.sourceEndpointId,
    targetEndpoint: target,
    userEventId: userEvent.id,
    bridgeEventId: bridgeEvent.id,
    text: nextInput,
  });

  if (!action) {
    runtime.automationLoopStore.markCycleFailed(loopId, cycle.id, { now, failureReason: 'cannot-create-action' });
    return { type: 'stopped', reason: 'action-failed', loop: runtime.automationLoopStore.get(loopId)! };
  }
  runtime.automationLoopStore.markCycleDispatching(loopId, cycle.id, {
    conversationActionId: action.id,
    dispatchRouteId: resolution.kind,
    targetEndpointStatus: endpointStatus,
    now,
  });

  // Confirm
  const confirmResult = resolution.adapter.confirm({ runtime, action });
  if (confirmResult.statusCode !== 200) {
    runtime.automationLoopStore.markCycleFailed(loopId, cycle.id, { now, conversationActionId: action.id, failureReason: 'confirm-failed' });
    return { type: 'stopped', reason: 'action-failed', loop: runtime.automationLoopStore.get(loopId)! };
  }

  // Get the updated action from the store (status is now 'confirmed')
  const confirmedAction = runtime.conversationActionStore.get(action.id);
  if (!confirmedAction) {
    runtime.automationLoopStore.markCycleFailed(loopId, cycle.id, { now, conversationActionId: action.id, failureReason: 'action-lost' });
    return { type: 'stopped', reason: 'action-failed', loop: runtime.automationLoopStore.get(loopId)! };
  }

  // Dispatch — the adapter handles enqueue vs direct dispatch internally
  let dispatchResult: { statusCode: number; payload: any };
  try {
    dispatchResult = resolution.adapter.dispatch({
      runtime,
      action: confirmedAction,
      request: null as never, // no real HTTP request in automation context
    }) as { statusCode: number; payload: any };
  } catch (error) {
    runtime.automationLoopStore.markCycleFailed(loopId, cycle.id, {
      now,
      conversationActionId: action.id,
      failureReason: error instanceof Error ? error.message : 'dispatch-threw',
    });
    return { type: 'stopped', reason: 'action-failed', loop: runtime.automationLoopStore.get(loopId)! };
  }

  if (dispatchResult.statusCode >= 400) {
    runtime.automationLoopStore.markCycleFailed(loopId, cycle.id, { now, conversationActionId: action.id, failureReason: 'dispatch-failed' });
    return { type: 'stopped', reason: 'action-failed', loop: runtime.automationLoopStore.get(loopId)! };
  }

  // Mark cycle as waiting for result
  const updatedCycle = runtime.automationLoopStore.markCycleWaiting(loopId, cycle.id, {
    now,
    conversationActionId: action.id,
    workBuddyTaskId: dispatchResult.payload?.task?.taskId,
    reviewId: dispatchResult.payload?.review?.id,
    dispatchRouteId: resolution.kind,
    targetEndpointStatus: endpointStatus,
  });
  if (!updatedCycle) {
    return { type: 'error', reason: 'cannot-mark-waiting', loop };
  }

  runtime.persist();
  return { type: 'dispatched', cycle: updatedCycle, loop: runtime.automationLoopStore.get(loopId)! };
}

/**
 * Bounded wrapper: run repeated ticks within a single request until a stop
 * condition is met or maxTicksPerRun is exhausted.
 */
export function runAutomationLoop(
  runtime: BridgeRuntime,
  loopId: string,
  input: RunAutomationLoopInput,
): { loop: AutomationLoopRun; trace: TickResult[] } {
  const maxTicksPerRun = Math.min(input.maxTicksPerRun ?? 1, 10);
  const trace: TickResult[] = [];
  let currentInput = input.input;

  for (let i = 0; i < maxTicksPerRun; i += 1) {
    const result = tickAutomationLoop(runtime, loopId, {
      input: currentInput,
      authKind: input.authKind,
      now: input.now,
      progressHash: input.progressHash,
    });
    trace.push(result);
    if (result.type === 'waiting') break;
    if (result.type !== 'dispatched') break;
    currentInput = undefined;
  }

  return { loop: runtime.automationLoopStore.get(loopId)!, trace };
}

export function recordAutomationLoopResult(
  runtime: BridgeRuntime,
  loopId: string,
  cycleId: string,
  input: { workBuddyTaskId?: string; now?: number } = {},
): AutomationLoopCycle | undefined {
  const cycle = runtime.automationLoopStore.getCycle(cycleId);
  if (!cycle) return undefined;
  const taskId = input.workBuddyTaskId ?? cycle.workBuddyTaskId;
  const result = taskId ? runtime.workbuddyExecution.getResult(taskId) : undefined;
  if (!result) return undefined;
  const output = result.output as Record<string, unknown> | undefined;
  const nextInput = output && typeof output.nextInput === 'string' ? output.nextInput : undefined;
  const resultHash = hashUnknown({
    ok: result.ok,
    output: result.output,
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
    failureReason: result.failureReason,
  });
  if (!result.ok) {
    return runtime.automationLoopStore.markCycleFailed(loopId, cycle.id, {
      workBuddyTaskId: taskId,
      resultHash,
      resultStatus: 'failed',
      failureReason: result.failureReason ?? 'workbuddy-result-failed',
      now: input.now,
    });
  }
  return runtime.automationLoopStore.markCycleReturned(loopId, cycle.id, {
    workBuddyTaskId: taskId,
    progressHash: resultHash,
    resultHash,
    resultStatus: 'returned',
    nextInput,
    now: input.now,
  });
}
