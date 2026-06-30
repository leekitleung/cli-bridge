import type { ConversationRouteKind } from './conversation-pairing-store.ts';

export interface ConversationTranscriptEvent {
  id: string;
  projectId: string;
  pairingId: string;
  role: 'user' | 'bridge' | 'target';
  text: string;
  status: 'draft' | 'queued' | 'awaiting-manual-confirmation' | 'returned' | 'failed' | 'not-implemented';
  routeKind: ConversationRouteKind;
  createdAt: number;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class InMemoryConversationTranscriptStore {
  private readonly events = new Map<string, ConversationTranscriptEvent>();

  append(event: Omit<ConversationTranscriptEvent, 'id' | 'createdAt'> & { id?: string; createdAt?: number }): ConversationTranscriptEvent {
    const stored: ConversationTranscriptEvent = {
      ...event,
      id: event.id ?? `conv-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      createdAt: event.createdAt ?? Date.now(),
    };
    this.events.set(stored.id, clone(stored));
    return clone(stored);
  }

  listByProject(projectId: string): ConversationTranscriptEvent[] {
    return Array.from(this.events.values())
      .filter(e => e.projectId === projectId)
      .sort((a, b) => a.createdAt - b.createdAt)
      .map(clone);
  }

  exportEvents(): ConversationTranscriptEvent[] {
    return Array.from(this.events.values(), clone);
  }

  hydrateEvent(event: ConversationTranscriptEvent): void {
    if (!event || typeof event.id !== 'string' || typeof event.projectId !== 'string') return;
    this.events.set(event.id, clone(event));
  }
}
