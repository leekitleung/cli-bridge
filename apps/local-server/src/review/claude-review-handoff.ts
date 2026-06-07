import type {
  AgentReviewRequest,
} from '../../../../packages/shared/src/types.ts';
import type {
  InMemoryEndpointRegistry,
} from '../endpoints/endpoint-registry.ts';
import type {
  InMemoryAuditLog,
} from '../storage/audit-log.ts';
import type {
  InMemoryPendingReviewStore,
} from '../storage/pending-review-store.ts';
import {
  buildClaudeReviewPrompt,
  type ClaudeReviewPromptInput,
} from './claude-review-prompt.ts';

export interface CreateCodexClaudeReviewDraftInput extends ClaudeReviewPromptInput {
  pendingReviewStore: InMemoryPendingReviewStore;
  id?: string;
  sessionId: string;
  now?: number;
}

export interface ClaudeReviewClipboardHandoffInput {
  review: AgentReviewRequest;
  registry: InMemoryEndpointRegistry;
  auditLog: InMemoryAuditLog;
  now?: number;
}

export interface ClaudeReviewClipboardHandoff {
  ok: boolean;
  status: 'ready-to-copy' | 'failed';
  transport: 'clipboard';
  reviewId: string;
  targetEndpointId: string;
  clipboardText: string;
  checklist: string[];
  failureReason?: string;
}

const CLAUDE_REVIEW_CHECKLIST = [
  'Copy the review-only prompt.',
  'Paste it into Claude Code manually.',
  'Do not ask Claude Code to execute, patch, write files, or run commands.',
  'Paste the ReviewResult-shaped JSON back into CLI Bridge for capture.',
];

export function createCodexClaudeReviewDraft(
  input: CreateCodexClaudeReviewDraftInput,
): AgentReviewRequest {
  return input.pendingReviewStore.createDraft({
    id: input.id,
    sessionId: input.sessionId,
    sourceEndpointId: 'codex-cli',
    targetEndpointId: 'claude-code',
    prompt: buildClaudeReviewPrompt(input),
    now: input.now,
  });
}

export function createClaudeReviewClipboardHandoff(
  input: ClaudeReviewClipboardHandoffInput,
): ClaudeReviewClipboardHandoff {
  const capability = input.registry.validateAction(input.review.targetEndpointId, 'review');
  if (!capability.ok) {
    return failedHandoff(input.review, capability.failureReason ?? 'capability-denied');
  }

  if (input.review.targetEndpointId !== 'claude-code') {
    return failedHandoff(input.review, 'target-not-claude-code');
  }

  input.auditLog.createAndAppend({
    sessionId: input.review.sessionId,
    packetId: input.review.packetId,
    type: 'copy_to_clipboard',
    source: 'local-server',
    target: input.review.targetEndpointId,
    snapshot: {
      transport: 'clipboard',
    },
    result: {
      ok: true,
    },
    timestamp: input.now ?? Date.now(),
  });

  return {
    ok: true,
    status: 'ready-to-copy',
    transport: 'clipboard',
    reviewId: input.review.id,
    targetEndpointId: input.review.targetEndpointId,
    clipboardText: input.review.prompt,
    checklist: CLAUDE_REVIEW_CHECKLIST,
  };
}

function failedHandoff(
  review: AgentReviewRequest,
  failureReason: string,
): ClaudeReviewClipboardHandoff {
  return {
    ok: false,
    status: 'failed',
    transport: 'clipboard',
    reviewId: review.id,
    targetEndpointId: review.targetEndpointId,
    clipboardText: '',
    checklist: CLAUDE_REVIEW_CHECKLIST,
    failureReason,
  };
}
