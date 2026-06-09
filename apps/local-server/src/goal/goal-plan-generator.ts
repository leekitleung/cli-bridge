// Goal → Plan generator (v2.0 §7.2, ADR-0003).
//
// Orchestrates review-only command transport to produce a Plan JSON from a
// Goal description.  This module ties together:
//
//   1. goal-plan-prompt.ts   — builds the review-only prompt
//   2. goal-plan-parser.ts   — parses + validates the CLI output
//   3. InMemoryGoalStore     — attaches the resulting Plan
//
// Unlike command-review-runner.ts which routes through parseClaudeReviewResult
// (expecting {summary, findings} AgentReviewResult shape), this generator
// calls runAllowlistedCommand directly to capture raw stdout, then feeds it
// into parseGoalPlanResult which understands the Plan JSON schema.
//
// It follows the same layered safety architecture:
//   - The human gate (goal approval) is upstream of this generator.
//   - The generator never approves, executes, or writes.
//   - The generated Plan enters 'awaiting-approval' — a separate human gate
//     must approve it before any step can run.
//   - Default permittedTiers = ['patch-proposal'].
//   - If no workspace-write steps exist, the plan stays at patch-proposal only.
//
// Scope constraints (§7.2):
//   ✅ Use review-only command transport to generate Plan JSON.
//   ✅ Output must be Plan with status 'awaiting-approval'.
//   ✅ Default permittedTiers = ['patch-proposal'].
//   ✅ workspace-write tier enforcement (fail-closed by default).
//   ❌ Do NOT execute any step.
//   ❌ Do NOT auto-approve plan.
//   ❌ Do NOT create canExecute:true endpoint.
//   ❌ Do NOT call Codex execution adapter.
//   ❌ Do NOT write files or apply patches.
//   ❌ Do NOT connect console gate.

import type {
  AllowedCommand,
  CommandRunOptions,
} from '../adapters/command-runner.ts';
import {
  runAllowlistedCommand,
} from '../adapters/command-runner.ts';
import type {
  InMemoryGoalStore,
} from '../storage/goal-store.ts';
import type {
  InMemoryAuditLog,
} from '../storage/audit-log.ts';
import {
  buildGoalPlanPrompt,
  type GoalPlanPromptInput,
} from './goal-plan-prompt.ts';
import {
  parseGoalPlanResult,
  type ParseOptions,
} from './goal-plan-parser.ts';
import type {
  ExecutionTier,
  Plan,
} from '../../../../packages/shared/src/types.ts';

// ---- Public types ----

export interface GoalPlanCommandConfig {
  /** Human-readable adapter name for audit metadata. */
  adapterName: string;
  /** Allowlisted command to invoke. */
  command: AllowedCommand;
  /** Review-only argv for the command (e.g. CLAUDE_REVIEW_ARGS). */
  argv: string[];
}

export interface GeneratePlanInput {
  /** Goal ID in the store. Must exist with status 'draft'. */
  goalId: string;
  /** Command config for running the review-only CLI. */
  commandConfig: GoalPlanCommandConfig;
  /** Working directory for the CLI agent. */
  cwd?: string;
  /** Extra context injected into the prompt. */
  extraContext?: string;
  /** Available endpoint IDs the agent may reference in step targets. */
  availableEndpoints?: string[];
  /** Override the tier enforcement mode. Default: 'strict'. */
  tierEnforcement?: ParseOptions['tierEnforcement'];
  /** Explicit caller/human tier scope for the generated plan. Defaults to patch-proposal only. */
  permittedTiers?: ExecutionTier[];
  /** Timestamp anchor. Defaults to Date.now(). */
  now?: number;
  /** Command runner options for test injection. */
  commandOptions?: CommandRunOptions;
}

export interface GeneratePlanResult {
  ok: boolean;
  plan?: Plan;
  failureReason?: string;
  /** Non-sensitive metadata about the CLI invocation for auditing. */
  meta?: GeneratePlanMeta;
  /** Downgrade warnings when tierEnforcement is 'downgrade'. */
  downgrades?: {
    stepIndex: number;
    stepId: string;
    originalTier: string;
    downgradedTo: string;
    reason: string;
  }[];
}

export interface GeneratePlanMeta {
  adapterName: string;
  command: string;
  exitCode: number | null;
  durationMs: number;
  timedOut: boolean;
  truncated: boolean;
}

// ---- Generator ----

/**
 * Generate a Plan from a Goal using review-only command transport.
 *
 * Flow:
 *   1. Look up the Goal (must be 'draft').
 *   2. Build the review-only prompt.
 *   3. Run the CLI agent via runAllowlistedCommand (hardened gate).
 *   4. Parse + validate raw stdout into a Plan via parseGoalPlanResult.
 *   5. Attach the Plan to the Goal via InMemoryGoalStore.
 *   6. Return the Plan (status: 'awaiting-approval').
 *
 * The raw CLI stdout bypasses parseClaudeReviewResult (which expects
 * {summary, findings} shape) and goes directly to parseGoalPlanResult
 * (which understands the Plan JSON schema).
 *
 * Every failure is fail-closed. The generator never throws.
 */
export async function generatePlan(
  store: InMemoryGoalStore,
  auditLog: InMemoryAuditLog,
  input: GeneratePlanInput,
): Promise<GeneratePlanResult> {
  const now = input.now ?? Date.now();

  // ── 1. Look up and validate the Goal ──────────────────────────────
  const goal = store.getGoal(input.goalId);
  if (!goal) {
    return { ok: false, failureReason: 'goal-not-found' };
  }
  if (goal.status !== 'draft') {
    return {
      ok: false,
      failureReason: `goal-not-draft: status is "${goal.status}" — plan generation only allowed for draft goals`,
    };
  }

  // ── 2. Build the review-only prompt ───────────────────────────────
  const promptInput: GoalPlanPromptInput = {
    goalDescription: goal.description,
    goalId: goal.id,
    sessionId: goal.sessionId,
    availableEndpoints: input.availableEndpoints,
    permittedTiers: input.permittedTiers,
    cwd: input.cwd,
    extraContext: input.extraContext,
  };
  const prompt = buildGoalPlanPrompt(promptInput);

  // ── 3. Run the CLI agent through the hardened command gate ────────
  const run = await runAllowlistedCommand(
    {
      command: input.commandConfig.command,
      args: input.commandConfig.argv,
      stdin: prompt,
      cwd: input.cwd,
    },
    input.commandOptions,
  );

  const meta: GeneratePlanMeta = {
    adapterName: input.commandConfig.adapterName,
    command: input.commandConfig.command,
    exitCode: run.exitCode,
    durationMs: run.durationMs,
    timedOut: run.timedOut,
    truncated: run.truncated,
  };

  if (!run.ok) {
    // Audit the failure (non-sensitive metadata only).
    auditLog.createAndAppend({
      sessionId: goal.sessionId,
      packetId: goal.id,
      approvalId: `goal-plan-${goal.id}`,
      type: 'send_review',
      source: 'goal-plan-generator',
      target: input.commandConfig.adapterName,
      snapshot: {
        agent: input.commandConfig.adapterName,
        transport: 'command',
        cwd: input.cwd,
      },
      result: {
        ok: false,
        failureReason: run.failureReason,
      },
      timestamp: now,
    });

    return {
      ok: false,
      failureReason: run.failureReason ?? 'command-run-failed',
      meta,
    };
  }

  // ── 4. Parse raw stdout into a validated Plan ─────────────────────
  const rawStdout = run.stdout.trim();

  if (rawStdout.length === 0) {
    return {
      ok: false,
      failureReason: 'plan-output-empty: CLI agent produced no output',
      meta,
    };
  }

  const parsed = parseGoalPlanResult(
    {
      text: rawStdout,
      goalId: goal.id,
      permittedTiers: input.permittedTiers,
      id: `plan-${goal.id}`,
      now,
    },
    {
      tierEnforcement: input.tierEnforcement ?? 'strict',
      stripFences: true,
    },
  );

  if (!parsed.ok) {
    return {
      ok: false,
      failureReason: parsed.failureReason ?? 'plan-parse-failed',
      meta,
    };
  }

  // ── 5. Attach the Plan to the Goal ────────────────────────────────
  const plan = store.attachPlan({
    id: parsed.plan!.id,
    goalId: goal.id,
    steps: parsed.plan!.steps.map((step) => ({
      intent: step.intent,
      kind: step.kind,
      targetEndpointId: step.targetEndpointId,
      tier: step.tier,
    })),
    permittedTiers: parsed.plan!.permittedTiers,
    now,
  });

  if (!plan) {
    return {
      ok: false,
      failureReason: 'plan-attach-failed: goal may have changed status',
      meta,
    };
  }

  // ── 6. Audit success ──────────────────────────────────────────────
  auditLog.createAndAppend({
    sessionId: goal.sessionId,
    packetId: goal.id,
    approvalId: `goal-plan-${goal.id}`,
    type: 'send_review',
    source: 'goal-plan-generator',
    target: input.commandConfig.adapterName,
    snapshot: {
      agent: input.commandConfig.adapterName,
      transport: 'command',
      cwd: input.cwd,
    },
    result: {
      ok: true,
    },
    timestamp: now,
  });

  return {
    ok: true,
    plan,
    meta,
    downgrades: parsed.downgrades?.map((d) => ({
      stepIndex: d.stepIndex,
      stepId: d.stepId,
      originalTier: d.originalTier,
      downgradedTo: d.downgradedTo,
      reason: d.reason,
    })),
  };
}
