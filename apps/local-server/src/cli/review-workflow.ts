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
  timeoutMs?: number;
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
const DEFAULT_HTTP_TIMEOUT_MS = 30_000;

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
  const timeoutMs = input.timeoutMs ?? DEFAULT_HTTP_TIMEOUT_MS;

  const post = async (path: string, body: unknown): Promise<
    { ok: true; data: any } | { ok: false; status: number; message: string }
  > => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const operation = async () => {
        const response = await fetchFn(`${base}${path}`, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        let data: any = null;
        try {
          data = await response.json();
        } catch {
          data = null;
        }
        return { response, data };
      };
      const deadline = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error('review-http-timeout'));
        }, timeoutMs);
      });
      const { response, data } = await Promise.race([operation(), deadline]);
      if (!response.ok) {
        return { ok: false, status: response.status, message: data?.message ?? `http-${response.status}` };
      }
      return { ok: true, data };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'network-error';
      return { ok: false, status: 0, message };
    } finally {
      if (timer) clearTimeout(timer);
    }
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
    prompt?: string;
    promptFile?: string;
    readStdin: boolean;
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
  const promptFile = flags.get('prompt-file');
  const readStdin = flags.get('stdin') === 'true';
  // Exactly one prompt source is required: --prompt, --prompt-file, or --stdin.
  const sourceCount = [prompt, promptFile, readStdin ? 'x' : undefined].filter(Boolean).length;
  if (sourceCount === 0) {
    return { ok: false, error: 'provide one of --prompt, --prompt-file <path>, or --stdin' };
  }
  if (sourceCount > 1) {
    return { ok: false, error: 'use only one of --prompt, --prompt-file, --stdin' };
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
      promptFile,
      readStdin,
      sessionId: flags.get('session') ?? `cli-${Date.now()}`,
      source: flags.get('source') ?? 'codex-command',
      url,
      token,
    },
  };
}
