export interface ConversationInstructionPacket {
  id: string;
  projectId: string;
  pairingId: string;
  userEventId: string;
  text: string;
  payloadHash: string;
  createdAt: number;
}

export type ConversationInstructionCreateParams = Pick<
  ConversationInstructionPacket,
  'projectId' | 'pairingId' | 'userEventId' | 'text'
>;

function hashText(text: string): string {
  let hash = 5381;
  for (let i = 0; i < text.length; i++) {
    hash = (hash * 33) ^ text.charCodeAt(i);
  }
  return (hash >>> 0).toString(16);
}

function generateId(): string {
  return `inst-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class InMemoryConversationInstructionStore {
  private readonly packets = new Map<string, ConversationInstructionPacket>();

  create(params: ConversationInstructionCreateParams): ConversationInstructionPacket {
    const id = generateId();
    const stored: ConversationInstructionPacket = {
      id,
      projectId: params.projectId,
      pairingId: params.pairingId,
      userEventId: params.userEventId,
      text: params.text,
      payloadHash: hashText(params.text),
      createdAt: Date.now(),
    };
    this.packets.set(id, clone(stored));
    return clone(stored);
  }

  listByProject(projectId: string): ConversationInstructionPacket[] {
    return Array.from(this.packets.values())
      .filter(p => p.projectId === projectId)
      .sort((a, b) => a.createdAt - b.createdAt)
      .map(clone);
  }

  get(id: string): ConversationInstructionPacket | undefined {
    const packet = this.packets.get(id);
    return packet ? clone(packet) : undefined;
  }

  exportPackets(): ConversationInstructionPacket[] {
    return Array.from(this.packets.values(), clone);
  }

  hydratePacket(packet: ConversationInstructionPacket): void {
    if (
      !packet ||
      typeof packet.id !== 'string' ||
      typeof packet.projectId !== 'string' ||
      typeof packet.pairingId !== 'string' ||
      typeof packet.userEventId !== 'string' ||
      typeof packet.text !== 'string' ||
      typeof packet.payloadHash !== 'string' ||
      typeof packet.createdAt !== 'number'
    ) {
      return;
    }
    this.packets.set(packet.id, clone(packet));
  }
}
