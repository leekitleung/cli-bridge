// v2.3 AgentTeam — InMemoryTeamSpecStore
//
// Stores TeamSpec instances. All mutations are pure state transitions;
// no execution, no CLI spawn, no background dispatch.

import { validateSlotArtifact } from "../../../../packages/shared/src/schemas.ts";
import type {
  TeamSpec,
  AgentSlot,
  SlotArtifact,
} from '../../../../packages/shared/src/types.ts';

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class InMemoryTeamSpecStore {
  private readonly teams = new Map<string, TeamSpec>();
  private readonly artifacts = new Map<string, SlotArtifact[]>(); // keyed by teamId

  create(input: {
    id: string; projectId: string; goalId: string; planId: string;
    logicalSlots: Omit<AgentSlot, 'status'>[];
    maxConcurrentBridgeSlots: number;
    mode: 'sequential';
    isolation: 'patch-only';
    provider: string;
    endpointId: string;
    policyRequirements?: Array<{ kind: string; detail: string }>;
  }): TeamSpec | null {
    // Reject duplicate team id — create is strict.
    if (this.teams.has(input.id)) return null;

    const now = Date.now();
    const team: TeamSpec = {
      id: input.id,
      projectId: input.projectId,
      goalId: input.goalId,
      planId: input.planId,
      logicalSlots: input.logicalSlots.map(s => ({
        ...s, status: 'pending' as const, isolation: 'patch-only' as const,
      })),
      maxConcurrentBridgeSlots: input.maxConcurrentBridgeSlots,
      mode: input.mode,
      isolation: input.isolation,
      provider: input.provider,
      endpointId: input.endpointId,
      policyRequirements: input.policyRequirements ?? [],
      status: 'pending-approval',
      currentSlotIndex: 0,
      createdAt: now,
      updatedAt: now,
    };
    this.teams.set(team.id, clone(team));
    return clone(team);
  }

  get(id: string): TeamSpec | undefined {
    const t = this.teams.get(id);
    return t ? clone(t) : undefined;
  }

  listByProject(projectId: string): TeamSpec[] {
    return Array.from(this.teams.values())
      .filter(t => t.projectId === projectId)
      .map(clone);
  }

  listAll(): TeamSpec[] {
    return Array.from(this.teams.values(), clone);
  }

  approve(teamId: string): TeamSpec | null {
    const t = this.teams.get(teamId);
    if (!t || t.status !== 'pending-approval') return null;
    t.status = 'approved';
    t.updatedAt = Date.now();
    t.approvedAt = Date.now();
    this.teams.set(teamId, clone(t));
    return clone(t);
  }

  /**
   * Cancel a team. Store-layer only — transitions state without side effects.
   * Orchestrator must ensure active slots are terminated/cleaned up before calling.
   */
  cancel(teamId: string): TeamSpec | null {
    const t = this.teams.get(teamId);
    if (!t || (t.status !== 'pending-approval' && t.status !== 'approved' && t.status !== 'executing')) return null;
    t.status = 'cancelled';
    t.updatedAt = Date.now();
    this.teams.set(teamId, clone(t));
    return clone(t);
  }

  /** Advance a slot to its next state. Used by the sequential orchestrator. */
  advanceSlot(teamId: string, slotId: string, nextStatus: TeamSpec['logicalSlots'][number]['status']): TeamSpec | null {
    const t = this.teams.get(teamId);
    if (!t) return null;
    const slot = t.logicalSlots.find(s => s.id === slotId);
    if (!slot) return null;
    slot.status = nextStatus;
    t.updatedAt = Date.now();

    // Update currentSlotIndex if slot completed.
    // NOTE: stays at last index (not length) when all done — use team.status === 'done' to detect completion.
    if (nextStatus === 'done') {
      t.currentSlotIndex = Math.min(t.currentSlotIndex + 1, t.logicalSlots.length - 1);
    }

    // Team-level status transitions.
    if (nextStatus === 'failed') {
      t.status = 'failed';
    }
    if (nextStatus === 'cancelled') {
      t.status = 'cancelled';
    }
    if (t.logicalSlots.every(s => s.status === 'done')) {
      t.status = 'done';
    }

    this.teams.set(teamId, clone(t));
    return clone(t);
  }

  /** Mark a team as executing. */
  setExecuting(teamId: string): TeamSpec | null {
    const t = this.teams.get(teamId);
    if (!t || t.status !== 'approved') return null;
    t.status = 'executing';
    t.updatedAt = Date.now();
    this.teams.set(teamId, clone(t));
    return clone(t);
  }

  /** Record a slot's output artifact. */
  recordArtifact(teamId: string, artifact: SlotArtifact): SlotArtifact | null {
    // Validate schema and redaction boundary.
    const val = validateSlotArtifact(artifact as unknown as Record<string, unknown>);
    if (!val.ok) return null;
    // Require outputRedacted if rawProviderOutput is present.
    if (artifact.rawProviderOutput && !artifact.outputRedacted) return null;
    if (!this.artifacts.has(teamId)) this.artifacts.set(teamId, []);
    this.artifacts.get(teamId)!.push(clone(artifact));
    return clone(artifact);
  }

  /** Get all artifacts for a team. */
  listArtifacts(teamId: string): SlotArtifact[] {
    return clone(this.artifacts.get(teamId) ?? []);
  }

  // ---- Snapshot persistence support ----

  exportTeams(): TeamSpec[] {
    return this.listAll();
  }

  hydrateTeam(team: TeamSpec): void {
    if (!team.id || !team.projectId) return; // skip invalid
    this.teams.set(team.id, clone(team));
  }

  exportArtifacts(): SlotArtifact[] {
    const all: SlotArtifact[] = [];
    for (const list of this.artifacts.values()) all.push(...list);
    return clone(all);
  }

  hydrateArtifact(a: SlotArtifact): void {
    const val = validateSlotArtifact(a as unknown as Record<string, unknown>);
    if (!val.ok) return;
    if (a.rawProviderOutput && !a.outputRedacted) return;
    if (!this.artifacts.has(a.teamId)) this.artifacts.set(a.teamId, []);
    this.artifacts.get(a.teamId)!.push(clone(a));
  }
}
