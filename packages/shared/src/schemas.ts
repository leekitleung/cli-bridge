import {
  AUDIT_EVENT_TYPES,
  AUDIT_RISK_LEVELS,
  AGENT_ENDPOINT_RISKS,
  AGENT_ENDPOINT_TRANSPORTS,
  BRIDGE_PACKET_KINDS,
  BRIDGE_PACKET_SOURCES,
  BRIDGE_PACKET_STATUSES,
  BRIDGE_PACKET_TARGETS,
  RAW_CONTENT_REF_STORAGE,
  type AgentEndpoint,
  type AuditEvent,
  type BridgePacket,
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
