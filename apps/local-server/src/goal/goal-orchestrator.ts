// v2.0 Goal orchestrator (§7.3, ADR-0003).
//
// Pure library layer — no HTTP, no Console, no agent/process calls.
// Drives the state machine through InMemoryGoalStore:
//
//   - Finds the next runnable step in an approved plan.
//   - Routes non-mutating steps directly to running/done.
//   - Blocks mutating steps at the gate (blocked-needs-gate).
//   - Enforces step ceiling to bound total step runs.
//   - Rejects any step whose tier is not in plan.permittedTiers.
//   - Stops advancing on step failure, cancellation, or plan completion.
//
// The orchestrator holds NO execution authority — it does not spawn
// processes, call agents, or write files. It only advances state
// transitions through the store's already-existing API.
//
// Scope constraints (§7.3):
//   ✅ Advance state via InMemoryGoalStore.
//   ✅ Step ceiling enforcement (default 20).
//   ✅ Mutating gate dispatch (blocked-needs-gate).
//   ✅ Tier permission check per plan.permittedTiers.
//   ✅ Fail-stop on step failure.
//   ✅ Stop on cancellation.
//   ❌ Do NOT connect HTTP/Console endpoints.
//   ❌ Do NOT call agent or process.
//   ❌ Do NOT create canExecute endpoint.
//   ❌ Do NOT connect Codex patch-proposal adapter.

import type {
  ExecutionTier,
  PlanStepKind,
} from '../../../../packages/shared/src/types.ts';
import type { InMemoryGoalStore } from '../storage/goal-store.ts';

// ---- Public types ----

export interface GoalOrchestratorOptions {
  /** Maximum number of steps the orchestrator will advance in a single
   *  runAll() call before halting. Default: 20.
   *
   *  This is a hard ceiling: the orchestrator will not advance past it,
   *  regardless of how many steps remain in the plan. */
  stepCeiling?: number;
}

/** Detailed result of a single advance() call. */
export type AdvanceResult =
  | AdvanceNoop
  | AdvanceStepCompleted
  | AdvanceStepGated
  | AdvanceStepFailed
  | AdvanceTierViolation
  | AdvanceCeilingReached
  | AdvancePlanCompleted;

export interface AdvanceNoop {
  type: 'noop';
  /** Why nothing was done. */
  reason: string;
}

export interface AdvanceStepCompleted {
  type: 'step-completed';
  stepId: string;
  stepKind: PlanStepKind;
  stepIndex: number;
  output?: string;
}

export interface AdvanceStepGated {
  type: 'step-gated';
  stepId: string;
  stepKind: PlanStepKind;
  stepIndex: number;
}

export interface AdvanceStepFailed {
  type: 'step-failed';
  stepId: string;
  stepKind: PlanStepKind;
  stepIndex: number;
  failureReason: string;
}

export interface AdvanceTierViolation {
  type: 'tier-violation';
  stepId: string;
  stepIndex: number;
  tier: ExecutionTier;
  permitted: ExecutionTier[];
  reason: string;
}

export interface AdvanceCeilingReached {
  type: 'ceiling-reached';
  stepCeiling: number;
}

export interface AdvancePlanCompleted {
  type: 'plan-completed';
}

/** Optional simulation parameters injected per advance() call,
 *  so tests can induce failure or control output without mocks. */
export interface AdvanceStepOptions {
  /** If set, the step will be marked as failed with this reason instead of
   *  completing successfully. Only applies to runnable (non-gated) steps. */
  simulateFailure?: string;
  /** Output text recorded when the step completes successfully. */
  output?: string;
}

// ---- Defaults ----

const DEFAULT_STEP_CEILING = 20;

// ---- Orchestrator ----

export class GoalOrchestrator {
  private readonly store: InMemoryGoalStore;
  private readonly stepCeiling: number;
  private stepsRun = 0;

  constructor(
    store: InMemoryGoalStore,
    options: GoalOrchestratorOptions = {},
  ) {
    this.store = store;
    this.stepCeiling = options.stepCeiling ?? DEFAULT_STEP_CEILING;
  }

  // ---- Public API ----

  /**
   * Advance the plan state machine by exactly one transition.
   *
   * What it does in order:
   *   1. Verify the Goal exists and is in a runnable state.
   *   2. Verify the Plan is approved/executing and not done/cancelled.
   *   3. Check for any already-failed step → fail-stop.
   *   4. Find the next runnable step (pending or gated-approved).
   *   5. Enforce the step ceiling.
   *   6. Verify the step's tier is in plan.permittedTiers.
   *   7. If mutating and pending → block for gate.
   *   8. If non-mutating or gated-approved → mark running,
   *      then complete (or fail if simulateFailure is set).
   *
   * Returns a structured AdvanceResult describing what happened.
   */
  advance(goalId: string, stepOpts?: AdvanceStepOptions): AdvanceResult {
    // ── 1. Goal pre-conditions ──────────────────────────────────────
    const goal = this.store.getGoal(goalId);
    if (!goal) {
      return { type: 'noop', reason: 'goal-not-found' };
    }
    if (goal.status === 'cancelled') {
      return { type: 'noop', reason: 'goal-cancelled' };
    }
    if (goal.status === 'done') {
      return { type: 'plan-completed' };
    }
    if (goal.status === 'failed') {
      return { type: 'noop', reason: 'goal-failed' };
    }
    if (goal.status !== 'approved' && goal.status !== 'executing') {
      return { type: 'noop', reason: `goal-status-${goal.status}: plan must be approved before advancing` };
    }

    // ── 2. Plan pre-conditions ──────────────────────────────────────
    const plan = this.store.getPlanByGoal(goalId);
    if (!plan) {
      return { type: 'noop', reason: 'plan-not-found' };
    }
    if (plan.status === 'cancelled') {
      return { type: 'noop', reason: 'plan-cancelled' };
    }
    if (plan.status === 'done') {
      return { type: 'plan-completed' };
    }
    if (plan.status !== 'approved' && plan.status !== 'executing') {
      return { type: 'noop', reason: `plan-status-${plan.status}` };
    }

    // ── 3. Fail-stop check ──────────────────────────────────────────
    // If any step has already failed, the orchestrator refuses to
    // advance further. The plan is in an unrecoverable state.
    const anyFailed = plan.steps.find((s) => s.status === 'failed');
    if (anyFailed) {
      return {
        type: 'step-failed',
        stepId: anyFailed.id,
        stepKind: anyFailed.kind,
        stepIndex: anyFailed.index,
        failureReason: anyFailed.failureReason ?? 'unknown',
      };
    }

    // ── 4. Find next runnable step ──────────────────────────────────
    const next = this.store.nextRunnableStep(goalId);
    if (!next) {
      // No runnable step. Check if plan is complete (all done).
      const freshPlan = this.store.getPlanByGoal(goalId);
      if (freshPlan && freshPlan.steps.every((s) => s.status === 'done')) {
        return { type: 'plan-completed' };
      }
      // May be blocked at a gate: all pending steps are mutating and
      // await gate approval.
      const blockedSteps = plan.steps.filter((s) => s.status === 'blocked-needs-gate');
      const pendingMutating = plan.steps.filter((s) => s.status === 'pending' && s.isStateMutating);
      if (blockedSteps.length > 0 || pendingMutating.length > 0) {
        return { type: 'noop', reason: 'all-runnable-steps-are-gated' };
      }
      return { type: 'noop', reason: 'no-runnable-step' };
    }

    // ── 5. Step ceiling ─────────────────────────────────────────────
    if (this.stepsRun >= this.stepCeiling) {
      return { type: 'ceiling-reached', stepCeiling: this.stepCeiling };
    }

    // ── 6. Tier permission check ────────────────────────────────────
    const freshPlanForTier = this.store.getPlanByGoal(goalId)!;
    if (!freshPlanForTier.permittedTiers.includes(next.tier)) {
      return {
        type: 'tier-violation',
        stepId: next.id,
        stepIndex: next.index,
        tier: next.tier,
        permitted: freshPlanForTier.permittedTiers,
        reason:
          `step tier "${next.tier}" is not in plan.permittedTiers` +
          ` [${freshPlanForTier.permittedTiers.join(', ')}]`,
      };
    }

    // ── 7. Mutating step → dispatch to gate ─────────────────────────
    if (next.isStateMutating && next.status === 'pending') {
      const blocked = this.store.blockStepForGate(goalId, next.id);
      if (!blocked) {
        return { type: 'noop', reason: `failed-to-block-step-${next.id}` };
      }
      return {
        type: 'step-gated',
        stepId: blocked.id,
        stepKind: blocked.kind,
        stepIndex: blocked.index,
      };
    }

    // ── 8. Runnable step (non-mutating pending, or gated-approved) ──
    const running = this.store.markStepRunning(goalId, next.id);
    if (!running) {
      return { type: 'noop', reason: `failed-to-mark-step-running: ${next.id}` };
    }

    this.stepsRun += 1;

    if (stepOpts?.simulateFailure) {
      const failed = this.store.failStep(goalId, next.id, stepOpts.simulateFailure);
      return {
        type: 'step-failed',
        stepId: next.id,
        stepKind: next.kind,
        stepIndex: next.index,
        failureReason: failed?.failureReason ?? stepOpts.simulateFailure,
      };
    }

    const completed = this.store.completeStep(goalId, next.id, stepOpts?.output);
    return {
      type: 'step-completed',
      stepId: next.id,
      stepKind: next.kind,
      stepIndex: next.index,
      output: completed?.output,
    };
  }

  /**
   * Run through all non-mutating steps in sequence, stopping at the
   * first gate block, failure, ceiling, cancellation, or plan completion.
   *
   * Returns the full trace of AdvanceResults so tests can assert on
   * the sequence of state transitions.
   */
  runAll(goalId: string, stepOpts?: AdvanceStepOptions): AdvanceResult[] {
    const results: AdvanceResult[] = [];
    const maxSteps = this.stepCeiling * 2; // safety valve

    for (let i = 0; i < maxSteps; i += 1) {
      const result = this.advance(goalId, stepOpts);
      results.push(result);

      // Stop on terminal outcomes.
      if (
        result.type === 'plan-completed' ||
        result.type === 'ceiling-reached' ||
        result.type === 'step-failed' ||
        result.type === 'tier-violation' ||
        result.type === 'step-gated' ||
        (result.type === 'noop' && result.reason !== 'all-runnable-steps-are-gated')
      ) {
        break;
      }
      // 'all-runnable-steps-are-gated' → all mutating steps are blocked;
      // the caller can gate-approve them and call runAll() again.
      if (result.type === 'noop' && result.reason === 'all-runnable-steps-are-gated') {
        break;
      }
    }

    return results;
  }

  /** Number of steps the orchestrator has advanced so far. */
  get stepsAdvanced(): number {
    return this.stepsRun;
  }
}
