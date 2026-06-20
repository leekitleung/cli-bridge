import { assertReasoningArtifact } from '../../../../packages/shared/src/schemas.ts';
import type { ReasoningArtifact } from '../../../../packages/shared/src/types.ts';

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class InMemoryReasoningArtifactStore {
  private readonly artifacts = new Map<string, ReasoningArtifact>();

  record(artifact: ReasoningArtifact): ReasoningArtifact {
    assertReasoningArtifact(artifact);
    this.artifacts.set(artifact.artifactId, clone(artifact));
    return clone(artifact);
  }

  list(query: { goalId?: string; planId?: string } = {}): ReasoningArtifact[] {
    return Array.from(this.artifacts.values())
      .filter((artifact) => query.goalId === undefined || artifact.goalId === query.goalId)
      .filter((artifact) => query.planId === undefined || artifact.planId === query.planId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .map(clone);
  }
}
