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

function token(): string {
  return randomBytes(32).toString('hex');
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

  function active(record: SessionRecord | undefined): record is SessionRecord {
    return !!record && !record.revokedAt && record.expiresAt > now();
  }

  return {
    createConsoleSession(): ConsoleSessionBootstrap {
      const record: SessionRecord = {
        consoleSessionToken: token(),
        extensionClaimNonce: token(),
        expiresAt: now() + sessionTtlMs,
        claimExpiresAt: now() + claimTtlMs,
      };
      byConsole.set(record.consoleSessionToken, record);
      byClaim.set(record.extensionClaimNonce, record);
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
      const record = byClaim.get(extensionClaimNonce);
      if (!active(record) || record.claimUsedAt || record.claimExpiresAt <= now()) {
        return { ok: false, message: 'extension claim nonce invalid or expired' };
      }
      record.claimUsedAt = now();
      record.extensionSessionToken = token();
      byExtension.set(record.extensionSessionToken, record);
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
  };
}
