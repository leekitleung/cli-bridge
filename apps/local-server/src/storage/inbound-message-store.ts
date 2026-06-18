// Phase 3 multi-executor relay (inbound queue core): server-side return queue.
//
// An InboundMessage is a reviewed reply routed back to the originating executor
// endpoint, pulled by that executor. It is a NEW record type — never a rename
// or reuse of pending-prompt / outbound-prompt / packet. Content is redacted
// through the packet pipeline; raw content is never stored here.
//
// Hard invariant: an endpoint may only claim/ack/cancel messages whose
// endpointId matches it. Cross-endpoint access is rejected (and audited).
//
// Memory-only in this core phase (persistence deferred — see report).

import { randomUUID } from 'node:crypto';

import { assertInboundMessage } from '../../../../packages/shared/src/schemas.ts';
import { redactSensitiveContent } from '../security/redaction.ts';
import type {
  InboundMessage,
  InboundSource,
  InboundStatus,
} from '../../../../packages/shared/src/types.ts';
import type { InMemoryAuditLog } from './audit-log.ts';
import type { InMemoryPacketStore } from './packet-store.ts';

export interface CreateInboundMessageInput {
  id?: string;
  endpointId: string;
  sessionId: string;
  content: string;
  source: InboundSource;
  sourceOutboundPromptId?: string;
  now?: number;
}

export interface ListInboundMessagesQuery {
  endpointId?: string;
  sessionId?: string;
  status?: InboundStatus;
}

export interface ClaimInboundMessageInput {
  endpointId: string;
  sessionId?: string;
  now?: number;
}

export interface InboundAckInput {
  inboundMessageId: string;
  endpointId: string;
  ok: boolean;
  failureReason?: string;
  now?: number;
}

export interface InboundCancelInput {
  inboundMessageId: string;
  endpointId: string;
  now?: number;
}

export type InboundActionFailure = 'not-found' | 'endpoint-mismatch' | 'invalid-state';

export interface InboundActionResult {
  ok: boolean;
  message?: InboundMessage;
  failureReason?: InboundActionFailure;
}

export interface IdempotentInboundCreateResult {
  message: InboundMessage;
  replayed: boolean;
  conflict: boolean;
}

const TERMINAL_STATUSES: ReadonlySet<InboundStatus> = new Set([
  'consumed',
  'failed',
  'cancelled',
]);

function cloneMessage(message: InboundMessage): InboundMessage {
  return structuredClone(message);
}

export class InMemoryInboundMessageStore {
  private readonly messages = new Map<string, InboundMessage>();
  private readonly packetStore: InMemoryPacketStore;
  private readonly auditLog: InMemoryAuditLog;

  constructor(packetStore: InMemoryPacketStore, auditLog: InMemoryAuditLog) {
    this.packetStore = packetStore;
    this.auditLog = auditLog;
  }

  create(input: CreateInboundMessageInput): InboundMessage {
    const packet = this.packetStore.createPacket({
      sessionId: input.sessionId,
      source: 'chatgpt-web',
      target: 'codex',
      kind: 'manual-transfer',
      rawContent: input.content,
      now: input.now,
    });
    const now = input.now ?? Date.now();
    const message: InboundMessage = {
      id: input.id ?? randomUUID(),
      endpointId: input.endpointId,
      sessionId: input.sessionId,
      packetId: packet.id,
      content: packet.processedContent,
      source: input.source,
      ...(input.sourceOutboundPromptId
        ? { sourceOutboundPromptId: input.sourceOutboundPromptId }
        : {}),
      status: 'queued',
      createdAt: now,
      updatedAt: now,
    };

    assertInboundMessage(message);
    this.messages.set(message.id, cloneMessage(message));
    this.auditLog.createAndAppend({
      sessionId: message.sessionId,
      packetId: message.packetId,
      approvalId: message.id,
      type: 'inbound_created',
      source: 'chatgpt-web',
      target: message.endpointId,
      safety: {
        contentHash: packet.safety.contentHash,
        redactionSummary: packet.safety.redactionSummary,
        riskLevel: packet.safety.blocked ? 'high' : 'low',
      },
      result: { ok: true },
      timestamp: now,
    });

    return cloneMessage(message);
  }

  createIdempotent(input: CreateInboundMessageInput): IdempotentInboundCreateResult {
    if (!input.sourceOutboundPromptId) {
      return { message: this.create(input), replayed: false, conflict: false };
    }
    const existing = Array.from(this.messages.values()).find((message) => (
      message.sourceOutboundPromptId === input.sourceOutboundPromptId
    ));
    if (!existing) {
      return { message: this.create(input), replayed: false, conflict: false };
    }
    const processedContent = redactSensitiveContent(input.content).processedContent;
    const sameOperation = (
      existing.endpointId === input.endpointId &&
      existing.sessionId === input.sessionId &&
      existing.content === processedContent
    );
    return {
      message: cloneMessage(existing),
      replayed: sameOperation,
      conflict: !sameOperation,
    };
  }

  list(query: ListInboundMessagesQuery = {}): InboundMessage[] {
    return Array.from(this.messages.values())
      .filter((message) => (query.endpointId === undefined || message.endpointId === query.endpointId))
      .filter((message) => (query.sessionId === undefined || message.sessionId === query.sessionId))
      .filter((message) => (query.status === undefined || message.status === query.status))
      .sort((left, right) => left.createdAt - right.createdAt)
      .map(cloneMessage);
  }

  claimNext(input: ClaimInboundMessageInput): InboundMessage | undefined {
    const message = Array.from(this.messages.values())
      .filter((candidate) => (
        candidate.status === 'queued' &&
        candidate.endpointId === input.endpointId &&
        (input.sessionId === undefined || candidate.sessionId === input.sessionId)
      ))
      .sort((left, right) => left.createdAt - right.createdAt)[0];

    if (!message) {
      return undefined;
    }

    const now = input.now ?? Date.now();
    message.status = 'claimed';
    message.claimedAt = now;
    message.updatedAt = now;
    this.messages.set(message.id, cloneMessage(message));
    this.auditLog.createAndAppend({
      sessionId: message.sessionId,
      packetId: message.packetId,
      approvalId: message.id,
      type: 'inbound_claimed',
      source: 'local-server',
      target: message.endpointId,
      result: { ok: true },
      timestamp: now,
    });

    return cloneMessage(message);
  }

  ack(input: InboundAckInput): InboundActionResult {
    const guard = this.resolveForEndpoint(input.inboundMessageId, input.endpointId, input.now);
    if (!guard.ok || !guard.message) {
      return guard;
    }
    const message = guard.message;
    const now = input.now ?? Date.now();

    if (input.ok) {
      message.status = 'consumed';
      message.consumedAt = now;
      message.failureReason = undefined;
    } else {
      message.status = 'failed';
      message.failedAt = now;
      message.failureReason = input.failureReason ?? 'inbound-consume-failed';
    }
    message.updatedAt = now;
    this.messages.set(message.id, cloneMessage(message));
    this.auditLog.createAndAppend({
      sessionId: message.sessionId,
      packetId: message.packetId,
      approvalId: message.id,
      type: input.ok ? 'inbound_consumed' : 'inbound_failed',
      source: 'local-server',
      target: message.endpointId,
      result: { ok: input.ok, failureReason: input.ok ? undefined : message.failureReason },
      timestamp: now,
    });

    return { ok: true, message: cloneMessage(message) };
  }

  cancel(input: InboundCancelInput): InboundActionResult {
    const guard = this.resolveForEndpoint(input.inboundMessageId, input.endpointId, input.now);
    if (!guard.ok || !guard.message) {
      return guard;
    }
    const message = guard.message;
    const now = input.now ?? Date.now();
    message.status = 'cancelled';
    message.cancelledAt = now;
    message.updatedAt = now;
    this.messages.set(message.id, cloneMessage(message));
    this.auditLog.createAndAppend({
      sessionId: message.sessionId,
      packetId: message.packetId,
      approvalId: message.id,
      type: 'inbound_cancelled',
      source: 'local-server',
      target: message.endpointId,
      result: { ok: true },
      timestamp: now,
    });

    return { ok: true, message: cloneMessage(message) };
  }

  /** Lifecycle counts for metrics surfaces. */
  summary(): { total: number } & Record<InboundStatus, number> {
    const counts: Record<InboundStatus, number> = {
      queued: 0,
      claimed: 0,
      consumed: 0,
      failed: 0,
      cancelled: 0,
    };
    for (const message of this.messages.values()) {
      counts[message.status] += 1;
    }
    return { total: this.messages.size, ...counts };
  }

  /**
   * Resolve a message for a mutating action by an endpoint, enforcing the
   * endpoint-match invariant and rejecting terminal-state re-actions. Returns a
   * live (non-cloned) reference on success so callers can mutate it.
   */
  private resolveForEndpoint(
    inboundMessageId: string,
    endpointId: string,
    now?: number,
  ): { ok: true; message: InboundMessage } | { ok: false; failureReason: InboundActionFailure } {
    const message = this.messages.get(inboundMessageId);
    if (!message) {
      return { ok: false, failureReason: 'not-found' };
    }
    if (message.endpointId !== endpointId) {
      this.auditLog.createAndAppend({
        sessionId: message.sessionId,
        packetId: message.packetId,
        approvalId: message.id,
        type: 'inbound_rejected',
        source: 'local-server',
        target: message.endpointId,
        result: {
          ok: false,
          failureReason: 'endpoint-mismatch',
          metadata: { requestedEndpointId: endpointId },
        },
        timestamp: now ?? Date.now(),
      });
      return { ok: false, failureReason: 'endpoint-mismatch' };
    }
    if (TERMINAL_STATUSES.has(message.status)) {
      return { ok: false, failureReason: 'invalid-state' };
    }
    return { ok: true, message };
  }
}
