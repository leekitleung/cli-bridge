import { createHash, randomUUID } from 'node:crypto';

import { assertWebRelayLoop } from '../../../../packages/shared/src/schemas.ts';
import type {
  OutboundPrompt,
  WebRelayLoop,
} from '../../../../packages/shared/src/types.ts';
import type { InMemoryOutboundPromptStore } from './outbound-prompt-store.ts';

export const DEFAULT_WEB_RELAY_LOOP_MAX_ROUNDS = 3;
export const HARD_WEB_RELAY_LOOP_MAX_ROUNDS = 10;
export const DEFAULT_WEB_RELAY_PER_ROUND_TIMEOUT_MS = 120_000;
export const DEFAULT_WEB_RELAY_TOTAL_DEADLINE_MS = 10 * 60_000;
export const DEFAULT_WEB_RELAY_NO_PROGRESS_LIMIT = 2;

export interface CreateWebRelayLoopInput {
  id?: string;
  projectId: string;
  goalId: string;
  sessionId: string;
  endpointId: string;
  initialPrompt: string;
  maxRounds?: number;
  perRoundTimeoutMs?: number;
  totalDeadlineMs?: number;
  noProgressLimit?: number;
  now?: number;
}

export interface AdvanceWebRelayLoopInput {
  loopId: string;
  inboundContent: string;
  progressHash?: string;
  nextPrompt?: string;
  now?: number;
}

export interface WebRelayLoopReport {
  generatedAt: number;
  loops: {
    id: string;
    projectId: string;
    goalId: string;
    sessionId: string;
    endpointId: string;
    status: WebRelayLoop['status'];
    round: number;
    maxRounds: number;
    perRoundTimeoutMs: number;
    totalDeadlineAt: number;
    noProgressLimit: number;
    noProgressCount: number;
    createdAt: number;
    updatedAt: number;
    pausedAt?: number;
    cancelledAt?: number;
    doneAt?: number;
    failedAt?: number;
    failureReason?: string;
    evidence: {
      type: string;
      at: number;
      reason?: string;
      round?: number;
      outboundPromptId?: string;
    }[];
  }[];
}

function cloneLoop(loop: WebRelayLoop): WebRelayLoop {
  return structuredClone(loop);
}

function contentHash(content: string): string {
  return `sha256:${createHash('sha256').update(content).digest('hex')}`;
}

function appendEvidence(
  loop: WebRelayLoop,
  type: string,
  at: number,
  extra: { reason?: string; outboundPromptId?: string; round?: number } = {},
): void {
  loop.evidence = [
    ...loop.evidence,
    {
      type,
      at,
      ...(extra.reason ? { reason: extra.reason } : {}),
      ...(extra.outboundPromptId ? { outboundPromptId: extra.outboundPromptId } : {}),
      ...(typeof extra.round === 'number' ? { round: extra.round } : {}),
    },
  ];
}

function isTerminal(status: WebRelayLoop['status']): boolean {
  return ['cancelled', 'done', 'failed'].includes(status);
}

function isUncertainOutbound(status: OutboundPrompt['status']): boolean {
  return ['submitted', 'responding'].includes(status);
}

function isTerminalOutbound(status: OutboundPrompt['status']): boolean {
  return ['returned', 'completed', 'expired', 'failed', 'cancelled'].includes(status);
}

export class InMemoryWebRelayLoopStore {
  private readonly loops = new Map<string, WebRelayLoop>();
  private readonly outboundPromptStore: InMemoryOutboundPromptStore;

  constructor(outboundPromptStore: InMemoryOutboundPromptStore) {
    this.outboundPromptStore = outboundPromptStore;
  }

  create(input: CreateWebRelayLoopInput): { loop?: WebRelayLoop; outboundPrompt?: OutboundPrompt; error?: string } {
    const now = input.now ?? Date.now();
    const maxRounds = input.maxRounds ?? DEFAULT_WEB_RELAY_LOOP_MAX_ROUNDS;
    if (!Number.isInteger(maxRounds) || maxRounds < 1) {
      return { error: 'maxRounds must be a positive integer' };
    }
    if (maxRounds > HARD_WEB_RELAY_LOOP_MAX_ROUNDS) {
      return { error: 'maxRounds exceeds hard maximum of 10' };
    }
    const perRoundTimeoutMs = input.perRoundTimeoutMs ?? DEFAULT_WEB_RELAY_PER_ROUND_TIMEOUT_MS;
    const totalDeadlineMs = input.totalDeadlineMs ?? DEFAULT_WEB_RELAY_TOTAL_DEADLINE_MS;
    const noProgressLimit = input.noProgressLimit ?? DEFAULT_WEB_RELAY_NO_PROGRESS_LIMIT;
    const loop: WebRelayLoop = {
      id: input.id ?? randomUUID(),
      projectId: input.projectId,
      goalId: input.goalId,
      sessionId: input.sessionId,
      endpointId: input.endpointId,
      status: 'running',
      round: 1,
      maxRounds,
      perRoundTimeoutMs,
      totalDeadlineAt: now + totalDeadlineMs,
      noProgressLimit,
      noProgressCount: 0,
      seenContentHashes: [],
      createdAt: now,
      updatedAt: now,
      evidence: [],
    };
    appendEvidence(loop, 'created', now, { round: loop.round });
    const outboundPrompt = this.outboundPromptStore.createOutboundPrompt({
      sessionId: loop.sessionId,
      prompt: input.initialPrompt,
      endpointId: loop.endpointId,
      loopId: loop.id,
      now,
    });
    loop.currentOutboundPromptId = outboundPrompt.id;
    appendEvidence(loop, 'round-created', now, {
      outboundPromptId: outboundPrompt.id,
      round: loop.round,
    });
    assertWebRelayLoop(loop);
    this.loops.set(loop.id, cloneLoop(loop));
    return { loop: cloneLoop(loop), outboundPrompt };
  }

  pause(id: string, now: number = Date.now()): WebRelayLoop | undefined {
    const loop = this.loops.get(id);
    if (!loop || loop.status !== 'running') return undefined;
    loop.status = 'paused';
    loop.pausedAt = now;
    loop.updatedAt = now;
    appendEvidence(loop, 'paused', now);
    this.loops.set(loop.id, cloneLoop(loop));
    return cloneLoop(loop);
  }

  resume(id: string, now: number = Date.now()): WebRelayLoop | undefined {
    const loop = this.loops.get(id);
    if (!loop || loop.status !== 'paused') return undefined;
    loop.status = 'running';
    loop.updatedAt = now;
    appendEvidence(loop, 'resumed', now);
    this.loops.set(loop.id, cloneLoop(loop));
    return cloneLoop(loop);
  }

  cancel(id: string, now: number = Date.now()): WebRelayLoop | undefined {
    const loop = this.loops.get(id);
    if (!loop || isTerminal(loop.status)) return undefined;
    loop.status = 'cancelled';
    loop.cancelledAt = now;
    loop.updatedAt = now;
    appendEvidence(loop, 'cancelled', now);
    if (loop.currentOutboundPromptId) {
      this.outboundPromptStore.cancel(loop.currentOutboundPromptId, now);
    }
    this.loops.set(loop.id, cloneLoop(loop));
    return cloneLoop(loop);
  }

  recoverAfterRestart(now: number = Date.now()): number {
    let recovered = 0;
    for (const loop of this.loops.values()) {
      if (isTerminal(loop.status)) continue;
      if (!loop.currentOutboundPromptId) continue;

      const current = this.outboundPromptStore.getPrompt(loop.currentOutboundPromptId);
      if (!current || current.status === 'returned') continue;
      if (isTerminalOutbound(current.status) && current.status !== 'cancelled') continue;

      const reason = isUncertainOutbound(current.status)
        ? 'restart-uncertain-submission'
        : 'restart-uncertain-outbound';
      this.outboundPromptStore.markFailed(current.id, reason, now);
      loop.status = 'failed';
      loop.failedAt = now;
      loop.failureReason = reason;
      loop.updatedAt = now;
      appendEvidence(loop, 'failed', now, {
        reason,
        outboundPromptId: current.id,
        round: loop.round,
      });
      this.loops.set(loop.id, cloneLoop(loop));
      recovered += 1;
    }
    return recovered;
  }

  advance(input: AdvanceWebRelayLoopInput): { loop?: WebRelayLoop; outboundPrompt?: OutboundPrompt; error?: string } {
    const now = input.now ?? Date.now();
    const loop = this.loops.get(input.loopId);
    if (!loop) return { error: 'Loop not found' };
    if (loop.status !== 'running') return { error: 'Loop is not running' };
    if (now >= loop.totalDeadlineAt) return this.fail(loop, 'total-deadline-reached', now);

    const current = loop.currentOutboundPromptId
      ? this.outboundPromptStore.getPrompt(loop.currentOutboundPromptId)
      : undefined;
    if (!current) return this.fail(loop, 'missing-current-outbound', now);
    if (isUncertainOutbound(current.status)) return this.fail(loop, 'uncertain-submission', now);
    if (current.status !== 'returned') return { error: 'Current outbound has not returned' };
    if (current.submittedAt && now - current.submittedAt > loop.perRoundTimeoutMs) {
      return this.fail(loop, 'per-round-timeout', now);
    }

    const hash = contentHash(input.inboundContent);
    if (loop.seenContentHashes.includes(hash)) return this.fail(loop, 'repeated-content', now);
    loop.seenContentHashes.push(hash);
    const progressHash = input.progressHash ?? hash;
    if (loop.lastProgressHash === progressHash) {
      loop.noProgressCount += 1;
    } else {
      loop.lastProgressHash = progressHash;
      loop.noProgressCount = 0;
    }
    appendEvidence(loop, 'inbound-observed', now, {
      outboundPromptId: current.id,
      round: loop.round,
    });
    if (loop.noProgressCount >= loop.noProgressLimit) return this.fail(loop, 'no-progress', now);
    if (loop.round >= loop.maxRounds) return this.done(loop, 'max-rounds-reached', now);
    if (!input.nextPrompt || input.nextPrompt.trim().length === 0) return this.done(loop, 'no-next-prompt', now);

    loop.round += 1;
    const outboundPrompt = this.outboundPromptStore.createOutboundPrompt({
      sessionId: loop.sessionId,
      prompt: input.nextPrompt,
      endpointId: loop.endpointId,
      loopId: loop.id,
      now,
    });
    loop.currentOutboundPromptId = outboundPrompt.id;
    loop.updatedAt = now;
    appendEvidence(loop, 'round-created', now, {
      outboundPromptId: outboundPrompt.id,
      round: loop.round,
    });
    this.loops.set(loop.id, cloneLoop(loop));
    return { loop: cloneLoop(loop), outboundPrompt };
  }

  private done(loop: WebRelayLoop, reason: string, now: number): { loop: WebRelayLoop } {
    loop.status = 'done';
    loop.doneAt = now;
    loop.updatedAt = now;
    appendEvidence(loop, 'done', now, { reason });
    this.loops.set(loop.id, cloneLoop(loop));
    return { loop: cloneLoop(loop) };
  }

  private fail(loop: WebRelayLoop, reason: string, now: number): { loop: WebRelayLoop; error: string } {
    loop.status = 'failed';
    loop.failedAt = now;
    loop.failureReason = reason;
    loop.updatedAt = now;
    appendEvidence(loop, 'failed', now, { reason });
    this.loops.set(loop.id, cloneLoop(loop));
    return { loop: cloneLoop(loop), error: reason };
  }

  get(id: string): WebRelayLoop | undefined {
    const loop = this.loops.get(id);
    return loop ? cloneLoop(loop) : undefined;
  }

  list(): WebRelayLoop[] {
    return Array.from(this.loops.values(), cloneLoop);
  }

  exportLoops(): WebRelayLoop[] {
    return this.list();
  }

  hydrateLoops(loops: unknown[]): number {
    let restored = 0;
    for (const candidate of loops) {
      try {
        assertWebRelayLoop(candidate);
      } catch {
        continue;
      }
      this.loops.set(candidate.id, cloneLoop(candidate));
      restored += 1;
    }
    return restored;
  }

  report(now: number = Date.now()): {
    generatedAt: number;
    loops: WebRelayLoop[];
  } {
    return {
      generatedAt: now,
      loops: this.list(),
    };
  }

  createAcceptanceReport(now: number = Date.now()): WebRelayLoopReport {
    return {
      generatedAt: now,
      loops: Array.from(this.loops.values()).map((loop) => ({
        id: loop.id,
        projectId: loop.projectId,
        goalId: loop.goalId,
        sessionId: loop.sessionId,
        endpointId: loop.endpointId,
        status: loop.status,
        round: loop.round,
        maxRounds: loop.maxRounds,
        perRoundTimeoutMs: loop.perRoundTimeoutMs,
        totalDeadlineAt: loop.totalDeadlineAt,
        noProgressLimit: loop.noProgressLimit,
        noProgressCount: loop.noProgressCount,
        createdAt: loop.createdAt,
        updatedAt: loop.updatedAt,
        ...(typeof loop.pausedAt === 'number' ? { pausedAt: loop.pausedAt } : {}),
        ...(typeof loop.cancelledAt === 'number' ? { cancelledAt: loop.cancelledAt } : {}),
        ...(typeof loop.doneAt === 'number' ? { doneAt: loop.doneAt } : {}),
        ...(typeof loop.failedAt === 'number' ? { failedAt: loop.failedAt } : {}),
        ...(loop.failureReason ? { failureReason: loop.failureReason } : {}),
        evidence: loop.evidence.map((event) => ({
          type: event.type,
          at: event.at,
          ...(event.reason ? { reason: event.reason } : {}),
          ...(typeof event.round === 'number' ? { round: event.round } : {}),
          ...(event.outboundPromptId ? { outboundPromptId: event.outboundPromptId } : {}),
        })),
      })),
    };
  }
}
