import {
  AUDIT_EVENT_TYPES,
  AUDIT_RISK_LEVELS,
  AGENT_ENDPOINT_RISKS,
  AGENT_ENDPOINT_TRANSPORTS,
  AGENT_REVIEW_STATUSES,
  BRIDGE_PACKET_KINDS,
  BRIDGE_PACKET_SOURCES,
  BRIDGE_PACKET_STATUSES,
  BRIDGE_PACKET_TARGETS,
  OUTBOUND_PROMPT_STATUSES,
  RAW_CONTENT_REF_STORAGE,
  GOAL_STATUSES,
  PLAN_STATUSES,
  PLAN_STEP_STATUSES,
  PLAN_STEP_KINDS,
  EXECUTION_TIERS,
  type AgentEndpoint,
  type AgentReviewRequest,
  type AgentReviewResult,
  type AuditEvent,
  type BridgePacket,
  type OutboundPrompt,
  type Goal,
  type Plan,
  type PlanStep,
  type Project,
  type WorkBuddyExecutionLedgerEvent,
  type WorkBuddyProjectSnapshot,
  type WorkBuddyPromptDraftSink,
  type WorkBuddyReviewResultSink,
  type WorkBuddyTaskReference,
} from './types.ts';

export const SHARED_SCHEMA_VERSION = 0;

export interface SchemaValidationResult {
  ok: boolean;
  errors: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isOneOf<T extends readonly string[]>(value: unknown, allowed: T): value is T[number] {
  return typeof value === 'string' && allowed.includes(value);
}

function requireString(record: Record<string, unknown>, key: string, errors: string[]): void {
  if (typeof record[key] !== 'string') {
    errors.push(`${key} must be a string`);
  }
}

function requireNumber(record: Record<string, unknown>, key: string, errors: string[]): void {
  if (typeof record[key] !== 'number' || !Number.isFinite(record[key])) {
    errors.push(`${key} must be a finite number`);
  }
}

function requireBoolean(record: Record<string, unknown>, key: string, errors: string[]): void {
  if (typeof record[key] !== 'boolean') {
    errors.push(`${key} must be a boolean`);
  }
}

export function validateBridgePacket(value: unknown): SchemaValidationResult {
  const errors: string[] = [];

  if (!isRecord(value)) {
    return {
      ok: false,
      errors: ['packet must be an object'],
    };
  }

  if ('rawContent' in value) {
    errors.push('rawContent must not be stored on BridgePacket');
  }

  requireString(value, 'id', errors);
  requireString(value, 'sessionId', errors);
  requireString(value, 'processedContent', errors);
  requireNumber(value, 'createdAt', errors);
  requireNumber(value, 'updatedAt', errors);

  if (!isOneOf(value.source, BRIDGE_PACKET_SOURCES)) {
    errors.push('source is invalid');
  }

  if (!isOneOf(value.target, BRIDGE_PACKET_TARGETS)) {
    errors.push('target is invalid');
  }

  if (!isOneOf(value.kind, BRIDGE_PACKET_KINDS)) {
    errors.push('kind is invalid');
  }

  if (!isOneOf(value.status, BRIDGE_PACKET_STATUSES)) {
    errors.push('status is invalid');
  }

  if (value.rawContentRef !== undefined) {
    if (!isRecord(value.rawContentRef)) {
      errors.push('rawContentRef must be an object');
    } else {
      if (!isOneOf(value.rawContentRef.storage, RAW_CONTENT_REF_STORAGE)) {
        errors.push('rawContentRef.storage is invalid');
      }

      if (
        value.rawContentRef.expiresAt !== undefined &&
        (typeof value.rawContentRef.expiresAt !== 'number' ||
          !Number.isFinite(value.rawContentRef.expiresAt))
      ) {
        errors.push('rawContentRef.expiresAt must be a finite number');
      }
    }
  }

  if (!isRecord(value.safety)) {
    errors.push('safety must be an object');
  } else {
    requireBoolean(value.safety, 'redactionApplied', errors);
    requireBoolean(value.safety, 'blocked', errors);
    requireString(value.safety, 'contentHash', errors);

    if (!isStringArray(value.safety.redactionSummary)) {
      errors.push('safety.redactionSummary must be a string array');
    }

    if (!isStringArray(value.safety.blockReasons)) {
      errors.push('safety.blockReasons must be a string array');
    }
  }

  if (!isRecord(value.context)) {
    errors.push('context must be an object');
  }

  if (!isRecord(value.metrics)) {
    errors.push('metrics must be an object');
  } else {
    requireNumber(value.metrics, 'processedLength', errors);
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}

export function assertBridgePacket(value: unknown): asserts value is BridgePacket {
  const result = validateBridgePacket(value);
  if (!result.ok) {
    throw new Error(`Invalid BridgePacket: ${result.errors.join(', ')}`);
  }
}

export function validateAuditEvent(value: unknown): SchemaValidationResult {
  const errors: string[] = [];

  if (!isRecord(value)) {
    return {
      ok: false,
      errors: ['audit event must be an object'],
    };
  }

  requireString(value, 'id', errors);
  requireString(value, 'sessionId', errors);
  requireString(value, 'source', errors);
  requireString(value, 'target', errors);
  requireNumber(value, 'timestamp', errors);

  if (value.packetId !== undefined && typeof value.packetId !== 'string') {
    errors.push('packetId must be a string');
  }

  if (value.approvalId !== undefined && typeof value.approvalId !== 'string') {
    errors.push('approvalId must be a string');
  }

  if (!isOneOf(value.type, AUDIT_EVENT_TYPES)) {
    errors.push('type is invalid');
  }

  if (!isRecord(value.snapshot)) {
    errors.push('snapshot must be an object');
  }

  if (!isRecord(value.safety)) {
    errors.push('safety must be an object');
  } else {
    if (
      value.safety.contentHash !== undefined &&
      typeof value.safety.contentHash !== 'string'
    ) {
      errors.push('safety.contentHash must be a string');
    }

    if (
      value.safety.redactionSummary !== undefined &&
      !isStringArray(value.safety.redactionSummary)
    ) {
      errors.push('safety.redactionSummary must be a string array');
    }

    if (
      value.safety.riskLevel !== undefined &&
      !isOneOf(value.safety.riskLevel, AUDIT_RISK_LEVELS)
    ) {
      errors.push('safety.riskLevel is invalid');
    }
  }

  if (!isRecord(value.result)) {
    errors.push('result must be an object');
  } else {
    if (typeof value.result.ok !== 'boolean') {
      errors.push('result.ok must be a boolean');
    }

    if (
      value.result.failureReason !== undefined &&
      typeof value.result.failureReason !== 'string'
    ) {
      errors.push('result.failureReason must be a string');
    }
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}

export function assertAuditEvent(value: unknown): asserts value is AuditEvent {
  const result = validateAuditEvent(value);
  if (!result.ok) {
    throw new Error(`Invalid AuditEvent: ${result.errors.join(', ')}`);
  }
}

export function validateOutboundPrompt(value: unknown): SchemaValidationResult {
  const errors: string[] = [];

  if (!isRecord(value)) {
    return {
      ok: false,
      errors: ['outbound prompt must be an object'],
    };
  }

  if ('rawContent' in value) {
    errors.push('rawContent must not be stored on OutboundPrompt');
  }

  for (const key of ['id', 'sessionId', 'packetId', 'prompt']) {
    if (typeof value[key] !== 'string' || value[key].trim().length === 0) {
      errors.push(`${key} must be a non-empty string`);
    }
  }

  if (value.target !== 'chatgpt-web') {
    errors.push('target must be chatgpt-web');
  }

  if (!isOneOf(value.status, OUTBOUND_PROMPT_STATUSES)) {
    errors.push('status is invalid');
  }

  requireNumber(value, 'createdAt', errors);
  requireNumber(value, 'updatedAt', errors);

  for (const key of ['claimedAt', 'deliveredAt', 'failedAt', 'cancelledAt']) {
    if (
      value[key] !== undefined &&
      (typeof value[key] !== 'number' || !Number.isFinite(value[key]))
    ) {
      errors.push(`${key} must be a finite number`);
    }
  }

  if (value.failureReason !== undefined && typeof value.failureReason !== 'string') {
    errors.push('failureReason must be a string');
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}

export function assertOutboundPrompt(value: unknown): asserts value is OutboundPrompt {
  const result = validateOutboundPrompt(value);
  if (!result.ok) {
    throw new Error(`Invalid OutboundPrompt: ${result.errors.join(', ')}`);
  }
}

export function validateAgentEndpoint(value: unknown): SchemaValidationResult {
  const errors: string[] = [];

  if (!isRecord(value)) {
    return {
      ok: false,
      errors: ['endpoint must be an object'],
    };
  }

  if (typeof value.id !== 'string' || value.id.trim().length === 0) {
    errors.push('id must be a non-empty string');
  }

  if (typeof value.label !== 'string' || value.label.trim().length === 0) {
    errors.push('label must be a non-empty string');
  }

  if (!isOneOf(value.transport, AGENT_ENDPOINT_TRANSPORTS)) {
    errors.push('transport is invalid');
  }

  if (!isOneOf(value.risk, AGENT_ENDPOINT_RISKS)) {
    errors.push('risk is invalid');
  }

  if (!isRecord(value.capabilities)) {
    errors.push('capabilities must be an object');
  } else {
    requireBoolean(value.capabilities, 'canAcceptPrompt', errors);
    requireBoolean(value.capabilities, 'canReturnOutput', errors);
    requireBoolean(value.capabilities, 'canReview', errors);
    requireBoolean(value.capabilities, 'canExecute', errors);
    requireBoolean(value.capabilities, 'canSummarize', errors);
  }

  if (value.adapterName !== undefined && typeof value.adapterName !== 'string') {
    errors.push('adapterName must be a string');
  }

  if (value.experimental !== undefined && typeof value.experimental !== 'boolean') {
    errors.push('experimental must be a boolean');
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}

export function assertAgentEndpoint(value: unknown): asserts value is AgentEndpoint {
  const result = validateAgentEndpoint(value);
  if (!result.ok) {
    throw new Error(`Invalid AgentEndpoint: ${result.errors.join(', ')}`);
  }
}

export function validateAgentReviewRequest(value: unknown): SchemaValidationResult {
  const errors: string[] = [];

  if (!isRecord(value)) {
    return {
      ok: false,
      errors: ['review request must be an object'],
    };
  }

  for (const key of ['id', 'sessionId', 'sourceEndpointId', 'targetEndpointId', 'packetId', 'prompt']) {
    if (typeof value[key] !== 'string' || value[key].trim().length === 0) {
      errors.push(`${key} must be a non-empty string`);
    }
  }

  if (!isOneOf(value.status, AGENT_REVIEW_STATUSES)) {
    errors.push('status is invalid');
  }

  requireNumber(value, 'createdAt', errors);
  requireNumber(value, 'updatedAt', errors);

  for (const key of ['confirmedAt', 'sentAt', 'returnedAt', 'cancelledAt', 'failedAt']) {
    if (
      value[key] !== undefined &&
      (typeof value[key] !== 'number' || !Number.isFinite(value[key]))
    ) {
      errors.push(`${key} must be a finite number`);
    }
  }

  if (value.failureReason !== undefined && typeof value.failureReason !== 'string') {
    errors.push('failureReason must be a string');
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}

export function assertAgentReviewRequest(value: unknown): asserts value is AgentReviewRequest {
  const result = validateAgentReviewRequest(value);
  if (!result.ok) {
    throw new Error(`Invalid AgentReviewRequest: ${result.errors.join(', ')}`);
  }
}

export function validateAgentReviewResult(value: unknown): SchemaValidationResult {
  const errors: string[] = [];

  if (!isRecord(value)) {
    return {
      ok: false,
      errors: ['review result must be an object'],
    };
  }

  for (const key of ['executable', 'autoSend', 'confirmed', 'sent']) {
    if (key in value) {
      errors.push(`${key} must not be present on AgentReviewResult`);
    }
  }

  for (const key of ['id', 'reviewRequestId', 'summary']) {
    if (typeof value[key] !== 'string' || value[key].trim().length === 0) {
      errors.push(`${key} must be a non-empty string`);
    }
  }

  if (!isStringArray(value.findings)) {
    errors.push('findings must be a string array');
  }

  if (
    value.nextPromptDraft !== undefined &&
    typeof value.nextPromptDraft !== 'string'
  ) {
    errors.push('nextPromptDraft must be a string');
  }

  requireNumber(value, 'createdAt', errors);

  return {
    ok: errors.length === 0,
    errors,
  };
}

export function assertAgentReviewResult(value: unknown): asserts value is AgentReviewResult {
  const result = validateAgentReviewResult(value);
  if (!result.ok) {
    throw new Error(`Invalid AgentReviewResult: ${result.errors.join(', ')}`);
  }
}

const WORKBUDDY_FORBIDDEN_FIELDS = [
  'autoExecute',
  'autoSend',
  'confirmed',
  'sent',
  'executable',
  'command',
] as const;

function rejectForbiddenWorkBuddyFields(
  value: Record<string, unknown>,
  errors: string[],
): void {
  for (const key of WORKBUDDY_FORBIDDEN_FIELDS) {
    if (key in value) {
      errors.push(`${key} must not be present on WorkBuddy state`);
    }
  }
}

function requireNonEmptyString(record: Record<string, unknown>, key: string, errors: string[]): void {
  if (typeof record[key] !== 'string' || record[key].trim().length === 0) {
    errors.push(`${key} must be a non-empty string`);
  }
}

export function validateWorkBuddyProjectSnapshot(value: unknown): SchemaValidationResult {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return { ok: false, errors: ['WorkBuddy project snapshot must be an object'] };
  }

  rejectForbiddenWorkBuddyFields(value, errors);
  for (const key of ['id', 'projectId', 'name', 'summary']) {
    requireNonEmptyString(value, key, errors);
  }
  if (!isStringArray(value.taskIds)) {
    errors.push('taskIds must be a string array');
  }
  requireNumber(value, 'createdAt', errors);
  return { ok: errors.length === 0, errors };
}

export function assertWorkBuddyProjectSnapshot(value: unknown): asserts value is WorkBuddyProjectSnapshot {
  const result = validateWorkBuddyProjectSnapshot(value);
  if (!result.ok) {
    throw new Error(`Invalid WorkBuddyProjectSnapshot: ${result.errors.join(', ')}`);
  }
}

export function validateWorkBuddyTaskReference(value: unknown): SchemaValidationResult {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return { ok: false, errors: ['WorkBuddy task reference must be an object'] };
  }

  rejectForbiddenWorkBuddyFields(value, errors);
  for (const key of ['id', 'projectId', 'title']) {
    requireNonEmptyString(value, key, errors);
  }
  if (!isOneOf(value.status, ['open', 'in-progress', 'blocked', 'done'] as const)) {
    errors.push('status is invalid');
  }
  requireNumber(value, 'createdAt', errors);
  requireNumber(value, 'updatedAt', errors);
  return { ok: errors.length === 0, errors };
}

export function assertWorkBuddyTaskReference(value: unknown): asserts value is WorkBuddyTaskReference {
  const result = validateWorkBuddyTaskReference(value);
  if (!result.ok) {
    throw new Error(`Invalid WorkBuddyTaskReference: ${result.errors.join(', ')}`);
  }
}

export function validateWorkBuddyReviewResultSink(value: unknown): SchemaValidationResult {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return { ok: false, errors: ['WorkBuddy review result sink must be an object'] };
  }

  rejectForbiddenWorkBuddyFields(value, errors);
  for (const key of ['id', 'projectId', 'reviewResultId', 'summary']) {
    requireNonEmptyString(value, key, errors);
  }
  if (value.taskId !== undefined && typeof value.taskId !== 'string') {
    errors.push('taskId must be a string');
  }
  if (!isStringArray(value.findings)) {
    errors.push('findings must be a string array');
  }
  requireNumber(value, 'createdAt', errors);
  return { ok: errors.length === 0, errors };
}

export function assertWorkBuddyReviewResultSink(value: unknown): asserts value is WorkBuddyReviewResultSink {
  const result = validateWorkBuddyReviewResultSink(value);
  if (!result.ok) {
    throw new Error(`Invalid WorkBuddyReviewResultSink: ${result.errors.join(', ')}`);
  }
}

export function validateWorkBuddyPromptDraftSink(value: unknown): SchemaValidationResult {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return { ok: false, errors: ['WorkBuddy prompt draft sink must be an object'] };
  }

  rejectForbiddenWorkBuddyFields(value, errors);
  for (const key of ['id', 'projectId', 'promptDraft']) {
    requireNonEmptyString(value, key, errors);
  }
  if (value.taskId !== undefined && typeof value.taskId !== 'string') {
    errors.push('taskId must be a string');
  }
  if (value.status !== 'draft') {
    errors.push('status must be draft');
  }
  requireNumber(value, 'createdAt', errors);
  return { ok: errors.length === 0, errors };
}

export function assertWorkBuddyPromptDraftSink(value: unknown): asserts value is WorkBuddyPromptDraftSink {
  const result = validateWorkBuddyPromptDraftSink(value);
  if (!result.ok) {
    throw new Error(`Invalid WorkBuddyPromptDraftSink: ${result.errors.join(', ')}`);
  }
}

export function validateWorkBuddyExecutionLedgerEvent(value: unknown): SchemaValidationResult {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return { ok: false, errors: ['WorkBuddy execution ledger event must be an object'] };
  }

  rejectForbiddenWorkBuddyFields(value, errors);
  for (const key of ['id', 'projectId', 'summary']) {
    requireNonEmptyString(value, key, errors);
  }
  if (value.taskId !== undefined && typeof value.taskId !== 'string') {
    errors.push('taskId must be a string');
  }
  if (!isOneOf(value.kind, [
    'manual-delivery-recorded',
    'manual-review-recorded',
    'external-status-recorded',
  ] as const)) {
    errors.push('kind is invalid');
  }
  requireNumber(value, 'createdAt', errors);
  return { ok: errors.length === 0, errors };
}

export function assertWorkBuddyExecutionLedgerEvent(
  value: unknown,
): asserts value is WorkBuddyExecutionLedgerEvent {
  const result = validateWorkBuddyExecutionLedgerEvent(value);
  if (!result.ok) {
    throw new Error(`Invalid WorkBuddyExecutionLedgerEvent: ${result.errors.join(', ')}`);
  }
}

// --- v2.0 Goal / Plan / PlanStep validators (ADR-0003) ---

export function validateGoal(value: unknown): SchemaValidationResult {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return { ok: false, errors: ['goal must be an object'] };
  }
  requireString(value, 'id', errors);
  requireString(value, 'sessionId', errors);
  requireString(value, 'description', errors);
  if (!isOneOf(value.status, GOAL_STATUSES)) {
    errors.push('status is invalid');
  }
  requireNumber(value, 'createdAt', errors);
  requireNumber(value, 'updatedAt', errors);
  return { ok: errors.length === 0, errors };
}

export function assertGoal(value: unknown): asserts value is Goal {
  const result = validateGoal(value);
  if (!result.ok) {
    throw new Error(`Invalid Goal: ${result.errors.join(', ')}`);
  }
}

export function validatePlanStep(value: unknown): SchemaValidationResult {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return { ok: false, errors: ['plan step must be an object'] };
  }
  requireString(value, 'id', errors);
  requireString(value, 'planId', errors);
  requireNumber(value, 'index', errors);
  requireString(value, 'intent', errors);
  if (!isOneOf(value.kind, PLAN_STEP_KINDS)) {
    errors.push('kind is invalid');
  }
  requireString(value, 'targetEndpointId', errors);
  if (!isOneOf(value.tier, EXECUTION_TIERS)) {
    errors.push('tier is invalid');
  }
  requireBoolean(value, 'isStateMutating', errors);
  if (!isOneOf(value.status, PLAN_STEP_STATUSES)) {
    errors.push('status is invalid');
  }
  return { ok: errors.length === 0, errors };
}

export function assertPlanStep(value: unknown): asserts value is PlanStep {
  const result = validatePlanStep(value);
  if (!result.ok) {
    throw new Error(`Invalid PlanStep: ${result.errors.join(', ')}`);
  }
}

export function validatePlan(value: unknown): SchemaValidationResult {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return { ok: false, errors: ['plan must be an object'] };
  }
  requireString(value, 'id', errors);
  requireString(value, 'goalId', errors);
  if (!isOneOf(value.status, PLAN_STATUSES)) {
    errors.push('status is invalid');
  }
  requireNumber(value, 'createdAt', errors);
  requireNumber(value, 'updatedAt', errors);
  // permittedTiers: non-empty array of valid ExecutionTier values that must
  // always contain 'patch-proposal'.
  if (!Array.isArray(value.permittedTiers) || value.permittedTiers.length === 0) {
    errors.push('permittedTiers must be a non-empty array');
  } else {
    for (const tier of value.permittedTiers) {
      if (!isOneOf(tier, EXECUTION_TIERS)) {
        errors.push(`permittedTiers contains invalid tier: ${String(tier)}`);
      }
    }
    if (!(value.permittedTiers as string[]).includes('patch-proposal')) {
      errors.push('permittedTiers must include patch-proposal');
    }
  }
  if (!Array.isArray(value.steps)) {
    errors.push('steps must be an array');
  } else {
    value.steps.forEach((step, i) => {
      const stepResult = validatePlanStep(step);
      if (!stepResult.ok) {
        errors.push(`steps[${i}]: ${stepResult.errors.join(', ')}`);
      }
    });
  }
  return { ok: errors.length === 0, errors };
}

export function assertPlan(value: unknown): asserts value is Plan {
  const result = validatePlan(value);
  if (!result.ok) {
    throw new Error(`Invalid Plan: ${result.errors.join(', ')}`);
  }
}

export function validateProject(value: unknown): SchemaValidationResult {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return { ok: false, errors: ['project must be an object'] };
  }
  requireString(value, 'key', errors);
  requireString(value, 'label', errors);
  requireNumber(value, 'createdAt', errors);
  return { ok: errors.length === 0, errors };
}

export function assertProject(value: unknown): asserts value is Project {
  const result = validateProject(value);
  if (!result.ok) {
    throw new Error(`Invalid Project: ${result.errors.join(', ')}`);
  }
}
