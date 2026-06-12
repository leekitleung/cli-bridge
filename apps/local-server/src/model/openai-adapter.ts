// v2.4a — OpenAI-compatible adapter using Node built-in fetch.
//
// Implements ModelProvider for OpenAI chat/completions API.
// No npm dependencies. No raw prompt/response logging.
// Parse failures are classified as non-retryable (not network errors).
// Input budget enforced before sending.

import type {
  CritiqueRequestInput,
  CritiqueResult,
  ModelProvider,
  PlanRequestInput,
  PlanResult,
  PlanError,
} from './provider-interface.ts';
import { PLANNER_SYSTEM_PREAMBLE } from './planner-prompt.ts';
import { CRITIC_SYSTEM_PREAMBLE } from './critic-prompt.ts';

export interface OpenAiAdapterOptions {
  /** API endpoint (default: https://api.openai.com/v1). */
  baseUrl?: string;
  /** Model name (default: gpt-4o-mini). */
  model?: string;
  /** Maximum input tokens (default: 4096). */
  maxInputTokens?: number;
  /** Maximum output tokens (default: 2048). */
  maxOutputTokens?: number;
  /** Per-call timeout in ms (default: 30000). */
  timeoutMs?: number;
  /** Max retries for transient network errors (default: 3). */
  maxRetries?: number;
}

const DEFAULTS: Required<Omit<OpenAiAdapterOptions, 'baseUrl'>> = {
  model: 'gpt-4o-mini',
  maxInputTokens: 4096,
  maxOutputTokens: 2048,
  timeoutMs: 30000,
  maxRetries: 3,
};

/** Conservative token estimate: ~4 chars per token for English text. */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export class OpenAiAdapter implements ModelProvider {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly options: Required<OpenAiAdapterOptions>;

  constructor(apiKey: string, opts?: OpenAiAdapterOptions) {
    this.apiKey = apiKey;
    this.baseUrl = opts?.baseUrl ?? 'https://api.openai.com/v1';
    this.options = {
      model: opts?.model ?? DEFAULTS.model,
      maxInputTokens: opts?.maxInputTokens ?? DEFAULTS.maxInputTokens,
      maxOutputTokens: opts?.maxOutputTokens ?? DEFAULTS.maxOutputTokens,
      timeoutMs: opts?.timeoutMs ?? DEFAULTS.timeoutMs,
      maxRetries: opts?.maxRetries ?? DEFAULTS.maxRetries,
      baseUrl: this.baseUrl,
    };
  }

  async plan(input: PlanRequestInput): Promise<PlanResult | PlanError> {
    const start = performance.now();

    // Build endpoint list for prompt.
    const endpointList = input.endpoints.map(e => `- ${e.id}: ${e.label}`).join('\n');
    const userMessage = [
      '## Goal',
      input.goalDescription,
      '',
      '## Project Context',
      input.projectContext || '(none provided)',
      '',
      '## Available Endpoints',
      endpointList,
      '',
      '## Constraints',
      `Permitted tiers: ${input.permittedTiers.join(', ')}`,
      `Maximum steps: ${input.maxSteps}`,
      `Default tier: patch-proposal`,
      '',
      'Generate the plan JSON now.',
    ].join('\n');

    // ════════════════════════════════════════════════
    // Budget enforcement — estimate input tokens
    // ════════════════════════════════════════════════
    const totalInputText = PLANNER_SYSTEM_PREAMBLE + userMessage;
    const estimatedTokens = estimateTokens(totalInputText);
    if (estimatedTokens > this.options.maxInputTokens) {
      return {
        ok: false,
        reason: `Input too large: estimated ${estimatedTokens} tokens exceeds budget ${this.options.maxInputTokens}`,
        retryable: false,
        latencyMs: Math.round(performance.now() - start),
      };
    }

    const messages = [
      { role: 'system', content: PLANNER_SYSTEM_PREAMBLE },
      { role: 'user', content: userMessage },
    ];

    const networkResult = await this.sendWithRetry(messages, start);
    if (networkResult.kind === 'error') return networkResult.error;

    // ════════════════════════════════════════════════
    // Parse model output — parse failures are non-retryable
    // ════════════════════════════════════════════════
    try {
      const draft = this.parseModelOutput(networkResult.content);
      return {
        ok: true,
        draft,
        provider: networkResult.provider,
        usage: networkResult.usage,
        latencyMs: networkResult.latencyMs,
      };
    } catch (err: unknown) {
      return {
        ok: false,
        reason: `Model output parse error: ${(err as Error)?.message ?? 'unknown'}`,
        retryable: false,
        latencyMs: Math.round(performance.now() - start),
      };
    }
  }

  async critique(input: CritiqueRequestInput): Promise<CritiqueResult | PlanError> {
    const start = performance.now();
    const draftText = JSON.stringify(input.draft);
    const userMessage = [
      '## Goal',
      input.goalDescription,
      '',
      '## Project Context',
      input.projectContext || '(none provided)',
      '',
      '## Policy Summary',
      `Permitted tiers: ${input.permittedTiers.join(', ')}`,
      `Maximum critique items: ${input.maxItems}`,
      'Critique is advisory-only and cannot mutate state.',
      '',
      '## Advisory PlanDraft',
      draftText,
      '',
      'Generate the critique JSON now.',
    ].join('\n');

    const totalInputText = CRITIC_SYSTEM_PREAMBLE + userMessage;
    const estimatedTokens = estimateTokens(totalInputText);
    if (estimatedTokens > this.options.maxInputTokens) {
      return {
        ok: false,
        reason: `Input too large: estimated ${estimatedTokens} tokens exceeds budget ${this.options.maxInputTokens}`,
        retryable: false,
        latencyMs: Math.round(performance.now() - start),
      };
    }

    const messages = [
      { role: 'system', content: CRITIC_SYSTEM_PREAMBLE },
      { role: 'user', content: userMessage },
    ];

    const networkResult = await this.sendWithRetry(messages, start);
    if (networkResult.kind === 'error') return networkResult.error;

    try {
      const critique = this.parseCritiqueOutput(networkResult.content);
      return {
        ok: true,
        critique,
        provider: networkResult.provider,
        usage: networkResult.usage,
        latencyMs: networkResult.latencyMs,
      };
    } catch (err: unknown) {
      return {
        ok: false,
        reason: `Model output parse error: ${(err as Error)?.message ?? 'unknown'}`,
        retryable: false,
        latencyMs: Math.round(performance.now() - start),
      };
    }
  }

  private async sendWithRetry(
    messages: Array<{ role: string; content: string }>,
    start: number,
  ): Promise<
    | { kind: 'ok'; content: string; provider: string; usage: { promptTokens: number; completionTokens: number }; latencyMs: number }
    | { kind: 'error'; error: PlanError }
  > {
    let lastError: PlanError | null = null;

    for (let attempt = 0; attempt <= this.options.maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.options.timeoutMs);

        const response = await fetch(`${this.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify({
            model: this.options.model,
            messages,
            max_tokens: this.options.maxOutputTokens,
            temperature: 0.3,
          }),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);
        const latencyMs = Math.round(performance.now() - start);

        if (!response.ok) {
          const status = response.status;
          if (status >= 400 && status < 500) {
            return { kind: 'error', error: { ok: false, reason: `API error ${status}: ${response.statusText}`, retryable: false, latencyMs } };
          }
          throw new Error(`API error ${status}`);
        }

        const data = await response.json() as Record<string, unknown>;
        const choice = (data.choices as Array<Record<string, unknown>>)?.[0];
        const content = (choice?.message as Record<string, unknown>)?.content as string | undefined;
        if (!content) {
          return { kind: 'error', error: { ok: false, reason: 'Empty model response', retryable: false, latencyMs } };
        }

        const usage = data.usage as Record<string, number> | undefined;
        return {
          kind: 'ok',
          content,
          provider: `openai/${this.options.model}`,
          usage: {
            promptTokens: usage?.prompt_tokens ?? 0,
            completionTokens: usage?.completion_tokens ?? 0,
          },
          latencyMs,
        };

      } catch (err: unknown) {
        const latencyMs = Math.round(performance.now() - start);
        if (err instanceof DOMException && err.name === 'AbortError') {
          return { kind: 'error', error: { ok: false, reason: 'Request timed out', retryable: true, latencyMs } };
        }
        lastError = {
          ok: false,
          reason: `Network error: ${(err as Error)?.message ?? 'unknown'}`,
          retryable: true,
          latencyMs,
        };
        if (attempt < this.options.maxRetries) {
          await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 500));
          continue;
        }
      }
    }

    return { kind: 'error', error: lastError! };
  }

  private parseModelOutput(raw: string): PlanResult['draft'] {
    let json = raw.trim();
    const fenceMatch = json.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) json = fenceMatch[1].trim();
    const parsed = JSON.parse(json) as Record<string, unknown>;

    return {
      steps: (Array.isArray(parsed.steps) ? parsed.steps : []) as PlanResult['draft']['steps'],
      rationale: typeof parsed.rationale === 'string' ? parsed.rationale : undefined,
    };
  }

  private parseCritiqueOutput(raw: string): CritiqueResult['critique'] {
    let json = raw.trim();
    const fenceMatch = json.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) json = fenceMatch[1].trim();
    const parsed = JSON.parse(json) as Record<string, unknown>;

    return {
      items: (Array.isArray(parsed.items) ? parsed.items : []) as CritiqueResult['critique']['items'],
      summary: typeof parsed.summary === 'string' ? parsed.summary : undefined,
    };
  }
}
