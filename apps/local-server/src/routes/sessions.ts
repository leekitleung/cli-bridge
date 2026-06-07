import type {
  CodexManagedPtyAdapter,
  CodexManagedPtyStatus,
} from '../adapters/CodexManagedPtyAdapter.ts';

export function startManagedCodexSession(adapter: CodexManagedPtyAdapter): CodexManagedPtyStatus {
  return adapter.start();
}

export function getManagedCodexSessionStatus(adapter: CodexManagedPtyAdapter): CodexManagedPtyStatus {
  return adapter.getStatus();
}

export function readManagedCodexRecentOutput(adapter: CodexManagedPtyAdapter): string {
  return adapter.readRecentOutput();
}
