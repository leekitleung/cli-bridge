import { createHash } from 'node:crypto';

import { assertReasoningArtifact } from '../../../../packages/shared/src/schemas.ts';
import type {
  ReasoningArtifact,
  ReasoningArtifactKind,
  RunEndpointBinding,
  Plan,
} from '../../../../packages/shared/src/types.ts';

const DEFAULT_MAX_CONTENT_BYTES = 64 * 1024;
const MAX_SUMMARY_LENGTH = 500;

const FORBIDDEN_AUTHORITY_FIELDS = new Set([
  'executor',
  'executorId',
  'executionEndpointId',
  'permissionProfile',
  'executionPermissionProfile',
  'workingDirectory',
  'workingDirectoryRef',
  'cwd',
  'approval',
  'approved',
  'confirmed',
  'executable',
  'argv',
  'args',
  'command',
]);

export interface NormalizeReasoningArtifactInput {
  binding: RunEndpointBinding;
  plan: Plan;
  endpointId: string;
  kind: ReasoningArtifactKind;
  content: unknown;
  summary: string;
  createdAt?: string;
  artifactId?: string;
  maxContentBytes?: number;
}

export type NormalizeReasoningArtifactResult =
  | { ok: true; artifact: ReasoningArtifact }
  | { ok: false; failureReason: string };

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(text: string): string {
  return `sha256:${createHash('sha256').update(text).digest('hex')}`;
}

function containsForbiddenAuthorityField(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = containsForbiddenAuthorityField(item);
      if (found) return found;
    }
    return undefined;
  }
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_AUTHORITY_FIELDS.has(key)) {
      return key;
    }
    const found = containsForbiddenAuthorityField(nested);
    if (found) return found;
  }
  return undefined;
}

function validateCorrelation(input: NormalizeReasoningArtifactInput): string | undefined {
  if (input.binding.lockedAt === undefined) {
    return 'binding-not-locked';
  }
  if (input.plan.id !== input.binding.planId || input.plan.goalId !== input.binding.goalId) {
    return 'plan-binding-mismatch';
  }
  if (input.endpointId !== input.binding.reasoningEndpointId) {
    return 'reasoning-endpoint-mismatch';
  }
  if (
    input.kind !== 'plan-draft' &&
    input.kind !== 'review-result' &&
    input.kind !== 'execution-proposal'
  ) {
    return 'reasoning-artifact-kind-invalid';
  }
  return undefined;
}

export function normalizeReasoningArtifact(
  input: NormalizeReasoningArtifactInput,
): NormalizeReasoningArtifactResult {
  const correlationFailure = validateCorrelation(input);
  if (correlationFailure) {
    return { ok: false, failureReason: correlationFailure };
  }

  const summary = input.summary.trim();
  if (summary.length === 0 || summary.length > MAX_SUMMARY_LENGTH) {
    return { ok: false, failureReason: 'summary-invalid' };
  }

  const contentJson = stableJson(input.content);
  const contentBytes = Buffer.byteLength(contentJson, 'utf8');
  const maxContentBytes = input.maxContentBytes ?? DEFAULT_MAX_CONTENT_BYTES;
  if (contentBytes > maxContentBytes) {
    return { ok: false, failureReason: 'content-too-large' };
  }

  const forbiddenField = containsForbiddenAuthorityField(input.content);
  if (forbiddenField) {
    return { ok: false, failureReason: `forbidden-authority-field:${forbiddenField}` };
  }

  const contentHash = sha256(contentJson);
  const artifact: ReasoningArtifact = {
    artifactId: input.artifactId ?? sha256([
      input.binding.bindingHash,
      input.binding.goalId,
      input.binding.planId,
      input.endpointId,
      input.kind,
      contentHash,
    ].join('|')),
    goalId: input.binding.goalId,
    planId: input.binding.planId,
    endpointId: input.endpointId,
    bindingHash: input.binding.bindingHash,
    kind: input.kind,
    contentHash,
    summary,
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
  assertReasoningArtifact(artifact);
  return { ok: true, artifact };
}

export function normalizeChatGptReturnArtifact(input: {
  binding: RunEndpointBinding;
  plan: Plan;
  endpointId: string;
  kind: ReasoningArtifactKind;
  sanitizedContent: unknown;
  summary: string;
  createdAt?: string;
  maxContentBytes?: number;
}): NormalizeReasoningArtifactResult {
  return normalizeReasoningArtifact({
    binding: input.binding,
    plan: input.plan,
    endpointId: input.endpointId,
    kind: input.kind,
    content: input.sanitizedContent,
    summary: input.summary,
    createdAt: input.createdAt,
    maxContentBytes: input.maxContentBytes,
  });
}
