import { randomUUID } from 'node:crypto';

import {
  assertOutboundPrompt,
} from '../../../../packages/shared/src/schemas.ts';
import type {
  OutboundPrompt,
} from '../../../../packages/shared/src/types.ts';
import type {
  InMemoryAuditLog,
} from './audit-log.ts';
import type {
  InMemoryPacketStore,
} from './packet-store.ts';

export interface CreateOutboundPromptInput {
  id?: string;
  sessionId: string;
  prompt: string;
  /** Phase 3 relay (foundation): optional originating executor endpoint. */
  endpointId?: string;
  /** Stage C bounded loop correlation. Server-owned. */
  loopId?: string;
  now?: number;
  expiresInMs?: number;
}

export interface AcknowledgeOutboundPromptInput {
  id: string;
  claimToken: string;
  ok: boolean;
  failureReason?: string;
  now?: number;
}

const OUTBOUND_PROMPT_STATUS_VALUES = new Set([
  'queued',
  'claimed',
  'delivered',
  'waiting_manual_send',
  'submitted',
  'responding',
  'response_ready',
  'returned',
  'completed',
  'expired',
  'failed',
  'cancelled',
]);

export const CLAIMED_OUTBOUND_PROMPT_TTL_MS = 60_000;
export const OUTBOUND_AUTHORIZATION_TTL_MS = 10 * 60_000;

function clonePrompt(prompt: OutboundPrompt): OutboundPrompt {
  return structuredClone(prompt);
}

function isOutboundPromptShape(value: unknown): value is OutboundPrompt {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    typeof record.id === 'string' &&
    typeof record.sessionId === 'string' &&
    typeof record.packetId === 'string' &&
    typeof record.prompt === 'string' &&
    typeof record.status === 'string' &&
    OUTBOUND_PROMPT_STATUS_VALUES.has(record.status) &&
    record.target === 'chatgpt-web' &&
    (record.endpointId === undefined || typeof record.endpointId === 'string') &&
    (record.loopId === undefined || typeof record.loopId === 'string') &&
    (record.claimToken === undefined || typeof record.claimToken === 'string') &&
    typeof record.authorization === 'object' &&
    record.authorization !== null &&
    typeof record.createdAt === 'number' &&
    typeof record.updatedAt === 'number'
  );
}

function appendEvidence(
  prompt: OutboundPrompt,
  type: string,
  at: number,
  reason?: string,
): void {
  prompt.evidence = [
    ...(prompt.evidence ?? []),
    {
      type,
      at,
      ...(reason ? { reason } : {}),
    },
  ];
}

export class InMemoryOutboundPromptStore {
  private readonly prompts = new Map<string, OutboundPrompt>();
  private readonly packetStore: InMemoryPacketStore;
  private readonly auditLog: InMemoryAuditLog;

  constructor(
    packetStore: InMemoryPacketStore,
    auditLog: InMemoryAuditLog,
  ) {
    this.packetStore = packetStore;
    this.auditLog = auditLog;
  }

  createOutboundPrompt(input: CreateOutboundPromptInput): OutboundPrompt {
    const packet = this.packetStore.createPacket({
      sessionId: input.sessionId,
      source: 'codex',
      target: 'chatgpt-web',
      kind: 'cli-output-review',
      rawContent: input.prompt,
      context: {
        transport: 'clipboard',
      },
      status: 'confirmed',
      now: input.now,
    });
    const now = input.now ?? Date.now();
    const expiresAt = now + (input.expiresInMs ?? OUTBOUND_AUTHORIZATION_TTL_MS);
    const prompt: OutboundPrompt = {
      id: input.id ?? randomUUID(),
      sessionId: input.sessionId,
      packetId: packet.id,
      prompt: packet.processedContent,
      status: 'queued',
      target: 'chatgpt-web',
      ...(input.loopId ? { loopId: input.loopId } : {}),
      authorization: {
        target: 'chatgpt-web',
        contentHash: packet.safety.contentHash,
        expiresAt,
      },
      ...(input.endpointId ? { endpointId: input.endpointId } : {}),
      createdAt: now,
      updatedAt: now,
    };

    assertOutboundPrompt(prompt);
    appendEvidence(prompt, 'queued', now);
    this.prompts.set(prompt.id, clonePrompt(prompt));
    this.auditLog.createAndAppend({
      sessionId: prompt.sessionId,
      packetId: prompt.packetId,
      approvalId: prompt.id,
      type: 'create_outbound_prompt',
      source: 'local-server',
      target: 'chatgpt-web',
      safety: {
        contentHash: packet.safety.contentHash,
        redactionSummary: packet.safety.redactionSummary,
        riskLevel: packet.safety.blocked ? 'high' : 'medium',
      },
      result: {
        ok: true,
      },
      timestamp: now,
    });

    return clonePrompt(prompt);
  }

  private recoverStaleClaims(now: number): void {
    for (const prompt of this.prompts.values()) {
      if (
        ['queued', 'claimed', 'waiting_manual_send'].includes(prompt.status) &&
        now > prompt.authorization.expiresAt
      ) {
        prompt.status = 'expired';
        prompt.expiredAt = now;
        prompt.claimToken = undefined;
        prompt.updatedAt = now;
        appendEvidence(prompt, 'expired', now);
        this.prompts.set(prompt.id, clonePrompt(prompt));
        continue;
      }
      if (
        prompt.status === 'claimed' &&
        typeof prompt.claimedAt === 'number' &&
        now - prompt.claimedAt > CLAIMED_OUTBOUND_PROMPT_TTL_MS
      ) {
        prompt.status = 'failed';
        prompt.failedAt = now;
        prompt.failureReason = 'claim-lease-expired';
        prompt.claimToken = undefined;
        prompt.updatedAt = now;
        this.prompts.set(prompt.id, clonePrompt(prompt));
      }
    }
  }

  markSubmitted(id: string, now: number = Date.now()): OutboundPrompt | undefined {
    const prompt = this.prompts.get(id);
    if (!prompt || prompt.status !== 'waiting_manual_send') {
      return undefined;
    }
    if (now > prompt.authorization.expiresAt) {
      prompt.status = 'expired';
      prompt.expiredAt = now;
      prompt.updatedAt = now;
      appendEvidence(prompt, 'expired', now);
      this.prompts.set(prompt.id, clonePrompt(prompt));
      return undefined;
    }
    prompt.status = 'submitted';
    prompt.submittedAt = now;
    prompt.updatedAt = now;
    appendEvidence(prompt, 'submitted', now);
    this.prompts.set(prompt.id, clonePrompt(prompt));
    this.auditLog.createAndAppend({
      sessionId: prompt.sessionId,
      packetId: prompt.packetId,
      approvalId: prompt.id,
      type: 'fill_chatgpt',
      source: 'chatgpt-web',
      target: 'chatgpt-web',
      result: { ok: true, metadata: { stage: 'submitted' } },
      timestamp: now,
    });
    return clonePrompt(prompt);
  }

  markResponding(id: string, now: number = Date.now()): OutboundPrompt | undefined {
    return this.transition(id, 'submitted', 'responding', 'responding', now);
  }

  markResponseReady(id: string, now: number = Date.now()): OutboundPrompt | undefined {
    return this.transition(id, 'responding', 'response_ready', 'response-ready', now);
  }

  markReturned(id: string, now: number = Date.now()): OutboundPrompt | undefined {
    return this.transition(id, 'response_ready', 'returned', 'returned', now);
  }

  markFailed(id: string, failureReason: string, now: number = Date.now()): OutboundPrompt | undefined {
    const prompt = this.prompts.get(id);
    if (
      !prompt ||
      ['returned', 'completed', 'expired', 'failed', 'cancelled'].includes(prompt.status)
    ) {
      return undefined;
    }
    prompt.status = 'failed';
    prompt.failedAt = now;
    prompt.failureReason = failureReason;
    prompt.updatedAt = now;
    appendEvidence(prompt, 'failed', now, failureReason);
    this.prompts.set(prompt.id, clonePrompt(prompt));
    return clonePrompt(prompt);
  }

  private transition(
    id: string,
    from: OutboundPrompt['status'],
    to: OutboundPrompt['status'],
    evidenceType: string,
    now: number,
  ): OutboundPrompt | undefined {
    const prompt = this.prompts.get(id);
    if (!prompt || prompt.status !== from) {
      return undefined;
    }
    prompt.status = to;
    if (to === 'responding') prompt.respondingAt = now;
    if (to === 'response_ready') prompt.responseReadyAt = now;
    if (to === 'returned') prompt.returnedAt = now;
    prompt.updatedAt = now;
    appendEvidence(prompt, evidenceType, now);
    this.prompts.set(prompt.id, clonePrompt(prompt));
    return clonePrompt(prompt);
  }

  claimNext(now: number = Date.now()): OutboundPrompt | undefined {
    this.recoverStaleClaims(now);
    const prompt = Array.from(this.prompts.values())
      .filter((candidate) => candidate.status === 'queued')
      .sort((left, right) => left.createdAt - right.createdAt)[0];

    if (!prompt) {
      return undefined;
    }

    prompt.status = 'claimed';
    prompt.claimedAt = now;
    prompt.claimToken = randomUUID();
    prompt.updatedAt = now;
    appendEvidence(prompt, 'claimed', now);
    this.prompts.set(prompt.id, clonePrompt(prompt));
    this.auditLog.createAndAppend({
      sessionId: prompt.sessionId,
      packetId: prompt.packetId,
      approvalId: prompt.id,
      type: 'claim_outbound_prompt',
      source: 'chatgpt-web',
      target: 'chatgpt-web',
      result: {
        ok: true,
      },
      timestamp: now,
    });

    return clonePrompt(prompt);
  }

  acknowledge(input: AcknowledgeOutboundPromptInput): OutboundPrompt | undefined {
    const prompt = this.prompts.get(input.id);
    if (
      !prompt ||
      prompt.status !== 'claimed' ||
      !prompt.claimToken ||
      prompt.claimToken !== input.claimToken
    ) {
      return undefined;
    }
    prompt.claimToken = undefined;

    const now = input.now ?? Date.now();
    if (input.ok) {
      prompt.status = 'waiting_manual_send';
      prompt.deliveredAt = now;
      prompt.waitingAt = now;
      prompt.failureReason = undefined;
      appendEvidence(prompt, 'filled-and-acknowledged', now);
      appendEvidence(prompt, 'waiting-manual-send', now);
    } else {
      prompt.status = 'failed';
      prompt.failedAt = now;
      prompt.failureReason = input.failureReason ?? 'chatgpt-fill-failed';
      appendEvidence(prompt, 'failed', now, prompt.failureReason);
    }
    prompt.updatedAt = now;
    this.prompts.set(prompt.id, clonePrompt(prompt));
    this.auditLog.createAndAppend({
      sessionId: prompt.sessionId,
      packetId: prompt.packetId,
      approvalId: prompt.id,
      type: input.ok ? 'fill_chatgpt' : 'operation_failed',
      source: 'chatgpt-web',
      target: 'chatgpt-web',
      result: {
        ok: input.ok,
        failureReason: input.ok ? undefined : prompt.failureReason,
      },
      timestamp: now,
    });

    return clonePrompt(prompt);
  }

  cancel(id: string, now: number = Date.now()): OutboundPrompt | undefined {
    const prompt = this.prompts.get(id);
    if (!prompt || !['queued', 'claimed', 'waiting_manual_send'].includes(prompt.status)) {
      return undefined;
    }
    prompt.status = 'cancelled';
    prompt.cancelledAt = now;
    prompt.claimToken = undefined;
    prompt.updatedAt = now;
    appendEvidence(prompt, 'cancelled', now);
    this.prompts.set(prompt.id, clonePrompt(prompt));
    this.auditLog.createAndAppend({
      sessionId: prompt.sessionId,
      packetId: prompt.packetId,
      approvalId: prompt.id,
      type: 'operation_cancelled',
      source: 'local-server',
      target: 'chatgpt-web',
      result: { ok: true },
      timestamp: now,
    });

    return clonePrompt(prompt);
  }

  createStatusView(): {
    total: number;
    queued: number;
    claimed: number;
    waitingManualSend: number;
    submitted: number;
    responding: number;
    responseReady: number;
    returned: number;
    completed: number;
    expired: number;
    failed: number;
    cancelled: number;
    active: boolean;
  } {
    const prompts = Array.from(this.prompts.values());
    const count = (status: OutboundPrompt['status']) => (
      prompts.filter((prompt) => prompt.status === status).length
    );
    const queued = count('queued');
    const claimed = count('claimed');
    const waitingManualSend = count('waiting_manual_send');

    return {
      total: prompts.length,
      queued,
      claimed,
      waitingManualSend,
      submitted: count('submitted'),
      responding: count('responding'),
      responseReady: count('response_ready'),
      returned: count('returned'),
      completed: count('completed'),
      expired: count('expired'),
      failed: count('failed'),
      cancelled: count('cancelled'),
      active: queued + claimed + waitingManualSend > 0,
    };
  }

  createAcceptanceReport(now: number = Date.now()): {
    generatedAt: number;
    status: ReturnType<InMemoryOutboundPromptStore['createStatusView']>;
    prompts: {
      id: string;
      sessionId: string;
      packetId: string;
      status: OutboundPrompt['status'];
      target: 'chatgpt-web';
      evidence: NonNullable<OutboundPrompt['evidence']>;
      failureReason?: string;
    }[];
  } {
    const report = {
      generatedAt: now,
      status: this.createStatusView(),
      prompts: Array.from(this.prompts.values()).map((prompt) => ({
        id: prompt.id,
        sessionId: prompt.sessionId,
        packetId: prompt.packetId,
        status: prompt.status,
        target: prompt.target,
        evidence: prompt.evidence ?? [],
        ...(prompt.failureReason ? { failureReason: prompt.failureReason } : {}),
      })),
    };
    this.auditLog.createAndAppend({
      sessionId: 'outbound-status-report',
      type: 'outbound_status_report',
      source: 'local-server',
      target: 'operator',
      result: {
        ok: true,
        metadata: {
          total: report.status.total,
          active: report.status.active,
        },
      },
      timestamp: now,
    });

    return report;
  }

  listPrompts(): OutboundPrompt[] {
    return Array.from(this.prompts.values(), clonePrompt);
  }

  getPrompt(id: string): OutboundPrompt | undefined {
    const prompt = this.prompts.get(id);
    return prompt ? clonePrompt(prompt) : undefined;
  }

  exportPrompts(): OutboundPrompt[] {
    return this.listPrompts();
  }

  hydratePrompts(prompts: unknown[]): number {
    let restored = 0;
    for (const candidate of prompts) {
      if (!isOutboundPromptShape(candidate)) {
        continue;
      }
      this.prompts.set(candidate.id, clonePrompt(candidate));
      restored += 1;
    }
    return restored;
  }
}
