import { randomBytes } from 'node:crypto';

export interface LocalAutoPairSessionStoreOptions {
  now?: () => number;
  sessionTtlMs?: number;
  claimTtlMs?: number;
}

export interface ConsoleSessionBootstrap {
  consoleSessionToken: string;
  extensionClaimNonce: string;
  expiresAt: number;
  claimExpiresAt: number;
}

interface SessionRecord extends ConsoleSessionBootstrap {
  extensionSessionToken?: string;
  revokedAt?: number;
  claimUsedAt?: number;
}

export interface LocalAutoPairDiagnostics {
  consoleSessionsCreated: number;
  extensionClaimsAttempted: number;
  extensionClaimsSucceeded: number;
  extensionClaimsRejected: number;
  activeConsoleSessions: number;
  activeExtensionSessions: number;
  lastConsoleSessionCreatedAt: number | null;
  lastExtensionClaimAttemptedAt: number | null;
  lastExtensionClaimSucceededAt: number | null;
  lastExtensionClaimRejectedAt: number | null;
  lastExtensionClaimRejectedReason: string | null;
}

function token(): string {
  return randomBytes(32).toString('hex');
}

export interface LocalAutoPairSessionStore {
  createConsoleSession(): ConsoleSessionBootstrap;
  verifyConsoleSession(consoleSessionToken: string): boolean;
  claimExtensionSession(extensionClaimNonce: string):
    | { ok: true; extensionSessionToken: string }
    | { ok: false; message: string };
  verifyExtensionSession(extensionSessionToken: string): boolean;
  revokeConsoleSession(consoleSessionToken: string): boolean;
  revokeExtensionSession(extensionSessionToken: string): boolean;
  getDiagnostics(): LocalAutoPairDiagnostics;
}

export function createLocalAutoPairSessionStore(
  options: LocalAutoPairSessionStoreOptions = {},
) {
  const now = options.now ?? (() => Date.now());
  const sessionTtlMs = options.sessionTtlMs ?? 8 * 60 * 60 * 1000;
  const claimTtlMs = options.claimTtlMs ?? 2 * 60 * 1000;
  const byConsole = new Map<string, SessionRecord>();
  const byClaim = new Map<string, SessionRecord>();
  const byExtension = new Map<string, SessionRecord>();
  const diagnostics: Omit<LocalAutoPairDiagnostics, 'activeConsoleSessions' | 'activeExtensionSessions'> = {
    consoleSessionsCreated: 0,
    extensionClaimsAttempted: 0,
    extensionClaimsSucceeded: 0,
    extensionClaimsRejected: 0,
    lastConsoleSessionCreatedAt: null,
    lastExtensionClaimAttemptedAt: null,
    lastExtensionClaimSucceededAt: null,
    lastExtensionClaimRejectedAt: null,
    lastExtensionClaimRejectedReason: null,
  };

  function active(record: SessionRecord | undefined): record is SessionRecord {
    return !!record && !record.revokedAt && record.expiresAt > now();
  }

  return {
    createConsoleSession(): ConsoleSessionBootstrap {
      const createdAt = now();
      const record: SessionRecord = {
        consoleSessionToken: token(),
        extensionClaimNonce: token(),
        expiresAt: createdAt + sessionTtlMs,
        claimExpiresAt: createdAt + claimTtlMs,
      };
      byConsole.set(record.consoleSessionToken, record);
      byClaim.set(record.extensionClaimNonce, record);
      diagnostics.consoleSessionsCreated++;
      diagnostics.lastConsoleSessionCreatedAt = createdAt;
      return {
        consoleSessionToken: record.consoleSessionToken,
        extensionClaimNonce: record.extensionClaimNonce,
        expiresAt: record.expiresAt,
        claimExpiresAt: record.claimExpiresAt,
      };
    },
    verifyConsoleSession(consoleSessionToken: string): boolean {
      return active(byConsole.get(consoleSessionToken));
    },
    claimExtensionSession(
      extensionClaimNonce: string,
    ):
      | { ok: true; extensionSessionToken: string }
      | { ok: false; message: string } {
      diagnostics.extensionClaimsAttempted++;
      diagnostics.lastExtensionClaimAttemptedAt = now();
      const record = byClaim.get(extensionClaimNonce);
      if (!active(record) || record.claimUsedAt || record.claimExpiresAt <= now()) {
        const message = 'extension claim nonce invalid or expired';
        diagnostics.extensionClaimsRejected++;
        diagnostics.lastExtensionClaimRejectedAt = now();
        diagnostics.lastExtensionClaimRejectedReason = message;
        return { ok: false, message };
      }
      record.claimUsedAt = now();
      record.extensionSessionToken = token();
      byExtension.set(record.extensionSessionToken, record);
      diagnostics.extensionClaimsSucceeded++;
      diagnostics.lastExtensionClaimSucceededAt = record.claimUsedAt;
      return { ok: true, extensionSessionToken: record.extensionSessionToken };
    },
    verifyExtensionSession(extensionSessionToken: string): boolean {
      return active(byExtension.get(extensionSessionToken));
    },
    revokeConsoleSession(consoleSessionToken: string): boolean {
      const record = byConsole.get(consoleSessionToken);
      if (!record) return false;
      record.revokedAt = now();
      return true;
    },
    revokeExtensionSession(extensionSessionToken: string): boolean {
      const record = byExtension.get(extensionSessionToken);
      if (!active(record)) return false;
      record.revokedAt = now();
      return true;
    },
    getDiagnostics(): LocalAutoPairDiagnostics {
      let activeConsoleSessions = 0;
      let activeExtensionSessions = 0;
      for (const record of byConsole.values()) {
        if (active(record)) activeConsoleSessions++;
      }
      for (const record of byExtension.values()) {
        if (active(record)) activeExtensionSessions++;
      }
      return {
        ...diagnostics,
        activeConsoleSessions,
        activeExtensionSessions,
      };
    },
  };
}
