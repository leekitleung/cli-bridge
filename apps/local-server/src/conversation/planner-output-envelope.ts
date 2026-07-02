// Planner output envelope types and validation (ADR-0031 Task 4).
//
// Every planner call produces a PlannerOutputEnvelope. The envelope carries
// both human-visible text and machine-readable intent. The gate evaluator
// reads the intent + risk hints to decide the next action.

export type PlannerIntent =
  | 'answer'
  | 'clarify'
  | 'propose_plan'
  | 'request_execution'
  | 'blocked';

export interface PlannerOutputEnvelope {
  id: string;
  sessionId: string;
  plannerEndpointId: string;
  visibleText: string;
  intent: PlannerIntent;
  proposedInstruction?: {
    summary: string;
    payload: string;
    targetExecutorIds?: string[];
    riskHints?: string[];
  };
  requiredInputs?: string[];
  createdAt: string;
}

export interface EnvelopeValidationResult {
  ok: boolean;
  reason?: string;
}

/**
 * Validate a planner output envelope.
 * request_execution must include a proposedInstruction with payload.
 */
export function validatePlannerOutputEnvelope(
  envelope: Partial<PlannerOutputEnvelope>,
): EnvelopeValidationResult {
  if (!envelope.id || !envelope.sessionId || !envelope.plannerEndpointId) {
    return { ok: false, reason: 'missing required fields: id, sessionId, plannerEndpointId' };
  }
  if (!envelope.visibleText || typeof envelope.visibleText !== 'string') {
    return { ok: false, reason: 'visibleText is required' };
  }
  if (!envelope.intent) {
    return { ok: false, reason: 'intent is required' };
  }
  if (envelope.intent === 'request_execution') {
    if (!envelope.proposedInstruction || !envelope.proposedInstruction.payload) {
      return { ok: false, reason: 'request_execution requires proposedInstruction with payload' };
    }
  }
  return { ok: true };
}
