import {
  assertAgentEndpoint,
} from '../../../../packages/shared/src/schemas.ts';
import type {
  AgentEndpoint,
  EndpointAction,
} from '../../../../packages/shared/src/types.ts';

export interface EndpointRegistryResult {
  ok: boolean;
  failureReason?: 'duplicate-endpoint-id' | 'endpoint-not-found' | 'capability-denied';
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
      return {
        ok: false,
        failureReason: 'duplicate-endpoint-id',
      };
    }

    this.endpoints.set(endpoint.id, cloneEndpoint(endpoint));
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
}
