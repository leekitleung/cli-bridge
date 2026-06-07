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
  buildCodexFeasibilityPrompt,
  type CodexFeasibilityPromptInput,
} from './codex-feasibility-prompt.ts';

export interface CreateCodexFeasibilityReviewDraftInput extends CodexFeasibilityPromptInput {
  pendingReviewStore: InMemoryPendingReviewStore;
  id?: string;
  sessionId: string;
  now?: number;
}

export interface CodexFeasibilityClipboardHandoffInput {
  review: AgentReviewRequest;
  registry: InMemoryEndpointRegistry;
  auditLog: InMemoryAuditLog;
  now?: number;
}

export interface CodexFeasibilityClipboardHandoff {
  ok: boolean;
  status: 'ready-to-copy' | 'failed';
  transport: 'clipboard';
  reviewId: string;
  targetEndpointId: string;
  clipboardText: string;
  checklist: string[];
  failureReason?: string;
}

const CODEX_FEASIBILITY_CHECKLIST = [
  'Copy the feasibility-only prompt.',
  'Paste it into Codex manually.',
  'Do not ask Codex to execute, patch, write files, or run commands.',
  'Paste the ReviewResult-shaped JSON back into CLI Bridge for capture.',
];

export function createCodexFeasibilityReviewDraft(
  input: CreateCodexFeasibilityReviewDraftInput,
): AgentReviewRequest {
  return input.pendingReviewStore.createDraft({
    id: input.id,
    sessionId: input.sessionId,
    sourceEndpointId: 'claude-code',
    targetEndpointId: 'codex-feasibility',
    prompt: buildCodexFeasibilityPrompt(input),
    now: input.now,
  });
}

export function createCodexFeasibilityClipboardHandoff(
  input: CodexFeasibilityClipboardHandoffInput,
): CodexFeasibilityClipboardHandoff {
  const capability = input.registry.validateAction(input.review.targetEndpointId, 'review');
  if (!capability.ok) {
    return failedHandoff(input.review, capability.failureReason ?? 'capability-denied');
  }

  if (input.review.targetEndpointId !== 'codex-feasibility') {
    return failedHandoff(input.review, 'target-not-codex-feasibility');
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
    checklist: CODEX_FEASIBILITY_CHECKLIST,
  };
}

function failedHandoff(
  review: AgentReviewRequest,
  failureReason: string,
): CodexFeasibilityClipboardHandoff {
  return {
    ok: false,
    status: 'failed',
    transport: 'clipboard',
    reviewId: review.id,
    targetEndpointId: review.targetEndpointId,
    clipboardText: '',
    checklist: CODEX_FEASIBILITY_CHECKLIST,
    failureReason,
  };
}
