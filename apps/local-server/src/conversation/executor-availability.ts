// Executor availability model (ADR-0031 Task 2, updated ADR-0034).
// Determines whether an executor endpoint is ready to receive tasks before dispatch.
// ADR-0034: Distinguishes diagnostic readiness (channel reachable) from
// executor readiness (real worker registered and claiming tasks).

export interface ExecutorAvailability {
  endpointId: string;
  status: 'online' | 'offline' | 'unknown';
  lastSeenAt?: number;
  capabilities: string[];
  claimMode: 'push' | 'pull';
  /** ADR-0034: Real executor worker is registered and actively polling. */
  executorReady?: boolean;
}

export interface ResolveExecutorAvailabilityInput {
  endpoint: {
    id: string;
    transport: string;
    capabilities?: Record<string, boolean>;
  };
  workbuddyReady?: boolean;
  /** ADR-0034: Real executor has declared capabilities and is claiming tasks. */
  executorReady?: boolean;
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
      // ADR-0034: 'online' only when executorReady is true (real worker connected).
      // 'unknown' when channel is reachable but no real executor.
      status: input.executorReady ? 'online' : 'unknown',
      lastSeenAt: input.lastSeenAt,
      capabilities,
      claimMode,
      executorReady: input.executorReady ?? false,
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
