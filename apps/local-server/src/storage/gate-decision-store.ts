// Gate decision store — persists internal gate decisions for audit/debug (ADR-0031 Task 5).
import type { GateDecision } from '../conversation/gate-evaluator.ts';

export interface GateDecisionRecord {
  id: string;
  sessionId: string;
  projectId: string;
  decision: GateDecision;
  createdAt: number;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class InMemoryGateDecisionStore {
  private readonly records = new Map<string, GateDecisionRecord>();

  create(input: { sessionId: string; projectId: string; decision: GateDecision }): GateDecisionRecord {
    const record: GateDecisionRecord = {
      id: `gate-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      sessionId: input.sessionId,
      projectId: input.projectId,
      decision: clone(input.decision),
      createdAt: Date.now(),
    };
    this.records.set(record.id, clone(record));
    return clone(record);
  }

  listByProject(projectId: string): GateDecisionRecord[] {
    return Array.from(this.records.values())
      .filter(r => r.projectId === projectId)
      .sort((a, b) => a.createdAt - b.createdAt)
      .map(clone);
  }
}
