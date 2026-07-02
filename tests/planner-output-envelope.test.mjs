// Planner output envelope tests (ADR-0031 Task 4).
import assert from 'node:assert/strict';
import test from 'node:test';

test('request_execution requires proposedInstruction payload', async () => {
  const { validatePlannerOutputEnvelope } = await import('../apps/local-server/src/conversation/planner-output-envelope.ts');

  const result = validatePlannerOutputEnvelope({
    id: 'out-1',
    sessionId: 's-1',
    plannerEndpointId: 'planner-1',
    visibleText: 'I can do that.',
    intent: 'request_execution',
    createdAt: new Date().toISOString(),
  });

  assert.equal(result.ok, false);
  assert.match(result.reason, /proposedInstruction/);
});

test('answer intent passes validation without proposedInstruction', async () => {
  const { validatePlannerOutputEnvelope } = await import('../apps/local-server/src/conversation/planner-output-envelope.ts');

  const result = validatePlannerOutputEnvelope({
    id: 'out-2',
    sessionId: 's-1',
    plannerEndpointId: 'planner-1',
    visibleText: 'Here is the answer.',
    intent: 'answer',
    createdAt: new Date().toISOString(),
  });

  assert.equal(result.ok, true);
});

test('propose_plan intent passes validation without proposedInstruction', async () => {
  const { validatePlannerOutputEnvelope } = await import('../apps/local-server/src/conversation/planner-output-envelope.ts');

  const result = validatePlannerOutputEnvelope({
    id: 'out-3',
    sessionId: 's-1',
    plannerEndpointId: 'planner-1',
    visibleText: 'I propose this plan.',
    intent: 'propose_plan',
    createdAt: new Date().toISOString(),
  });

  assert.equal(result.ok, true);
});
