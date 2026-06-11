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
  /** Optional project scope — set from the parent record's projectId. */
  projectId?: string;
  /** v2.3 AgentTeam metadata. */
  teamId?: string;
  slotId?: string;
  planStepId?: string;
  goalId?: string;
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
    projectId: input.projectId,
    teamId: input.teamId,
    slotId: input.slotId,
    planStepId: input.planStepId,
    goalId: input.goalId,
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

  // Serialization for persistence: returns validated event records.
  exportEvents(): AuditEvent[] {
    return this.listEvents();
  }

  // Hydrate events from a snapshot. Invalid records are skipped, not trusted.
  hydrateEvents(events: unknown[]): number {
    let restored = 0;
    for (const candidate of events) {
      try {
        assertAuditEvent(candidate);
        this.events.push(cloneAuditEvent(candidate as AuditEvent));
        restored += 1;
      } catch {
        // skip invalid record
      }
    }
    return restored;
  }
}
