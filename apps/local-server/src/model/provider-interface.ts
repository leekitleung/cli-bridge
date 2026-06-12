// v2.4a — ModelProvider interface
//
// Advisory-only contract. Model output is never authoritative;
// PolicyEngine and human approval always gate acceptance.

export interface PlanRequestInput {
  /** The goal description to build a plan for. */
  goalDescription: string;
  /** Available endpoints (id, label, capabilities) for step assignment. */
  endpoints: Array<{ id: string; label: string }>;
  /** Permitted execution tiers for this plan. */
  permittedTiers: string[];
  /** Project context (optional). */
  projectContext?: string;
  /** Max suggested steps (ADB from ADR-0003 hard ceiling). */
  maxSteps: number;
}

export interface CritiqueRequestInput {
  /** The goal description whose draft is being reviewed. */
  goalDescription: string;
  /** Advisory PlanDraft to critique. */
  draft: PlanDraftSuggestion;
  /** Minimal policy context; never grants authority. */
  permittedTiers: string[];
  /** Project context (optional). */
  projectContext?: string;
  /** Maximum critique items. */
  maxItems: number;
}

export interface PlanStepSuggestion {
  intent: string;
  kind: string;
  tier: string;
  isStateMutating: boolean;
  targetEndpointId: string;
}

export interface PlanDraftSuggestion {
  /** Suggested plan steps. Schema-validated after parsing. */
  steps: PlanStepSuggestion[];
  /** Model-provided rationale (not authoritative). */
  rationale?: string;
}

export interface PlanResult {
  ok: true;
  draft: PlanDraftSuggestion;
  /** Model provider identifier. */
  provider: string;
  /** Token usage stats. */
  usage: { promptTokens: number; completionTokens: number };
  /** Latency in ms. */
  latencyMs: number;
}

export interface CritiqueItemSuggestion {
  severity: string;
  category: string;
  message: string;
  stepIndex?: number;
  stepId?: string;
  suggestedAction?: string;
}

export interface CritiqueDraftSuggestion {
  items: CritiqueItemSuggestion[];
  summary?: string;
}

export interface CritiqueResult {
  ok: true;
  critique: CritiqueDraftSuggestion;
  /** Model provider identifier. */
  provider: string;
  /** Token usage stats. */
  usage: { promptTokens: number; completionTokens: number };
  /** Latency in ms. */
  latencyMs: number;
}

export interface PlanError {
  ok: false;
  reason: string;
  /** Whether the error is retryable (transient network) vs permanent. */
  retryable: boolean;
  /** Optional token usage if partial response received. */
  usage?: { promptTokens: number; completionTokens: number };
  latencyMs: number;
}

export interface ModelProvider {
  /** Generate a plan suggestion from a goal description.
   *  Returns PlanResult on success, PlanError on failure.
   *  Never side-effects; never executes; never persists. */
  plan(input: PlanRequestInput): Promise<PlanResult | PlanError>;
  /** Review an advisory draft and return advisory critique items.
   *  Never side-effects; never executes; never persists. */
  critique?(input: CritiqueRequestInput): Promise<CritiqueResult | PlanError>;
}
