// v2.14 ADR-0019-b — Memory-only GitHub token store.
//
// Tokens are NEVER persisted to disk, snapshot files, audit records,
// or HTTP response payloads. Opt-in per project, operator/runtime-set only.
// Mirrors the InMemoryApiKeyStore pattern (v2.4a).

export class GithubTokenStore {
  private readonly tokens = new Map<string, string>(); // projectKey → token

  /** Set a GitHub token for a project. Overwrites existing token. */
  setToken(projectKey: string, token: string): void {
    if (!projectKey || !token) return;
    this.tokens.set(projectKey, token);
  }

  /** Check whether a token is available for a project. */
  hasToken(projectKey: string): boolean {
    return this.tokens.has(projectKey);
  }

  /** Get the token for a project, or undefined if not set. */
  getToken(projectKey: string): string | undefined {
    return this.tokens.get(projectKey);
  }

  /** Clear a project's token. */
  clearToken(projectKey: string): void {
    this.tokens.delete(projectKey);
  }

  // ═══════════════════════════════════════════════
  // Deliberately NOT exported for snapshot/persistence.
  // This store is intentionally excluded from any export.
  // ═══════════════════════════════════════════════
}
