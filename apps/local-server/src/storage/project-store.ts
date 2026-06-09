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

  /** Create a project if it doesn't exist; update label/description if it does. */
  upsert(input: CreateProjectInput): Project {
    const key = resolveProjectKey(input.key);
    const existing = this.projects.get(key);
    const project: Project = {
      key,
      label: input.label ?? existing?.label ?? key,
      description: input.description ?? existing?.description,
      createdAt: input.now ?? existing?.createdAt ?? Date.now(),
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
