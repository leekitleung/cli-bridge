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

  function isActive(record: SessionRecord | undefined): boolean {
    if (!record) return false;
    return !record.revokedAt && record.expiresAt > now();
  }

  // Cleanup interval for expired sessions (every 5 minutes)
  const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
  const cleanupInterval = setInterval(() => {
    let cleaned = 0;
    const cutoff = now() - sessionTtlMs;
    for (const [key, record] of byConsole.entries()) {
      if (record.expiresAt < cutoff && !isActive(record)) {
        byConsole.delete(key);
        byClaim.delete(record.extensionClaimNonce);
        cleaned++;
      }
    }
    for (const [key, record] of byExtension.entries()) {
      if (record.expiresAt < cutoff && !isActive(record)) {
        byExtension.delete(key);
        cleaned++;
      }
    }
    if (cleaned > 0) {
      console.log(`[LocalAutoPair] Cleaned up ${cleaned} expired sessions`);
    }
  }, CLEANUP_INTERVAL_MS);

  // Prevent interval from keeping process alive
  cleanupInterval.unref();

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
      return isActive(byConsole.get(consoleSessionToken));
    },
    claimExtensionSession(
      extensionClaimNonce: string,
    ):
      | { ok: true; extensionSessionToken: string }
      | { ok: false; message: string } {
      diagnostics.extensionClaimsAttempted++;
      diagnostics.lastExtensionClaimAttemptedAt = now();
      const record = byClaim.get(extensionClaimNonce);

      // SECURITY FIX: 使用固定时间检查避免时序攻击
      // 始终检查所有条件，而不是提前返回
      const hasRecord = record !== undefined;
      const isRecordActive = hasRecord && isActive(record);
      const claimNotUsed = !record?.claimUsedAt;
      const claimNotExpired = (record?.claimExpiresAt ?? 0) > now();
      const recordIsValid = hasRecord && isRecordActive && claimNotUsed && claimNotExpired;

      // 始终更新诊断统计（无论成功与否）
      if (!recordIsValid) {
        diagnostics.extensionClaimsRejected++;
        diagnostics.lastExtensionClaimRejectedAt = now();
        // 统一错误消息，不泄露具体失败原因
        diagnostics.lastExtensionClaimRejectedReason = 'extension claim nonce invalid or expired';
      }

      if (recordIsValid) {
        record.claimUsedAt = now();
        record.extensionSessionToken = token();
        byExtension.set(record.extensionSessionToken, record);
        diagnostics.extensionClaimsSucceeded++;
        diagnostics.lastExtensionClaimSucceededAt = record.claimUsedAt;
        return { ok: true, extensionSessionToken: record.extensionSessionToken };
      }

      return { ok: false, message: 'extension claim nonce invalid or expired' };
    },
    verifyExtensionSession(extensionSessionToken: string): boolean {
      const record = byExtension.get(extensionSessionToken);
      return isActive(record);
    },
    revokeConsoleSession(consoleSessionToken: string): boolean {
      const record = byConsole.get(consoleSessionToken);
      if (!record) return false;
      record.revokedAt = now();
      return true;
    },
    revokeExtensionSession(extensionSessionToken: string): boolean {
      const record = byExtension.get(extensionSessionToken);
      if (!record || !isActive(record)) return false;
      record.revokedAt = now();
      return true;
    },
    getDiagnostics(): LocalAutoPairDiagnostics {
      let activeConsoleSessions = 0;
      let activeExtensionSessions = 0;
      for (const record of byConsole.values()) {
        if (isActive(record)) activeConsoleSessions++;
      }
      for (const record of byExtension.values()) {
        if (isActive(record)) activeExtensionSessions++;
      }
      return {
        ...diagnostics,
        activeConsoleSessions,
        activeExtensionSessions,
      };
    },
  };
}
