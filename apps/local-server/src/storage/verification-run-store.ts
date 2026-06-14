// v2.13 ADR-0018: project-scoped store for sanitized live verification run records.
// No raw output, env, argv, command line, absolute cwd, path, or root.

import type { VerificationRunRecord } from '../../../../packages/shared/src/types.ts';

export class VerificationRunStore {
  private readonly byProject = new Map<string, VerificationRunRecord[]>();

  add(projectKey: string, record: VerificationRunRecord): void {
    const records = this.byProject.get(projectKey) ?? [];
    records.push(record);
    if (records.length > 50) records.shift(); // cap per project
    this.byProject.set(projectKey, records);
  }

  getForProject(projectKey: string): VerificationRunRecord[] {
    return [...(this.byProject.get(projectKey) ?? [])];
  }

  list(): VerificationRunRecord[] {
    const all: VerificationRunRecord[] = [];
    for (const records of this.byProject.values()) all.push(...records);
    return all;
  }
}
