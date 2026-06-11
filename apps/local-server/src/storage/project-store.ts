// Phase B: In-memory project store.
//
// Projects are a lightweight scoping layer. Every record (Goal,
// AgentReviewRequest, PendingPrompt) may carry an optional projectId.
// Records without a projectId are treated as belonging to the default
// project ("cli-bridge").
//
// The store is append-only for now: projects are created implicitly on
// first reference, and the store tracks the set of known project keys.
// No delete or rename is exposed — these are future slices.

import { randomUUID } from 'node:crypto';

import {
  assertProject,
} from '../../../../packages/shared/src/schemas.ts';
import type {
  Project,
  ProjectSummary,
} from '../../../../packages/shared/src/types.ts';
import {
  DEFAULT_PROJECT_KEY,
} from '../../../../packages/shared/src/types.ts';

// ---- Public types ----

export interface CreateProjectInput {
  key?: string;
  label?: string;
  description?: string;
  now?: number;
}

export interface BuildSummaryInput {
  /** All known goals (used to compute goal counts per project). */
  goals?: { projectId?: string; status?: string }[];
  /** All known reviews. */
  reviews?: { projectId?: string }[];
  /** All known pending prompts. */
  prompts?: { projectId?: string }[];
}

// ---- Helpers ----

function clone<T>(value: T): T {
  return structuredClone(value);
}

/** Maximum allowed length for a project key. */
const MAX_PROJECT_KEY_LENGTH = 64;

/** Characters allowed in a project key: lowercase alphanumeric, hyphen, underscore. */
const VALID_PROJECT_KEY_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/**
 * Validates and normalises an explicit project key value.
 * Returns the normalised key, or null if the value fails validation.
 *
 * Rules:
 *   - null / undefined / empty → null (caller should use default)
 *   - Must be 1-64 characters
 *   - Must start with a-z0-9
 *   - Only a-z, 0-9, hyphen, underscore
 *   - No slashes, spaces, or control characters
 */
export function validateProjectKey(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_PROJECT_KEY_LENGTH) {
    return null;
  }
  if (!VALID_PROJECT_KEY_RE.test(trimmed)) {
    return null;
  }
  return trimmed;
}

/**
 * Parse a projectId from a request body field. Returns:
 *   - the validated key if valid and non-empty
 *   - undefined if the field is absent, null, or empty (caller uses default)
 *   - null if the value is present but invalid (caller should reject)
 */
export function parseProjectIdField(raw: unknown): string | null | undefined {
  if (raw === null || raw === undefined) {
    return undefined;
  }
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return undefined;
  }
  return validateProjectKey(raw);
}

/** Resolves the effective project key: explicit value, or default. */
export function resolveProjectKey(explicit: string | undefined): string {
  if (typeof explicit === 'string' && explicit.trim().length > 0) {
    return explicit.trim();
  }
  return DEFAULT_PROJECT_KEY;
}

// ---- Store ----

export class InMemoryProjectStore {
  private readonly projects = new Map<string, Project>();

  /** Ensure the default "cli-bridge" project always exists. */
  constructor() {
    this.upsert({
      key: DEFAULT_PROJECT_KEY,
      label: 'CLI Bridge',
      description: 'Default project — records without explicit scope belong here',
    });
  }

  /** Create a project if it doesn't exist; update label/description if it does.
   *  Preserves existing archivedAt so PATCH metadata does not unarchive. */
  upsert(input: CreateProjectInput): Project {
    const key = resolveProjectKey(input.key);
    const existing = this.projects.get(key);
    const project: Project = {
      key,
      label: input.label ?? existing?.label ?? key,
      description: input.description ?? existing?.description,
      createdAt: input.now ?? existing?.createdAt ?? Date.now(),
      ...(existing?.archivedAt !== undefined ? { archivedAt: existing.archivedAt } : {}),
    };
    assertProject(project);
    this.projects.set(key, clone(project));
    return clone(project);
  }

  get(key: string): Project | undefined {
    const project = this.projects.get(key);
    return project ? clone(project) : undefined;
  }

  list(): Project[] {
    return Array.from(this.projects.values(), clone);
  }

  /** List non-archived projects only. */
  listActive(): Project[] {
    return this.list().filter((p) => !p.archivedAt);
  }

  archive(key: string): Project | undefined {
    const project = this.projects.get(key);
    if (!project || project.archivedAt) return undefined;
    const updated = clone(project);
    updated.archivedAt = Date.now();
    this.projects.set(key, updated);
    return clone(updated);
  }

  unarchive(key: string): Project | undefined {
    const project = this.projects.get(key);
    if (!project || !project.archivedAt) return undefined;
    const updated = clone(project);
    delete updated.archivedAt;
    this.projects.set(key, updated);
    return clone(updated);
  }

  /** Export explicit projects for snapshot persistence. */
  exportProjects(): Project[] {
    return this.list();
  }

  /** Hydrate a project from snapshot data. Invalid projects are silently skipped. */
  hydrateProject(project: Project): boolean {
    try {
      assertProject(project);
      this.projects.set(project.key, clone(project));
      return true;
    } catch {
      return false;
    }
  }

  /** Build a ProjectSummary for a single project key. */
  buildSummary(key: string, input: BuildSummaryInput): ProjectSummary | undefined {
    const project = this.projects.get(key);
    if (!project) {
      return undefined;
    }
    return buildProjectSummary(project, key, input);
  }

  /** Build ProjectSummary for all known projects. */
  buildAllSummaries(input: BuildSummaryInput): ProjectSummary[] {
    const keys = new Set(this.projects.keys());
    // Also collect keys from records that may not have an explicit project.
    for (const record of [...(input.goals ?? []), ...(input.reviews ?? []), ...(input.prompts ?? [])]) {
      keys.add(resolveProjectKey(record.projectId));
    }
    const summaries: ProjectSummary[] = [];
    for (const key of keys) {
      const project = this.projects.get(key);
      const summary = buildProjectSummary(
        project ?? { key, label: key, createdAt: 0 },
        key,
        input,
      );
      summaries.push(summary);
    }
    return summaries.sort((a, b) => a.project.key.localeCompare(b.project.key));
  }
}

function buildProjectSummary(
  project: Project,
  key: string,
  input: BuildSummaryInput,
): ProjectSummary {
  const goals = (input.goals ?? []).filter(
    (g) => resolveProjectKey(g.projectId) === key,
  );
  const reviews = (input.reviews ?? []).filter(
    (r) => resolveProjectKey(r.projectId) === key,
  );
  const prompts = (input.prompts ?? []).filter(
    (p) => resolveProjectKey(p.projectId) === key,
  );

  const activeGoals = goals.filter(
    (g) => g.status !== 'done' && g.status !== 'cancelled' && g.status !== 'failed',
  );

  const status: ProjectSummary['status'] =
    activeGoals.length > 0 ? 'active' :
    goals.length > 0 ? 'idle' :
    'unknown';

  return {
    project: clone(project),
    goalCount: goals.length,
    activeGoalCount: activeGoals.length,
    reviewCount: reviews.length,
    promptCount: prompts.length,
    status,
  };
}
