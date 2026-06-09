// v1.7 Review Workflow CLI wrapper (review-only).
//
// Wraps the three-step review flow (create -> confirm -> dispatch) into one
// call against the authenticated /bridge/reviews* endpoints. It is review-only:
//   - it only talks to /bridge/reviews*;
//   - it never writes files, never executes a follow-up, never touches WorkBuddy;
//   - any nextPromptDraft stays a draft id, surfaced for the human to act on.
//
// The HTTP boundary is injectable (`fetchFn`) so tests exercise orchestration
// without a running server or a real CLI.

export interface ReviewWorkflowInput {
  baseUrl: string;
  token: string;
  sessionId: string;
  sourceEndpointId: string;
  targetEndpointId: string;
  prompt: string;
  origin?: string;
  fetchFn?: typeof fetch;
}

export interface ReviewWorkflowResult {
  ok: boolean;
  step?: 'create' | 'confirm' | 'dispatch';
  failureReason?: string;
  reviewId?: string;
  status?: string;
  summary?: string;
  findings?: string[];
  nextPromptDraftId?: string;
  nextPromptStatus?: string;
}

const DEFAULT_ORIGIN = 'https://chatgpt.com';

export async function runReviewWorkflow(
  input: ReviewWorkflowInput,
): Promise<ReviewWorkflowResult> {
  const fetchFn = input.fetchFn ?? fetch;
  const headers = {
    'content-type': 'application/json',
    origin: input.origin ?? DEFAULT_ORIGIN,
    'x-cli-bridge-pairing-token': input.token,
  };
  const base = input.baseUrl.replace(/\/$/u, '');

  const post = async (path: string, body: unknown): Promise<
    { ok: true; data: any } | { ok: false; status: number; message: string }
  > => {
    let response: Awaited<ReturnType<typeof fetch>>;
    try {
      response = await fetchFn(`${base}${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
    } catch (error) {
      return { ok: false, status: 0, message: error instanceof Error ? error.message : 'network-error' };
    }
    let data: any = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }
    if (!response.ok) {
      return { ok: false, status: response.status, message: data?.message ?? `http-${response.status}` };
    }
    return { ok: true, data };
  };

  // 1. create (server moves it to previewed)
  const created = await post('/bridge/reviews', {
    sessionId: input.sessionId,
    sourceEndpointId: input.sourceEndpointId,
    targetEndpointId: input.targetEndpointId,
    prompt: input.prompt,
  });
  if (!created.ok) {
    return { ok: false, step: 'create', failureReason: created.message };
  }
  const reviewId = created.data?.review?.id as string | undefined;
  if (!reviewId) {
    return { ok: false, step: 'create', failureReason: 'missing-review-id' };
  }

  // 2. confirm (human gate; the wrapper performs it explicitly as the user's act)
  const confirmed = await post('/bridge/reviews/confirm', { reviewId });
  if (!confirmed.ok) {
    return { ok: false, step: 'confirm', failureReason: confirmed.message, reviewId };
  }

  // 3. dispatch (runs the review-only CLI)
  const dispatched = await post('/bridge/reviews/dispatch', { reviewId });
  if (!dispatched.ok) {
    return { ok: false, step: 'dispatch', failureReason: dispatched.message, reviewId };
  }

  return {
    ok: true,
    reviewId,
    status: dispatched.data?.review?.status,
    summary: dispatched.data?.result?.summary,
    findings: dispatched.data?.result?.findings,
    nextPromptDraftId: dispatched.data?.nextPrompt?.id,
    nextPromptStatus: dispatched.data?.nextPrompt?.status,
  };
}

export interface ParsedReviewArgs {
  ok: boolean;
  error?: string;
  values?: {
    target: string;
    prompt: string;
    sessionId: string;
    source: string;
    url: string;
    token: string;
  };
}

const TARGET_ALIASES: Record<string, string> = {
  claude: 'claude-code-command',
  'claude-code-command': 'claude-code-command',
  codex: 'codex-command',
  'codex-command': 'codex-command',
};

// Parses argv for the review CLI. Token/url fall back to env. Only the two
// review-only command targets are accepted.
export function parseReviewArgs(
  argv: string[],
  env: Record<string, string | undefined> = {},
): ParsedReviewArgs {
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        flags.set(key, next);
        i += 1;
      } else {
        flags.set(key, 'true');
      }
    }
  }

  const targetRaw = flags.get('target') ?? 'claude';
  const target = TARGET_ALIASES[targetRaw];
  if (!target) {
    return { ok: false, error: `unknown target "${targetRaw}" (use claude or codex)` };
  }

  const prompt = flags.get('prompt');
  if (!prompt) {
    return { ok: false, error: 'missing --prompt' };
  }

  const url = flags.get('url') ?? env.CLI_BRIDGE_URL ?? 'http://127.0.0.1:31337';
  const token = flags.get('token') ?? env.CLI_BRIDGE_TOKEN;
  if (!token) {
    return { ok: false, error: 'missing pairing token (pass --token or set CLI_BRIDGE_TOKEN)' };
  }

  return {
    ok: true,
    values: {
      target,
      prompt,
      sessionId: flags.get('session') ?? `cli-${Date.now()}`,
      source: flags.get('source') ?? 'codex-command',
      url,
      token,
    },
  };
}
