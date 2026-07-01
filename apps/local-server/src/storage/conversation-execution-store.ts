export interface ConversationExecutionPacket {
  id: string;
  projectId: string;
  pairingId: string;
  instructionPacketId?: string;
  taskId: string;
  ok: boolean;
  output?: unknown;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  failureReason?: string;
  durationMs: number;
  createdAt: number;
}

function generateId(): string {
  return `exec-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class InMemoryConversationExecutionStore {
  private readonly packets = new Map<string, ConversationExecutionPacket>();

  create(params: Omit<ConversationExecutionPacket, 'id' | 'createdAt'>): ConversationExecutionPacket {
    const stored: ConversationExecutionPacket = {
      id: generateId(),
      projectId: params.projectId,
      pairingId: params.pairingId,
      instructionPacketId: params.instructionPacketId,
      taskId: params.taskId,
      ok: params.ok,
      output: params.output,
      stdout: params.stdout,
      stderr: params.stderr,
      exitCode: params.exitCode,
      failureReason: params.failureReason,
      durationMs: params.durationMs ?? 0,
      createdAt: Date.now(),
    };
    this.packets.set(stored.id, clone(stored));
    return clone(stored);
  }

  listByProject(projectId: string): ConversationExecutionPacket[] {
    return Array.from(this.packets.values())
      .filter(p => p.projectId === projectId)
      .sort((a, b) => a.createdAt - b.createdAt)
      .map(clone);
  }

  get(id: string): ConversationExecutionPacket | undefined {
    const packet = this.packets.get(id);
    return packet ? clone(packet) : undefined;
  }

  findByTaskId(taskId: string): ConversationExecutionPacket | undefined {
    for (const packet of this.packets.values()) {
      if (packet.taskId === taskId) return clone(packet);
    }
    return undefined;
  }

  exportPackets(): ConversationExecutionPacket[] {
    return Array.from(this.packets.values(), clone);
  }

  hydratePacket(packet: ConversationExecutionPacket): void {
    if (
      !packet ||
      typeof packet.id !== 'string' ||
      typeof packet.projectId !== 'string' ||
      typeof packet.pairingId !== 'string' ||
      typeof packet.taskId !== 'string' ||
      typeof packet.ok !== 'boolean' ||
      typeof packet.durationMs !== 'number' ||
      typeof packet.createdAt !== 'number'
    ) {
      return;
    }
    this.packets.set(packet.id, clone(packet));
  }
}
