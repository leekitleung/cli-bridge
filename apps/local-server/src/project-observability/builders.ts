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
  VerificationStatusSummary,
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
  teams?: Array<{
    id: string;
    projectId: string;
    planId: string;
    logicalSlots: Array<{
      id: string;
      stepIndex: number;
      status: string;
    }>;
  }>;
  artifacts?: Array<{
    teamId: string;
    slotId: string;
    planStepId: string;
    summary: string;
    verificationNotes?: string;
    createdAt: number;
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

  // Memory from verified artifact evidence.
  //
  // Only artifacts whose parent team is present in the (already project-scoped)
  // input are considered, and only when verificationNotes is a non-empty string
  // after trimming. This mirrors buildHarnessVerification's source rules. The
  // derived fact reports that verification evidence was recorded; it never
  // infers pass/fail from the free-text notes and never echoes the raw notes.
  const teams = input.teams ?? [];
  const artifacts = input.artifacts ?? [];
  const teamIds = new Set(teams.map(team => team.id));
  const verificationEntries: DerivedMemoryEntry[] = [];
  for (const artifact of artifacts) {
    const notes = artifact.verificationNotes?.trim();
    if (!notes) continue;
    if (!teamIds.has(artifact.teamId)) continue;
    verificationEntries.push({
      sourceKind: 'verification',
      sourceId: `${artifact.teamId}:${artifact.slotId}`,
      timestamp: artifact.createdAt,
      fact: `Verification evidence recorded for step ${artifact.planStepId.slice(0, 8)} (team ${artifact.teamId.slice(0, 8)})`,
    });
  }
  verificationEntries.sort((a, b) => {
    const timeDelta = b.timestamp - a.timestamp;
    if (timeDelta !== 0) return timeDelta;
    return a.sourceId.localeCompare(b.sourceId);
  });
  entries.push(...verificationEntries);

  return {
    projectId: input.projectId,
    entries,
  };
}

// ---- Harness verification view builder ----

export function buildVerificationStatusSummary(
  input: ObservabilityInput,
): VerificationStatusSummary {
  const teams = input.teams ?? [];
  const artifacts = input.artifacts ?? [];
  const teamIds = new Set(teams.map(team => team.id));
  let evidenceCount = 0;
  let lastRecordedAt: number | undefined;

  for (const artifact of artifacts) {
    const notes = artifact.verificationNotes?.trim();
    if (!notes) continue;
    if (!teamIds.has(artifact.teamId)) continue;
    evidenceCount += 1;
    if (lastRecordedAt === undefined || artifact.createdAt > lastRecordedAt) {
      lastRecordedAt = artifact.createdAt;
    }
  }

  let doneStepCount = 0;
  let totalStepCount = 0;
  for (const plan of input.plans) {
    for (const step of plan.steps) {
      totalStepCount += 1;
      if (step.status === 'done') doneStepCount += 1;
    }
  }

  return {
    evidenceCount,
    ...(lastRecordedAt === undefined ? {} : { lastRecordedAt }),
    doneStepCount,
    totalStepCount,
  };
}

export function buildHarnessVerification(
  input: ObservabilityInput,
): HarnessVerificationView {
  const teams = input.teams ?? [];
  const artifacts = input.artifacts ?? [];
  const teamsById = new Map(teams.map(team => [team.id, team]));
  const summary = buildVerificationStatusSummary(input);
  const planStepsById = new Map<string, {
    id: string;
    index: number;
    intent: string;
    status: string;
  }>();

  for (const plan of input.plans) {
    for (const step of plan.steps) {
      planStepsById.set(step.id, step);
    }
  }

  const artifactRecords: HarnessVerificationRecord[] = [];
  for (const artifact of artifacts) {
    const notes = artifact.verificationNotes?.trim();
    if (!notes) continue;
    const team = teamsById.get(artifact.teamId);
    if (!team) continue;
    const slot = team.logicalSlots.find(s => s.id === artifact.slotId);
    const planStep = planStepsById.get(artifact.planStepId);
    artifactRecords.push({
      stepId: artifact.planStepId,
      stepIndex: slot?.stepIndex,
      stepIntent: planStep?.intent ?? artifact.summary,
      stepStatus: slot?.status,
      harnessStatus: 'recorded',
      notes,
      teamId: artifact.teamId,
      slotId: artifact.slotId,
      createdAt: artifact.createdAt,
    });
  }

  artifactRecords.sort((a, b) => {
    const timeDelta = (b.createdAt ?? 0) - (a.createdAt ?? 0);
    if (timeDelta !== 0) return timeDelta;
    const aKey = `${a.teamId ?? ''}:${a.slotId ?? ''}:${a.stepId ?? ''}`;
    const bKey = `${b.teamId ?? ''}:${b.slotId ?? ''}:${b.stepId ?? ''}`;
    return aKey.localeCompare(bKey);
  });

  if (artifactRecords.length > 0) {
    return {
      projectId: input.projectId,
      records: artifactRecords,
      status: 'recorded',
      summary,
    };
  }

  // Preserve the v2.1 fallback when no structured verification notes exist.
  const records: HarnessVerificationRecord[] = [];
  for (const plan of input.plans) {
    for (const step of plan.steps) {
      if (step.status !== 'done') continue;
      records.push({
        stepId: step.id,
        stepIndex: step.index,
        stepIntent: step.intent,
        stepStatus: step.status,
        harnessStatus: 'unavailable',
      });
    }
  }

  return {
    projectId: input.projectId,
    records,
    status: 'unavailable',
    summary,
  };
}
