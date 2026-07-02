// Pure policy gate evaluator (ADR-0031 Task 4).
//
// Deterministic: given the same inputs, always produces the same decision.
// No side effects, no network calls, no async. Safe to call before dispatch.

import type { PlannerOutputEnvelope } from './planner-output-envelope.ts';
import type { ExecutorAvailability } from './executor-availability.ts';

export interface InstructionPacketDraft {
  summary: string;
  payload: string;
  targetExecutorIds: string[];
  riskHints: string[];
}

export type GateDecision =
  | { type: 'continue_planning'; reason: string }
  | { type: 'auto_execute'; instruction: InstructionPacketDraft; reason: string }
  | { type: 'require_user_confirm'; proposalId: string; reason: string }
  | { type: 'blocked'; reason: string; missing: string[] };

export interface GateEvaluatorInput {
  plannerOutput: PlannerOutputEnvelope;
  sessionState: { projectId: string };
  executorAvailability: ExecutorAvailability[];
  policyConfig: { allowSafeAutoExecute: boolean };
}

/** Risk hints that allow auto-execution (read-only, pure-transform). */
const SAFE_RISK_HINTS = new Set(['pure-transform']);

/** Risk hints that always require user confirmation. */
const HIGH_RISK_HINTS = new Set(['filesystem-mutation', 'shell-execution', 'network-access', 'git-mutation']);

function isSafeForAuto(riskHints: string[] | undefined): boolean {
  if (!riskHints || riskHints.length === 0) return false;
  return riskHints.every(hint => SAFE_RISK_HINTS.has(hint));
}

function isHighRisk(riskHints: string[] | undefined): boolean {
  if (!riskHints || riskHints.length === 0) return true; // unknown = high risk
  return riskHints.some(hint => HIGH_RISK_HINTS.has(hint) || (!SAFE_RISK_HINTS.has(hint)));
}

export function evaluateGate(input: GateEvaluatorInput): GateDecision {
  const { plannerOutput, executorAvailability, policyConfig } = input;

  // 1. Blocked intent from planner
  if (plannerOutput.intent === 'blocked') {
    return {
      type: 'blocked',
      reason: 'Planner reports it cannot proceed',
      missing: plannerOutput.requiredInputs ?? [],
    };
  }

  // 2. Non-execution intents: continue planning
  if (plannerOutput.intent !== 'request_execution') {
    return {
      type: 'continue_planning',
      reason: `planner intent is ${plannerOutput.intent}`,
    };
  }

  // 3. request_execution: check executor availability
  const instruction = plannerOutput.proposedInstruction;
  if (!instruction) {
    return {
      type: 'continue_planning',
      reason: 'request_execution without proposedInstruction — continue planning',
    };
  }

  const targetIds = instruction.targetExecutorIds ?? [];
  const missing: string[] = [];

  for (const targetId of targetIds) {
    const avail = executorAvailability.find(a => a.endpointId === targetId);
    if (!avail || avail.status === 'offline') {
      missing.push(`executor:${targetId}`);
    } else if (avail.status === 'unknown') {
      missing.push(`executor:${targetId}`);
    }
  }

  if (missing.length > 0) {
    return {
      type: 'blocked',
      reason: 'Executor unavailable',
      missing,
    };
  }

  // 4. Safe auto-execute? Only if policy allows AND risks are safe
  if (policyConfig.allowSafeAutoExecute && isSafeForAuto(instruction.riskHints)) {
    return {
      type: 'auto_execute',
      instruction: {
        summary: instruction.summary,
        payload: instruction.payload,
        targetExecutorIds: targetIds,
        riskHints: instruction.riskHints ?? [],
      },
      reason: 'safe operation, executor online, policy allows auto-execute',
    };
  }

  // 5. High risk or policy disabled: require user confirmation
  return {
    type: 'require_user_confirm',
    proposalId: plannerOutput.id,
    reason: isHighRisk(instruction.riskHints)
      ? 'operation requires user confirmation (risk level)'
      : 'auto-execute disabled by policy',
  };
}
