import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
} from '../../../../packages/shared/src/types.ts';

export const SNAPSHOT_VERSION = 2;
export const SNAPSHOT_FILENAME = 'bridge-snapshot.json';

export interface BridgeSnapshot {
  version: number;
  packets: BridgePacket[];
  auditEvents: AuditEvent[];
  pendingPrompts: PendingPrompt[];
  outboundPrompts: OutboundPrompt[];
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
        outboundPrompts: Array.isArray(parsed.outboundPrompts) ? parsed.outboundPrompts : [],
        goals: Array.isArray(parsed.goals) ? parsed.goals : [],
        plans: Array.isArray(parsed.plans) ? parsed.plans : [],
        projects: Array.isArray(parsed.projects) ? parsed.projects : [],
        workbuddyTaskReferences: Array.isArray(parsed.workbuddyTaskReferences) ? parsed.workbuddyTaskReferences : [],
        workbuddyReviewResultSinks: Array.isArray(parsed.workbuddyReviewResultSinks) ? parsed.workbuddyReviewResultSinks : [],
        workbuddyPromptDraftSinks: Array.isArray(parsed.workbuddyPromptDraftSinks) ? parsed.workbuddyPromptDraftSinks : [],
        workbuddyExecutionLedgerEvents: Array.isArray(parsed.workbuddyExecutionLedgerEvents) ? parsed.workbuddyExecutionLedgerEvents : [],
        teams: Array.isArray(parsed.teams) ? parsed.teams : [],
        teamArtifacts: Array.isArray(parsed.teamArtifacts) ? parsed.teamArtifacts : [],
      };
      return { ok: true, snapshot };
    } catch {
      return { ok: false, error: 'snapshot-malformed-json' };
    }
  }
}

export interface BuildSnapshotInput {
  packets: BridgePacket[];
  auditEvents: AuditEvent[];
  pendingPrompts: PendingPrompt[];
  outboundPrompts?: OutboundPrompt[];
  goals?: Goal[];
  plans?: Plan[];
  projects?: Project[];
  workbuddyTaskReferences?: WorkBuddyTaskReference[];
  workbuddyReviewResultSinks?: WorkBuddyReviewResultSink[];
  workbuddyPromptDraftSinks?: WorkBuddyPromptDraftSink[];
  workbuddyExecutionLedgerEvents?: WorkBuddyExecutionLedgerEvent[];
  teams?: TeamSpec[];
  teamArtifacts?: SlotArtifact[];
}

export function buildSnapshot(input: BuildSnapshotInput): BridgeSnapshot {
  return {
    version: SNAPSHOT_VERSION,
    packets: input.packets,
    auditEvents: input.auditEvents,
    pendingPrompts: input.pendingPrompts,
    outboundPrompts: input.outboundPrompts ?? [],
    goals: input.goals ?? [],
    plans: input.plans ?? [],
    projects: input.projects ?? [],
    workbuddyTaskReferences: input.workbuddyTaskReferences ?? [],
    workbuddyReviewResultSinks: input.workbuddyReviewResultSinks ?? [],
    workbuddyPromptDraftSinks: input.workbuddyPromptDraftSinks ?? [],
    workbuddyExecutionLedgerEvents: input.workbuddyExecutionLedgerEvents ?? [],
    teams: input.teams ?? [],
    teamArtifacts: input.teamArtifacts ?? [],
  };
}
