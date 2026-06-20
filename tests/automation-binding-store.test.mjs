import assert from 'node:assert/strict';
import test from 'node:test';

import { InMemoryEndpointRegistry } from '../apps/local-server/src/endpoints/endpoint-registry.ts';
import { InMemoryAutomationBindingStore } from '../apps/local-server/src/storage/automation-binding-store.ts';

const now = 1793000000000;

const highReasoning = {
  id: 'codex-high',
  label: 'Codex High',
  transport: 'command',
  risk: 'medium',
  capabilities: {
    canAcceptPrompt: true,
    canReturnOutput: true,
    canReview: true,
    canExecute: false,
    canSummarize: true,
  },
};

const highReasoningSameProvider = {
  ...highReasoning,
  id: 'codex-high-profile-b',
  label: 'Codex High Profile B',
};

const mediumExecution = {
  id: 'codex-medium',
  label: 'Codex Medium',
  transport: 'command',
  risk: 'medium',
  capabilities: {
    canAcceptPrompt: true,
    canReturnOutput: true,
    canReview: true,
    canExecute: true,
    canSummarize: true,
  },
};

const lowExecution = {
  ...mediumExecution,
  id: 'claude-low',
  label: 'Claude Low',
};

const nonExecutingEndpoint = {
  ...mediumExecution,
  id: 'workbuddy',
  label: 'WorkBuddy',
  capabilities: {
    ...mediumExecution.capabilities,
    canExecute: false,
  },
};

function setup(extraEndpoints = []) {
  const registry = new InMemoryEndpointRegistry([
    highReasoning,
    highReasoningSameProvider,
    mediumExecution,
    lowExecution,
    nonExecutingEndpoint,
    ...extraEndpoints,
  ]);
  const projects = new Set(['cli-bridge', 'mobile-app']);
  const store = new InMemoryAutomationBindingStore({
    endpointRegistry: registry,
    projectExists(projectId) {
      return projects.has(projectId);
    },
  });
  return { store, registry, projects };
}

function validInput(overrides = {}) {
  return {
    goalId: 'goal-1',
    planId: 'plan-1',
    reasoningEndpointId: 'codex-high',
    executionEndpointId: 'codex-medium',
    reasoningTier: 'high',
    executionTier: 'medium',
    executionPermissionProfile: 'patch-proposal',
    executionWorkingDirectoryRef: 'cli-bridge',
    maxSteps: 4,
    maxReasoningRounds: 2,
    deadlineAt: '2026-06-21T00:00:00.000Z',
    now,
    ...overrides,
  };
}

test('creates bindings for freely paired compatible endpoints', () => {
  const { store } = setup();
  const binding = store.createBinding(validInput({
    reasoningEndpointId: 'codex-high',
    executionEndpointId: 'claude-low',
    executionTier: 'low',
  }));

  assert.equal(binding.reasoningEndpoint.id, 'codex-high');
  assert.equal(binding.executionEndpoint.id, 'claude-low');
  assert.equal(binding.executionTier, 'low');
  assert.match(binding.bindingHash, /^sha256:/);
});

test('creates bindings for separate profiles of the same provider', () => {
  const { store } = setup();
  const binding = store.createBinding(validInput({
    reasoningEndpointId: 'codex-high-profile-b',
    executionEndpointId: 'codex-medium',
  }));

  assert.equal(binding.reasoningEndpoint.id, 'codex-high-profile-b');
  assert.equal(binding.executionEndpoint.id, 'codex-medium');
});

test('rejects missing capabilities and tier mismatches', () => {
  const { store } = setup();

  assert.throws(
    () => store.createBinding(validInput({ executionEndpointId: 'workbuddy' })),
    /execution endpoint must have canExecute=true/,
  );
  assert.throws(
    () => store.createBinding(validInput({ reasoningTier: 'medium' })),
    /reasoningTier must be high/,
  );
  assert.throws(
    () => store.createBinding(validInput({ executionTier: 'high' })),
    /executionTier must be medium or low/,
  );
});

test('rejects unknown project reference and invalid limits', () => {
  const { store } = setup();

  assert.throws(
    () => store.createBinding(validInput({ executionWorkingDirectoryRef: 'missing-project' })),
    /project reference is unknown/,
  );
  assert.throws(
    () => store.createBinding(validInput({ maxSteps: 0 })),
    /maxSteps must be between 1 and 50/,
  );
  assert.throws(
    () => store.createBinding(validInput({ maxReasoningRounds: 0 })),
    /maxReasoningRounds must be between 1 and 20/,
  );
});

test('rejects hash mismatch on hydration', () => {
  const { store } = setup();
  const binding = store.createBinding(validInput());

  assert.equal(store.hydrateBinding({ ...binding, bindingHash: 'sha256:bad' }), false);
});

test('locks binding and rejects post-lock mutation', () => {
  const { store } = setup();
  const binding = store.createBinding(validInput());
  const locked = store.lockBinding(binding.planId, now + 1);

  assert.equal(locked.lockedAt, now + 1);
  assert.throws(
    () => store.updateBinding(binding.planId, { executionTier: 'low' }),
    /binding is locked/,
  );
});

test('derives endpoint changes into a new plan binding with lineage', () => {
  const { store } = setup();
  const binding = store.createBinding(validInput());
  store.lockBinding(binding.planId, now + 1);

  const derived = store.deriveBinding({
    parentPlanId: binding.planId,
    goalId: binding.goalId,
    planId: 'plan-2',
    executionEndpointId: 'claude-low',
    executionTier: 'low',
    now: now + 2,
  });

  assert.equal(derived.parentPlanId, binding.planId);
  assert.equal(derived.planId, 'plan-2');
  assert.equal(derived.executionEndpoint.id, 'claude-low');
  assert.equal(store.getBinding(binding.planId).executionEndpoint.id, 'codex-medium');
});

test('stores endpoint ids and resolved references without secret provider config or raw paths', () => {
  const secretEndpoint = {
    ...mediumExecution,
    id: 'secret-executor',
    apiKey: 'secret',
    rawConfig: { token: 'secret' },
  };
  const { store } = setup([secretEndpoint]);
  const binding = store.createBinding(validInput({
    executionEndpointId: 'secret-executor',
    executionWorkingDirectoryRef: 'cli-bridge',
  }));

  assert.deepEqual(binding.executionEndpoint, {
    id: 'secret-executor',
    label: 'Codex Medium',
    transport: 'command',
    capabilities: { canExecute: true },
  });
  assert.equal('apiKey' in binding.executionEndpoint, false);
  assert.equal(binding.executionWorkingDirectoryRef, 'cli-bridge');
});
