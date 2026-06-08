import type {
  IncomingMessage,
  ServerResponse,
} from 'node:http';

import { MockAgentAdapter } from '../adapters/MockAgentAdapter.ts';
import { InMemoryAuditLog } from '../storage/audit-log.ts';
import {
  buildSnapshot,
  JsonSnapshotStore,
} from '../storage/json-snapshot-store.ts';
import { createMetricsSummary } from '../storage/metrics-summary.ts';
import { InMemoryPacketStore } from '../storage/packet-store.ts';
import { InMemoryPendingPromptStore } from '../storage/pending-prompt-store.ts';

const MAX_BODY_BYTES = 1_000_000;

export interface BridgeRuntime {
  packetStore: InMemoryPacketStore;
  auditLog: InMemoryAuditLog;
  pendingPromptStore: InMemoryPendingPromptStore;
  agent: MockAgentAdapter;
  persist: () => void;
}

export interface BridgeRuntimeOptions {
  // When set, the runtime hydrates from and persists to a JSON snapshot in this
  // directory. When omitted, the runtime stays fully in-memory.
  dataDir?: string;
}

export function createBridgeRuntime(options: BridgeRuntimeOptions = {}): BridgeRuntime {
  const packetStore = new InMemoryPacketStore();
  const auditLog = new InMemoryAuditLog();
  const pendingPromptStore = new InMemoryPendingPromptStore(packetStore, auditLog);
  const agent = new MockAgentAdapter();

  const dataDir = options.dataDir ?? resolveDataDirFromEnv();
  const snapshotStore = dataDir ? new JsonSnapshotStore(dataDir) : null;

  if (snapshotStore) {
    const read = snapshotStore.read();
    if (read.ok && read.snapshot) {
      packetStore.hydratePackets(read.snapshot.packets);
      auditLog.hydrateEvents(read.snapshot.auditEvents);
      pendingPromptStore.hydratePrompts(read.snapshot.pendingPrompts);
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
    ));
  };

  return {
    packetStore,
    auditLog,
    pendingPromptStore,
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
export const BRIDGE_METRICS_PATH = '/bridge/metrics';

export function isBridgePath(pathname: string): boolean {
  return pathname === BRIDGE_PACKETS_PATH ||
    pathname === BRIDGE_PENDING_PROMPTS_PATH ||
    pathname === BRIDGE_PENDING_PROMPTS_CONFIRM_PATH ||
    pathname === BRIDGE_PENDING_PROMPTS_SEND_PATH ||
    pathname === BRIDGE_PENDING_PROMPTS_CANCEL_PATH ||
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
