// v2.4a-8 — CriticModel: calls ModelProvider, parses and validates critique.
//
// Output is advisory-only. A blocking critique is a label; it never mutates,
// rejects, cancels, approves, dispatches, or revises a plan.

import type {
  CritiqueDraftSuggestion,
  CritiqueResult,
  ModelProvider,
  PlanDraftSuggestion,
} from './provider-interface.ts';

export interface CriticModelInput {
  goalDescription: string;
  draft: PlanDraftSuggestion;
  permittedTiers: string[];
  projectContext?: string;
  maxItems: number;
}

export interface CriticModelResult {
  ok: true;
  critique: {
    summary?: string;
    items: Array<{
      severity: CritiqueSeverity;
      category: CritiqueCategory;
      message: string;
      stepIndex?: number;
      stepId?: string;
      suggestedAction?: string;
    }>;
  };
  provider: string;
  usage: { promptTokens: number; completionTokens: number };
  latencyMs: number;
}

export interface CriticModelFailure {
  ok: false;
  reason: string;
  kind: 'provider-error' | 'schema-rejection' | 'policy-rejection' | 'budget-exceeded';
  latencyMs: number;
  usage?: { promptTokens: number; completionTokens: number };
}

type CritiqueSeverity = 'info' | 'warning' | 'blocking';
type CritiqueCategory = 'scope' | 'safety' | 'sequencing' | 'test_coverage' | 'policy';

const VALID_SEVERITIES = new Set<CritiqueSeverity>(['info', 'warning', 'blocking']);
const VALID_CATEGORIES = new Set<CritiqueCategory>(['scope', 'safety', 'sequencing', 'test_coverage', 'policy']);
const MAX_CRITIQUE_ITEMS = 10;
const FORBIDDEN_ACTION_PATTERNS = [
  /\b(shell|bash|powershell|cmd\.exe|exec|spawn)\b/i,
  /\bgit\s+(commit|push|merge|reset|checkout|rebase|tag)\b/i,
  /\b(auto-?apply|auto-?commit|auto-?push|auto-?merge)\b/i,
  /\b(api\s*key|secret|credential|token)\b/i,
  /\b(bypass|skip|disable)\b.*\b(gate|approval|policy|audit)\b/i,
  /\bworkspace-write\b/i,
  /\b(run|execute)\s+(this|the following|command|script)\b/i,
];

export async function generateModelCritique(
  provider: ModelProvider,
  input: CriticModelInput,
): Promise<CriticModelResult | CriticModelFailure> {
  if (typeof provider.critique !== 'function') {
    return {
      ok: false,
      reason: 'Model provider does not support CriticModel critique',
      kind: 'provider-error',
      latencyMs: 0,
    };
  }

  const result = await provider.critique({
    goalDescription: input.goalDescription,
    draft: input.draft,
    permittedTiers: input.permittedTiers,
    projectContext: input.projectContext,
    maxItems: Math.min(input.maxItems, MAX_CRITIQUE_ITEMS),
  });

  if (!result.ok) {
    return { ok: false, reason: result.reason, kind: 'provider-error', latencyMs: result.latencyMs, usage: result.usage };
  }

  return validateCritiqueResult(result, input.draft.steps.length);
}

function validateCritiqueResult(
  result: CritiqueResult,
  stepCount: number,
): CriticModelResult | CriticModelFailure {
  const critique = result.critique as CritiqueDraftSuggestion;
  if (!critique || !Array.isArray(critique.items)) {
    return reject('critique.items must be an array', 'schema-rejection', result);
  }
  if (critique.items.length > MAX_CRITIQUE_ITEMS) {
    return reject(`Critique item count ${critique.items.length} exceeds hard ceiling ${MAX_CRITIQUE_ITEMS}`, 'policy-rejection', result);
  }
  if (critique.summary !== undefined && typeof critique.summary !== 'string') {
    return reject('critique.summary must be a string when present', 'schema-rejection', result);
  }

  const validItems: CriticModelResult['critique']['items'] = [];
  for (let i = 0; i < critique.items.length; i++) {
    const item = critique.items[i];
    if (!VALID_SEVERITIES.has(item.severity as CritiqueSeverity)) {
      return reject(`item[${i}]: invalid severity "${String(item.severity)}"`, 'schema-rejection', result);
    }
    if (!VALID_CATEGORIES.has(item.category as CritiqueCategory)) {
      return reject(`item[${i}]: invalid category "${String(item.category)}"`, 'schema-rejection', result);
    }
    if (typeof item.message !== 'string' || item.message.trim().length === 0) {
      return reject(`item[${i}]: missing message`, 'schema-rejection', result);
    }
    if (item.stepIndex !== undefined) {
      if (!Number.isInteger(item.stepIndex) || item.stepIndex < 0 || item.stepIndex >= stepCount) {
        return reject(`item[${i}]: stepIndex out of range`, 'schema-rejection', result);
      }
    }
    if (item.stepId !== undefined && typeof item.stepId !== 'string') {
      return reject(`item[${i}]: stepId must be a string`, 'schema-rejection', result);
    }
    if (item.suggestedAction !== undefined && typeof item.suggestedAction !== 'string') {
      return reject(`item[${i}]: suggestedAction must be a string`, 'schema-rejection', result);
    }
    const content = [item.message, item.suggestedAction ?? ''].join('\n');
    if (containsForbiddenAction(content)) {
      return reject(`item[${i}]: forbidden executable or gate-bypass content`, 'policy-rejection', result);
    }

    validItems.push({
      severity: item.severity as CritiqueSeverity,
      category: item.category as CritiqueCategory,
      message: item.message.trim(),
      stepIndex: item.stepIndex,
      stepId: item.stepId,
      suggestedAction: item.suggestedAction?.trim(),
    });
  }

  return {
    ok: true,
    critique: {
      summary: critique.summary?.trim(),
      items: validItems,
    },
    provider: result.provider,
    usage: result.usage,
    latencyMs: result.latencyMs,
  };
}

function containsForbiddenAction(text: string): boolean {
  return FORBIDDEN_ACTION_PATTERNS.some(pattern => pattern.test(text));
}

function reject(
  reason: string,
  kind: CriticModelFailure['kind'],
  result: CritiqueResult,
): CriticModelFailure {
  return {
    ok: false,
    reason,
    kind,
    latencyMs: result.latencyMs,
    usage: result.usage,
  };
}
