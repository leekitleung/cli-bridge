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

/**
 * ADR-0034: Backend interface for real execution.
 * Without a backend, the worker cannot produce real output — it must return failed/blocked.
 */
export interface WorkBuddyExecutorBackend {
  /** Execute a task and return the real result. */
  execute(task: {
    taskId: string;
    proposalId: string;
    prompt: string;
    workingDirectory?: string;
  }): Promise<{
    ok: boolean;
    stdout: string;
    stderr?: string;
    exitCode?: number;
    output?: unknown;
    failureReason?: string;
  }>;
}

export type WorkBuddyWorkerMode = 'diagnostic' | 'disabled';

export interface WorkBuddyWorkerOptions {
  endpointId: string;
  baseUrl: string;
  pairingToken: string;
  pollIntervalMs?: number;
  fetchFn?: WorkerFetch;
  /** ADR-0034: Worker mode. 'diagnostic' runs channel probes only. 'disabled' does not poll. */
  mode?: WorkBuddyWorkerMode;
  /**
   * ADR-0034: Real execution backend. Without this, the worker CANNOT produce
   * real executor output. Omit to run as diagnostic-only or disabled.
   */
  backend?: WorkBuddyExecutorBackend;
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
  mode: WorkBuddyWorkerMode;
  backend: WorkBuddyExecutorBackend | null;
}

const TOKEN_HEADER = 'x-cli-bridge-pairing-token';

export function createWorkBuddyWorker(options: WorkBuddyWorkerOptions): WorkBuddyWorker {
  return {
    endpointId: options.endpointId,
    baseUrl: options.baseUrl.replace(/\/$/, ''),
    pairingToken: options.pairingToken,
    pollIntervalMs: options.pollIntervalMs ?? 1_000,
    fetchFn: options.fetchFn ?? (fetch as unknown as WorkerFetch),
    mode: options.mode ?? 'diagnostic',
    backend: options.backend ?? null,
  };
}

/**
 * ADR-0034: Diagnostic worker tick — claims a task and returns a diagnostic echo.
 * Diagnostic results use a distinct marker that the server filters from the main
 * conversation transcript. Never declares executor readiness.
 */
async function onceDiagnosticWorker(worker: WorkBuddyWorker): Promise<WorkBuddyWorkerTickResult> {
  const inbox = await requestJson(worker, `/bridge/endpoints/${encodeURIComponent(worker.endpointId)}/inbox/next`, 'GET');
  if (!inbox.ok) return { type: 'failed', reason: `inbox ${inbox.status}` };
  const task = (inbox.payload as { task?: unknown }).task;
  if (!task || typeof task !== 'object') return { type: 'idle' };

  const taskRecord = task as { taskId?: unknown; proposalId?: unknown; prompt?: unknown };
  if (typeof taskRecord.taskId !== 'string' || typeof taskRecord.proposalId !== 'string') {
    return { type: 'failed', reason: 'invalid task payload' };
  }

  // Diagnostic workers only log progress, they do NOT declare executor readiness.
  await requestJson(worker, `/bridge/endpoints/${encodeURIComponent(worker.endpointId)}/log`, 'POST', {
    taskId: taskRecord.taskId,
    endpointId: worker.endpointId,
    kind: 'info',
    message: 'diagnostic probe: channel reachable',
  });

  // ADR-0034: Diagnostic result uses a distinct pattern so the server can filter it.
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

  return { type: 'returned', taskId: taskRecord.taskId };
}

/**
 * ADR-0034: Real worker tick — sends heartbeat, claims a task, executes via backend.
 * Without a backend, returns failed — never produces fake output.
 */
async function onceRealWorker(worker: WorkBuddyWorker): Promise<WorkBuddyWorkerTickResult> {
  if (!worker.backend) {
    // REVIEW: No backend → cannot produce real output. Return failed, do not fabricate results.
    return { type: 'failed', reason: 'real worker has no execution backend configured' };
  }

  // Send heartbeat to declare readiness.
  await requestJson(worker, `/bridge/endpoints/${encodeURIComponent(worker.endpointId)}/heartbeat`, 'POST', {
    capabilities: { canExecute: true },
  });

  const inbox = await requestJson(worker, `/bridge/endpoints/${encodeURIComponent(worker.endpointId)}/inbox/next`, 'GET');
  if (!inbox.ok) return { type: 'failed', reason: `inbox ${inbox.status}` };
  const task = (inbox.payload as { task?: unknown }).task;
  if (!task || typeof task !== 'object') return { type: 'idle' };

  const taskRecord = task as { taskId?: unknown; proposalId?: unknown; prompt?: unknown; workingDirectory?: unknown };
  if (typeof taskRecord.taskId !== 'string' || typeof taskRecord.proposalId !== 'string') {
    return { type: 'failed', reason: 'invalid task payload' };
  }

  // Record a real worker log entry when the task is claimed.
  await requestJson(worker, `/bridge/endpoints/${encodeURIComponent(worker.endpointId)}/log`, 'POST', {
    taskId: taskRecord.taskId,
    endpointId: worker.endpointId,
    kind: 'progress',
    message: 'real worker claimed task',
  });

  // Execute via backend.
  const startTime = Date.now();
  let execResult;
  try {
    execResult = await worker.backend.execute({
      taskId: taskRecord.taskId,
      proposalId: taskRecord.proposalId,
      prompt: typeof taskRecord.prompt === 'string' ? taskRecord.prompt : '',
      workingDirectory: typeof taskRecord.workingDirectory === 'string' ? taskRecord.workingDirectory : undefined,
    });
  } catch (err) {
    return { type: 'failed', taskId: taskRecord.taskId, reason: `backend execution error: ${String(err)}` };
  }

  const durationMs = Date.now() - startTime;

  const result = await requestJson(worker, `/bridge/endpoints/${encodeURIComponent(worker.endpointId)}/results`, 'POST', {
    taskId: taskRecord.taskId,
    proposalId: taskRecord.proposalId,
    ok: execResult.ok,
    stdout: execResult.stdout ?? '',
    stderr: execResult.stderr ?? '',
    output: execResult.output,
    exitCode: execResult.exitCode ?? (execResult.ok ? 0 : 1),
    failureReason: execResult.failureReason,
    durationMs,
  });

  if (!result.ok) return { type: 'failed', taskId: taskRecord.taskId, reason: `results ${result.status}` };

  // Record a "returned" log entry after posting the result.
  await requestJson(worker, `/bridge/endpoints/${encodeURIComponent(worker.endpointId)}/log`, 'POST', {
    taskId: taskRecord.taskId,
    endpointId: worker.endpointId,
    kind: 'progress',
    message: 'real worker returned result',
  });

  return { type: 'returned', taskId: taskRecord.taskId };
}

export async function onceWorkBuddyWorker(worker: WorkBuddyWorker): Promise<WorkBuddyWorkerTickResult> {
  if (worker.mode === 'disabled') return { type: 'idle' };
  if (!worker.backend) {
    return onceDiagnosticWorker(worker);
  }
  return onceRealWorker(worker);
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
