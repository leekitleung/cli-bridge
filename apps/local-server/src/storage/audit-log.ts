import { randomUUID } from 'node:crypto';

import {
  assertAuditEvent,
} from '../../../../packages/shared/src/schemas.ts';
import type {
  AuditEvent,
  AuditEventType,
} from '../../../../packages/shared/src/types.ts';

export interface CreateAuditEventInput {
  id?: string;
  sessionId: string;
  packetId?: string;
  approvalId?: string;
  type: AuditEventType;
  source: string;
  target: string;
  snapshot?: AuditEvent['snapshot'];
  safety?: AuditEvent['safety'];
  result: AuditEvent['result'];
  timestamp?: number;
}

function cloneAuditEvent(event: AuditEvent): AuditEvent {
  return structuredClone(event);
}

export function createAuditEvent(input: CreateAuditEventInput): AuditEvent {
  const event: AuditEvent = {
    id: input.id ?? randomUUID(),
    sessionId: input.sessionId,
    packetId: input.packetId,
    approvalId: input.approvalId,
    type: input.type,
    source: input.source,
    target: input.target,
    snapshot: input.snapshot ?? {},
    safety: input.safety ?? {},
    result: input.result,
    timestamp: input.timestamp ?? Date.now(),
  };

  assertAuditEvent(event);
  return event;
}

export class InMemoryAuditLog {
  private readonly events: AuditEvent[] = [];

  append(event: AuditEvent): AuditEvent {
    assertAuditEvent(event);
    const storedEvent = cloneAuditEvent(event);
    this.events.push(storedEvent);
    return cloneAuditEvent(storedEvent);
  }

  createAndAppend(input: CreateAuditEventInput): AuditEvent {
    return this.append(createAuditEvent(input));
  }

  listEvents(): AuditEvent[] {
    return this.events.map(cloneAuditEvent);
  }

  listEventsForPacket(packetId: string): AuditEvent[] {
    return this.events
      .filter((event) => event.packetId === packetId)
      .map(cloneAuditEvent);
  }
}
