import { createHash } from 'node:crypto';
import { resolveConversationRouteAdapter } from '../conversation/conversation-route-registry.ts';
import type { BridgeRuntime, BridgeAuthKind } from '../routes/bridge-api.ts';
import type { AutomationLoopRun, AutomationLoopCycle } from '../../../../packages/shared/src/types.ts';

export type TickAuthKind = 'console-cookie' | 'extension-session';

export interface TickAutomationLoopInput {
  input: string;
  authKind: TickAuthKind;
  now?: number;
  progressHash?: string;
}

export type TickResult =
  | { type: 'dispatched'; cycle: AutomationLoopCycle; loop: AutomationLoopRun }
  | { type: 'stopped'; reason: string; loop: AutomationLoopRun }
  | { type: 'blocked'; reason: string; loop?: AutomationLoopRun }
  | { type: 'error'; reason: string; loop?: AutomationLoopRun };

export interface RunAutomationLoopInput {
  input: string;
  authKind: TickAuthKind;
  maxTicksPerRun?: number;
  now?: number;
  progressHash?: string;
}

function promptHash(text: string): string {
  return `sha256:${createHash('sha256').update(text).digest('hex')}`;
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

  const loop = runtime.automationLoopStore.get(loopId);
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
  }

  // Evaluate stop conditions before dispatch
  const stop = runtime.automationLoopStore.evaluateStop(loopId, { now: input.now });
  if (stop.stop) {
    return { type: 'stopped', reason: stop.reason ?? 'unknown', loop: runtime.automationLoopStore.get(loopId)! };
  }

  // Find target endpoint
  const target = runtime.endpointRegistry.get(loop.targetEndpointId);
  if (!target) {
    return { type: 'error', reason: 'endpoint-not-found', loop };
  }

  const resolution = resolveConversationRouteAdapter(target);
  if (!resolution.adapter) {
    return { type: 'error', reason: 'no-adapter-for-target', loop };
  }

  // Begin a new cycle
  const now = input.now ?? Date.now();
  const ph = promptHash(input.input);
  const cycle = runtime.automationLoopStore.beginCycle(loopId, { promptHash: ph, now });
  if (!cycle) {
    return { type: 'error', reason: 'cannot-begin-cycle', loop };
  }

  // Create conversation action
  const action = resolution.adapter.createAction({
    runtime,
    projectId: loop.projectId,
    sourceEndpointId: loop.sourceEndpointId,
    targetEndpoint: target,
    userEventId: `automation-loop:${loopId}:${cycle.id}`,
    bridgeEventId: `automation-loop:${loopId}:${cycle.id}`,
    text: input.input,
  });

  if (!action) {
    runtime.automationLoopStore.markCycleFailed(loopId, cycle.id, { now });
    return { type: 'error', reason: 'cannot-create-action', loop };
  }

  // Confirm
  const confirmResult = resolution.adapter.confirm({ runtime, action });
  if (confirmResult.statusCode !== 200) {
    runtime.automationLoopStore.markCycleFailed(loopId, cycle.id, { now });
    return { type: 'error', reason: 'confirm-failed', loop };
  }

  // Get the updated action from the store (status is now 'confirmed')
  const confirmedAction = runtime.conversationActionStore.get(action.id);
  if (!confirmedAction) {
    runtime.automationLoopStore.markCycleFailed(loopId, cycle.id, { now });
    return { type: 'error', reason: 'action-lost', loop };
  }

  // Dispatch — the adapter handles enqueue vs direct dispatch internally
  const dispatchResult = resolution.adapter.dispatch({
    runtime,
    action: confirmedAction,
    request: null as never, // no real HTTP request in automation context
  }) as { statusCode: number; payload: unknown };

  if (dispatchResult.statusCode >= 400) {
    runtime.automationLoopStore.markCycleFailed(loopId, cycle.id, { now });
    return { type: 'error', reason: 'dispatch-failed', loop };
  }

  // Mark cycle as waiting for result
  const updatedCycle = runtime.automationLoopStore.markCycleWaiting(loopId, cycle.id, now);
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

  for (let i = 0; i < maxTicksPerRun; i += 1) {
    const result = tickAutomationLoop(runtime, loopId, {
      input: input.input,
      authKind: input.authKind,
      now: input.now,
      progressHash: input.progressHash,
    });
    trace.push(result);
    if (result.type !== 'dispatched') break;
  }

  return { loop: runtime.automationLoopStore.get(loopId)!, trace };
}
