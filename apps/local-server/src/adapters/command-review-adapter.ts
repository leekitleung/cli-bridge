// Command Transport review-only adapters (v1.5b, see ADR-0002 + v1.5b handoff).
//
// These adapters run a local, already-authorized CLI (Codex / Claude Code) in its
// stable non-interactive review-only mode, capture the output, and parse it into
// a ReviewResult. They build on the hardened command-runner gate and add NO new
// execution authority:
//   - fixed argv only (no user-supplied commands / args);
//   - review-only flags (no tools / read-only);
//   - output parsed via the existing forbidden-execution-field parser;
//   - fail-closed on any runner or parse failure.
//
// The adapter returns a ReviewResult. It NEVER confirms, sends, or executes a
// follow-up; the nextPromptDraft (if any) stays a draft for the lifecycle to gate.

import {
  parseClaudeReviewResult,
  type ParseClaudeReviewResultResult,
} from '../review/review-result-parser.ts';
import {
  runAllowlistedCommand,
  type AllowedCommand,
  type CommandRunOptions,
  type CommandRunResult,
} from './command-runner.ts';

export interface CommandReviewInput {
  prompt: string;
  reviewRequestId: string;
  cwd?: string;
  resultId?: string;
  now?: number;
}

export interface CommandReviewResult {
  ok: boolean;
  adapterName: string;
  result?: ParseClaudeReviewResultResult['result'];
  failureReason?: string;
  // Non-sensitive invocation metadata for audit. Never includes raw prompt or
  // raw CLI output.
  meta: {
    command: AllowedCommand;
    argv: string[];
    exitCode: number | null;
    durationMs: number;
    timedOut: boolean;
    truncated: boolean;
  };
}

export interface CommandReviewAdapterConfig {
  adapterName: string;
  command: AllowedCommand;
  // Builds the fixed argv for this review invocation. The prompt is passed via
  // stdin, never interpolated into argv.
  buildArgs: () => string[];
}

// Captures the agent's final text from a successful run. Real CLIs differ in
// shape, so we normalize the three observed forms into a single candidate text
// and let the existing parser enforce the ReviewResult contract (including
// forbidden execution-field rejection). This NEVER relaxes the parser; it only
// locates where the ReviewResult JSON lives in the CLI's output.
//
// Handled shapes:
//   1. bare ReviewResult JSON on stdout.
//   2. Claude `--output-format json` envelope: { type:"result", result:"<text>" }
//      — the ReviewResult JSON is inside the `result` string.
//   3. Codex `--json` JSONL event stream: the final assistant/message text is in
//      the last event that carries a text/message/result field.
export function selectReviewText(run: CommandRunResult): string {
  const stdout = run.stdout.trim();
  if (stdout.length === 0) {
    return stdout;
  }

  // Try the whole stdout as a single JSON value first.
  const whole = tryParseJson(stdout);
  if (whole !== undefined) {
    const unwrapped = unwrapEnvelope(whole);
    if (unwrapped !== undefined) {
      return unwrapped;
    }
    // It parsed as JSON but is not an envelope: it may already be the bare
    // ReviewResult object. Hand the original text to the parser.
    return stdout;
  }

  // Not a single JSON value: treat it as JSONL and scan events newest-first for
  // one that carries review text.
  const lines = stdout.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const event = tryParseJson(lines[i]);
    if (event === undefined) {
      continue;
    }
    const text = unwrapEnvelope(event);
    if (text !== undefined) {
      return text;
    }
  }

  // Fall back to the raw stdout; the parser will fail closed if it is not a
  // valid ReviewResult.
  return stdout;
}

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

// Returns inner ReviewResult-bearing text from a known envelope shape, or
// undefined when the value is not a recognized envelope.
function unwrapEnvelope(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const record = value as Record<string, unknown>;

  // Claude result envelope and simple message events surface the payload in one
  // of these string fields.
  for (const key of ['result', 'text', 'message', 'content'] as const) {
    const field = record[key];
    if (typeof field === 'string' && field.trim().length > 0) {
      return field.trim();
    }
  }

  // Codex `--json` event stream nests the agent message one level deeper:
  // { type: "item.completed", item: { type: "agent_message", text: "<json>" } }
  const item = record.item;
  if (typeof item === 'object' && item !== null) {
    const itemText = (item as Record<string, unknown>).text;
    if (typeof itemText === 'string' && itemText.trim().length > 0) {
      return itemText.trim();
    }
  }

  return undefined;
}

export function createCommandReviewAdapter(config: CommandReviewAdapterConfig) {
  return {
    name: config.adapterName,
    async review(
      input: CommandReviewInput,
      options: CommandRunOptions = {},
    ): Promise<CommandReviewResult> {
      const argv = config.buildArgs();
      const meta = {
        command: config.command,
        argv,
        exitCode: null as number | null,
        durationMs: 0,
        timedOut: false,
        truncated: false,
      };

      const run = await runAllowlistedCommand(
        {
          command: config.command,
          args: argv,
          stdin: input.prompt,
          cwd: input.cwd,
        },
        options,
      );

      meta.exitCode = run.exitCode;
      meta.durationMs = run.durationMs;
      meta.timedOut = run.timedOut;
      meta.truncated = run.truncated;

      if (!run.ok) {
        return {
          ok: false,
          adapterName: config.adapterName,
          failureReason: run.failureReason ?? 'command-run-failed',
          meta,
        };
      }

      const parsed = parseClaudeReviewResult({
        text: selectReviewText(run),
        reviewRequestId: input.reviewRequestId,
        id: input.resultId,
        now: input.now,
      });

      if (!parsed.ok) {
        return {
          ok: false,
          adapterName: config.adapterName,
          failureReason: parsed.failureReason ?? 'review-result-parse-failed',
          meta,
        };
      }

      return {
        ok: true,
        adapterName: config.adapterName,
        result: parsed.result,
        meta,
      };
    },
  };
}

export type CommandReviewAdapter = ReturnType<typeof createCommandReviewAdapter>;

// Claude Code review-only: non-interactive print mode, JSON output, all tools
// disabled, plan permission mode, no session persistence. Prompt via stdin.
export const CLAUDE_REVIEW_ARGS: string[] = [
  '-p',
  '--output-format',
  'json',
  '--tools',
  '',
  '--disallowed-tools',
  'Bash,Edit,Write,Read,WebFetch,WebSearch',
  '--permission-mode',
  'plan',
  '--no-session-persistence',
];

export function createClaudeReviewCommandAdapter(): CommandReviewAdapter {
  return createCommandReviewAdapter({
    adapterName: 'claude-code-review-command',
    command: 'claude',
    buildArgs: () => [...CLAUDE_REVIEW_ARGS],
  });
}

// Codex review-only: use the general non-interactive `codex exec` with a
// read-only sandbox (the `exec review` subcommand requires a git diff target and
// does not accept an arbitrary review prompt). Prompt is piped via stdin (`-`).
export const CODEX_REVIEW_ARGS: string[] = [
  'exec',
  '-s',
  'read-only',
  '--json',
  '--ephemeral',
  '-',
];

export function createCodexReviewCommandAdapter(): CommandReviewAdapter {
  return createCommandReviewAdapter({
    adapterName: 'codex-review-command',
    command: 'codex',
    buildArgs: () => [...CODEX_REVIEW_ARGS],
  });
}
