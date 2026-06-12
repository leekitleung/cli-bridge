// v2.4a — PlannerModel: calls ModelProvider, parses and validates output.
//
// Output is advisory-only. Never attached to a goal without human approval.
// Model failure never mutates goal/plan/step state.

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

export interface ValidatedPlanDraft {
  steps: Array<{
    intent: string;
    kind: PlanStepKind;
    tier: ExecutionTier;
    isStateMutating: boolean;
    targetEndpointId: string;
  }>;
  rationale?: string;
  /** Validation issues found during schema/PolicyEngine checks. */
  validationIssues: string[];
  /** Whether the draft passed all validation checks. */
  valid: boolean;
}

export interface PlannerModelResult {
  ok: true;
  draft: ValidatedPlanDraft;
  provider: string;
  usage: { promptTokens: number; completionTokens: number };
  latencyMs: number;
}

export interface PlannerModelFailure {
  ok: false;
  reason: string;
  latencyMs: number;
}

const HARD_STEP_CEILING = 10;

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
    return { ok: false, reason: result.reason, latencyMs: result.latencyMs };
  }

  // Schema validate + PolicyEngine check.
  const validationIssues: string[] = [];
  const validSteps: ValidatedPlanDraft['steps'] = [];

  const validTiers = EXECUTION_TIERS as readonly string[];
  const validKinds = PLAN_STEP_KINDS as readonly string[];
  const allowedTiers = input.permittedTiers;
  const endpointIds = new Set(input.endpoints.map(e => e.id));

  if (result.draft.steps.length > HARD_STEP_CEILING) {
    validationIssues.push(`Step count ${result.draft.steps.length} exceeds hard ceiling ${HARD_STEP_CEILING}`);
  }

  for (let i = 0; i < Math.min(result.draft.steps.length, HARD_STEP_CEILING); i++) {
    const s = result.draft.steps[i];
    const issues: string[] = [];

    if (typeof s.intent !== 'string' || s.intent.trim().length === 0) {
      issues.push('missing intent');
    }
    if (!validKinds.includes(s.kind as PlanStepKind)) {
      issues.push(`invalid kind: ${String(s.kind)}`);
    }
    if (!validTiers.includes(s.tier as ExecutionTier)) {
      issues.push(`invalid tier: ${String(s.tier)}`);
    }
    if (!allowedTiers.includes(s.tier)) {
      issues.push(`tier ${String(s.tier)} not in permitted tiers`);
    }
    if (typeof s.targetEndpointId !== 'string' || !endpointIds.has(s.targetEndpointId)) {
      issues.push(`unknown endpoint: ${String(s.targetEndpointId)}`);
    }
    // Reject forbidden kinds: git-commit, git-push, run-command.
    if (s.kind === 'git-commit' || s.kind === 'git-push' || s.kind === 'run-command') {
      issues.push(`forbidden step kind: ${s.kind}`);
    }

    if (issues.length > 0) {
      validationIssues.push(`step[${i}]: ${issues.join(', ')}`);
      // Still include the step with issues noted, but not valid.
      validSteps.push({
        intent: typeof s.intent === 'string' ? s.intent : '',
        kind: (validKinds.includes(s.kind as PlanStepKind) ? s.kind : 'review') as PlanStepKind,
        tier: (validTiers.includes(s.tier as ExecutionTier) ? s.tier : 'patch-proposal') as ExecutionTier,
        isStateMutating: Boolean(s.isStateMutating),
        targetEndpointId: typeof s.targetEndpointId === 'string' ? s.targetEndpointId : '',
      });
    } else {
      validSteps.push({
        intent: s.intent,
        kind: s.kind as PlanStepKind,
        tier: s.tier as ExecutionTier,
        isStateMutating: Boolean(s.isStateMutating),
        targetEndpointId: s.targetEndpointId,
      });
    }
  }

  return {
    ok: true,
    draft: {
      steps: validSteps,
      rationale: result.draft.rationale,
      validationIssues,
      valid: validationIssues.length === 0 && validSteps.length > 0 && validSteps.length <= HARD_STEP_CEILING,
    },
    provider: result.provider,
    usage: result.usage,
    latencyMs: result.latencyMs,
  };
}
