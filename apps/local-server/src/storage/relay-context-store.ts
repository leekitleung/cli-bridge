// Phase 3 multi-executor relay (foundation): endpoint/session routing context.
//
// This store holds two things, intentionally separate:
//   1. bindings:  sessionId -> endpointId, established when an outbound prompt
//      carrying an endpointId is created. It enforces that a session binds to
//      exactly one endpoint (first binding wins; a different endpoint is a
//      conflict). This is what makes "same session + different endpoint" reject
//      at POST /bridge/outbound time.
//   2. contexts:  sessionId -> RelayContext, written ONLY when an outbound with
//      an endpointId is *delivered* (ack ok). This is the routing context a
//      later phase uses to send an extracted reply back to the originating
//      executor. ack failures and endpointId-less outbounds never write here.
//
// Memory-only in this foundation phase (persistence deferred). No inbound queue,
// no auto-send, no terminal writeback — those are separate, later, ADR-gated.

import type { RelayContext } from '../../../../packages/shared/src/types.ts';
import type { InMemoryAuditLog } from './audit-log.ts';

export interface RelayBindResult {
  ok: boolean;
  endpointId?: string;
  failureReason?: 'session-endpoint-conflict';
}

export class InMemoryRelayContextStore {
  private readonly bindings = new Map<string, string>();
  private readonly contexts = new Map<string, RelayContext>();
  private readonly auditLog: InMemoryAuditLog;

  constructor(auditLog: InMemoryAuditLog) {
    this.auditLog = auditLog;
  }

  /**
   * Bind a session to an endpoint. First binding wins. A different endpoint for
   * an already-bound session is rejected as a conflict (audited). Re-binding the
   * same endpoint is idempotent.
   */
  bind(sessionId: string, endpointId: string, now: number = Date.now()): RelayBindResult {
    const existing = this.bindings.get(sessionId);
    if (existing && existing !== endpointId) {
      this.auditLog.createAndAppend({
        sessionId,
        type: 'relay_context_conflict',
        source: 'local-server',
        target: 'chatgpt-web',
        result: {
          ok: false,
          failureReason: 'session-endpoint-conflict',
          metadata: { requestedEndpointId: endpointId, boundEndpointId: existing },
        },
        timestamp: now,
      });
      return { ok: false, failureReason: 'session-endpoint-conflict' };
    }

    if (!existing) {
      this.bindings.set(sessionId, endpointId);
      this.auditLog.createAndAppend({
        sessionId,
        type: 'relay_context_bound',
        source: 'local-server',
        target: 'chatgpt-web',
        result: { ok: true, metadata: { endpointId } },
        timestamp: now,
      });
    }

    return { ok: true, endpointId };
  }

  /**
   * Record a delivered outbound's routing context. Only call this on ack ok for
   * an outbound that carries an endpointId.
   */
  recordDelivered(
    sessionId: string,
    endpointId: string,
    outboundPromptId: string,
    now: number = Date.now(),
  ): RelayContext {
    if (!this.bindings.has(sessionId)) {
      this.bindings.set(sessionId, endpointId);
    }
    const context: RelayContext = {
      sessionId,
      endpointId,
      lastOutboundPromptId: outboundPromptId,
      updatedAt: now,
    };
    this.contexts.set(sessionId, { ...context });
    this.auditLog.createAndAppend({
      sessionId,
      approvalId: outboundPromptId,
      type: 'relay_context_delivered',
      source: 'chatgpt-web',
      target: 'chatgpt-web',
      result: { ok: true, metadata: { endpointId } },
      timestamp: now,
    });
    return { ...context };
  }

  /** The delivered routing context for a session, if any. */
  getRelayContext(sessionId: string): RelayContext | undefined {
    const context = this.contexts.get(sessionId);
    return context ? { ...context } : undefined;
  }

  /**
   * Resolve which endpoint an extracted reply for this session should route to.
   * Returns undefined when no delivered context exists (caller must then fall
   * back to the existing pending-prompt path — never invent an inbound record).
   */
  resolveInboundEndpointForSession(sessionId: string): string | undefined {
    return this.contexts.get(sessionId)?.endpointId;
  }

  /** The session→endpoint binding (set at outbound create), if any. */
  getBoundEndpoint(sessionId: string): string | undefined {
    return this.bindings.get(sessionId);
  }
}
