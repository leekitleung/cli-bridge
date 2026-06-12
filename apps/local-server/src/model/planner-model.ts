// v2.4a — PlannerModel: calls ModelProvider, parses and validates output.
//
// Output is advisory-only. Never attached to a goal without human approval.
// Schema/policy rejection fails closed — no 200 with invalid draft.

import type { ModelProvider, PlanResult, PlanError } from './provider-interface.ts';
import type {
  ExecutionTier,
  PlanStepKind,
} from '../../../../packages/shared/src/types.ts';
import { EXECUTION_TIERS, PLAN_STEP_KINDS } from '../../../../packages/shared/src/types.ts';

export interface PlannerModelInput {
  goalDescription: string;
  endpoints: Array<{ id: string; label: string }>;
  permittedTiers: string[];
  projectContext?: string;
  maxSteps: number;
}

export interface PlannerModelResult {
  ok: true;
  draft: {
    steps: Array<{
      intent: string;
      kind: PlanStepKind;
      tier: ExecutionTier;
      isStateMutating: boolean;
      targetEndpointId: string;
    }>;
    rationale?: string;
  };
  provider: string;
  usage: { promptTokens: number; completionTokens: number };
  latencyMs: number;
}

export interface PlannerModelFailure {
  ok: false;
  reason: string;
  /** Whether the failure is due to provider error vs schema/policy rejection. */
  kind: 'provider-error' | 'schema-rejection' | 'policy-rejection' | 'budget-exceeded';
  latencyMs: number;
  usage?: { promptTokens: number; completionTokens: number };
}

const HARD_STEP_CEILING = 10;
const FORBIDDEN_KINDS = new Set(['git-commit', 'git-push', 'run-command']);

export async function generateModelPlan(
  provider: ModelProvider,
  input: PlannerModelInput,
): Promise<PlannerModelResult | PlannerModelFailure> {
  const result = await provider.plan({
    goalDescription: input.goalDescription,
    endpoints: input.endpoints,
    permittedTiers: input.permittedTiers,
    projectContext: input.projectContext,
    maxSteps: Math.min(input.maxSteps, HARD_STEP_CEILING),
  });

  if (!result.ok) {
    return { ok: false, reason: result.reason, kind: 'provider-error', latencyMs: result.latencyMs };
  }

  // ════════════════════════════════════════════════
  // Schema validate + PolicyEngine check — FAIL CLOSED
  // ════════════════════════════════════════════════
  const issues: string[] = [];
  const validTiers = EXECUTION_TIERS as readonly string[];
  const validKinds = PLAN_STEP_KINDS as readonly string[];
  const allowedTiers = input.permittedTiers;
  const endpointIds = new Set(input.endpoints.map(e => e.id));

  // Step ceiling check.
  if (result.draft.steps.length > HARD_STEP_CEILING) {
    return {
      ok: false,
      reason: `Step count ${result.draft.steps.length} exceeds hard ceiling ${HARD_STEP_CEILING}`,
      kind: 'policy-rejection',
      latencyMs: result.latencyMs,
      usage: result.usage,
    };
  }

  if (result.draft.steps.length === 0) {
    return {
      ok: false,
      reason: 'Model returned empty plan (0 steps)',
      kind: 'schema-rejection',
      latencyMs: result.latencyMs,
      usage: result.usage,
    };
  }

  const validSteps: PlannerModelResult['draft']['steps'] = [];

  for (let i = 0; i < result.draft.steps.length; i++) {
    const s = result.draft.steps[i];

    if (typeof s.intent !== 'string' || s.intent.trim().length === 0) {
      return {
        ok: false,
        reason: `step[${i}]: missing intent`,
        kind: 'schema-rejection',
        latencyMs: result.latencyMs,
        usage: result.usage,
      };
    }
    if (!validKinds.includes(s.kind as PlanStepKind)) {
      return {
        ok: false,
        reason: `step[${i}]: invalid kind "${String(s.kind)}"`,
        kind: 'schema-rejection',
        latencyMs: result.latencyMs,
        usage: result.usage,
      };
    }
    if (!validTiers.includes(s.tier as ExecutionTier)) {
      return {
        ok: false,
        reason: `step[${i}]: invalid tier "${String(s.tier)}"`,
        kind: 'schema-rejection',
        latencyMs: result.latencyMs,
        usage: result.usage,
      };
    }
    if (!allowedTiers.includes(s.tier)) {
      return {
        ok: false,
        reason: `step[${i}]: tier "${String(s.tier)}" not in permitted tiers`,
        kind: 'policy-rejection',
        latencyMs: result.latencyMs,
        usage: result.usage,
      };
    }
    if (typeof s.targetEndpointId !== 'string' || !endpointIds.has(s.targetEndpointId)) {
      return {
        ok: false,
        reason: `step[${i}]: unknown endpoint "${String(s.targetEndpointId)}"`,
        kind: 'schema-rejection',
        latencyMs: result.latencyMs,
        usage: result.usage,
      };
    }
    if (FORBIDDEN_KINDS.has(s.kind)) {
      return {
        ok: false,
        reason: `step[${i}]: forbidden kind "${s.kind}" (git-commit/git-push/run-command not allowed)`,
        kind: 'policy-rejection',
        latencyMs: result.latencyMs,
        usage: result.usage,
      };
    }

    validSteps.push({
      intent: s.intent,
      kind: s.kind as PlanStepKind,
      tier: s.tier as ExecutionTier,
      isStateMutating: Boolean(s.isStateMutating),
      targetEndpointId: s.targetEndpointId,
    });
  }

  return {
    ok: true,
    draft: { steps: validSteps, rationale: result.draft.rationale },
    provider: result.provider,
    usage: result.usage,
    latencyMs: result.latencyMs,
  };
}
