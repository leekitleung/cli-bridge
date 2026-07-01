import { createHash, randomUUID } from 'node:crypto';
import type { ConversationRouteKind } from './conversation-pairing-store.ts';

export type ConversationActionStatus =
  | 'previewed'
  | 'confirmed'
  | 'dispatching'
  | 'queued'
  | 'returned'
  | 'failed'
  | 'cancelled';

export interface ConversationAction {
  id: string;
  projectId: string;
  sourceEndpointId: string;
  targetEndpointId: string;
  routeKind: ConversationRouteKind;
  userEventId: string;
  bridgeEventId: string;
  textHash: string;
  preview: string;
  status: ConversationActionStatus;
  linkedReviewId?: string;
  linkedWorkBuddyTaskId?: string;
  failureReason?: string;
  createdAt: number;
  updatedAt: number;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function hashText(text: string): string {
  return `sha256:${createHash('sha256').update(text).digest('hex')}`;
}

export class InMemoryConversationActionStore {
  private readonly actions = new Map<string, ConversationAction>();

  createPreview(input: Omit<ConversationAction, 'id' | 'textHash' | 'status' | 'createdAt' | 'updatedAt'> & { text: string; now?: number }): ConversationAction {
    const now = input.now ?? Date.now();
    const action: ConversationAction = {
      id: randomUUID(),
      projectId: input.projectId,
      sourceEndpointId: input.sourceEndpointId,
      targetEndpointId: input.targetEndpointId,
      routeKind: input.routeKind,
      userEventId: input.userEventId,
      bridgeEventId: input.bridgeEventId,
      textHash: hashText(input.text),
      preview: input.preview,
      linkedReviewId: input.linkedReviewId,
      linkedWorkBuddyTaskId: input.linkedWorkBuddyTaskId,
      status: 'previewed',
      createdAt: now,
      updatedAt: now,
    };
    this.actions.set(action.id, clone(action));
    return clone(action);
  }

  get(actionId: string): ConversationAction | undefined {
    const action = this.actions.get(actionId);
    return action ? clone(action) : undefined;
  }

  listByProject(projectId: string): ConversationAction[] {
    return Array.from(this.actions.values())
      .filter(action => action.projectId === projectId)
      .sort((a, b) => a.createdAt - b.createdAt)
      .map(clone);
  }

  confirm(actionId: string, now: number = Date.now()): ConversationAction | undefined {
    const action = this.actions.get(actionId);
    if (!action || action.status !== 'previewed') return undefined;
    action.status = 'confirmed';
    action.updatedAt = now;
    this.actions.set(action.id, clone(action));
    return clone(action);
  }

  markDispatching(actionId: string, now: number = Date.now()): ConversationAction | undefined {
    const action = this.actions.get(actionId);
    if (!action || action.status !== 'confirmed') return undefined;
    action.status = 'dispatching';
    action.updatedAt = now;
    this.actions.set(action.id, clone(action));
    return clone(action);
  }

  markQueued(actionId: string, linkedWorkBuddyTaskId: string, now: number = Date.now()): ConversationAction | undefined {
    const action = this.actions.get(actionId);
    if (!action || action.status !== 'dispatching') return undefined;
    action.status = 'queued';
    action.linkedWorkBuddyTaskId = linkedWorkBuddyTaskId;
    action.updatedAt = now;
    this.actions.set(action.id, clone(action));
    return clone(action);
  }

  fail(actionId: string, failureReason: string, now: number = Date.now()): ConversationAction | undefined {
    const action = this.actions.get(actionId);
    if (!action) return undefined;
    action.status = 'failed';
    action.failureReason = failureReason;
    action.updatedAt = now;
    this.actions.set(action.id, clone(action));
    return clone(action);
  }

  hydrateAction(action: ConversationAction): void {
    if (!action || typeof action.id !== 'string' || typeof action.projectId !== 'string') return;
    this.actions.set(action.id, clone(action));
  }

  exportActions(): ConversationAction[] {
    return Array.from(this.actions.values(), clone);
  }
}
