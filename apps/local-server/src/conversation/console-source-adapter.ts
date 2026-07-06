// ADR-0035: Local Console source adapter.
//
// Handles conversation turns from the local Console UI. Unlike ChatGPT Web
// (which is browser-mediated and async), the Console source adapter invokes
// a CLI planner synchronously and returns a planner output envelope.

import type { ConversationSourceAdapter, SourceAvailabilityInput } from './source-adapter.ts';
import type { PlannerOutputEnvelope } from './planner-output-envelope.ts';
import type { PlannerAdapter, PlannerRequest } from './planner-adapter.ts';

/**
 * ADR-0035: Console source adapter for the local Console UI.
 * Wraps a CLI planner adapter and adapts it to the ConversationSourceAdapter interface.
 */
export function createConsoleSourceAdapter(options: {
  /** CLI planner adapter to invoke. */
  planner: PlannerAdapter;
  /** Timeout for planner invocation (ms). */
  timeoutMs?: number;
}): ConversationSourceAdapter {
  const timeoutMs = options.timeoutMs ?? 30_000;

  return {
    endpointId: 'console',
    kind: 'local-workbuddy-status',

    isAvailable(_input: SourceAvailabilityInput): boolean {
      return true;
    },

    async plan(input): Promise<PlannerOutputEnvelope> {
      const now = new Date().toISOString();

      const plannerRequest: PlannerRequest = {
        sessionId: input.sessionId,
        projectId: input.projectId,
        userText: input.userText,
        history: input.history.filter(h => h.role !== 'assistant') as PlannerRequest['history'],
      };

      let envelope: PlannerOutputEnvelope;
      try {
        const planPromise = options.planner.plan(plannerRequest);
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Console source planner timed out')), timeoutMs),
        );
        envelope = await Promise.race([planPromise, timeoutPromise]);
      } catch (err) {
        const errMsg = String(err);
        if (errMsg.includes('timed out')) {
          return {
            id: `console-${Date.now()}`,
            sessionId: input.sessionId,
            plannerEndpointId: 'console',
            visibleText: 'Planner timed out after ' + (timeoutMs / 1000) + 's. Please try a simpler request.',
            intent: 'blocked',
            requiredInputs: ['planner-timeout'],
            createdAt: now,
          };
        }
        return {
          id: `console-${Date.now()}`,
          sessionId: input.sessionId,
          plannerEndpointId: 'console',
          visibleText: `Planner error: ${errMsg}`,
          intent: 'blocked',
          requiredInputs: ['planner-error'],
          createdAt: now,
        };
      }

      return {
        id: `console-${Date.now()}`,
        sessionId: input.sessionId,
        plannerEndpointId: envelope.plannerEndpointId ?? 'console',
        visibleText: envelope.visibleText,
        intent: envelope.intent,
        requiredInputs: envelope.requiredInputs,
        createdAt: now,
      };
    },
  };
}
