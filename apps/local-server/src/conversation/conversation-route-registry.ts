import type { AgentEndpoint } from '../../../../packages/shared/src/types.ts';
import type {
  ConversationRouteAdapter,
  ConversationRouteResolution,
} from './conversation-route-adapter.ts';

function bridgeError(statusCode: number, message: string) {
  return { statusCode, payload: { status: 'error', message } };
}

const unsupportedAdapterMethods = {
  createAction() {
    return null;
  },
  confirm() {
    return bridgeError(409, 'Conversation route adapter is not implemented yet');
  },
  dispatch() {
    return bridgeError(409, 'Conversation route adapter is not implemented yet');
  },
};

const workbuddyExecutionAdapter: ConversationRouteAdapter = {
  id: 'workbuddy-execution',
  label: 'Execution task',
  canHandleTarget(endpoint) {
    return endpoint.transport === 'workbuddy' && !!endpoint.capabilities.canExecute;
  },
  statusForTarget() {
    return 'ready';
  },
  bridgeText(targetLabel) {
    return `${targetLabel} execution preview created.`;
  },
  ...unsupportedAdapterMethods,
};

const reviewCommandAdapter: ConversationRouteAdapter = {
  id: 'review-command',
  label: 'Review command',
  canHandleTarget(endpoint) {
    return endpoint.transport === 'command' && !!endpoint.capabilities.canReview;
  },
  statusForTarget() {
    return 'ready';
  },
  bridgeText(targetLabel) {
    return `${targetLabel} review preview created.`;
  },
  ...unsupportedAdapterMethods,
};

const adapters = [workbuddyExecutionAdapter, reviewCommandAdapter];

export function resolveConversationRouteAdapter(endpoint: AgentEndpoint): ConversationRouteResolution {
  const adapter = adapters.find(candidate => candidate.canHandleTarget(endpoint));
  if (adapter) {
    return { kind: adapter.id, status: adapter.statusForTarget(endpoint), adapter };
  }
  if (endpoint.transport === 'managed-pty' && endpoint.capabilities.canAcceptPrompt && endpoint.capabilities.canReturnOutput) {
    return { kind: 'managed-pty', status: 'not-implemented', adapter: null };
  }
  if (endpoint.transport === 'web-dom' && endpoint.capabilities.canAcceptPrompt && endpoint.capabilities.canReturnOutput) {
    return { kind: 'web-relay', status: 'needs-manual-confirmation', adapter: null };
  }
  return { kind: 'unavailable', status: 'not-implemented', adapter: null };
}
