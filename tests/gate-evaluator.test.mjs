// Gate evaluator policy tests (ADR-0031 Task 4).
import assert from 'node:assert/strict';
import test from 'node:test';

const onlineExecutor = {
  endpointId: 'workbuddy',
  status: 'online',
  capabilities: ['canExecute'],
  claimMode: 'pull',
};

test('answer intent continues planning and does not execute', async () => {
  const { evaluateGate } = await import('../apps/local-server/src/conversation/gate-evaluator.ts');
  const decision = evaluateGate({
    plannerOutput: { id: 'o1', sessionId: 's1', plannerEndpointId: 'p1', visibleText: 'Answer only', intent: 'answer', createdAt: new Date().toISOString() },
    sessionState: { projectId: 'cli-bridge' },
    executorAvailability: [onlineExecutor],
    policyConfig: { allowSafeAutoExecute: true },
  });

  assert.equal(decision.type, 'continue_planning');
});

test('request_execution with offline executor blocks before dispatch', async () => {
  const { evaluateGate } = await import('../apps/local-server/src/conversation/gate-evaluator.ts');
  const decision = evaluateGate({
    plannerOutput: {
      id: 'o2',
      sessionId: 's1',
      plannerEndpointId: 'p1',
      visibleText: 'Ready to execute.',
      intent: 'request_execution',
      proposedInstruction: { summary: 'format text', payload: 'format text', targetExecutorIds: ['workbuddy'], riskHints: ['pure-transform'] },
      createdAt: new Date().toISOString(),
    },
    sessionState: { projectId: 'cli-bridge' },
    executorAvailability: [{ ...onlineExecutor, status: 'offline' }],
    policyConfig: { allowSafeAutoExecute: true },
  });

  assert.equal(decision.type, 'blocked');
  assert.deepEqual(decision.missing, ['executor:workbuddy']);
});

test('safe pure transform can auto execute when executor is online', async () => {
  const { evaluateGate } = await import('../apps/local-server/src/conversation/gate-evaluator.ts');
  const decision = evaluateGate({
    plannerOutput: {
      id: 'o3',
      sessionId: 's1',
      plannerEndpointId: 'p1',
      visibleText: 'Ready to format.',
      intent: 'request_execution',
      proposedInstruction: { summary: 'format text', payload: 'format text', targetExecutorIds: ['workbuddy'], riskHints: ['pure-transform'] },
      createdAt: new Date().toISOString(),
    },
    sessionState: { projectId: 'cli-bridge' },
    executorAvailability: [onlineExecutor],
    policyConfig: { allowSafeAutoExecute: true },
  });

  assert.equal(decision.type, 'auto_execute');
});

test('file mutation requires user confirmation', async () => {
  const { evaluateGate } = await import('../apps/local-server/src/conversation/gate-evaluator.ts');
  const decision = evaluateGate({
    plannerOutput: {
      id: 'o4',
      sessionId: 's1',
      plannerEndpointId: 'p1',
      visibleText: 'I will edit files.',
      intent: 'request_execution',
      proposedInstruction: { summary: 'edit files', payload: 'edit files', targetExecutorIds: ['workbuddy'], riskHints: ['filesystem-mutation'] },
      createdAt: new Date().toISOString(),
    },
    sessionState: { projectId: 'cli-bridge' },
    executorAvailability: [onlineExecutor],
    policyConfig: { allowSafeAutoExecute: true },
  });

  assert.equal(decision.type, 'require_user_confirm');
});

test('uknown risk hint requires user confirmation (safe default)', async () => {
  const { evaluateGate } = await import('../apps/local-server/src/conversation/gate-evaluator.ts');
  const decision = evaluateGate({
    plannerOutput: {
      id: 'o5',
      sessionId: 's1',
      plannerEndpointId: 'p1',
      visibleText: 'I will do something unusual.',
      intent: 'request_execution',
      proposedInstruction: { summary: 'unknown op', payload: 'unknown op', targetExecutorIds: ['workbuddy'], riskHints: ['unknown-risk'] },
      createdAt: new Date().toISOString(),
    },
    sessionState: { projectId: 'cli-bridge' },
    executorAvailability: [onlineExecutor],
    policyConfig: { allowSafeAutoExecute: true },
  });

  assert.equal(decision.type, 'require_user_confirm');
});

test('safe auto execute does not happen when policy is disabled', async () => {
  const { evaluateGate } = await import('../apps/local-server/src/conversation/gate-evaluator.ts');
  const decision = evaluateGate({
    plannerOutput: {
      id: 'o6',
      sessionId: 's1',
      plannerEndpointId: 'p1',
      visibleText: 'Ready to format.',
      intent: 'request_execution',
      proposedInstruction: { summary: 'format text', payload: 'format text', targetExecutorIds: ['workbuddy'], riskHints: ['pure-transform'] },
      createdAt: new Date().toISOString(),
    },
    sessionState: { projectId: 'cli-bridge' },
    executorAvailability: [onlineExecutor],
    policyConfig: { allowSafeAutoExecute: false },
  });

  assert.equal(decision.type, 'require_user_confirm');
});

test('clarify intent continues planning', async () => {
  const { evaluateGate } = await import('../apps/local-server/src/conversation/gate-evaluator.ts');
  const decision = evaluateGate({
    plannerOutput: {
      id: 'o7',
      sessionId: 's1',
      plannerEndpointId: 'p1',
      visibleText: 'What file do you mean?',
      intent: 'clarify',
      createdAt: new Date().toISOString(),
    },
    sessionState: { projectId: 'cli-bridge' },
    executorAvailability: [onlineExecutor],
    policyConfig: { allowSafeAutoExecute: true },
  });

  assert.equal(decision.type, 'continue_planning');
});

test('blocked intent returns blocked gate decision', async () => {
  const { evaluateGate } = await import('../apps/local-server/src/conversation/gate-evaluator.ts');
  const decision = evaluateGate({
    plannerOutput: {
      id: 'o8',
      sessionId: 's1',
      plannerEndpointId: 'p1',
      visibleText: 'I cannot do that.',
      intent: 'blocked',
      requiredInputs: ['API key'],
      createdAt: new Date().toISOString(),
    },
    sessionState: { projectId: 'cli-bridge' },
    executorAvailability: [onlineExecutor],
    policyConfig: { allowSafeAutoExecute: true },
  });

  assert.equal(decision.type, 'blocked');
  assert.deepEqual(decision.missing, ['API key']);
});
