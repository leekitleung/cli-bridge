import type {
  BridgeMetricsSummary,
  BridgePacket,
  PendingPrompt,
} from '../../../../packages/shared/src/types.ts';
import type {
  InMemoryAuditLog,
} from './audit-log.ts';
import type {
  InMemoryPacketStore,
} from './packet-store.ts';
import type {
  InMemoryPendingPromptStore,
} from './pending-prompt-store.ts';

export interface MetricsSummaryInput {
  packetStore: InMemoryPacketStore;
  auditLog: InMemoryAuditLog;
  pendingPromptStore: InMemoryPendingPromptStore;
}

function hasPacketStatus(packet: BridgePacket, status: BridgePacket['status']): boolean {
  return packet.status === status;
}

function hasPromptStatus(prompt: PendingPrompt, status: PendingPrompt['status']): boolean {
  return prompt.status === status;
}

function createRate(numerator: number, denominator: number): number {
  if (denominator === 0) {
    return 0;
  }

  return numerator / denominator;
}

export function createMetricsSummary(input: MetricsSummaryInput): BridgeMetricsSummary {
  const packets = input.packetStore.listPackets();
  const events = input.auditLog.listEvents();
  const prompts = input.pendingPromptStore.listPrompts();
  const confirmedPromptCount = events.filter((event) => event.type === 'confirm_prompt').length;
  const clipboardFallbackEventCount = events.filter((event) => (
    event.type === 'copy_to_clipboard' ||
    event.target === 'clipboard'
  )).length;

  return {
    packetCreatedCount: packets.length,
    packetSentCount: prompts.filter((prompt) => hasPromptStatus(prompt, 'sent')).length +
      packets.filter((packet) => hasPacketStatus(packet, 'sent')).length,
    packetCancelledCount: prompts.filter((prompt) => hasPromptStatus(prompt, 'cancelled')).length +
      packets.filter((packet) => hasPacketStatus(packet, 'cancelled')).length,
    packetFailedCount: prompts.filter((prompt) => hasPromptStatus(prompt, 'failed')).length +
      packets.filter((packet) => hasPacketStatus(packet, 'failed')).length,
    fallbackToClipboardCount: clipboardFallbackEventCount +
      prompts.filter((prompt) => hasPromptStatus(prompt, 'failed')).length,
    redactionHitCount: packets.reduce(
      (count, packet) => count + packet.safety.redactionSummary.length,
      0,
    ),
    confirmRate: createRate(confirmedPromptCount, prompts.length),
    cancelRate: createRate(
      prompts.filter((prompt) => hasPromptStatus(prompt, 'cancelled')).length,
      prompts.length,
    ),
  };
}
