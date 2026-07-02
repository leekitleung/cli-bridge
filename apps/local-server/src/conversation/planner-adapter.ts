// Planner adapter interface and registry (ADR-0031 Task 3).
//
// Planners produce structured PlannerOutputEnvelope records.
// The registry holds configured planners; the default runtime has NONE.
// Mock planner is test-only and must not be registered by default.

import type { PlannerOutputEnvelope } from './planner-output-envelope.ts';

export interface PlannerRequest {
  sessionId: string;
  projectId: string;
  userText: string;
  history: Array<{ role: 'user' | 'planner' | 'executor'; text: string }>;
}

export interface PlannerAdapter {
  id: string;
  mode: 'interactive' | 'automatic' | 'test-only';
  plan(input: PlannerRequest): Promise<PlannerOutputEnvelope>;
}

export class PlannerAdapterRegistry {
  private readonly adapters = new Map<string, PlannerAdapter>();

  register(adapter: PlannerAdapter): void {
    this.adapters.set(adapter.id, adapter);
  }

  get(id: string): PlannerAdapter | undefined {
    return this.adapters.get(id);
  }

  has(id: string): boolean {
    return this.adapters.has(id);
  }

  /** Returns first registered planner, or undefined if none. */
  defaultPlanner(): PlannerAdapter | undefined {
    for (const adapter of this.adapters.values()) {
      return adapter;
    }
    return undefined;
  }
}
