import type {
  IncomingMessage,
  ServerResponse,
} from 'node:http';

import { MockAgentAdapter } from '../adapters/MockAgentAdapter.ts';
import {
  CLAUDE_REVIEW_ARGS,
  createClaudeReviewCommandAdapter,
  createCodexReviewCommandAdapter,
  type CommandReviewAdapter,
} from '../adapters/command-review-adapter.ts';
import { InMemoryEndpointRegistry } from '../endpoints/endpoint-registry.ts';
import {
  CLAUDE_CODE_REVIEW_COMMAND_ENDPOINT,
  CODEX_REVIEW_COMMAND_ENDPOINT,
  DEFAULT_AGENT_ENDPOINTS,
  MOCK_INBOUND_AGENT_ENDPOINT,
  WORKBUDDY_ENDPOINT,
} from '../endpoints/mock-endpoints.ts';
import { runCommandReview } from '../review/command-review-runner.ts';
import { buildClaudeReviewPrompt } from '../review/claude-review-prompt.ts';
import {
  normalizeChatGptReturnArtifact,
  normalizeReasoningArtifact,
} from '../reasoning/reasoning-artifact.ts';
import { InMemoryReasoningArtifactStore } from '../reasoning/reasoning-artifact-store.ts';
import {
  dispatchExecutionProposal,
  validateExecutionInvocation,
} from '../execution/execution-dispatcher.ts';
import { InMemoryGoalStore } from '../storage/goal-store.ts';
import { InMemoryWorkBuddyStateStore } from '../workbuddy/workbuddy-state-store.ts';
import { InMemoryTeamSpecStore } from '../storage/team-store.ts';
import { InMemoryProjectTeamPresetStore, validateProjectTeamPreset } from '../storage/project-team-preset-store.ts';
import { InMemoryGoalBindingSnapshotStore } from '../storage/goal-binding-snapshot-store.ts';
import { WorkBuddyExecutionAdapter } from '../adapters/workbuddy-execution-adapter.ts';
import { InMemoryApiKeyStore } from '../model/api-key.ts';
import { GithubTokenStore } from '../verification/github-token-store.ts';
import { WorkspaceApplyStore } from '../storage/workspace-apply-store.ts';
import { toApplyManifest } from '../storage/workspace-apply-store.ts';
import { normalizeProjectWorkspaceRoots } from '../storage/workspace-apply-store.ts';
import type { ApplyRequest } from '../storage/workspace-apply-store.ts';
import { VerificationRunStore } from '../storage/verification-run-store.ts';
import type { VerifyProfile } from '../../../../packages/shared/src/types.ts';
import { runVerificationProfile } from '../verification/profile-runner.ts';
import { readGitStatus } from '../verification/git-status-reader.ts';
import { fetchGithubChecks } from '../verification/github-checks-provider.ts';
import type { GitStatusView, GithubChecksConfirmResult } from '../../../../packages/shared/src/types.ts';
import type { VerifyProfileMeta } from '../../../../packages/shared/src/types.ts';
import { redactSensitiveContent } from '../security/redaction.ts';
import type { ModelProvider } from '../model/provider-interface.ts';
import { validateTeamSpecCreate, validateSlotArtifact, detectFileConflicts, validateEndpointRegistration } from '../../../../packages/shared/src/schemas.ts';
import { KNOWN_PROVIDER_CAPABILITIES, validateProviderCapability } from '../storage/provider-capability.ts';
import { generatePlan } from '../goal/goal-plan-generator.ts';
import type { GeneratePlanInput } from '../goal/goal-plan-generator.ts';
import type { CommandRunOptions } from '../adapters/command-runner.ts';
import {
  buildConversationTimeline,
  buildProjectAuditView,
  buildDerivedMemory,
  buildHarnessVerification,
  type ObservabilityInput,
} from '../project-observability/builders.ts';
import {
  buildSnapshot,
  JsonSnapshotStore,
} from '../storage/json-snapshot-store.ts';
import { createMetricsSummary } from '../storage/metrics-summary.ts';
import { InMemoryOutboundPromptStore } from '../storage/outbound-prompt-store.ts';
import { InMemoryAutomationBindingStore } from '../storage/automation-binding-store.ts';
import { InMemoryExecutionProposalStore } from '../storage/execution-proposal-store.ts';
import { InMemoryWebRelayLoopStore } from '../storage/web-relay-loop-store.ts';
import { InMemoryRelayContextStore } from '../storage/relay-context-store.ts';
import { InMemoryInboundMessageStore } from '../storage/inbound-message-store.ts';
import { InMemoryPacketStore } from '../storage/packet-store.ts';
import { InMemoryPendingPromptStore } from '../storage/pending-prompt-store.ts';
import { InMemoryPendingReviewStore } from '../storage/pending-review-store.ts';
import {
  InMemoryProjectStore,
  resolveProjectKey,
  parseProjectIdField,
  validateProjectKey,
} from '../storage/project-store.ts';
import { InMemoryAuditLog } from '../storage/audit-log.ts';
import type {
  AgentEndpoint,
  AgentReviewRequest,
  AuditEvent,
  DerivedMemoryEntry,
  Goal,
  PendingPrompt,
  Plan,
  ProjectSummary,
  AutomationExecutionTier,
  AutomationReasoningTier,
  ReasoningArtifactKind,
} from '../../../../packages/shared/src/types.ts';
import { DEFAULT_PROJECT_KEY } from '../../../../packages/shared/src/types.ts';

const MAX_BODY_BYTES = 1_000_000;

// Maps a review target endpoint id to its command adapter factory. Only
// review-only command endpoints are runnable; anything else is rejected by
// capability gating before reaching here.
const REVIEW_COMMAND_ADAPTERS: Record<string, () => CommandReviewAdapter> = {
  'claude-code-command': createClaudeReviewCommandAdapter,
  'codex-command': createCodexReviewCommandAdapter,
};

// Default command config for goal→plan generation. Uses the SAME safety argv
// as the existing Claude review-only adapter: all tools disabled, plan permission
// mode, no session persistence. The prompt is passed via stdin, never
// interpolated into argv.
const DEFAULT_GOAL_PLAN_COMMAND_CONFIG: GeneratePlanInput['commandConfig'] = {
  adapterName: 'goal-plan-generator',
  command: 'claude',
  argv: [...CLAUDE_REVIEW_ARGS],
};

export interface BridgeRuntime {
  packetStore: InMemoryPacketStore;
  auditLog: InMemoryAuditLog;
  pendingPromptStore: InMemoryPendingPromptStore;
  outboundPromptStore: InMemoryOutboundPromptStore;
  automationBindingStore: InMemoryAutomationBindingStore;
  reasoningArtifactStore: InMemoryReasoningArtifactStore;
  executionProposalStore: InMemoryExecutionProposalStore;
  webRelayLoopStore: InMemoryWebRelayLoopStore;
  /** Phase 3 multi-executor relay (foundation): endpoint/session routing context. */
  relayContextStore: InMemoryRelayContextStore;
  /** Phase 3 multi-executor relay (inbound queue core): server-side return queue. */
  inboundMessageStore: InMemoryInboundMessageStore;
  endpointRegistry: InMemoryEndpointRegistry;
  /** Operator-configured inbound route; never accepted from an HTTP body. */
  readonly inboundRelayEndpointId?: string;
  pendingReviewStore: InMemoryPendingReviewStore;
  // Resolves a review target endpoint id to its command adapter. Tests inject a
  // fake here so they never spawn a real CLI; production uses the default map.
  reviewAdapterFor: (targetEndpointId: string) => CommandReviewAdapter | undefined;
  agent: MockAgentAdapter;
  persist: () => void;
  getPersistenceFailure: () => string | undefined;
  // v2.0 Goal-driven execution (ADR-0003). Goal/plan/project data is
  // persisted in the JSON snapshot (v2).
  goalStore: InMemoryGoalStore;
  // Phase B project grouping plus limited metadata/archive state.
  projectStore: InMemoryProjectStore;
  /** Command runner override for goal→plan generation (test injection). */
  goalPlanCommandOptions?: CommandRunOptions;
  /** Command runner override for confirmed execution proposals (test injection). */
  commandRunOptions?: CommandRunOptions;
  // v2.2 WorkBuddy non-executing task system.
  workbuddyStore: InMemoryWorkBuddyStateStore;
  teamStore: InMemoryTeamSpecStore;
  presetStore: InMemoryProjectTeamPresetStore;
  bindingSnapshotStore: InMemoryGoalBindingSnapshotStore;
  workbuddyExecution: WorkBuddyExecutionAdapter;
  // v2.4a Model API
  modelApiKeyStore: InMemoryApiKeyStore;
  modelProviderFor?: (apiKey: string) => ModelProvider;
  // v2.5 Workspace apply
  applyStore: WorkspaceApplyStore;
  // v2.13: live verification run store
  verificationRunStore: VerificationRunStore;
  // v2.13: operator-configured verification profiles
  readonly verifyProfiles?: readonly VerifyProfile[];
  readonly verificationSpawnFn?: import('../verification/profile-runner.js').SpawnFn;
  // v2.14 ADR-0019-a: injectable git spawn for tests.
  readonly gitSpawnFn?: import('../verification/git-status-reader.js').GitSpawnFn;
  // v2.14 ADR-0019-b: github checks provider config (operator-only).
  readonly githubChecksConfig?: Record<string, import('../../../../packages/shared/src/types.ts').GithubChecksProviderConfig>;
  // v2.14 ADR-0019-b: memory-only github token store.
  readonly githubTokenStore?: GithubTokenStore;
  // v2.14 ADR-0019-b: injectable fetch for tests.
  readonly githubChecksFetchFn?: typeof fetch;
  readonly projectWorkspaceRoots?: Record<string, string>;
  readonly additionalEndpoints?: readonly AgentEndpoint[];
}

export interface BridgeRuntimeOptions {
  // When set, the runtime hydrates from and persists to a JSON snapshot in this
  // directory. When omitted, the runtime stays fully in-memory.
  dataDir?: string;
  /** Trusted server-side route for extension outbound/return sessions. */
  inboundRelayEndpointId?: string;
  // Override the review command adapter resolution (used by tests to avoid
  // spawning real CLIs). When omitted, the default real adapters are used.
  reviewAdapterFor?: (targetEndpointId: string) => CommandReviewAdapter | undefined;
  // Override the command runner used by goal→plan generation (used by tests to
  // avoid spawning a real CLI). When omitted, the default runner is used.
  goalPlanCommandOptions?: CommandRunOptions;
  // Override the command runner used by confirmed execution proposals.
  commandRunOptions?: CommandRunOptions;
  // v2.4a: model provider factory for test injection. Default: OpenAiAdapter.
  modelProviderFactory?: (apiKey: string) => ModelProvider;
  // v2.5: workspace apply root directory (default: temp dir for tests).
  applyRoot?: string;
  // v2.5 ADR-0010: trusted root for pre-apply baseline manifest capture. Absent/OFF = disabled.
  baselineRoot?: string;
  // v2.9 ADR-0014: server/operator project -> trusted root registry. Never set by HTTP.
  projectWorkspaceRoots?: Record<string, string>;
  baselineCaptureEnabled?: boolean;
  baselineCaps?: { maxFiles: number; maxTotalBytes: number };
  // v2.13 ADR-0018: operator-configured verification profiles.
  verifyProfiles?: VerifyProfile[];
  // v2.13 ADR-0018: injectable spawn for tests.
  verificationSpawnFn?: import('../verification/profile-runner.js').SpawnFn;
  // v2.14 ADR-0019-a: injectable git spawn for tests.
  gitSpawnFn?: import('../verification/git-status-reader.js').GitSpawnFn;
  // v2.14 ADR-0019-b: github checks provider config (operator-only, never HTTP).
  githubChecksConfig?: Record<string, import('../../../../packages/shared/src/types.ts').GithubChecksProviderConfig>;
  // v2.14 ADR-0019-b: memory-only github token store (operator-set, never persisted).
  githubTokenStore?: GithubTokenStore;
  // v2.14 ADR-0019-b: injectable fetch for tests.
  githubChecksFetchFn?: typeof fetch;
  additionalEndpoints?: readonly AgentEndpoint[];
}


type TeamSubAction = '' | 'approve' | 'cancel' | 'artifacts' | 'conflicts' | 'slots-advance';

/** Matches /bridge/projects/:key/teams and sub-routes:
 *  /teams/:teamId/{approve|cancel|artifacts|conflicts}
 *  /teams/:teamId/slots/:slotId/advance */
function matchProjectTeamPath(pathname: string): {
  matched: true; key: string | undefined; sub: TeamSubAction; teamId?: string; slotId?: string;
} | { matched: false } {
  const prefix = BRIDGE_PROJECTS_PATH + '/';
  if (!pathname.startsWith(prefix)) return { matched: false };
  const rest = pathname.slice(prefix.length);

  // Helper: extract key + teamId + suffix from "key/teams/teamId/suffix"
  function tryMatchTeamsAction(rest: string, suffix: string): { key: string | undefined; teamId: string } | null {
    const actionIdx = rest.indexOf('/teams/');
    if (actionIdx === -1) return null;
    const raw = rest.slice(0, actionIdx);
    if (raw.length === 0 || raw.includes('/')) return null;
    const remaining = rest.slice(actionIdx + '/teams/'.length);
    if (!remaining.endsWith(suffix)) return null;
    const teamIdRaw = remaining.slice(0, remaining.length - suffix.length);
    if (teamIdRaw.length === 0 || teamIdRaw.includes('/')) return null;
    try {
      const decodedKey = decodeURIComponent(raw);
      const key = decodedKey ? (validateProjectKey(decodedKey) ?? undefined) : undefined;
      return { key, teamId: decodeURIComponent(teamIdRaw) };
    } catch { return null; }
  }

  // slots/:slotId/advance — extract both teamId and slotId
  function tryMatchSlotsAdvance(rest: string): { key: string | undefined; teamId: string; slotId: string } | null {
    const actionIdx = rest.indexOf('/teams/');
    if (actionIdx === -1) return null;
    const raw = rest.slice(0, actionIdx);
    if (raw.length === 0 || raw.includes('/')) return null;
    const remaining = rest.slice(actionIdx + '/teams/'.length);
    // remaining = "teamId/slots/slotId/advance"
    const parts = remaining.split('/');
    if (parts.length !== 4 || parts[1] !== 'slots' || parts[3] !== 'advance') return null;
    try {
      const teamId = decodeURIComponent(parts[0]);
      const slotId = decodeURIComponent(parts[2]);
      if (teamId.length === 0 || slotId.length === 0) return null;
      const decodedKey = decodeURIComponent(raw);
      const key = decodedKey ? (validateProjectKey(decodedKey) ?? undefined) : undefined;
      return { key, teamId, slotId };
    } catch { return null; }
  }

  // Check sub-actions: approve, cancel, artifacts, conflicts
  for (const sub of ['approve', 'cancel', 'artifacts', 'conflicts'] as const) {
    const m = tryMatchTeamsAction(rest, '/' + sub);
    if (m) return { matched: true, key: m.key, sub, teamId: m.teamId };
  }

  // Check slots-advance: :key/teams/:teamId/slots/:slotId/advance
  const sa = tryMatchSlotsAdvance(rest);
  if (sa) return { matched: true, key: sa.key, sub: 'slots-advance', teamId: sa.teamId, slotId: sa.slotId };

  // Basic /teams path: :key/teams (exact)
  if (!rest.endsWith('/teams')) return { matched: false };
  const raw = rest.slice(0, -6);
  if (raw.length === 0 || raw.includes('/')) return { matched: false };
  try {
    const decoded = decodeURIComponent(raw);
    const key = decoded ? (validateProjectKey(decoded) ?? undefined) : undefined;
    return { matched: true, key, sub: '' };
  } catch { return { matched: true, key: undefined, sub: '' }; }
}

/** Matches /bridge/projects/:key/teams/:teamId/apply-requests and sub-routes:
 *  POST  .../apply-requests                          (sub '')
 *  POST  .../apply-requests/:applyId/{confirm|discard}
 *  GET   .../apply-requests/:applyId                 (sub 'manifest', read-only)
 *  GET   .../apply-requests/:applyId/files           (sub 'files', read-only)
 *  GET   .../apply-requests/:applyId/files/preview   (sub 'preview', read-only)
 *  GET   .../apply-requests/:applyId/classification  (sub 'classification', read-only)
 */
function matchTeamApplyPath(pathname: string): {
  matched: true;
  key: string | undefined;
  sub: '' | 'confirm' | 'discard' | 'manifest' | 'files' | 'preview' | 'classification';
  teamId?: string;
  applyId?: string;
} | { matched: false } {
  const prefix = BRIDGE_PROJECTS_PATH + '/';
  if (!pathname.startsWith(prefix)) return { matched: false };
  const rest = pathname.slice(prefix.length);
  const teamsIdx = rest.indexOf('/teams/');
  if (teamsIdx === -1) return { matched: false };
  const raw = rest.slice(0, teamsIdx);
  if (raw.length === 0 || raw.includes('/')) return { matched: false };
  const remaining = rest.slice(teamsIdx + '/teams/'.length);
  // remaining = "teamId/apply-requests[/applyId[/{confirm|discard|files[/preview]}]]"
  const parts = remaining.split('/');
  if (parts.length < 2 || parts[1] !== 'apply-requests') return { matched: false };
  try {
    const decodedKey = decodeURIComponent(raw);
    const key = decodedKey ? (validateProjectKey(decodedKey) ?? undefined) : undefined;
    const teamId = decodeURIComponent(parts[0]);
    if (teamId.length === 0) return { matched: false };
    if (parts.length === 2) return { matched: true, key, sub: '', teamId };
    const applyId = decodeURIComponent(parts[2]);
    if (applyId.length === 0) return { matched: false };
    // Read-only manifest: .../apply-requests/:applyId
    if (parts.length === 3) return { matched: true, key, sub: 'manifest', teamId, applyId };
    if (parts.length === 4) {
      if (parts[3] === 'confirm' || parts[3] === 'discard') {
        return { matched: true, key, sub: parts[3] as 'confirm' | 'discard', teamId, applyId };
      }
      // Read-only file list: .../apply-requests/:applyId/files
      if (parts[3] === 'files') return { matched: true, key, sub: 'files', teamId, applyId };
      // Read-only classification: .../apply-requests/:applyId/classification
      if (parts[3] === 'classification') return { matched: true, key, sub: 'classification', teamId, applyId };
    }
    // Read-only preview: .../apply-requests/:applyId/files/preview
    if (parts.length === 5 && parts[3] === 'files' && parts[4] === 'preview') {
      return { matched: true, key, sub: 'preview', teamId, applyId };
    }
  } catch { return { matched: false }; }
  return { matched: false };
}

// ── v2.5 Workspace apply handlers ────────────────────────────────

async function handleApplyRequestCreate(
  runtime: BridgeRuntime,
  projectKey: string,
  teamId: string,
  request: IncomingMessage,
): Promise<BridgeResult> {
  const parsed = await readJsonBody(request);
  if (!parsed.ok) return error(400, parsed.message);
  const body = parsed.body as Record<string, unknown>;

  const proj = runtime.projectStore.get(projectKey);
  if (!proj) return error(404, 'Project not found');
  if (proj.archivedAt) return error(409, 'Project is archived');
  if (!proj.workspaceApplyEnabled) return error(409, 'Workspace apply is not enabled for this project');

  const team = runtime.teamStore.get(teamId);
  if (!team) return error(404, 'Team not found');
  if (team.projectId !== projectKey) return error(404, 'Team not found');

  // Conflict check: team must be clean.
  const artifacts = runtime.teamStore.listArtifacts(teamId);
  const conflictReport = detectFileConflicts(
    artifacts.map(a => ({ slotId: a.slotId, proposedFiles: a.proposedFiles })),
  );
  if (!conflictReport.clean) return error(409, 'Team has unresolved file conflicts; apply requires a clean conflict report');

  const slotId = body.slotId;
  if (typeof slotId !== 'string') return error(400, 'slotId is required');
  const planStepId = body.planStepId;
  if (typeof planStepId !== 'string') return error(400, 'planStepId is required');

  // Artifact must exist and belong to the team.
  const artifact = artifacts.find(a => a.slotId === slotId && a.planStepId === planStepId);
  if (!artifact) return error(400, 'Artifact not found: no matching slotId/planStepId for this team');

  const files = Array.isArray(body.proposedFiles) ? body.proposedFiles.filter((f: unknown) => typeof f === 'string') : artifact.proposedFiles;
  if (files.length === 0) return error(400, 'No files to apply');

  const result = runtime.applyStore.createRequest({
    projectKey,
    teamId,
    slotId,
    planStepId,
    proposedFiles: files,
    actor: typeof body.actor === 'string' ? body.actor : undefined,
  });
  if (result.error || !result.request) return error(409, result.error ?? 'Failed to create apply request');
  const req = result.request;

  runtime.auditLog.createAndAppend({
    sessionId: 'apply-' + req.applyId,
    projectId: projectKey,
    type: 'workspace_apply_request',
    source: 'workspace-apply',
    target: 'team-' + teamId,
    teamId,
    slotId,
    planStepId,
    result: {
      ok: true,
      metadata: {
        applyId: req.applyId,
        teamId,
        slotId,
        planStepId,
        fileList: req.proposedFiles,
        fileCount: req.proposedFiles.length,
        caps: req.caps,
        status: 'pending',
        actor: req.actor,
      },
    },
  });

  return created({ apply: req });
}

function handleApplyRequestList(
  runtime: BridgeRuntime,
  projectKey: string,
  teamId: string,
): BridgeResult {
  const proj = runtime.projectStore.get(projectKey);
  if (!proj) return error(404, 'Project not found');
  // EX-2.5-6: project each request through the same safe manifest projection
  // used by the single-item GET. This omits the absolute `isolatedDirPath` and
  // reduces `baselineManifest` to its summary (no per-file entries/sha256),
  // tightening the ADR-0009/ADR-0010 read-only / no-absolute-path boundary.
  return ok({ applies: runtime.applyStore.listByTeam(projectKey, teamId).map(toApplyManifest) });
}

async function handleApplyRequestConfirm(
  runtime: BridgeRuntime,
  projectKey: string,
  teamId: string,
  applyId: string,
  request: IncomingMessage,
): Promise<BridgeResult> {
  const parsed = await readJsonBody(request);
  if (!parsed.ok) return error(400, parsed.message);
  const body = parsed.body as Record<string, unknown>;

  const proj = runtime.projectStore.get(projectKey);
  if (!proj) return error(404, 'Project not found');
  if (proj.archivedAt) return error(409, 'Project is archived');
  if (!proj.workspaceApplyEnabled) return error(409, 'Workspace apply is not enabled');

  if (body.confirmed !== true) return error(400, 'confirmed must be true');
  const files = body.files as Record<string, string> | undefined;
  if (!files || typeof files !== 'object' || Object.keys(files).length === 0) return error(400, 'files map is required');

  const result = runtime.applyStore.confirmApply({
    applyId,
    files,
    actor: typeof body.actor === 'string' ? body.actor : undefined,
  });

  const req = runtime.applyStore.getRequest(applyId);
  const auditMeta: Record<string, unknown> = {
    applyId,
    teamId,
    slotId: req?.slotId,
    planStepId: req?.planStepId,
    fileList: req?.proposedFiles ?? [],
    fileCount: req?.fileCount ?? 0,
    byteTotal: req?.byteTotal ?? 0,
    caps: req?.caps,
    status: result.ok ? 'applied' : 'failed',
    isolatedDirId: req?.isolatedDirId,
    actor: req?.actor,
  };
  // v2.5 ADR-0010: include baseline metadata in audit (no entries, no raw content).
  if (req?.baselineManifest) {
    auditMeta.baseline = {
      capturedAt: req.baselineManifest.capturedAt,
      rootRef: req.baselineManifest.rootRef,
      fileCount: req.baselineManifest.fileCount,
      readableCount: req.baselineManifest.readableCount,
      missingCount: req.baselineManifest.missingCount,
      unreadableCount: req.baselineManifest.unreadableCount,
      byteTotal: req.baselineManifest.byteTotal,
    };
  }

  runtime.auditLog.createAndAppend({
    sessionId: 'apply-result-' + applyId,
    projectId: projectKey,
    type: 'workspace_apply_result',
    source: 'workspace-apply',
    target: 'team-' + teamId,
    teamId,
    slotId: req?.slotId,
    planStepId: req?.planStepId,
    result: { ok: result.ok, failureReason: result.ok ? undefined : result.error, metadata: auditMeta },
  });

  if (!result.ok) return error(409, result.error);
  return ok({ apply: result.request });
}

function handleApplyRequestDiscard(
  runtime: BridgeRuntime,
  projectKey: string,
  teamId: string,
  applyId: string,
): BridgeResult {
  const proj = runtime.projectStore.get(projectKey);
  if (!proj) return error(404, 'Project not found');

  const result = runtime.applyStore.discard(applyId);
  if (!result.ok) return error(409, result.error);

  const req = result.request;
  runtime.auditLog.createAndAppend({
    sessionId: 'apply-discard-' + applyId,
    projectId: projectKey,
    type: 'workspace_apply_result',
    source: 'workspace-apply',
    target: 'team-' + teamId,
    teamId,
    slotId: req.slotId,
    planStepId: req.planStepId,
    result: {
      ok: true,
      metadata: {
        applyId,
        teamId,
        slotId: req.slotId,
        planStepId: req.planStepId,
        status: 'discarded',
        isolatedDirId: req.isolatedDirId,
        actor: req.actor,
      },
    },
  });

  return ok({ apply: req });
}

// ── v2.5 Read-only apply-result presentation (ADR-0009) ──────────
//
// Strictly read-only: manifest projection, file list, and size-capped,
// secret-redacted single-file preview. No mutation, no baseline, no diff,
// no git/spawn, no "apply from preview". Opt-in gated like the apply endpoints.

/** Shared opt-in + ownership guard. Returns the request or an error result. */
function resolveApplyForRead(
  runtime: BridgeRuntime,
  projectKey: string,
  teamId: string,
  applyId: string,
): { ok: true; req: ApplyRequest } | { ok: false; result: BridgeResult } {
  const proj = runtime.projectStore.get(projectKey);
  if (!proj) return { ok: false, result: error(404, 'Project not found') };
  // Opt-in default OFF: bound to the existing per-project apply opt-in.
  if (!proj.workspaceApplyEnabled) {
    return { ok: false, result: error(409, 'Workspace apply is not enabled for this project') };
  }
  const req = runtime.applyStore.getRequest(applyId);
  // Fail-closed: unknown applyId or wrong project/team → 404, no disclosure.
  if (!req || req.projectKey !== projectKey || req.teamId !== teamId) {
    return { ok: false, result: error(404, 'Apply request not found') };
  }
  return { ok: true, req };
}

function handleApplyManifestGet(
  runtime: BridgeRuntime,
  projectKey: string,
  teamId: string,
  applyId: string,
): BridgeResult {
  const resolved = resolveApplyForRead(runtime, projectKey, teamId, applyId);
  if (!resolved.ok) return resolved.result;
  return ok({ apply: toApplyManifest(resolved.req) });
}

function handleApplyFilesGet(
  runtime: BridgeRuntime,
  projectKey: string,
  teamId: string,
  applyId: string,
): BridgeResult {
  const resolved = resolveApplyForRead(runtime, projectKey, teamId, applyId);
  if (!resolved.ok) return resolved.result;
  const result = runtime.applyStore.listAppliedFiles(applyId);
  if (!result.ok) {
    return error(result.code === 'not-found' ? 404 : 409, result.error);
  }
  // No modified/unchanged/new classification — only path + size.
  return ok({ files: result.files });
}

function handleApplyPreviewGet(
  runtime: BridgeRuntime,
  projectKey: string,
  teamId: string,
  applyId: string,
  query: URLSearchParams | undefined,
): BridgeResult {
  const resolved = resolveApplyForRead(runtime, projectKey, teamId, applyId);
  if (!resolved.ok) return resolved.result;

  const relPath = query?.get('path');
  if (typeof relPath !== 'string' || relPath.length === 0) {
    return error(400, 'path query parameter is required');
  }

  const result = runtime.applyStore.readFilePreview(applyId, relPath);
  if (!result.ok) {
    const status = result.code === 'invalid-path' ? 400 : result.code === 'not-applied' ? 409 : 404;
    return error(status, result.error);
  }

  // Redact secrets before returning (reuse the existing redaction utility).
  const redaction = redactSensitiveContent(result.content);
  return ok({
    path: result.path,
    size: result.size,
    truncated: result.truncated,
    redacted: redaction.redactionApplied,
    content: redaction.processedContent,
  });
}

// ── v2.6 Read-only classification (ADR-0011) ────────────────────
// Metadata-only per-file classification using persisted baseline manifest
// and in-process result-side SHA-256 comparison. Hashes never returned.

function handleApplyClassificationGet(
  runtime: BridgeRuntime,
  projectKey: string,
  teamId: string,
  applyId: string,
): BridgeResult {
  const resolved = resolveApplyForRead(runtime, projectKey, teamId, applyId);
  if (!resolved.ok) return resolved.result;

  // Additional: require status 'applied' (beyond resolveApplyForRead).
  if (resolved.req.status !== 'applied') {
    return error(409, 'Classification is only available for applied requests');
  }

  const result = runtime.applyStore.classifyResult(applyId);
  if (!result.ok) {
    switch (result.code) {
      case 'no-baseline': return error(409, result.error);
      case 'not-applied': return error(409, result.error);
      case 'cap-exceeded': return error(409, result.error);
      case 'path-escape': return error(400, result.error);
      default: return error(404, result.error);
    }
  }

  return ok({ files: result.files, summary: result.summary });
}

async function handleTeamsPost(
  runtime: BridgeRuntime,
  projectKey: string,
  request: IncomingMessage,
): Promise<BridgeResult> {
  const parsed = await readJsonBody(request);
  if (!parsed.ok) return error(400, parsed.message);

  const proj = runtime.projectStore.get(projectKey);
  if (!proj) return error(404, 'Project not found');
  if (proj.archivedAt) return error(409, 'Project is archived');

  const body = parsed.body as Record<string, unknown>;
  const pidErr = requireProjectIdMatch(body, projectKey);
  if (pidErr) return error(400, pidErr);

  // Schema validation
  const result = validateTeamSpecCreate({ ...body, projectId: projectKey });
  if (!result.ok) return error(400, 'Invalid TeamSpec: ' + result.errors.join(', '));

  // Provider capability validation
  const providerCheck = validateProviderCapability(
    body.provider as string,
    body.mode as string,
    body.isolation as string,
    body.maxConcurrentBridgeSlots as number,
    body.endpointId as string,
  );
  if (!providerCheck.ok) return error(400, 'Provider capability mismatch: ' + providerCheck.errors.join(', '));

  // Policy checks
  const goal = runtime.goalStore.getGoal(body.goalId as string);
  if (!goal) return error(400, 'Goal not found');
  if (goal.status !== 'approved') return error(400, 'Goal must be approved');

  // Goal must belong to the URL project.
  if (resolveProjectKey(goal.projectId) !== projectKey) {
    return error(400, 'Goal does not belong to this project');
  }

  const plan = runtime.goalStore.getPlanByGoal(goal.id);
  if (!plan) return error(400, 'Plan not found for goal');
  if (plan.status !== 'approved') return error(400, 'Plan must be approved');
  if (plan.goalId !== goal.id) return error(400, 'Plan does not belong to goal');

  // planId must match the actual approved plan
  const bodyPlanId = body.planId;
  if (typeof bodyPlanId !== 'string' || bodyPlanId !== plan.id) {
    return error(400, 'planId must match the approved plan for this goal');
  }

  // Validate stepIndex range against actual plan steps
  const logicalSlots = body.logicalSlots as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(logicalSlots)) {
    for (let i = 0; i < logicalSlots.length; i++) {
      const slot = logicalSlots[i];
      const idx = slot?.stepIndex;
      if (typeof idx !== 'number' || !Number.isInteger(idx) || idx < 0 || idx >= plan.steps.length) {
        return error(400, `logicalSlots[${i}].stepIndex out of range (0..${plan.steps.length - 1})`);
      }
      const slotProviderId = typeof slot.providerId === 'string' && slot.providerId.trim().length > 0
        ? slot.providerId
        : body.provider;
      const slotEndpointId = typeof slot.endpointId === 'string' && slot.endpointId.trim().length > 0
        ? slot.endpointId
        : body.endpointId;
      const slotCheck = validateProviderCapability(
        slotProviderId as string,
        body.mode as string,
        'patch-only',
        body.maxConcurrentBridgeSlots as number,
        slotEndpointId as string,
      );
      if (!slotCheck.ok) return error(400, `Provider capability mismatch for logicalSlots[${i}]: ` + slotCheck.errors.join(', '));
    }
  }

  // Reject duplicate team id
  if (runtime.teamStore.get(body.id as string)) {
    return error(409, 'Team already exists');
  }

  try {
    const team = runtime.teamStore.create({
      ...(body as any), projectId: projectKey,
    });
    if (!team) return error(409, 'Team already exists');
    runtime.persist();

    // Audit
    runtime.auditLog.createAndAppend({
      sessionId: 'team-create-' + team.id,
      projectId: projectKey,
      type: 'team_created',
      source: 'team-orchestrator',
      target: 'team-' + team.id,
      teamId: team.id,
      goalId: team.goalId,
      result: { ok: true },
    });

    return created({ team });
  } catch (err: any) {
    return error(400, err?.message ?? 'TeamSpec creation failed');
  }
}

// ── v2.3 Artifact recording ──────────────────────────────────────

async function handleArtifactPost(
  runtime: BridgeRuntime,
  projectKey: string,
  teamId: string,
  request: IncomingMessage,
): Promise<BridgeResult> {
  const parsed = await readJsonBody(request);
  if (!parsed.ok) return error(400, parsed.message);
  const body = parsed.body as Record<string, unknown>;

  const proj = runtime.projectStore.get(projectKey);
  if (!proj) return error(404, 'Project not found');
  if (proj.archivedAt) return error(409, 'Project is archived');

  // Team must exist and belong to the project.
  const team = runtime.teamStore.get(teamId);
  if (!team) return error(404, 'Team not found');
  if (team.projectId !== projectKey) return error(404, 'Team not found');

  // Validate required fields.
  const slotId = body.slotId;
  if (typeof slotId !== 'string' || slotId.length === 0) return error(400, 'slotId is required');
  const slot = team.logicalSlots.find(s => s.id === slotId);
  if (!slot) return error(400, 'slotId does not belong to this team');

  // planStepId must match the slot's stepIndex in the approved plan.
  const plan = runtime.goalStore.getPlanByGoal(team.goalId);
  if (!plan) return error(400, 'Plan not found for team goal');
  const expectedPlanStepId = plan.steps?.[slot.stepIndex]?.id;
  if (!expectedPlanStepId) return error(400, 'Plan step not found for slot stepIndex ' + slot.stepIndex);
  const planStepId = body.planStepId;
  if (typeof planStepId === 'string' && planStepId.length > 0) {
    if (planStepId !== expectedPlanStepId) return error(400, 'planStepId does not match slot stepIndex in plan');
  } else if (typeof planStepId !== 'string' || planStepId.length === 0) {
    // Auto-fill from plan when omitted/empty — caller cannot supply a fake value.
  }
  const resolvedPlanStepId = typeof planStepId === 'string' && planStepId.length > 0 ? planStepId : expectedPlanStepId;

  const summary = body.summary;
  if (typeof summary !== 'string' || summary.trim().length === 0) return error(400, 'summary is required');
  const providerId = slot.providerId ?? team.provider;
  const endpointId = slot.endpointId ?? team.endpointId;
  const bridgeRunId = typeof body.bridgeRunId === 'string' && body.bridgeRunId.trim().length > 0
    ? body.bridgeRunId.trim()
    : `slot-run-${teamId}-${slotId}-${Date.now()}`;

  // Build artifact.
  const artifact: Record<string, unknown> = {
    teamId,
    slotId,
    planStepId: resolvedPlanStepId,
    providerId,
    endpointId,
    bridgeRunId,
    summary,
    proposedFiles: Array.isArray(body.proposedFiles) ? body.proposedFiles.filter((f: unknown) => typeof f === 'string') : [],
    outputRedacted: typeof body.outputRedacted === 'boolean' ? body.outputRedacted : false,
    createdAt: typeof body.createdAt === 'number' ? body.createdAt : Date.now(),
  };
  if (body.verificationNotes !== undefined && typeof body.verificationNotes === 'string') {
    artifact.verificationNotes = body.verificationNotes;
  }
  if (body.verificationEvidence !== undefined && typeof body.verificationEvidence === 'object' && body.verificationEvidence !== null) {
    artifact.verificationEvidence = body.verificationEvidence;
  }
  if (body.rawProviderOutput !== undefined && typeof body.rawProviderOutput === 'string') {
    artifact.rawProviderOutput = body.rawProviderOutput;
  }
  if (body.externalSessionId !== undefined && typeof body.externalSessionId === 'string' && body.externalSessionId.trim().length > 0) {
    artifact.externalSessionId = body.externalSessionId.trim();
  }

  const recorded = runtime.teamStore.recordArtifact(teamId, artifact as any);
  if (!recorded) return error(400, 'Invalid artifact: must pass schema validation and redaction guard');

  runtime.persist();

  // Audit: artifact_recorded
  runtime.auditLog.createAndAppend({
    sessionId: 'artifact-' + teamId + '-' + slotId,
    projectId: projectKey,
    type: 'artifact_recorded',
    source: 'team-orchestrator',
    target: 'team-' + teamId,
    teamId,
    slotId,
    planStepId: resolvedPlanStepId,
    result: {
      ok: true,
      metadata: {
        providerId,
        endpointId,
        bridgeRunId,
        externalSessionId: artifact.externalSessionId ?? 'unavailable',
      },
    },
  });

  return created({ artifact: recorded });
}

// ── v2.3 Conflict report (read-only) ─────────────────────────────

function handleConflictGet(
  runtime: BridgeRuntime,
  projectKey: string,
  teamId: string,
): BridgeResult {
  const proj = runtime.projectStore.get(projectKey);
  if (!proj) return error(404, 'Project not found');

  const team = runtime.teamStore.get(teamId);
  if (!team) return error(404, 'Team not found');
  if (team.projectId !== projectKey) return error(404, 'Team not found');

  const artifacts = runtime.teamStore.listArtifacts(teamId);
  const report = detectFileConflicts(
    artifacts.map(a => ({ slotId: a.slotId, proposedFiles: a.proposedFiles, providerId: a.providerId })),
  );
  return ok({
    teamId,
    report,
    meta: {
      readOnly: true,
      winnerSelected: false,
      applyAvailable: false,
    },
  });
}

// ── v2.3 Controlled slot state advance ───────────────────────────

async function handleSlotAdvancePost(
  runtime: BridgeRuntime,
  projectKey: string,
  teamId: string,
  slotId: string,
  request: IncomingMessage,
): Promise<BridgeResult> {
  const parsed = await readJsonBody(request);
  if (!parsed.ok) return error(400, parsed.message);
  const body = parsed.body as Record<string, unknown>;

  const proj = runtime.projectStore.get(projectKey);
  if (!proj) return error(404, 'Project not found');
  if (proj.archivedAt) return error(409, 'Project is archived');

  const team = runtime.teamStore.get(teamId);
  if (!team) return error(404, 'Team not found');
  if (team.projectId !== projectKey) return error(404, 'Team not found');

  // Status must be one of the valid slot statuses.
  const nextStatus = body.status;
  if (typeof nextStatus !== 'string') return error(400, 'status is required');
  const allowed = ['ready', 'executing', 'blocked-needs-gate', 'done', 'failed', 'cancelled'] as const;
  if (!(allowed as readonly string[]).includes(nextStatus)) {
    return error(400, 'status must be one of: ' + allowed.join(', '));
  }

  // Slot must belong to team.
  const slot = team.logicalSlots.find(s => s.id === slotId);
  if (!slot) return error(400, 'slotId does not belong to this team');

  // ════════════════════════════════════════════════════
  // Sequential guard — enforced at API level
  // ════════════════════════════════════════════════════

  // Cannot advance if team is not approved or executing.
  if (team.status !== 'approved' && team.status !== 'executing') {
    return error(409, `Cannot advance slot: team is ${team.status}`);
  }

  // Cannot advance a slot that's already done/failed/cancelled.
  if (slot.status === 'done' || slot.status === 'failed' || slot.status === 'cancelled') {
    return error(409, `Cannot advance slot: slot is already ${slot.status}`);
  }

  // Sequential: can only advance the slot at currentSlotIndex.
  const currentSlot = team.logicalSlots[team.currentSlotIndex];
  if (currentSlot && currentSlot.id !== slotId) {
    return error(409, `Slot ${slotId} is not the current slot (expected: ${currentSlot?.id ?? 'none'}, index: ${team.currentSlotIndex})`);
  }

  // Cannot have two slots executing.
  if (nextStatus === 'executing') {
    const alreadyExecuting = team.logicalSlots.some(
      s => s.id !== slotId && s.status === 'executing'
    );
    if (alreadyExecuting) return error(409, 'A slot is already executing');
  }

  // Transition team to executing if needed, and audit slot_started only on executing.
  if (team.status === 'approved') {
    const setExec = runtime.teamStore.setExecuting(teamId);
    if (!setExec) return error(409, 'Cannot transition team to executing');
  }
  if (nextStatus === 'executing') {
    const stepPlan = runtime.goalStore.getPlanByGoal(team.goalId);
    const pStepId = stepPlan?.steps?.[slot.stepIndex]?.id;
    const providerId = slot.providerId ?? team.provider;
    const endpointId = slot.endpointId ?? team.endpointId;
    const bridgeRunId = `slot-run-${teamId}-${slotId}-${Date.now()}`;
    runtime.auditLog.createAndAppend({
      sessionId: 'slot-start-' + teamId + '-' + slotId,
      projectId: projectKey,
      type: 'slot_started',
      source: 'team-orchestrator',
      target: 'team-' + teamId,
      teamId,
      slotId,
      planStepId: pStepId,
      result: {
        ok: true,
        metadata: {
          providerId,
          endpointId,
          bridgeRunId,
          externalSessionId: 'unavailable',
        },
      },
    });
  }

  // Perform the advance.
  const updated = runtime.teamStore.advanceSlot(teamId, slotId, nextStatus as any);
  if (!updated) return error(409, 'Slot advance failed');

  runtime.persist();

  // Only write terminal audit for done/failed/gated; ready/executing are intermediate states.
  if (nextStatus === 'done' || nextStatus === 'failed' || nextStatus === 'blocked-needs-gate') {
    const stepPlan = runtime.goalStore.getPlanByGoal(team.goalId);
    const pStepId = stepPlan?.steps?.[slot.stepIndex]?.id;
    const auditType = nextStatus === 'done' ? 'slot_done' : nextStatus === 'failed' ? 'slot_failed' : 'slot_gated';
    const providerId = slot.providerId ?? team.provider;
    const endpointId = slot.endpointId ?? team.endpointId;
    const bridgeRunId = `slot-run-${teamId}-${slotId}-${Date.now()}`;

    runtime.auditLog.createAndAppend({
      sessionId: 'slot-' + nextStatus + '-' + teamId + '-' + slotId,
      projectId: projectKey,
      type: auditType,
      source: 'team-orchestrator',
      target: 'team-' + teamId,
      teamId,
      slotId,
      planStepId: pStepId,
      result: {
        ok: true,
        metadata: {
          providerId,
          endpointId,
          bridgeRunId,
          externalSessionId: 'unavailable',
        },
      },
    });
  }

  return ok({ team: updated });
}

/** Matches /bridge/projects/:key/workbuddy (path portion only). */
function matchProjectWorkBuddyPath(pathname: string): {
  matched: true; key: string | undefined; sub: string;
} | { matched: false } {
  const prefix = `${BRIDGE_PROJECTS_PATH}/`;
  const suffix = BRIDGE_PROJECT_WORKBUDDY_SUFFIX;
  if (!pathname.startsWith(prefix) || !pathname.endsWith(suffix)) return { matched: false };
  const rest = pathname.slice(prefix.length);
  const raw = rest.slice(0, -suffix.length);
  if (raw.length === 0 || raw.includes('/')) return { matched: false };
  let decoded: string | undefined;
  try { decoded = decodeURIComponent(raw); } catch { return { matched: true, key: undefined, sub: suffix }; }
  const key = decoded ? (validateProjectKey(decoded) ?? undefined) : undefined;
  return { matched: true, key, sub: '' };
}

/** Validates that body.projectId, if present, matches the URL key. */
function requireProjectIdMatch(body: Record<string, unknown>, urlKey: string): string | null {
  const bodyProjectId = body.projectId;
  if (bodyProjectId !== undefined) {
    if (typeof bodyProjectId !== 'string') return 'body.projectId must be a string';
    const resolved = resolveProjectKey(bodyProjectId);
    if (resolved !== urlKey) return 'body.projectId does not match URL project key';
  }
  return null; // ok
}

function buildWorkBuddyProjectView(runtime: BridgeRuntime, projectKey: string) {
  return {
    projectId: projectKey,
    tasks: runtime.workbuddyStore.listTaskReferences().filter(t => resolveProjectKey(t.projectId) === projectKey),
    reviewResultSinks: runtime.workbuddyStore.listReviewResultSinks().filter(r => resolveProjectKey(r.projectId) === projectKey),
    promptDraftSinks: runtime.workbuddyStore.listPromptDraftSinks().filter(p => resolveProjectKey(p.projectId) === projectKey),
    executionLedgerEvents: runtime.workbuddyStore.listExecutionLedgerEvents().filter(e => resolveProjectKey(e.projectId) === projectKey),
  };
}

// ---- WorkBuddy strict whitelist builder ----

/** Strips unknown keys from a WorkBuddy payload, keeping only allowed fields
 *  for the given action. Returns an error message string if any unknown keys
 *  are present, or null on success. */
function sanitizeWorkBuddyPayload(
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
        return []; // will be caught later by the unknown action check
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

// ---- WorkBuddy multiplex handler ----

async function postWorkBuddyMultiplex(
  runtime: BridgeRuntime,
  projectKey: string,
  request: IncomingMessage,
): Promise<BridgeResult> {
  const parsed = await readJsonBody(request);
  if (!parsed.ok) return error(400, parsed.message);
  const action = requireString(parsed.body, 'action');
  if (!action) return error(400, 'action is required');
  const pidErr = requireProjectIdMatch(parsed.body, projectKey);
  if (pidErr) return error(400, pidErr);

  // Strip action and projectId, sanitize to whitelisted fields only.
  const { action: _a, projectId: _pid, ...bodyRest } = parsed.body as Record<string, unknown>;
  const sanitized = sanitizeWorkBuddyPayload(action, bodyRest);
  if (typeof sanitized === 'string') return error(400, sanitized);

  const payload: Record<string, unknown> = { ...sanitized, projectId: projectKey };

  try {
    switch (action) {
      case 'record-task': {
        const task = runtime.workbuddyStore.recordTaskReference(payload as any);
        runtime.persist();
        return created({ task });
      }
      case 'record-review-result': {
        const sink = runtime.workbuddyStore.recordReviewResultSink(payload as any);
        runtime.persist();
        return created({ reviewResultSink: sink });
      }
      case 'record-prompt-draft': {
        const draft = runtime.workbuddyStore.recordPromptDraftSink(payload as any);
        runtime.persist();
        return created({ promptDraftSink: draft });
      }
      case 'record-ledger': {
        const event = runtime.workbuddyStore.recordExecutionLedgerEvent(payload as any);
        runtime.persist();
        return created({ executionLedgerEvent: event });
      }
      default:
        return error(400, `Unknown action: ${action}`);
    }
  } catch (err: any) {
    return error(400, err?.message ?? 'Invalid WorkBuddy payload');
  }
}

// ── v2.14 ADR-0019-a: Read-only local git status ─────────────────

async function handleGitStatusGet(
  runtime: BridgeRuntime,
  projectKey: string,
): Promise<BridgeResult> {
  const project = runtime.projectStore.get(projectKey);
  if (!project) return error(404, 'Project not found');
  if (project.archivedAt) return error(409, 'Cannot fetch git status for archived project');
  if (!project.gitStatusEnabled) return error(409, 'Git status is not enabled for this project');

  const workspaceRoot = runtime.projectWorkspaceRoots?.[projectKey];
  if (!workspaceRoot) return error(409, 'No project workspace root configured');

  const result = await readGitStatus({
    projectKey,
    workspaceRoot,
    spawnFn: runtime.gitSpawnFn,
  });

  // Redacted audit event — no cwd/root, no remote URL, no commit hash, no raw output.
  runtime.auditLog.createAndAppend({
    sessionId: 'git-status-' + projectKey + '-' + Date.now(),
    projectId: projectKey,
    type: 'workspace_apply_result',
    source: 'git-status',
    target: 'project-' + projectKey,
    result: {
      ok: result.view.available,
      metadata: {
        gitStatus: {
          isGitRepo: result.view.isGitRepo,
          dirty: result.view.dirty,
          aheadCount: result.view.aheadCount,
          behindCount: result.view.behindCount,
          available: result.view.available,
          elapsedMs: result.elapsedMs,
        },
      },
    },
  });

  return ok({
    branch: result.view.branch,
    dirty: result.view.dirty,
    aheadCount: result.view.aheadCount,
    behindCount: result.view.behindCount,
    isGitRepo: result.view.isGitRepo,
    fetchedAt: result.view.fetchedAt,
    available: result.view.available,
    elapsedMs: result.elapsedMs,
  });
}

// ── v2.14 ADR-0019-b: GitHub checks confirm ─────────────────────

async function handleGithubChecksConfirm(
  runtime: BridgeRuntime,
  projectKey: string,
): Promise<BridgeResult> {
  const project = runtime.projectStore.get(projectKey);
  if (!project) return error(404, 'Project not found');
  if (project.archivedAt) return error(409, 'Cannot run github checks for archived project');
  if (!project.githubChecksEnabled) return error(409, 'GitHub checks not enabled for this project');

  const config = runtime.githubChecksConfig?.[projectKey];
  if (!config) return error(409, 'No GitHub checks provider config for this project');

  const token = runtime.githubTokenStore?.getToken(projectKey);
  if (!token) return error(409, 'No GitHub token configured for this project');

  // Get current branch via the ADR-0019-a reader (read-only, no spawn here — use direct git).
  const workspaceRoot = runtime.projectWorkspaceRoots?.[projectKey];
  if (!workspaceRoot) return error(409, 'No project workspace root configured');

  // Read branch from local git.
  const gitResult = await readGitStatus({
    projectKey,
    workspaceRoot,
    spawnFn: runtime.gitSpawnFn,
  });

  if (!gitResult.view.isGitRepo || !gitResult.view.branch) {
    return error(409, 'Cannot determine branch — detached or not a git repository');
  }

  const ref = gitResult.view.branch;
  const result = await fetchGithubChecks({
    projectKey,
    config,
    token,
    ref,
    fetchFn: runtime.githubChecksFetchFn,
  });

  // Store as ADR-0017 evidence.
  if (runtime.verificationRunStore) {
    runtime.verificationRunStore.add(projectKey, {
      projectKey,
      profileId: 'github-checks',
      commandLabel: 'github-checks',
      result: result.view.result,
      recordedAt: result.view.fetchedAt,
      elapsedMs: result.elapsedMs,
      truncated: false,
      outputDiscarded: true,
    });
  }

  // Redacted audit event — no token, no URL, no raw payload, no branch/owner/repo.
  runtime.auditLog.createAndAppend({
    sessionId: 'github-checks-' + projectKey + '-' + Date.now(),
    projectId: projectKey,
    type: 'workspace_apply_result',
    source: 'github-checks',
    target: 'project-' + projectKey,
    result: {
      ok: result.view.available,
      metadata: {
        githubChecks: {
          result: result.view.result,
          conclusionSummary: result.view.conclusionSummary,
          checkRunCount: result.view.checkRunCount,
          available: result.view.available,
          elapsedMs: result.elapsedMs,
        },
      },
    },
  });

  const hostDisclosure = `read-only network call to ${config.apiBaseUrl} using a stored credential`;

  const response: GithubChecksConfirmResult = {
    profileId: 'github-checks',
    commandLabel: 'github-checks',
    result: result.view.result,
    recordedAt: result.view.fetchedAt,
    elapsedMs: result.elapsedMs,
    truncated: false,
    outputDiscarded: true,
    hostDisclosure,
  };

  return ok(response);
}

// ── v2.13 ADR-0018: Live verification handlers ──────────────────

function handleVerificationProfilesGet(
  runtime: BridgeRuntime,
  projectKey: string,
): BridgeResult {
  const profiles = runtime.verifyProfiles ?? [];
  const project = runtime.projectStore.get(projectKey);
  if (!project) return error(404, 'Project not found');

  const hasRoot = !!(runtime.projectWorkspaceRoots?.[projectKey]);
  const selectedId = project.verifyProfileId;

  const available: VerifyProfileMeta[] = profiles.map(p => ({
    id: p.id,
    label: p.label,
    networkRisk: p.networkRisk,
    mutationRisk: p.mutationRisk,
    available: hasRoot,
    selected: p.id === selectedId,
  }));

  return ok({ profiles: available, selectedProfileId: selectedId ?? null, workspaceRootAvailable: hasRoot });
}

async function handleVerificationConfirmPost(
  runtime: BridgeRuntime,
  projectKey: string,
  request: import('node:http').IncomingMessage,
): Promise<BridgeResult> {
  const project = runtime.projectStore.get(projectKey);
  if (!project) return error(404, 'Project not found');
  if (project.archivedAt) return error(409, 'Cannot verify archived project');

  const profiles = runtime.verifyProfiles ?? [];
  const profileId = project.verifyProfileId;
  if (!profileId) return error(409, 'No verification profile configured for this project');

  const profile = profiles.find((p: VerifyProfile) => p.id === profileId);
  if (!profile) return error(409, 'Verification profile not found');

  const workspaceRoot = runtime.projectWorkspaceRoots?.[projectKey];
  if (!workspaceRoot) return error(409, 'No project workspace root configured');

  // Read body — only confirm:true, no command/profile override.
  const parsed = await readJsonBody(request as any).catch(() => ({ ok: false as const, message: 'Invalid request body' }));
  if (!parsed.ok) return error(400, parsed.message);

  const body = parsed.body as Record<string, unknown>;
  if (body.confirm !== true) return error(409, 'Confirm must be true');

  // Reject command-like overrides.
  for (const banned of ['command', 'argv', 'cwd', 'env', 'shell', 'profile', 'profileId', 'stdout', 'stderr', 'output', 'root']) {
    if (banned in body) return error(400, `Field '${banned}' is not allowed in verification confirm`);
  }

  const result = await runVerificationProfile({
    profile,
    projectKey,
    workspaceRoot,
    spawnFn: runtime.verificationSpawnFn,
  });

  // Store sanitized record.
  runtime.verificationRunStore.add(projectKey, result.record);

  // Redacted audit event — no cwd/root/argv/env/stdout/stderr.
  runtime.auditLog.createAndAppend({
    sessionId: 'verify-' + projectKey + '-' + Date.now(),
    projectId: projectKey,
    type: 'workspace_apply_result',
    source: 'verification',
    target: 'project-' + projectKey,
    result: {
      ok: result.ok,
      metadata: {
        verification: {
          profileId: result.record.profileId,
          commandLabel: result.record.commandLabel,
          result: result.record.result,
          elapsedMs: result.record.elapsedMs,
          truncated: result.record.truncated,
          outputDiscarded: result.record.outputDiscarded,
        },
      },
    },
  });

  return ok({
    profileId: result.record.profileId,
    commandLabel: result.record.commandLabel,
    result: result.record.result,
    elapsedMs: result.record.elapsedMs,
    truncated: result.record.truncated,
    outputDiscarded: result.record.outputDiscarded,
    error: result.error,
  });
}

export function createBridgeRuntime(options: BridgeRuntimeOptions = {}): BridgeRuntime {
  const packetStore = new InMemoryPacketStore();
  const auditLog = new InMemoryAuditLog();
  const pendingPromptStore = new InMemoryPendingPromptStore(packetStore, auditLog);
  const outboundPromptStore = new InMemoryOutboundPromptStore(packetStore, auditLog);
  const webRelayLoopStore = new InMemoryWebRelayLoopStore(outboundPromptStore);
  const relayContextStore = new InMemoryRelayContextStore(auditLog);
  const inboundMessageStore = new InMemoryInboundMessageStore(packetStore, auditLog);
  const endpointRegistry = new InMemoryEndpointRegistry([
    ...DEFAULT_AGENT_ENDPOINTS,
    CLAUDE_CODE_REVIEW_COMMAND_ENDPOINT,
    CODEX_REVIEW_COMMAND_ENDPOINT,
    MOCK_INBOUND_AGENT_ENDPOINT,
    WORKBUDDY_ENDPOINT,
    ...(options.additionalEndpoints ?? []),
  ]);
  const inboundRelayEndpointId = options.inboundRelayEndpointId;
  if (inboundRelayEndpointId) {
    if (!endpointRegistry.get(inboundRelayEndpointId)) {
      throw new Error('inboundRelayEndpointId must reference a registered endpoint');
    }
    if (!endpointRegistry.can(inboundRelayEndpointId, 'receive-inbound')) {
      throw new Error('inboundRelayEndpointId endpoint cannot receive inbound');
    }
  }
  const pendingReviewStore = new InMemoryPendingReviewStore(
    endpointRegistry,
    packetStore,
    auditLog,
    pendingPromptStore,
  );
  const agent = new MockAgentAdapter();
  const goalStore = new InMemoryGoalStore();
  const projectStore = new InMemoryProjectStore();
  const reasoningArtifactStore = new InMemoryReasoningArtifactStore();
  const executionProposalStore = new InMemoryExecutionProposalStore();
  const automationBindingStore = new InMemoryAutomationBindingStore({
    endpointRegistry,
    projectExists(projectRef) {
      return projectStore.get(projectRef) !== undefined;
    },
  });

  const dataDir = options.dataDir ?? resolveDataDirFromEnv();
  const snapshotStore = dataDir ? new JsonSnapshotStore(dataDir) : null;

  const workbuddyStore = new InMemoryWorkBuddyStateStore();
  const teamStore = new InMemoryTeamSpecStore();
  const presetStore = new InMemoryProjectTeamPresetStore();
  const bindingSnapshotStore = new InMemoryGoalBindingSnapshotStore();
  const workbuddyExecution = new WorkBuddyExecutionAdapter();
  // v2.4a Model API key store — memory-only, never persisted.
  const modelApiKeyStore = new InMemoryApiKeyStore();
  const applyRoot = options.applyRoot ?? process.env.TEMP ?? process.env.TMPDIR ?? '/tmp';
  const projectWorkspaceRoots = normalizeProjectWorkspaceRoots(
    options.projectWorkspaceRoots,
    validateProjectKey,
  );
  const applyStore = new WorkspaceApplyStore(applyRoot + '/cli-bridge-apply', {
    baselineRoot: options.baselineRoot,
    projectWorkspaceRoots,
    baselineCaptureEnabled: options.baselineCaptureEnabled ?? false,
    baselineCaps: options.baselineCaps,
  });

  // v2.13: live verification — created before snapshot restore
  const verificationRunStore = new VerificationRunStore();

  if (snapshotStore) {
    const read = snapshotStore.read();
    if (!read.ok && read.error !== 'snapshot-missing') {
      throw new Error(read.error ?? 'snapshot-read-failed');
    }
    if (read.ok && read.snapshot) {
      packetStore.hydratePackets(read.snapshot.packets);
      auditLog.hydrateEvents(read.snapshot.auditEvents);
      pendingPromptStore.hydratePrompts(read.snapshot.pendingPrompts);
      outboundPromptStore.hydratePrompts(read.snapshot.outboundPrompts ?? []);
      webRelayLoopStore.hydrateLoops(read.snapshot.webRelayLoops ?? []);
      webRelayLoopStore.recoverAfterRestart();
      inboundMessageStore.hydrateMessages(read.snapshot.inboundMessages ?? []);
      relayContextStore.hydrateContexts(read.snapshot.relayContexts ?? []);
      // Hydrate v2 goal/plan/project state (fail-open: skip invalid records).
      for (const project of read.snapshot.projects ?? []) {
        projectStore.hydrateProject(project);
      }
      for (const goal of read.snapshot.goals ?? []) {
        goalStore.hydrateGoal(goal);
      }
      for (const plan of read.snapshot.plans ?? []) {
        goalStore.hydratePlan(plan);
      }
      for (const binding of read.snapshot.automationBindings ?? []) {
        automationBindingStore.hydrateBinding(binding);
      }
      // v2.2 WorkBuddy state: fail-open hydration.
      for (const t of read.snapshot.workbuddyTaskReferences ?? []) {
        try { workbuddyStore.recordTaskReference(t); } catch { /* skip bad record */ }
      }
      for (const r of read.snapshot.workbuddyReviewResultSinks ?? []) {
        try { workbuddyStore.recordReviewResultSink(r); } catch { }
      }
      for (const p of read.snapshot.workbuddyPromptDraftSinks ?? []) {
        try { workbuddyStore.recordPromptDraftSink(p); } catch { }
      }
      for (const t of read.snapshot.teams ?? []) {
        try { teamStore.hydrateTeam(t); } catch { /* skip bad record */ }
      }
      for (const a of read.snapshot.teamArtifacts ?? []) {
        try { teamStore.hydrateArtifact(a); } catch { }
      }
      for (const p of read.snapshot.teamPresets ?? []) {
        try { presetStore.hydratePreset(p); } catch { }
      }
      for (const s of read.snapshot.bindingSnapshots ?? []) {
        try { bindingSnapshotStore.hydrateSnapshot(s); } catch { }
      }
      // v2.13: restore live verification run records
      for (const r of read.snapshot.verificationRunRecords ?? []) {
        try { verificationRunStore.add(r.projectKey, r); } catch { }
      }
      for (const e of read.snapshot.workbuddyExecutionLedgerEvents ?? []) {
        try { workbuddyStore.recordExecutionLedgerEvent(e); } catch { }
      }
    }
  }

  let persistenceFailure: string | undefined;
  const persist = (): void => {
    if (!snapshotStore) return;
    if (persistenceFailure) {
      throw new Error(persistenceFailure);
    }
    const result = snapshotStore.write(buildSnapshot({
      packets: packetStore.exportPackets(),
      auditEvents: auditLog.exportEvents(),
      pendingPrompts: pendingPromptStore.exportPrompts(),
      outboundPrompts: outboundPromptStore.exportPrompts(),
      webRelayLoops: webRelayLoopStore.exportLoops(),
      inboundMessages: inboundMessageStore.exportMessages(),
      relayContexts: relayContextStore.exportContexts(),
      goals: goalStore.exportGoals(),
      plans: goalStore.exportPlans(),
      projects: projectStore.exportProjects(),
      automationBindings: automationBindingStore.exportBindings(),
      verificationRunRecords: verificationRunStore.list(),
      workbuddyTaskReferences: workbuddyStore.listTaskReferences(),
      workbuddyReviewResultSinks: workbuddyStore.listReviewResultSinks(),
      workbuddyPromptDraftSinks: workbuddyStore.listPromptDraftSinks(),
      workbuddyExecutionLedgerEvents: workbuddyStore.listExecutionLedgerEvents(),
      teams: teamStore.exportTeams(),
      teamArtifacts: teamStore.exportArtifacts(),
      teamPresets: presetStore.exportPresets(),
      bindingSnapshots: bindingSnapshotStore.exportSnapshots(),
    }));
    if (!result.ok) {
      persistenceFailure = `Snapshot write failed: ${result.error ?? 'unknown error'}`;
      throw new Error(persistenceFailure);
    }
  };

  return {
    packetStore,
    auditLog,
    pendingPromptStore,
    outboundPromptStore,
    automationBindingStore,
    reasoningArtifactStore,
    executionProposalStore,
    webRelayLoopStore,
    relayContextStore,
    inboundMessageStore,
    endpointRegistry,
    inboundRelayEndpointId,
    pendingReviewStore,
    reviewAdapterFor: options.reviewAdapterFor
      ?? ((targetEndpointId: string) => {
        const factory = REVIEW_COMMAND_ADAPTERS[targetEndpointId];
        return factory ? factory() : undefined;
      }),
    agent,
    persist,
    getPersistenceFailure: () => persistenceFailure,
    goalStore,
    projectStore,
    goalPlanCommandOptions: options.goalPlanCommandOptions,
    commandRunOptions: options.commandRunOptions,
    workbuddyStore,
    teamStore,
    presetStore,
    bindingSnapshotStore,
    workbuddyExecution,
    modelApiKeyStore,
    modelProviderFor: options.modelProviderFactory,
    applyStore,
    // v2.13 ADR-0018
    verificationRunStore,
    verifyProfiles: options.verifyProfiles,
    verificationSpawnFn: options.verificationSpawnFn,
    // v2.14 ADR-0019-a
    gitSpawnFn: options.gitSpawnFn,
    // v2.14 ADR-0019-b
    githubChecksConfig: options.githubChecksConfig,
    githubTokenStore: options.githubTokenStore ?? new GithubTokenStore(),
    githubChecksFetchFn: options.githubChecksFetchFn,
    projectWorkspaceRoots,
  };
}

function resolveDataDirFromEnv(): string | undefined {
  const dir = process.env.CLI_BRIDGE_DATA_DIR;
  return typeof dir === 'string' && dir.trim().length > 0 ? dir.trim() : undefined;
}

export interface BridgeResult {
  statusCode: number;
  payload: unknown;
}

function ok(payload: unknown): BridgeResult {
  return { statusCode: 200, payload };
}

function created(payload: unknown): BridgeResult {
  return { statusCode: 201, payload };
}

function error(statusCode: number, message: string): BridgeResult {
  return { statusCode, payload: { status: 'error', message } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(body: Record<string, unknown>, key: string): string | null {
  const value = body[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

interface GoalWithPlan {
  goal: Goal;
  plan: Plan | null;
}

// Cap for the compact derived-memory list embedded in the project-detail
// status panel. The full memory view remains on GET /bridge/projects/:key/memory.
const STATUS_MEMORY_LIMIT = 8;

interface ProjectDerivedStatus {
  progress: { completed: number; total: number } | null;
  activeGoal: { id: string; description: string; status: Goal['status'] } | null;
  goalsSummary: Array<{ id: string; description: string; status: Goal['status'] }>;
  blockedGate: { goalId: string; stepId: string; stepIndex: number } | null;
  latestAudit: AuditEvent | null;
  memory: DerivedMemoryEntry[];
}

function listGoalsWithPlans(runtime: BridgeRuntime): GoalWithPlan[] {
  return runtime.goalStore.listGoals().map((goal) => ({
    goal,
    plan: runtime.goalStore.getPlanByGoal(goal.id) ?? null,
  }));
}

function projectMatches(record: { projectId?: string }, projectKey: string): boolean {
  return resolveProjectKey(record.projectId) === projectKey;
}

function buildProjectSummaries(runtime: BridgeRuntime): ProjectSummary[] {
  return runtime.projectStore.buildAllSummaries({
    goals: runtime.goalStore.listGoals(),
    reviews: runtime.pendingReviewStore.list(),
    prompts: runtime.pendingPromptStore.listPrompts(),
  });
}

function buildProjectStatus(
  goals: GoalWithPlan[],
  auditEvents: AuditEvent[] = [],
  memory: DerivedMemoryEntry[] = [],
): ProjectDerivedStatus {
  const activeEntry = goals.find(({ goal }) =>
    goal.status !== 'done' &&
    goal.status !== 'cancelled' &&
    goal.status !== 'failed'
  );
  const activePlan = activeEntry?.plan ?? null;
  const steps = activePlan?.steps ?? [];
  const completed = steps.filter((step) => step.status === 'done').length;
  const blocked = goals
    .flatMap(({ goal, plan }) => (plan?.steps ?? []).map((step) => ({ goal, step })))
    .find(({ step }) => step.status === 'blocked-needs-gate');

  return {
    progress: activePlan ? { completed, total: steps.length } : null,
    activeGoal: activeEntry
      ? {
        id: activeEntry.goal.id,
        description: activeEntry.goal.description,
        status: activeEntry.goal.status,
      }
      : null,
    goalsSummary: goals.map(({ goal }) => ({
      id: goal.id,
      description: goal.description,
      status: goal.status,
    })),
    blockedGate: blocked
      ? {
        goalId: blocked.goal.id,
        stepId: blocked.step.id,
        stepIndex: blocked.step.index,
      }
      : null,
    latestAudit: auditEvents.length > 0
      ? auditEvents.reduce((a, b) => (a.timestamp > b.timestamp ? a : b))
      : null,
    memory,
  };
}

function buildProjectDetail(runtime: BridgeRuntime, projectKey: string): {
  summary: ProjectSummary;
  goals: GoalWithPlan[];
  reviews: AgentReviewRequest[];
  pendingPrompts: PendingPrompt[];
  auditEvents: AuditEvent[];
  status: ProjectDerivedStatus;
} | undefined {
  const goals = listGoalsWithPlans(runtime).filter(({ goal }) => projectMatches(goal, projectKey));
  const reviews = runtime.pendingReviewStore.list().filter((review) => projectMatches(review, projectKey));
  const pendingPrompts = runtime.pendingPromptStore.listPrompts().filter((prompt) => projectMatches(prompt, projectKey));
  const summary = buildProjectSummaries(runtime).find((item) => item.project.key === projectKey);
  if (!summary) {
    return undefined;
  }

  // Collect all record identifiers used in audit event filtering.
  // Both Goal, AgentReviewRequest, and PendingPrompt each have an identifier
  // that matches audit events' packetId field:
  //   - Goal.id → used as packetId in goal-related audit events
  //   - Review.packetId → used as packetId in review-related audit events
  //   - PendingPrompt.packetId → used as packetId in prompt-related audit events
  // Using these ids (rather than sessionId) prevents cross-project leakage
  // when two projects share a sessionId.
  const scopedRecordIds = new Set<string>();
  for (const { goal } of goals) scopedRecordIds.add(goal.id);
  for (const review of reviews) scopedRecordIds.add(review.packetId);
  for (const prompt of pendingPrompts) scopedRecordIds.add(prompt.packetId);
  const auditEvents = runtime.auditLog.listEvents()
    .filter((event) => {
      if (event.projectId) return event.projectId === projectKey;
      return event.packetId ? scopedRecordIds.has(event.packetId) : false;
    });

  // Status panel memory uses the same project-scoped derived-memory source as
  // GET /bridge/projects/:key/memory (read-only, deterministic). Capped to keep
  // the project-detail payload compact; the full view remains on the memory
  // endpoint.
  const obsInput = buildObservabilityInput(runtime, projectKey);
  const derivedMemory = obsInput
    ? buildDerivedMemory(obsInput).entries.slice(0, STATUS_MEMORY_LIMIT)
    : [];

  return {
    summary,
    goals,
    reviews,
    pendingPrompts,
    auditEvents,
    status: buildProjectStatus(goals, auditEvents, derivedMemory),
  };
}

/** Safely decode a project path segment. Returns undefined on malformed encoding. */
function decodeProjectPathSegment(raw: string): string | undefined {
  try {
    return decodeURIComponent(raw);
  } catch {
    return undefined;
  }
}

function projectDetailPathKey(pathname: string): string | undefined {
  const prefix = `${BRIDGE_PROJECTS_PATH}/`;
  if (!pathname.startsWith(prefix)) {
    return undefined;
  }
  const raw = pathname.slice(prefix.length);
  if (raw.length === 0 || raw.includes('/')) {
    return undefined;
  }
  const decoded = decodeProjectPathSegment(raw);
  return decoded ? (validateProjectKey(decoded) ?? undefined) : undefined;
}

function projectActionPathKey(
  pathname: string,
  action: 'archive' | 'unarchive' | 'team-preset',
): { matched: true; key: string | undefined } | { matched: false } {
  const prefix = `${BRIDGE_PROJECTS_PATH}/`;
  const suffix = `/${action}`;
  if (!pathname.startsWith(prefix) || !pathname.endsWith(suffix)) {
    return { matched: false };
  }
  const raw = pathname.slice(prefix.length, -suffix.length);
  if (raw.length === 0 || raw.includes('/')) {
    return { matched: false };
  }
  const decoded = decodeProjectPathSegment(raw);
  return { matched: true, key: decoded ? (validateProjectKey(decoded) ?? undefined) : undefined };
}

/** Gathers all project-scoped data into an ObservabilityInput for the builders. */
function buildObservabilityInput(
  runtime: BridgeRuntime,
  projectKey: string,
): ObservabilityInput | undefined {
  const summary = buildProjectSummaries(runtime).find(s => s.project.key === projectKey);
  if (!summary) return undefined;

  const goals = runtime.goalStore.listGoals()
    .filter(g => projectMatches({ projectId: g.projectId }, projectKey))
    .map(g => ({
      id: g.id, projectId: g.projectId, description: g.description,
      status: g.status, createdAt: g.createdAt, updatedAt: g.updatedAt,
    }));

  const plans = goals
    .map(g => runtime.goalStore.getPlanByGoal(g.id))
    .filter((p): p is NonNullable<typeof p> => !!p)
    .map(p => ({
      id: p.id, goalId: p.goalId,
      steps: p.steps.map(s => ({
        id: s.id, index: s.index, intent: s.intent, kind: s.kind,
        status: s.status, isStateMutating: s.isStateMutating,
      })),
      status: p.status,
    }));

  const reviews = runtime.pendingReviewStore.list()
    .filter(r => projectMatches({ projectId: r.projectId }, projectKey))
    .map(r => ({
      id: r.id, packetId: r.packetId, projectId: r.projectId, prompt: r.prompt,
      status: r.status, createdAt: r.createdAt, updatedAt: r.updatedAt,
    }));

  const pendingPrompts = runtime.pendingPromptStore.listPrompts()
    .filter(p => projectMatches({ projectId: p.projectId }, projectKey))
    .map(p => ({
      packetId: p.packetId, projectId: p.projectId, prompt: p.prompt,
      status: p.status, createdAt: p.createdAt,
    }));

  const scopedRecordIds = new Set<string>();
  for (const g of goals) scopedRecordIds.add(g.id);
  for (const r of reviews) scopedRecordIds.add(r.packetId);
  for (const p of pendingPrompts) scopedRecordIds.add(p.packetId);
  const auditEvents = runtime.auditLog.listEvents()
    .filter(e => {
      if (e.projectId) return e.projectId === projectKey;
      return e.packetId ? scopedRecordIds.has(e.packetId) : false;
    })
    .map(e => ({
      id: e.id, projectId: e.projectId, type: e.type,
      source: e.source, target: e.target, timestamp: e.timestamp,
      ok: e.result?.ok,
    }));

  const teams = runtime.teamStore.listByProject(projectKey).map(team => ({
    id: team.id,
    projectId: team.projectId,
    planId: team.planId,
    logicalSlots: team.logicalSlots.map(slot => ({
      id: slot.id,
      stepIndex: slot.stepIndex,
      status: slot.status,
    })),
  }));
  const projectTeamIds = new Set(teams.map(team => team.id));
  const artifacts = teams
    .flatMap(team => runtime.teamStore.listArtifacts(team.id))
    .filter(artifact => projectTeamIds.has(artifact.teamId))
    .map(artifact => ({
      teamId: artifact.teamId,
      slotId: artifact.slotId,
      planStepId: artifact.planStepId,
      summary: artifact.summary,
      verificationNotes: artifact.verificationNotes,
      verificationEvidence: artifact.verificationEvidence,
      createdAt: artifact.createdAt,
    }));

  return {
    projectId: projectKey,
    goals,
    plans,
    reviews,
    pendingPrompts,
    auditEvents,
    teams,
    artifacts,
  };
}

export async function readJsonBody(request: IncomingMessage): Promise<
  { ok: true; body: Record<string, unknown> } | { ok: false; message: string }
> {
  const chunks: Buffer[] = [];
  let total = 0;

  for await (const chunk of request) {
    const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
    total += buffer.length;
    if (total > MAX_BODY_BYTES) {
      return { ok: false, message: 'Request body too large' };
    }
    chunks.push(buffer);
  }

  if (chunks.length === 0) {
    return { ok: true, body: {} };
  }

  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (text.length === 0) {
    return { ok: true, body: {} };
  }

  try {
    const parsed = JSON.parse(text);
    if (!isRecord(parsed)) {
      return { ok: false, message: 'Request body must be a JSON object' };
    }
    return { ok: true, body: parsed };
  } catch {
    return { ok: false, message: 'Malformed JSON request body' };
  }
}

function recordReasoningArtifactOrPause(
  runtime: BridgeRuntime,
  input: {
    planId: string;
    endpointId?: string;
    kind: ReasoningArtifactKind;
    content: unknown;
    summary: string;
    source: 'generic' | 'chatgpt-web';
  },
): { ok: true; artifact: ReturnType<InMemoryReasoningArtifactStore['record']> } | { ok: false; message: string } {
  const binding = runtime.automationBindingStore.getBinding(input.planId);
  const plan = runtime.goalStore.getPlanById(input.planId);
  if (!binding || !plan) {
    return { ok: false, message: 'reasoning-artifact-correlation-missing' };
  }
  const result = input.source === 'chatgpt-web'
    ? normalizeChatGptReturnArtifact({
      binding,
      plan,
      endpointId: input.endpointId ?? binding.reasoningEndpointId,
      kind: input.kind,
      sanitizedContent: input.content,
      summary: input.summary,
    })
    : normalizeReasoningArtifact({
      binding,
      plan,
      endpointId: input.endpointId ?? binding.reasoningEndpointId,
      kind: input.kind,
      content: input.content,
      summary: input.summary,
    });
  if (!result.ok) {
    runtime.goalStore.pausePlan(binding.goalId, result.failureReason);
    return { ok: false, message: result.failureReason };
  }
  return { ok: true, artifact: runtime.reasoningArtifactStore.record(result.artifact) };
}

export const BRIDGE_PACKETS_PATH = '/bridge/packets';
export const BRIDGE_PENDING_PROMPTS_PATH = '/bridge/pending-prompts';
export const BRIDGE_PENDING_PROMPTS_CONFIRM_PATH = '/bridge/pending-prompts/confirm';
export const BRIDGE_PENDING_PROMPTS_SEND_PATH = '/bridge/pending-prompts/send';
export const BRIDGE_PENDING_PROMPTS_CANCEL_PATH = '/bridge/pending-prompts/cancel';
export const BRIDGE_OUTBOUND_PATH = '/bridge/outbound';
export const BRIDGE_OUTBOUND_NEXT_PATH = '/bridge/outbound/next';
export const BRIDGE_OUTBOUND_ACK_PATH = '/bridge/outbound/ack';
export const BRIDGE_OUTBOUND_CANCEL_PATH = '/bridge/outbound/cancel';
export const BRIDGE_OUTBOUND_STATUS_PATH = '/bridge/outbound/status';
export const BRIDGE_OUTBOUND_REPORT_PATH = '/bridge/outbound/report';
export const BRIDGE_OUTBOUND_STAGE_PATH = '/bridge/outbound/stage';
export const BRIDGE_LOOPS_PATH = '/bridge/loops';
export const BRIDGE_LOOPS_ADVANCE_PATH = '/bridge/loops/advance';
export const BRIDGE_LOOPS_PAUSE_PATH = '/bridge/loops/pause';
export const BRIDGE_LOOPS_RESUME_PATH = '/bridge/loops/resume';
export const BRIDGE_LOOPS_CANCEL_PATH = '/bridge/loops/cancel';
export const BRIDGE_LOOPS_REPORT_PATH = '/bridge/loops/report';
// Phase 3 multi-executor relay (inbound queue core).
export const BRIDGE_INBOUND_PATH = '/bridge/inbound';
export const BRIDGE_INBOUND_NEXT_PATH = '/bridge/inbound/next';
export const BRIDGE_INBOUND_ACK_PATH = '/bridge/inbound/ack';
export const BRIDGE_INBOUND_CANCEL_PATH = '/bridge/inbound/cancel';
// Phase 3 extract→inbound routing policy (extract-return).
export const BRIDGE_EXTRACT_RETURN_PATH = '/bridge/extract-return';
export const BRIDGE_REVIEWS_PATH = '/bridge/reviews';
export const BRIDGE_REVIEWS_CONFIRM_PATH = '/bridge/reviews/confirm';
export const BRIDGE_REVIEWS_RUN_PATH = '/bridge/reviews/dispatch';
export const BRIDGE_REVIEWS_CANCEL_PATH = '/bridge/reviews/cancel';
export const BRIDGE_METRICS_PATH = '/bridge/metrics';
export const BRIDGE_PROJECTS_PATH = '/bridge/projects';

// v2.0 Goal-driven execution endpoints (ADR-0003 §7.4).
export const BRIDGE_GOALS_PATH = '/bridge/goals';
export const BRIDGE_GOALS_PLAN_PATH = '/bridge/goals/plan';
export const BRIDGE_GOALS_APPROVE_PATH = '/bridge/goals/approve';
export const BRIDGE_GOALS_STEP_PATH = '/bridge/goals/step';
export const BRIDGE_GOALS_GATE_PATH = '/bridge/goals/gate';
export const BRIDGE_GOALS_CANCEL_PATH = '/bridge/goals/cancel';
// EX-3: Goal binding snapshot routes.
export const BRIDGE_GOALS_BINDING_PATH = '/bridge/goals/binding';
export const BRIDGE_GOALS_REBIND_PATH = '/bridge/goals/rebind';
export const BRIDGE_AUTOMATION_BINDINGS_PATH = '/bridge/automation/bindings';
export const BRIDGE_AUTOMATION_BINDINGS_DERIVE_PATH = '/bridge/automation/bindings/derive';
export const BRIDGE_EXECUTION_PROPOSALS_PATH = '/bridge/execution-proposals';
export const BRIDGE_EXECUTION_PROPOSALS_CONFIRM_PATH = '/bridge/execution-proposals/confirm';
export const BRIDGE_EXECUTION_PROPOSALS_DISPATCH_PATH = '/bridge/execution-proposals/dispatch';
export const BRIDGE_EXECUTION_PROPOSALS_EDIT_PATH = '/bridge/execution-proposals/edit';
export const BRIDGE_EXECUTION_PROPOSALS_PAUSE_PATH = '/bridge/execution-proposals/pause';
export const BRIDGE_EXECUTION_PROPOSALS_RESUME_PATH = '/bridge/execution-proposals/resume';
export const BRIDGE_EXECUTION_PROPOSALS_CANCEL_PATH = '/bridge/execution-proposals/cancel';

// v2.x Endpoint session registry (EX-1: registration, heartbeat, discovery, offline).
export const BRIDGE_ENDPOINTS_PATH = '/bridge/endpoints';

// v2.1 Read-only project observability endpoints.
export const BRIDGE_PROJECT_TIMELINE_SUFFIX = '/timeline';
export const BRIDGE_PROJECT_AUDIT_SUFFIX = '/audit';
export const BRIDGE_PROJECT_MEMORY_SUFFIX = '/memory';
export const BRIDGE_PROJECT_VERIFICATION_SUFFIX = '/verification';
// v2.13: live verification sub-routes
export const BRIDGE_PROJECT_VERIFICATION_PROFILES_SUFFIX = '/verification/profiles';
export const BRIDGE_PROJECT_VERIFICATION_CONFIRM_SUFFIX = '/verification/confirm';
// v2.14 ADR-0019-a: read-only local git status
export const BRIDGE_PROJECT_VERIFICATION_GIT_STATUS_SUFFIX = '/verification/git-status';
// v2.14 ADR-0019-b: remote github checks confirm
export const BRIDGE_PROJECT_VERIFICATION_GITHUB_CHECKS_CONFIRM_SUFFIX = '/verification/github-checks/confirm';

// v2.2 WorkBuddy non-executing task system project-scoped path.
export const BRIDGE_PROJECT_WORKBUDDY_SUFFIX = '/workbuddy';
// v2.3 AgentTeam project-scoped path.
export const BRIDGE_PROJECT_TEAMS_SUFFIX = '/teams';

  /** Matches /bridge/projects/:key/{timeline|audit|memory|verification}. */
function matchProjectObservabilityPath(pathname: string): {
  matched: true; key: string | undefined; sub: string;
} | { matched: false } {
  const prefix = `${BRIDGE_PROJECTS_PATH}/`;
  if (!pathname.startsWith(prefix)) return { matched: false };
  const rest = pathname.slice(prefix.length);
  for (const sub of [BRIDGE_PROJECT_TIMELINE_SUFFIX, BRIDGE_PROJECT_AUDIT_SUFFIX,
    BRIDGE_PROJECT_MEMORY_SUFFIX, BRIDGE_PROJECT_VERIFICATION_SUFFIX,
    BRIDGE_PROJECT_VERIFICATION_PROFILES_SUFFIX, BRIDGE_PROJECT_VERIFICATION_CONFIRM_SUFFIX,
    BRIDGE_PROJECT_VERIFICATION_GIT_STATUS_SUFFIX,
    BRIDGE_PROJECT_VERIFICATION_GITHUB_CHECKS_CONFIRM_SUFFIX]) {
    if (rest.endsWith(sub)) {
      const raw = rest.slice(0, -sub.length);
      if (raw.length === 0 || raw.includes('/')) continue;
      let decoded: string | undefined;
      try { decoded = decodeURIComponent(raw); } catch {
        // Malformed encoding — treat as matched but invalid key → 400.
        return { matched: true, key: undefined, sub };
      }
      const key = decoded ? (validateProjectKey(decoded) ?? undefined) : undefined;
      return { matched: true, key, sub };
    }
  }
  return { matched: false };
}

/**
 * Match `/bridge/endpoints/:id/(heartbeat|offline)`.
 * Returns { matched: true, id, action } or { matched: false }.
 */
function matchEndpointAction(
  pathname: string,
  action: 'heartbeat' | 'offline',
): { matched: true; id: string } | { matched: false } {
  const prefix = `${BRIDGE_ENDPOINTS_PATH}/`;
  const suffix = `/${action}`;
  if (!pathname.startsWith(prefix) || !pathname.endsWith(suffix)) return { matched: false };
  const raw = pathname.slice(prefix.length, -suffix.length);
  if (raw.length === 0 || raw.includes('/')) return { matched: false };
  let decoded: string | undefined;
  try { decoded = decodeURIComponent(raw); } catch {
    return { matched: true, id: '' };
  }
  return { matched: true, id: decoded.trim() };
}

/**
 * Match `/bridge/endpoints/:id/:subPath`.
 */
function matchEndpointSubPath(
  pathname: string,
  subPath: string,
): { matched: true; id: string } | { matched: false } {
  const prefix = `${BRIDGE_ENDPOINTS_PATH}/`;
  const suffix = `/${subPath}`;
  if (!pathname.startsWith(prefix) || !pathname.endsWith(suffix)) return { matched: false };
  const raw = pathname.slice(prefix.length, -suffix.length);
  if (raw.length === 0 || raw.includes('/')) return { matched: false };
  let decoded: string | undefined;
  try { decoded = decodeURIComponent(raw); } catch {
    return { matched: true, id: '' };
  }
  return { matched: true, id: decoded.trim() };
}

export function isBridgePath(pathname: string): boolean {
  return pathname === BRIDGE_PACKETS_PATH ||
    pathname === BRIDGE_PENDING_PROMPTS_PATH ||
    pathname === BRIDGE_PENDING_PROMPTS_CONFIRM_PATH ||
    pathname === BRIDGE_PENDING_PROMPTS_SEND_PATH ||
    pathname === BRIDGE_PENDING_PROMPTS_CANCEL_PATH ||
    pathname === BRIDGE_OUTBOUND_PATH ||
    pathname === BRIDGE_OUTBOUND_NEXT_PATH ||
    pathname === BRIDGE_OUTBOUND_ACK_PATH ||
    pathname === BRIDGE_OUTBOUND_CANCEL_PATH ||
    pathname === BRIDGE_OUTBOUND_STATUS_PATH ||
    pathname === BRIDGE_OUTBOUND_REPORT_PATH ||
    pathname === BRIDGE_OUTBOUND_STAGE_PATH ||
    pathname === BRIDGE_LOOPS_PATH ||
    pathname === BRIDGE_LOOPS_ADVANCE_PATH ||
    pathname === BRIDGE_LOOPS_PAUSE_PATH ||
    pathname === BRIDGE_LOOPS_RESUME_PATH ||
    pathname === BRIDGE_LOOPS_CANCEL_PATH ||
    pathname === BRIDGE_LOOPS_REPORT_PATH ||
    pathname === BRIDGE_INBOUND_PATH ||
    pathname === BRIDGE_INBOUND_NEXT_PATH ||
    pathname === BRIDGE_INBOUND_ACK_PATH ||
    pathname === BRIDGE_INBOUND_CANCEL_PATH ||
    pathname === BRIDGE_EXTRACT_RETURN_PATH ||
    pathname === BRIDGE_REVIEWS_PATH ||
    pathname === BRIDGE_REVIEWS_CONFIRM_PATH ||
    pathname === BRIDGE_REVIEWS_RUN_PATH ||
    pathname === BRIDGE_REVIEWS_CANCEL_PATH ||
    pathname === BRIDGE_METRICS_PATH ||
    pathname === BRIDGE_PROJECTS_PATH ||
    pathname.startsWith(`${BRIDGE_PROJECTS_PATH}/`) ||
    pathname === BRIDGE_GOALS_PLAN_PATH ||
    pathname === BRIDGE_GOALS_APPROVE_PATH ||
    pathname === BRIDGE_GOALS_STEP_PATH ||
    pathname === BRIDGE_GOALS_GATE_PATH ||
    pathname === BRIDGE_GOALS_CANCEL_PATH ||
    pathname === BRIDGE_AUTOMATION_BINDINGS_PATH ||
    pathname === BRIDGE_AUTOMATION_BINDINGS_DERIVE_PATH ||
    pathname === BRIDGE_EXECUTION_PROPOSALS_PATH ||
    pathname === BRIDGE_EXECUTION_PROPOSALS_CONFIRM_PATH ||
    pathname === BRIDGE_EXECUTION_PROPOSALS_DISPATCH_PATH ||
    pathname === BRIDGE_EXECUTION_PROPOSALS_EDIT_PATH ||
    pathname === BRIDGE_EXECUTION_PROPOSALS_PAUSE_PATH ||
    pathname === BRIDGE_EXECUTION_PROPOSALS_RESUME_PATH ||
    pathname === BRIDGE_EXECUTION_PROPOSALS_CANCEL_PATH ||
    pathname === BRIDGE_GOALS_PATH ||
    (typeof pathname === 'string' && pathname === BRIDGE_ENDPOINTS_PATH) ||
    (typeof pathname === 'string' && pathname.startsWith(`${BRIDGE_ENDPOINTS_PATH}/`));
}

export async function handleBridgeRequest(
  runtime: BridgeRuntime,
  method: string,
  pathname: string,
  request: IncomingMessage,
  query?: URLSearchParams,
): Promise<BridgeResult> {
  if (!query && pathname.includes('?')) {
    const parsedPath = new URL(`http://cli-bridge.local${pathname}`);
    pathname = parsedPath.pathname;
    query = parsedPath.searchParams;
  }
  if (runtime.getPersistenceFailure()) {
    return error(503, 'Runtime persistence fault; restart after repairing storage');
  }
  if (pathname === BRIDGE_PACKETS_PATH && method === 'GET') {
    return ok({ packets: runtime.packetStore.listPackets() });
  }

  if (pathname === BRIDGE_PACKETS_PATH && method === 'POST') {
    const parsed = await readJsonBody(request);
    if (!parsed.ok) {
      return error(400, parsed.message);
    }
    const sessionId = requireString(parsed.body, 'sessionId');
    const content = requireString(parsed.body, 'content');
    if (!sessionId || !content) {
      return error(400, 'sessionId and content are required');
    }
    const packet = runtime.packetStore.createPacket({
      sessionId,
      source: 'codex',
      target: 'chatgpt-web',
      kind: 'cli-output-review',
      rawContent: content,
    });
    runtime.persist();
    return created({ packet });
  }

  if (pathname === BRIDGE_PENDING_PROMPTS_PATH && method === 'GET') {
    return ok({ pendingPrompts: runtime.pendingPromptStore.listPrompts() });
  }

  if (pathname === BRIDGE_OUTBOUND_PATH && method === 'GET') {
    return ok({ outboundPrompts: runtime.outboundPromptStore.listPrompts() });
  }

  if (pathname === BRIDGE_OUTBOUND_STATUS_PATH && method === 'GET') {
    return ok({ outboundStatus: runtime.outboundPromptStore.createStatusView() });
  }

  if (pathname === BRIDGE_OUTBOUND_REPORT_PATH && method === 'GET') {
    return ok({ outboundReport: runtime.outboundPromptStore.createAcceptanceReport() });
  }

  if (pathname === BRIDGE_OUTBOUND_PATH && method === 'POST') {
    const parsed = await readJsonBody(request);
    if (!parsed.ok) {
      return error(400, parsed.message);
    }
    const sessionId = requireString(parsed.body, 'sessionId');
    const prompt = requireString(parsed.body, 'prompt');
    if (!sessionId || !prompt) {
      return error(400, 'sessionId and prompt are required');
    }
    if (Object.prototype.hasOwnProperty.call(parsed.body, 'endpointId')) {
      return error(400, 'endpointId is server-owned and must not be supplied');
    }
    const outboundPrompt = runtime.outboundPromptStore.createOutboundPrompt({
      sessionId,
      prompt,
      endpointId: runtime.inboundRelayEndpointId,
    });
    runtime.persist();
    return created({ outboundPrompt });
  }

  if (pathname === BRIDGE_OUTBOUND_NEXT_PATH && method === 'GET') {
    const outboundPrompt = runtime.outboundPromptStore.claimNext();
    runtime.persist();
    return ok({ outboundPrompt: outboundPrompt ?? null });
  }

  if (pathname === BRIDGE_OUTBOUND_ACK_PATH && method === 'POST') {
    const parsed = await readJsonBody(request);
    if (!parsed.ok) {
      return error(400, parsed.message);
    }
    const outboundPromptId = requireString(parsed.body, 'outboundPromptId');
    const claimToken = requireString(parsed.body, 'claimToken');
    const okValue = parsed.body.ok;
    if (!outboundPromptId || !claimToken || typeof okValue !== 'boolean') {
      return error(400, 'outboundPromptId, claimToken and ok are required');
    }
    const failureReason = typeof parsed.body.failureReason === 'string'
      ? parsed.body.failureReason
      : undefined;
    const outboundPrompt = runtime.outboundPromptStore.acknowledge({
      id: outboundPromptId,
      claimToken,
      ok: okValue,
      failureReason,
    });
    if (!outboundPrompt) {
      return error(409, 'Outbound prompt cannot be acknowledged');
    }
    // Phase 3 relay (foundation): only a delivered outbound carrying an
    // endpointId establishes a routing context. ack failures and
    // endpointId-less outbounds never write a relay context.
    if (outboundPrompt.status === 'waiting_manual_send' && outboundPrompt.endpointId) {
      runtime.relayContextStore.recordDelivered(
        outboundPrompt.sessionId,
        outboundPrompt.endpointId,
        outboundPrompt.id,
      );
    }
    runtime.persist();
    return ok({ outboundPrompt });
  }

  if (pathname === BRIDGE_OUTBOUND_CANCEL_PATH && method === 'POST') {
    const parsed = await readJsonBody(request);
    if (!parsed.ok) {
      return error(400, parsed.message);
    }
    const outboundPromptId = requireString(parsed.body, 'outboundPromptId');
    if (!outboundPromptId) {
      return error(400, 'outboundPromptId is required');
    }
    const outboundPrompt = runtime.outboundPromptStore.cancel(outboundPromptId);
    if (!outboundPrompt) {
      return error(409, 'Outbound prompt cannot be cancelled');
    }
    runtime.persist();
    return ok({ outboundPrompt });
  }

  if (pathname === BRIDGE_OUTBOUND_STAGE_PATH && method === 'POST') {
    const parsed = await readJsonBody(request);
    if (!parsed.ok) {
      return error(400, parsed.message);
    }
    const outboundPromptId = requireString(parsed.body, 'outboundPromptId');
    const stage = requireString(parsed.body, 'stage');
    if (!outboundPromptId || !stage) {
      return error(400, 'outboundPromptId and stage are required');
    }
    let outboundPrompt;
    if (stage === 'submitted') {
      outboundPrompt = runtime.outboundPromptStore.markSubmitted(outboundPromptId);
    } else if (stage === 'responding') {
      outboundPrompt = runtime.outboundPromptStore.markResponding(outboundPromptId);
    } else if (stage === 'response-ready') {
      outboundPrompt = runtime.outboundPromptStore.markResponseReady(outboundPromptId);
    } else if (stage === 'returned') {
      outboundPrompt = runtime.outboundPromptStore.markReturned(outboundPromptId);
    } else if (stage === 'failed') {
      const failureReason = requireString(parsed.body, 'failureReason') ?? 'stage-b-failed';
      outboundPrompt = runtime.outboundPromptStore.markFailed(outboundPromptId, failureReason);
    } else {
      return error(400, 'unsupported outbound stage');
    }
    if (!outboundPrompt) {
      return error(409, 'Outbound prompt cannot transition to requested stage');
    }
    runtime.persist();
    return ok({ outboundPrompt });
  }

  if (pathname === BRIDGE_LOOPS_PATH && method === 'GET') {
    return ok({ loops: runtime.webRelayLoopStore.createAcceptanceReport().loops });
  }

  if (pathname === BRIDGE_LOOPS_REPORT_PATH && method === 'GET') {
    return ok({ loopReport: runtime.webRelayLoopStore.createAcceptanceReport() });
  }

  if (pathname === BRIDGE_LOOPS_PATH && method === 'POST') {
    const parsed = await readJsonBody(request);
    if (!parsed.ok) return error(400, parsed.message);
    const sessionId = requireString(parsed.body, 'sessionId');
    const projectId = requireString(parsed.body, 'projectId');
    const goalId = requireString(parsed.body, 'goalId');
    const initialPrompt = requireString(parsed.body, 'initialPrompt');
    if (!sessionId || !projectId || !goalId || !initialPrompt) {
      return error(400, 'sessionId, projectId, goalId and initialPrompt are required');
    }
    const result = runtime.webRelayLoopStore.create({
      sessionId,
      projectId,
      goalId,
      initialPrompt,
      endpointId: runtime.inboundRelayEndpointId ?? 'mock-inbound-agent',
      maxRounds: typeof parsed.body.maxRounds === 'number' ? parsed.body.maxRounds : undefined,
      perRoundTimeoutMs: typeof parsed.body.perRoundTimeoutMs === 'number' ? parsed.body.perRoundTimeoutMs : undefined,
      totalDeadlineMs: typeof parsed.body.totalDeadlineMs === 'number' ? parsed.body.totalDeadlineMs : undefined,
      noProgressLimit: typeof parsed.body.noProgressLimit === 'number' ? parsed.body.noProgressLimit : undefined,
    });
    if (result.error || !result.loop || !result.outboundPrompt) {
      return error(400, result.error ?? 'Loop could not be created');
    }
    runtime.persist();
    return created({ loop: result.loop, outboundPrompt: result.outboundPrompt });
  }

  if (pathname === BRIDGE_LOOPS_ADVANCE_PATH && method === 'POST') {
    const parsed = await readJsonBody(request);
    if (!parsed.ok) return error(400, parsed.message);
    const loopId = requireString(parsed.body, 'loopId');
    const inboundContent = requireString(parsed.body, 'inboundContent');
    if (!loopId || !inboundContent) {
      return error(400, 'loopId and inboundContent are required');
    }
    const result = runtime.webRelayLoopStore.advance({
      loopId,
      inboundContent,
      progressHash: typeof parsed.body.progressHash === 'string' ? parsed.body.progressHash : undefined,
      nextPrompt: typeof parsed.body.nextPrompt === 'string' ? parsed.body.nextPrompt : undefined,
    });
    if (result.error && !result.loop) return error(409, result.error);
    runtime.persist();
    return ok({
      loop: result.loop,
      outboundPrompt: result.outboundPrompt ?? null,
      stopped: !result.outboundPrompt,
      error: result.error,
    });
  }

  if (
    pathname === BRIDGE_LOOPS_PAUSE_PATH ||
    pathname === BRIDGE_LOOPS_RESUME_PATH ||
    pathname === BRIDGE_LOOPS_CANCEL_PATH
  ) {
    if (method !== 'POST') return error(405, 'Method not allowed');
    const parsed = await readJsonBody(request);
    if (!parsed.ok) return error(400, parsed.message);
    const loopId = requireString(parsed.body, 'loopId');
    if (!loopId) return error(400, 'loopId is required');
    const loop = pathname === BRIDGE_LOOPS_PAUSE_PATH
      ? runtime.webRelayLoopStore.pause(loopId)
      : pathname === BRIDGE_LOOPS_RESUME_PATH
        ? runtime.webRelayLoopStore.resume(loopId)
        : runtime.webRelayLoopStore.cancel(loopId);
    if (!loop) return error(409, 'Loop cannot transition to requested state');
    runtime.persist();
    return ok({ loop });
  }

  // ── Phase 3 multi-executor relay: inbound return queue ──

  if (pathname === BRIDGE_INBOUND_PATH && method === 'GET') {
    const endpointId = query?.get('endpointId') ?? '';
    if (!endpointId) {
      return error(400, 'endpointId is required');
    }
    const sessionId = query?.get('sessionId') || undefined;
    return ok({
      inboundMessages: runtime.inboundMessageStore.list({ endpointId, sessionId }),
    });
  }

  if (pathname === BRIDGE_INBOUND_PATH && method === 'POST') {
    const parsed = await readJsonBody(request);
    if (!parsed.ok) {
      return error(400, parsed.message);
    }
    const sessionId = requireString(parsed.body, 'sessionId');
    const content = requireString(parsed.body, 'content');
    if (!sessionId || !content) {
      return error(400, 'sessionId and content are required');
    }
    // endpointId is NEVER trusted from the request body; it is resolved from the
    // server-side relay context for this session.
    const endpointId = runtime.relayContextStore.resolveInboundEndpointForSession(sessionId);
    if (!endpointId) {
      return error(409, 'no relay context for session; cannot route inbound');
    }
    if (!runtime.endpointRegistry.can(endpointId, 'receive-inbound')) {
      return error(403, 'resolved endpoint cannot receive inbound');
    }
    const sourceOutboundPromptId = typeof parsed.body.sourceOutboundPromptId === 'string'
      ? parsed.body.sourceOutboundPromptId
      : undefined;
    const inboundMessage = runtime.inboundMessageStore.create({
      endpointId,
      sessionId,
      content,
      source: 'chatgpt-web-extract',
      sourceOutboundPromptId,
    });
    runtime.persist();
    return created({ inboundMessage });
  }

  if (pathname === BRIDGE_INBOUND_NEXT_PATH && method === 'GET') {
    const endpointId = query?.get('endpointId') ?? '';
    if (!endpointId) {
      return error(400, 'endpointId is required');
    }
    const sessionId = query?.get('sessionId') || undefined;
    const inboundMessage = runtime.inboundMessageStore.claimNext({ endpointId, sessionId });
    runtime.persist();
    return ok({ inboundMessage: inboundMessage ?? null });
  }

  if (pathname === BRIDGE_INBOUND_ACK_PATH && method === 'POST') {
    const parsed = await readJsonBody(request);
    if (!parsed.ok) {
      return error(400, parsed.message);
    }
    const inboundMessageId = requireString(parsed.body, 'inboundMessageId');
    const endpointId = requireString(parsed.body, 'endpointId');
    const okValue = parsed.body.ok;
    if (!inboundMessageId || !endpointId || typeof okValue !== 'boolean') {
      return error(400, 'inboundMessageId, endpointId and ok are required');
    }
    const failureReason = typeof parsed.body.failureReason === 'string'
      ? parsed.body.failureReason
      : undefined;
    const result = runtime.inboundMessageStore.ack({
      inboundMessageId,
      endpointId,
      ok: okValue,
      failureReason,
    });
    if (!result.ok) {
      if (result.failureReason === 'not-found') {
        return error(404, 'inbound message not found');
      }
      if (result.failureReason === 'endpoint-mismatch') {
        return error(403, 'endpoint does not own this inbound message');
      }
      return error(409, 'inbound message cannot be acknowledged');
    }
    runtime.persist();
    return ok({ inboundMessage: result.message });
  }

  if (pathname === BRIDGE_INBOUND_CANCEL_PATH && method === 'POST') {
    const parsed = await readJsonBody(request);
    if (!parsed.ok) {
      return error(400, parsed.message);
    }
    const inboundMessageId = requireString(parsed.body, 'inboundMessageId');
    const endpointId = requireString(parsed.body, 'endpointId');
    if (!inboundMessageId || !endpointId) {
      return error(400, 'inboundMessageId and endpointId are required');
    }
    const result = runtime.inboundMessageStore.cancel({ inboundMessageId, endpointId });
    if (!result.ok) {
      if (result.failureReason === 'not-found') {
        return error(404, 'inbound message not found');
      }
      if (result.failureReason === 'endpoint-mismatch') {
        return error(403, 'endpoint does not own this inbound message');
      }
      return error(409, 'inbound message cannot be cancelled');
    }
    runtime.persist();
    return ok({ inboundMessage: result.message });
  }

  // ── Phase 3 extract→inbound routing policy ──
  // The extension's "extract" result is routed here. The server resolves the
  // target endpoint from the session's relay context (never from the request
  // body). When it cannot safely route to an inbound-capable endpoint, it
  // degrades to the existing pending-prompt path so the v0.2 manual loop never
  // regresses.
  if (pathname === BRIDGE_EXTRACT_RETURN_PATH && method === 'POST') {
    const parsed = await readJsonBody(request);
    if (!parsed.ok) {
      return error(400, parsed.message);
    }
    const sessionId = requireString(parsed.body, 'sessionId');
    const content = requireString(parsed.body, 'content');
    if (!sessionId || !content) {
      return error(400, 'sessionId and content are required');
    }
    const automationPlanId = typeof parsed.body.planId === 'string' ? parsed.body.planId : undefined;
    const artifactKind = typeof parsed.body.artifactKind === 'string'
      ? parsed.body.artifactKind as ReasoningArtifactKind
      : 'review-result';
    const artifactSummary = typeof parsed.body.summary === 'string'
      ? parsed.body.summary
      : 'ChatGPT Web return';
    const recordChatGptArtifact = (): ReturnType<InMemoryReasoningArtifactStore['record']> | null | BridgeResult => {
      if (!automationPlanId) return null;
      const normalized = recordReasoningArtifactOrPause(runtime, {
        planId: automationPlanId,
        kind: artifactKind,
        content: redactSensitiveContent(content).processedContent,
        summary: artifactSummary,
        source: 'chatgpt-web',
      });
      if (!normalized.ok) {
        runtime.persist();
        return error(409, normalized.message);
      }
      return normalized.artifact;
    };

    const relayContext = runtime.relayContextStore.getRelayContext(sessionId);
    const endpointId = relayContext?.endpointId;
    if (endpointId && runtime.endpointRegistry.can(endpointId, 'receive-inbound')) {
      const operationId = requireString(parsed.body, 'operationId');
      if (!operationId || operationId !== relayContext.lastOutboundPromptId) {
        return error(409, 'operationId does not match the delivered outbound prompt');
      }
      const reasoningArtifact = recordChatGptArtifact();
      if (reasoningArtifact && 'statusCode' in reasoningArtifact) return reasoningArtifact;
      const creation = runtime.inboundMessageStore.createIdempotent({
        endpointId,
        sessionId,
        content,
        source: 'chatgpt-web-extract',
        sourceOutboundPromptId: operationId,
      });
      if (creation.conflict) {
        return error(409, 'operationId was already used with different return content');
      }
      const inboundMessage = creation.message;
      if (creation.replayed) {
        return ok({ routedTo: 'inbound', inboundMessage, replayed: true, artifact: reasoningArtifact });
      }
      runtime.auditLog.createAndAppend({
        sessionId,
        packetId: inboundMessage.packetId,
        approvalId: inboundMessage.id,
        type: 'extract_return_routed_inbound',
        source: 'chatgpt-web',
        target: endpointId,
        result: { ok: true },
      });
      runtime.persist();
      return created({ routedTo: 'inbound', inboundMessage, replayed: false, artifact: reasoningArtifact });
    }

    const fallbackReason = endpointId
      ? 'endpoint-cannot-receive-inbound'
      : 'no-relay-context';
    const reasoningArtifact = recordChatGptArtifact();
    if (reasoningArtifact && 'statusCode' in reasoningArtifact) return reasoningArtifact;
    const pendingPrompt = runtime.pendingPromptStore.createPendingPrompt({
      sessionId,
      prompt: content,
      source: 'chatgpt-web',
    });
    runtime.auditLog.createAndAppend({
      sessionId,
      packetId: pendingPrompt.packetId,
      approvalId: pendingPrompt.id,
      type: 'extract_return_fallback_pending',
      source: 'chatgpt-web',
      target: 'codex',
      result: { ok: true, metadata: { fallbackReason } },
    });
    runtime.persist();
    return created({ routedTo: 'pending-prompt', pendingPrompt, fallbackReason, artifact: reasoningArtifact });
  }

  if (pathname === BRIDGE_PENDING_PROMPTS_PATH && method === 'POST') {
    const parsed = await readJsonBody(request);
    if (!parsed.ok) {
      return error(400, parsed.message);
    }
    const sessionId = requireString(parsed.body, 'sessionId');
    const prompt = requireString(parsed.body, 'prompt');
    if (!sessionId || !prompt) {
      return error(400, 'sessionId and prompt are required');
    }
    const projectId = parseProjectIdField(parsed.body.projectId);
    if (projectId === null) {
      return error(400, 'projectId is invalid');
    }
    if (projectId) {
      const project = runtime.projectStore.get(projectId);
      if (project && project.archivedAt) {
        return error(409, 'Cannot create prompt in archived project');
      }
    }
    const pendingPrompt = runtime.pendingPromptStore.createPendingPrompt({
      sessionId,
      prompt,
      source: 'chatgpt-web',
      transport: 'clipboard',
      projectId: projectId ?? undefined,
    });
    if (projectId) runtime.projectStore.upsert({ key: projectId });
    runtime.persist();
    return created({ pendingPrompt });
  }

  if (pathname === BRIDGE_PENDING_PROMPTS_CONFIRM_PATH && method === 'POST') {
    const parsed = await readJsonBody(request);
    if (!parsed.ok) {
      return error(400, parsed.message);
    }
    const promptId = requireString(parsed.body, 'promptId');
    if (!promptId) {
      return error(400, 'promptId is required');
    }
    const confirmed = runtime.pendingPromptStore.confirmPrompt(promptId);
    if (!confirmed) {
      return error(409, 'Pending prompt cannot be confirmed');
    }
    runtime.persist();
    return ok({ pendingPrompt: confirmed });
  }

  if (pathname === BRIDGE_PENDING_PROMPTS_SEND_PATH && method === 'POST') {
    const parsed = await readJsonBody(request);
    if (!parsed.ok) {
      return error(400, parsed.message);
    }
    const promptId = requireString(parsed.body, 'promptId');
    if (!promptId) {
      return error(400, 'promptId is required');
    }
    const result = await runtime.pendingPromptStore.sendConfirmedPrompt(
      promptId,
      runtime.agent,
    );
    if (!result.ok) {
      return error(409, result.failureReason ?? 'Pending prompt delivery failed');
    }
    runtime.persist();
    return ok({
      pendingPrompt: result.prompt,
      delivery: result.delivery,
    });
  }

  if (pathname === BRIDGE_PENDING_PROMPTS_CANCEL_PATH && method === 'POST') {
    const parsed = await readJsonBody(request);
    if (!parsed.ok) {
      return error(400, parsed.message);
    }
    const promptId = requireString(parsed.body, 'promptId');
    if (!promptId) {
      return error(400, 'promptId is required');
    }
    const cancelled = runtime.pendingPromptStore.cancelPrompt(promptId);
    if (!cancelled) {
      return error(409, 'Pending prompt cannot be cancelled');
    }
    runtime.persist();
    return ok({ pendingPrompt: cancelled });
  }

  if (pathname === BRIDGE_REVIEWS_PATH && method === 'GET') {
    return ok({ reviews: runtime.pendingReviewStore.list() });
  }

  // Create a review request and immediately move it to `previewed`. The human
  // confirmation gate is the separate /confirm step; no CLI runs here.
  if (pathname === BRIDGE_REVIEWS_PATH && method === 'POST') {
    const parsed = await readJsonBody(request);
    if (!parsed.ok) {
      return error(400, parsed.message);
    }
    const sessionId = requireString(parsed.body, 'sessionId');
    const sourceEndpointId = requireString(parsed.body, 'sourceEndpointId');
    const targetEndpointId = requireString(parsed.body, 'targetEndpointId');
    const prompt = requireString(parsed.body, 'prompt');
    if (!sessionId || !sourceEndpointId || !targetEndpointId || !prompt) {
      return error(400, 'sessionId, sourceEndpointId, targetEndpointId and prompt are required');
    }
    // Only review-only command endpoints can be run through this HTTP path.
    if (!(targetEndpointId in REVIEW_COMMAND_ADAPTERS)) {
      return error(400, 'targetEndpointId is not a runnable review command endpoint');
    }
    if (!runtime.endpointRegistry.can(targetEndpointId, 'review')) {
      return error(409, 'Target endpoint cannot review');
    }
    let review;
    try {
      const projectId = parseProjectIdField(parsed.body.projectId);
      if (projectId === null) {
        return error(400, 'projectId is invalid');
      }
      if (projectId) {
        const project = runtime.projectStore.get(projectId);
        if (project && project.archivedAt) {
          return error(409, 'Cannot create review in archived project');
        }
      }
      review = runtime.pendingReviewStore.createDraft({
        sessionId,
        sourceEndpointId,
        targetEndpointId,
        prompt,
        projectId: projectId ?? undefined,
      });
      if (projectId) runtime.projectStore.upsert({ key: projectId });
    } catch {
      return error(400, 'Unable to create review for the given endpoints');
    }
    const previewed = runtime.pendingReviewStore.preview(review.id);
    runtime.persist();
    return created({ review: previewed ?? review });
  }

  // Human confirmation gate. A review must be `previewed` to be confirmed; only
  // a confirmed review can be run.
  if (pathname === BRIDGE_REVIEWS_CONFIRM_PATH && method === 'POST') {
    const parsed = await readJsonBody(request);
    if (!parsed.ok) {
      return error(400, parsed.message);
    }
    const reviewId = requireString(parsed.body, 'reviewId');
    if (!reviewId) {
      return error(400, 'reviewId is required');
    }
    const confirmed = runtime.pendingReviewStore.confirm(reviewId);
    if (!confirmed) {
      return error(409, 'Review cannot be confirmed');
    }
    runtime.persist();
    return ok({ review: confirmed });
  }

  // Run the confirmed review through the real review-only CLI. Sends (marks the
  // review `sent`) then invokes the command adapter; a successful ReviewResult
  // moves the review to `returned` and any nextPromptDraft stays a draft.
  if (pathname === BRIDGE_REVIEWS_RUN_PATH && method === 'POST') {
    const parsed = await readJsonBody(request);
    if (!parsed.ok) {
      return error(400, parsed.message);
    }
    const reviewId = requireString(parsed.body, 'reviewId');
    if (!reviewId) {
      return error(400, 'reviewId is required');
    }
    const automationPlanId = typeof parsed.body.planId === 'string' ? parsed.body.planId : undefined;
    const artifactKind = parsed.body.artifactKind === undefined
      ? 'review-result'
      : parsed.body.artifactKind;
    if (artifactKind !== 'review-result' && artifactKind !== 'execution-proposal') {
      return error(400, 'artifactKind must be review-result or execution-proposal');
    }
    const review = runtime.pendingReviewStore.get(reviewId);
    if (!review) {
      return error(409, 'Review not found');
    }
    const adapter = runtime.reviewAdapterFor(review.targetEndpointId);
    if (!adapter) {
      return error(409, 'Review target is not a runnable command endpoint');
    }
    // Move confirmed -> sent before running. Only a confirmed review sends.
    const sent = runtime.pendingReviewStore.sendConfirmed(reviewId);
    if (!sent.ok) {
      return error(409, sent.failureReason ?? 'Review cannot be sent');
    }
    const runResult = await runCommandReview(
      runtime.pendingReviewStore,
      runtime.auditLog,
      adapter,
      {
        reviewId,
        // Wrap the user-provided content with the review-only instruction
        // prompt so the CLI is forced to emit ReviewResult-shaped JSON. The raw
        // content becomes the material under review.
        prompt: buildClaudeReviewPrompt({ codexOutput: review.prompt }),
      },
    );
    runtime.persist();
    if (!runResult.ok) {
      if (automationPlanId) {
        const binding = runtime.automationBindingStore.getBinding(automationPlanId);
        if (binding) runtime.goalStore.pausePlan(binding.goalId, runResult.failureReason ?? 'review-run-failed');
        runtime.persist();
      }
      return error(409, runResult.failureReason ?? 'Review run failed');
    }
    let reasoningArtifact = null;
    if (automationPlanId && runResult.returned?.result) {
      const normalized = recordReasoningArtifactOrPause(runtime, {
        planId: automationPlanId,
        endpointId: review.targetEndpointId,
        kind: artifactKind,
        content: {
          summary: runResult.returned.result.summary,
          findings: runResult.returned.result.findings,
        },
        summary: runResult.returned.result.summary,
        source: 'generic',
      });
      if (!normalized.ok) {
        runtime.persist();
        return error(409, normalized.message);
      }
      reasoningArtifact = normalized.artifact;
    }
    return ok({
      review: runtime.pendingReviewStore.get(reviewId),
      result: runResult.returned?.result,
      nextPrompt: runResult.returned?.nextPrompt,
      artifact: reasoningArtifact,
    });
  }

  if (pathname === BRIDGE_REVIEWS_CANCEL_PATH && method === 'POST') {
    const parsed = await readJsonBody(request);
    if (!parsed.ok) {
      return error(400, parsed.message);
    }
    const reviewId = requireString(parsed.body, 'reviewId');
    if (!reviewId) {
      return error(400, 'reviewId is required');
    }
    const cancelled = runtime.pendingReviewStore.cancel(reviewId);
    if (!cancelled) {
      return error(409, 'Review cannot be cancelled');
    }
    runtime.persist();
    return ok({ review: cancelled });
  }

  if (pathname === BRIDGE_METRICS_PATH && method === 'GET') {
    return ok({
      metrics: createMetricsSummary({
        packetStore: runtime.packetStore,
        auditLog: runtime.auditLog,
        pendingPromptStore: runtime.pendingPromptStore,
      }),
    });
  }

  // ── v2.x Endpoint Session Registry (EX-1) ──

  // GET /bridge/endpoints — list all, or filter by ?projectRef=X or ?online=true
  if (pathname === BRIDGE_ENDPOINTS_PATH && method === 'GET') {
    const projectRef = query?.get('projectRef') ?? undefined;
    const onlineOnly = query?.get('online') === 'true';
    let endpoints: ReturnType<typeof runtime.endpointRegistry.list>;
    if (projectRef) {
      endpoints = runtime.endpointRegistry.listByProject(projectRef);
    } else if (onlineOnly) {
      endpoints = runtime.endpointRegistry.listOnline();
    } else {
      endpoints = runtime.endpointRegistry.list();
    }
    return ok({ endpoints });
  }

  // POST /bridge/endpoints/register
  // EX-1 is discoverability-only. Execution-capable registrations are
  // rejected — canExecute=true belongs to EX-4, after inbox/result protocol
  // and adapter implementation.
  if (pathname === BRIDGE_ENDPOINTS_PATH && method === 'POST') {
    const parsed = await readJsonBody(request);
    if (!parsed.ok) return error(400, parsed.message);
    const validation = validateEndpointRegistration(parsed.body);
    if (!validation.ok) return error(400, `Invalid registration: ${validation.errors.join(', ')}`);
    const body = parsed.body as Record<string, unknown>;
    const caps = body.capabilities as Record<string, unknown>;
    // Gate: reject registration that declares execution capability before EX-4.
    if (caps && caps.canExecute === true) {
      return error(400, 'Execution capability (canExecute: true) is not available in this version. Use heartbeat for online status.');
    }
    const endpoint = {
      id: body.endpointId as string,
      label: body.label as string,
      transport: body.transport as string,
      risk: (typeof body.risk === 'string' ? body.risk : 'medium') as AgentEndpoint['risk'],
      capabilities: body.capabilities as AgentEndpoint['capabilities'],
      projectRef: typeof body.projectRef === 'string' ? body.projectRef : undefined,
      adapterName: typeof body.adapterName === 'string' ? body.adapterName : undefined,
      experimental: typeof body.experimental === 'boolean' ? body.experimental : undefined,
    } as AgentEndpoint;
    const result = runtime.endpointRegistry.register(endpoint);
    if (!result.ok) {
      const status = result.failureReason === 'duplicate-endpoint-id' ? 409 : 400;
      return error(status, result.failureReason ?? 'Registration failed');
    }
    // Session state (online/offline) is NOT persisted — endpoints must
    // re-register after server restart.
    return created({ endpoint: runtime.endpointRegistry.get(endpoint.id) });
  }

  // POST /bridge/endpoints/:id/heartbeat
  const heartbeatMatch = matchEndpointAction(pathname, 'heartbeat');
  if (heartbeatMatch.matched && method === 'POST') {
    if (!heartbeatMatch.id) return error(400, 'Invalid endpoint id');
    const result = runtime.endpointRegistry.heartbeat(heartbeatMatch.id);
    if (!result.ok) {
      const status = result.failureReason === 'endpoint-offline' ? 409
        : result.failureReason === 'endpoint-not-found' ? 404 : 400;
      return error(status, result.failureReason ?? 'Heartbeat failed');
    }
    return ok({ status: 'online', endpointId: heartbeatMatch.id });
  }

  // POST /bridge/endpoints/:id/offline
  const offlineMatch = matchEndpointAction(pathname, 'offline');
  if (offlineMatch.matched && method === 'POST') {
    if (!offlineMatch.id) return error(400, 'Invalid endpoint id');
    const result = runtime.endpointRegistry.offline(offlineMatch.id);
    if (!result.ok) {
      const status = result.failureReason === 'endpoint-already-offline' ? 409
        : result.failureReason === 'endpoint-not-found' ? 404 : 400;
      return error(status, result.failureReason ?? 'Offline failed');
    }
    return ok({ status: 'offline', endpointId: offlineMatch.id });
  }

  // ── EX-4: WorkBuddy inbox/result protocol ──

  // GET /bridge/endpoints/:id/inbox/next
  const inboxMatch = matchEndpointSubPath(pathname, 'inbox/next');
  if (inboxMatch.matched && method === 'GET') {
    if (!inboxMatch.id) return error(400, 'Invalid endpoint id');
    const endpoint = runtime.endpointRegistry.get(inboxMatch.id);
    if (!endpoint) return error(404, 'Endpoint not found');
    if (endpoint.transport !== 'workbuddy') return error(400, 'Inbox is only available for workbuddy endpoints');
    const task = runtime.workbuddyExecution.claimNext(inboxMatch.id);
    if (!task) return ok({ task: null, message: 'No pending tasks' });
    return ok({ task });
  }

  // POST /bridge/endpoints/:id/results
  const resultsMatch = matchEndpointSubPath(pathname, 'results');
  if (resultsMatch.matched && method === 'POST') {
    if (!resultsMatch.id) return error(400, 'Invalid endpoint id');
    const parsed = await readJsonBody(request);
    if (!parsed.ok) return error(400, parsed.message);
    const body = parsed.body as Record<string, unknown>;
    const taskId = requireString(body, 'taskId');
    if (!taskId) return error(400, 'taskId is required');
    const outcomeOk = typeof body.ok === 'boolean' ? body.ok : false;
    const result = runtime.workbuddyExecution.recordResult(taskId, {
      ok: outcomeOk,
      proposalId: typeof body.proposalId === 'string' ? body.proposalId : '',
      output: body.output,
      stdout: typeof body.stdout === 'string' ? body.stdout : undefined,
      stderr: typeof body.stderr === 'string' ? body.stderr : undefined,
      exitCode: typeof body.exitCode === 'number' ? body.exitCode : undefined,
      failureReason: typeof body.failureReason === 'string' ? body.failureReason : undefined,
      durationMs: typeof body.durationMs === 'number' ? body.durationMs : 0,
    });
    if (!result) return error(409, 'Task not found or not claimed');
    return ok({ result });
  }

  // POST /bridge/endpoints/:id/log
  const logMatch = matchEndpointSubPath(pathname, 'log');
  if (logMatch.matched && method === 'POST') {
    if (!logMatch.id) return error(400, 'Invalid endpoint id');
    const parsed = await readJsonBody(request);
    if (!parsed.ok) return error(400, parsed.message);
    const body = parsed.body as Record<string, unknown>;
    const taskId = requireString(body, 'taskId');
    if (!taskId) return error(400, 'taskId is required');
    const kind = typeof body.kind === 'string'
      && ['info', 'warning', 'error', 'progress'].includes(body.kind)
      ? body.kind as 'info' | 'warning' | 'error' | 'progress'
      : 'info';
    const message = typeof body.message === 'string' ? body.message : '';
    const entry = runtime.workbuddyExecution.recordLog({
      taskId,
      endpointId: logMatch.id,
      kind,
      message,
    });
    return created({ log: entry });
  }

  // ── Phase B Project aggregation and metadata/archive controls ──

  if (pathname === BRIDGE_PROJECTS_PATH && method === 'GET') {
    // Filter archived projects from default listing unless ?includeArchived=true.
    const includeArchived = query?.get('includeArchived') === 'true';
    const projects = buildProjectSummaries(runtime)
      .filter((p) => !p.project.archivedAt || includeArchived);
    return ok({ projects });
  }

  // B3: POST /bridge/projects — explicit project creation.
  if (pathname === BRIDGE_PROJECTS_PATH && method === 'POST') {
    const parsed = await readJsonBody(request);
    if (!parsed.ok) return error(400, parsed.message);
    const rawKey = parsed.body.key;
    if (typeof rawKey !== 'string' || rawKey.trim().length === 0) {
      return error(400, 'key is required and must be a non-empty string');
    }
    const key = validateProjectKey(rawKey.trim());
    if (!key) return error(400, 'Invalid project key');
    // Reject disallowed fields.
    if ('createdAt' in parsed.body || 'archivedAt' in parsed.body) {
      return error(400, 'createdAt and archivedAt cannot be set on creation');
    }
    const label = typeof parsed.body.label === 'string' && parsed.body.label.trim().length > 0
      ? parsed.body.label.trim() : key;
    const description = typeof parsed.body.description === 'string'
      ? parsed.body.description : undefined;
    // Explicit create — must not already exist (including archived).
    const existing = runtime.projectStore.get(key);
    if (existing) return error(409, 'Project already exists');
    const project = runtime.projectStore.create({ key, label, description });
    if (!project) return error(409, 'Project already exists');
    runtime.persist();
    return created({ project });
  }

  const projectKey = projectDetailPathKey(pathname);
  if (projectKey && method === 'GET') {
    const detail = buildProjectDetail(runtime, projectKey);
    if (!detail) {
      return error(404, 'Project not found');
    }
    return ok({
      project: detail.summary.project,
      summary: detail.summary,
      goals: detail.goals,
      reviews: detail.reviews,
      pendingPrompts: detail.pendingPrompts,
      auditEvents: detail.auditEvents,
      status: detail.status,
    });
  }

  // PATCH /bridge/projects/:key — update project metadata
  if (projectKey && method === 'PATCH') {
    const parsed = await readJsonBody(request);
    if (!parsed.ok) {
      return error(400, parsed.message);
    }
    const existing = runtime.projectStore.get(projectKey);
    if (!existing) {
      return error(404, 'Project not found');
    }
    // Only label, description, workspaceApplyEnabled, and verifyProfileId are writable.
    const label = typeof parsed.body.label === 'string' && parsed.body.label.trim().length > 0
      ? parsed.body.label.trim() : undefined;
    const description = typeof parsed.body.description === 'string'
      ? parsed.body.description : undefined;
    const workspaceApplyEnabled = typeof parsed.body.workspaceApplyEnabled === 'boolean'
      ? parsed.body.workspaceApplyEnabled : undefined;
    // v2.14 ADR-0019-a: gitStatusEnabled — boolean toggle, default off.
    const gitStatusEnabled = typeof parsed.body.gitStatusEnabled === 'boolean'
      ? parsed.body.gitStatusEnabled : undefined;
    // v2.14 ADR-0019-b: githubChecksEnabled — boolean toggle, default off.
    const githubChecksEnabled = typeof parsed.body.githubChecksEnabled === 'boolean'
      ? parsed.body.githubChecksEnabled : undefined;
    // v2.13: verifyProfileId — string to set, null to remove, undefined to leave unchanged.
    // Reject non-string/non-null values explicitly.
    if (parsed.body.verifyProfileId !== undefined && parsed.body.verifyProfileId !== null
        && typeof parsed.body.verifyProfileId !== 'string') {
      return error(400, 'verifyProfileId must be a string or null');
    }
    const verifyProfileId = parsed.body.verifyProfileId === null ? null
      : (typeof parsed.body.verifyProfileId === 'string' ? parsed.body.verifyProfileId as string | null : undefined);

    // Reject disallowed command-like fields (root-like fields silently ignored per ADR-0014).
    const blocked = ['key', 'createdAt', 'archivedAt', 'verifyCommand', 'command', 'argv', 'env', 'shell', 'stdout', 'stderr', 'output', 'remote', 'token', 'network', 'provider', 'credentials', 'gitCmd', 'gitCommand', 'repoUrl',
      // ADR-0019-b: operator-only identity fields.
      'owner', 'repo', 'ref', 'apiBaseUrl', 'url', 'host', 'checksToken', 'githubToken', 'authorization', 'credential'];
    for (const field of blocked) {
      if (field in parsed.body) return error(400, `Field '${field}' is not allowed in project PATCH`);
    }
    // baselineRoot/workspaceRoot/projectWorkspaceRoots: silently ignore (ADR-0014 compat).
    // v2.13: verifyProfileId must reference a configured profile.
    if (typeof verifyProfileId === 'string') {
      const profiles = runtime.verifyProfiles ?? [];
      if (!profiles.some(p => p.id === verifyProfileId)) {
        return error(400, 'verifyProfileId does not match any configured verification profile');
      }
    }
    const updated = runtime.projectStore.upsert({
      key: projectKey,
      label,
      description,
      workspaceApplyEnabled,
      verifyProfileId: parsed.body.verifyProfileId !== undefined ? verifyProfileId : undefined,
      gitStatusEnabled,
      githubChecksEnabled,
    });
    runtime.persist();
    return ok({ project: updated });
  }

  // POST /bridge/projects/:key/archive
  const archivePath = projectActionPathKey(pathname, 'archive');
  if (archivePath.matched && method === 'POST') {
    const key = archivePath.key;
    if (!key) return error(400, 'Invalid project key');
    if (key === DEFAULT_PROJECT_KEY) return error(409, 'Cannot archive the default project');
    const existing = runtime.projectStore.get(key);
    if (!existing) return error(404, 'Project not found');
    if (existing.archivedAt) return error(409, 'Project is already archived');
    const archived = runtime.projectStore.archive(key);
    runtime.persist();
    return ok({ project: archived });
  }

  // POST /bridge/projects/:key/unarchive
  const unarchivePath = projectActionPathKey(pathname, 'unarchive');
  if (unarchivePath.matched && method === 'POST') {
    const key = unarchivePath.key;
    if (!key) return error(400, 'Invalid project key');
    const existing = runtime.projectStore.get(key);
    if (!existing) return error(404, 'Project not found');
    if (!existing.archivedAt) return error(409, 'Project is not archived');
    const unarchived = runtime.projectStore.unarchive(key);
    runtime.persist();
    return ok({ project: unarchived });
  }

  // ── EX-2: Project Team Preset ──

  const presetPath = projectActionPathKey(pathname, 'team-preset');
  if (presetPath.matched) {
    if (!presetPath.key) return error(400, 'Invalid project key');
    const proj = runtime.projectStore.get(presetPath.key);
    if (!proj) return error(404, 'Project not found');
    if (proj.archivedAt && method !== 'GET') {
      return error(409, 'Cannot modify team preset in archived project');
    }

    // GET /bridge/projects/:key/team-preset
    if (method === 'GET') {
      const preset = runtime.presetStore.get(presetPath.key);
      return ok({ preset: preset ?? null });
    }

    // PUT /bridge/projects/:key/team-preset
    if (method === 'PUT') {
      const parsed = await readJsonBody(request);
      if (!parsed.ok) return error(400, parsed.message);
      const body = parsed.body as Record<string, unknown>;
      // Validate required fields.
      if (typeof body.plannerEndpointId !== 'string' || body.plannerEndpointId.trim().length === 0) {
        return error(400, 'plannerEndpointId is required');
      }
      if (typeof body.executorEndpointId !== 'string' || body.executorEndpointId.trim().length === 0) {
        return error(400, 'executorEndpointId is required');
      }
      // Validate endpoints are registered and online.
      const onlineIds = new Set(runtime.endpointRegistry.listOnline().map(e => e.id));
      const preset = {
        projectId: presetPath.key,
        plannerEndpointId: body.plannerEndpointId as string,
        executorEndpointId: body.executorEndpointId as string,
        verifierEndpointId: typeof body.verifierEndpointId === 'string' ? body.verifierEndpointId : undefined,
        mode: 'sequential' as const,
        isolation: 'patch-only' as const,
        updatedAt: 0,
      };
      const validation = validateProjectTeamPreset(preset, onlineIds);
      if (!validation.ok) {
        return error(400, `Invalid preset: ${validation.errors.join(', ')}`);
      }
      const saved = runtime.presetStore.upsert(preset);
      runtime.persist();
      return ok({ preset: saved });
    }

    if (method === 'DELETE') {
      const existed = runtime.presetStore.delete(presetPath.key);
      if (!existed) return error(404, 'No team preset for this project');
      runtime.persist();
      return ok({ deleted: true });
    }

    return error(405, 'Method not allowed');
  }

  // ── v2.1 Read-only project observability (§timeline/audit/memory/verification) ──

  const obsPath = matchProjectObservabilityPath(pathname);
  if (obsPath.matched && method === 'GET') {
    if (!obsPath.key) return error(400, 'Invalid project key');
    const obsInput = buildObservabilityInput(runtime, obsPath.key);
    if (!obsInput) return error(404, 'Project not found');

    if (obsPath.sub === BRIDGE_PROJECT_TIMELINE_SUFFIX) {
      return ok(buildConversationTimeline(obsInput));
    }
    if (obsPath.sub === BRIDGE_PROJECT_AUDIT_SUFFIX) {
      const rawLimit = query?.get('limit');
      let limit: number | undefined;
      if (typeof rawLimit === 'string') {
        // Empty string is invalid — parameter present but empty.
        if (rawLimit.length === 0) return error(400, 'Invalid limit parameter');
        const parsed = Number(rawLimit);
        // Reject non-integer, trailing garbage, and out-of-range values.
        if (!Number.isInteger(parsed) || String(parsed) !== rawLimit || parsed < 1) {
          return error(400, 'Invalid limit parameter');
        }
        limit = parsed;
      }
      const rawType = query?.get('type');
      const type = typeof rawType === 'string' && rawType.length > 0
        ? rawType : undefined;
      return ok(buildProjectAuditView(obsInput, limit, type));
    }
    if (obsPath.sub === BRIDGE_PROJECT_MEMORY_SUFFIX) {
      return ok(buildDerivedMemory(obsInput));
    }
    if (obsPath.sub === BRIDGE_PROJECT_VERIFICATION_SUFFIX) {
      const view = buildHarnessVerification(obsInput);
      // v2.13: merge live verification records into summary
      const liveRuns = runtime.verificationRunStore.getForProject(obsPath.key!);
      (view as any).liveRunRecords = liveRuns;
      if (liveRuns.length > 0) {
        const summary = view.summary ?? { evidenceCount: 0, doneStepCount: 0, totalStepCount: 0, resultCounts: { passed: 0, failed: 0, skipped: 0, errored: 0, unknown: 0 } };
        const counts = summary.resultCounts ?? { passed: 0, failed: 0, skipped: 0, errored: 0, unknown: 0 };
        for (const r of liveRuns) {
          summary.evidenceCount++;
          if (counts[r.result] !== undefined) counts[r.result]++;
          if (r.recordedAt && (!summary.lastRecordedAt || r.recordedAt > summary.lastRecordedAt)) {
            summary.lastRecordedAt = r.recordedAt;
          }
        }
        view.summary = summary;
      }
      return ok(view);
    }
    // v2.13 ADR-0018: live verification profiles list (GET)
    if (obsPath.sub === BRIDGE_PROJECT_VERIFICATION_PROFILES_SUFFIX) {
      return handleVerificationProfilesGet(runtime, obsPath.key!);
    }
    // v2.14 ADR-0019-a: read-only local git status (GET)
    if (obsPath.sub === BRIDGE_PROJECT_VERIFICATION_GIT_STATUS_SUFFIX) {
      return handleGitStatusGet(runtime, obsPath.key!);
    }
    // v2.13 confirm handled outside GET-only block below.
    return error(404, 'Not found');
  }
  // v2.13 ADR-0018: live verification trigger (POST) — outside GET-only block
  if (obsPath.matched && method === 'POST' && obsPath.sub === BRIDGE_PROJECT_VERIFICATION_CONFIRM_SUFFIX) {
    if (!obsPath.key) return error(400, 'Invalid project key');
    return handleVerificationConfirmPost(runtime, obsPath.key, request);
  }
  // v2.14 ADR-0019-b: github checks confirm (POST)
  if (obsPath.matched && method === 'POST' && obsPath.sub === BRIDGE_PROJECT_VERIFICATION_GITHUB_CHECKS_CONFIRM_SUFFIX) {
    if (!obsPath.key) return error(400, 'Invalid project key');
    return handleGithubChecksConfirm(runtime, obsPath.key);
  }
  if (obsPath.matched) return error(405, 'Method not allowed');

  // ── v2.2 WorkBuddy Non-Executing Task System ───────────────────────

  const wbMatch = matchProjectWorkBuddyPath(pathname);
  if (wbMatch.matched) {
    if (!wbMatch.key) return error(400, 'Invalid project key');
    const wbProj = runtime.projectStore.get(wbMatch.key);
    if (!wbProj) return error(404, 'Project not found');
    // Archived project: GET allowed, mutation blocked.
    if (wbProj.archivedAt && method !== 'GET') {
      return error(409, 'Cannot mutate WorkBuddy state in archived project');
    }

    if (wbMatch.sub === '' && method === 'GET') {
      return ok(buildWorkBuddyProjectView(runtime, wbMatch.key));
    }
    if (wbMatch.sub === '' && method === 'POST') {
      return postWorkBuddyMultiplex(runtime, wbMatch.key, request);
    }
    return error(405, 'Method not allowed');
  }


  // ── v2.3 AgentTeam Sequential MVP ─────────────────────────────────

  const teamMatch = matchProjectTeamPath(pathname);
  if (teamMatch.matched && method === 'GET' && teamMatch.sub === '') {
    if (!teamMatch.key) return error(400, 'Invalid project key');
    const proj = runtime.projectStore.get(teamMatch.key);
    if (!proj) return error(404, 'Project not found');
    const teams = runtime.teamStore.listByProject(teamMatch.key);
    // Enrich teams with artifact summaries and conflict status.
    const enriched = teams.map(team => {
      const artifacts = runtime.teamStore.listArtifacts(team.id);
      const conflictReport = detectFileConflicts(
        artifacts.map(a => ({ slotId: a.slotId, proposedFiles: a.proposedFiles, providerId: a.providerId })),
      );
      return {
        ...team,
        artifactCount: artifacts.length,
        artifactSummaries: artifacts.map(a => ({
          slotId: a.slotId, providerId: a.providerId, endpointId: a.endpointId, summary: a.summary, proposedFiles: a.proposedFiles,
        })),
        conflictStatus: conflictReport.clean ? 'clean' : 'conflicts',
        conflictCount: conflictReport.conflicts.length,
      };
    });
    return ok({ teams: enriched });
  }
  if (teamMatch.matched && method === 'POST' && teamMatch.sub === '') {
    if (!teamMatch.key) return error(400, 'Invalid project key');
    return handleTeamsPost(runtime, teamMatch.key, request);
  }
  // Approve / cancel sub-routes
  if (teamMatch.matched && method === 'POST' && (teamMatch.sub === 'approve' || teamMatch.sub === 'cancel')) {
    if (!teamMatch.key || !teamMatch.teamId) return error(400, 'Invalid project key or team id');
    const proj = runtime.projectStore.get(teamMatch.key);
    if (!proj) return error(404, 'Project not found');
    if (proj.archivedAt) return error(409, 'Project is archived');
    // Team must belong to the URL project.
    const existing = runtime.teamStore.get(teamMatch.teamId);
    if (!existing) return error(404, 'Team not found');
    if (existing.projectId !== teamMatch.key) return error(404, 'Team not found');
    const team = teamMatch.sub === 'approve'
      ? runtime.teamStore.approve(teamMatch.teamId)
      : runtime.teamStore.cancel(teamMatch.teamId);
    if (!team) return error(409, teamMatch.sub === 'approve' ? 'Team not found or not pending approval' : 'Team not found or not cancellable');
    runtime.persist();
    runtime.auditLog.createAndAppend({
      sessionId: 'team-' + teamMatch.sub + '-' + team.id,
      projectId: teamMatch.key,
      type: teamMatch.sub === 'approve' ? 'team_approved' : 'team_cancelled',
      source: 'team-orchestrator',
      target: 'team-' + team.id,
      teamId: team.id,
      goalId: team.goalId,
      result: { ok: true },
    });
    return ok({ team });
  }
  // Artifact recording — POST /bridge/projects/:key/teams/:teamId/artifacts
  if (teamMatch.matched && method === 'POST' && teamMatch.sub === 'artifacts') {
    if (!teamMatch.key || !teamMatch.teamId) return error(400, 'Invalid project key or team id');
    return handleArtifactPost(runtime, teamMatch.key, teamMatch.teamId, request);
  }
  // Conflict report — GET /bridge/projects/:key/teams/:teamId/conflicts
  if (teamMatch.matched && method === 'GET' && teamMatch.sub === 'conflicts') {
    if (!teamMatch.key || !teamMatch.teamId) return error(400, 'Invalid project key or team id');
    return handleConflictGet(runtime, teamMatch.key, teamMatch.teamId);
  }
  // Slot state advance — POST /bridge/projects/:key/teams/:teamId/slots/:slotId/advance
  if (teamMatch.matched && method === 'POST' && teamMatch.sub === 'slots-advance') {
    if (!teamMatch.key || !teamMatch.teamId || !teamMatch.slotId) return error(400, 'Invalid project key, team id, or slot id');
    return handleSlotAdvancePost(runtime, teamMatch.key, teamMatch.teamId, teamMatch.slotId, request);
  }
  if (teamMatch.matched) return error(405, 'Method not allowed');

  // ── v2.5 Workspace apply ──────────────────────────────────────────

  const applyMatch = matchTeamApplyPath(pathname);
  if (applyMatch.matched && method === 'POST' && applyMatch.sub === '') {
    if (!applyMatch.key || !applyMatch.teamId) return error(400, 'Invalid project key or team id');
    return handleApplyRequestCreate(runtime, applyMatch.key, applyMatch.teamId, request);
  }
  if (applyMatch.matched && method === 'GET' && applyMatch.sub === '') {
    if (!applyMatch.key || !applyMatch.teamId) return error(400, 'Invalid project key or team id');
    return handleApplyRequestList(runtime, applyMatch.key, applyMatch.teamId);
  }
  if (applyMatch.matched && method === 'POST' && applyMatch.sub === 'confirm') {
    if (!applyMatch.key || !applyMatch.teamId || !applyMatch.applyId) return error(400, 'Invalid project key, team id, or apply id');
    return handleApplyRequestConfirm(runtime, applyMatch.key, applyMatch.teamId, applyMatch.applyId, request);
  }
  if (applyMatch.matched && method === 'POST' && applyMatch.sub === 'discard') {
    if (!applyMatch.key || !applyMatch.teamId || !applyMatch.applyId) return error(400, 'Invalid project key, team id, or apply id');
    return handleApplyRequestDiscard(runtime, applyMatch.key, applyMatch.teamId, applyMatch.applyId);
  }
  // Read-only presentation (ADR-0009) — GET only.
  if (applyMatch.matched && method === 'GET' && applyMatch.sub === 'manifest') {
    if (!applyMatch.key || !applyMatch.teamId || !applyMatch.applyId) return error(400, 'Invalid project key, team id, or apply id');
    return handleApplyManifestGet(runtime, applyMatch.key, applyMatch.teamId, applyMatch.applyId);
  }
  if (applyMatch.matched && method === 'GET' && applyMatch.sub === 'files') {
    if (!applyMatch.key || !applyMatch.teamId || !applyMatch.applyId) return error(400, 'Invalid project key, team id, or apply id');
    return handleApplyFilesGet(runtime, applyMatch.key, applyMatch.teamId, applyMatch.applyId);
  }
  if (applyMatch.matched && method === 'GET' && applyMatch.sub === 'preview') {
    if (!applyMatch.key || !applyMatch.teamId || !applyMatch.applyId) return error(400, 'Invalid project key, team id, or apply id');
    return handleApplyPreviewGet(runtime, applyMatch.key, applyMatch.teamId, applyMatch.applyId, query);
  }
  // v2.6 ADR-0011: Read-only classification (GET-only)
  if (applyMatch.matched && method === 'GET' && applyMatch.sub === 'classification') {
    if (!applyMatch.key || !applyMatch.teamId || !applyMatch.applyId) return error(400, 'Invalid project key, team id, or apply id');
    return handleApplyClassificationGet(runtime, applyMatch.key, applyMatch.teamId, applyMatch.applyId);
  }
  if (applyMatch.matched) return error(405, 'Method not allowed');

  // ── v2.0 Goal-driven execution (§7.4) ──────────────────────────────

  if (pathname === BRIDGE_GOALS_PATH && method === 'GET') {
    const goals = runtime.goalStore.listGoals();
    const enriched = goals.map((goal) => {
      const plan = runtime.goalStore.getPlanByGoal(goal.id);
      return { goal, plan: plan ?? null };
    });
    return ok({ goals: enriched });
  }

  if (pathname === BRIDGE_GOALS_PATH && method === 'POST') {
    const parsed = await readJsonBody(request);
    if (!parsed.ok) {
      return error(400, parsed.message);
    }
    const sessionId = requireString(parsed.body, 'sessionId');
    const description = requireString(parsed.body, 'description');
    if (!sessionId || !description) {
      return error(400, 'sessionId and description are required');
    }
    const projectId = parseProjectIdField(parsed.body.projectId);
    if (projectId === null) {
      return error(400, 'projectId is invalid');
    }
    // Reject creation in archived projects.
    if (projectId) {
      const project = runtime.projectStore.get(projectId);
      if (project && project.archivedAt) {
        return error(409, 'Cannot create goal in archived project');
      }
    }
    const goal = runtime.goalStore.createGoal({ sessionId, description, projectId: projectId ?? undefined });
    if (projectId) runtime.projectStore.upsert({ key: projectId });
    // EX-3: Auto-create binding snapshot from project preset.
    const effectiveProjectId = projectId ?? 'cli-bridge';
    const preset = runtime.presetStore.get(effectiveProjectId);
    let bindingSnapshot = null;
    if (preset) {
      bindingSnapshot = runtime.bindingSnapshotStore.createFromPreset({
        goalId: goal.id,
        plannerEndpointId: preset.plannerEndpointId,
        executorEndpointId: preset.executorEndpointId,
        verifierEndpointId: preset.verifierEndpointId,
      });
    }
    runtime.persist();
    return created({ goal, bindingSnapshot });
  }

  if (pathname === BRIDGE_GOALS_PLAN_PATH && method === 'POST') {
    const parsed = await readJsonBody(request);
    if (!parsed.ok) {
      return error(400, parsed.message);
    }
    const goalId = requireString(parsed.body, 'goalId');
    if (!goalId) {
      return error(400, 'goalId is required');
    }
    // cwd MUST NOT come from untrusted request input (command-runner §safety).
    // Reject the field if present; the server uses its own working directory.
    if ('cwd' in parsed.body) {
      return error(400, 'cwd must not be set from request input');
    }

    const plannerSource = typeof parsed.body.plannerSource === 'string'
      ? parsed.body.plannerSource
      : 'review-cli';
    const criticSource = typeof parsed.body.criticSource === 'string'
      ? parsed.body.criticSource
      : 'none';
    if (criticSource !== 'none' && criticSource !== 'model-api') {
      return error(400, 'criticSource must be "none" or "model-api"');
    }

    // ════════════════════════════════════════════════
    // v2.4a Model API path
    // ════════════════════════════════════════════════
    if (plannerSource === 'model-api') {
      const goal = runtime.goalStore.getGoal(goalId);
      if (!goal) return error(400, 'Goal not found');
      const automationPlanId = typeof parsed.body.planId === 'string' ? parsed.body.planId : undefined;
      if (!automationPlanId && goal.status !== 'draft') return error(400, 'Goal must be in draft status for model plan');
      if (automationPlanId) {
        const plan = runtime.goalStore.getPlanById(automationPlanId);
        const binding = runtime.automationBindingStore.getBinding(automationPlanId);
        if (!plan || !binding || plan.goalId !== goalId || binding.goalId !== goalId) {
          return error(409, 'Locked automation plan binding is required');
        }
      }

      const projectId = goal.projectId ?? 'cli-bridge';

      // Accept API key from request body (opt-in, memory-only).
      if (typeof parsed.body.apiKey === 'string' && parsed.body.apiKey.trim().length > 0) {
        runtime.modelApiKeyStore.setKey(projectId, parsed.body.apiKey.trim());
      }
      const apiKey = runtime.modelApiKeyStore.getKey(projectId);
      if (!apiKey) {
        return error(409, 'No model API key configured for this project. Provide apiKey in request body or use plannerSource: review-cli.');
      }

      const { generateModelPlan } = await import('../model/planner-model.ts');
      const providerLabel = typeof parsed.body.apiKey === 'string' ? 'openai/gpt-4o-mini' : 'unknown';
      const provider = runtime.modelProviderFor
        ? runtime.modelProviderFor(apiKey)
        : new (await import('../model/openai-adapter.ts')).OpenAiAdapter(apiKey);

      const maxSteps = 10;
      const resolvedTiers = Array.isArray(parsed.body.permittedTiers)
        ? (parsed.body.permittedTiers as string[]).filter((v: unknown) => v === 'patch-proposal' || v === 'workspace-write')
        : ['patch-proposal'];

      // ════════════════════════════════════════════════
      // Audit: model_plan_request (before provider call)
      // ════════════════════════════════════════════════
      runtime.auditLog.createAndAppend({
        sessionId: 'model-plan-' + goalId,
        projectId,
        type: 'model_plan_request',
        source: 'planner-model',
        target: 'goal-' + goalId,
        goalId,
        result: {
          ok: true,
          metadata: {
            status: 'requested',
            provider: providerLabel,
            endpoint: 'openai/chat/completions',
            tokenBudget: { input: 4096, output: 2048 },
            maxSteps,
            permittedTiers: resolvedTiers,
          },
        },
      });

      const requestStart = Date.now();
      const modelResult = await generateModelPlan(provider, {
        goalDescription: goal.description,
        endpoints: (Array.isArray(parsed.body.availableEndpoints)
          ? (parsed.body.availableEndpoints as string[]).filter((v: unknown) => typeof v === 'string' && v.length > 0).map(id => ({ id, label: id }))
          : [{ id: 'claude-code-command', label: 'Claude Code' }]),
        permittedTiers: resolvedTiers,
        projectContext: goal.projectId,
        maxSteps,
      });
      const latencyMs = Date.now() - requestStart;

      // ════════════════════════════════════════════════
      // Audit: model_plan_result (all outcomes, rich metadata)
      // ════════════════════════════════════════════════
      const resultMeta: Record<string, unknown> = {
        status: modelResult.ok ? 'accepted' : (modelResult.kind === 'provider-error' || modelResult.kind === 'budget-exceeded' ? 'failed' : 'rejected'),
        provider: modelResult.ok ? modelResult.provider : providerLabel,
        latencyMs,
      };
      if (modelResult.ok) {
        resultMeta.usage = modelResult.usage;
      } else {
        resultMeta.failureKind = modelResult.kind;
        resultMeta.failureReason = modelResult.reason;
        if (modelResult.usage) resultMeta.usage = modelResult.usage;
      }
      runtime.auditLog.createAndAppend({
        sessionId: 'model-plan-result-' + goalId,
        projectId,
        type: 'model_plan_result',
        source: 'planner-model',
        target: 'goal-' + goalId,
        goalId,
        result: {
          ok: modelResult.ok,
          failureReason: modelResult.ok ? undefined : modelResult.reason,
          metadata: resultMeta,
        },
      });

      if (!modelResult.ok) {
        if (automationPlanId) {
          runtime.goalStore.pausePlan(goalId, modelResult.reason);
          runtime.persist();
        }
        // Fail-closed: schema/policy rejection, provider error, or budget exceeded.
        // Return generic error — do not expose internal rejection details via HTTP.
        let httpMessage = 'Model plan generation failed';
        if (modelResult.kind === 'schema-rejection') httpMessage += ': model output did not pass schema validation';
        else if (modelResult.kind === 'policy-rejection') httpMessage += ': model output violated policy constraints';
        else if (modelResult.kind === 'budget-exceeded') httpMessage += ': input exceeds token budget';
        else httpMessage += ': provider error';
        return error(409, httpMessage);
      }

      let reasoningArtifact = null;
      if (automationPlanId) {
        const normalized = recordReasoningArtifactOrPause(runtime, {
          planId: automationPlanId,
          endpointId: typeof parsed.body.reasoningEndpointId === 'string'
            ? parsed.body.reasoningEndpointId
            : undefined,
          kind: 'plan-draft',
          content: modelResult.draft,
          summary: modelResult.draft.rationale ?? 'Model plan draft',
          source: 'generic',
        });
        if (!normalized.ok) {
          runtime.persist();
          return error(409, normalized.message);
        }
        reasoningArtifact = normalized.artifact;
      }

      let critiquePayload: unknown = null;
      let criticMeta: Record<string, unknown> | null = null;
      if (criticSource === 'model-api') {
        const { generateModelCritique } = await import('../model/critic-model.ts');
        runtime.auditLog.createAndAppend({
          sessionId: 'model-critique-' + goalId,
          projectId,
          type: 'model_critique_request',
          source: 'critic-model',
          target: 'goal-' + goalId,
          goalId,
          result: {
            ok: true,
            metadata: {
              status: 'requested',
              provider: providerLabel,
              endpoint: 'openai/chat/completions',
              tokenBudget: { input: 4096, output: 2048 },
              maxItems: 10,
              reviewedStepCount: modelResult.draft.steps.length,
            },
          },
        });

        const critiqueStart = Date.now();
        const critiqueResult = await generateModelCritique(provider, {
          goalDescription: goal.description,
          draft: modelResult.draft,
          permittedTiers: resolvedTiers,
          projectContext: goal.projectId,
          maxItems: 10,
        });
        const critiqueLatencyMs = Date.now() - critiqueStart;
        const critiqueMeta: Record<string, unknown> = {
          status: critiqueResult.ok ? 'accepted' : (critiqueResult.kind === 'provider-error' || critiqueResult.kind === 'budget-exceeded' ? 'failed' : 'rejected'),
          provider: critiqueResult.ok ? critiqueResult.provider : providerLabel,
          latencyMs: critiqueLatencyMs,
        };
        if (critiqueResult.ok) {
          const severities = critiqueResult.critique.items.map(item => item.severity);
          critiqueMeta.usage = critiqueResult.usage;
          critiqueMeta.itemCount = critiqueResult.critique.items.length;
          critiqueMeta.highestSeverity = severities.includes('blocking') ? 'blocking' : (severities.includes('warning') ? 'warning' : (severities.includes('info') ? 'info' : 'none'));
        } else {
          critiqueMeta.failureKind = critiqueResult.kind;
          critiqueMeta.failureReason = critiqueResult.reason;
          if (critiqueResult.usage) critiqueMeta.usage = critiqueResult.usage;
        }
        runtime.auditLog.createAndAppend({
          sessionId: 'model-critique-result-' + goalId,
          projectId,
          type: 'model_critique_result',
          source: 'critic-model',
          target: 'goal-' + goalId,
          goalId,
          result: {
            ok: critiqueResult.ok,
            failureReason: critiqueResult.ok ? undefined : critiqueResult.reason,
            metadata: critiqueMeta,
          },
        });

        if (!critiqueResult.ok) {
          let httpMessage = 'Model critique generation failed';
          if (critiqueResult.kind === 'schema-rejection') httpMessage += ': model output did not pass schema validation';
          else if (critiqueResult.kind === 'policy-rejection') httpMessage += ': model output violated policy constraints';
          else if (critiqueResult.kind === 'budget-exceeded') httpMessage += ': input exceeds token budget';
          else httpMessage += ': provider error';
          return error(409, httpMessage);
        }

        critiquePayload = critiqueResult.critique;
        criticMeta = {
          source: 'model-api',
          modelSuggested: true,
          provider: critiqueResult.provider,
          usage: critiqueResult.usage,
          latencyMs: critiqueResult.latencyMs,
        };
      }

      return ok({
        draft: modelResult.draft,
        critique: critiquePayload,
        plan: null,
        artifact: reasoningArtifact,
        meta: {
          source: 'model-api',
          modelSuggested: true,
          provider: modelResult.provider,
          usage: modelResult.usage,
          latencyMs: modelResult.latencyMs,
          critic: criticMeta,
        },
      });
    }

    // ════════════════════════════════════════════════
    // Default: review-cli path (unchanged)
    // ════════════════════════════════════════════════
    if (plannerSource !== 'review-cli') {
      return error(400, 'plannerSource must be "review-cli" or "model-api"');
    }
    if (criticSource !== 'none') {
      return error(400, 'criticSource requires plannerSource: "model-api"');
    }
    const availableEndpoints = Array.isArray(parsed.body.availableEndpoints)
      ? (parsed.body.availableEndpoints as string[]).filter(
        (v: unknown) => typeof v === 'string' && v.length > 0,
      )
      : undefined;
    const permittedTiers = Array.isArray(parsed.body.permittedTiers)
      ? (parsed.body.permittedTiers as string[])
        .filter((v: unknown) => v === 'patch-proposal' || v === 'workspace-write')
      : undefined;

    const result = await generatePlan(
      runtime.goalStore,
      runtime.auditLog,
      {
        goalId,
        commandConfig: DEFAULT_GOAL_PLAN_COMMAND_CONFIG,
        cwd: process.cwd(),
        availableEndpoints,
        permittedTiers: permittedTiers as GeneratePlanInput['permittedTiers'],
        commandOptions: runtime.goalPlanCommandOptions,
      },
    );
    runtime.persist();

    if (!result.ok) {
      return error(409, result.failureReason ?? 'plan generation failed');
    }
    return created({ plan: result.plan, meta: result.meta, downgrades: result.downgrades });
  }

  if (pathname === BRIDGE_AUTOMATION_BINDINGS_PATH && method === 'GET') {
    const planId = query?.get('planId');
    if (!planId) {
      return ok({ bindings: runtime.automationBindingStore.listBindings() });
    }
    const binding = runtime.automationBindingStore.getBinding(planId);
    if (!binding) {
      return error(404, 'Automation binding not found');
    }
    return ok({ binding });
  }

  if (pathname === BRIDGE_AUTOMATION_BINDINGS_PATH && method === 'POST') {
    const parsed = await readJsonBody(request);
    if (!parsed.ok) {
      return error(400, parsed.message);
    }
    const goalId = requireString(parsed.body, 'goalId');
    const planId = requireString(parsed.body, 'planId');
    if (!goalId || !planId) {
      return error(400, 'goalId and planId are required');
    }
    const goal = runtime.goalStore.getGoal(goalId);
    const plan = runtime.goalStore.getPlanById(planId);
    if (!goal || !plan || plan.goalId !== goalId) {
      return error(404, 'Goal or plan not found');
    }
    const executionWorkingDirectoryRef = requireString(parsed.body, 'executionWorkingDirectoryRef');
    if (executionWorkingDirectoryRef && resolveProjectKey(goal.projectId) !== executionWorkingDirectoryRef) {
      return error(409, 'Binding project reference must match goal project');
    }
    try {
      const binding = runtime.automationBindingStore.createBinding({
        goalId,
        planId,
        reasoningEndpointId: requireString(parsed.body, 'reasoningEndpointId') ?? '',
        executionEndpointId: requireString(parsed.body, 'executionEndpointId') ?? '',
        reasoningTier: requireString(parsed.body, 'reasoningTier') as AutomationReasoningTier,
        executionTier: requireString(parsed.body, 'executionTier') as AutomationExecutionTier,
        executionPermissionProfile: requireString(parsed.body, 'executionPermissionProfile') ?? '',
        executionWorkingDirectoryRef: executionWorkingDirectoryRef ?? '',
        maxSteps: typeof parsed.body.maxSteps === 'number' ? parsed.body.maxSteps : NaN,
        maxReasoningRounds: typeof parsed.body.maxReasoningRounds === 'number' ? parsed.body.maxReasoningRounds : NaN,
        deadlineAt: requireString(parsed.body, 'deadlineAt') ?? '',
      });
      runtime.persist();
      return created({ binding });
    } catch (err) {
      return error(409, err instanceof Error ? err.message : 'Automation binding rejected');
    }
  }

  if (pathname === BRIDGE_AUTOMATION_BINDINGS_DERIVE_PATH && method === 'POST') {
    const parsed = await readJsonBody(request);
    if (!parsed.ok) {
      return error(400, parsed.message);
    }
    const parentPlanId = requireString(parsed.body, 'parentPlanId');
    const goalId = requireString(parsed.body, 'goalId');
    const planId = requireString(parsed.body, 'planId');
    if (!parentPlanId || !goalId || !planId) {
      return error(400, 'parentPlanId, goalId and planId are required');
    }
    const goal = runtime.goalStore.getGoal(goalId);
    const parentPlan = runtime.goalStore.getPlanById(parentPlanId);
    if (!goal || !parentPlan || parentPlan.goalId !== goalId) {
      return error(404, 'Goal or parent plan not found');
    }
    try {
      const bindingDraft = runtime.automationBindingStore.previewDerivedBinding({
        parentPlanId,
        goalId,
        planId,
        reasoningEndpointId: typeof parsed.body.reasoningEndpointId === 'string' ? parsed.body.reasoningEndpointId : undefined,
        executionEndpointId: typeof parsed.body.executionEndpointId === 'string' ? parsed.body.executionEndpointId : undefined,
        reasoningTier: typeof parsed.body.reasoningTier === 'string' ? parsed.body.reasoningTier as AutomationReasoningTier : undefined,
        executionTier: typeof parsed.body.executionTier === 'string' ? parsed.body.executionTier as AutomationExecutionTier : undefined,
        executionPermissionProfile: typeof parsed.body.executionPermissionProfile === 'string' ? parsed.body.executionPermissionProfile : undefined,
        executionWorkingDirectoryRef: typeof parsed.body.executionWorkingDirectoryRef === 'string' ? parsed.body.executionWorkingDirectoryRef : undefined,
        maxSteps: typeof parsed.body.maxSteps === 'number' ? parsed.body.maxSteps : undefined,
        maxReasoningRounds: typeof parsed.body.maxReasoningRounds === 'number' ? parsed.body.maxReasoningRounds : undefined,
        deadlineAt: typeof parsed.body.deadlineAt === 'string' ? parsed.body.deadlineAt : undefined,
      });
      const derivedPlan = runtime.goalStore.derivePlan({ goalId, parentPlanId, id: planId });
      if (!derivedPlan) {
        return error(409, 'Derived plan could not be created');
      }
      const binding = runtime.automationBindingStore.commitBinding(bindingDraft);
      runtime.persist();
      return created({ plan: derivedPlan, binding });
    } catch (err) {
      return error(409, err instanceof Error ? err.message : 'Automation binding derivation rejected');
    }
  }

  if (pathname === BRIDGE_GOALS_APPROVE_PATH && method === 'POST') {
    const parsed = await readJsonBody(request);
    if (!parsed.ok) {
      return error(400, parsed.message);
    }
    const goalId = requireString(parsed.body, 'goalId');
    if (!goalId) {
      return error(400, 'goalId is required');
    }
    const plan = runtime.goalStore.approvePlan(goalId);
    if (!plan) {
      return error(409, 'Goal not found or plan cannot be approved');
    }
    const binding = runtime.automationBindingStore.lockBinding(plan.id);
    runtime.persist();
    return ok({ goal: runtime.goalStore.getGoal(goalId), plan, binding: binding ?? null });
  }

  if (pathname === BRIDGE_EXECUTION_PROPOSALS_PATH && method === 'POST') {
    const parsed = await readJsonBody(request);
    if (!parsed.ok) return error(400, parsed.message);
    const planId = requireString(parsed.body, 'planId');
    const stepId = requireString(parsed.body, 'stepId');
    const artifactId = requireString(parsed.body, 'artifactId');
    const preview = requireString(parsed.body, 'preview');
    const command = requireString(parsed.body, 'command');
    const stdin = requireString(parsed.body, 'stdin');
    const args = Array.isArray(parsed.body.args)
      ? parsed.body.args.filter((arg: unknown): arg is string => typeof arg === 'string')
      : null;
    const expiresAt = typeof parsed.body.expiresAt === 'number' ? parsed.body.expiresAt : Date.now() + 15 * 60_000;
    if (!planId || !stepId || !artifactId || !preview || !command || !stdin || !args) {
      return error(400, 'planId, stepId, artifactId, preview, command, args and stdin are required');
    }
    const binding = runtime.automationBindingStore.getBinding(planId);
    const plan = runtime.goalStore.getPlanById(planId);
    const artifact = runtime.reasoningArtifactStore.list({ planId })
      .find(item => item.artifactId === artifactId);
    if (!binding || !plan || !artifact) {
      return error(404, 'Plan binding or artifact not found');
    }
    const providerCapability = Object.values(KNOWN_PROVIDER_CAPABILITIES)
      .find(capability => capability.endpointId === binding.executionEndpointId);
    const invocationFailure = validateExecutionInvocation(
      providerCapability,
      command as 'codex' | 'claude',
      args,
    );
    if (invocationFailure) return error(409, invocationFailure);
    try {
      const draft = runtime.executionProposalStore.createDraft({
        binding,
        plan,
        stepId,
        artifact,
        preview,
        command: command as 'codex' | 'claude',
        args,
        stdin,
        expiresAt,
      });
      const proposal = runtime.executionProposalStore.requestConfirmation(draft.id);
      runtime.persist();
      return created({ proposal });
    } catch (err) {
      return error(409, err instanceof Error ? err.message : 'Execution proposal rejected');
    }
  }

  if (pathname === BRIDGE_EXECUTION_PROPOSALS_PATH && method === 'GET') {
    const planId = query?.get('planId') ?? undefined;
    const currentProposal = runtime.executionProposalStore.getCurrent({ planId });
    const currentBinding = currentProposal
      ? runtime.automationBindingStore.getBinding(currentProposal.planId)
      : planId
        ? runtime.automationBindingStore.getBinding(planId)
        : undefined;
    const bindings = planId
      ? (runtime.automationBindingStore.getBinding(planId)
        ? [runtime.automationBindingStore.getBinding(planId)]
        : [])
      : runtime.automationBindingStore.listBindings();
    return ok({
      bindings: bindings.filter(Boolean),
      proposals: runtime.executionProposalStore.list({ planId }),
      currentBinding,
      currentProposal,
    });
  }

  if (pathname === BRIDGE_EXECUTION_PROPOSALS_CONFIRM_PATH && method === 'POST') {
    const parsed = await readJsonBody(request);
    if (!parsed.ok) return error(400, parsed.message);
    const proposalId = requireString(parsed.body, 'proposalId');
    if (!proposalId) return error(400, 'proposalId is required');
    const result = runtime.executionProposalStore.confirm({
      proposalId,
      planId: requireString(parsed.body, 'planId') ?? '',
      stepId: requireString(parsed.body, 'stepId') ?? '',
      artifactId: requireString(parsed.body, 'artifactId') ?? '',
      contentHash: requireString(parsed.body, 'contentHash') ?? '',
      bindingHash: requireString(parsed.body, 'bindingHash') ?? '',
      executionEndpointId: requireString(parsed.body, 'executionEndpointId') ?? '',
      executionPermissionProfile: requireString(parsed.body, 'executionPermissionProfile') ?? '',
      projectId: requireString(parsed.body, 'projectId') ?? '',
    });
    if (!result.ok) return error(409, result.failureReason);
    runtime.persist();
    return ok({ proposal: result.proposal });
  }

  if (pathname === BRIDGE_EXECUTION_PROPOSALS_EDIT_PATH && method === 'POST') {
    const parsed = await readJsonBody(request);
    if (!parsed.ok) return error(400, parsed.message);
    const proposalId = requireString(parsed.body, 'proposalId');
    const artifactId = requireString(parsed.body, 'artifactId');
    const preview = requireString(parsed.body, 'preview');
    const stdin = requireString(parsed.body, 'stdin');
    if (!proposalId || !artifactId || !preview || !stdin) {
      return error(400, 'proposalId, artifactId, preview and stdin are required');
    }
    const existing = runtime.executionProposalStore.get(proposalId);
    if (!existing) return error(404, 'Proposal not found');
    const artifact = runtime.reasoningArtifactStore.list({ planId: existing.planId })
      .find(item => item.artifactId === artifactId);
    if (!artifact) return error(404, 'Artifact not found');
    try {
      const proposal = runtime.executionProposalStore.edit(proposalId, { artifact, preview, stdin });
      const awaiting = runtime.executionProposalStore.requestConfirmation(proposal.id);
      runtime.persist();
      return created({ proposal: awaiting });
    } catch (err) {
      return error(409, err instanceof Error ? err.message : 'Execution proposal edit rejected');
    }
  }

  if (
    pathname === BRIDGE_EXECUTION_PROPOSALS_PAUSE_PATH ||
    pathname === BRIDGE_EXECUTION_PROPOSALS_RESUME_PATH ||
    pathname === BRIDGE_EXECUTION_PROPOSALS_CANCEL_PATH
  ) {
    if (method !== 'POST') return error(405, 'Method not allowed');
    const parsed = await readJsonBody(request);
    if (!parsed.ok) return error(400, parsed.message);
    const proposalId = requireString(parsed.body, 'proposalId');
    if (!proposalId) return error(400, 'proposalId is required');
    const reason = requireString(parsed.body, 'reason') ?? 'operator-control';
    try {
      const proposal = pathname === BRIDGE_EXECUTION_PROPOSALS_PAUSE_PATH
        ? runtime.executionProposalStore.pause(proposalId, reason)
        : pathname === BRIDGE_EXECUTION_PROPOSALS_RESUME_PATH
          ? runtime.executionProposalStore.resume(proposalId)
          : runtime.executionProposalStore.cancel(proposalId);
      runtime.persist();
      return ok({ proposal });
    } catch (err) {
      return error(409, err instanceof Error ? err.message : 'Execution proposal control rejected');
    }
  }

  if (pathname === BRIDGE_EXECUTION_PROPOSALS_DISPATCH_PATH && method === 'POST') {
    const parsed = await readJsonBody(request);
    if (!parsed.ok) return error(400, parsed.message);
    const proposalId = requireString(parsed.body, 'proposalId');
    if (!proposalId) return error(400, 'proposalId is required');
    const proposal = runtime.executionProposalStore.get(proposalId);
    if (!proposal) return error(404, 'Proposal not found');
    const binding = runtime.automationBindingStore.getBinding(proposal.planId);
    const plan = runtime.goalStore.getPlanById(proposal.planId);
    if (!binding || !plan) return error(404, 'Plan binding not found');
    const providerCapability = Object.values(KNOWN_PROVIDER_CAPABILITIES)
      .find(capability => capability.endpointId === binding.executionEndpointId);
    const result = await dispatchExecutionProposal({
      store: runtime.executionProposalStore,
      proposalId,
      binding,
      plan,
      providerCapability,
      ...(runtime.commandRunOptions ?? {}),
    });
    runtime.persist();
    if (!result.ok) return error(409, result.failureReason);
    return ok({ proposal: result.proposal });
  }

  if (pathname === BRIDGE_GOALS_STEP_PATH && method === 'POST') {
    const parsed = await readJsonBody(request);
    if (!parsed.ok) {
      return error(400, parsed.message);
    }
    const goalId = requireString(parsed.body, 'goalId');
    if (!goalId) {
      return error(400, 'goalId is required');
    }
    // The /bridge/goals/step endpoint uses a fresh orchestrator per call so the
    // step ceiling is not accumulated across HTTP requests. Each call gets a
    // single advance.
    const { GoalOrchestrator } = await import('../goal/goal-orchestrator.ts');
    const orch = new GoalOrchestrator(runtime.goalStore);
    const result = orch.advance(goalId, { output: typeof parsed.body.output === 'string' ? parsed.body.output : undefined });
    runtime.persist();
    return ok({ result, stepsAdvanced: orch.stepsAdvanced });
  }

  if (pathname === BRIDGE_GOALS_GATE_PATH && method === 'POST') {
    const parsed = await readJsonBody(request);
    if (!parsed.ok) {
      return error(400, parsed.message);
    }
    const goalId = requireString(parsed.body, 'goalId');
    const stepId = requireString(parsed.body, 'stepId');
    if (!goalId || !stepId) {
      return error(400, 'goalId and stepId are required');
    }
    const step = runtime.goalStore.approveStepGate(goalId, stepId);
    if (!step) {
      return error(409, 'Step not found or cannot be gate-approved');
    }
    runtime.persist();
    return ok({ step, plan: runtime.goalStore.getPlanByGoal(goalId) });
  }

  if (pathname === BRIDGE_GOALS_CANCEL_PATH && method === 'POST') {
    const parsed = await readJsonBody(request);
    if (!parsed.ok) {
      return error(400, parsed.message);
    }
    const goalId = requireString(parsed.body, 'goalId');
    if (!goalId) {
      return error(400, 'goalId is required');
    }
    const goal = runtime.goalStore.cancelGoal(goalId);
    if (!goal) {
      return error(409, 'Goal not found or cannot be cancelled');
    }
    runtime.persist();
    return ok({ goal, plan: runtime.goalStore.getPlanByGoal(goalId) });
  }

  // ── EX-3: Goal Binding Snapshot ──

  // GET /bridge/goals/binding?goalId=...
  if (pathname === BRIDGE_GOALS_BINDING_PATH && method === 'GET') {
    const goalId = query?.get('goalId');
    if (!goalId) return error(400, 'goalId query parameter is required');
    const snapshot = runtime.bindingSnapshotStore.getLatest(goalId);
    if (!snapshot) return error(404, 'No binding snapshot for this goal');
    const history = runtime.bindingSnapshotStore.getHistory(goalId);
    const plan = runtime.goalStore.getPlanByGoal(goalId);
    const locked = !!(plan && plan.status !== 'draft' && plan.status !== 'awaiting-approval');
    return ok({ binding: snapshot, history, locked });
  }

  // POST /bridge/goals/rebind
  if (pathname === BRIDGE_GOALS_REBIND_PATH && method === 'POST') {
    const parsed = await readJsonBody(request);
    if (!parsed.ok) return error(400, parsed.message);
    const goalId = requireString(parsed.body, 'goalId');
    if (!goalId) return error(400, 'goalId is required');

    // Reject rebind after plan is locked.
    const plan = runtime.goalStore.getPlanByGoal(goalId);
    if (plan && plan.status !== 'draft' && plan.status !== 'awaiting-approval') {
      return error(409, 'Cannot rebind: plan is locked. Derive a new plan instead.');
    }

    // If no snapshot exists yet, use manual creation path.
    if (!runtime.bindingSnapshotStore.hasSnapshot(goalId)) {
      const plannerEndpointId = requireString(parsed.body, 'plannerEndpointId');
      const executorEndpointId = requireString(parsed.body, 'executorEndpointId');
      if (!plannerEndpointId || !executorEndpointId) {
        return error(400, 'plannerEndpointId and executorEndpointId are required for first binding');
      }
      const snapshot = runtime.bindingSnapshotStore.createManual({
        goalId,
        plannerEndpointId,
        executorEndpointId,
        verifierEndpointId: typeof parsed.body.verifierEndpointId === 'string'
          ? parsed.body.verifierEndpointId : undefined,
      });
      runtime.persist();
      return created({ binding: snapshot });
    }

    // Rebind existing snapshot — versioned replacement.
    const updates: Record<string, string | undefined> = {};
    if (typeof parsed.body.executorEndpointId === 'string') updates.executorEndpointId = parsed.body.executorEndpointId;
    if (typeof parsed.body.plannerEndpointId === 'string') updates.plannerEndpointId = parsed.body.plannerEndpointId;
    if (typeof parsed.body.verifierEndpointId === 'string') updates.verifierEndpointId = parsed.body.verifierEndpointId;
    if (Object.keys(updates).length === 0) {
      const latest = runtime.bindingSnapshotStore.getLatest(goalId);
      return ok({ binding: latest, message: 'No changes requested' });
    }
    const snapshot = runtime.bindingSnapshotStore.rebind(goalId, updates);
    if (!snapshot) return error(404, 'Goal not found or has no snapshot');
    runtime.persist();
    return ok({ binding: snapshot });
  }

  return error(405, 'Method not allowed');
}

export function writeBridgeResult(
  result: BridgeResult,
  response: ServerResponse<IncomingMessage>,
): void {
  response.statusCode = result.statusCode;
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.end(`${JSON.stringify(result.payload)}\n`);
}
