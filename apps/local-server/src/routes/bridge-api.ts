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
import { InMemoryAuditLog } from '../storage/audit-log.ts';
import {
  buildSnapshot,
  JsonSnapshotStore,
} from '../storage/json-snapshot-store.ts';
import { createMetricsSummary } from '../storage/metrics-summary.ts';
import { InMemoryOutboundPromptStore } from '../storage/outbound-prompt-store.ts';
import { InMemoryPacketStore } from '../storage/packet-store.ts';
import { InMemoryPendingPromptStore } from '../storage/pending-prompt-store.ts';
import { InMemoryPendingReviewStore } from '../storage/pending-review-store.ts';

const MAX_BODY_BYTES = 1_000_000;

// Maps a review target endpoint id to its command adapter factory. Only
// review-only command endpoints are runnable; anything else is rejected by
// capability gating before reaching here.
const REVIEW_COMMAND_ADAPTERS: Record<string, () => CommandReviewAdapter> = {
  'claude-code-command': createClaudeReviewCommandAdapter,
  'codex-command': createCodexReviewCommandAdapter,
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
}

export interface BridgeRuntimeOptions {
  // When set, the runtime hydrates from and persists to a JSON snapshot in this
  // directory. When omitted, the runtime stays fully in-memory.
  dataDir?: string;
  // Override the review command adapter resolution (used by tests to avoid
  // spawning real CLIs). When omitted, the default real adapters are used.
  reviewAdapterFor?: (targetEndpointId: string) => CommandReviewAdapter | undefined;
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
    pathname === BRIDGE_METRICS_PATH;
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
    const pendingPrompt = runtime.pendingPromptStore.createPendingPrompt({
      sessionId,
      prompt,
      source: 'chatgpt-web',
      transport: 'clipboard',
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
      review = runtime.pendingReviewStore.createDraft({
        sessionId,
        sourceEndpointId,
        targetEndpointId,
        prompt,
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
