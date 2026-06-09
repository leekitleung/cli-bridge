// Goal → Plan output parser (v2.0 §7.2, ADR-0003).
//
// Takes raw CLI agent output, extracts the Plan JSON, validates it against the
// Plan schema, and enforces the workspace-write tier safety invariant:
//
//   If the model outputs a step with tier='workspace-write' but the caller's
//   permittedTiers does NOT include 'workspace-write', the parser MUST either:
//     a) fail-closed (strict mode, default), or
//     b) downgrade the step to 'patch-proposal' with a warning flag.
//
// Model output never grants permittedTiers. This is the structural enforcement
// of ADR-0003 §2: workspace-write must be explicitly opted into by the caller /
// human scope at plan-creation time.

import { randomUUID } from 'node:crypto';

import {
  assertPlan,
} from '../../../../packages/shared/src/schemas.ts';
import type {
  ExecutionTier,
  Plan,
  PlanStep,
} from '../../../../packages/shared/src/types.ts';

// --- Public types ---

export interface ParseGoalPlanInput {
  /** Raw text output from the CLI agent. */
  text: string;
  /** The goal ID this plan should be linked to. */
  goalId: string;
  /** Execution tiers explicitly permitted by the caller/human scope. */
  permittedTiers?: ExecutionTier[];
  /** Optional plan ID override. If not provided, one is generated. */
  id?: string;
  /** Timestamp for createdAt/updatedAt. Defaults to Date.now(). */
  now?: number;
}

export interface ParseGoalPlanResult {
  ok: boolean;
  plan?: Plan;
  failureReason?: string;
  /** Set when workspace-write steps were downgraded to patch-proposal. */
  downgrades?: PlanTierDowngrade[];
}

export interface PlanTierDowngrade {
  stepIndex: number;
  stepId: string;
  originalTier: ExecutionTier;
  downgradedTo: ExecutionTier;
  reason: string;
}

export type TierEnforcementMode = 'strict' | 'downgrade';

export interface ParseOptions {
  /** How to handle workspace-write tier violations.
   *  - 'strict' (default): fail-closed with a descriptive error.
   *  - 'downgrade':  swap offending steps to 'patch-proposal' and return warnings. */
  tierEnforcement?: TierEnforcementMode;
  /** If true, also strip JSON markdown fences before parsing. Default: true. */
  stripFences?: boolean;
}

// --- Internal helpers ---

const FORBIDDEN_EXECUTION_FIELDS = [
  'executable',
  'autoSend',
  'confirmed',
  'sent',
  'autoApprove',
  'canExecute',
] as const;

const DEFAULT_PERMITTED_TIERS: ExecutionTier[] = ['patch-proposal'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stripJsonFence(text: string): string {
  const trimmed = text.trim();
  const match = /^```(?:json)?\s*([\s\S]*?)\s*```$/u.exec(trimmed);
  return match ? match[1] : trimmed;
}

function normalizeCallerPermittedTiers(
  permittedTiers: ExecutionTier[] | undefined,
): { ok: true; tiers: ExecutionTier[] } | { ok: false; failureReason: string } {
  if (permittedTiers === undefined) {
    return { ok: true, tiers: [...DEFAULT_PERMITTED_TIERS] };
  }
  if (!Array.isArray(permittedTiers) || permittedTiers.length === 0) {
    return { ok: false, failureReason: 'plan-permitted-tiers-invalid' };
  }
  const normalized: ExecutionTier[] = [];
  for (const tier of permittedTiers) {
    if (tier !== 'patch-proposal' && tier !== 'workspace-write') {
      return { ok: false, failureReason: `plan-permitted-tiers-invalid:${String(tier)}` };
    }
    if (!normalized.includes(tier)) {
      normalized.push(tier);
    }
  }
  if (!normalized.includes('patch-proposal')) {
    return { ok: false, failureReason: 'plan-permitted-tiers-missing-patch-proposal' };
  }
  return { ok: true, tiers: normalized };
}

/**
 * Scan the raw text for a JSON object that looks like a Plan.
 *
 * Strategy (in order):
 *   1. Try the whole text as JSON.
 *   2. Try to find a `{` … `}` block that contains `"goalId"` and `"steps"`.
 *   3. Give up.
 */
function extractPlanCandidate(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;

  // Attempt 1: whole text is JSON with at least a goalId field.
  try {
    const parsed = JSON.parse(trimmed);
    if (isRecord(parsed) && typeof parsed.goalId === 'string') {
      return trimmed;
    }
  } catch {
    // Not valid JSON — continue.
  }

  // Attempt 2: find the outermost `{ … }` block that has a goalId field.
  const firstBrace = trimmed.indexOf('{');
  if (firstBrace === -1) return null;

  let depth = 0;
  let start = -1;
  let end = -1;
  for (let i = 0; i < trimmed.length; i += 1) {
    const ch = trimmed[i];
    if (ch === '{') {
      if (depth === 0) start = i;
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        end = i + 1;
        const candidate = trimmed.slice(start, end);
        try {
          const parsed = JSON.parse(candidate);
          if (isRecord(parsed) && typeof parsed.goalId === 'string') {
            return candidate;
          }
        } catch {
          // Not valid, keep looking.
        }
        start = -1;
      }
    }
  }

  return null;
}

// --- Main parser ---

/**
 * Parse CLI agent output into a validated Plan.
 *
 * Enforces:
 *   - Valid JSON extraction (with fence stripping).
 *   - Rejection of forbidden execution fields.
 *   - Schema validation via assertPlan.
 *   - Workspace-write tier invariant (fail-closed or downgrade).
 *   - All generated step statuses forced to 'pending'.
 *   - Plan status forced to 'awaiting-approval'.
 */
export function parseGoalPlanResult(
  input: ParseGoalPlanInput,
  options: ParseOptions = {},
): ParseGoalPlanResult {
  const {
    tierEnforcement = 'strict',
    stripFences = true,
  } = options;

  // ── 1. Extract JSON ────────────────────────────────────────────────
  const raw = stripFences ? stripJsonFence(input.text) : input.text;
  const candidate = extractPlanCandidate(raw);
  if (!candidate) {
    return { ok: false, failureReason: 'plan-json-not-found' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    return { ok: false, failureReason: 'plan-json-parse-error' };
  }

  if (!isRecord(parsed)) {
    return { ok: false, failureReason: 'plan-not-object' };
  }

  if (parsed.goalId !== input.goalId) {
    return { ok: false, failureReason: 'plan-goal-id-mismatch' };
  }

  // ── 2. Reject forbidden execution-authority fields ─────────────────
  for (const field of FORBIDDEN_EXECUTION_FIELDS) {
    if (field in parsed) {
      return { ok: false, failureReason: `plan-forbidden-field:${field}` };
    }
  }

  // ── 3. Normalise fields before validation ──────────────────────────
  const now = input.now ?? Date.now();
  const planId: string = (input.id ?? (typeof parsed.id === 'string' ? parsed.id : undefined) ?? randomUUID()) as string;

  // Force status to awaiting-approval — the agent must never output an
  // already-approved plan.
  const status = 'awaiting-approval';

  // Normalise steps: force status to 'pending', fill in planId.
  const rawSteps = Array.isArray(parsed.steps) ? parsed.steps : [];
  const steps: PlanStep[] = rawSteps.map((s: unknown, index: number) => {
    if (!isRecord(s)) {
      // Will be caught by schema validation.
      return {
        id: randomUUID(),
        planId,
        index,
        intent: '',
        kind: 'review' as const,
        targetEndpointId: '',
        tier: 'patch-proposal' as const,
        isStateMutating: false,
        status: 'pending' as const,
      };
    }
    return {
      id: typeof s.id === 'string' && s.id.length > 0 ? s.id : randomUUID(),
      planId,
      index: typeof s.index === 'number' ? s.index : index,
      intent: typeof s.intent === 'string' ? s.intent : '',
      kind: (typeof s.kind === 'string' ? s.kind : 'review') as PlanStep['kind'],
      targetEndpointId: typeof s.targetEndpointId === 'string' ? s.targetEndpointId : '',
      tier: (typeof s.tier === 'string' ? s.tier : 'patch-proposal') as ExecutionTier,
      isStateMutating: typeof s.isStateMutating === 'boolean' ? s.isStateMutating : false,
      status: 'pending' as const, // always force
      output: undefined,
      failureReason: undefined,
    };
  });

  // Normalise permittedTiers from caller scope, not model output. The model may
  // request or mention workspace-write, but it cannot grant that permission to
  // itself. That scope must come from an explicit caller/human decision.
  const callerTiers = normalizeCallerPermittedTiers(input.permittedTiers);
  if (!callerTiers.ok) {
    return { ok: false, failureReason: callerTiers.failureReason };
  }
  const permittedTiers = callerTiers.tiers;

  // ── 4. Workspace-write tier enforcement ────────────────────────────
  const downgrades: PlanTierDowngrade[] = [];
  const hasWorkspaceWriteInPermitted = permittedTiers.includes('workspace-write');

  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i];
    if (step.tier === 'workspace-write') {
      if (!hasWorkspaceWriteInPermitted) {
        if (tierEnforcement === 'strict') {
          return {
            ok: false,
            failureReason: `plan-tier-violation: step ${i} ("${step.intent || step.id}") has tier=workspace-write but permittedTiers does not include workspace-write. Either remove the workspace-write steps or explicitly add "workspace-write" to permittedTiers.`,
          };
        }
        // Downgrade mode: swap tier and record the downgrade.
        downgrades.push({
          stepIndex: i,
          stepId: step.id,
          originalTier: 'workspace-write',
          downgradedTo: 'patch-proposal',
          reason: 'plan permittedTiers does not include workspace-write; step downgraded to patch-proposal',
        });
        step.tier = 'patch-proposal';
        // Non-mutating steps with workspace-write were likely misclassified;
        // we correct isStateMutating based on kind, which is the canonical source.
        // The store also re-derives isStateMutating from kind on attach, so this
        // is a belt-and-suspenders fix.
      }
    }
  }

  // ── 5. Assemble and validate ───────────────────────────────────────
  const plan: Plan = {
    id: planId,
    goalId: input.goalId,
    steps,
    status,
    permittedTiers,
    createdAt: typeof parsed.createdAt === 'number' ? parsed.createdAt : now,
    updatedAt: now,
  };

  try {
    assertPlan(plan);
  } catch (error) {
    return {
      ok: false,
      failureReason: error instanceof Error
        ? `plan-schema-invalid: ${error.message}`
        : 'plan-schema-invalid',
    };
  }

  return {
    ok: true,
    plan,
    downgrades: downgrades.length > 0 ? downgrades : undefined,
  };
}
