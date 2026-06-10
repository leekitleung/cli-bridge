import type {
  IncomingMessage,
  ServerResponse,
} from 'node:http';

import { MockAgentAdapter } from '../adapters/MockAgentAdapter.ts';
import {
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
import { generatePlan } from '../goal/goal-plan-generator.ts';
import type { GeneratePlanInput } from '../goal/goal-plan-generator.ts';
import type { CommandRunOptions } from '../adapters/command-runner.ts';
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

const MAX_BODY_BYTES = 1_000_000;

// Maps a review target endpoint id to its command adapter factory. Only
// review-only command endpoints are runnable; anything else is rejected by
// capability gating before reaching here.
const REVIEW_COMMAND_ADAPTERS: Record<string, () => CommandReviewAdapter> = {
  'claude-code-command': createClaudeReviewCommandAdapter,
  'codex-command': createCodexReviewCommandAdapter,
};

// Default command config for goal→plan generation. Production routes
// through the same review-only CLI that the review endpoints use; tests
// override it via BridgeRuntimeOptions.goalPlanCommandOptions.
const DEFAULT_GOAL_PLAN_COMMAND_CONFIG: GeneratePlanInput['commandConfig'] = {
  adapterName: 'goal-plan-generator',
  command: 'claude',
  argv: ['-p', '--output-format', 'json'],
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
  // v2.0 Goal-driven execution (ADR-0003). In-memory only — goal data is not
  // included in the JSON snapshot at this time.
  goalStore: InMemoryGoalStore;
  // Phase B Project grouping. Read-only aggregation only; no mutation authority.
  projectStore: InMemoryProjectStore;
  /** Command runner override for goal→plan generation (test injection). */
  goalPlanCommandOptions?: CommandRunOptions;
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

  if (snapshotStore) {
    const read = snapshotStore.read();
    if (read.ok && read.snapshot) {
      packetStore.hydratePackets(read.snapshot.packets);
      auditLog.hydrateEvents(read.snapshot.auditEvents);
      pendingPromptStore.hydratePrompts(read.snapshot.pendingPrompts);
      outboundPromptStore.hydratePrompts(read.snapshot.outboundPrompts ?? []);
    }
  }

  const persist = (): void => {
    if (!snapshotStore) {
      return;
    }
    // Best-effort: only redacted/persistable records are exported. Raw content
    // is never part of these exports.
    snapshotStore.write(buildSnapshot(
      packetStore.exportPackets(),
      auditLog.exportEvents(),
      pendingPromptStore.exportPrompts(),
      outboundPromptStore.exportPrompts(),
    ));
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
  latestAudit: null;
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

function buildProjectStatus(goals: GoalWithPlan[]): ProjectDerivedStatus {
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
    // These sources are introduced by later Phase B slices (task 17).
    latestAudit: null,
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
    .filter((event) => event.packetId ? scopedRecordIds.has(event.packetId) : false);

  return {
    summary,
    goals,
    reviews,
    pendingPrompts,
    auditEvents,
    status: buildProjectStatus(goals),
  };
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
  try {
    const decoded = decodeURIComponent(raw);
    return validateProjectKey(decoded) ?? undefined;
  } catch {
    return undefined;
  }
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
    const pendingPrompt = runtime.pendingPromptStore.createPendingPrompt({
      sessionId,
      prompt,
      source: 'chatgpt-web',
      transport: 'clipboard',
      projectId: projectId ?? undefined,
    });
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
      review = runtime.pendingReviewStore.createDraft({
        sessionId,
        sourceEndpointId,
        targetEndpointId,
        prompt,
        projectId: projectId ?? undefined,
      });
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

  // ── Phase B Project aggregation (read-only; no new mutation authority) ──

  if (pathname === BRIDGE_PROJECTS_PATH && method === 'GET') {
    return ok({ projects: buildProjectSummaries(runtime) });
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
    const goal = runtime.goalStore.createGoal({ sessionId, description, projectId: projectId ?? undefined });
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
    const cwd = requireString(parsed.body, 'cwd');
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
        cwd: cwd ?? undefined,
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
