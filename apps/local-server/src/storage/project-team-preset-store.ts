// EX-2: InMemoryProjectTeamPresetStore
//
// Stores ProjectTeamPreset instances. Independent of InMemoryTeamSpecStore
// (team-store.ts) — that store manages AgentTeam runtime specs; this store
// manages project-level default pairing declarations.
//
// Presets are persisted alongside project data in the JSON snapshot.
// Changing a preset does NOT retroactively affect existing goals — goals
// capture their own binding snapshots at creation time (EX-3).

import type { ProjectTeamPreset } from '../../../../packages/shared/src/types.ts';

function clone<T>(value: T): T {
  return structuredClone(value);
}

// ── Public validation ──

export interface PresetValidationResult {
  ok: boolean;
  errors: string[];
}

export function validateProjectTeamPreset(
  value: unknown,
  onlineEndpointIds: Set<string>,
): PresetValidationResult {
  const errors: string[] = [];
  if (!value || typeof value !== 'object') {
    return { ok: false, errors: ['preset must be an object'] };
  }
  const p = value as Record<string, unknown>;

  if (typeof p.projectId !== 'string' || p.projectId.trim().length === 0) {
    errors.push('projectId is required');
  }
  if (typeof p.plannerEndpointId !== 'string' || p.plannerEndpointId.trim().length === 0) {
    errors.push('plannerEndpointId is required');
  } else if (!onlineEndpointIds.has(p.plannerEndpointId)) {
    errors.push(`planner endpoint "${p.plannerEndpointId}" not found or offline`);
  }
  if (typeof p.executorEndpointId !== 'string' || p.executorEndpointId.trim().length === 0) {
    errors.push('executorEndpointId is required');
  } else if (!onlineEndpointIds.has(p.executorEndpointId)) {
    errors.push(`executor endpoint "${p.executorEndpointId}" not found or offline`);
  }
  if (p.verifierEndpointId !== undefined) {
    if (typeof p.verifierEndpointId !== 'string' || p.verifierEndpointId.trim().length === 0) {
      errors.push('verifierEndpointId must be a non-empty string when present');
    } else if (!onlineEndpointIds.has(p.verifierEndpointId)) {
      errors.push(`verifier endpoint "${p.verifierEndpointId}" not found or offline`);
    }
  }
  if (p.mode !== 'sequential') {
    errors.push('mode must be "sequential"');
  }
  if (p.isolation !== 'patch-only') {
    errors.push('isolation must be "patch-only"');
  }

  return { ok: errors.length === 0, errors };
}

// ── Store ──

export class InMemoryProjectTeamPresetStore {
  private readonly presets = new Map<string, ProjectTeamPreset>();

  /** Upsert (create or replace) the project team preset. */
  upsert(preset: ProjectTeamPreset): ProjectTeamPreset {
    const now = Date.now();
    const stored: ProjectTeamPreset = {
      projectId: preset.projectId,
      plannerEndpointId: preset.plannerEndpointId,
      executorEndpointId: preset.executorEndpointId,
      verifierEndpointId: preset.verifierEndpointId,
      mode: 'sequential',
      isolation: 'patch-only',
      updatedAt: now,
    };
    this.presets.set(preset.projectId, clone(stored));
    return clone(stored);
  }

  /** Get the preset for a project, or undefined. */
  get(projectId: string): ProjectTeamPreset | undefined {
    const p = this.presets.get(projectId);
    return p ? clone(p) : undefined;
  }

  /** Remove the preset for a project. Returns true if it existed. */
  delete(projectId: string): boolean {
    return this.presets.delete(projectId);
  }

  /** List all presets. */
  listAll(): ProjectTeamPreset[] {
    return Array.from(this.presets.values(), clone);
  }

  // ── Snapshot persistence ──

  exportPresets(): ProjectTeamPreset[] {
    return this.listAll();
  }

  hydratePreset(preset: ProjectTeamPreset): void {
    if (!preset.projectId || typeof preset.projectId !== 'string') return;
    if (!preset.plannerEndpointId || !preset.executorEndpointId) return;
    this.presets.set(preset.projectId, clone(preset));
  }
}
