import { randomUUID } from 'node:crypto';

import {
  assertOutboundPrompt,
} from '../../../../packages/shared/src/schemas.ts';
import type {
  OutboundPrompt,
} from '../../../../packages/shared/src/types.ts';
import type {
  InMemoryAuditLog,
} from './audit-log.ts';
import type {
  InMemoryPacketStore,
} from './packet-store.ts';

export interface CreateOutboundPromptInput {
  id?: string;
  sessionId: string;
  prompt: string;
  now?: number;
}

export interface AcknowledgeOutboundPromptInput {
  id: string;
  ok: boolean;
  failureReason?: string;
  now?: number;
}

const OUTBOUND_PROMPT_STATUS_VALUES = new Set([
  'queued',
  'claimed',
  'delivered',
  'failed',
  'cancelled',
]);

function clonePrompt(prompt: OutboundPrompt): OutboundPrompt {
  return structuredClone(prompt);
}

function isOutboundPromptShape(value: unknown): value is OutboundPrompt {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    typeof record.id === 'string' &&
    typeof record.sessionId === 'string' &&
    typeof record.packetId === 'string' &&
    typeof record.prompt === 'string' &&
    typeof record.status === 'string' &&
    OUTBOUND_PROMPT_STATUS_VALUES.has(record.status) &&
    record.target === 'chatgpt-web' &&
    typeof record.createdAt === 'number' &&
    typeof record.updatedAt === 'number'
  );
}

export class InMemoryOutboundPromptStore {
  private readonly prompts = new Map<string, OutboundPrompt>();
  private readonly packetStore: InMemoryPacketStore;
  private readonly auditLog: InMemoryAuditLog;

  constructor(
    packetStore: InMemoryPacketStore,
    auditLog: InMemoryAuditLog,
  ) {
    this.packetStore = packetStore;
    this.auditLog = auditLog;
  }

  createOutboundPrompt(input: CreateOutboundPromptInput): OutboundPrompt {
    const packet = this.packetStore.createPacket({
      sessionId: input.sessionId,
      source: 'codex',
      target: 'chatgpt-web',
      kind: 'cli-output-review',
      rawContent: input.prompt,
      context: {
        transport: 'clipboard',
      },
      status: 'confirmed',
      now: input.now,
    });
    const now = input.now ?? Date.now();
    const prompt: OutboundPrompt = {
      id: input.id ?? randomUUID(),
      sessionId: input.sessionId,
      packetId: packet.id,
      prompt: packet.processedContent,
      status: 'queued',
      target: 'chatgpt-web',
      createdAt: now,
      updatedAt: now,
    };

    assertOutboundPrompt(prompt);
    this.prompts.set(prompt.id, clonePrompt(prompt));
    this.auditLog.createAndAppend({
      sessionId: prompt.sessionId,
      packetId: prompt.packetId,
      approvalId: prompt.id,
      type: 'create_outbound_prompt',
      source: 'local-server',
      target: 'chatgpt-web',
      safety: {
        contentHash: packet.safety.contentHash,
        redactionSummary: packet.safety.redactionSummary,
        riskLevel: packet.safety.blocked ? 'high' : 'medium',
      },
      result: {
        ok: true,
      },
      timestamp: now,
    });

    return clonePrompt(prompt);
  }

  claimNext(now: number = Date.now()): OutboundPrompt | undefined {
    const prompt = Array.from(this.prompts.values())
      .filter((candidate) => candidate.status === 'queued')
      .sort((left, right) => left.createdAt - right.createdAt)[0];

    if (!prompt) {
      return undefined;
    }

    prompt.status = 'claimed';
    prompt.claimedAt = now;
    prompt.updatedAt = now;
    this.prompts.set(prompt.id, clonePrompt(prompt));
    this.auditLog.createAndAppend({
      sessionId: prompt.sessionId,
      packetId: prompt.packetId,
      approvalId: prompt.id,
      type: 'claim_outbound_prompt',
      source: 'chatgpt-web',
      target: 'chatgpt-web',
      result: {
        ok: true,
      },
      timestamp: now,
    });

    return clonePrompt(prompt);
  }

  acknowledge(input: AcknowledgeOutboundPromptInput): OutboundPrompt | undefined {
    const prompt = this.prompts.get(input.id);
    if (!prompt || prompt.status === 'cancelled' || prompt.status === 'delivered') {
      return undefined;
    }

    const now = input.now ?? Date.now();
    if (input.ok) {
      prompt.status = 'delivered';
      prompt.deliveredAt = now;
      prompt.failureReason = undefined;
    } else {
      prompt.status = 'failed';
      prompt.failedAt = now;
      prompt.failureReason = input.failureReason ?? 'chatgpt-fill-failed';
    }
    prompt.updatedAt = now;
    this.prompts.set(prompt.id, clonePrompt(prompt));
    this.auditLog.createAndAppend({
      sessionId: prompt.sessionId,
      packetId: prompt.packetId,
      approvalId: prompt.id,
      type: input.ok ? 'fill_chatgpt' : 'operation_failed',
      source: 'chatgpt-web',
      target: 'chatgpt-web',
      result: {
        ok: input.ok,
        failureReason: input.ok ? undefined : prompt.failureReason,
      },
      timestamp: now,
    });

    return clonePrompt(prompt);
  }

  listPrompts(): OutboundPrompt[] {
    return Array.from(this.prompts.values(), clonePrompt);
  }

  exportPrompts(): OutboundPrompt[] {
    return this.listPrompts();
  }

  hydratePrompts(prompts: unknown[]): number {
    let restored = 0;
    for (const candidate of prompts) {
      if (!isOutboundPromptShape(candidate)) {
        continue;
      }
      this.prompts.set(candidate.id, clonePrompt(candidate));
      restored += 1;
    }
    return restored;
  }
}
