// v2.4a — In-memory API key store.
//
// Keys are NEVER persisted to disk, snapshot files, audit records,
// or HTTP response payloads. Opt-in per project.

export class InMemoryApiKeyStore {
  private readonly keys = new Map<string, string>(); // projectKey → key

  /** Set an API key for a project. Overwrites existing key. */
  setKey(projectKey: string, key: string): void {
    if (!projectKey || !key) return;
    this.keys.set(projectKey, key);
  }

  /** Check whether a key is available for a project. */
  hasKey(projectKey: string): boolean {
    return this.keys.has(projectKey);
  }

  /** Get the key for a project, or undefined if not set. */
  getKey(projectKey: string): string | undefined {
    return this.keys.get(projectKey);
  }

  /** Clear a project's key. */
  clearKey(projectKey: string): void {
    this.keys.delete(projectKey);
  }

  // ═══════════════════════════════════════════════
  // Deliberately NOT exporting for snapshot/persistence.
  // This store is intentionally excluded from exportKeys/export.
  // ═══════════════════════════════════════════════
}
