import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type {
  AuditEvent,
  BridgePacket,
  PendingPrompt,
} from '../../../../packages/shared/src/types.ts';

export const SNAPSHOT_VERSION = 1;
export const SNAPSHOT_FILENAME = 'bridge-snapshot.json';

export interface BridgeSnapshot {
  version: number;
  packets: BridgePacket[];
  auditEvents: AuditEvent[];
  pendingPrompts: PendingPrompt[];
}

export interface SnapshotWriteResult {
  ok: boolean;
  path?: string;
  error?: string;
}

export interface SnapshotReadResult {
  ok: boolean;
  snapshot?: BridgeSnapshot;
  error?: string;
}

function snapshotPath(dataDir: string): string {
  // The filename is a fixed constant, never derived from request input, so
  // there is no path-traversal surface. Only the configured directory varies.
  return resolve(dataDir, SNAPSHOT_FILENAME);
}

export class JsonSnapshotStore {
  private readonly dataDir: string;

  constructor(dataDir: string) {
    this.dataDir = dataDir;
  }

  get path(): string {
    return snapshotPath(this.dataDir);
  }

  // Best-effort write. Never throws; returns a structured result instead so a
  // disk failure cannot crash the server.
  write(snapshot: BridgeSnapshot): SnapshotWriteResult {
    try {
      mkdirSync(this.dataDir, { recursive: true });
      const path = snapshotPath(this.dataDir);
      writeFileSync(path, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
      return { ok: true, path };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'snapshot-write-failed',
      };
    }
  }

  // Best-effort read. A missing file or malformed JSON returns ok:false with no
  // snapshot; the caller stays in-memory.
  read(): SnapshotReadResult {
    let text: string;
    try {
      text = readFileSync(snapshotPath(this.dataDir), 'utf8');
    } catch {
      return { ok: false, error: 'snapshot-missing' };
    }

    try {
      const parsed = JSON.parse(text);
      if (typeof parsed !== 'object' || parsed === null) {
        return { ok: false, error: 'snapshot-not-object' };
      }
      const snapshot: BridgeSnapshot = {
        version: typeof parsed.version === 'number' ? parsed.version : 0,
        packets: Array.isArray(parsed.packets) ? parsed.packets : [],
        auditEvents: Array.isArray(parsed.auditEvents) ? parsed.auditEvents : [],
        pendingPrompts: Array.isArray(parsed.pendingPrompts) ? parsed.pendingPrompts : [],
      };
      return { ok: true, snapshot };
    } catch {
      return { ok: false, error: 'snapshot-malformed-json' };
    }
  }
}

export function buildSnapshot(
  packets: BridgePacket[],
  auditEvents: AuditEvent[],
  pendingPrompts: PendingPrompt[],
): BridgeSnapshot {
  return {
    version: SNAPSHOT_VERSION,
    packets,
    auditEvents,
    pendingPrompts,
  };
}
