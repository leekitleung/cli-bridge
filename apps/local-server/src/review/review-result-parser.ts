import { randomUUID } from 'node:crypto';

import {
  assertAgentReviewResult,
} from '../../../../packages/shared/src/schemas.ts';
import type {
  AgentReviewResult,
} from '../../../../packages/shared/src/types.ts';

export interface ParseClaudeReviewResultInput {
  text: string;
  reviewRequestId: string;
  id?: string;
  now?: number;
}

export interface ParseClaudeReviewResultResult {
  ok: boolean;
  result?: AgentReviewResult;
  failureReason?: string;
}

const FORBIDDEN_RESULT_FIELDS = [
  'executable',
  'autoSend',
  'confirmed',
  'sent',
] as const;

export function parseClaudeReviewResult(
  input: ParseClaudeReviewResultInput,
): ParseClaudeReviewResultResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonFence(input.text));
  } catch {
    return {
      ok: false,
      failureReason: 'review-result-invalid-json',
    };
  }

  if (!isRecord(parsed)) {
    return {
      ok: false,
      failureReason: 'review-result-not-object',
    };
  }

  for (const field of FORBIDDEN_RESULT_FIELDS) {
    if (field in parsed) {
      return {
        ok: false,
        failureReason: `review-result-forbidden-${field}`,
      };
    }
  }

  const result: AgentReviewResult = {
    id: input.id ?? randomUUID(),
    reviewRequestId: input.reviewRequestId,
    summary: typeof parsed.summary === 'string' ? parsed.summary : '',
    findings: Array.isArray(parsed.findings) ? parsed.findings : [],
    nextPromptDraft: typeof parsed.nextPromptDraft === 'string'
      ? parsed.nextPromptDraft
      : undefined,
    createdAt: input.now ?? Date.now(),
  };

  try {
    assertAgentReviewResult(result);
  } catch (error) {
    return {
      ok: false,
      failureReason: error instanceof Error ? error.message : 'review-result-invalid',
    };
  }

  return {
    ok: true,
    result,
  };
}

function stripJsonFence(text: string): string {
  const trimmed = text.trim();
  const match = /^```(?:json)?\s*([\s\S]*?)\s*```$/u.exec(trimmed);
  return match ? match[1] : trimmed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
