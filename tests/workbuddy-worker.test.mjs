import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createWorkBuddyWorker,
  onceWorkBuddyWorker,
} from '../apps/local-server/src/workbuddy/workbuddy-worker.ts';

test('worker reports idle when inbox has no task', async () => {
  const calls = [];
  const worker = createWorkBuddyWorker({
    endpointId: 'workbuddy',
    baseUrl: 'http://127.0.0.1:31337',
    pairingToken: 'secret',
    fetchFn: async (url, init) => {
      calls.push({ url: String(url), init });
      return jsonResponse(200, { task: null, message: 'No pending tasks' });
    },
  });

  const result = await onceWorkBuddyWorker(worker);

  assert.equal(result.type, 'idle');
  assert.match(calls[0].url, /\/bridge\/endpoints\/workbuddy\/inbox\/next$/);
  assert.equal(calls[0].init.headers['x-cli-bridge-pairing-token'], 'secret');
});

test('worker posts raw result for a claimed diagnostic task', async () => {
  const posted = [];
  const worker = createWorkBuddyWorker({
    endpointId: 'workbuddy',
    baseUrl: 'http://127.0.0.1:31337',
    pairingToken: 'secret',
    fetchFn: async (url, init) => {
      const path = new URL(String(url)).pathname;
      if (path.endsWith('/inbox/next')) {
        return jsonResponse(200, {
          task: {
            taskId: 'task-1',
            endpointId: 'workbuddy',
            proposalId: 'proposal-1',
            planId: 'plan-1',
            goalId: 'goal-1',
            bindingHash: 'hash-1',
            prompt: 'diagnostic: ping',
            workingDirectory: '/tmp',
            timeoutMs: 120000,
            createdAt: 1,
            status: 'claimed',
          },
        });
      }
      posted.push({ path, body: JSON.parse(init.body) });
      return jsonResponse(200, { ok: true });
    },
  });

  const result = await onceWorkBuddyWorker(worker);

  assert.equal(result.type, 'returned');

  // With the log fix, the call order is: log(claimed) → results → log(returned).
  // The penultimate POST body (before the final log) is the results call.
  const resultsCall = posted[posted.length - 2];
  assert.equal(resultsCall.path, '/bridge/endpoints/workbuddy/results');
  assert.equal(resultsCall.body.taskId, 'task-1');
  assert.equal(resultsCall.body.ok, true);
  assert.match(resultsCall.body.stdout, /diagnostic worker received/);

  // Verify worker log calls: one for claim, one for return.
  const logCalls = posted.filter(p => p.path === '/bridge/endpoints/workbuddy/log');
  assert.equal(logCalls.length, 2, 'worker should write 2 log entries (claimed + returned)');
  assert.equal(logCalls[0].body.message, 'worker claimed task');
  assert.equal(logCalls[1].body.message, 'worker returned result');
});

test('worker returns failed when inbox endpoint errors', async () => {
  const worker = createWorkBuddyWorker({
    endpointId: 'workbuddy',
    baseUrl: 'http://127.0.0.1:31337',
    pairingToken: 'secret',
    fetchFn: async () => jsonResponse(500, { error: 'internal' }),
  });

  const result = await onceWorkBuddyWorker(worker);
  assert.equal(result.type, 'failed');
  assert.match(result.reason, /inbox 500/);
});

test('worker returns failed for invalid task payload', async () => {
  const worker = createWorkBuddyWorker({
    endpointId: 'workbuddy',
    baseUrl: 'http://127.0.0.1:31337',
    pairingToken: 'secret',
    fetchFn: async () => jsonResponse(200, {
      task: { endpointId: 'workbuddy', status: 'claimed' },
    }),
  });

  const result = await onceWorkBuddyWorker(worker);
  assert.equal(result.type, 'failed');
  assert.match(result.reason, /invalid task payload/);
});

test('baseUrl trailing slash is stripped', () => {
  const worker = createWorkBuddyWorker({
    endpointId: 'workbuddy',
    baseUrl: 'http://127.0.0.1:31337/',
    pairingToken: 'secret',
  });
  assert.equal(worker.baseUrl, 'http://127.0.0.1:31337');
});

function jsonResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(payload),
    json: async () => payload,
  };
}
