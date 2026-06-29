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
  'create_outbound_prompt',
  'claim_outbound_prompt',
  'outbound_status_report',
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
  // v2.3 AgentTeam lifecycle
  'team_created',
  'team_approved',
  'team_cancelled',
  // v2.3 AgentTeam slot lifecycle
  'slot_started',
  'slot_done',
  'slot_failed',
  'slot_gated',
  'artifact_recorded',
  // v2.4a Model API
  'model_plan_request',
  'model_plan_result',
  // v2.4a-8 CriticModel advisory review
  'model_critique_request',
  'model_critique_result',
  // v2.5 Workspace apply
  'workspace_apply_request',
  'workspace_apply_result',
  // Phase 3 multi-executor relay (foundation): endpoint/session routing context.
  'relay_context_bound',
  'relay_context_conflict',
  'relay_context_delivered',
  // Phase 3 multi-executor relay (inbound queue core): return-queue lifecycle.
  'inbound_created',
  'inbound_claimed',
  'inbound_consumed',
  'inbound_failed',
  'inbound_cancelled',
  'inbound_rejected',
  // Phase 3 extract→inbound routing decision (extract-return policy).
  'extract_return_routed_inbound',
  'extract_return_fallback_pending',
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

export const OUTBOUND_PROMPT_STATUSES = [
  'queued',
  'claimed',
  'delivered',
  'waiting_manual_send',
  'submitted',
  'responding',
  'response_ready',
  'returned',
  'completed',
  'expired',
  'failed',
  'cancelled',
] as const;

export type OutboundPromptStatus = typeof OUTBOUND_PROMPT_STATUSES[number];

export const WEB_RELAY_LOOP_STATUSES = [
  'queued',
  'running',
  'paused',
  'cancelling',
  'cancelled',
  'done',
  'failed',
] as const;

export type WebRelayLoopStatus = typeof WEB_RELAY_LOOP_STATUSES[number];

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
  /** Optional project scope. Set from the record that triggered this event. */
  projectId?: string;
  /** v2.3 AgentTeam metadata. */
  teamId?: string;
  slotId?: string;
  planStepId?: string;
  goalId?: string;
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
    /**
     * Structured, typed correlation/diagnostic metadata for the event
     * (e.g., model provider/usage, AgentTeam provider/session correlation).
     * Replaces the prior practice of JSON-stringifying metadata into
     * `failureReason`. Never contains secrets, raw prompts, raw provider
     * output, or raw file content.
     */
    metadata?: Record<string, unknown>;
  };
  timestamp: number;
}

export interface PendingPrompt {
  id: string;
  sessionId: string;
  packetId: string;
  prompt: string;
  /** Optional project scope (Phase B). */
  projectId?: string;
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

export interface OutboundPrompt {
  id: string;
  sessionId: string;
  packetId: string;
  prompt: string;
  status: OutboundPromptStatus;
  target: 'chatgpt-web';
  /** Stage C bounded loop correlation. Server-owned; never supplied by extension. */
  loopId?: string;
  /**
   * Phase 3 multi-executor relay (foundation): optional originating executor
   * endpoint. Absent for the legacy single-executor / manual flow. When present
   * it must reference a registered endpoint and binds the session for routing.
   */
  endpointId?: string;
  createdAt: number;
  updatedAt: number;
  claimedAt?: number;
  /** Opaque fencing token for the currently active claim lease. */
  claimToken?: string;
  authorization: {
    target: 'chatgpt-web';
    contentHash: string;
    expiresAt: number;
  };
  deliveredAt?: number;
  waitingAt?: number;
  submittedAt?: number;
  respondingAt?: number;
  responseReadyAt?: number;
  returnedAt?: number;
  completedAt?: number;
  expiredAt?: number;
  failedAt?: number;
  cancelledAt?: number;
  failureReason?: string;
  evidence?: {
    type: string;
    at: number;
    reason?: string;
  }[];
}

export interface WebRelayLoop {
  id: string;
  projectId: string;
  goalId: string;
  sessionId: string;
  endpointId: string;
  status: WebRelayLoopStatus;
  round: number;
  maxRounds: number;
  perRoundTimeoutMs: number;
  totalDeadlineAt: number;
  noProgressLimit: number;
  noProgressCount: number;
  seenContentHashes: string[];
  lastProgressHash?: string;
  currentOutboundPromptId?: string;
  createdAt: number;
  updatedAt: number;
  pausedAt?: number;
  cancelledAt?: number;
  doneAt?: number;
  failedAt?: number;
  failureReason?: string;
  evidence: {
    type: string;
    at: number;
    reason?: string;
    outboundPromptId?: string;
    round?: number;
  }[];
}

/**
 * Phase 3 multi-executor relay (foundation): the server-resolved routing context
 * for a session, established only when an outbound prompt carrying an
 * `endpointId` is delivered. Used by a later phase to route an extracted reply
 * back to the originating executor. Memory-only in this foundation phase.
 */
export interface RelayContext {
  sessionId: string;
  endpointId: string;
  lastOutboundPromptId: string;
  updatedAt: number;
}

// Phase 3 multi-executor relay (inbound queue core): a reviewed reply routed
// back to the originating executor, pulled by that executor. Distinct from
// OutboundPrompt (executor→ChatGPT) and PendingPrompt (draft→confirm→send).
export const INBOUND_STATUSES = [
  'queued',
  'claimed',
  'consumed',
  'failed',
  'cancelled',
] as const;

export type InboundStatus = typeof INBOUND_STATUSES[number];

export const INBOUND_SOURCES = ['chatgpt-web-extract'] as const;

export type InboundSource = typeof INBOUND_SOURCES[number];

export interface InboundMessage {
  id: string;
  endpointId: string;
  sessionId: string;
  packetId: string;
  /** Redacted (processed) content only; raw content is never stored here. */
  content: string;
  source: InboundSource;
  /** Provenance: which outbound prompt this reply answers, when known. */
  sourceOutboundPromptId?: string;
  status: InboundStatus;
  createdAt: number;
  updatedAt: number;
  claimedAt?: number;
  consumedAt?: number;
  failedAt?: number;
  cancelledAt?: number;
  failureReason?: string;
}

export interface AgentReviewRequest {
  id: string;
  sessionId: string;
  sourceEndpointId: string;
  targetEndpointId: string;
  packetId: string;
  /** Optional project scope (Phase B). */
  projectId?: string;
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
  'terminal',
  'workbuddy',
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
  // Phase 3 multi-executor relay (foundation): may pull inbound reviewed results.
  'receive-inbound',
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
  /**
   * Phase 3 multi-executor relay (foundation): the endpoint may receive inbound
   * (pulled) reviewed results routed back to it. Optional; absent ⇒ false, so
   * existing endpoints stay backward compatible.
   */
  canReceiveInbound?: boolean;
  /**
   * Reserved (ADR-gated, NOT implemented): managed-session writeback. Optional;
   * absent ⇒ false.
   */
  canUseManagedWriteback?: boolean;
};

export type AgentEndpoint = {
  id: string;
  label: string;
  transport: AgentEndpointTransport;
  risk: AgentEndpointRisk;
  capabilities: AgentEndpointCapabilities;
  adapterName?: string;
  experimental?: boolean;
  /** Project reference — scopes the endpoint to a specific project. */
  projectRef?: string;
  /** Runtime status — set by heartbeat/offline, not persisted long-term. */
  status?: 'online' | 'offline' | 'busy';
  /** Unix ms timestamp of last heartbeat or registration. */
  lastSeenAt?: number;
};

/**
 * Endpoint session registration — the runtime view of an endpoint instance.
 * Distinct from AgentEndpoint (which is the static capability declaration).
 * Session fields (status, lastSeenAt) are NOT persisted long-term; they are
 * derived from the heartbeat loop at runtime.
 */
export type EndpointSession = {
  endpointId: string;
  label: string;
  transport: AgentEndpointTransport;
  capabilities: AgentEndpointCapabilities;
  projectRef?: string;
  status: 'online' | 'offline' | 'busy';
  lastSeenAt: number;
};

// --- v2.0 Goal-driven controlled execution (ADR-0003) ---
// Data model only. No execution authority lives in these types; the gate and
// step ceiling are enforced by the orchestrator/store in later slices.

export const GOAL_STATUSES = [
  'draft',
  'planned',
  'approved',
  'executing',
  'paused',
  'done',
  'cancelled',
  'failed',
] as const;

export type GoalStatus = typeof GOAL_STATUSES[number];

export const PLAN_STATUSES = [
  'draft',
  'awaiting-approval',
  'approved',
  'executing',
  'paused',
  'done',
  'cancelled',
] as const;

export type PlanStatus = typeof PLAN_STATUSES[number];

export const PLAN_STEP_STATUSES = [
  'pending',
  'running',
  'done',
  'failed',
  'blocked-needs-gate',
  'gated-approved',
] as const;

export type PlanStepStatus = typeof PLAN_STEP_STATUSES[number];

// What a step does. Non-mutating kinds may auto-run within an approved plan;
// mutating kinds always require the per-step gate (ADR-0003 §4).
export const PLAN_STEP_KINDS = [
  'review',
  'summarize',
  'propose-patch',
  'apply-patch',
  'run-command',
  'write-file',
  'delete-file',
  'git-commit',
  'git-push',
] as const;

export type PlanStepKind = typeof PLAN_STEP_KINDS[number];

// Execution permission tier (ADR-0003 §2). Default is patch-proposal.
export const EXECUTION_TIERS = [
  'patch-proposal',
  'workspace-write',
] as const;

export type ExecutionTier = typeof EXECUTION_TIERS[number];

export const AUTOMATION_REASONING_TIERS = ['high'] as const;
export type AutomationReasoningTier = typeof AUTOMATION_REASONING_TIERS[number];

export const AUTOMATION_EXECUTION_TIERS = ['medium', 'low'] as const;
export type AutomationExecutionTier = typeof AUTOMATION_EXECUTION_TIERS[number];

export interface RunEndpointBindingEndpointRef {
  id: string;
  label: string;
  transport: AgentEndpointTransport;
  capabilities: {
    canExecute: boolean;
  };
}

export interface Goal {
  id: string;
  sessionId: string;
  /** Optional project scope (Phase B). Records without projectId
   *  are backfilled to the default project at query time. */
  projectId?: string;
  description: string;
  status: GoalStatus;
  createdAt: number;
  updatedAt: number;
}

export interface PlanStep {
  id: string;
  planId: string;
  index: number;
  intent: string;
  kind: PlanStepKind;
  targetEndpointId: string;
  tier: ExecutionTier;
  // True for any state-changing step; such steps must pass the per-step gate
  // and are never covered by plan-level approval (ADR-0003 §4).
  isStateMutating: boolean;
  status: PlanStepStatus;
  output?: string;
  failureReason?: string;
}

export interface Plan {
  id: string;
  goalId: string;
  /** Derived-plan lineage for immutable automation binding changes. */
  parentPlanId?: string;
  steps: PlanStep[];
  status: PlanStatus;
  // Explicit set of execution tiers permitted within this plan. Default is
  // ['patch-proposal']. workspace-write must be listed here before any step
  // carrying that tier can be dispatched (enforced by the orchestrator, and
  // verifiable from the data model). patch-proposal is always required.
  permittedTiers: ExecutionTier[];
  createdAt: number;
  updatedAt: number;
  approvedAt?: number;
  pausedAt?: number;
  pauseReason?: string;
}

export interface RunEndpointBinding {
  goalId: string;
  planId: string;
  parentPlanId?: string;
  reasoningEndpointId: string;
  executionEndpointId: string;
  reasoningEndpoint: RunEndpointBindingEndpointRef;
  executionEndpoint: RunEndpointBindingEndpointRef;
  reasoningTier: AutomationReasoningTier;
  executionTier: AutomationExecutionTier;
  executionPermissionProfile: string;
  executionWorkingDirectoryRef: string;
  maxSteps: number;
  maxReasoningRounds: number;
  deadlineAt: string;
  createdAt: number;
  updatedAt: number;
  bindingHash: string;
  lockedAt?: number;
}

/**
 * Project-level default team preset. Saved per-project; affects NEW goals
 * only — existing goals retain their own binding snapshots (immutable by
 * preset changes). Changing the preset does NOT retroactively affect goals.
 */
export interface ProjectTeamPreset {
  projectId: string;
  plannerEndpointId: string;
  executorEndpointId: string;
  verifierEndpointId?: string;
  mode: 'sequential';
  isolation: 'patch-only';
  updatedAt: number;
}

export const REASONING_ARTIFACT_KINDS = [
  'plan-draft',
  'review-result',
  'execution-proposal',
] as const;

export type ReasoningArtifactKind = typeof REASONING_ARTIFACT_KINDS[number];

export interface ReasoningArtifact {
  artifactId: string;
  goalId: string;
  planId: string;
  endpointId: string;
  bindingHash: string;
  kind: ReasoningArtifactKind;
  contentHash: string;
  summary: string;
  createdAt: string;
}

export const EXECUTION_PROPOSAL_STATUSES = [
  'draft',
  'awaiting-confirmation',
  'confirmed',
  'dispatching',
  'returned',
  'failed',
  'paused',
  'cancelled',
  'timed-out',
] as const;

export type ExecutionProposalStatus = typeof EXECUTION_PROPOSAL_STATUSES[number];

export interface ExecutionProposal {
  id: string;
  goalId: string;
  planId: string;
  stepId: string;
  artifactId: string;
  contentHash: string;
  bindingHash: string;
  executionEndpointId: string;
  executionPermissionProfile: string;
  projectId: string;
  preview: string;
  command: 'codex' | 'claude';
  args: string[];
  stdin: string;
  status: ExecutionProposalStatus;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
  confirmationNonce?: string;
  confirmedAt?: number;
  dispatchingAt?: number;
  returnedAt?: number;
  failedAt?: number;
  pausedAt?: number;
  cancelledAt?: number;
  timedOutAt?: number;
  failureReason?: string;
  result?: {
    stdout: string;
    stderr: string;
    exitCode: number | null;
  };
  supersedesProposalId?: string;
  supersededByProposalId?: string;
}


// --- v2.1 Read-Only Project Observability DTOs ---

/** A single entry in a project conversation timeline. */
export interface ConversationTimelineEntry {
  id: string; projectId: string; source: string; kind: string;
  label: string; timestamp: number; links: Record<string, string>;
  statusLabel?: string;
}

export interface ConversationTimelineView {
  projectId: string; entries: ConversationTimelineEntry[];
}

export interface DerivedMemoryEntry {
  sourceKind: string; sourceId: string; timestamp: number; fact: string;
}

export interface DerivedMemoryView {
  projectId: string; entries: DerivedMemoryEntry[];
}

export interface ProjectAuditEntry {
  id: string; type: string; source: string; target: string;
  timestamp: number; ok: boolean | null;
}

export interface ProjectAuditView {
  projectId: string; total: number; returning: number;
  entries: ProjectAuditEntry[];
}

export interface HarnessVerificationRecord {
  stepId?: string; stepIndex?: number; stepIntent?: string;
  stepStatus?: string; harnessStatus: string;
  notes?: string; teamId?: string; slotId?: string; createdAt?: number;
  result?: VerificationResult;
  verificationEvidence?: VerificationEvidence;
}

export const VERIFICATION_RESULTS = [
  'passed',
  'failed',
  'skipped',
  'errored',
  'unknown',
] as const;

export type VerificationResult = typeof VERIFICATION_RESULTS[number];

export interface VerificationEvidence {
  result: VerificationResult;
  /** Sanitized label only, never a raw command line or output. */
  commandLabel?: string;
  recordedAt?: number;
  // v2.13 ADR-0018: live verification metadata (no raw output).
  elapsedMs?: number;
  truncated?: boolean;
  outputDiscarded?: boolean;
}

// v2.13 ADR-0018: operator-configured verification profile (runtime-only, not persisted in project/snapshot).

export type NetworkRisk = 'unknown' | 'declared-offline' | 'may-network';
export type MutationRisk = 'read-only' | 'may-mutate';

export interface VerifyProfile {
  id: string;
  label: string;
  argv: string[];
  cwdPolicy?: { kind: 'project-root'; subPath?: string };
  env: string[];
  timeoutMs: number;
  outputCapBytes: number;
  networkRisk: NetworkRisk;
  mutationRisk: MutationRisk;
}

/** Sanitized profile metadata exposed to API/console — no argv/cwd/env/timeout/output cap internals. */
export interface VerifyProfileMeta {
  id: string;
  label: string;
  networkRisk: NetworkRisk;
  mutationRisk: MutationRisk;
  available: boolean; // project has a workspace root
  selected: boolean;  // project.verifyProfileId matches
}

// v2.14 ADR-0019-a: sanitized local git status view.
// Read-only, offline, no network, no credentials, no git writes.
// Never contains: absolute cwd/root, remote URL, commit hash/SHA, raw output, diff, token.

export interface GitStatusView {
  branch: string | null;
  dirty: boolean;
  aheadCount: number | null;
  behindCount: number | null;
  isGitRepo: boolean;
  fetchedAt: number;
  available: boolean;
}

// v2.14 ADR-0019-b: GitHub checks provider config (operator-configured, never HTTP).
// apiBaseUrl must be HTTPS; owner/repo must match ^[A-Za-z0-9._-]+$.

export interface GithubChecksProviderConfig {
  kind: 'github';
  apiBaseUrl: string;
  owner: string;
  repo: string;
}

// v2.14 ADR-0019-b: sanitized GitHub checks result view.
// No raw API payload, no token, no URL, no branch/owner/repo/ref, no commit SHA.

export interface GithubChecksView {
  result: VerificationResult;
  conclusionSummary: string | null;
  checkRunCount: number;
  fetchedAt: number;
  available: boolean;
  elapsedMs: number;
  commandLabel: string;
}

export interface GithubChecksConfirmResult {
  profileId: string;
  commandLabel: string;
  result: VerificationResult;
  recordedAt: number;
  elapsedMs: number;
  truncated: boolean;
  outputDiscarded: boolean;
  hostDisclosure: string;
}

/** Sanitized live verification run record preserved between runs. No raw output/argv/cwd/env/root. */
export interface VerificationRunRecord {
  projectKey: string;
  profileId: string;
  commandLabel: string;
  result: VerificationResult;
  recordedAt: number;
  elapsedMs: number;
  truncated: boolean;
  outputDiscarded: boolean;
}

export interface VerificationStatusSummary {
  evidenceCount: number;
  lastRecordedAt?: number;
  doneStepCount: number;
  totalStepCount: number;
  resultCounts?: Record<VerificationResult, number>;
}

export interface HarnessVerificationView {
  projectId: string; records: HarnessVerificationRecord[];
  status: string;
  summary?: VerificationStatusSummary;
}

// --- Phase B: Project workspace model ---

export interface Project {
  /** Unique project key. The default project is 'cli-bridge'. */
  key: string;
  /** Human-readable label. */
  label: string;
  /** Optional longer description. */
  description?: string;
  /** Created timestamp. */
  createdAt: number;
  /** Optional archive timestamp. When set, the project is excluded from
   *  default listing and blocks new record creation. */
  archivedAt?: number;
  /** v2.5: opt-in workspace apply. Default false. */
  workspaceApplyEnabled?: boolean;
  /** v2.13: operator-configured verification profile id. Default off. */
  verifyProfileId?: string;
  /** v2.14 ADR-0019-a: opt-in local read-only git status. Default off. */
  gitStatusEnabled?: boolean;
  /** v2.14 ADR-0019-b: opt-in remote GitHub checks. Default off. */
  githubChecksEnabled?: boolean;
}

/** Derived aggregate view returned by GET /bridge/projects / /bridge/projects/:key. */

// --- v2.3 AgentTeam: TeamSpec & SlotArtifact DTOs ---

export const TEAMSPEC_MODES = ['sequential'] as const;
export type TeamSpecMode = typeof TEAMSPEC_MODES[number];

export const TEAMSPEC_ISOLATION_MODES = ['patch-only'] as const;
export type TeamSpecIsolationMode = typeof TEAMSPEC_ISOLATION_MODES[number];

export const TEAM_STATUSES = [
  'pending-approval', 'approved', 'executing', 'done', 'failed', 'cancelled',
] as const;
export type TeamStatus = typeof TEAM_STATUSES[number];

export const SLOT_STATUSES = [
  'pending', 'ready', 'executing', 'blocked-needs-gate', 'done', 'failed', 'cancelled',
] as const;
export type SlotStatus = typeof SLOT_STATUSES[number];

export const SLOT_ROLES = ['planner', 'executor', 'verifier'] as const;
export type SlotRole = typeof SLOT_ROLES[number];

export interface AgentSlot {
  id: string;
  role: SlotRole;
  stepIndex: number;
  tier: string;
  isolation: TeamSpecIsolationMode;
  /** v2.4b: optional per-slot provider binding; defaults to team.provider. */
  providerId?: string;
  /** v2.4b: optional per-slot endpoint binding; defaults to team.endpointId. */
  endpointId?: string;
  status: SlotStatus;
}

export interface PolicyRequirement {
  kind: string;
  detail: string;
}

export interface TeamSpec {
  id: string;
  projectId: string;
  goalId: string;
  planId: string;
  logicalSlots: AgentSlot[];
  maxConcurrentBridgeSlots: number;
  mode: TeamSpecMode;
  isolation: TeamSpecIsolationMode;
  provider: string;
  endpointId: string;
  policyRequirements: PolicyRequirement[];
  status: TeamStatus;
  currentSlotIndex: number;
  createdAt: number;
  updatedAt: number;
  approvedAt?: number;
}

export interface SlotArtifact {
  teamId: string;
  slotId: string;
  planStepId: string;
  /** v2.4b provider/session correlation. */
  providerId?: string;
  endpointId?: string;
  bridgeRunId?: string;
  externalSessionId?: string;
  summary: string;
  proposedFiles: string[];
  verificationNotes?: string;
  verificationEvidence?: VerificationEvidence;
  rawProviderOutput?: string;
  outputRedacted: boolean;
  createdAt: number;
}

export interface ConflictReport {
  clean: boolean;
  conflicts: Array<{ path: string; slotA: string; slotB: string; providerA?: string; providerB?: string }>;
}

// --- Phase B: Project workspace model ---

export interface ProjectSummary {
  project: Project;
  /** Number of goals scoped to this project. */
  goalCount: number;
  /** Active goal count (not done/cancelled/failed). */
  activeGoalCount: number;
  /** Number of reviews scoped to this project. */
  reviewCount: number;
  /** Number of pending prompts scoped to this project. */
  promptCount: number;
  /** Derived project status hint. */
  status: 'active' | 'idle' | 'unknown';
}

export const DEFAULT_PROJECT_KEY = 'cli-bridge';
