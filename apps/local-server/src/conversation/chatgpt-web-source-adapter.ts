// ADR-0035: ChatGPT Web Source Relay.
//
// Bridge-side protocol for relaying conversation prompts to the ChatGPT Web
// browser extension and receiving assistant responses. The extension polls
// for prompts, submits them to the ChatGPT DOM, and posts results back.

import type { ConversationSourceAdapter, SourceAvailabilityInput, PlannerRequest } from './source-adapter.ts';
import type { PlannerOutputEnvelope } from './planner-output-envelope.ts';
import type { ConversationRouteKind } from '../storage/conversation-pairing-store.ts';

export interface ChatGptWebSourceConfig {
  /** Maximum time to wait for the extension to claim a prompt (ms). */
  claimTimeoutMs?: number;
  /** Maximum time to wait for the extension to return a result (ms). */
  resultTimeoutMs?: number;
}

export interface ChatGptSourceRequest {
  id: string;
  projectId: string;
  sessionId: string;
  prompt: string;
  createdAt: number;
  status: 'pending' | 'claimed' | 'returned' | 'failed';
  pairingId?: string;
  userEventId?: string;
  targetEndpointId?: string;
  targetRouteKind?: ConversationRouteKind;
  claimedAt?: number;
  returnedAt?: number;
  failedAt?: number;
}

export interface ChatGptSourceResult {
  requestId: string;
  text: string;
  returnedAt: number;
}

export interface ChatGptSourceQueueMetrics {
  /** Current queue depth (pending requests). */
  depth: number;
  /** Currently processing (claimed) requests. */
  inFlight: number;
  /** Requests completed in the last window. */
  completedInWindow: number;
  /** Average wait time in ms (time from enqueue to claim). */
  avgWaitTime: number;
  /** Requests per minute throughput. */
  throughput: number;
  /** Connection status. */
  extensionConnected: boolean;
  lastHeartbeatAt: number | null;
}

interface ChatGptSourceHeartbeat {
  lastHeartbeatAt: number;
  capabilities?: { canAnswer?: boolean };
}

// Metrics tracking constants
const METRICS_WINDOW_MS = 60_000; // 1-minute window for throughput calculation
const MAX_SAMPLE_SIZE = 100; // Max samples for average calculation

/**
 * ADR-0035: In-memory queue for ChatGPT Web source requests.
 * The bridge enqueues prompts; the extension polls for them; results are
 * posted back and matched to the original request.
 */
export class ChatGptWebSourceQueue {
  private readonly requests = new Map<string, ChatGptSourceRequest>();
  private readonly results = new Map<string, ChatGptSourceResult>();
  private heartbeat: ChatGptSourceHeartbeat | null = null;

  // Metrics tracking
  private readonly claimTimestamps: number[] = [];
  private readonly completionTimestamps: number[] = [];

  /** Record a heartbeat from the extension. */
  recordHeartbeat(capabilities?: { canAnswer?: boolean }): void {
    this.heartbeat = {
      lastHeartbeatAt: Date.now(),
      capabilities,
    };
  }

  /** Check if the extension has sent a heartbeat recently. */
  isExtensionConnected(maxStaleMs: number = 60_000): boolean {
    if (!this.heartbeat) return false;
    return (Date.now() - this.heartbeat.lastHeartbeatAt) < maxStaleMs;
  }

  /** Get the last heartbeat. */
  getHeartbeat(): ChatGptSourceHeartbeat | null {
    return this.heartbeat ? { ...this.heartbeat } : null;
  }

  /** Enqueue a new source request. Returns the request ID. */
  enqueue(input: {
    projectId: string;
    sessionId: string;
    prompt: string;
    pairingId?: string;
    userEventId?: string;
    targetEndpointId?: string;
    targetRouteKind?: ConversationRouteKind;
  }): ChatGptSourceRequest {
    const id = `chatgpt-src-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const req: ChatGptSourceRequest = {
      id,
      projectId: input.projectId,
      sessionId: input.sessionId,
      prompt: input.prompt,
      createdAt: Date.now(),
      status: 'pending',
      ...(input.pairingId ? { pairingId: input.pairingId } : {}),
      ...(input.userEventId ? { userEventId: input.userEventId } : {}),
      ...(input.targetEndpointId ? { targetEndpointId: input.targetEndpointId } : {}),
      ...(input.targetRouteKind ? { targetRouteKind: input.targetRouteKind } : {}),
    };
    this.requests.set(id, clone(req));
    return clone(req);
  }

  /** Get the next pending request (for extension polling). */
  next(): ChatGptSourceRequest | undefined {
    for (const req of this.requests.values()) {
      if (req.status === 'pending') return clone(req);
    }
    return undefined;
  }

  /** Claim a pending request. */
  claim(requestId: string): ChatGptSourceRequest | undefined {
    const req = this.requests.get(requestId);
    if (!req || req.status !== 'pending') return undefined;
    req.status = 'claimed';
    req.claimedAt = Date.now();
    this.requests.set(requestId, clone(req));

    // Track claim timestamp for metrics
    this.claimTimestamps.push(req.claimedAt);
    if (this.claimTimestamps.length > MAX_SAMPLE_SIZE) {
      this.claimTimestamps.shift();
    }

    return clone(req);
  }

  /** Atomically claim the next pending request (for extension polling).
   *
   * SECURITY FIX: 修复竞态条件 - 原来 claimNext 先遍历找到 pending 请求，
   * 再调用 claim() 更新状态，两步之间可能被其他调用者抢走同一请求。
   * 现在使用 compare-and-swap 模式在单次 Map 操作内完成。
   */
  claimNext(): ChatGptSourceRequest | undefined {
    for (const req of this.requests.values()) {
      if (req.status !== 'pending') continue;

      // 原子性检查并更新：在同一 Map 操作内验证状态并修改
      const prev = this.requests.get(req.id);
      if (prev && prev.status === 'pending') {
        // 使用克隆避免直接修改存储的对象
        const updated: ChatGptSourceRequest = {
          ...prev,
          status: 'claimed',
          claimedAt: Date.now(),
        };
        this.requests.set(req.id, updated);

        // Track claim timestamp for metrics
        if (updated.claimedAt !== undefined) {
          this.claimTimestamps.push(updated.claimedAt);
          if (this.claimTimestamps.length > MAX_SAMPLE_SIZE) {
            this.claimTimestamps.shift();
          }
        }

        return clone(updated);
      }
    }
    return undefined;
  }

  /** Record a result for a claimed request. */
  recordResult(requestId: string, text: string): ChatGptSourceResult | undefined {
    const req = this.requests.get(requestId);
    if (!req || req.status !== 'claimed') return undefined;
    req.status = 'returned';
    req.returnedAt = Date.now();
    this.requests.set(requestId, clone(req));
    const result: ChatGptSourceResult = { requestId, text, returnedAt: Date.now() };
    this.results.set(requestId, clone(result));

    // Track completion timestamp for metrics
    this.completionTimestamps.push(result.returnedAt);
    if (this.completionTimestamps.length > MAX_SAMPLE_SIZE) {
      this.completionTimestamps.shift();
    }

    return clone(result);
  }

  /** Mark a pending or claimed request as failed. */
  fail(requestId: string): ChatGptSourceRequest | undefined {
    const req = this.requests.get(requestId);
    if (!req || req.status === 'returned' || req.status === 'failed') return undefined;
    req.status = 'failed';
    req.failedAt = Date.now();
    this.requests.set(requestId, clone(req));
    return clone(req);
  }

  /** Get a result by request ID. */
  getResult(requestId: string): ChatGptSourceResult | undefined {
    const result = this.results.get(requestId);
    return result ? clone(result) : undefined;
  }

  /** Get a request by ID. */
  getRequest(requestId: string): ChatGptSourceRequest | undefined {
    const request = this.requests.get(requestId);
    return request ? clone(request) : undefined;
  }

  /** List all requests for a project. */
  listByProject(projectId: string): ChatGptSourceRequest[] {
    return Array.from(this.requests.values())
      .filter(r => r.projectId === projectId)
      .map(clone);
  }

  /** Clean up stale requests older than maxAgeMs. */
  cleanup(maxAgeMs: number = 300_000): void {
    const cutoff = Date.now() - maxAgeMs;
    for (const [id, req] of this.requests) {
      if (req.createdAt < cutoff) {
        this.requests.delete(id);
        this.results.delete(id);
      }
    }
  }

  /** List recent requests (up to limit, sorted by createdAt desc). */
  listRecent(limit: number = 10): ChatGptSourceRequest[] {
    return Array.from(this.requests.values())
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit)
      .map(clone);
  }

  /** Get count of pending (unclaimed) requests. */
  getPendingCount(): number {
    let count = 0;
    for (const req of this.requests.values()) {
      if (req.status === 'pending') count++;
    }
    return count;
  }

  /** Get recent activity summary for UI display. */
  getRecentActivity(limit: number = 5): Array<{
    id: string;
    status: string;
    prompt: string;
    createdAt: number;
    returnedAt?: number;
    failedAt?: number;
  }> {
    return this.listRecent(limit).map(req => ({
      id: req.id,
      status: req.status,
      prompt: req.prompt.length > 50 ? req.prompt.slice(0, 47) + '...' : req.prompt,
      createdAt: req.createdAt,
      returnedAt: req.returnedAt,
      failedAt: req.failedAt,
    }));
  }

  /**
   * Get queue metrics for monitoring/display.
   * Includes depth, throughput, wait times, and connection status.
   */
  getMetrics(): ChatGptSourceQueueMetrics {
    const now = Date.now();
    const windowStart = now - METRICS_WINDOW_MS;

    // Count requests by status
    let depth = 0;
    let inFlight = 0;
    for (const req of this.requests.values()) {
      if (req.status === 'pending') depth++;
      else if (req.status === 'claimed') inFlight++;
    }

    // Count completions in the window
    const recentCompletions = this.completionTimestamps.filter(t => t >= windowStart);

    // Calculate average wait time (from creation to claim)
    const recentClaims = this.claimTimestamps.filter(t => t >= windowStart);
    let avgWaitTime = 0;
    if (recentClaims.length > 0) {
      const waitTimes: number[] = [];
      for (const claimTime of recentClaims) {
        // Find the corresponding request
        for (const req of this.requests.values()) {
          if (req.claimedAt === claimTime) {
            waitTimes.push(claimTime - req.createdAt);
            break;
          }
        }
      }
      if (waitTimes.length > 0) {
        avgWaitTime = waitTimes.reduce((a, b) => a + b, 0) / waitTimes.length;
      }
    }

    // Calculate throughput (requests per minute)
    const throughput = (recentCompletions.length / METRICS_WINDOW_MS) * 60_000;

    return {
      depth,
      inFlight,
      completedInWindow: recentCompletions.length,
      avgWaitTime: Math.round(avgWaitTime),
      throughput: Math.round(throughput * 10) / 10,
      extensionConnected: this.isExtensionConnected(),
      lastHeartbeatAt: this.heartbeat?.lastHeartbeatAt ?? null,
    };
  }

  /**
   * Serialize queue state for persistence.
   * Returns pending requests that should survive a restart.
   */
  toJSON(): { requests: ChatGptSourceRequest[] } {
    // Only persist pending requests (not claimed/completed/failed)
    const pendingRequests = Array.from(this.requests.values())
      .filter(req => req.status === 'pending');
    return { requests: pendingRequests };
  }

  /**
   * Restore queue state from persisted data.
   * Re-hydrates pending requests after a server restart.
   */
  fromJSON(data: { requests: ChatGptSourceRequest[] }): void {
    if (!data?.requests) return;

    for (const req of data.requests) {
      // Only restore requests that were pending (not yet claimed)
      if (req.status === 'pending' && !this.requests.has(req.id)) {
        this.requests.set(req.id, { ...req });
      }
    }
  }
}

/**
 * ADR-0035: ChatGPT Web source adapter.
 * Uses the source queue to relay prompts to the browser extension and
 * returns the assistant's response as a PlannerOutputEnvelope.
 */
export function createChatGptWebSourceAdapter(options: {
  queue: ChatGptWebSourceQueue;
  config?: ChatGptWebSourceConfig;
}): ConversationSourceAdapter {
  const queue = options.queue;
  const resultTimeoutMs = options.config?.resultTimeoutMs ?? 120_000;

  return {
    endpointId: 'chatgpt-web',
    kind: 'chatgpt-web',

    isAvailable(_input: SourceAvailabilityInput): boolean {
      // Do not preflight-block the first turn. The source request itself is the
      // signal the extension polls for; if no extension responds, plan() times
      // out and returns a blocked envelope.
      return true;
    },

    async plan(input: PlannerRequest): Promise<PlannerOutputEnvelope> {
      const now = new Date().toISOString();

      // Enqueue the prompt.
      const request = queue.enqueue({
        projectId: input.projectId,
        sessionId: input.sessionId,
        prompt: input.userText,
      });

      // Wait for the extension to return a result.
      const result = await waitForResult(queue, request.id, resultTimeoutMs);

      if (!result) {
        queue.fail(request.id);
        return {
          id: `chatgpt-web-${Date.now()}`,
          sessionId: input.sessionId,
          plannerEndpointId: 'chatgpt-web',
          visibleText: 'ChatGPT Web did not respond in time. The browser extension may be disconnected.',
          intent: 'blocked',
          requiredInputs: ['ChatGPT Web extension not responding'],
          createdAt: now,
        };
      }

      // Return the ChatGPT response as a planner output envelope.
      return {
        id: `chatgpt-web-${Date.now()}`,
        sessionId: input.sessionId,
        plannerEndpointId: 'chatgpt-web',
        visibleText: result.text,
        intent: 'answer',
        createdAt: now,
      };
    },
  };
}

async function waitForResult(
  queue: ChatGptWebSourceQueue,
  requestId: string,
  timeoutMs: number,
): Promise<ChatGptSourceResult | undefined> {
  const start = Date.now();
  const pollIntervalMs = 500;

  while (Date.now() - start < timeoutMs) {
    const result = queue.getResult(requestId);
    if (result) return result;
    await delay(pollIntervalMs);
  }

  return undefined;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
