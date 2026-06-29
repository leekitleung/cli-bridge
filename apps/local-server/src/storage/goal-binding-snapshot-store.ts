// EX-3: InMemoryGoalBindingSnapshotStore
//
// Stores GoalBindingSnapshot instances — versioned binding records copied from
// the project team preset at goal creation. Rebind creates a new version
// (audited replacement); the store enforces:
//   - rebind only when no plan is locked (checked by route handler)
//   - versioned snapshots with parent lineage
//   - snapshot persistence via exportSnapshots/hydrateSnapshot

import { randomUUID } from 'node:crypto';
import type { GoalBindingSnapshot } from '../../../../packages/shared/src/types.ts';

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class InMemoryGoalBindingSnapshotStore {
  /** snapshots keyed by goalId → latest version */
  private readonly snapshots = new Map<string, GoalBindingSnapshot[]>();

  /**
   * Create the initial snapshot from a project preset. Source is
   * 'project-preset'. Call this immediately after goal creation when a
   * preset exists.
   */
  createFromPreset(input: {
    goalId: string;
    plannerEndpointId: string;
    executorEndpointId: string;
    verifierEndpointId?: string;
  }): GoalBindingSnapshot {
    const now = Date.now();
    const snapshot: GoalBindingSnapshot = {
      snapshotId: randomUUID(),
      goalId: input.goalId,
      version: 1,
      plannerEndpointId: input.plannerEndpointId,
      executorEndpointId: input.executorEndpointId,
      verifierEndpointId: input.verifierEndpointId,
      mode: 'sequential',
      isolation: 'patch-only',
      source: 'project-preset',
      createdAt: now,
    };
    this.snapshots.set(input.goalId, [clone(snapshot)]);
    return clone(snapshot);
  }

  /**
   * Create a manual snapshot when no preset exists.
   */
  createManual(input: {
    goalId: string;
    plannerEndpointId: string;
    executorEndpointId: string;
    verifierEndpointId?: string;
  }): GoalBindingSnapshot {
    const now = Date.now();
    const snapshot: GoalBindingSnapshot = {
      snapshotId: randomUUID(),
      goalId: input.goalId,
      version: 1,
      plannerEndpointId: input.plannerEndpointId,
      executorEndpointId: input.executorEndpointId,
      verifierEndpointId: input.verifierEndpointId,
      mode: 'sequential',
      isolation: 'patch-only',
      source: 'manual',
      createdAt: now,
    };
    this.snapshots.set(input.goalId, [clone(snapshot)]);
    return clone(snapshot);
  }

  /**
   * Rebind — create a new versioned snapshot. Only allowed before plan
   * approval (lock state checked by route handler, not store).
   */
  rebind(goalId: string, updates: {
    plannerEndpointId?: string;
    executorEndpointId?: string;
    verifierEndpointId?: string;
  }): GoalBindingSnapshot | null {
    const versions = this.snapshots.get(goalId);
    if (!versions || versions.length === 0) return null;

    const latest = versions[versions.length - 1];
    const now = Date.now();
    const snapshot: GoalBindingSnapshot = {
      snapshotId: randomUUID(),
      goalId,
      version: latest.version + 1,
      plannerEndpointId: updates.plannerEndpointId ?? latest.plannerEndpointId,
      executorEndpointId: updates.executorEndpointId ?? latest.executorEndpointId,
      verifierEndpointId: updates.verifierEndpointId !== undefined
        ? updates.verifierEndpointId : latest.verifierEndpointId,
      mode: 'sequential',
      isolation: 'patch-only',
      source: 'manual-rebind',
      parentSnapshotId: latest.snapshotId,
      createdAt: now,
    };
    versions.push(clone(snapshot));
    return clone(snapshot);
  }

  /** Get the latest snapshot for a goal, or undefined. */
  getLatest(goalId: string): GoalBindingSnapshot | undefined {
    const versions = this.snapshots.get(goalId);
    if (!versions || versions.length === 0) return undefined;
    return clone(versions[versions.length - 1]);
  }

  /** Get all version history for a goal. */
  getHistory(goalId: string): GoalBindingSnapshot[] {
    return clone(this.snapshots.get(goalId) ?? []);
  }

  /** Check if a goal has any snapshot. */
  hasSnapshot(goalId: string): boolean {
    const versions = this.snapshots.get(goalId);
    return (versions?.length ?? 0) > 0;
  }

  // ── Snapshot persistence ──

  exportSnapshots(): GoalBindingSnapshot[] {
    const all: GoalBindingSnapshot[] = [];
    for (const versions of this.snapshots.values()) all.push(...versions);
    return clone(all);
  }

  hydrateSnapshot(snapshot: GoalBindingSnapshot): void {
    if (!snapshot.goalId || !snapshot.snapshotId) return;
    if (!snapshot.plannerEndpointId || !snapshot.executorEndpointId) return;
    if (!this.snapshots.has(snapshot.goalId)) this.snapshots.set(snapshot.goalId, []);
    this.snapshots.get(snapshot.goalId)!.push(clone(snapshot));
  }
}
