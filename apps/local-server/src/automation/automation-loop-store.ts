import { createHash, randomUUID } from 'node:crypto';

import {
  assertAutomationLoopRun,
  assertAutomationLoopCycle,
} from '../../../../packages/shared/src/schemas.ts';
import type {
  AutomationLoopRun,
  AutomationLoopCycle,
  AutomationLoopStatus,
  AutomationLoopStopReason,
  AutomationLoopCycleStatus,
  CreateAutomationLoopInput,
} from '../../../../packages/shared/src/types.ts';

export interface AutomationLoopStopResult {
  stop: boolean;
  reason?: AutomationLoopStopReason;
}

export interface EvaluateStopInput {
  now?: number;
  goalStatus?: string;
  endpointStatus?: 'online' | 'offline' | 'missing';
  endpointAvailable?: boolean;
  awaitingGate?: boolean;
  actionFailed?: boolean;
}

export interface BeginCycleInput {
  promptHash: string;
  dispatchKey?: string;
  now?: number;
}

export interface MarkCycleResultInput {
  progressHash?: string;
  resultHash?: string;
  resultStatus?: 'returned' | 'failed' | 'timeout' | 'cancelled';
  nextInput?: string;
  nextInputHash?: string;
  dispatchRouteId?: string;
  targetEndpointStatus?: 'online' | 'offline' | 'missing';
  gateReason?: string;
  failureReason?: string;
  evidenceIds?: string[];
  conversationActionId?: string;
  workBuddyTaskId?: string;
  reviewId?: string;
  now?: number;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function hashText(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function inTerminalState(status: AutomationLoopStatus): boolean {
  return ['done', 'failed', 'cancelled'].includes(status);
}

export class InMemoryAutomationLoopStore {
  private readonly loops = new Map<string, AutomationLoopRun>();
  private readonly cycles = new Map<string, AutomationLoopCycle>();
  private readonly cyclesByLoop = new Map<string, string[]>();

  create(input: CreateAutomationLoopInput): AutomationLoopRun {
    const now = input.now ?? Date.now();
    const loop: AutomationLoopRun = {
      id: randomUUID(),
      projectId: input.projectId,
      goalId: input.goalId,
      pairingId: input.pairingId,
      sourceEndpointId: input.sourceEndpointId,
      targetEndpointId: input.targetEndpointId,
      status: 'draft',
      cycleCount: 0,
      maxCycles: input.maxCycles,
      noProgressLimit: input.noProgressLimit,
      noProgressCount: 0,
      lastProgressHash: undefined,
      pendingInput: undefined,
      deadlineAt: input.deadlineAt,
      stopReason: undefined,
      createdAt: now,
      updatedAt: now,
    };
    assertAutomationLoopRun(loop);
    this.loops.set(loop.id, clone(loop));
    return clone(loop);
  }

  get(id: string): AutomationLoopRun | undefined {
    const loop = this.loops.get(id);
    return loop ? clone(loop) : undefined;
  }

  listByProject(projectId: string): AutomationLoopRun[] {
    const result: AutomationLoopRun[] = [];
    for (const loop of this.loops.values()) {
      if (loop.projectId === projectId) {
        result.push(clone(loop));
      }
    }
    return result;
  }

  list(): AutomationLoopRun[] {
    return Array.from(this.loops.values(), clone);
  }

  start(id: string, now?: number): AutomationLoopRun | undefined {
    const loop = this.loops.get(id);
    if (!loop || loop.status !== 'draft') return undefined;
    const ts = now ?? Date.now();
    loop.status = 'running';
    loop.startedAt = ts;
    loop.updatedAt = ts;
    this.loops.set(loop.id, clone(loop));
    return clone(loop);
  }

  pause(id: string, now?: number): AutomationLoopRun | undefined {
    const loop = this.loops.get(id);
    if (!loop || (loop.status !== 'running' && loop.status !== 'waiting')) return undefined;
    const ts = now ?? Date.now();
    loop.status = 'paused';
    loop.pausedAt = ts;
    loop.updatedAt = ts;
    this.loops.set(loop.id, clone(loop));
    return clone(loop);
  }

  resume(id: string, now?: number): AutomationLoopRun | undefined {
    const loop = this.loops.get(id);
    if (!loop || loop.status !== 'paused') return undefined;
    const ts = now ?? Date.now();
    loop.status = 'running';
    loop.updatedAt = ts;
    this.loops.set(loop.id, clone(loop));
    return clone(loop);
  }

  cancel(id: string, now?: number): AutomationLoopRun | undefined {
    const loop = this.loops.get(id);
    if (!loop || inTerminalState(loop.status)) return undefined;
    const ts = now ?? Date.now();
    loop.status = 'cancelled';
    loop.cancelledAt = ts;
    loop.updatedAt = ts;
    loop.stopReason = 'cancelled';
    this.loops.set(loop.id, clone(loop));
    return clone(loop);
  }

  beginCycle(id: string, input: BeginCycleInput): AutomationLoopCycle | undefined {
    const loop = this.loops.get(id);
    if (!loop || loop.status !== 'running') return undefined;
    const now = input.now ?? Date.now();
    const index = (this.cyclesByLoop.get(loop.id) ?? []).length + 1;
    const cycle: AutomationLoopCycle = {
      id: randomUUID(),
      loopId: loop.id,
      index,
      dispatchKey: input.dispatchKey ?? `${loop.id}:${index}`,
      status: 'planned',
      promptHash: input.promptHash,
      createdAt: now,
      updatedAt: now,
    };
    assertAutomationLoopCycle(cycle);
    this.cycles.set(cycle.id, clone(cycle));

    const ids = this.cyclesByLoop.get(loop.id) ?? [];
    ids.push(cycle.id);
    this.cyclesByLoop.set(loop.id, ids);

    loop.updatedAt = now;
    this.loops.set(loop.id, clone(loop));

    return clone(cycle);
  }

  markCycleDispatching(id: string, cycleId: string, input: MarkCycleResultInput = {}): AutomationLoopCycle | undefined {
    return this.updateCycle(cycleId, 'dispatching', input);
  }

  markCycleWaiting(id: string, cycleId: string, inputOrNow?: MarkCycleResultInput | number): AutomationLoopCycle | undefined {
    const input = typeof inputOrNow === 'number' ? { now: inputOrNow } : (inputOrNow ?? {});
    const updated = this.updateCycle(cycleId, 'waiting-result', input);
    const loop = this.loops.get(id);
    if (updated && loop && loop.status === 'running') {
      const now = input.now ?? Date.now();
      loop.status = 'waiting';
      loop.updatedAt = now;
      this.loops.set(loop.id, clone(loop));
    }
    return updated;
  }

  markCycleReturned(id: string, cycleId: string, input: MarkCycleResultInput): AutomationLoopCycle | undefined {
    const previousStatus = this.cycles.get(cycleId)?.status;
    const updated = this.updateCycle(cycleId, 'returned', { ...input, resultStatus: input.resultStatus ?? 'returned' });
    if (!updated) return undefined;

    const loop = this.loops.get(id);
    if (loop) {
      const now = input.now ?? Date.now();
      if (previousStatus !== 'returned' && previousStatus !== 'failed') {
        loop.cycleCount += 1;
      }
      loop.status = 'running';
      if (input.nextInput !== undefined) {
        loop.pendingInput = input.nextInput;
      }
      loop.updatedAt = now;
      this.loops.set(loop.id, clone(loop));
    }
    if (updated.progressHash) {
      this.markProgress(id, updated.progressHash, input.now);
    }
    return clone(updated);
  }

  markCycleFailed(id: string, cycleId: string, input: MarkCycleResultInput): AutomationLoopCycle | undefined {
    const previousStatus = this.cycles.get(cycleId)?.status;
    const updated = this.updateCycle(cycleId, 'failed', { ...input, resultStatus: input.resultStatus ?? 'failed' });
    if (!updated) return undefined;

    const loop = this.loops.get(id);
    if (loop) {
      const now = input.now ?? Date.now();
      if (previousStatus !== 'returned' && previousStatus !== 'failed') {
        loop.cycleCount += 1;
      }
      loop.status = 'failed';
      loop.stopReason = 'action-failed';
      loop.lastError = input.failureReason;
      loop.failedAt = now;
      loop.updatedAt = now;
      this.loops.set(loop.id, clone(loop));
    }
    return clone(updated);
  }

  /**
   * Track a progress hash for no-progress detection.
   * This is called internally by markCycleReturned and can also be called directly.
   */
  markProgress(id: string, progressHash: string, now?: number): void {
    const loop = this.loops.get(id);
    if (!loop) return;
    const ts = now ?? Date.now();

    if (loop.lastProgressHash === undefined) {
      loop.lastProgressHash = progressHash;
      loop.noProgressCount = 0;
    } else if (loop.lastProgressHash === progressHash) {
      loop.noProgressCount += 1;
    } else {
      loop.lastProgressHash = progressHash;
      loop.noProgressCount = 0;
    }
    loop.updatedAt = ts;
    this.loops.set(loop.id, clone(loop));
  }

  evaluateStop(id: string, input: EvaluateStopInput = {}): AutomationLoopStopResult {
    const loop = this.loops.get(id);
    if (!loop) return { stop: true, reason: 'cancelled' };
    const now = input.now ?? Date.now();

    // Terminal states cannot proceed
    if (inTerminalState(loop.status)) {
      return { stop: true, reason: loop.stopReason ?? 'cancelled' };
    }

    // Paused loops stop with manual-pause
    if (loop.status === 'paused') return { stop: true, reason: 'manual-pause' };

    // Goal-linked stop conditions
    if (input.goalStatus === 'done') return this.stopWithReason(loop, 'goal-done', now);
    if (input.goalStatus === 'cancelled') return this.stopWithReason(loop, 'goal-cancelled', now);
    if (input.goalStatus === 'failed') return this.failWithReason(loop, 'goal-failed', now);

    // Endpoint availability
    if (input.endpointStatus === 'missing' || input.endpointStatus === 'offline' || input.endpointAvailable === false) {
      return this.failWithReason(loop, 'endpoint-unavailable', now);
    }
    if (input.awaitingGate) return this.stopWithReason(loop, 'awaiting-gate', now);
    if (input.actionFailed) return this.failWithReason(loop, 'action-failed', now);

    // Deadline
    if (now >= loop.deadlineAt) return this.failWithReason(loop, 'deadline', now);

    // Max cycles
    if (loop.cycleCount >= loop.maxCycles) return this.stopWithReason(loop, 'max-cycles', now);

    // No progress
    if (loop.noProgressCount >= loop.noProgressLimit) return this.stopWithReason(loop, 'no-progress', now);

    return { stop: false };
  }

  getCycles(id: string): AutomationLoopCycle[] {
    const ids = this.cyclesByLoop.get(id) ?? [];
    return ids.map(cid => this.cycles.get(cid)).filter(Boolean) as AutomationLoopCycle[];
  }

  listCycles(id: string): AutomationLoopCycle[] {
    return this.getCycles(id);
  }

  latestUnresolvedCycle(id: string): AutomationLoopCycle | undefined {
    const cycles = this.getCycles(id);
    return cycles.slice().reverse().find(cycle => cycle.status === 'dispatching' || cycle.status === 'waiting-result');
  }

  findCycleByDispatchKey(dispatchKey: string): AutomationLoopCycle | undefined {
    for (const cycle of this.cycles.values()) {
      if (cycle.dispatchKey === dispatchKey) return clone(cycle);
    }
    return undefined;
  }

  getCycle(cycleId: string): AutomationLoopCycle | undefined {
    const cycle = this.cycles.get(cycleId);
    return cycle ? clone(cycle) : undefined;
  }

  // --- Persistence ---

  exportLoops(): AutomationLoopRun[] {
    return this.list();
  }

  exportCycles(): AutomationLoopCycle[] {
    return Array.from(this.cycles.values(), clone);
  }

  hydrateLoop(item: AutomationLoopRun): boolean {
    try {
      assertAutomationLoopRun(item);
      this.loops.set(item.id, clone(item));
      return true;
    } catch {
      return false;
    }
  }

  hydrateCycle(item: AutomationLoopCycle): boolean {
    try {
      assertAutomationLoopCycle(item);
      this.cycles.set(item.id, clone(item));
      const ids = this.cyclesByLoop.get(item.loopId) ?? [];
      if (!ids.includes(item.id)) {
        ids.push(item.id);
      }
      this.cyclesByLoop.set(item.loopId, ids);
      return true;
    } catch {
      return false;
    }
  }

  // --- Private helpers ---

  private updateCycle(cycleId: string, status: AutomationLoopCycleStatus, input: MarkCycleResultInput = {}): AutomationLoopCycle | undefined {
    const cycle = this.cycles.get(cycleId);
    if (!cycle) return undefined;
    const ts = input.now ?? Date.now();
    cycle.status = status;
    if (input.progressHash !== undefined) cycle.progressHash = input.progressHash;
    if (input.resultHash !== undefined) cycle.resultHash = input.resultHash;
    if (input.resultStatus !== undefined) cycle.resultStatus = input.resultStatus;
    if (input.nextInput !== undefined) cycle.nextInputHash = input.nextInputHash ?? hashText(input.nextInput);
    if (input.nextInputHash !== undefined) cycle.nextInputHash = input.nextInputHash;
    if (input.dispatchRouteId !== undefined) cycle.dispatchRouteId = input.dispatchRouteId;
    if (input.targetEndpointStatus !== undefined) cycle.targetEndpointStatus = input.targetEndpointStatus;
    if (input.gateReason !== undefined) cycle.gateReason = input.gateReason;
    if (input.failureReason !== undefined) cycle.failureReason = input.failureReason;
    if (input.evidenceIds !== undefined) cycle.evidenceIds = input.evidenceIds;
    if (input.conversationActionId !== undefined) {
      cycle.conversationActionId = input.conversationActionId;
      cycle.progressHash = cycle.progressHash ?? `action:${input.conversationActionId}`;
    }
    if (input.workBuddyTaskId !== undefined) cycle.workBuddyTaskId = input.workBuddyTaskId;
    if (input.reviewId !== undefined) cycle.reviewId = input.reviewId;
    cycle.updatedAt = ts;
    this.cycles.set(cycle.id, clone(cycle));
    return cycle;
  }

  private stopWithReason(loop: AutomationLoopRun, reason: AutomationLoopStopReason, now: number): AutomationLoopStopResult {
    loop.status = 'done';
    loop.stopReason = reason;
    loop.doneAt = now;
    loop.updatedAt = now;
    this.loops.set(loop.id, clone(loop));
    return { stop: true, reason };
  }

  private failWithReason(loop: AutomationLoopRun, reason: AutomationLoopStopReason, now: number): AutomationLoopStopResult {
    loop.status = 'failed';
    loop.stopReason = reason;
    loop.failedAt = now;
    loop.updatedAt = now;
    this.loops.set(loop.id, clone(loop));
    return { stop: true, reason };
  }
}
