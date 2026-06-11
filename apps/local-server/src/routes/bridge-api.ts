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
} from '../endpoints/mock-endpoints.ts';
import { runCommandReview } from '../review/command-review-runner.ts';
import { buildClaudeReviewPrompt } from '../review/claude-review-prompt.ts';
import { InMemoryGoalStore } from '../storage/goal-store.ts';
import { InMemoryWorkBuddyStateStore } from '../workbuddy/workbuddy-state-store.ts';
import { InMemoryTeamSpecStore } from '../storage/team-store.ts';
import { validateTeamSpecCreate, validateSlotArtifact, detectFileConflicts } from '../../../../packages/shared/src/schemas.ts';
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
  AgentReviewRequest,
  AuditEvent,
  Goal,
  PendingPrompt,
  Plan,
  ProjectSummary,
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
  endpointRegistry: InMemoryEndpointRegistry;
  pendingReviewStore: InMemoryPendingReviewStore;
  // Resolves a review target endpoint id to its command adapter. Tests inject a
  // fake here so they never spawn a real CLI; production uses the default map.
  reviewAdapterFor: (targetEndpointId: string) => CommandReviewAdapter | undefined;
  agent: MockAgentAdapter;
  persist: () => void;
  // v2.0 Goal-driven execution (ADR-0003). Goal/plan/project data is
  // persisted in the JSON snapshot (v2).
  goalStore: InMemoryGoalStore;
  // Phase B project grouping plus limited metadata/archive state.
  projectStore: InMemoryProjectStore;
  /** Command runner override for goal→plan generation (test injection). */
  goalPlanCommandOptions?: CommandRunOptions;
  // v2.2 WorkBuddy non-executing task system.
  workbuddyStore: InMemoryWorkBuddyStateStore;
  teamStore: InMemoryTeamSpecStore;
}

export interface BridgeRuntimeOptions {
  // When set, the runtime hydrates from and persists to a JSON snapshot in this
  // directory. When omitted, the runtime stays fully in-memory.
  dataDir?: string;
  // Override the review command adapter resolution (used by tests to avoid
  // spawning real CLIs). When omitted, the default real adapters are used.
  reviewAdapterFor?: (targetEndpointId: string) => CommandReviewAdapter | undefined;
  // Override the command runner used by goal→plan generation (used by tests to
  // avoid spawning a real CLI). When omitted, the default runner is used.
  goalPlanCommandOptions?: CommandRunOptions;
}


/** Matches /bridge/projects/:key/teams and /bridge/projects/:key/teams/:teamId/{approve|cancel}. */
function matchProjectTeamPath(pathname: string): {
  matched: true; key: string | undefined; sub: '' | 'approve' | 'cancel'; teamId?: string;
} | { matched: false } {
  const prefix = BRIDGE_PROJECTS_PATH + '/';
  if (!pathname.startsWith(prefix)) return { matched: false };
  const rest = pathname.slice(prefix.length);
  // Check sub-actions: :key/teams/:teamId/approve or :key/teams/:teamId/cancel
  for (const action of ['approve', 'cancel'] as const) {
    const actionSuffix = '/teams/';
    const idx = rest.indexOf(actionSuffix);
    if (idx !== -1) {
      const raw = rest.slice(0, idx);
      if (raw.length === 0 || raw.includes('/')) continue;
      const remaining = rest.slice(idx + actionSuffix.length);
      const slashIdx = remaining.lastIndexOf('/' + action);
      if (slashIdx !== -1 && remaining === remaining.slice(0, slashIdx) + '/' + action) {
        const teamId = remaining.slice(0, slashIdx);
        if (teamId.length === 0) continue;
        try {
          const decoded = decodeURIComponent(raw);
          const key = decoded ? (validateProjectKey(decoded) ?? undefined) : undefined;
          return { matched: true, key, sub: action, teamId: decodeURIComponent(teamId) };
        } catch { return { matched: true, key: undefined, sub: action, teamId }; }
      }
    }
  }
  // Basic /teams path: :key/teams or :key/teams (exact)
  if (!rest.endsWith('/teams')) return { matched: false };
  const raw = rest.slice(0, -6);
  if (raw.length === 0 || raw.includes('/')) return { matched: false };
  try {
    const decoded = decodeURIComponent(raw);
    const key = decoded ? (validateProjectKey(decoded) ?? undefined) : undefined;
    return { matched: true, key, sub: '' };
  } catch { return { matched: true, key: undefined, sub: '' }; }
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

  // Policy checks
  const goal = runtime.goalStore.getGoal(body.goalId as string);
  if (!goal) return error(400, 'Goal not found');
  if (goal.status !== 'approved') return error(400, 'Goal must be approved');

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
    }
  }

  try {
    const team = runtime.teamStore.create({
      ...(body as any), projectId: projectKey,
    });
    runtime.persist();

    // Audit
    runtime.auditLog.createAndAppend({
      sessionId: 'team-create-' + team.id,
      projectId: projectKey,
      type: 'operation_failed' as any,
      source: 'team-orchestrator',
      target: 'team-' + team.id,
      result: { ok: true },
    });

    return created({ team });
  } catch (err: any) {
    return error(400, err?.message ?? 'TeamSpec creation failed');
  }
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

export function createBridgeRuntime(options: BridgeRuntimeOptions = {}): BridgeRuntime {
  const packetStore = new InMemoryPacketStore();
  const auditLog = new InMemoryAuditLog();
  const pendingPromptStore = new InMemoryPendingPromptStore(packetStore, auditLog);
  const outboundPromptStore = new InMemoryOutboundPromptStore(packetStore, auditLog);
  const endpointRegistry = new InMemoryEndpointRegistry([
    ...DEFAULT_AGENT_ENDPOINTS,
    CLAUDE_CODE_REVIEW_COMMAND_ENDPOINT,
    CODEX_REVIEW_COMMAND_ENDPOINT,
  ]);
  const pendingReviewStore = new InMemoryPendingReviewStore(
    endpointRegistry,
    packetStore,
    auditLog,
    pendingPromptStore,
  );
  const agent = new MockAgentAdapter();
  const goalStore = new InMemoryGoalStore();
  const projectStore = new InMemoryProjectStore();

  const dataDir = options.dataDir ?? resolveDataDirFromEnv();
  const snapshotStore = dataDir ? new JsonSnapshotStore(dataDir) : null;

  const workbuddyStore = new InMemoryWorkBuddyStateStore();
  const teamStore = new InMemoryTeamSpecStore();

  if (snapshotStore) {
    const read = snapshotStore.read();
    if (read.ok && read.snapshot) {
      packetStore.hydratePackets(read.snapshot.packets);
      auditLog.hydrateEvents(read.snapshot.auditEvents);
      pendingPromptStore.hydratePrompts(read.snapshot.pendingPrompts);
      outboundPromptStore.hydratePrompts(read.snapshot.outboundPrompts ?? []);
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
      for (const e of read.snapshot.workbuddyExecutionLedgerEvents ?? []) {
        try { workbuddyStore.recordExecutionLedgerEvent(e); } catch { }
      }
    }
  }

  const persist = (): void => {
    if (!snapshotStore) return;
    snapshotStore.write(buildSnapshot({
      packets: packetStore.exportPackets(),
      auditEvents: auditLog.exportEvents(),
      pendingPrompts: pendingPromptStore.exportPrompts(),
      outboundPrompts: outboundPromptStore.exportPrompts(),
      goals: goalStore.exportGoals(),
      plans: goalStore.exportPlans(),
      projects: projectStore.exportProjects(),
      workbuddyTaskReferences: workbuddyStore.listTaskReferences(),
      workbuddyReviewResultSinks: workbuddyStore.listReviewResultSinks(),
      workbuddyPromptDraftSinks: workbuddyStore.listPromptDraftSinks(),
      workbuddyExecutionLedgerEvents: workbuddyStore.listExecutionLedgerEvents(),
      teams: teamStore.exportTeams(),
      teamArtifacts: teamStore.exportArtifacts(),
    }));
  };

  return {
    packetStore,
    auditLog,
    pendingPromptStore,
    outboundPromptStore,
    endpointRegistry,
    pendingReviewStore,
    reviewAdapterFor: options.reviewAdapterFor
      ?? ((targetEndpointId: string) => {
        const factory = REVIEW_COMMAND_ADAPTERS[targetEndpointId];
        return factory ? factory() : undefined;
      }),
    agent,
    persist,
    goalStore,
    projectStore,
    goalPlanCommandOptions: options.goalPlanCommandOptions,
    workbuddyStore,
    teamStore,
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

interface ProjectDerivedStatus {
  progress: { completed: number; total: number } | null;
  activeGoal: { id: string; description: string; status: Goal['status'] } | null;
  goalsSummary: Array<{ id: string; description: string; status: Goal['status'] }>;
  blockedGate: { goalId: string; stepId: string; stepIndex: number } | null;
  latestAudit: AuditEvent | null;
  memory: [];
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

function buildProjectStatus(goals: GoalWithPlan[], auditEvents: AuditEvent[] = []): ProjectDerivedStatus {
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
    memory: [],
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

  return {
    summary,
    goals,
    reviews,
    pendingPrompts,
    auditEvents,
    status: buildProjectStatus(goals, auditEvents),
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
  action: 'archive' | 'unarchive',
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

  return { projectId: projectKey, goals, plans, reviews, pendingPrompts, auditEvents };
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

export const BRIDGE_PACKETS_PATH = '/bridge/packets';
export const BRIDGE_PENDING_PROMPTS_PATH = '/bridge/pending-prompts';
export const BRIDGE_PENDING_PROMPTS_CONFIRM_PATH = '/bridge/pending-prompts/confirm';
export const BRIDGE_PENDING_PROMPTS_SEND_PATH = '/bridge/pending-prompts/send';
export const BRIDGE_PENDING_PROMPTS_CANCEL_PATH = '/bridge/pending-prompts/cancel';
export const BRIDGE_OUTBOUND_PATH = '/bridge/outbound';
export const BRIDGE_OUTBOUND_NEXT_PATH = '/bridge/outbound/next';
export const BRIDGE_OUTBOUND_ACK_PATH = '/bridge/outbound/ack';
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

// v2.1 Read-only project observability endpoints.
export const BRIDGE_PROJECT_TIMELINE_SUFFIX = '/timeline';
export const BRIDGE_PROJECT_AUDIT_SUFFIX = '/audit';
export const BRIDGE_PROJECT_MEMORY_SUFFIX = '/memory';
export const BRIDGE_PROJECT_VERIFICATION_SUFFIX = '/verification';

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
    BRIDGE_PROJECT_MEMORY_SUFFIX, BRIDGE_PROJECT_VERIFICATION_SUFFIX]) {
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

export function isBridgePath(pathname: string): boolean {
  return pathname === BRIDGE_PACKETS_PATH ||
    pathname === BRIDGE_PENDING_PROMPTS_PATH ||
    pathname === BRIDGE_PENDING_PROMPTS_CONFIRM_PATH ||
    pathname === BRIDGE_PENDING_PROMPTS_SEND_PATH ||
    pathname === BRIDGE_PENDING_PROMPTS_CANCEL_PATH ||
    pathname === BRIDGE_OUTBOUND_PATH ||
    pathname === BRIDGE_OUTBOUND_NEXT_PATH ||
    pathname === BRIDGE_OUTBOUND_ACK_PATH ||
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
    pathname === BRIDGE_GOALS_PATH;
}

export async function handleBridgeRequest(
  runtime: BridgeRuntime,
  method: string,
  pathname: string,
  request: IncomingMessage,
  query?: URLSearchParams,
): Promise<BridgeResult> {
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
    const outboundPrompt = runtime.outboundPromptStore.createOutboundPrompt({
      sessionId,
      prompt,
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
    const okValue = parsed.body.ok;
    if (!outboundPromptId || typeof okValue !== 'boolean') {
      return error(400, 'outboundPromptId and ok are required');
    }
    const failureReason = typeof parsed.body.failureReason === 'string'
      ? parsed.body.failureReason
      : undefined;
    const outboundPrompt = runtime.outboundPromptStore.acknowledge({
      id: outboundPromptId,
      ok: okValue,
      failureReason,
    });
    if (!outboundPrompt) {
      return error(409, 'Outbound prompt cannot be acknowledged');
    }
    runtime.persist();
    return ok({ outboundPrompt });
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
      return error(409, runResult.failureReason ?? 'Review run failed');
    }
    return ok({
      review: runtime.pendingReviewStore.get(reviewId),
      result: runResult.returned?.result,
      nextPrompt: runResult.returned?.nextPrompt,
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
    // Only label and description are writable.
    const label = typeof parsed.body.label === 'string' && parsed.body.label.trim().length > 0
      ? parsed.body.label.trim() : undefined;
    const description = typeof parsed.body.description === 'string'
      ? parsed.body.description : undefined;
    // Reject disallowed fields.
    if ('key' in parsed.body || 'createdAt' in parsed.body || 'archivedAt' in parsed.body) {
      return error(400, 'Only label and description can be updated');
    }
    const updated = runtime.projectStore.upsert({
      key: projectKey,
      label,
      description,
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
      return ok(buildHarnessVerification(obsInput));
    }
    return error(404, 'Not found');
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
    return ok({ teams: runtime.teamStore.listByProject(teamMatch.key) });
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
    return ok({ team });
  }
  if (teamMatch.matched) return error(405, 'Method not allowed');

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
    runtime.persist();
    return created({ goal });
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
    runtime.persist();
    return ok({ goal: runtime.goalStore.getGoal(goalId), plan });
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
