// ADR-0035: Conversation Source Adapter interface.
//
// Each source endpoint type (ChatGPT Web, Codex CLI, Claude Code) implements
// this interface. The conversation routing layer resolves the adapter by
// pairing.sourceEndpointId and calls plan() — never a default planner.

import type { PlannerOutputEnvelope } from './planner-output-envelope.ts';

export interface PlannerRequest {
  sessionId: string;
  projectId: string;
  userText: string;
  history: Array<{ role: 'user' | 'planner' | 'executor' | 'assistant'; text: string }>;
}

export interface SourceAvailabilityInput {
  projectId: string;
  endpointId: string;
}

/**
 * ADR-0035: A source adapter handles conversation turns for a specific
 * source endpoint type. The routing layer resolves adapters by endpointId
 * and never falls back to a default planner.
 */
export interface ConversationSourceAdapter {
  /** The endpoint ID this adapter handles (e.g. 'chatgpt-web', 'codex-cli'). */
  endpointId: string;

  /** Human-readable kind for UI display. */
  kind: 'chatgpt-web' | 'codex-cli' | 'claude-code' | 'local-workbuddy-status';

  /** Whether this source is currently available for the given project. */
  isAvailable(input: SourceAvailabilityInput): boolean;

  /**
   * Process a conversation turn and return a planner output envelope.
   * The caller validates the envelope before passing it to the gate evaluator.
   */
  plan(input: PlannerRequest): Promise<PlannerOutputEnvelope>;
}

/**
 * ADR-0035: Registry of conversation source adapters.
 * Resolves adapters by endpointId. No default fallback — if resolve() returns
 * undefined, the routing layer must return "source unavailable."
 */
export class SourceAdapterRegistry {
  private readonly adapters = new Map<string, ConversationSourceAdapter>();

  register(adapter: ConversationSourceAdapter): void {
    this.adapters.set(adapter.endpointId, adapter);
  }

  resolve(endpointId: string): ConversationSourceAdapter | undefined {
    return this.adapters.get(endpointId);
  }

  list(): ConversationSourceAdapter[] {
    return Array.from(this.adapters.values());
  }
}
