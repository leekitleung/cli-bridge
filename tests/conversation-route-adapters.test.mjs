// Conversation Route Adapter unit tests.

import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveConversationRouteAdapter } from '../apps/local-server/src/conversation/conversation-route-registry.ts';

function endpoint(overrides) {
  return {
    id: 'endpoint',
    label: 'Endpoint',
    transport: 'web-dom',
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
