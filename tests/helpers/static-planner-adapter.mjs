/**
 * Shared static planner adapter for integration and acceptance tests.
 *
 * Usage:
 *   import { createStaticPlannerAdapter } from '../tests/helpers/static-planner-adapter.mjs';
 *   const adapter = createStaticPlannerAdapter({ intent: 'request_execution', ... });
 */

export function createStaticPlannerAdapter(output) {
  return {
    id: output.id ?? 'static-test-planner',
    label: 'Static Test Planner',
    async plan(input) {
      return {
        id: output.id ?? 'planner-output-static',
        sessionId: input.sessionId,
        plannerEndpointId: 'static-test-planner',
        visibleText: output.visibleText,
        intent: output.intent,
        proposedInstruction: output.proposedInstruction,
        requiredInputs: output.requiredInputs ?? [],
      };
    },
  };
}
