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

// Captures the agent's final text from a successful run. Claude `-p
// --output-format json` and Codex `--json` differ in shape; we accept either a
// plain ReviewResult JSON body or a captured last-message string. The parser
// then enforces the ReviewResult contract and rejects execution fields.
export function selectReviewText(run: CommandRunResult): string {
  return run.stdout.trim();
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

// Codex review-only: prefer `codex exec review` (inherently read-only review
// subcommand) with JSON event stream and an ephemeral session. Prompt via stdin
// (the `-` marker is implicit when stdin is piped).
export const CODEX_REVIEW_ARGS: string[] = [
  'exec',
  'review',
  '--json',
  '--ephemeral',
];

export function createCodexReviewCommandAdapter(): CommandReviewAdapter {
  return createCommandReviewAdapter({
    adapterName: 'codex-review-command',
    command: 'codex',
    buildArgs: () => [...CODEX_REVIEW_ARGS],
  });
}
