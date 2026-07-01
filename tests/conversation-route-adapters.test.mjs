// Conversation Route Adapter unit tests.

import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveConversationRouteAdapter } from '../apps/local-server/src/conversation/conversation-route-registry.ts';

function endpoint(overrides) {
  return {
    id: 'endpoint',
    label: 'Endpoint',
    transport: 'web-dom',
    risk: 'low',
    status: 'online',
    capabilities: {
      canAcceptPrompt: false,
      canReturnOutput: false,
      canReview: false,
      canExecute: false,
      canSummarize: false,
    },
    ...overrides,
    capabilities: {
      canAcceptPrompt: false,
      canReturnOutput: false,
      canReview: false,
      canExecute: false,
      canSummarize: false,
      ...(overrides.capabilities || {}),
    },
  };
}

test('route adapter resolves executable workbuddy transport without endpoint id special case', () => {
  const target = endpoint({
    id: 'custom-executor',
    label: 'Custom Executor',
    transport: 'workbuddy',
    capabilities: { canExecute: true, canAcceptPrompt: true, canReturnOutput: true },
  });
  const route = resolveConversationRouteAdapter(target);
  assert.equal(route.kind, 'workbuddy-execution');
  assert.equal(route.status, 'ready');
  assert.equal(route.adapter.id, 'workbuddy-execution');
});

test('route adapter resolves command review endpoints by transport and canReview', () => {
  const target = endpoint({
    id: 'custom-reviewer',
    label: 'Custom Reviewer',
    transport: 'command',
    capabilities: { canReview: true },
  });
  const route = resolveConversationRouteAdapter(target);
  assert.equal(route.kind, 'review-command');
  assert.equal(route.status, 'ready');
  assert.equal(route.adapter.id, 'review-command');
});

test('route adapter leaves managed pty non-auto-dispatchable', () => {
  const target = endpoint({
    id: 'codex-pty',
    label: 'Codex PTY',
    transport: 'managed-pty',
    capabilities: { canAcceptPrompt: true, canReturnOutput: true },
  });
  const route = resolveConversationRouteAdapter(target);
  assert.equal(route.kind, 'managed-pty');
  assert.equal(route.status, 'not-implemented');
  assert.equal(route.adapter, null);
});

// ── Task 2: Real Adapter Methods ──

import { createBridgeRuntime } from '../apps/local-server/src/routes/bridge-api.ts';

test('workbuddy adapter creates and dispatches a target-specific task', async () => {
  const runtime = createBridgeRuntime();
  const target = endpoint({
    id: 'custom-executor',
    label: 'Custom Executor',
    transport: 'workbuddy',
    capabilities: { canExecute: true, canAcceptPrompt: true, canReturnOutput: true },
  });
  runtime.endpointRegistry.register(target);
  // Create a user transcript event so dispatch can look up the original text
  runtime.conversationTranscriptStore.append({
    id: 'u1',
    projectId: 'cli-bridge',
    pairingId: 'chatgpt-web→custom-executor',
    role: 'user',
    text: 'inspect this repository',
    status: 'queued',
    routeKind: 'workbuddy-execution',
  });
  const route = resolveConversationRouteAdapter(target);
  const action = route.adapter.createAction({
    runtime,
    projectId: 'cli-bridge',
    sourceEndpointId: 'chatgpt-web',
    targetEndpoint: target,
    userEventId: 'u1',
    bridgeEventId: 'b1',
    text: 'inspect this repository',
  });
  assert.equal(action.targetEndpointId, 'custom-executor');
  assert.equal(action.routeKind, 'workbuddy-execution');
  const confirmed = route.adapter.confirm({ runtime, action });
  assert.equal(confirmed.statusCode, 200);
  const dispatched = await route.adapter.dispatch({ runtime, action: confirmed.payload.action, request: {} });
  assert.equal(dispatched.statusCode, 200);
  assert.equal(dispatched.payload.task.endpointId, 'custom-executor');
  // Verify the inbox task prompt is the user's original text, not the preview
  const inbox = await runtime.workbuddyExecution.claimNext('custom-executor');
  assert.equal(inbox.prompt, 'inspect this repository');
});
