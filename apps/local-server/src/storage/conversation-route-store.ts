export interface ConversationTaskRoute {
  id: string;
  projectId: string;
  pairingId: string;
  mode: 'single';
  instructionPacketId: string;
  actionId: string;
  taskId?: string;
  status: 'pending' | 'dispatched' | 'completed' | 'failed';
  createdAt: number;
  updatedAt: number;
}

export type ConversationRouteCreateParams = Pick<
  ConversationTaskRoute,
  'projectId' | 'pairingId' | 'mode' | 'instructionPacketId' | 'actionId'
>;

function generateId(): string {
  return `route-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class InMemoryConversationRouteStore {
  private readonly routes = new Map<string, ConversationTaskRoute>();
  private readonly actionIndex = new Map<string, string>();

  create(params: ConversationRouteCreateParams): ConversationTaskRoute {
    const existingId = this.actionIndex.get(params.actionId);
    if (existingId) {
      const existing = this.routes.get(existingId);
      if (existing) return clone(existing);
    }

    const now = Date.now();
    const route: ConversationTaskRoute = {
      id: generateId(),
      projectId: params.projectId,
      pairingId: params.pairingId,
      mode: params.mode,
      instructionPacketId: params.instructionPacketId,
      actionId: params.actionId,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    };
    this.routes.set(route.id, clone(route));
    this.actionIndex.set(route.actionId, route.id);
    return clone(route);
  }

  get(id: string): ConversationTaskRoute | undefined {
    const route = this.routes.get(id);
    return route ? clone(route) : undefined;
  }

  findByInstructionId(instructionPacketId: string): ConversationTaskRoute | undefined {
    for (const route of this.routes.values()) {
      if (route.instructionPacketId === instructionPacketId) return clone(route);
    }
    return undefined;
  }

  findByActionId(actionId: string): ConversationTaskRoute | undefined {
    const id = this.actionIndex.get(actionId);
    if (!id) return undefined;
    const route = this.routes.get(id);
    return route ? clone(route) : undefined;
  }

  listByProject(projectId: string): ConversationTaskRoute[] {
    return Array.from(this.routes.values())
      .filter(r => r.projectId === projectId)
      .sort((a, b) => a.createdAt - b.createdAt)
      .map(clone);
  }

  markDispatched(id: string, taskId: string): ConversationTaskRoute | undefined {
    const route = this.routes.get(id);
    if (!route) return undefined;
    route.status = 'dispatched';
    route.taskId = taskId;
    route.updatedAt = Date.now();
    this.routes.set(id, clone(route));
    return clone(route);
  }

  markCompleted(id: string): ConversationTaskRoute | undefined {
    const route = this.routes.get(id);
    if (!route) return undefined;
    route.status = 'completed';
    route.updatedAt = Date.now();
    this.routes.set(id, clone(route));
    return clone(route);
  }

  markFailed(id: string): ConversationTaskRoute | undefined {
    const route = this.routes.get(id);
    if (!route) return undefined;
    route.status = 'failed';
    route.updatedAt = Date.now();
    this.routes.set(id, clone(route));
    return clone(route);
  }

  exportRoutes(): ConversationTaskRoute[] {
    return Array.from(this.routes.values(), clone);
  }

  hydrateRoute(route: ConversationTaskRoute): void {
    if (
      !route ||
      typeof route.id !== 'string' ||
      typeof route.projectId !== 'string' ||
      typeof route.pairingId !== 'string' ||
      route.mode !== 'single' ||
      typeof route.instructionPacketId !== 'string' ||
      typeof route.actionId !== 'string' ||
      typeof route.status !== 'string' ||
      !['pending', 'dispatched', 'completed', 'failed'].includes(route.status) ||
      typeof route.createdAt !== 'number' ||
      typeof route.updatedAt !== 'number'
    ) {
      return;
    }
    this.routes.set(route.id, clone(route));
    this.actionIndex.set(route.actionId, route.id);
  }
}
