import {
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { resolve } from 'node:path';

import type {
  AgentSlot,
  SlotArtifact,
  TeamSpec,
  WorkBuddyExecutionLedgerEvent,
  WorkBuddyProjectSnapshot,
  WorkBuddyPromptDraftSink,
  WorkBuddyReviewResultSink,
  WorkBuddyTaskReference,
  AuditEvent,
  BridgePacket,
  Goal,
  OutboundPrompt,
  PendingPrompt,
  Plan,
  Project,
  InboundMessage,
  RelayContext,
} from '../../../../packages/shared/src/types.ts';
import {
  assertAuditEvent,
  assertBridgePacket,
  assertGoal,
  assertInboundMessage,
  assertOutboundPrompt,
  assertPlan,
  assertProject,
} from '../../../../packages/shared/src/schemas.ts';

export const SNAPSHOT_VERSION = 3;
export const SNAPSHOT_FILENAME = 'bridge-snapshot.json';
export const SNAPSHOT_BACKUP_FILENAME = 'bridge-snapshot.json.bak';
export const SNAPSHOT_TEMP_FILENAME = 'bridge-snapshot.json.tmp';

export interface BridgeSnapshot {
  version: number;
  packets: BridgePacket[];
  auditEvents: AuditEvent[];
  pendingPrompts: PendingPrompt[];
  outboundPrompts: OutboundPrompt[];
  /** v3: durable reviewed replies and their idempotency keys. */
  inboundMessages: InboundMessage[];
  /** v3: delivered session-to-endpoint routing contexts. */
  relayContexts: RelayContext[];
  /** v2: persisted goal state. */
  goals: Goal[];
  /** v2: persisted plan state. */
  plans: Plan[];
  /** v2: persisted project registry (explicitly registered projects only). */
  projects: Project[];
  workbuddyTaskReferences: WorkBuddyTaskReference[];
  workbuddyReviewResultSinks: WorkBuddyReviewResultSink[];
  workbuddyPromptDraftSinks: WorkBuddyPromptDraftSink[];
  workbuddyExecutionLedgerEvents: WorkBuddyExecutionLedgerEvent[];
  teams: TeamSpec[];
  teamArtifacts: SlotArtifact[];
  verificationRunRecords?: import('../../../../packages/shared/src/types.ts').VerificationRunRecord[];
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
  recoveredFromBackup?: boolean;
}

function snapshotPath(dataDir: string): string {
  return resolve(dataDir, SNAPSHOT_FILENAME);
}

function parseSnapshot(text: string): SnapshotReadResult {
  let parsed: Record<string, unknown>;
  try {
    const value = JSON.parse(text);
    if (typeof value !== 'object' || value === null) {
      return { ok: false, error: 'snapshot-not-object' };
    }
    parsed = value as Record<string, unknown>;
  } catch {
    return { ok: false, error: 'snapshot-malformed-json' };
  }
  try {
    const version = typeof parsed.version === 'number' ? parsed.version : 0;
    if (!Number.isInteger(version) || version < 0 || version > SNAPSHOT_VERSION) {
      return { ok: false, error: 'snapshot-unsupported-version' };
    }
    const snapshot: BridgeSnapshot = {
      version,
      packets: Array.isArray(parsed.packets) ? parsed.packets : [],
      auditEvents: Array.isArray(parsed.auditEvents) ? parsed.auditEvents : [],
      pendingPrompts: Array.isArray(parsed.pendingPrompts) ? parsed.pendingPrompts : [],
      outboundPrompts: Array.isArray(parsed.outboundPrompts) ? parsed.outboundPrompts : [],
      inboundMessages: Array.isArray(parsed.inboundMessages) ? parsed.inboundMessages : [],
      relayContexts: Array.isArray(parsed.relayContexts) ? parsed.relayContexts : [],
      goals: Array.isArray(parsed.goals) ? parsed.goals : [],
      plans: Array.isArray(parsed.plans) ? parsed.plans : [],
      projects: Array.isArray(parsed.projects) ? parsed.projects : [],
      workbuddyTaskReferences: Array.isArray(parsed.workbuddyTaskReferences) ? parsed.workbuddyTaskReferences : [],
      workbuddyReviewResultSinks: Array.isArray(parsed.workbuddyReviewResultSinks) ? parsed.workbuddyReviewResultSinks : [],
      workbuddyPromptDraftSinks: Array.isArray(parsed.workbuddyPromptDraftSinks) ? parsed.workbuddyPromptDraftSinks : [],
      workbuddyExecutionLedgerEvents: Array.isArray(parsed.workbuddyExecutionLedgerEvents) ? parsed.workbuddyExecutionLedgerEvents : [],
      teams: Array.isArray(parsed.teams) ? parsed.teams : [],
      teamArtifacts: Array.isArray(parsed.teamArtifacts) ? parsed.teamArtifacts : [],
      verificationRunRecords: Array.isArray(parsed.verificationRunRecords) ? parsed.verificationRunRecords : [],
    };
    // v0-v2 snapshots retain their historical tolerant hydration contract.
    // v3+ snapshots are written by the hardened writer and fail closed.
    if (version >= 3) {
      snapshot.packets.forEach(assertBridgePacket);
      snapshot.auditEvents.forEach(assertAuditEvent);
      snapshot.outboundPrompts.forEach(assertOutboundPrompt);
      snapshot.inboundMessages.forEach(assertInboundMessage);
      snapshot.goals.forEach(assertGoal);
      snapshot.plans.forEach(assertPlan);
      snapshot.projects.forEach(assertProject);
      for (const context of snapshot.relayContexts) {
        if (
          !context ||
          typeof context.sessionId !== 'string' ||
          typeof context.endpointId !== 'string' ||
          typeof context.lastOutboundPromptId !== 'string' ||
          typeof context.updatedAt !== 'number'
        ) {
          throw new Error('invalid relay context');
        }
      }
    }
    return { ok: true, snapshot };
  } catch {
    return { ok: false, error: 'snapshot-invalid-record' };
  }
}

function readSnapshotFile(path: string): SnapshotReadResult {
  try {
    return parseSnapshot(readFileSync(path, 'utf8'));
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error
      ? error.code
      : undefined;
    return {
      ok: false,
      error: code === 'ENOENT' ? 'snapshot-missing' : 'snapshot-read-failed',
    };
  }
}

function writeAndSync(path: string, content: string): void {
  const fd = openSync(path, 'w');
  try {
    writeFileSync(fd, content, 'utf8');
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function syncDirectory(path: string): void {
  const fd = openSync(path, 'r');
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function removeTemporaryFile(path: string): void {
  try {
    rmSync(path, { force: true });
  } catch {
    // Preserve the original write error; cleanup is best-effort.
  }
}

export class JsonSnapshotStore {
  private readonly dataDir: string;

  constructor(dataDir: string) {
    this.dataDir = dataDir;
  }

  get path(): string {
    return snapshotPath(this.dataDir);
  }

  write(snapshot: BridgeSnapshot): SnapshotWriteResult {
    const path = snapshotPath(this.dataDir);
    const tempPath = resolve(this.dataDir, SNAPSHOT_TEMP_FILENAME);
    const backupPath = resolve(this.dataDir, SNAPSHOT_BACKUP_FILENAME);
    const backupTempPath = `${backupPath}.tmp`;
    try {
      mkdirSync(this.dataDir, { recursive: true });
      writeAndSync(tempPath, `${JSON.stringify(snapshot, null, 2)}\n`);
      if (existsSync(path)) {
        copyFileSync(path, backupTempPath);
        const backupFd = openSync(backupTempPath, 'r');
        try {
          fsyncSync(backupFd);
        } finally {
          closeSync(backupFd);
        }
        renameSync(backupTempPath, backupPath);
        syncDirectory(this.dataDir);
      }
      renameSync(tempPath, path);
      syncDirectory(this.dataDir);
      return { ok: true, path };
    } catch (error) {
      removeTemporaryFile(tempPath);
      removeTemporaryFile(backupTempPath);
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'snapshot-write-failed',
      };
    }
  }

  read(): SnapshotReadResult {
    const primary = readSnapshotFile(snapshotPath(this.dataDir));
    if (primary.ok) {
      return primary;
    }
    const backup = readSnapshotFile(resolve(this.dataDir, SNAPSHOT_BACKUP_FILENAME));
    if (backup.ok) {
      return { ...backup, recoveredFromBackup: true };
    }
    if (primary.error === 'snapshot-read-failed') {
      return primary;
    }
    if (backup.error === 'snapshot-read-failed') {
      return backup;
    }
    if (backup.error === 'snapshot-missing') {
      return primary;
    }
    if (primary.error === 'snapshot-missing') {
      return backup;
    }
    return { ok: false, error: 'snapshot-corrupt-primary-and-backup' };
  }
}

export interface BuildSnapshotInput {
  packets: BridgePacket[];
  auditEvents: AuditEvent[];
  pendingPrompts: PendingPrompt[];
  outboundPrompts?: OutboundPrompt[];
  inboundMessages?: InboundMessage[];
  relayContexts?: RelayContext[];
  goals?: Goal[];
  plans?: Plan[];
  projects?: Project[];
  workbuddyTaskReferences?: WorkBuddyTaskReference[];
  workbuddyReviewResultSinks?: WorkBuddyReviewResultSink[];
  workbuddyPromptDraftSinks?: WorkBuddyPromptDraftSink[];
  workbuddyExecutionLedgerEvents?: WorkBuddyExecutionLedgerEvent[];
  teams?: TeamSpec[];
  teamArtifacts?: SlotArtifact[];
  verificationRunRecords?: import('../../../../packages/shared/src/types.ts').VerificationRunRecord[];
}

export function buildSnapshot(input: BuildSnapshotInput): BridgeSnapshot {
  return {
    version: SNAPSHOT_VERSION,
    packets: input.packets,
    auditEvents: input.auditEvents,
    pendingPrompts: input.pendingPrompts,
    outboundPrompts: input.outboundPrompts ?? [],
    inboundMessages: input.inboundMessages ?? [],
    relayContexts: input.relayContexts ?? [],
    goals: input.goals ?? [],
    plans: input.plans ?? [],
    projects: input.projects ?? [],
    workbuddyTaskReferences: input.workbuddyTaskReferences ?? [],
    workbuddyReviewResultSinks: input.workbuddyReviewResultSinks ?? [],
    workbuddyPromptDraftSinks: input.workbuddyPromptDraftSinks ?? [],
    workbuddyExecutionLedgerEvents: input.workbuddyExecutionLedgerEvents ?? [],
    teams: input.teams ?? [],
    teamArtifacts: input.teamArtifacts ?? [],
    verificationRunRecords: input.verificationRunRecords ?? [],
  };
}
