import assert from 'node:assert/strict';
import { test } from 'node:test';

import { startLocalServer } from '../apps/local-server/src/server.ts';
import { createWorkBuddyWorker, onceWorkBuddyWorker } from '../apps/local-server/src/workbuddy/workbuddy-worker.ts';
import { createStaticPlannerAdapter } from '../tests/helpers/static-planner-adapter.mjs';

test('WorkBuddy connector acceptance: planner gate to worker result', async () => {
  const handle = await startLocalServer(0, {
    plannerAdapters: [createStaticPlannerAdapter({
      intent: 'request_execution',
      visibleText: 'Ready to run diagnostic.',
      proposedInstruction: {
        summary: 'diagnostic',
        payload: 'diagnostic: ping',
        targetExecutorIds: ['workbuddy'],
        riskHints: ['pure-transform'],
      },
    })],
  });

  try {
    const worker = createWorkBuddyWorker({
      endpointId: 'workbuddy',
      baseUrl: handle.url,
      pairingToken: handle.pairingToken,
    });

    // Poll inbox once so the worker is seen as "ready"
    await onceWorkBuddyWorker(worker);

    // Pair conversation source → workbuddy target.
    const pair = await fetch(`${handle.url}/bridge/projects/cli-bridge/conversation-pairing`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        'x-cli-bridge-pairing-token': handle.pairingToken,
      },
      body: JSON.stringify({ sourceEndpointId: 'chatgpt-web', targetEndpointId: 'workbuddy' }),
    });
    assert.equal(pair.status, 200);

    const send = await fetch(`${handle.url}/bridge/projects/cli-bridge/conversation/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-cli-bridge-pairing-token': handle.pairingToken,
      },
      body: JSON.stringify({ text: 'run diagnostic' }),
    });
    assert.equal(send.status, 201);

    // Worker claims and processes the task.
    const workerResult = await onceWorkBuddyWorker(worker);
    assert.equal(workerResult.type, 'returned');

    const read = await fetch(`${handle.url}/bridge/projects/cli-bridge/conversation/messages`, {
      headers: { 'x-cli-bridge-pairing-token': handle.pairingToken },
    });
    const payload = await read.json();
    assert.match(JSON.stringify(payload), /diagnostic worker received/);

    // Verify execution tasks appear in the read model.
    const wbRes = await fetch(`${handle.url}/bridge/projects/cli-bridge/workbuddy`, {
      headers: { 'x-cli-bridge-pairing-token': handle.pairingToken },
    });
    assert.equal(wbRes.status, 200);
    const wbPayload = await wbRes.json();
    assert.ok(Array.isArray(wbPayload.executionTasks), 'executionTasks must be present');
  } finally {
    await new Promise(resolve => handle.server.close(resolve));
  }
});
