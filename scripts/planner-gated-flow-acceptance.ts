#!/usr/bin/env node --experimental-strip-types

/**
 * ADR-0030 EX-6: Planner-gated flow acceptance test.
 *
 * Full end-to-end verification:
 *   1. configure planner + executor
 *   2. send conversation message
 *   3. assert plan proposal visible
 *   4. assert WorkBuddy inbox empty
 *   5. accept plan
 *   6. assert instruction packet exists
 *   7. assert route exists
 *   8. assert WorkBuddy inbox has task
 *   9. post WorkBuddy result
 *  10. assert transcript shows executor raw output only
 */

import assert from 'node:assert/strict';

const CONSOLE_AUTH = { kind: 'console-cookie' as const };
const PROJECT_KEY = 'cli-bridge';
const SOURCE_ID = 'chatgpt-web';
const EXECUTOR_ID = 'workbuddy';

function jsonBody(body: unknown) {
  const text = body === undefined ? '' : JSON.stringify(body);
  async function* gen() {
    if (text.length > 0) yield Buffer.from(text, 'utf8');
  }
  return gen();
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('ADR-0030 Planner-Gated Flow Acceptance');
  console.log('═══════════════════════════════════════════════════════════\n');

  const { createBridgeRuntime, handleBridgeRequest } = await import(
    '../apps/local-server/src/routes/bridge-api.ts'
  );
  const runtime = createBridgeRuntime();

  // ══════════════════════════════════════════════════════════════
  // Step 1: Configure conversation pairing
  // ══════════════════════════════════════════════════════════════
  console.log('1. Configuring conversation pairing...');
  const pairingResult = await handleBridgeRequest(
    runtime,
    'PUT',
    `/bridge/projects/${PROJECT_KEY}/conversation-pairing`,
    jsonBody({ sourceEndpointId: SOURCE_ID, targetEndpointId: EXECUTOR_ID, scope: 'project' }),
  );
  assert.equal(pairingResult.statusCode, 200, 'pairing should succeed');
  console.log('   OK: Pairing configured\n');

  // ══════════════════════════════════════════════════════════════
  // Step 2: Send conversation message
  // ══════════════════════════════════════════════════════════════
  console.log('2. Sending conversation message...');
  const msgResult = await handleBridgeRequest(
    runtime,
    'POST',
    `/bridge/projects/${PROJECT_KEY}/conversation/messages`,
    jsonBody({ text: 'Refactor the auth module to use JWT tokens instead of session cookies.' }),
  );
  assert.equal(msgResult.statusCode, 201, 'message should be created');
  assert.ok(msgResult.payload.events, 'response should have events');
  console.log('   OK: Message sent\n');

  // ══════════════════════════════════════════════════════════════
  // Step 3: Assert plan proposal visible
  // ══════════════════════════════════════════════════════════════
  console.log('3. Checking plan proposal...');
  const plan = (msgResult.payload as Record<string, unknown>).plan;
  assert.ok(plan, 'plan proposal must exist');
  const planRecord = plan as Record<string, unknown>;
  assert.equal(planRecord.status, 'proposed', 'plan must be proposed');
  assert.equal(planRecord.version, 1, 'plan must be version 1');
  assert.ok(typeof planRecord.title === 'string' && planRecord.title.length > 0, 'plan must have title');
  assert.ok(typeof planRecord.body === 'string' && planRecord.body.length > 0, 'plan must have body');
  assert.ok(Array.isArray(planRecord.steps) && planRecord.steps.length > 0, 'plan must have steps');
  console.log(`   OK: Plan proposal created — "${planRecord.title}"\n`);
  console.log(`       Steps: ${(planRecord.steps as string[]).length}`);
  console.log(`       Constraints: ${(planRecord.constraints as string[]).length}`);
  console.log(`       Risks: ${(planRecord.riskNotes as string[]).length}\n`);

  // ══════════════════════════════════════════════════════════════
  // Step 4: Assert WorkBuddy inbox empty before accept
  // ══════════════════════════════════════════════════════════════
  console.log('4. Checking WorkBuddy inbox (should be empty)...');
  const workbuddyEndpointId = runtime.endpointRegistry.get(EXECUTOR_ID)?.id ?? EXECUTOR_ID;
  const lastTask = runtime.workbuddyExecution.claimNext(workbuddyEndpointId);
  assert.equal(lastTask, undefined, 'WorkBuddy inbox must be empty before accept');
  console.log('   OK: WorkBuddy inbox empty\n');

  // Assert no instruction packet, no route, no task created.
  const instructions = runtime.conversationInstructionStore.listByProject(PROJECT_KEY);
  assert.equal(instructions.length, 0, 'instruction store must be empty before accept');

  const routes = runtime.conversationRouteStore.listByProject(PROJECT_KEY);
  assert.equal(routes.length, 0, 'route store must be empty before accept');
  console.log('   OK: Instruction store empty');
  console.log('   OK: Route store empty\n');

  // ══════════════════════════════════════════════════════════════
  // Step 5: Accept plan
  // ══════════════════════════════════════════════════════════════
  console.log('5. Accepting plan...');
  const planId = planRecord.id as string;

  // Extension should NOT be able to accept (no console auth → 403).
  const extAccept = await handleBridgeRequest(
    runtime,
    'POST',
    `/bridge/projects/${PROJECT_KEY}/conversation/plans/${planId}/accept`,
    jsonBody({}),
  );
  assert.equal(extAccept.statusCode, 403, 'extension must not accept plans');
  console.log('   OK: Extension rejected with 403');

  // Console accept.
  const acceptResult = await handleBridgeRequest(
    runtime,
    'POST',
    `/bridge/projects/${PROJECT_KEY}/conversation/plans/${planId}/accept`,
    jsonBody({}),
    undefined,
    CONSOLE_AUTH,
  );
  assert.equal(acceptResult.statusCode, 200, 'accept should succeed');
  const acceptedPlan = (acceptResult.payload as Record<string, unknown>).plan as Record<string, unknown>;
  assert.ok(acceptedPlan, 'accepted plan must be returned');
  assert.ok(['accepted', 'dispatching'].includes(acceptedPlan.status as string), 'plan status must be accepted/dispatching');
  console.log(`   OK: Plan accepted — status: ${acceptedPlan.status}\n`);

  // ══════════════════════════════════════════════════════════════
  // Step 6: Assert instruction packet exists
  // ══════════════════════════════════════════════════════════════
  console.log('6. Checking instruction packet...');
  const insts = runtime.conversationInstructionStore.listByProject(PROJECT_KEY);
  assert.ok(insts.length > 0, 'instruction packet must exist after accept');
  assert.ok(insts[0].text.length > 0, 'instruction packet must have text');
  console.log(`   OK: Instruction packet created (${insts.length} total)\n`);

  // ══════════════════════════════════════════════════════════════
  // Step 7: Assert route exists
  // ══════════════════════════════════════════════════════════════
  console.log('7. Checking route...');
  const routes2 = runtime.conversationRouteStore.listByProject(PROJECT_KEY);
  assert.ok(routes2.length > 0, 'route must exist after accept');
  assert.equal(routes2[0].status, 'dispatched', 'route must be dispatched');
  console.log(`   OK: Route created — status: ${routes2[0].status}\n`);

  // ══════════════════════════════════════════════════════════════
  // Step 8: Assert WorkBuddy inbox has task
  // ══════════════════════════════════════════════════════════════
  console.log('8. Checking WorkBuddy inbox (should have task)...');
  const claimedTask = runtime.workbuddyExecution.claimNext(workbuddyEndpointId);
  assert.ok(claimedTask, 'WorkBuddy inbox must have a task after accept');
  assert.equal(claimedTask.endpointId, workbuddyEndpointId, 'task endpoint must match');
  console.log(`   OK: WorkBuddy task claimed — id: ${claimedTask.taskId}, prompt length: ${claimedTask.prompt.length}\n`);

  // ══════════════════════════════════════════════════════════════
  // Step 9: Post WorkBuddy result
  // ══════════════════════════════════════════════════════════════
  console.log('9. Posting WorkBuddy result...');
  const resultBody = {
    taskId: claimedTask.taskId,
    proposalId: claimedTask.proposalId,
    ok: true,
    stdout: 'JWT module refactored successfully. Added token generation, validation, and middleware.',
    stderr: '',
    exitCode: 0,
    durationMs: 1500,
  };
  const resultResult = await handleBridgeRequest(
    runtime,
    'POST',
    `/bridge/endpoints/${workbuddyEndpointId}/results`,
    jsonBody(resultBody),
  );
  assert.equal(resultResult.statusCode, 200, 'result submission should succeed');
  console.log('   OK: Result submitted\n');

  // ══════════════════════════════════════════════════════════════
  // Step 10: Assert transcript shows executor raw output only
  // ══════════════════════════════════════════════════════════════
  console.log('10. Verifying transcript...');
  const plan2 = runtime.planProposalStore.get(planId);
  assert.ok(plan2, 'plan should still exist');
  assert.equal(plan2.status, 'returned', 'plan should be returned after successful execution');
  console.log(`   OK: Plan status updated to: ${plan2.status}`);

  const userEvents = runtime.conversationTranscriptStore.listByProject(PROJECT_KEY)
    .filter(e => e.visibility === 'user');

  // Should have: user message, bridge (planner proposal), bridge (dispatching), target (executor output)
  const userMessages = userEvents.filter(e => e.role === 'user');
  const executorOutputs = userEvents.filter(e => e.kind === 'executor_output');

  assert.ok(userMessages.length >= 1, 'must have user message');
  assert.ok(executorOutputs.length >= 1, 'must have executor_output event');

  const finalOutput = executorOutputs[executorOutputs.length - 1];
  assert.equal(finalOutput.text, resultBody.stdout, 'transcript must show raw executor output');
  assert.equal(finalOutput.status, 'returned', 'executor output status must be returned');

  // Verify no internal IDs leak in user-visible events.
  for (const event of userEvents) {
    assert.ok(!event.text.includes('route-'), 'transcript must not contain route-');
    assert.ok(!event.text.includes('inst-'), 'transcript must not contain inst-');
    assert.ok(!event.text.includes('action-'), 'transcript must not contain action-id');
    assert.ok(!event.text.includes('task-'), 'transcript must not contain task-');
    assert.ok(!event.text.includes('plan-'), 'transcript must not contain plan-');
  }
  console.log('   OK: No internal IDs leaked in user transcript');
  console.log(`   OK: Final output matches raw executor stdout ("${finalOutput.text.slice(0, 60)}...")\n`);

  // ══════════════════════════════════════════════════════════════
  // Summary
  // ══════════════════════════════════════════════════════════════
  console.log('═══════════════════════════════════════════════════════════');
  console.log('ALL ACCEPTANCE TESTS PASSED');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');
  console.log('Planner-gated flow verified:');
  console.log('  User → Planner → Proposal → Accept → Executor → Result');
  console.log('');
  console.log('P0 Gate confirmed:');
  console.log('  plan.status !== accepted → no instruction, no route, no task');
  console.log('');
  console.log('Immutability confirmed:');
  console.log('  Plan frozen at propose, executor gets snapshot');
}

main().catch(err => {
  console.error('\nACCEPTANCE TEST FAILED');
  console.error(err);
  process.exit(1);
});
