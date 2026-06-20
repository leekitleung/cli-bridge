import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BRIDGE_AUTOMATION_BINDINGS_PATH,
  BRIDGE_EXTRACT_RETURN_PATH,
  BRIDGE_GOALS_APPROVE_PATH,
  BRIDGE_GOALS_PATH,
  BRIDGE_GOALS_PLAN_PATH,
  BRIDGE_REVIEWS_CONFIRM_PATH,
  BRIDGE_REVIEWS_PATH,
  BRIDGE_REVIEWS_RUN_PATH,
  createBridgeRuntime,
  handleBridgeRequest,
} from '../apps/local-server/src/routes/bridge-api.ts';
import {
  normalizeReasoningArtifact,
  normalizeChatGptReturnArtifact,
} from '../apps/local-server/src/reasoning/reasoning-artifact.ts';
import { validateReasoningArtifact } from '../packages/shared/src/schemas.ts';

const nowIso = '2026-06-20T12:00:00.000Z';

const plan = {
  id: 'plan-1',
  goalId: 'goal-1',
  status: 'approved',
  permittedTiers: ['patch-proposal'],
  steps: [],
  createdAt: 1793000000000,
  updatedAt: 1793000000001,
  approvedAt: 1793000000002,
};

const binding = {
  goalId: 'goal-1',
  planId: 'plan-1',
  reasoningEndpointId: 'chatgpt-web',
  executionEndpointId: 'codex-medium',
  reasoningEndpoint: {
    id: 'chatgpt-web',
    label: 'ChatGPT Web',
    transport: 'web-dom',
    capabilities: { canExecute: false },
  },
  executionEndpoint: {
    id: 'codex-medium',
    label: 'Codex Medium',
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
};

const equivalentDraft = {
  steps: [{
    intent: 'Review implementation',
    kind: 'review',
    tier: 'patch-proposal',
    isStateMutating: false,
    targetEndpointId: 'codex-medium',
  }],
};

function jsonRequest(body) {
  const text = body === undefined ? '' : JSON.stringify(body);
  async function* gen() {
    if (text.length > 0) yield Buffer.from(text, 'utf8');
  }
  return gen();
}

function okRun(stdout) {
  return { exitCode: 0, stdout, stderr: '', timedOut: false };
}

function fakeLauncherResolver(command) {
  return { executable: `/fake/${command}`, prependArgs: [] };
}

const codexMedium = {
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

const claudeReasoning = {
  id: 'claude-code-command',
  label: 'Claude High Reasoning',
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

function fakePlanJson(goalId) {
  return JSON.stringify({
    id: `plan-${goalId}`,
    goalId,
    status: 'awaiting-approval',
    permittedTiers: ['patch-proposal'],
    steps: [{
      id: 'step-1',
      planId: `plan-${goalId}`,
      index: 0,
      intent: 'Review the implementation',
      kind: 'review',
      targetEndpointId: 'claude-code-command',
      tier: 'patch-proposal',
      isStateMutating: false,
      status: 'pending',
    }],
    createdAt: 1793000000000,
    updatedAt: 1793000000001,
  });
}

function fakeReviewAdapter(result) {
  return {
    name: 'fake-review',
    async review(input) {
      return {
        ok: true,
        adapterName: 'fake-review',
        result: {
          id: input.resultId ?? 'review-result-1',
          reviewRequestId: input.reviewRequestId,
          summary: result.summary,
          findings: result.findings,
          createdAt: input.now ?? Date.now(),
        },
        meta: { command: 'claude', argv: [], exitCode: 0, durationMs: 1, timedOut: false, truncated: false },
      };
    },
  };
}

function mockProvider() {
  return {
    async plan(input) {
      return {
        ok: true,
        draft: {
          steps: [{
            intent: 'Review implementation',
            kind: 'review',
            tier: 'patch-proposal',
            isStateMutating: false,
            targetEndpointId: input.endpoints[0].id,
          }],
          rationale: 'bounded',
        },
        provider: 'mock/model',
        usage: { promptTokens: 10, completionTokens: 5 },
        latencyMs: 1,
      };
    },
  };
}

function runtimeForArtifacts(reasoningEndpoint = 'chatgpt-web', overrides = {}) {
  return createBridgeRuntime({
    additionalEndpoints: [codexMedium],
    modelProviderFactory: () => mockProvider(),
    reviewAdapterFor: () => fakeReviewAdapter({ summary: 'reviewed', findings: [] }),
    goalPlanCommandOptions: {
      runner: {
        async run(execution) {
          const match = (execution.stdin ?? '').match(/Goal ID:\s*([a-f0-9-]+)/i);
          return okRun(fakePlanJson(match ? match[1] : 'goal-unknown'));
        },
      },
      launcherResolver: fakeLauncherResolver,
    },
    ...overrides,
  });
}

async function createLockedPlanBinding(runtime, reasoningEndpointId = 'chatgpt-web') {
  const goal = await handleBridgeRequest(runtime, 'POST', BRIDGE_GOALS_PATH, jsonRequest({
    sessionId: 's-artifact',
    description: 'Create reasoning artifact',
    projectId: 'cli-bridge',
  }));
  assert.equal(goal.statusCode, 201);
  const goalId = goal.payload.goal.id;
  const plan = await handleBridgeRequest(runtime, 'POST', BRIDGE_GOALS_PLAN_PATH, jsonRequest({ goalId }));
  assert.equal(plan.statusCode, 201);
  const planId = plan.payload.plan.id;
  const binding = await handleBridgeRequest(runtime, 'POST', BRIDGE_AUTOMATION_BINDINGS_PATH, jsonRequest({
    goalId,
    planId,
    reasoningEndpointId,
    executionEndpointId: 'codex-medium',
    reasoningTier: 'high',
    executionTier: 'medium',
    executionPermissionProfile: 'patch-proposal',
    executionWorkingDirectoryRef: 'cli-bridge',
    maxSteps: 4,
    maxReasoningRounds: 2,
    deadlineAt: '2026-06-21T00:00:00.000Z',
  }));
  assert.equal(binding.statusCode, 201);
  const approved = await handleBridgeRequest(runtime, 'POST', BRIDGE_GOALS_APPROVE_PATH, jsonRequest({ goalId }));
  assert.equal(approved.statusCode, 200);
  return { goalId, planId };
}

test('CLI and ChatGPT plan drafts normalize to the same reasoning artifact envelope', () => {
  const cli = normalizeReasoningArtifact({
    binding,
    plan,
    endpointId: 'chatgpt-web',
    kind: 'plan-draft',
    content: equivalentDraft,
    summary: 'Drafted one review step',
    createdAt: nowIso,
  });
  const web = normalizeChatGptReturnArtifact({
    binding,
    plan,
    endpointId: 'chatgpt-web',
    kind: 'plan-draft',
    sanitizedContent: equivalentDraft,
    summary: 'Drafted one review step',
    createdAt: nowIso,
  });

  assert.equal(cli.ok, true);
  assert.equal(web.ok, true);
  assert.deepEqual(cli.artifact, web.artifact);
  assert.equal(validateReasoningArtifact(cli.artifact).ok, true);
});

test('review results normalize without granting execution authority', () => {
  const normalized = normalizeReasoningArtifact({
    binding,
    plan,
    endpointId: 'chatgpt-web',
    kind: 'review-result',
    content: { summary: 'Looks bounded', findings: [] },
    summary: 'Looks bounded',
    createdAt: nowIso,
  });

  assert.equal(normalized.ok, true);
  assert.equal(normalized.artifact.kind, 'review-result');
  assert.equal(normalized.artifact.endpointId, 'chatgpt-web');
  assert.equal('executionEndpointId' in normalized.artifact, false);
});

test('reasoning artifact rejects executor selection and authority fields', () => {
  const rejected = normalizeReasoningArtifact({
    binding,
    plan,
    endpointId: 'chatgpt-web',
    kind: 'execution-proposal',
    content: {
      task: 'Run this',
      executionEndpointId: 'other-executor',
      executable: 'bash',
      argv: ['-lc', 'echo unsafe'],
      approved: true,
    },
    summary: 'Unsafe proposal',
    createdAt: nowIso,
  });

  assert.equal(rejected.ok, false);
  assert.match(rejected.failureReason, /forbidden/i);
});

test('reasoning artifact rejects unlocked, wrong-plan, wrong-endpoint, and oversize content', () => {
  assert.equal(normalizeReasoningArtifact({
    binding: { ...binding, lockedAt: undefined },
    plan,
    endpointId: 'chatgpt-web',
    kind: 'plan-draft',
    content: equivalentDraft,
    summary: 'draft',
    createdAt: nowIso,
  }).ok, false);

  assert.equal(normalizeReasoningArtifact({
    binding,
    plan: { ...plan, id: 'other-plan' },
    endpointId: 'chatgpt-web',
    kind: 'plan-draft',
    content: equivalentDraft,
    summary: 'draft',
    createdAt: nowIso,
  }).ok, false);

  assert.equal(normalizeReasoningArtifact({
    binding,
    plan,
    endpointId: 'codex-medium',
    kind: 'plan-draft',
    content: equivalentDraft,
    summary: 'draft',
    createdAt: nowIso,
  }).ok, false);

  assert.equal(normalizeReasoningArtifact({
    binding,
    plan,
    endpointId: 'chatgpt-web',
    kind: 'plan-draft',
    content: 'x'.repeat(80_000),
    summary: 'too large',
    createdAt: nowIso,
    maxContentBytes: 1024,
  }).ok, false);
});

test('model-api plan route can produce a locked-plan reasoning artifact', async () => {
  const runtime = runtimeForArtifacts();
  const { goalId, planId } = await createLockedPlanBinding(runtime, 'chatgpt-web');

  const res = await handleBridgeRequest(runtime, 'POST', BRIDGE_GOALS_PLAN_PATH, jsonRequest({
    goalId,
    planId,
    plannerSource: 'model-api',
    apiKey: 'sk-test-key',
    availableEndpoints: ['codex-medium'],
  }));

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.artifact.kind, 'plan-draft');
  assert.equal(res.payload.artifact.planId, planId);
  assert.equal(runtime.reasoningArtifactStore.list().length, 1);
});

test('ChatGPT extract-return can produce a correlated reasoning artifact', async () => {
  const runtime = runtimeForArtifacts('chatgpt-web', { inboundRelayEndpointId: 'mock-inbound-agent' });
  const { planId } = await createLockedPlanBinding(runtime, 'chatgpt-web');
  const sessionId = 's-chatgpt-artifact';

  const outbound = await handleBridgeRequest(runtime, 'POST', '/bridge/outbound', jsonRequest({
    sessionId,
    prompt: 'review this',
  }));
  const claim = await handleBridgeRequest(runtime, 'GET', '/bridge/outbound/next', jsonRequest());
  await handleBridgeRequest(runtime, 'POST', '/bridge/outbound/ack', jsonRequest({
    outboundPromptId: outbound.payload.outboundPrompt.id,
    claimToken: claim.payload.outboundPrompt.claimToken,
    ok: true,
  }));

  const extract = await handleBridgeRequest(runtime, 'POST', BRIDGE_EXTRACT_RETURN_PATH, jsonRequest({
    sessionId,
    operationId: outbound.payload.outboundPrompt.id,
    content: 'sanitized reviewed reply',
    planId,
    artifactKind: 'review-result',
    summary: 'ChatGPT reviewed the plan',
  }));

  assert.equal(extract.statusCode, 201);
  assert.equal(extract.payload.routedTo, 'inbound');
  assert.equal(extract.payload.artifact.kind, 'review-result');
  assert.equal(extract.payload.artifact.endpointId, 'chatgpt-web');
});

test('ChatGPT extract-return operation mismatch records no reasoning artifact', async () => {
  const runtime = runtimeForArtifacts('chatgpt-web', { inboundRelayEndpointId: 'mock-inbound-agent' });
  const { planId } = await createLockedPlanBinding(runtime, 'chatgpt-web');
  const sessionId = 's-chatgpt-artifact-mismatch';

  const outbound = await handleBridgeRequest(runtime, 'POST', '/bridge/outbound', jsonRequest({
    sessionId,
    prompt: 'review this',
  }));
  const claim = await handleBridgeRequest(runtime, 'GET', '/bridge/outbound/next', jsonRequest());
  await handleBridgeRequest(runtime, 'POST', '/bridge/outbound/ack', jsonRequest({
    outboundPromptId: outbound.payload.outboundPrompt.id,
    claimToken: claim.payload.outboundPrompt.claimToken,
    ok: true,
  }));

  const extract = await handleBridgeRequest(runtime, 'POST', BRIDGE_EXTRACT_RETURN_PATH, jsonRequest({
    sessionId,
    operationId: 'wrong-operation',
    content: 'wrong operation reply',
    planId,
    artifactKind: 'review-result',
    summary: 'Should not be recorded',
  }));

  assert.equal(extract.statusCode, 409);
  assert.equal(runtime.reasoningArtifactStore.list().length, 0);
});

test('command review dispatch can produce a review-result reasoning artifact', async () => {
  const runtime = runtimeForArtifacts('claude-code-command');
  const { planId } = await createLockedPlanBinding(runtime, 'claude-code-command');

  const review = await handleBridgeRequest(runtime, 'POST', BRIDGE_REVIEWS_PATH, jsonRequest({
    sessionId: 's-review-artifact',
    sourceEndpointId: 'codex-command',
    targetEndpointId: 'claude-code-command',
    prompt: 'review this output',
  }));
  assert.equal(review.statusCode, 201);
  await handleBridgeRequest(runtime, 'POST', BRIDGE_REVIEWS_CONFIRM_PATH, jsonRequest({
    reviewId: review.payload.review.id,
  }));

  const run = await handleBridgeRequest(runtime, 'POST', BRIDGE_REVIEWS_RUN_PATH, jsonRequest({
    reviewId: review.payload.review.id,
    planId,
  }));

  assert.equal(run.statusCode, 200);
  assert.equal(run.payload.artifact.kind, 'review-result');
  assert.equal(run.payload.artifact.endpointId, 'claude-code-command');
});

test('Codex command review dispatch uses the same reasoning artifact envelope', async () => {
  const runtime = runtimeForArtifacts('codex-command');
  const { planId } = await createLockedPlanBinding(runtime, 'codex-command');

  const review = await handleBridgeRequest(runtime, 'POST', BRIDGE_REVIEWS_PATH, jsonRequest({
    sessionId: 's-codex-review-artifact',
    sourceEndpointId: 'claude-code-command',
    targetEndpointId: 'codex-command',
    prompt: 'review this output',
  }));
  assert.equal(review.statusCode, 201);
  await handleBridgeRequest(runtime, 'POST', BRIDGE_REVIEWS_CONFIRM_PATH, jsonRequest({
    reviewId: review.payload.review.id,
  }));

  const run = await handleBridgeRequest(runtime, 'POST', BRIDGE_REVIEWS_RUN_PATH, jsonRequest({
    reviewId: review.payload.review.id,
    planId,
  }));

  assert.equal(run.statusCode, 200);
  assert.equal(run.payload.artifact.kind, 'review-result');
  assert.equal(run.payload.artifact.endpointId, 'codex-command');
  assert.deepEqual(
    Object.keys(run.payload.artifact).sort(),
    [
      'artifactId',
      'bindingHash',
      'contentHash',
      'createdAt',
      'endpointId',
      'goalId',
      'kind',
      'planId',
      'summary',
    ],
  );
});

test('CLI command reasoning can produce an execution-proposal artifact through the HTTP route', async () => {
  const runtime = runtimeForArtifacts('codex-command');
  const { planId } = await createLockedPlanBinding(runtime, 'codex-command');

  const review = await handleBridgeRequest(runtime, 'POST', BRIDGE_REVIEWS_PATH, jsonRequest({
    sessionId: 's-cli-execution-proposal-artifact',
    sourceEndpointId: 'claude-code-command',
    targetEndpointId: 'codex-command',
    prompt: 'produce a bounded execution proposal review',
  }));
  await handleBridgeRequest(runtime, 'POST', BRIDGE_REVIEWS_CONFIRM_PATH, jsonRequest({
    reviewId: review.payload.review.id,
  }));

  const run = await handleBridgeRequest(runtime, 'POST', BRIDGE_REVIEWS_RUN_PATH, jsonRequest({
    reviewId: review.payload.review.id,
    planId,
    artifactKind: 'execution-proposal',
  }));

  assert.equal(run.statusCode, 200);
  assert.equal(run.payload.artifact.kind, 'execution-proposal');
  assert.equal(run.payload.artifact.endpointId, 'codex-command');
});

test('reasoning artifact correlation failure pauses the Plan and records no artifact', async () => {
  const runtime = runtimeForArtifacts();
  const { goalId, planId } = await createLockedPlanBinding(runtime, 'chatgpt-web');

  const res = await handleBridgeRequest(runtime, 'POST', BRIDGE_GOALS_PLAN_PATH, jsonRequest({
    goalId,
    planId,
    plannerSource: 'model-api',
    apiKey: 'sk-test-key',
    reasoningEndpointId: 'codex-medium',
    availableEndpoints: ['codex-medium'],
  }));

  assert.equal(res.statusCode, 409);
  assert.equal(runtime.goalStore.getPlanById(planId).status, 'paused');
  assert.equal(runtime.reasoningArtifactStore.list().length, 0);
});
