// EX-4: WorkBuddy Execution Adapter
//
// Pull-based inbox/result protocol. WorkBuddy pulls execution tasks from
// its inbox rather than receiving pushed commands from the middle layer.
// This adapter manages:
//   - inbox: pending execution tasks that WorkBuddy polls via GET /inbox/next
//   - results: structured execution results returned via POST /results
//   - log: structured execution log entries via POST /log
//
// WorkBuddy MUST NOT self-confirm proposals, modify bindings, or choose
// its own project root. Output must pass schema validation.

import { randomUUID } from 'node:crypto';

export interface WorkBuddyExecutionTask {
  taskId: string;
  endpointId: string;
  proposalId: string;
  planId: string;
  goalId: string;
  bindingHash: string;
  /** Execution prompt or task description. */
  prompt: string;
  /** Resolved working directory (server-owned, not WorkBuddy-supplied). */
  workingDirectory: string;
  /** Max execution time in ms. */
  timeoutMs: number;
  createdAt: number;
  status: 'pending' | 'claimed' | 'returned' | 'failed';
  claimedAt?: number;
  returnedAt?: number;
}

export interface WorkBuddyExecutionResult {
  ok: boolean;
  taskId: string;
  proposalId: string;
  /** Structured output — must pass schema validation. */
  output?: unknown;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  /** Failure reason if !ok. */
  failureReason?: string;
  durationMs: number;
  returnedAt: number;
}

export interface WorkBuddyExecutionLogEntry {
  logId: string;
  taskId: string;
  endpointId: string;
  kind: 'info' | 'warning' | 'error' | 'progress';
  message: string;
  timestamp: number;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class WorkBuddyExecutionAdapter {
  private readonly tasks = new Map<string, WorkBuddyExecutionTask>();
  private readonly results = new Map<string, WorkBuddyExecutionResult>();
  private readonly logs: WorkBuddyExecutionLogEntry[] = [];

  /**
   * Enqueue a new execution task to the endpoint's inbox.
   * Called by the execution dispatcher when the target endpoint has
   * transport 'workbuddy'.
   */
  enqueue(input: {
    endpointId: string;
    proposalId: string;
    planId: string;
    goalId: string;
    bindingHash: string;
    prompt: string;
    workingDirectory: string;
    timeoutMs?: number;
  }): WorkBuddyExecutionTask {
    const now = Date.now();
    const task: WorkBuddyExecutionTask = {
      taskId: randomUUID(),
      endpointId: input.endpointId,
      proposalId: input.proposalId,
      planId: input.planId,
      goalId: input.goalId,
      bindingHash: input.bindingHash,
      prompt: input.prompt,
      workingDirectory: input.workingDirectory,
      timeoutMs: input.timeoutMs ?? 120_000,
      createdAt: now,
      status: 'pending',
    };
    this.tasks.set(task.taskId, clone(task));
    return clone(task);
  }

  /**
   * Claim the next pending task for an endpoint. Returns the task and marks
   * it as 'claimed'. Returns undefined if no pending tasks.
   */
  claimNext(endpointId: string): WorkBuddyExecutionTask | undefined {
    for (const task of this.tasks.values()) {
      if (task.endpointId === endpointId && task.status === 'pending') {
        task.status = 'claimed';
        task.claimedAt = Date.now();
        this.tasks.set(task.taskId, clone(task));
        return clone(task);
      }
    }
    return undefined;
  }

  /**
   * Record a structured execution result. Marks the task as 'returned'.
   * Accepts only if the task is in 'claimed' status.
   */
  recordResult(
    taskId: string,
    result: Omit<WorkBuddyExecutionResult, 'taskId' | 'returnedAt'>,
  ): WorkBuddyExecutionResult | null {
    const task = this.tasks.get(taskId);
    if (!task || task.status !== 'claimed') return null;

    const now = Date.now();
    const full: WorkBuddyExecutionResult = {
      ...result,
      taskId,
      returnedAt: now,
    };
    this.results.set(taskId, clone(full));

    task.status = result.ok ? 'returned' : 'failed';
    task.returnedAt = now;
    this.tasks.set(taskId, clone(task));
    return clone(full);
  }

  /**
   * Append a log entry for a task. Lightweight — no status change.
   */
  recordLog(entry: {
    taskId: string;
    endpointId: string;
    kind: WorkBuddyExecutionLogEntry['kind'];
    message: string;
  }): WorkBuddyExecutionLogEntry {
    const log: WorkBuddyExecutionLogEntry = {
      logId: randomUUID(),
      taskId: entry.taskId,
      endpointId: entry.endpointId,
      kind: entry.kind,
      message: entry.message,
      timestamp: Date.now(),
    };
    this.logs.push(clone(log));
    return clone(log);
  }

  /** Get a task by id. */
  getTask(taskId: string): WorkBuddyExecutionTask | undefined {
    const t = this.tasks.get(taskId);
    return t ? clone(t) : undefined;
  }

  /** Get result by task id. */
  getResult(taskId: string): WorkBuddyExecutionResult | undefined {
    const r = this.results.get(taskId);
    return r ? clone(r) : undefined;
  }

  /** List pending tasks for an endpoint. */
  listPendingTasks(endpointId: string): WorkBuddyExecutionTask[] {
    return Array.from(this.tasks.values())
      .filter(t => t.endpointId === endpointId && t.status === 'pending')
      .map(clone);
  }

  /** Get logs for a task. */
  getLogs(taskId: string): WorkBuddyExecutionLogEntry[] {
    return this.logs.filter(l => l.taskId === taskId).map(clone);
  }

  // ── Snapshot persistence ──

  exportTasks(): WorkBuddyExecutionTask[] {
    return Array.from(this.tasks.values(), clone);
  }

  hydrateTask(task: WorkBuddyExecutionTask): void {
    if (!task.taskId || !task.endpointId || !task.proposalId) return;
    this.tasks.set(task.taskId, clone(task));
  }
}
