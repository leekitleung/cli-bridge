import { randomUUID } from 'node:crypto';

import type {
  AgentDeliveryResult,
  PendingPrompt,
} from '../../../../packages/shared/src/types.ts';
import type {
  AgentAdapter,
} from '../adapters/AgentAdapter.ts';
import type {
  InMemoryAuditLog,
} from './audit-log.ts';
import type {
  InMemoryPacketStore,
} from './packet-store.ts';

export interface CreatePendingPromptInput {
  id?: string;
  sessionId: string;
  prompt: string;
  source?: 'chatgpt-web' | 'user-selection' | 'clipboard';
  transport?: 'managed-pty' | 'clipboard';
  now?: number;
}

export interface PendingPromptSendResult {
  ok: boolean;
  prompt: PendingPrompt;
  delivery?: AgentDeliveryResult;
  clipboardFallback?: string;
  failureReason?: string;
}

export interface ClipboardHandoffResult {
  ok: boolean;
  prompt: PendingPrompt;
  clipboardText?: string;
  checklist: string[];
  failureReason?: string;
}

const MANUAL_PASTE_CHECKLIST = [
  'Copy the pending prompt text.',
  'Paste it into the managed Codex session.',
  'Submit manually after reviewing the prompt.',
  'Record success or failure in the bridge audit trail.',
];

function clonePrompt(prompt: PendingPrompt): PendingPrompt {
  return structuredClone(prompt);
}

export class InMemoryPendingPromptStore {
  private readonly prompts = new Map<string, PendingPrompt>();
  private readonly packetStore: InMemoryPacketStore;
  private readonly auditLog: InMemoryAuditLog;

  constructor(
    packetStore: InMemoryPacketStore,
    auditLog: InMemoryAuditLog,
  ) {
    this.packetStore = packetStore;
    this.auditLog = auditLog;
  }

  createPendingPrompt(input: CreatePendingPromptInput): PendingPrompt {
    const packet = this.packetStore.createPacket({
      sessionId: input.sessionId,
      source: input.source ?? 'chatgpt-web',
      target: input.transport === 'clipboard' ? 'clipboard' : 'codex',
      kind: 'pending-prompt',
      rawContent: input.prompt,
      context: {
        transport: input.transport ?? 'managed-pty',
      },
      now: input.now,
    });
    const now = input.now ?? Date.now();
    const prompt: PendingPrompt = {
      id: input.id ?? randomUUID(),
      sessionId: input.sessionId,
      packetId: packet.id,
      prompt: packet.processedContent,
      status: 'draft',
      transport: input.transport ?? 'managed-pty',
      createdAt: now,
      updatedAt: now,
    };

    this.prompts.set(prompt.id, clonePrompt(prompt));
    this.auditLog.createAndAppend({
      sessionId: prompt.sessionId,
      packetId: prompt.packetId,
      type: 'create_pending_prompt',
      source: packet.source,
      target: packet.target,
      safety: {
        contentHash: packet.safety.contentHash,
        redactionSummary: packet.safety.redactionSummary,
        riskLevel: packet.safety.blocked ? 'high' : 'low',
      },
      result: {
        ok: true,
      },
      timestamp: now,
    });

    return clonePrompt(prompt);
  }

  previewPrompt(promptId: string, now: number = Date.now()): PendingPrompt | undefined {
    const prompt = this.prompts.get(promptId);
    if (!prompt) {
      return undefined;
    }

    prompt.status = 'previewed';
    prompt.updatedAt = now;
    this.prompts.set(prompt.id, clonePrompt(prompt));
    return clonePrompt(prompt);
  }

  confirmPrompt(promptId: string, now: number = Date.now()): PendingPrompt | undefined {
    const prompt = this.prompts.get(promptId);
    if (!prompt || prompt.status === 'cancelled' || prompt.status === 'sent') {
      return undefined;
    }

    prompt.status = 'confirmed';
    prompt.confirmedAt = now;
    prompt.updatedAt = now;
    this.prompts.set(prompt.id, clonePrompt(prompt));
    this.auditLog.createAndAppend({
      sessionId: prompt.sessionId,
      packetId: prompt.packetId,
      type: 'confirm_prompt',
      source: 'local-server',
      target: prompt.transport,
      result: {
        ok: true,
      },
      timestamp: now,
    });

    return clonePrompt(prompt);
  }

  async sendConfirmedPrompt(
    promptId: string,
    adapter: AgentAdapter,
    now: number = Date.now(),
  ): Promise<PendingPromptSendResult> {
    const prompt = this.prompts.get(promptId);
    if (!prompt) {
      return {
        ok: false,
        prompt: this.createMissingPrompt(promptId, now),
        failureReason: 'pending-prompt-not-found',
      };
    }

    if (prompt.status !== 'confirmed') {
      return {
        ok: false,
        prompt: clonePrompt(prompt),
        failureReason: 'pending-prompt-not-confirmed',
      };
    }

    const delivery = await adapter.sendPrompt(prompt.prompt);
    if (!delivery.ok) {
      const failedPrompt = this.markFailed(prompt, delivery.failureReason ?? 'agent-delivery-failed', now);
      return {
        ok: false,
        prompt: failedPrompt,
        delivery,
        clipboardFallback: prompt.prompt,
        failureReason: failedPrompt.failureReason,
      };
    }

    prompt.status = 'sent';
    prompt.sentAt = now;
    prompt.updatedAt = now;
    this.prompts.set(prompt.id, clonePrompt(prompt));
    this.auditLog.createAndAppend({
      sessionId: prompt.sessionId,
      packetId: prompt.packetId,
      type: 'send_to_agent',
      source: 'local-server',
      target: adapter.name,
      result: {
        ok: true,
      },
      timestamp: now,
    });

    return {
      ok: true,
      prompt: clonePrompt(prompt),
      delivery,
    };
  }

  createClipboardHandoff(
    promptId: string,
    fallbackReason: string,
    now: number = Date.now(),
  ): ClipboardHandoffResult {
    const prompt = this.prompts.get(promptId);
    if (!prompt) {
      return {
        ok: false,
        prompt: this.createMissingPrompt(promptId, now),
        checklist: MANUAL_PASTE_CHECKLIST,
        failureReason: 'pending-prompt-not-found',
      };
    }

    if (prompt.status !== 'confirmed') {
      return {
        ok: false,
        prompt: clonePrompt(prompt),
        checklist: MANUAL_PASTE_CHECKLIST,
        failureReason: 'pending-prompt-not-confirmed',
      };
    }

    prompt.transport = 'clipboard';
    prompt.clipboardHandoff = {
      status: 'ready-to-copy',
      fallbackReason,
      checklist: MANUAL_PASTE_CHECKLIST,
      createdAt: now,
    };
    prompt.updatedAt = now;
    this.prompts.set(prompt.id, clonePrompt(prompt));
    this.auditLog.createAndAppend({
      sessionId: prompt.sessionId,
      packetId: prompt.packetId,
      type: 'copy_to_clipboard',
      source: 'local-server',
      target: 'clipboard',
      snapshot: {
        transport: 'clipboard',
      },
      result: {
        ok: true,
        failureReason: fallbackReason,
      },
      timestamp: now,
    });

    return {
      ok: true,
      prompt: clonePrompt(prompt),
      clipboardText: prompt.prompt,
      checklist: MANUAL_PASTE_CHECKLIST,
    };
  }

  cancelPrompt(promptId: string, now: number = Date.now()): PendingPrompt | undefined {
    const prompt = this.prompts.get(promptId);
    if (!prompt || prompt.status === 'sent') {
      return undefined;
    }

    prompt.status = 'cancelled';
    prompt.cancelledAt = now;
    prompt.updatedAt = now;
    this.prompts.set(prompt.id, clonePrompt(prompt));
    this.auditLog.createAndAppend({
      sessionId: prompt.sessionId,
      packetId: prompt.packetId,
      type: 'operation_cancelled',
      source: 'local-server',
      target: prompt.transport,
      result: {
        ok: true,
      },
      timestamp: now,
    });

    return clonePrompt(prompt);
  }

  getPrompt(promptId: string): PendingPrompt | undefined {
    const prompt = this.prompts.get(promptId);
    return prompt ? clonePrompt(prompt) : undefined;
  }

  listPrompts(): PendingPrompt[] {
    return Array.from(this.prompts.values(), clonePrompt);
  }

  private markFailed(prompt: PendingPrompt, failureReason: string, now: number): PendingPrompt {
    prompt.status = 'failed';
    prompt.failureReason = failureReason;
    prompt.failedAt = now;
    prompt.updatedAt = now;
    this.prompts.set(prompt.id, clonePrompt(prompt));
    this.auditLog.createAndAppend({
      sessionId: prompt.sessionId,
      packetId: prompt.packetId,
      type: 'operation_failed',
      source: 'local-server',
      target: prompt.transport,
      result: {
        ok: false,
        failureReason,
      },
      timestamp: now,
    });

    return clonePrompt(prompt);
  }

  private createMissingPrompt(promptId: string, now: number): PendingPrompt {
    return {
      id: promptId,
      sessionId: 'unknown',
      packetId: 'unknown',
      prompt: '',
      status: 'failed',
      transport: 'clipboard',
      createdAt: now,
      updatedAt: now,
      failedAt: now,
      failureReason: 'pending-prompt-not-found',
    };
  }
}
