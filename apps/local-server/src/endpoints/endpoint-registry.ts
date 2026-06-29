import {
  assertAgentEndpoint,
} from '../../../../packages/shared/src/schemas.ts';
import type {
  AgentEndpoint,
  EndpointAction,
} from '../../../../packages/shared/src/types.ts';

export interface EndpointRegistryResult {
  ok: boolean;
  failureReason?: 'duplicate-endpoint-id' | 'endpoint-not-found' | 'capability-denied' | 'endpoint-offline' | 'endpoint-already-offline';
}

function cloneEndpoint(endpoint: AgentEndpoint): AgentEndpoint {
  return structuredClone(endpoint);
}

function capabilityForAction(endpoint: AgentEndpoint, action: EndpointAction): boolean {
  switch (action) {
    case 'accept-prompt':
      return endpoint.capabilities.canAcceptPrompt;
    case 'return-output':
      return endpoint.capabilities.canReturnOutput;
    case 'review':
      return endpoint.capabilities.canReview;
    case 'execute':
      return endpoint.capabilities.canExecute;
    case 'summarize':
      return endpoint.capabilities.canSummarize;
    case 'receive-inbound':
      return endpoint.capabilities.canReceiveInbound === true;
  }
}

export class InMemoryEndpointRegistry {
  private readonly endpoints = new Map<string, AgentEndpoint>();

  constructor(endpoints: AgentEndpoint[] = []) {
    for (const endpoint of endpoints) {
      this.register(endpoint);
    }
  }

  register(endpoint: AgentEndpoint): EndpointRegistryResult {
    assertAgentEndpoint(endpoint);
    if (this.endpoints.has(endpoint.id)) {
      // Duplicate endpointId — hard reject. Re-connection must use heartbeat,
      // not re-registration. Prevents external endpoints from silently
      // changing label, transport, or capabilities after initial registration.
      return {
        ok: false,
        failureReason: 'duplicate-endpoint-id',
      };
    }

    const created = cloneEndpoint(endpoint);
    created.status = 'online';
    created.lastSeenAt = Date.now();
    this.endpoints.set(endpoint.id, created);
    return {
      ok: true,
    };
  }

  get(endpointId: string): AgentEndpoint | undefined {
    const endpoint = this.endpoints.get(endpointId);
    return endpoint ? cloneEndpoint(endpoint) : undefined;
  }

  list(): AgentEndpoint[] {
    return Array.from(this.endpoints.values(), cloneEndpoint);
  }

  can(endpointId: string, action: EndpointAction): boolean {
    const endpoint = this.endpoints.get(endpointId);
    return endpoint ? capabilityForAction(endpoint, action) : false;
  }

  validateAction(endpointId: string, action: EndpointAction): EndpointRegistryResult {
    const endpoint = this.endpoints.get(endpointId);
    if (!endpoint) {
      return {
        ok: false,
        failureReason: 'endpoint-not-found',
      };
    }

    if (endpoint.status === 'offline') {
      return {
        ok: false,
        failureReason: 'endpoint-offline',
      };
    }

    if (!capabilityForAction(endpoint, action)) {
      return {
        ok: false,
        failureReason: 'capability-denied',
      };
    }

    return {
      ok: true,
    };
  }

  /**
   * Update an endpoint's heartbeat. Sets status to 'online' and refreshes
   * lastSeenAt. Rejects if the endpoint does not exist or is already offline.
   */
  heartbeat(endpointId: string): EndpointRegistryResult {
    const endpoint = this.endpoints.get(endpointId);
    if (!endpoint) {
      return { ok: false, failureReason: 'endpoint-not-found' };
    }
    if (endpoint.status === 'offline') {
      return { ok: false, failureReason: 'endpoint-offline' };
    }
    endpoint.status = 'online';
    endpoint.lastSeenAt = Date.now();
    this.endpoints.set(endpointId, cloneEndpoint(endpoint));
    return { ok: true };
  }

  /**
   * Mark an endpoint as offline with an optional reason.
   */
  offline(endpointId: string): EndpointRegistryResult {
    const endpoint = this.endpoints.get(endpointId);
    if (!endpoint) {
      return { ok: false, failureReason: 'endpoint-not-found' };
    }
    if (endpoint.status === 'offline') {
      return { ok: false, failureReason: 'endpoint-already-offline' };
    }
    endpoint.status = 'offline';
    endpoint.lastSeenAt = Date.now();
    this.endpoints.set(endpointId, cloneEndpoint(endpoint));
    return { ok: true };
  }

  /**
   * Return only endpoints with status === 'online'.
   */
  listOnline(): AgentEndpoint[] {
    return Array.from(this.endpoints.values())
      .filter(e => e.status === 'online')
      .map(cloneEndpoint);
  }

  /**
   * Return endpoints filtered by projectRef.
   */
  listByProject(projectRef: string): AgentEndpoint[] {
    return Array.from(this.endpoints.values())
      .filter(e => e.projectRef === projectRef)
      .map(cloneEndpoint);
  }
}
