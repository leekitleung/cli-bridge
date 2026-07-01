import type { AgentEndpoint } from '../../../../packages/shared/src/types.ts';
import type { ConversationRouteResolution, ConversationRouteAdapter } from './conversation-route-adapter.ts';

function bridgeOk(payload: unknown) {
  return { statusCode: 200, payload };
}

function bridgeError(statusCode: number, message: string) {
  return { statusCode, payload: { status: 'error', message } };
}

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
    return `${targetLabel} execution preview created. Auto-dispatch can queue this task from the local Console.`;
  },
  createAction(input) {
    return input.runtime.conversationActionStore.createPreview({
      projectId: input.projectId,
      sourceEndpointId: input.sourceEndpointId,
      targetEndpointId: input.targetEndpoint.id,
      routeKind: 'workbuddy-execution',
      userEventId: input.userEventId,
      bridgeEventId: input.bridgeEventId,
      text: input.text,
      preview: `${input.targetEndpoint.label} task preview`,
    });
  },
  confirm(input) {
    const confirmed = input.runtime.conversationActionStore.confirm(input.action.id);
    if (!confirmed) return bridgeError(409, 'Conversation action cannot be confirmed');
    input.runtime.persist();
    return bridgeOk({ action: confirmed });
  },
  dispatch(input) {
    if (input.action.status !== 'confirmed') return bridgeError(409, 'Conversation action must be confirmed before dispatch');
    const dispatching = input.runtime.conversationActionStore.markDispatching(input.action.id);
    if (!dispatching) return bridgeError(409, 'Conversation action cannot dispatch');
    const task = input.runtime.workbuddyExecution.enqueue({
      endpointId: input.action.targetEndpointId,
      proposalId: input.action.id,
      planId: `conversation:${input.action.projectId}`,
      goalId: `conversation:${input.action.projectId}`,
      bindingHash: input.action.textHash,
      prompt: input.action.preview,
      workingDirectory: process.cwd(),
      timeoutMs: 120_000,
    });
    const queued = input.runtime.conversationActionStore.markQueued(input.action.id, task.taskId);
    input.runtime.persist();
    return bridgeOk({ action: queued, task });
  },
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
    return `${targetLabel} review preview created. Auto-dispatch can run this governed review from the local Console.`;
  },
  createAction(input) {
    const review = input.runtime.pendingReviewStore.createDraft({
      sessionId: `conversation:${input.projectId}`,
      sourceEndpointId: input.sourceEndpointId,
      targetEndpointId: input.targetEndpoint.id,
      prompt: input.text,
      projectId: input.projectId,
    });
    const previewed = input.runtime.pendingReviewStore.preview(review.id) ?? review;
    return input.runtime.conversationActionStore.createPreview({
      projectId: input.projectId,
      sourceEndpointId: input.sourceEndpointId,
      targetEndpointId: input.targetEndpoint.id,
      routeKind: 'review-command',
      userEventId: input.userEventId,
      bridgeEventId: input.bridgeEventId,
      text: input.text,
      preview: `${input.targetEndpoint.label} review preview`,
      linkedReviewId: previewed.id,
    });
  },
  confirm(input) {
    if (!input.action.linkedReviewId) return bridgeError(409, 'Conversation action has no linked review');
    const confirmedReview = input.runtime.pendingReviewStore.confirm(input.action.linkedReviewId);
    if (!confirmedReview) return bridgeError(409, 'Linked review cannot be confirmed');
    const confirmedAction = input.runtime.conversationActionStore.confirm(input.action.id);
    if (!confirmedAction) return bridgeError(409, 'Conversation action cannot be confirmed');
    input.runtime.persist();
    return bridgeOk({ action: confirmedAction, review: confirmedReview });
  },
  async dispatch(input) {
    return bridgeError(409, 'Review command auto-dispatch is implemented in Task 4');
  },
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
