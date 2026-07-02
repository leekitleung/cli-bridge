import { setTimeout as delay } from 'node:timers/promises';

export interface WorkerFetchResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

export type WorkerFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<WorkerFetchResponse>;

export interface WorkBuddyWorkerOptions {
  endpointId: string;
  baseUrl: string;
  pairingToken: string;
  pollIntervalMs?: number;
  fetchFn?: WorkerFetch;
}

export type WorkBuddyWorkerTickResult =
  | { type: 'idle' }
  | { type: 'returned'; taskId: string }
  | { type: 'failed'; taskId?: string; reason: string };

export interface WorkBuddyWorker {
  endpointId: string;
  baseUrl: string;
  pairingToken: string;
  pollIntervalMs: number;
  fetchFn: WorkerFetch;
}

const TOKEN_HEADER = 'x-cli-bridge-pairing-token';

export function createWorkBuddyWorker(options: WorkBuddyWorkerOptions): WorkBuddyWorker {
  return {
    endpointId: options.endpointId,
    baseUrl: options.baseUrl.replace(/\/$/, ''),
    pairingToken: options.pairingToken,
    pollIntervalMs: options.pollIntervalMs ?? 1_000,
    fetchFn: options.fetchFn ?? (fetch as unknown as WorkerFetch),
  };
}

export async function onceWorkBuddyWorker(worker: WorkBuddyWorker): Promise<WorkBuddyWorkerTickResult> {
  const inbox = await requestJson(worker, `/bridge/endpoints/${encodeURIComponent(worker.endpointId)}/inbox/next`, 'GET');
  if (!inbox.ok) return { type: 'failed', reason: `inbox ${inbox.status}` };
  const task = (inbox.payload as { task?: unknown }).task;
  if (!task || typeof task !== 'object') return { type: 'idle' };

  const taskRecord = task as { taskId?: unknown; proposalId?: unknown; prompt?: unknown };
  if (typeof taskRecord.taskId !== 'string' || typeof taskRecord.proposalId !== 'string') {
    return { type: 'failed', reason: 'invalid task payload' };
  }

  // ADR-0032 P1: record a worker log entry when the task is claimed.
  await requestJson(worker, `/bridge/endpoints/${encodeURIComponent(worker.endpointId)}/log`, 'POST', {
    taskId: taskRecord.taskId,
    endpointId: worker.endpointId,
    kind: 'progress',
    message: 'worker claimed task',
  });

  const stdout = `diagnostic worker received: ${typeof taskRecord.prompt === 'string' ? taskRecord.prompt : ''}`;
  const result = await requestJson(worker, `/bridge/endpoints/${encodeURIComponent(worker.endpointId)}/results`, 'POST', {
    taskId: taskRecord.taskId,
    proposalId: taskRecord.proposalId,
    ok: true,
    stdout,
    output: stdout,
    durationMs: 0,
  });

  if (!result.ok) return { type: 'failed', taskId: taskRecord.taskId, reason: `results ${result.status}` };

  // Record a "returned" log entry after posting the result.
  await requestJson(worker, `/bridge/endpoints/${encodeURIComponent(worker.endpointId)}/log`, 'POST', {
    taskId: taskRecord.taskId,
    endpointId: worker.endpointId,
    kind: 'progress',
    message: 'worker returned result',
  });

  return { type: 'returned', taskId: taskRecord.taskId };
}

export async function runWorkBuddyWorker(worker: WorkBuddyWorker, signal?: AbortSignal): Promise<void> {
  while (!signal?.aborted) {
    await onceWorkBuddyWorker(worker);
    await delay(worker.pollIntervalMs, undefined, { signal }).catch(() => undefined);
  }
}

async function requestJson(
  worker: WorkBuddyWorker,
  path: string,
  method: 'GET' | 'POST',
  body?: unknown,
): Promise<{ ok: boolean; status: number; payload: unknown }> {
  const response = await worker.fetchFn(`${worker.baseUrl}${path}`, {
    method,
    headers: {
      [TOKEN_HEADER]: worker.pairingToken,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const raw = await response.text();
  let payload: unknown = {};
  if (raw.length > 0) {
    try { payload = JSON.parse(raw); } catch { payload = { raw }; }
  }
  return { ok: response.ok, status: response.status, payload };
}
