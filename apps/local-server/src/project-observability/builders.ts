// v2.1 Read-only project observability builders.
//
// Pure functions that derive timeline, memory, audit, and verification views
// from existing store data. These functions:
//   - Are deterministic (same inputs → same outputs).
//   - Hold NO execution authority, spawn NO processes.
//   - Only read from already-persisted records (goals, plans, reviews, prompts, audit events).
//   - Never write to stores, never modify state.
//   - Enforce project-scoped isolation using projectId-first semantics.

import type {
  ConversationTimelineEntry,
  ConversationTimelineView,
  DerivedMemoryEntry,
  DerivedMemoryView,
  HarnessVerificationRecord,
  HarnessVerificationView,
  ProjectAuditEntry,
  ProjectAuditView,
} from '../../../../packages/shared/src/types.ts';

// ---- Public input types ----

export interface ObservabilityInput {
  projectId: string;
  goals: Array<{
    id: string;
    projectId?: string;
    description: string;
    status: string;
    createdAt: number;
    updatedAt: number;
  }>;
  plans: Array<{
    id: string;
    goalId: string;
    steps: Array<{
      id: string;
      index: number;
      intent: string;
      kind: string;
      status: string;
      isStateMutating?: boolean;
    }>;
    status: string;
  }>;
  reviews: Array<{
    id: string;
    packetId: string;
    projectId?: string;
    prompt: string;
    status: string;
    createdAt: number;
    updatedAt: number;
  }>;
  pendingPrompts: Array<{
    packetId: string;
    projectId?: string;
    prompt: string;
    status: string;
    createdAt: number;
  }>;
  auditEvents: Array<{
    id: string;
    projectId?: string;
    type: string;
    source: string;
    target: string;
    timestamp: number;
    ok?: boolean;
  }>;
}

// ---- Helpers ----

const MAX_AUDIT_LIMIT = 200;
const MAX_TIMELINE_ENTRIES = 500;

// ---- Timeline builder ----

export function buildConversationTimeline(
  input: ObservabilityInput,
): ConversationTimelineView {
  const entries: ConversationTimelineEntry[] = [];

  // Goals → timeline entries.
  for (const goal of input.goals) {
    entries.push({
      id: `timeline-goal-${goal.id}`,
      projectId: input.projectId,
      source: 'goal',
      kind: 'goal_created',
      label: goal.description.slice(0, 80),
      timestamp: goal.createdAt,
      links: { goalId: goal.id },
      statusLabel: goal.status,
    });
  }

  // Plans → timeline entries (only when approved / executing / done).
  for (const plan of input.plans) {
    if (plan.status !== 'awaiting-approval') {
      const goal = input.goals.find(g => g.id === plan.goalId);
      entries.push({
        id: `timeline-plan-${plan.id}`,
        projectId: input.projectId,
        source: 'plan-step',
        kind: plan.status === 'approved' ? 'plan_approved' :
              plan.status === 'executing' ? 'plan_executing' : 'plan_done',
        label: goal ? goal.description.slice(0, 80) : `Plan ${plan.id.slice(0, 8)}`,
        timestamp: goal?.updatedAt ?? 0,
        links: { planId: plan.id, goalId: plan.goalId },
        statusLabel: plan.status,
      });
    }

    // Completed steps → timeline entries.
    for (const step of plan.steps) {
      if (step.status === 'done' || step.status === 'failed') {
        entries.push({
          id: `timeline-step-${step.id}`,
          projectId: input.projectId,
          source: 'plan-step',
          kind: step.status === 'done' ? 'step_completed' : 'step_failed',
          label: step.intent.slice(0, 80),
          timestamp: 0, // No per-step timestamp; fallback.
          links: { planId: plan.id, goalId: plan.goalId, stepId: step.id },
          statusLabel: step.status,
        });
      }
      if (step.status === 'blocked-needs-gate') {
        entries.push({
          id: `timeline-gate-${step.id}`,
          projectId: input.projectId,
          source: 'plan-step',
          kind: 'step_gated',
          label: `Gate: ${step.intent.slice(0, 60)}`,
          timestamp: 0,
          links: { planId: plan.id, goalId: plan.goalId, stepId: step.id },
          statusLabel: 'blocked-needs-gate',
        });
      }
    }
  }

  // Reviews → timeline entries.
  for (const review of input.reviews) {
    entries.push({
      id: `timeline-review-${review.id}`,
      projectId: input.projectId,
      source: 'review',
      kind: 'review_created',
      label: review.prompt.slice(0, 80),
      timestamp: review.createdAt,
      links: { reviewId: review.id },
      statusLabel: review.status,
    });
  }

  // Pending prompts → timeline entries.
  for (const prompt of input.pendingPrompts) {
    entries.push({
      id: `timeline-prompt-${prompt.packetId}`,
      projectId: input.projectId,
      source: 'prompt',
      kind: 'prompt_created',
      label: prompt.prompt.slice(0, 80),
      timestamp: prompt.createdAt,
      links: { promptId: prompt.packetId },
      statusLabel: prompt.status,
    });
  }

  // Audit events → timeline entries.
  for (const event of input.auditEvents) {
    entries.push({
      id: `timeline-audit-${event.id}`,
      projectId: input.projectId,
      source: 'audit',
      kind: event.type,
      label: `${event.source} → ${event.target}`,
      timestamp: event.timestamp,
      links: { auditEventId: event.id },
      statusLabel: event.ok === true ? 'ok' : event.ok === false ? 'failed' : undefined,
    });
  }

  // Sort by timestamp descending (newest first), capped.
  entries.sort((a, b) => b.timestamp - a.timestamp);

  return {
    projectId: input.projectId,
    entries: entries.slice(0, MAX_TIMELINE_ENTRIES),
  };
}

// ---- Audit view builder ----

export function buildProjectAuditView(
  input: ObservabilityInput,
  limit?: number,
  type?: string,
): ProjectAuditView {
  let filtered = input.auditEvents
    .filter(e => type === undefined || e.type === type)
    .map(e => ({
      id: e.id,
      type: e.type,
      source: e.source,
      target: e.target,
      timestamp: e.timestamp,
      ok: e.ok === undefined ? null : e.ok,
    } satisfies ProjectAuditEntry));

  filtered.sort((a, b) => b.timestamp - a.timestamp);

  const effectiveLimit = typeof limit === 'number' && limit > 0
    ? Math.min(limit, MAX_AUDIT_LIMIT)
    : MAX_AUDIT_LIMIT;

  return {
    projectId: input.projectId,
    total: input.auditEvents.length,
    returning: filtered.slice(0, effectiveLimit).length,
    entries: filtered.slice(0, effectiveLimit),
  };
}

// ---- Derived memory builder ----

export function buildDerivedMemory(
  input: ObservabilityInput,
): DerivedMemoryView {
  const entries: DerivedMemoryEntry[] = [];

  // Use the max record timestamp as the deterministic "derived at" time
  // so the function produces the same output for the same input.
  const derivedAt = Math.max(
    0,
    ...input.goals.map(g => Math.max(g.createdAt, g.updatedAt)),
    ...input.reviews.map(r => Math.max(r.createdAt, r.updatedAt)),
    ...input.pendingPrompts.map(p => p.createdAt),
    ...input.auditEvents.map(e => e.timestamp),
  );

  // Memory from project metadata.
  const activeGoals = input.goals.filter(
    g => g.status !== 'done' && g.status !== 'cancelled' && g.status !== 'failed',
  );
  if (activeGoals.length > 0) {
    entries.push({
      sourceKind: 'goal',
      sourceId: 'project-summary',
      timestamp: derivedAt,
      fact: `${activeGoals.length} active goal(s) in this project`,
    });
  }

  const doneGoals = input.goals.filter(g => g.status === 'done');
  if (doneGoals.length > 0) {
    entries.push({
      sourceKind: 'goal',
      sourceId: 'project-summary',
      timestamp: derivedAt,
      fact: `${doneGoals.length} completed goal(s)`,
    });
  }

  // Memory from completed plan steps.
  for (const plan of input.plans) {
    const doneSteps = plan.steps.filter(s => s.status === 'done');
    const gatedSteps = plan.steps.filter(s => s.status === 'blocked-needs-gate');
    if (doneSteps.length > 0) {
      entries.push({
        sourceKind: 'plan-step',
        sourceId: plan.id,
        timestamp: derivedAt,
        fact: `Plan ${plan.id.slice(0, 8)}: ${doneSteps.length}/${plan.steps.length} steps completed`,
      });
    }
    if (gatedSteps.length > 0) {
      entries.push({
        sourceKind: 'gate',
        sourceId: plan.id,
        timestamp: derivedAt,
        fact: `Plan ${plan.id.slice(0, 8)}: ${gatedSteps.length} step(s) waiting for gate approval`,
      });
    }
  }

  // Memory from reviews.
  if (input.reviews.length > 0) {
    const returned = input.reviews.filter(r => r.status === 'returned').length;
    entries.push({
      sourceKind: 'review',
      sourceId: 'project-summary',
      timestamp: derivedAt,
      fact: `${input.reviews.length} review(s) (${returned} returned)`,
    });
  }

  return {
    projectId: input.projectId,
    entries,
  };
}

// ---- Harness verification view builder ----

export function buildHarnessVerification(
  input: ObservabilityInput,
): HarnessVerificationView {
  // v2.1 baseline: no structured harness data.
  // Derive placeholder records from completed plan steps only.
  const records: HarnessVerificationRecord[] = [];

  for (const plan of input.plans) {
    for (const step of plan.steps) {
      if (step.status === 'done') {
        records.push({
          stepId: step.id,
          stepIndex: step.index,
          stepIntent: step.intent,
          stepStatus: step.status,
          harnessStatus: 'unavailable',
        });
      }
    }
  }

  return {
    projectId: input.projectId,
    records,
    status: 'unavailable',
  };
}
