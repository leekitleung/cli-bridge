// Command Review Runner (v1.5b) — ties a review-only command adapter to the
// PendingReview lifecycle without granting any new authority.
//
// It takes a review that has already been confirmed and sent (the human gate is
// upstream), runs the fixed review-only CLI through the adapter, and feeds a
// successful ReviewResult back into the store via returnResult. A nextPromptDraft
// (if any) is created by the store as a DRAFT pending prompt only — it is never
// auto-confirmed, auto-sent, or executed.

import type {
  CommandReviewAdapter,
} from '../adapters/command-review-adapter.ts';
import type {
  CommandRunOptions,
} from '../adapters/command-runner.ts';
import type {
  InMemoryAuditLog,
} from '../storage/audit-log.ts';
import type {
  InMemoryPendingReviewStore,
  PendingReviewReturnResult,
} from '../storage/pending-review-store.ts';

export interface RunCommandReviewInput {
  reviewId: string;
  prompt: string;
  cwd?: string;
  resultId?: string;
  now?: number;
}

export interface RunCommandReviewResult {
  ok: boolean;
  failureReason?: string;
  returned?: PendingReviewReturnResult;
}

export async function runCommandReview(
  store: InMemoryPendingReviewStore,
  auditLog: InMemoryAuditLog,
  adapter: CommandReviewAdapter,
  input: RunCommandReviewInput,
  options: CommandRunOptions = {},
): Promise<RunCommandReviewResult> {
  const review = store.get(input.reviewId);
  if (!review) {
    return { ok: false, failureReason: 'pending-review-not-found' };
  }

  // The review must already have passed the human send gate. This runner never
  // confirms or sends on the user's behalf.
  if (review.status !== 'sent') {
    return { ok: false, failureReason: 'pending-review-not-sent' };
  }

  const now = input.now ?? Date.now();
  const reviewResult = await adapter.review(
    {
      prompt: input.prompt,
      reviewRequestId: review.id,
      cwd: input.cwd,
      resultId: input.resultId,
      now,
    },
    options,
  );

  if (!reviewResult.ok || !reviewResult.result) {
    // store.fail emits its own operation_failed audit; do not double-log.
    store.fail(review.id, reviewResult.failureReason ?? 'command-review-failed', now);
    return { ok: false, failureReason: reviewResult.failureReason ?? 'command-review-failed' };
  }

  // Audit the successful invocation with non-sensitive command metadata only.
  // Raw prompt and raw CLI output are never written.
  auditLog.createAndAppend({
    sessionId: review.sessionId,
    packetId: review.packetId,
    projectId: review.projectId,
    approvalId: review.id,
    type: 'send_review',
    source: review.sourceEndpointId,
    target: review.targetEndpointId,
    snapshot: {
      agent: reviewResult.adapterName,
      transport: 'command',
    },
    result: {
      ok: true,
    },
    timestamp: now,
  });

  const returned = store.returnResult(review.id, {
    id: reviewResult.result.id,
    summary: reviewResult.result.summary,
    findings: reviewResult.result.findings,
    nextPromptDraft: reviewResult.result.nextPromptDraft,
    now,
  });

  if (!returned.ok) {
    return { ok: false, failureReason: returned.failureReason };
  }

  return { ok: true, returned };
}
