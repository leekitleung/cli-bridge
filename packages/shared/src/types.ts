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
  'create_pending_review',
  'preview_review',
  'confirm_review',
  'send_review',
  'return_review_result',
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

export const AGENT_REVIEW_STATUSES = [
  'draft',
  'previewed',
  'confirmed',
  'sent',
  'returned',
  'cancelled',
  'failed',
] as const;

export type AgentReviewStatus = typeof AGENT_REVIEW_STATUSES[number];

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

export interface AgentReviewRequest {
  id: string;
  sessionId: string;
  sourceEndpointId: string;
  targetEndpointId: string;
  packetId: string;
  status: AgentReviewStatus;
  prompt: string;
  createdAt: number;
  updatedAt: number;
  confirmedAt?: number;
  sentAt?: number;
  returnedAt?: number;
  cancelledAt?: number;
  failedAt?: number;
  failureReason?: string;
}

export interface AgentReviewResult {
  id: string;
  reviewRequestId: string;
  summary: string;
  findings: string[];
  nextPromptDraft?: string;
  createdAt: number;
}

export interface WorkBuddyProjectSnapshot {
  id: string;
  projectId: string;
  name: string;
  summary: string;
  taskIds: string[];
  createdAt: number;
}

export interface WorkBuddyTaskReference {
  id: string;
  projectId: string;
  title: string;
  status: 'open' | 'in-progress' | 'blocked' | 'done';
  createdAt: number;
  updatedAt: number;
}

export interface WorkBuddyReviewResultSink {
  id: string;
  projectId: string;
  taskId?: string;
  reviewResultId: string;
  summary: string;
  findings: string[];
  createdAt: number;
}

export interface WorkBuddyPromptDraftSink {
  id: string;
  projectId: string;
  taskId?: string;
  promptDraft: string;
  status: 'draft';
  createdAt: number;
}

export interface WorkBuddyExecutionLedgerEvent {
  id: string;
  projectId: string;
  taskId?: string;
  kind: 'manual-delivery-recorded' | 'manual-review-recorded' | 'external-status-recorded';
  summary: string;
  createdAt: number;
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

export type BridgeLoopStatus =
  | 'codex-output-ready'
  | 'chatgpt-awaiting-user-send'
  | 'pending-prompt-ready'
  | 'pending-prompt-confirmed'
  | 'codex-delivered'
  | 'cancelled'
  | 'failed';

export interface BridgeLoop {
  id: string;
  sessionId: string;
  status: BridgeLoopStatus;
  codexOutputPacketId: string;
  pendingPromptId?: string;
  chatGptFillRequired: boolean;
  userSendRequired: boolean;
  codexDeliveryRequired: boolean;
  createdAt: number;
  updatedAt: number;
}

export const AGENT_ENDPOINT_TRANSPORTS = [
  'mock',
  'clipboard',
  'command',
  'managed-pty',
  'file-protocol',
  'web-dom',
] as const;

export const AGENT_ENDPOINT_RISKS = [
  'low',
  'medium',
  'high',
  'experimental',
] as const;

export const ENDPOINT_ACTIONS = [
  'accept-prompt',
  'return-output',
  'review',
  'execute',
  'summarize',
] as const;

export type AgentEndpointTransport = typeof AGENT_ENDPOINT_TRANSPORTS[number];

export type AgentEndpointRisk = typeof AGENT_ENDPOINT_RISKS[number];

export type EndpointAction = typeof ENDPOINT_ACTIONS[number];

export type AgentEndpointCapabilities = {
  canAcceptPrompt: boolean;
  canReturnOutput: boolean;
  canReview: boolean;
  canExecute: boolean;
  canSummarize: boolean;
};

export type AgentEndpoint = {
  id: string;
  label: string;
  transport: AgentEndpointTransport;
  risk: AgentEndpointRisk;
  capabilities: AgentEndpointCapabilities;
  adapterName?: string;
  experimental?: boolean;
};
