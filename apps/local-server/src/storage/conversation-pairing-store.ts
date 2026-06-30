export type ConversationRouteKind = 'web-relay' | 'managed-pty' | 'review-command' | 'workbuddy-execution' | 'unavailable';
export type ConversationPairingStatus = 'ready' | 'needs-manual-confirmation' | 'not-implemented';

export interface ConversationPairing {
  projectId: string;
  sourceEndpointId: string;
  targetEndpointId: string;
  targetRouteKind: ConversationRouteKind;
  scope: 'project';
  status: ConversationPairingStatus;
  updatedAt: number;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class InMemoryConversationPairingStore {
  private readonly pairings = new Map<string, ConversationPairing>();

  upsert(pairing: ConversationPairing): ConversationPairing {
    const stored = { ...pairing, scope: 'project' as const, updatedAt: Date.now() };
    this.pairings.set(stored.projectId, clone(stored));
    return clone(stored);
  }

  get(projectId: string): ConversationPairing | undefined {
    const pairing = this.pairings.get(projectId);
    return pairing ? clone(pairing) : undefined;
  }

  delete(projectId: string): boolean {
    return this.pairings.delete(projectId);
  }

  exportPairings(): ConversationPairing[] {
    return Array.from(this.pairings.values(), clone);
  }

  hydratePairing(pairing: ConversationPairing): void {
    if (!pairing || typeof pairing.projectId !== 'string') return;
    if (typeof pairing.sourceEndpointId !== 'string') return;
    if (typeof pairing.targetEndpointId !== 'string') return;
    this.pairings.set(pairing.projectId, clone(pairing));
  }
}
