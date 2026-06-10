// v2.0 in-memory Goal/Plan/PlanStep store (ADR-0003).
//
// This store holds the goal-driven workflow state and enforces the structural
// safety invariants:
//   - a Plan must be `approved` before any step can run;
//   - a state-mutating step is gated: it enters `blocked-needs-gate` and only a
//     separate gate approval moves it to `gated-approved`;
//   - non-mutating steps may run within an approved plan.
//
// It holds NO execution authority — it does not spawn processes or call agents.
// The orchestrator (later slice) drives execution through this store. Keeping
// the store side-effect-free makes the safety invariants auditable.

import { randomUUID } from 'node:crypto';

import {
  assertGoal,
  assertPlan,
} from '../../../../packages/shared/src/schemas.ts';
import type {
  ExecutionTier,
  Goal,
  Plan,
  PlanStep,
  PlanStepKind,
} from '../../../../packages/shared/src/types.ts';

// Kinds that change state. These always require the per-step gate and are never
// covered by plan-level approval (ADR-0003 §4).
const STATE_MUTATING_KINDS: ReadonlySet<PlanStepKind> = new Set<PlanStepKind>([
  'apply-patch',
  'run-command',
  'write-file',
  'delete-file',
  'git-commit',
  'git-push',
]);

export function isStateMutatingKind(kind: PlanStepKind): boolean {
  return STATE_MUTATING_KINDS.has(kind);
}

export interface CreateGoalInput {
  id?: string;
  sessionId: string;
  description: string;
  /** Optional project scope (Phase B). Defaults to 'cli-bridge' at query time. */
  projectId?: string;
  now?: number;
}

export interface PlanStepInput {
  intent: string;
  kind: PlanStepKind;
  targetEndpointId: string;
  tier?: ExecutionTier;
}

export interface AttachPlanInput {
  id?: string;
  goalId: string;
  steps: PlanStepInput[];
  // Defaults to ['patch-proposal']. To allow workspace-write steps, explicitly
  // include 'workspace-write' here. This makes the tier scope visible and
  // auditable at plan-creation time.
  permittedTiers?: ExecutionTier[];
  now?: number;
}

// Data-layer helper: the orchestrator uses this to reject dispatching a step
// whose tier is not in the plan's approved scope before any process is spawned.
export function isStepTierPermitted(plan: Plan, step: PlanStep): boolean {
  return plan.permittedTiers.includes(step.tier);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class InMemoryGoalStore {
  private readonly goals = new Map<string, Goal>();
  private readonly plans = new Map<string, Plan>();
  private readonly plansByGoal = new Map<string, string>();

  createGoal(input: CreateGoalInput): Goal {
    const now = input.now ?? Date.now();
    const goal: Goal = {
      id: input.id ?? randomUUID(),
      sessionId: input.sessionId,
      projectId: input.projectId,
      description: input.description,
      status: 'draft',
      createdAt: now,
      updatedAt: now,
    };
    assertGoal(goal);
    this.goals.set(goal.id, clone(goal));
    return clone(goal);
  }

  // Attach a generated plan to a goal. The goal moves to `planned`; the plan is
  // `awaiting-approval`. Default tier is patch-proposal (ADR-0003 §2).
  attachPlan(input: AttachPlanInput): Plan | undefined {
    const goal = this.goals.get(input.goalId);
    if (!goal || goal.status !== 'draft') {
      return undefined;
    }
    const now = input.now ?? Date.now();
    const planId = input.id ?? randomUUID();
    const steps: PlanStep[] = input.steps.map((s, index) => ({
      id: randomUUID(),
      planId,
      index,
      intent: s.intent,
      kind: s.kind,
      targetEndpointId: s.targetEndpointId,
      tier: s.tier ?? 'patch-proposal',
      isStateMutating: isStateMutatingKind(s.kind),
      status: 'pending',
    }));
    const plan: Plan = {
      id: planId,
      goalId: goal.id,
      steps,
      status: 'awaiting-approval',
      permittedTiers: input.permittedTiers ?? ['patch-proposal'],
      createdAt: now,
      updatedAt: now,
    };
    assertPlan(plan);
    this.plans.set(plan.id, clone(plan));
    this.plansByGoal.set(goal.id, plan.id);

    goal.status = 'planned';
    goal.updatedAt = now;
    this.goals.set(goal.id, clone(goal));

    return clone(plan);
  }

  // Plan-level human approval. Only an awaiting-approval plan can be approved.
  approvePlan(goalId: string, now: number = Date.now()): Plan | undefined {
    const plan = this.getPlanByGoal(goalId);
    const goal = this.goals.get(goalId);
    if (!plan || !goal || plan.status !== 'awaiting-approval') {
      return undefined;
    }
    plan.status = 'approved';
    plan.approvedAt = now;
    plan.updatedAt = now;
    goal.status = 'approved';
    goal.updatedAt = now;
    this.plans.set(plan.id, clone(plan));
    this.goals.set(goal.id, clone(goal));
    return clone(plan);
  }

  // Returns the next runnable step for an approved plan, or undefined when none.
  // A state-mutating step is returned but the caller must route it to the gate;
  // the store does not auto-run anything.
  nextRunnableStep(goalId: string): PlanStep | undefined {
    const plan = this.getPlanByGoal(goalId);
    if (!plan || (plan.status !== 'approved' && plan.status !== 'executing')) {
      return undefined;
    }
    return plan.steps
      .filter((s) => s.status === 'pending' || s.status === 'gated-approved')
      .sort((a, b) => a.index - b.index)[0];
  }

  markStepRunning(goalId: string, stepId: string, now: number = Date.now()): PlanStep | undefined {
    return this.transitionStep(goalId, stepId, now, (step) => {
      // Non-mutating step, or a gate-approved mutating step, may run.
      if (step.status === 'pending' && step.isStateMutating) {
        return undefined; // must be gated first
      }
      if (step.status !== 'pending' && step.status !== 'gated-approved') {
        return undefined;
      }
      step.status = 'running';
    });
  }

  // Move a pending state-mutating step into the gate queue.
  blockStepForGate(goalId: string, stepId: string, now: number = Date.now()): PlanStep | undefined {
    return this.transitionStep(goalId, stepId, now, (step) => {
      if (step.status !== 'pending' || !step.isStateMutating) {
        return undefined;
      }
      step.status = 'blocked-needs-gate';
    });
  }

  // Human gate approval for a blocked state-mutating step.
  approveStepGate(goalId: string, stepId: string, now: number = Date.now()): PlanStep | undefined {
    return this.transitionStep(goalId, stepId, now, (step) => {
      if (step.status !== 'blocked-needs-gate') {
        return undefined;
      }
      step.status = 'gated-approved';
    });
  }

  completeStep(goalId: string, stepId: string, output: string | undefined, now: number = Date.now()): PlanStep | undefined {
    return this.transitionStep(goalId, stepId, now, (step) => {
      if (step.status !== 'running') {
        return undefined;
      }
      step.status = 'done';
      step.output = output;
    });
  }

  failStep(goalId: string, stepId: string, reason: string, now: number = Date.now()): PlanStep | undefined {
    return this.transitionStep(goalId, stepId, now, (step) => {
      step.status = 'failed';
      step.failureReason = reason;
    });
  }

  cancelGoal(goalId: string, now: number = Date.now()): Goal | undefined {
    const goal = this.goals.get(goalId);
    if (!goal || goal.status === 'done' || goal.status === 'cancelled') {
      return undefined;
    }
    goal.status = 'cancelled';
    goal.updatedAt = now;
    this.goals.set(goal.id, clone(goal));
    const plan = this.getPlanByGoal(goalId);
    if (plan && plan.status !== 'done') {
      plan.status = 'cancelled';
      plan.updatedAt = now;
      this.plans.set(plan.id, clone(plan));
    }
    return clone(goal);
  }

  getGoal(goalId: string): Goal | undefined {
    const goal = this.goals.get(goalId);
    return goal ? clone(goal) : undefined;
  }

  getPlanByGoal(goalId: string): Plan | undefined {
    const planId = this.plansByGoal.get(goalId);
    if (!planId) {
      return undefined;
    }
    const plan = this.plans.get(planId);
    return plan ? clone(plan) : undefined;
  }

  listGoals(): Goal[] {
    return Array.from(this.goals.values(), clone);
  }

  /** Export goals for snapshot persistence. */
  exportGoals(): Goal[] {
    return this.listGoals();
  }

  /** Export plans for snapshot persistence. */
  exportPlans(): Plan[] {
    return Array.from(this.plans.values(), clone);
  }

  /** Hydrate a goal from snapshot data. Invalid goals are silently skipped. */
  hydrateGoal(goal: Goal): boolean {
    try {
      assertGoal(goal);
      this.goals.set(goal.id, clone(goal));
      return true;
    } catch {
      return false;
    }
  }

  /** Hydrate a plan from snapshot data. Invalid plans are silently skipped. */
  hydratePlan(plan: Plan): boolean {
    try {
      assertPlan(plan);
      this.plans.set(plan.id, clone(plan));
      this.plansByGoal.set(plan.goalId, plan.id);
      return true;
    } catch {
      return false;
    }
  }

  private transitionStep(
    goalId: string,
    stepId: string,
    now: number,
    mutate: (step: PlanStep) => void | undefined,
  ): PlanStep | undefined {
    const planId = this.plansByGoal.get(goalId);
    if (!planId) {
      return undefined;
    }
    const plan = this.plans.get(planId);
    if (!plan) {
      return undefined;
    }
    // No step transition is allowed until the plan has been approved. This is
    // the structural guard behind "plan-level approval gates execution".
    if (plan.status !== 'approved' && plan.status !== 'executing') {
      return undefined;
    }
    const step = plan.steps.find((s) => s.id === stepId);
    if (!step) {
      return undefined;
    }
    const before = step.status;
    mutate(step);
    if (step.status === before && before !== 'failed') {
      // No legal transition happened.
      return undefined;
    }
    if (plan.status === 'approved') {
      plan.status = 'executing';
    }
    plan.updatedAt = now;
    // Plan completes when all steps are done.
    if (plan.steps.every((s) => s.status === 'done')) {
      plan.status = 'done';
      const goal = this.goals.get(goalId);
      if (goal) {
        goal.status = 'done';
        goal.updatedAt = now;
        this.goals.set(goal.id, clone(goal));
      }
    }
    this.plans.set(plan.id, clone(plan));
    return clone(step);
  }
}
