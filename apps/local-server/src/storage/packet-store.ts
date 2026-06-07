import { randomUUID } from 'node:crypto';

import {
  assertBridgePacket,
} from '../../../../packages/shared/src/schemas.ts';
import type {
  BridgePacket,
  BridgePacketKind,
  BridgePacketSource,
  BridgePacketStatus,
  BridgePacketTarget,
} from '../../../../packages/shared/src/types.ts';
import { createContentHash } from '../../../../packages/shared/src/utils/hash.ts';
import { createTokenEstimateMetrics } from '../../../../packages/shared/src/utils/token-estimate.ts';
import { redactSensitiveContent } from '../security/redaction.ts';

export interface CreatePacketInput {
  id?: string;
  sessionId: string;
  source: BridgePacketSource;
  target: BridgePacketTarget;
  kind: BridgePacketKind;
  rawContent: string;
  context?: BridgePacket['context'];
  status?: BridgePacketStatus;
  now?: number;
}

function clonePacket(packet: BridgePacket): BridgePacket {
  return structuredClone(packet);
}

export class InMemoryPacketStore {
  private readonly packets = new Map<string, BridgePacket>();
  private readonly rawContents = new Map<string, string>();

  createPacket(input: CreatePacketInput): BridgePacket {
    const redaction = redactSensitiveContent(input.rawContent);
    const now = input.now ?? Date.now();
    const packet: BridgePacket = {
      id: input.id ?? randomUUID(),
      sessionId: input.sessionId,
      source: input.source,
      target: input.target,
      kind: input.kind,
      processedContent: redaction.processedContent,
      rawContentRef: {
        storage: 'memory-only',
      },
      safety: {
        redactionApplied: redaction.redactionApplied,
        redactionSummary: redaction.redactionSummary,
        blocked: redaction.blocked,
        blockReasons: redaction.blockReasons,
        contentHash: createContentHash(redaction.processedContent),
      },
      context: input.context ?? {},
      metrics: createTokenEstimateMetrics(input.rawContent, redaction.processedContent),
      status: input.status ?? 'draft',
      createdAt: now,
      updatedAt: now,
    };

    assertBridgePacket(packet);
    this.packets.set(packet.id, clonePacket(packet));
    this.rawContents.set(packet.id, input.rawContent);

    return clonePacket(packet);
  }

  getPacket(packetId: string): BridgePacket | undefined {
    const packet = this.packets.get(packetId);
    return packet ? clonePacket(packet) : undefined;
  }

  listPackets(): BridgePacket[] {
    return Array.from(this.packets.values(), clonePacket);
  }

  getRawContent(packetId: string): string | undefined {
    return this.rawContents.get(packetId);
  }

  clearRawContent(packetId: string): void {
    this.rawContents.delete(packetId);
  }
}
