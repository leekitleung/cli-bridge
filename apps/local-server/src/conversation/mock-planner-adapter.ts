// Test-only mock planner adapter (ADR-0031 Task 3).
//
// This adapter MUST NOT be registered by the default runtime.
// It exists only for tests and acceptance scripts.

import type { PlannerAdapter } from './planner-adapter.ts';

export const mockPlannerAdapter: PlannerAdapter = {
  id: 'mock-planner',
  mode: 'test-only',
  async plan(input) {
    return {
      id: `planner-output-${Date.now()}`,
      sessionId: input.sessionId,
      plannerEndpointId: 'mock-planner',
      visibleText: `Plan proposal: ${input.userText}`,
      intent: 'propose_plan',
      proposedInstruction: {
        summary: input.userText,
        payload: input.userText,
        targetExecutorIds: [],
        riskHints: ['test-only'],
      },
      createdAt: new Date().toISOString(),
    };
  },
};
