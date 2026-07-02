// Executor availability model (ADR-0031 Task 2).
// Determines whether an executor endpoint is ready to receive tasks before dispatch.

export interface ExecutorAvailability {
  endpointId: string;
  status: 'online' | 'offline' | 'unknown';
  lastSeenAt?: number;
  capabilities: string[];
  claimMode: 'push' | 'pull';
}

export interface ResolveExecutorAvailabilityInput {
  endpoint: {
    id: string;
    transport: string;
    capabilities?: Record<string, boolean>;
  };
  workbuddyReady?: boolean;
  lastSeenAt?: number;
  now: number;
}

export function resolveExecutorAvailability(
  input: ResolveExecutorAvailabilityInput,
): ExecutorAvailability {
  const claimMode = input.endpoint.transport === 'workbuddy' ? 'pull' : 'push';
  const capabilities = Object.entries(input.endpoint.capabilities ?? {})
    .filter(([, enabled]) => enabled)
    .map(([name]) => name);

  if (claimMode === 'pull') {
    return {
      endpointId: input.endpoint.id,
      status: input.workbuddyReady ? 'online' : 'unknown',
      lastSeenAt: input.lastSeenAt,
      capabilities,
      claimMode,
    };
  }

  return {
    endpointId: input.endpoint.id,
    status: 'online',
    lastSeenAt: input.lastSeenAt,
    capabilities,
    claimMode,
  };
}
