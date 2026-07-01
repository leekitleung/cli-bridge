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
  kind: 'user_message' | 'instruction' | 'executor_output' | 'status';
  visibility: 'user' | 'internal';
}

function deriveKind(role: string): ConversationTranscriptEvent['kind'] {
  switch (role) {
    case 'user': return 'user_message';
    case 'target': return 'executor_output';
    case 'bridge': return 'status';
    default: return 'status';
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class InMemoryConversationTranscriptStore {
  private readonly events = new Map<string, ConversationTranscriptEvent>();

  append(event: Omit<ConversationTranscriptEvent, 'id' | 'createdAt' | 'kind' | 'visibility'> & { id?: string; createdAt?: number; kind?: ConversationTranscriptEvent['kind']; visibility?: ConversationTranscriptEvent['visibility'] }): ConversationTranscriptEvent {
    const resolvedKind = event.kind ?? deriveKind(event.role);
    const resolvedVisibility = event.visibility ?? (resolvedKind === 'instruction' ? 'internal' : 'user');
    const stored: ConversationTranscriptEvent = {
      ...event,
      kind: resolvedKind,
      visibility: resolvedVisibility,
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

  get(id: string): ConversationTranscriptEvent | undefined {
    const event = this.events.get(id);
    return event ? clone(event) : undefined;
  }

  exportEvents(): ConversationTranscriptEvent[] {
    return Array.from(this.events.values(), clone);
  }

  hydrateEvent(event: ConversationTranscriptEvent): void {
    if (!event || typeof event.id !== 'string' || typeof event.projectId !== 'string') return;
    const resolvedKind = event.kind ?? deriveKind(event.role);
    const resolvedVisibility = event.visibility ?? 'user';
    this.events.set(event.id, clone({ ...event, kind: resolvedKind, visibility: resolvedVisibility }));
  }
}
