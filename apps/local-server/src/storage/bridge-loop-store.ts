import { randomUUID } from 'node:crypto';

import type {
  AgentDeliveryResult,
  BridgeLoop,
  BridgeLoopStatus,
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
import type {
  InMemoryPendingPromptStore,
} from './pending-prompt-store.ts';

export interface CreateBridgeLoopInput {
  id?: string;
  sessionId: string;
  output: string;
  now?: number;
}

export interface CreatePendingPromptFromChatGptInput {
  prompt: string;
  now?: number;
}

export interface LoopDeliveryResult {
  ok: boolean;
  loop: BridgeLoop;
  delivery?: AgentDeliveryResult;
  failureReason?: string;
}

function cloneLoop(loop: BridgeLoop): BridgeLoop {
  return structuredClone(loop);
}

export class InMemoryBridgeLoopStore {
  private readonly loops = new Map<string, BridgeLoop>();
  private readonly packetStore: InMemoryPacketStore;
  private readonly auditLog: InMemoryAuditLog;
  private readonly pendingPromptStore: InMemoryPendingPromptStore;

  constructor(
    packetStore: InMemoryPacketStore,
    auditLog: InMemoryAuditLog,
    pendingPromptStore: InMemoryPendingPromptStore,
  ) {
    this.packetStore = packetStore;
    this.auditLog = auditLog;
    this.pendingPromptStore = pendingPromptStore;
  }

  createFromCodexOutput(input: CreateBridgeLoopInput): BridgeLoop {
    const now = input.now ?? Date.now();
    const packet = this.packetStore.createPacket({
      sessionId: input.sessionId,
      source: 'codex',
      target: 'chatgpt-web',
      kind: 'cli-output-review',
      rawContent: input.output,
      context: {},
      now,
    });
    const loop: BridgeLoop = {
      id: input.id ?? randomUUID(),
      sessionId: input.sessionId,
      status: 'codex-output-ready',
      codexOutputPacketId: packet.id,
      chatGptFillRequired: true,
      userSendRequired: true,
      codexDeliveryRequired: false,
      createdAt: now,
      updatedAt: now,
    };

    this.loops.set(loop.id, cloneLoop(loop));
    this.auditLog.createAndAppend({
      sessionId: loop.sessionId,
      packetId: packet.id,
      type: 'read_cli_output',
      source: 'codex',
      target: 'chatgpt-web',
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

    return cloneLoop(loop);
  }

  markChatGptFilled(loopId: string, now: number = Date.now()): BridgeLoop | undefined {
    return this.updateLoop(loopId, 'chatgpt-awaiting-user-send', now, (loop) => {
      loop.chatGptFillRequired = false;
      loop.userSendRequired = true;
      loop.codexDeliveryRequired = false;
      this.auditLog.createAndAppend({
        sessionId: loop.sessionId,
        packetId: loop.codexOutputPacketId,
        type: 'fill_chatgpt',
        source: 'local-server',
        target: 'chatgpt-web',
        result: {
          ok: true,
        },
        timestamp: now,
      });
    });
  }

  createPendingPromptFromChatGpt(
    loopId: string,
    input: CreatePendingPromptFromChatGptInput,
  ): BridgeLoop | undefined {
    const loop = this.loops.get(loopId);
    if (!loop) {
      return undefined;
    }

    const now = input.now ?? Date.now();
    this.auditLog.createAndAppend({
      sessionId: loop.sessionId,
      packetId: loop.codexOutputPacketId,
      type: 'extract_chatgpt',
      source: 'chatgpt-web',
      target: 'local-server',
      result: {
        ok: true,
      },
      timestamp: now,
    });
    const pendingPrompt = this.pendingPromptStore.createPendingPrompt({
      sessionId: loop.sessionId,
      prompt: input.prompt,
      source: 'chatgpt-web',
      transport: 'managed-pty',
      now,
    });

    loop.pendingPromptId = pendingPrompt.id;
    loop.status = 'pending-prompt-ready';
    loop.chatGptFillRequired = false;
    loop.userSendRequired = false;
    loop.codexDeliveryRequired = true;
    loop.updatedAt = now;
    this.loops.set(loop.id, cloneLoop(loop));

    return cloneLoop(loop);
  }

  confirmPendingPrompt(loopId: string, now: number = Date.now()): BridgeLoop | undefined {
    const loop = this.loops.get(loopId);
    if (!loop?.pendingPromptId) {
      return undefined;
    }

    const confirmed = this.pendingPromptStore.confirmPrompt(loop.pendingPromptId, now);
    if (!confirmed) {
      return undefined;
    }

    loop.status = 'pending-prompt-confirmed';
    loop.updatedAt = now;
    this.loops.set(loop.id, cloneLoop(loop));

    return cloneLoop(loop);
  }

  async deliverConfirmedPrompt(
    loopId: string,
    adapter: AgentAdapter,
    now: number = Date.now(),
  ): Promise<LoopDeliveryResult> {
    const loop = this.loops.get(loopId);
    if (!loop?.pendingPromptId) {
      return {
        ok: false,
        loop: this.createMissingLoop(loopId, now),
        failureReason: 'pending-prompt-not-found',
      };
    }

    const result = await this.pendingPromptStore.sendConfirmedPrompt(
      loop.pendingPromptId,
      adapter,
      now,
    );
    if (!result.ok) {
      return {
        ok: false,
        loop: cloneLoop(loop),
        delivery: result.delivery,
        failureReason: result.failureReason,
      };
    }

    loop.status = 'codex-delivered';
    loop.codexDeliveryRequired = false;
    loop.updatedAt = now;
    this.loops.set(loop.id, cloneLoop(loop));

    return {
      ok: true,
      loop: cloneLoop(loop),
      delivery: result.delivery,
    };
  }

  getLoop(loopId: string): BridgeLoop | undefined {
    const loop = this.loops.get(loopId);
    return loop ? cloneLoop(loop) : undefined;
  }

  listLoops(): BridgeLoop[] {
    return Array.from(this.loops.values(), cloneLoop);
  }

  private updateLoop(
    loopId: string,
    status: BridgeLoopStatus,
    now: number,
    mutate: (loop: BridgeLoop) => void,
  ): BridgeLoop | undefined {
    const loop = this.loops.get(loopId);
    if (!loop) {
      return undefined;
    }

    loop.status = status;
    loop.updatedAt = now;
    mutate(loop);
    this.loops.set(loop.id, cloneLoop(loop));
    return cloneLoop(loop);
  }

  private createMissingLoop(loopId: string, now: number): BridgeLoop {
    return {
      id: loopId,
      sessionId: 'unknown',
      status: 'failed',
      codexOutputPacketId: 'unknown',
      chatGptFillRequired: false,
      userSendRequired: false,
      codexDeliveryRequired: false,
      createdAt: now,
      updatedAt: now,
    };
  }
}
