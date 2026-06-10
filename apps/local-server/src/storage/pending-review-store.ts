import { randomUUID } from 'node:crypto';

import {
  assertAgentReviewRequest,
  assertAgentReviewResult,
} from '../../../../packages/shared/src/schemas.ts';
import type {
  AgentReviewRequest,
  AgentReviewResult,
  PendingPrompt,
} from '../../../../packages/shared/src/types.ts';
import type {
  InMemoryEndpointRegistry,
} from '../endpoints/endpoint-registry.ts';
import type {
  InMemoryAuditLog,
} from './audit-log.ts';
import type {
  InMemoryPacketStore,
} from './packet-store.ts';
import type {
  InMemoryPendingPromptStore,
} from './pending-prompt-store.ts';

export interface CreatePendingReviewInput {
  id?: string;
  sessionId: string;
  sourceEndpointId: string;
  targetEndpointId: string;
  prompt: string;
  /** Optional project scope (Phase B). */
  projectId?: string;
  now?: number;
}

export interface ReturnReviewResultInput {
  id?: string;
  summary: string;
  findings: string[];
  nextPromptDraft?: string;
  now?: number;
}

export interface PendingReviewSendResult {
  ok: boolean;
  review: AgentReviewRequest;
  failureReason?: string;
}

export interface PendingReviewReturnResult {
  ok: boolean;
  review: AgentReviewRequest;
  result?: AgentReviewResult;
  nextPrompt?: PendingPrompt;
  failureReason?: string;
}

function cloneReview(review: AgentReviewRequest): AgentReviewRequest {
  return structuredClone(review);
}

function cloneResult(result: AgentReviewResult): AgentReviewResult {
  return structuredClone(result);
}

export class InMemoryPendingReviewStore {
  private readonly reviews = new Map<string, AgentReviewRequest>();
  private readonly results = new Map<string, AgentReviewResult>();
  private readonly endpointRegistry: InMemoryEndpointRegistry;
  private readonly packetStore: InMemoryPacketStore;
  private readonly auditLog: InMemoryAuditLog;
  private readonly pendingPromptStore: InMemoryPendingPromptStore;

  constructor(
    endpointRegistry: InMemoryEndpointRegistry,
    packetStore: InMemoryPacketStore,
    auditLog: InMemoryAuditLog,
    pendingPromptStore: InMemoryPendingPromptStore,
  ) {
    this.endpointRegistry = endpointRegistry;
    this.packetStore = packetStore;
    this.auditLog = auditLog;
    this.pendingPromptStore = pendingPromptStore;
  }

  createDraft(input: CreatePendingReviewInput): AgentReviewRequest {
    this.assertEndpointExists(input.sourceEndpointId);
    this.assertCanReview(input.targetEndpointId);

    const now = input.now ?? Date.now();
    const packet = this.packetStore.createPacket({
      sessionId: input.sessionId,
      source: 'user-selection',
      target: 'clipboard',
      kind: 'cli-output-review',
      rawContent: input.prompt,
      now,
    });
    const review: AgentReviewRequest = {
      id: input.id ?? randomUUID(),
      sessionId: input.sessionId,
      sourceEndpointId: input.sourceEndpointId,
      targetEndpointId: input.targetEndpointId,
      packetId: packet.id,
      projectId: input.projectId,
      status: 'draft',
      prompt: packet.processedContent,
      createdAt: now,
      updatedAt: now,
    };

    assertAgentReviewRequest(review);
    this.reviews.set(review.id, cloneReview(review));
    this.auditLog.createAndAppend({
      sessionId: review.sessionId,
      packetId: review.packetId,
      type: 'create_pending_review',
      source: review.sourceEndpointId,
      target: review.targetEndpointId,
      safety: {
        contentHash: packet.safety.contentHash,
        redactionSummary: packet.safety.redactionSummary,
        riskLevel: packet.safety.blocked ? 'high' : 'low',
      },
      result: {
        ok: true,
      },
      timestamp: now,
    });

    return cloneReview(review);
  }

  preview(reviewId: string, now: number = Date.now()): AgentReviewRequest | undefined {
    const review = this.reviews.get(reviewId);
    if (!review || review.status !== 'draft') {
      return undefined;
    }

    review.status = 'previewed';
    review.updatedAt = now;
    this.reviews.set(review.id, cloneReview(review));
    this.auditLog.createAndAppend({
      sessionId: review.sessionId,
      packetId: review.packetId,
      type: 'preview_review',
      source: review.sourceEndpointId,
      target: review.targetEndpointId,
      result: {
        ok: true,
      },
      timestamp: now,
    });

    return cloneReview(review);
  }

  confirm(reviewId: string, now: number = Date.now()): AgentReviewRequest | undefined {
    const review = this.reviews.get(reviewId);
    if (!review || review.status !== 'previewed') {
      return undefined;
    }

    review.status = 'confirmed';
    review.confirmedAt = now;
    review.updatedAt = now;
    this.reviews.set(review.id, cloneReview(review));
    this.auditLog.createAndAppend({
      sessionId: review.sessionId,
      packetId: review.packetId,
      type: 'confirm_review',
      source: review.sourceEndpointId,
      target: review.targetEndpointId,
      result: {
        ok: true,
      },
      timestamp: now,
    });

    return cloneReview(review);
  }

  sendConfirmed(reviewId: string, now: number = Date.now()): PendingReviewSendResult {
    const review = this.reviews.get(reviewId);
    if (!review) {
      return {
        ok: false,
        review: this.createMissingReview(reviewId, now),
        failureReason: 'pending-review-not-found',
      };
    }

    const capability = this.endpointRegistry.validateAction(review.targetEndpointId, 'review');
    if (!capability.ok) {
      return {
        ok: false,
        review: cloneReview(review),
        failureReason: capability.failureReason,
      };
    }

    if (review.status !== 'confirmed') {
      return {
        ok: false,
        review: cloneReview(review),
        failureReason: 'pending-review-not-confirmed',
      };
    }

    review.status = 'sent';
    review.sentAt = now;
    review.updatedAt = now;
    this.reviews.set(review.id, cloneReview(review));
    this.auditLog.createAndAppend({
      sessionId: review.sessionId,
      packetId: review.packetId,
      type: 'send_review',
      source: review.sourceEndpointId,
      target: review.targetEndpointId,
      result: {
        ok: true,
      },
      timestamp: now,
    });

    return {
      ok: true,
      review: cloneReview(review),
    };
  }

  returnResult(
    reviewId: string,
    input: ReturnReviewResultInput,
  ): PendingReviewReturnResult {
    const review = this.reviews.get(reviewId);
    const now = input.now ?? Date.now();
    if (!review) {
      return {
        ok: false,
        review: this.createMissingReview(reviewId, now),
        failureReason: 'pending-review-not-found',
      };
    }

    if (review.status !== 'sent') {
      return {
        ok: false,
        review: cloneReview(review),
        failureReason: 'pending-review-not-sent',
      };
    }

    const result: AgentReviewResult = {
      id: input.id ?? randomUUID(),
      reviewRequestId: review.id,
      summary: input.summary,
      findings: input.findings,
      nextPromptDraft: input.nextPromptDraft,
      createdAt: now,
    };
    assertAgentReviewResult(result);

    review.status = 'returned';
    review.returnedAt = now;
    review.updatedAt = now;
    this.reviews.set(review.id, cloneReview(review));
    this.results.set(result.id, cloneResult(result));
    this.auditLog.createAndAppend({
      sessionId: review.sessionId,
      packetId: review.packetId,
      type: 'return_review_result',
      source: review.targetEndpointId,
      target: review.sourceEndpointId,
      result: {
        ok: true,
      },
      timestamp: now,
    });

    const nextPrompt = result.nextPromptDraft
      ? this.pendingPromptStore.createPendingPrompt({
        sessionId: review.sessionId,
        prompt: result.nextPromptDraft,
        source: 'user-selection',
        transport: 'managed-pty',
        projectId: review.projectId,
        now,
      })
      : undefined;

    return {
      ok: true,
      review: cloneReview(review),
      result: cloneResult(result),
      nextPrompt,
    };
  }

  cancel(reviewId: string, now: number = Date.now()): AgentReviewRequest | undefined {
    const review = this.reviews.get(reviewId);
    if (
      !review ||
      review.status === 'sent' ||
      review.status === 'returned' ||
      review.status === 'cancelled' ||
      review.status === 'failed'
    ) {
      return undefined;
    }

    review.status = 'cancelled';
    review.cancelledAt = now;
    review.updatedAt = now;
    this.reviews.set(review.id, cloneReview(review));
    this.auditLog.createAndAppend({
      sessionId: review.sessionId,
      packetId: review.packetId,
      type: 'operation_cancelled',
      source: review.sourceEndpointId,
      target: review.targetEndpointId,
      result: {
        ok: true,
      },
      timestamp: now,
    });

    return cloneReview(review);
  }

  fail(
    reviewId: string,
    reason: string,
    now: number = Date.now(),
  ): AgentReviewRequest | undefined {
    const review = this.reviews.get(reviewId);
    if (!review || review.status === 'returned' || review.status === 'failed') {
      return undefined;
    }

    review.status = 'failed';
    review.failureReason = reason;
    review.failedAt = now;
    review.updatedAt = now;
    this.reviews.set(review.id, cloneReview(review));
    this.auditLog.createAndAppend({
      sessionId: review.sessionId,
      packetId: review.packetId,
      type: 'operation_failed',
      source: review.sourceEndpointId,
      target: review.targetEndpointId,
      result: {
        ok: false,
        failureReason: reason,
      },
      timestamp: now,
    });

    return cloneReview(review);
  }

  get(reviewId: string): AgentReviewRequest | undefined {
    const review = this.reviews.get(reviewId);
    return review ? cloneReview(review) : undefined;
  }

  list(): AgentReviewRequest[] {
    return Array.from(this.reviews.values(), cloneReview);
  }

  listResults(): AgentReviewResult[] {
    return Array.from(this.results.values(), cloneResult);
  }

  private assertEndpointExists(endpointId: string): void {
    if (!this.endpointRegistry.get(endpointId)) {
      throw new Error(`endpoint-not-found: ${endpointId}`);
    }
  }

  private assertCanReview(endpointId: string): void {
    const result = this.endpointRegistry.validateAction(endpointId, 'review');
    if (!result.ok) {
      throw new Error(result.failureReason);
    }
  }

  private createMissingReview(reviewId: string, now: number): AgentReviewRequest {
    return {
      id: reviewId,
      sessionId: 'unknown',
      sourceEndpointId: 'unknown',
      targetEndpointId: 'unknown',
      packetId: 'unknown',
      status: 'failed',
      prompt: '',
      createdAt: now,
      updatedAt: now,
      failedAt: now,
      failureReason: 'pending-review-not-found',
    };
  }
}
