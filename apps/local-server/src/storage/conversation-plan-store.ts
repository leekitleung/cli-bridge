export type ConversationPlanStatus =
  | 'proposed'
  | 'accepted'
  | 'rejected'
  | 'superseded'
  | 'dispatching'
  | 'dispatched'
  | 'returned'
  | 'failed';

export interface ConversationPlanProposal {
  id: string;
  projectId: string;
  sessionId: string;
  version: number;
  sourceEndpointId: string;
  plannerEndpointId: string;
  executorEndpointIds: string[];
  userEventId: string;
  title: string;
  body: string;
  steps: string[];
  constraints: string[];
  riskNotes: string[];
  status: ConversationPlanStatus;
  supersededById?: string;
  createdAt: number;
  updatedAt: number;
}

export interface PlanSnapshot {
  planId: string;
  version: number;
  title: string;
  body: string;
  steps: string[];
  constraints: string[];
  riskNotes: string[];
  executorEndpointIds: string[];
  frozenAt: number;
}

export type PlanCreateParams = Pick<
  ConversationPlanProposal,
  | 'projectId'
  | 'sessionId'
  | 'sourceEndpointId'
  | 'plannerEndpointId'
  | 'executorEndpointIds'
  | 'userEventId'
  | 'title'
  | 'body'
  | 'steps'
  | 'constraints'
  | 'riskNotes'
>;

function generateId(): string {
  return `plan-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class InMemoryPlanProposalStore {
  private readonly plans = new Map<string, ConversationPlanProposal>();

  create(params: PlanCreateParams & { now?: number }): ConversationPlanProposal {
    const now = params.now ?? Date.now();
    const plan: ConversationPlanProposal = {
      id: generateId(),
      projectId: params.projectId,
      sessionId: params.sessionId,
      version: 1,
      sourceEndpointId: params.sourceEndpointId,
      plannerEndpointId: params.plannerEndpointId,
      executorEndpointIds: [...params.executorEndpointIds],
      userEventId: params.userEventId,
      title: params.title,
      body: params.body,
      steps: [...params.steps],
      constraints: [...params.constraints],
      riskNotes: [...params.riskNotes],
      status: 'proposed',
      createdAt: now,
      updatedAt: now,
    };
    this.plans.set(plan.id, clone(plan));
    return clone(plan);
  }

  get(id: string): ConversationPlanProposal | undefined {
    const plan = this.plans.get(id);
    return plan ? clone(plan) : undefined;
  }

  listByProject(projectId: string): ConversationPlanProposal[] {
    return Array.from(this.plans.values())
      .filter(p => p.projectId === projectId)
      .sort((a, b) => a.createdAt - b.createdAt)
      .map(clone);
  }

  findByUserEventId(userEventId: string): ConversationPlanProposal | undefined {
    for (const plan of this.plans.values()) {
      if (plan.userEventId === userEventId) return clone(plan);
    }
    return undefined;
  }

  listBySession(sessionId: string): ConversationPlanProposal[] {
    return Array.from(this.plans.values())
      .filter(p => p.sessionId === sessionId)
      .sort((a, b) => a.version - b.version)
      .map(clone);
  }

  getLatestBySession(sessionId: string): ConversationPlanProposal | undefined {
    const plans = this.listBySession(sessionId);
    return plans.length > 0 ? plans[plans.length - 1] : undefined;
  }

  // ── Immutability: supersede creates a new revision ──

  supersede(
    id: string,
    update: Pick<PlanCreateParams, 'title' | 'body' | 'steps' | 'constraints' | 'riskNotes'>,
    now?: number,
  ): ConversationPlanProposal | undefined {
    const current = this.plans.get(id);
    if (!current) return undefined;
    // Only proposed or superseded plans can be superseded.
    if (!['proposed', 'superseded'].includes(current.status)) return undefined;

    const ts = now ?? Date.now();
    const newVersion = current.version + 1;
    const newPlan: ConversationPlanProposal = {
      id: generateId(),
      projectId: current.projectId,
      sessionId: current.sessionId,
      version: newVersion,
      sourceEndpointId: current.sourceEndpointId,
      plannerEndpointId: current.plannerEndpointId,
      executorEndpointIds: [...current.executorEndpointIds],
      userEventId: current.userEventId,
      title: update.title,
      body: update.body,
      steps: [...update.steps],
      constraints: [...update.constraints],
      riskNotes: [...update.riskNotes],
      status: 'proposed',
      createdAt: ts,
      updatedAt: ts,
    };

    current.status = 'superseded';
    current.supersededById = newPlan.id;
    current.updatedAt = ts;

    this.plans.set(current.id, clone(current));
    this.plans.set(newPlan.id, clone(newPlan));
    return clone(newPlan);
  }

  // ── Accept: validates immutability ──

  accept(id: string, now?: number): { ok: true; plan: ConversationPlanProposal } | { ok: false; reason: string } {
    const plan = this.plans.get(id);
    if (!plan) return { ok: false, reason: 'plan not found' };

    // Only proposed plans can be accepted — not superseded, not already accepted.
    // Superseded is caught here because it's not 'proposed'; the error message
    // includes the actual status for audit clarity.
    if (plan.status !== 'proposed') {
      return { ok: false, reason: `plan status is ${plan.status}, must be proposed` };
    }

    const ts = now ?? Date.now();
    plan.status = 'accepted';
    plan.updatedAt = ts;
    this.plans.set(id, clone(plan));
    return { ok: true, plan: clone(plan) };
  }

  reject(id: string, now?: number): ConversationPlanProposal | undefined {
    const plan = this.plans.get(id);
    if (!plan) return undefined;
    if (plan.status !== 'proposed') return undefined;
    const ts = now ?? Date.now();
    plan.status = 'rejected';
    plan.updatedAt = ts;
    this.plans.set(id, clone(plan));
    return clone(plan);
  }

  // ── Execution lifecycle ──

  markDispatching(id: string, now?: number): ConversationPlanProposal | undefined {
    const plan = this.plans.get(id);
    if (!plan) return undefined;
    if (plan.status !== 'accepted') return undefined;
    plan.status = 'dispatching';
    plan.updatedAt = now ?? Date.now();
    this.plans.set(id, clone(plan));
    return clone(plan);
  }

  markDispatched(id: string, now?: number): ConversationPlanProposal | undefined {
    const plan = this.plans.get(id);
    if (!plan) return undefined;
    if (plan.status !== 'dispatching') return undefined;
    plan.status = 'dispatched';
    plan.updatedAt = now ?? Date.now();
    this.plans.set(id, clone(plan));
    return clone(plan);
  }

  markReturned(id: string, now?: number): ConversationPlanProposal | undefined {
    const plan = this.plans.get(id);
    if (!plan) return undefined;
    if (!['dispatched', 'dispatching'].includes(plan.status)) return undefined;
    plan.status = 'returned';
    plan.updatedAt = now ?? Date.now();
    this.plans.set(id, clone(plan));
    return clone(plan);
  }

  markFailed(id: string, now?: number): ConversationPlanProposal | undefined {
    const plan = this.plans.get(id);
    if (!plan) return undefined;
    if (!['dispatched', 'dispatching'].includes(plan.status)) return undefined;
    plan.status = 'failed';
    plan.updatedAt = now ?? Date.now();
    this.plans.set(id, clone(plan));
    return clone(plan);
  }

  // ── Frozen snapshot for executor input (I1 invariant) ──

  getFrozenSnapshot(id: string): PlanSnapshot | undefined {
    const plan = this.plans.get(id);
    if (!plan) return undefined;
    return {
      planId: plan.id,
      version: plan.version,
      title: plan.title,
      body: plan.body,
      steps: [...plan.steps],
      constraints: [...plan.constraints],
      riskNotes: [...plan.riskNotes],
      executorEndpointIds: [...plan.executorEndpointIds],
      frozenAt: plan.status === 'accepted' || plan.status === 'dispatching'
        ? plan.updatedAt
        : Date.now(),
    };
  }

  // ── Persistence ──

  exportProposals(): ConversationPlanProposal[] {
    return Array.from(this.plans.values(), clone);
  }

  hydrateProposal(proposal: ConversationPlanProposal): void {
    if (
      !proposal ||
      typeof proposal.id !== 'string' ||
      typeof proposal.projectId !== 'string' ||
      typeof proposal.sessionId !== 'string' ||
      typeof proposal.version !== 'number' ||
      typeof proposal.sourceEndpointId !== 'string' ||
      typeof proposal.plannerEndpointId !== 'string' ||
      !Array.isArray(proposal.executorEndpointIds) ||
      typeof proposal.userEventId !== 'string' ||
      typeof proposal.title !== 'string' ||
      typeof proposal.body !== 'string' ||
      !Array.isArray(proposal.steps) ||
      !Array.isArray(proposal.constraints) ||
      !Array.isArray(proposal.riskNotes) ||
      typeof proposal.status !== 'string' ||
      ![
        'proposed', 'accepted', 'rejected', 'superseded',
        'dispatching', 'dispatched', 'returned', 'failed',
      ].includes(proposal.status) ||
      typeof proposal.createdAt !== 'number' ||
      typeof proposal.updatedAt !== 'number'
    ) {
      return;
    }
    this.plans.set(proposal.id, clone(proposal));
  }
}
