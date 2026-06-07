export type JsonPrimitive = string | number | boolean | null;

export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

export interface JsonObject {
  [key: string]: JsonValue;
}

export const BRIDGE_PACKET_SOURCES = [
  'codex',
  'chatgpt-web',
  'user-selection',
  'clipboard',
] as const;

export const BRIDGE_PACKET_TARGETS = [
  'codex',
  'chatgpt-web',
  'clipboard',
] as const;

export const BRIDGE_PACKET_KINDS = [
  'cli-output-review',
  'pending-prompt',
  'manual-transfer',
  'failure-report',
] as const;

export const RAW_CONTENT_REF_STORAGE = [
  'memory-only',
  'debug-ttl',
] as const;

export const BRIDGE_PACKET_STATUSES = [
  'draft',
  'previewed',
  'confirmed',
  'sent',
  'failed',
  'cancelled',
] as const;

export const AUDIT_EVENT_TYPES = [
  'read_cli_output',
  'process_content',
  'redact_sensitive',
  'fill_chatgpt',
  'extract_chatgpt',
  'create_pending_prompt',
  'confirm_prompt',
  'send_to_agent',
  'copy_to_clipboard',
  'operation_failed',
  'operation_cancelled',
] as const;

export const AUDIT_RISK_LEVELS = [
  'low',
  'medium',
  'high',
] as const;

export const PENDING_PROMPT_STATUSES = [
  'draft',
  'previewed',
  'confirmed',
  'sent',
  'failed',
  'cancelled',
] as const;

export type BridgePacketSource = typeof BRIDGE_PACKET_SOURCES[number];

export type BridgePacketTarget = typeof BRIDGE_PACKET_TARGETS[number];

export type BridgePacketKind = typeof BRIDGE_PACKET_KINDS[number];

export type RawContentRefStorage = typeof RAW_CONTENT_REF_STORAGE[number];

export type BridgePacketStatus = typeof BRIDGE_PACKET_STATUSES[number];

export type AuditEventType = typeof AUDIT_EVENT_TYPES[number];

export type AuditRiskLevel = typeof AUDIT_RISK_LEVELS[number];

export type PendingPromptStatus = typeof PENDING_PROMPT_STATUSES[number];

export interface BridgePacket {
  id: string;
  sessionId: string;
  source: BridgePacketSource;
  target: BridgePacketTarget;
  kind: BridgePacketKind;
  processedContent: string;
  rawContentRef?: {
    storage: RawContentRefStorage;
    expiresAt?: number;
  };
  safety: {
    redactionApplied: boolean;
    redactionSummary: string[];
    blocked: boolean;
    blockReasons: string[];
    contentHash: string;
  };
  context: {
    cwd?: string;
    branch?: string;
    dirty?: boolean;
    agent?: 'codex';
    transport?: 'managed-pty' | 'clipboard';
  };
  metrics: {
    rawLength?: number;
    processedLength: number;
    rawTokenEstimate?: number;
    processedTokenEstimate?: number;
    compressionRatio?: number;
  };
  status: BridgePacketStatus;
  createdAt: number;
  updatedAt: number;
}

export interface AuditEvent {
  id: string;
  sessionId: string;
  packetId?: string;
  approvalId?: string;
  type: AuditEventType;
  source: string;
  target: string;
  snapshot: {
    cwd?: string;
    branch?: string;
    dirty?: boolean;
    agent?: string;
    transport?: string;
  };
  safety: {
    contentHash?: string;
    redactionSummary?: string[];
    riskLevel?: AuditRiskLevel;
  };
  result: {
    ok: boolean;
    failureReason?: string;
  };
  timestamp: number;
}

export interface PendingPrompt {
  id: string;
  sessionId: string;
  packetId: string;
  prompt: string;
  status: PendingPromptStatus;
  transport: 'managed-pty' | 'clipboard';
  clipboardHandoff?: {
    status: 'ready-to-copy';
    fallbackReason: string;
    checklist: string[];
    createdAt: number;
  };
  createdAt: number;
  updatedAt: number;
  confirmedAt?: number;
  sentAt?: number;
  cancelledAt?: number;
  failedAt?: number;
  failureReason?: string;
}

export interface AgentDeliveryResult {
  ok: boolean;
  transport: 'mock' | 'managed-pty' | 'clipboard';
  deliveredPrompt?: string;
  failureReason?: string;
}

export interface BridgeMetricsSummary {
  packetCreatedCount: number;
  packetSentCount: number;
  packetCancelledCount: number;
  packetFailedCount: number;
  fallbackToClipboardCount: number;
  redactionHitCount: number;
  confirmRate: number;
  cancelRate: number;
}

export type BridgeTemplateId = 'review-cli-output' | 'generate-codex-prompt';

export interface TemplatePreviewInput {
  content: string;
  context?: {
    cwd?: string;
    branch?: string;
  };
}

export interface TemplatePreview {
  templateId: BridgeTemplateId;
  preview: string;
  autoSend: false;
}
