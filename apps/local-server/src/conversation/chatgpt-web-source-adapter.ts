// ADR-0035: ChatGPT Web Source Relay.
//
// Bridge-side protocol for relaying conversation prompts to the ChatGPT Web
// browser extension and receiving assistant responses. The extension polls
// for prompts, submits them to the ChatGPT DOM, and posts results back.

import type { ConversationSourceAdapter, SourceAvailabilityInput, PlannerRequest } from './source-adapter.ts';
import type { PlannerOutputEnvelope } from './planner-output-envelope.ts';

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
  claimedAt?: number;
  returnedAt?: number;
}

export interface ChatGptSourceResult {
  requestId: string;
  text: string;
  returnedAt: number;
}

/** Heartbeat from the extension declaring it is connected and ready. */
export interface ChatGptSourceHeartbeat {
  lastHeartbeatAt: number;
  capabilities?: { canAnswer?: boolean };
}

/**
 * ADR-0035: In-memory queue for ChatGPT Web source requests.
 * The bridge enqueues prompts; the extension polls for them; results are
 * posted back and matched to the original request.
 */
export class ChatGptWebSourceQueue {
  private readonly requests = new Map<string, ChatGptSourceRequest>();
  private readonly results = new Map<string, ChatGptSourceResult>();
  private heartbeat: ChatGptSourceHeartbeat | null = null;

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
  }): ChatGptSourceRequest {
    const id = `chatgpt-src-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const req: ChatGptSourceRequest = {
      id,
      projectId: input.projectId,
      sessionId: input.sessionId,
      prompt: input.prompt,
      createdAt: Date.now(),
      status: 'pending',
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
    return clone(req);
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
    return clone(result);
  }

  /** Get a result by request ID. */
  getResult(requestId: string): ChatGptSourceResult | undefined {
    const result = this.results.get(requestId);
    return result ? clone(result) : undefined;
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
      // ADR-0035 REVIEW: Honest availability check based on extension heartbeat.
      // The extension sends a heartbeat via POST /bridge/source/chatgpt-web/heartbeat
      // to declare its presence. Without a heartbeat, the source is unavailable.
      // This avoids the deadlock where the first message is blocked because no
      // request has ever been claimed.
      return queue.isExtensionConnected();
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
