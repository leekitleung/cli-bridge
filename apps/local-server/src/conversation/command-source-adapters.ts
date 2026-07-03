// ADR-0035: Codex / Claude source adapter wrappers.
//
// Wraps the existing command planner adapters (Codex CLI, Claude CLI) as
// ConversationSourceAdapter implementations. These are registered in the
// source adapter registry so that conversation routing resolves them by
// pairing.sourceEndpointId.

import type { ConversationSourceAdapter, SourceAvailabilityInput, PlannerRequest as SourcePlannerRequest } from './source-adapter.ts';
import type { PlannerOutputEnvelope } from './planner-output-envelope.ts';
import type { PlannerRequest } from './planner-adapter.ts';
import {
  createCodexPlannerAdapter,
  createClaudePlannerAdapter,
} from './command-planner-adapter.ts';

/**
 * ADR-0035: Wraps a Codex CLI planner as a ConversationSourceAdapter.
 * Registered for endpointId: 'codex-cli'.
 */
export function createCodexSourceAdapter(options: {
  id?: string;
  commandOptions?: { timeoutMs?: number; maxOutputBytes?: number };
}): ConversationSourceAdapter {
  const planner = createCodexPlannerAdapter({
    id: options.id ?? 'codex-source',
    commandOptions: options.commandOptions,
  });

  return {
    endpointId: 'codex-cli',
    kind: 'codex-cli',

    isAvailable(_input: SourceAvailabilityInput): boolean {
      return true;
    },

    async plan(input: SourcePlannerRequest): Promise<PlannerOutputEnvelope> {
      return planner.plan(input as unknown as PlannerRequest);
    },
  };
}

/**
 * ADR-0035: Wraps a Claude CLI planner as a ConversationSourceAdapter.
 * Registered for endpointId: 'claude-code'.
 */
export function createClaudeSourceAdapter(options: {
  id?: string;
  commandOptions?: { timeoutMs?: number; maxOutputBytes?: number };
}): ConversationSourceAdapter {
  const planner = createClaudePlannerAdapter({
    id: options.id ?? 'claude-source',
    commandOptions: options.commandOptions,
  });

  return {
    endpointId: 'claude-code',
    kind: 'claude-code',

    isAvailable(_input: SourceAvailabilityInput): boolean {
      return true;
    },

    async plan(input: SourcePlannerRequest): Promise<PlannerOutputEnvelope> {
      return planner.plan(input as unknown as PlannerRequest);
    },
  };
}
