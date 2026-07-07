// ADR-0034: WorkBuddy validators - extracted from bridge-api.ts
// This module contains pure validation functions with no side effects.

import type { BridgeRuntime, BridgeResult } from '../bridge-api.ts';
import type { ConversationPairing } from '../../storage/conversation-pairing-store.ts';
import { resolveProjectKey } from '../../storage/project-store.ts';

/**
 * Validates that body.projectId, if present, matches the URL key.
 */
export function requireProjectIdMatch(
  body: Record<string, unknown>,
  urlKey: string,
): string | null {
  const bodyProjectId = body.projectId;
  if (bodyProjectId !== undefined) {
    if (typeof bodyProjectId !== 'string') return 'body.projectId must be a string';
    const resolved = resolveProjectKey(bodyProjectId);
    if (resolved !== urlKey) return 'body.projectId does not match URL project key';
  }
  return null;
}

/**
 * Strips unknown keys from a WorkBuddy payload, keeping only allowed fields
 * for the given action. Returns an error message string if any unknown keys
 * are present, or null on success.
 */
export function sanitizeWorkBuddyPayload(
  action: string,
  body: Record<string, unknown>,
): Record<string, unknown> | string {
  const allowed: string[] = (() => {
    switch (action) {
      case 'record-task':
        return ['id', 'projectId', 'title', 'status', 'createdAt', 'updatedAt'];
      case 'record-review-result':
        return ['id', 'projectId', 'taskId', 'reviewResultId', 'summary', 'findings', 'createdAt'];
      case 'record-prompt-draft':
        return ['id', 'projectId', 'taskId', 'promptDraft', 'createdAt'];
      case 'record-ledger':
        return ['id', 'projectId', 'taskId', 'kind', 'summary', 'createdAt'];
      default:
        return [];
    }
  })();

  const unknownKeys = Object.keys(body).filter(k => !allowed.includes(k));
  if (unknownKeys.length > 0) {
    return `Unknown field(s): ${unknownKeys.join(', ')}`;
  }

  const sanitized: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in body) sanitized[key] = body[key];
  }
  return sanitized;
}

/**
 * ADR-0034: Local fast path for WorkBuddy status queries.
 * Only status/result queries get a local fast path. Real execution requests
 * always go through the planner.
 */
export function isLocalWorkBuddyFastRequest(
  text: string,
  pairing: ConversationPairing | undefined,
): boolean {
  if (!pairing || pairing.targetEndpointId !== 'workbuddy') return false;
  const normalized = text.toLowerCase();
  if (!/workbuddy|执行|executor/.test(normalized)) return false;
  return /结果|响应|进度|状态|收到|有没有|怎样|怎么样|ready|status|result/.test(normalized);
}

/**
 * Check if a value is a WorkBuddy connector diagnostic message.
 */
export function isWorkBuddyConnectorDiagnosticText(value: unknown): boolean {
  return typeof value === 'string'
    && /^diagnostic worker received:/i.test(value.trim());
}
