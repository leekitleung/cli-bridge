import assert from 'node:assert/strict';
import test from 'node:test';

import {
  InMemoryExecutionProposalStore,
} from '../apps/local-server/src/storage/execution-proposal-store.ts';
import {
  dispatchExecutionProposal,
} from '../apps/local-server/src/execution/execution-dispatcher.ts';
import {
  CODEX_REVIEW_ARGS,
} from '../apps/local-server/src/adapters/command-review-adapter.ts';
import {
  BRIDGE_AUTOMATION_BINDINGS_PATH,
  BRIDGE_EXECUTION_PROPOSALS_CONFIRM_PATH,
  BRIDGE_EXECUTION_PROPOSALS_DISPATCH_PATH,
  BRIDGE_EXECUTION_PROPOSALS_PATH,
  BRIDGE_GOALS_APPROVE_PATH,
  BRIDGE_GOALS_PATH,
  BRIDGE_GOALS_PLAN_PATH,
  createBridgeRuntime,
  handleBridgeRequest,
} from '../apps/local-server/src/routes/bridge-api.ts';
import { KNOWN_PROVIDER_CAPABILITIES } from '../apps/local-server/src/storage/provider-capability.ts';

function jsonRequest(body) {
  const text = body === undefined ? '' : JSON.stringify(body);
  async function* gen() {
    if (text.length > 0) yield Buffer.from(text, 'utf8');
  }
  return gen();
}

function sampleBinding(overrides = {}) {
  return {
    goalId: 'goal-1',
    planId: 'plan-1',
    reasoningEndpointId: 'chatgpt-web',
    executionEndpointId: 'codex-command',
    reasoningEndpoint: {
      id: 'chatgpt-web',
      label: 'ChatGPT Web',
      transport: 'web-dom',
      capabilities: { canExecute: false },
    },
    executionEndpoint: {
      id: 'codex-command',
      label: 'Codex',
      transport: 'command',
      capabilities: { canExecute: true },
    },
    reasoningTier: 'high',
    executionTier: 'medium',
    executionPermissionProfile: 'patch-proposal',
    executionWorkingDirectoryRef: 'cli-bridge',
    maxSteps: 4,
    maxReasoningRounds: 2,
    deadlineAt: '2026-06-21T00:00:00.000Z',
    createdAt: 1793000000000,
    updatedAt: 1793000000001,
    lockedAt: 1793000000002,
    bindingHash: 'sha256:binding',
    ...overrides,
  };
}

function samplePlan(overrides = {}) {
  const targetEndpointId = overrides.targetEndpointId ?? 'codex-command';
  return {
    id: 'plan-1',
    goalId: 'goal-1',
    status: 'approved',
    permittedTiers: ['patch-proposal'],
    steps: [{
      id: 'step-1',
      planId: 'plan-1',
      index: 0,
      intent: 'Create bounded patch proposal',
      kind: 'propose-patch',
      targetEndpointId,
      tier: 'patch-proposal',
      isStateMutating: false,
      status: 'pending',
    }],
    createdAt: 1793000000000,
    updatedAt: 1793000000001,
    approvedAt: 1793000000002,
    ...overrides,
  };
}

function okRun(stdout) {
  return { exitCode: 0, stdout, stderr: '', timedOut: false };
}

function fakeLauncherResolver(command) {
  return { executable: `/fake/${command}`, prependArgs: [] };
}

function routePlanJson(goalId) {
  return JSON.stringify({
    id: `plan-${goalId}`,
    goalId,
    status: 'awaiting-approval',
    permittedTiers: ['patch-proposal'],
    steps: [{
      id: 'step-1',
      planId: `plan-${goalId}`,
      index: 0,
      intent: 'Create bounded patch proposal',
      kind: 'propose-patch',
      targetEndpointId: 'codex-medium',
      tier: 'patch-proposal',
      isStateMutating: false,
      status: 'pending',
    }],
    createdAt: 1793000000000,
    updatedAt: 1793000000001,
  });
}

const codexMediumEndpoint = {
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

function sampleArtifact(overrides = {}) {
  return {
    artifactId: 'artifact-1',
    goalId: 'goal-1',
    planId: 'plan-1',
    endpointId: 'chatgpt-web',
    bindingHash: 'sha256:binding',
    kind: 'execution-proposal',
    contentHash: 'sha256:artifact-content',
    summary: 'Run a bounded patch proposal',
    createdAt: '2026-06-20T12:00:00.000Z',
    ...overrides,
  };
}

function createProposal(store, overrides = {}) {
  return store.createDraft({
    binding: sampleBinding(overrides.binding),
    plan: samplePlan(overrides.plan),
    stepId: overrides.stepId ?? 'step-1',
    artifact: sampleArtifact(overrides.artifact),
    preview: overrides.preview ?? 'codex exec -s read-only --json -',
    command: overrides.command ?? 'codex',
    args: overrides.args ?? [...CODEX_REVIEW_ARGS],
    stdin: overrides.stdin ?? 'Create a patch proposal only.',
    expiresAt: overrides.expiresAt ?? 1793003600000,
    now: overrides.now ?? 1793000000003,
  });
}

test('execution proposal store enforces transition lifecycle and single-use confirmation', () => {
  const store = new InMemoryExecutionProposalStore();

  const draft = createProposal(store);
  assert.equal(draft.status, 'draft');
  assert.match(draft.contentHash, /^sha256:/);
  assert.notEqual(draft.contentHash, 'sha256:artifact-content');
  assert.equal(draft.executionEndpointId, 'codex-command');
  assert.equal('apiKey' in draft, false);
  assert.equal('rawProviderOutput' in draft, false);

  const awaiting = store.requestConfirmation(draft.id, 1793000000004);
  assert.equal(awaiting.status, 'awaiting-confirmation');

  const confirmed = store.confirm({
    proposalId: draft.id,
    planId: 'plan-1',
    stepId: 'step-1',
    artifactId: 'artifact-1',
    contentHash: draft.contentHash,
    bindingHash: 'sha256:binding',
    executionEndpointId: 'codex-command',
    executionPermissionProfile: 'patch-proposal',
    projectId: 'cli-bridge',
    now: 1793000000005,
  });
  assert.equal(confirmed.ok, true);
  assert.equal(confirmed.proposal.status, 'confirmed');
  assert.equal(store.confirm({
    proposalId: draft.id,
    planId: 'plan-1',
    stepId: 'step-1',
    artifactId: 'artifact-1',
    contentHash: draft.contentHash,
    bindingHash: 'sha256:binding',
    executionEndpointId: 'codex-command',
    executionPermissionProfile: 'patch-proposal',
    projectId: 'cli-bridge',
    now: 1793000000006,
  }).ok, false);

  assert.equal(store.markDispatching(draft.id, 1793000000007).status, 'dispatching');
  assert.equal(store.markReturned(draft.id, { stdout: 'ok', stderr: '', exitCode: 0 }, 1793000000008).status, 'returned');
});

test('execution proposal content hash binds artifact and actual dispatch payload', () => {
  const store = new InMemoryExecutionProposalStore();
  const first = createProposal(store);
  const changedStdin = createProposal(store, {
    artifact: { artifactId: 'artifact-changed-stdin' },
    stdin: 'Different bounded patch proposal.',
  });
  const changedArgs = createProposal(store, {
    artifact: { artifactId: 'artifact-changed-args' },
    args: [...CODEX_REVIEW_ARGS, '--color', 'never'],
  });
  const changedPreview = createProposal(store, {
    artifact: { artifactId: 'artifact-changed-preview' },
    preview: 'Different visible proposal preview',
  });

  assert.notEqual(first.contentHash, first.artifactId);
  assert.notEqual(first.contentHash, changedStdin.contentHash);
  assert.notEqual(first.contentHash, changedArgs.contentHash);
  assert.notEqual(first.contentHash, changedPreview.contentHash);
});

test('execution proposal confirmation rejects stale, edited, wrong binding, expired, cancelled, and paused inputs', () => {
  const store = new InMemoryExecutionProposalStore();
  const base = createProposal(store);
  store.requestConfirmation(base.id, 1793000000004);

  assert.equal(store.confirm({
    proposalId: base.id,
    planId: 'other-plan',
    stepId: 'step-1',
    artifactId: 'artifact-1',
    contentHash: base.contentHash,
    bindingHash: 'sha256:binding',
    executionEndpointId: 'codex-command',
    executionPermissionProfile: 'patch-proposal',
    projectId: 'cli-bridge',
    now: 1793000000005,
  }).failureReason, 'confirmation-plan-mismatch');

  assert.equal(store.confirm({
    proposalId: base.id,
    planId: 'plan-1',
    stepId: 'step-1',
    artifactId: 'artifact-1',
    contentHash: 'sha256:edited',
    bindingHash: 'sha256:binding',
    executionEndpointId: 'codex-command',
    executionPermissionProfile: 'patch-proposal',
    projectId: 'cli-bridge',
    now: 1793000000005,
  }).failureReason, 'confirmation-content-mismatch');

  assert.equal(store.confirm({
    proposalId: base.id,
    planId: 'plan-1',
    stepId: 'step-1',
    artifactId: 'artifact-1',
    contentHash: base.contentHash,
    bindingHash: 'sha256:other-binding',
    executionEndpointId: 'codex-command',
    executionPermissionProfile: 'patch-proposal',
    projectId: 'cli-bridge',
    now: 1793000000005,
  }).failureReason, 'confirmation-binding-mismatch');

  assert.equal(store.confirm({
    proposalId: base.id,
    planId: 'plan-1',
    stepId: 'step-1',
    artifactId: 'artifact-1',
    contentHash: base.contentHash,
    bindingHash: 'sha256:binding',
    executionEndpointId: 'codex-command',
    executionPermissionProfile: 'patch-proposal',
    projectId: 'cli-bridge',
    now: 1793003600001,
  }).failureReason, 'confirmation-expired');

  const cancelled = createProposal(store, { artifact: { artifactId: 'artifact-cancelled' } });
  store.requestConfirmation(cancelled.id, 1793000000004);
  store.cancel(cancelled.id, 1793000000005);
  assert.equal(store.confirm({
    proposalId: cancelled.id,
    planId: 'plan-1',
    stepId: 'step-1',
    artifactId: 'artifact-cancelled',
    contentHash: cancelled.contentHash,
    bindingHash: 'sha256:binding',
    executionEndpointId: 'codex-command',
    executionPermissionProfile: 'patch-proposal',
    projectId: 'cli-bridge',
    now: 1793000000006,
  }).failureReason, 'proposal-cancelled');

  const paused = createProposal(store, { artifact: { artifactId: 'artifact-paused' } });
  store.requestConfirmation(paused.id, 1793000000004);
  store.pause(paused.id, 'manual-pause', 1793000000005);
  assert.equal(store.confirm({
    proposalId: paused.id,
    planId: 'plan-1',
    stepId: 'step-1',
    artifactId: 'artifact-paused',
    contentHash: paused.contentHash,
    bindingHash: 'sha256:binding',
    executionEndpointId: 'codex-command',
    executionPermissionProfile: 'patch-proposal',
    projectId: 'cli-bridge',
    now: 1793000000006,
  }).failureReason, 'proposal-paused');
});

test('editing a proposal creates a new proposal id and invalidates old confirmation', () => {
  const store = new InMemoryExecutionProposalStore();
  const first = createProposal(store);
  store.requestConfirmation(first.id, 1793000000004);

  const edited = store.edit(first.id, {
    preview: 'codex exec -s read-only --json - with revised prompt',
    stdin: 'Revised patch proposal only.',
    artifact: sampleArtifact({ artifactId: 'artifact-2', contentHash: 'sha256:artifact-content-2' }),
    now: 1793000000005,
  });

  assert.notEqual(edited.id, first.id);
  assert.equal(store.get(first.id).status, 'cancelled');
  assert.equal(store.confirm({
    proposalId: first.id,
    planId: 'plan-1',
    stepId: 'step-1',
    artifactId: 'artifact-1',
    contentHash: first.contentHash,
    bindingHash: 'sha256:binding',
    executionEndpointId: 'codex-command',
    executionPermissionProfile: 'patch-proposal',
    projectId: 'cli-bridge',
    now: 1793000000006,
  }).ok, false);
});

test('dispatch only uses locked execution endpoint through bounded adapter and pauses uncertainty', async () => {
  const store = new InMemoryExecutionProposalStore();
  const proposal = createProposal(store);
  store.requestConfirmation(proposal.id, 1793000000004);
  const confirmed = store.confirm({
    proposalId: proposal.id,
    planId: 'plan-1',
    stepId: 'step-1',
    artifactId: 'artifact-1',
    contentHash: proposal.contentHash,
    bindingHash: 'sha256:binding',
    executionEndpointId: 'codex-command',
    executionPermissionProfile: 'patch-proposal',
    projectId: 'cli-bridge',
    now: 1793000000005,
  }).proposal;

  const calls = [];
  const result = await dispatchExecutionProposal({
    store,
    proposalId: confirmed.id,
    binding: sampleBinding(),
    plan: samplePlan(),
    providerCapability: KNOWN_PROVIDER_CAPABILITIES.codex,
    now: 1793000000006,
    runner: {
      async run(execution, launcher) {
        calls.push({ execution, launcher });
        return { exitCode: 0, stdout: 'patch proposal', stderr: '', timedOut: false };
      },
    },
    launcherResolver(command) {
      return { executable: `/fake/${command}`, prependArgs: [] };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(store.get(confirmed.id).status, 'returned');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].execution.command, 'codex');
  assert.deepEqual(calls[0].execution.args, CODEX_REVIEW_ARGS);

  const uncertain = createProposal(store, { artifact: { artifactId: 'artifact-timeout' } });
  store.requestConfirmation(uncertain.id, 1793000000007);
  store.confirm({
    proposalId: uncertain.id,
    planId: 'plan-1',
    stepId: 'step-1',
    artifactId: 'artifact-timeout',
    contentHash: uncertain.contentHash,
    bindingHash: 'sha256:binding',
    executionEndpointId: 'codex-command',
    executionPermissionProfile: 'patch-proposal',
    projectId: 'cli-bridge',
    now: 1793000000008,
  });
  const timeout = await dispatchExecutionProposal({
    store,
    proposalId: uncertain.id,
    binding: sampleBinding(),
    plan: samplePlan(),
    providerCapability: KNOWN_PROVIDER_CAPABILITIES.codex,
    now: 1793000000009,
    runner: {
      async run() {
        return { exitCode: null, stdout: '', stderr: '', timedOut: true };
      },
    },
    launcherResolver(command) {
      return { executable: `/fake/${command}`, prependArgs: [] };
    },
  });
  assert.equal(timeout.ok, false);
  assert.equal(store.get(uncertain.id).status, 'paused');
});

test('dispatch rejects WorkBuddy and arbitrary command or argv input', async () => {
  const store = new InMemoryExecutionProposalStore();
  const workbuddy = createProposal(store, {
    binding: {
      executionEndpointId: 'workbuddy',
      executionEndpoint: {
        id: 'workbuddy',
        label: 'WorkBuddy',
        transport: 'mock',
        capabilities: { canExecute: false },
      },
    },
    plan: { targetEndpointId: 'workbuddy' },
    command: 'codex',
    artifact: { artifactId: 'artifact-workbuddy' },
  });
  store.requestConfirmation(workbuddy.id, 1793000000004);
  store.confirm({
    proposalId: workbuddy.id,
    planId: 'plan-1',
    stepId: 'step-1',
    artifactId: 'artifact-workbuddy',
    contentHash: workbuddy.contentHash,
    bindingHash: 'sha256:binding',
    executionEndpointId: 'workbuddy',
    executionPermissionProfile: 'patch-proposal',
    projectId: 'cli-bridge',
    now: 1793000000005,
  });

  const rejected = await dispatchExecutionProposal({
    store,
    proposalId: workbuddy.id,
    binding: sampleBinding({
      executionEndpointId: 'workbuddy',
      executionEndpoint: {
        id: 'workbuddy',
        label: 'WorkBuddy',
        transport: 'mock',
        capabilities: { canExecute: false },
      },
    }),
    plan: samplePlan(),
    providerCapability: KNOWN_PROVIDER_CAPABILITIES.workbuddy,
    now: 1793000000006,
    runner: {
      async run() {
        throw new Error('must not run');
      },
    },
    launcherResolver(command) {
      return { executable: `/fake/${command}`, prependArgs: [] };
    },
  });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.failureReason, 'execution-endpoint-cannot-execute');

  const wrongCommand = createProposal(store, {
    artifact: { artifactId: 'artifact-wrong-command' },
    command: 'claude',
    args: ['-p'],
  });
  store.requestConfirmation(wrongCommand.id, 1793000000007);
  store.confirm({
    proposalId: wrongCommand.id,
    planId: 'plan-1',
    stepId: 'step-1',
    artifactId: 'artifact-wrong-command',
    contentHash: wrongCommand.contentHash,
    bindingHash: 'sha256:binding',
    executionEndpointId: 'codex-command',
    executionPermissionProfile: 'patch-proposal',
    projectId: 'cli-bridge',
    now: 1793000000008,
  });
  const wrongCommandResult = await dispatchExecutionProposal({
    store,
    proposalId: wrongCommand.id,
    binding: sampleBinding(),
    plan: samplePlan(),
    providerCapability: KNOWN_PROVIDER_CAPABILITIES.codex,
  });
  assert.equal(wrongCommandResult.failureReason, 'proposal-command-mismatch');

  const arbitraryArgs = createProposal(store, {
    artifact: { artifactId: 'artifact-arbitrary-args' },
    args: [...CODEX_REVIEW_ARGS, '--color', 'never'],
  });
  store.requestConfirmation(arbitraryArgs.id, 1793000000009);
  store.confirm({
    proposalId: arbitraryArgs.id,
    planId: 'plan-1',
    stepId: 'step-1',
    artifactId: 'artifact-arbitrary-args',
    contentHash: arbitraryArgs.contentHash,
    bindingHash: 'sha256:binding',
    executionEndpointId: 'codex-command',
    executionPermissionProfile: 'patch-proposal',
    projectId: 'cli-bridge',
    now: 1793000000010,
  });
  const arbitraryArgsResult = await dispatchExecutionProposal({
    store,
    proposalId: arbitraryArgs.id,
    binding: sampleBinding(),
    plan: samplePlan(),
    providerCapability: KNOWN_PROVIDER_CAPABILITIES.codex,
  });
  assert.equal(arbitraryArgsResult.failureReason, 'proposal-argv-mismatch');

  assert.throws(() => createProposal(new InMemoryExecutionProposalStore(), {
    command: 'bash',
  }), /command-not-allowlisted/);
  assert.throws(() => createProposal(new InMemoryExecutionProposalStore(), {
    args: ['exec', '--dangerously-bypass-approvals-and-sandbox'],
  }), /forbidden-arg/);
});

test('execution proposal routes create, confirm, dispatch, and reject replay', async () => {
  const runtime = createBridgeRuntime({
    additionalEndpoints: [codexMediumEndpoint],
    goalPlanCommandOptions: {
      runner: {
        async run(execution) {
          const match = (execution.stdin ?? '').match(/Goal ID:\s*([a-f0-9-]+)/i);
          return okRun(routePlanJson(match ? match[1] : 'goal-unknown'));
        },
      },
      launcherResolver: fakeLauncherResolver,
    },
    commandRunOptions: {
      runner: {
        async run() {
          return { exitCode: 0, stdout: 'route patch proposal', stderr: '', timedOut: false };
        },
      },
      launcherResolver: fakeLauncherResolver,
    },
  });

  const goal = await handleBridgeRequest(runtime, 'POST', BRIDGE_GOALS_PATH, jsonRequest({
    sessionId: 's-execution-proposal',
    description: 'Create bounded execution proposal',
    projectId: 'cli-bridge',
  }));
  const goalId = goal.payload.goal.id;
  const planned = await handleBridgeRequest(runtime, 'POST', BRIDGE_GOALS_PLAN_PATH, jsonRequest({ goalId }));
  const plan = planned.payload.plan;
  await handleBridgeRequest(runtime, 'POST', BRIDGE_AUTOMATION_BINDINGS_PATH, jsonRequest({
    goalId,
    planId: plan.id,
    reasoningEndpointId: 'chatgpt-web',
    executionEndpointId: 'codex-medium',
    reasoningTier: 'high',
    executionTier: 'medium',
    executionPermissionProfile: 'patch-proposal',
    executionWorkingDirectoryRef: 'cli-bridge',
    maxSteps: 4,
    maxReasoningRounds: 2,
    deadlineAt: '2026-06-21T00:00:00.000Z',
  }));
  await handleBridgeRequest(runtime, 'POST', BRIDGE_GOALS_APPROVE_PATH, jsonRequest({ goalId }));

  const artifact = {
    artifactId: 'artifact-route-1',
    goalId,
    planId: plan.id,
    endpointId: 'chatgpt-web',
    bindingHash: runtime.automationBindingStore.getBinding(plan.id).bindingHash,
    kind: 'execution-proposal',
    contentHash: 'sha256:route-content',
    summary: 'Route proposal',
    createdAt: '2026-06-20T12:00:00.000Z',
  };
  runtime.reasoningArtifactStore.record(artifact);

  const created = await handleBridgeRequest(runtime, 'POST', BRIDGE_EXECUTION_PROPOSALS_PATH, jsonRequest({
    planId: plan.id,
    stepId: plan.steps[0].id,
    artifactId: artifact.artifactId,
    preview: 'codex exec -s read-only --json -',
    command: 'codex',
    args: [...CODEX_REVIEW_ARGS],
    stdin: 'Create a patch proposal only.',
    expiresAt: 1893000000000,
  }));
  assert.equal(created.statusCode, 201);
  assert.equal(created.payload.proposal.status, 'awaiting-confirmation');

  const confirm = await handleBridgeRequest(runtime, 'POST', BRIDGE_EXECUTION_PROPOSALS_CONFIRM_PATH, jsonRequest({
    proposalId: created.payload.proposal.id,
    planId: plan.id,
    stepId: plan.steps[0].id,
    artifactId: artifact.artifactId,
    contentHash: created.payload.proposal.contentHash,
    bindingHash: artifact.bindingHash,
    executionEndpointId: 'codex-medium',
    executionPermissionProfile: 'patch-proposal',
    projectId: 'cli-bridge',
  }));
  assert.equal(confirm.statusCode, 200);
  assert.equal(confirm.payload.proposal.status, 'confirmed');

  const dispatch = await handleBridgeRequest(runtime, 'POST', BRIDGE_EXECUTION_PROPOSALS_DISPATCH_PATH, jsonRequest({
    proposalId: created.payload.proposal.id,
  }));
  assert.equal(dispatch.statusCode, 200);
  assert.equal(dispatch.payload.proposal.status, 'returned');

  const replay = await handleBridgeRequest(runtime, 'POST', BRIDGE_EXECUTION_PROPOSALS_DISPATCH_PATH, jsonRequest({
    proposalId: created.payload.proposal.id,
  }));
  assert.equal(replay.statusCode, 409);
});
