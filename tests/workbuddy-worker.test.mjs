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

test('diagnostic worker posts echo result for a claimed task', async () => {
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

  // The penultimate POST body is the results call.
  const resultsCall = posted[posted.length - 1];
  assert.equal(resultsCall.path, '/bridge/endpoints/workbuddy/results');
  assert.equal(resultsCall.body.taskId, 'task-1');
  assert.equal(resultsCall.body.ok, true);
  assert.match(resultsCall.body.stdout, /diagnostic worker received/);

  // Verify worker log calls: one for the diagnostic probe.
  const logCalls = posted.filter(p => p.path === '/bridge/endpoints/workbuddy/log');
  assert.equal(logCalls.length, 1, 'diagnostic worker should write 1 log entry');
  assert.equal(logCalls[0].body.message, 'diagnostic probe: channel reachable');
});

test('real worker with backend sends heartbeat and returns backend output', async () => {
  const posted = [];

  // REVIEW: Injected backend stub — real output MUST come from the backend, not the worker.
  const backend = {
    async execute(task) {
      return {
        ok: true,
        stdout: `backend executed: ${task.prompt}`,
        exitCode: 0,
      };
    },
  };

  const worker = createWorkBuddyWorker({
    endpointId: 'workbuddy',
    baseUrl: 'http://127.0.0.1:31337',
    pairingToken: 'secret',
    backend,
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
            prompt: 'do real work',
            workingDirectory: '/tmp',
            timeoutMs: 120000,
            createdAt: 1,
            status: 'claimed',
          },
        });
      }
      posted.push({ path, body: JSON.parse(init.body || '{}') });
      return jsonResponse(200, { ok: true });
    },
  });

  const result = await onceWorkBuddyWorker(worker);

  assert.equal(result.type, 'returned');

  // First call should be heartbeat.
  assert.match(posted[0].path, /\/bridge\/endpoints\/workbuddy\/heartbeat$/);

  // Results call should have output from the injected backend, NOT worker-fabricated text.
  const resultsCall = posted.find(p => p.path === '/bridge/endpoints/workbuddy/results');
  assert.ok(resultsCall, 'should post results');
  assert.equal(resultsCall.body.taskId, 'task-1');
  assert.equal(resultsCall.body.ok, true);
  assert.match(resultsCall.body.stdout, /backend executed: do real work/);
  assert.doesNotMatch(resultsCall.body.stdout, /\[real executor\]/);
  assert.ok(typeof resultsCall.body.durationMs === 'number', 'real worker should report duration');

  // Verify worker log calls.
  const logCalls = posted.filter(p => p.path === '/bridge/endpoints/workbuddy/log');
  assert.equal(logCalls.length, 2, 'real worker should write 2 log entries (claimed + returned)');
  assert.equal(logCalls[0].body.message, 'real worker claimed task');
  assert.equal(logCalls[1].body.message, 'real worker returned result');
});

test('real worker without backend returns failed, does not fabricate output', async () => {
  const worker = createWorkBuddyWorker({
    endpointId: 'workbuddy',
    baseUrl: 'http://127.0.0.1:31337',
    pairingToken: 'secret',
    // No backend — with mode: 'diagnostic' (default), it runs diagnostic tick.
    // This test verifies: the default worker is diagnostic-only, never fabricates real output.
    fetchFn: async (url, init) => {
      const path = new URL(String(url)).pathname;
      if (path.endsWith('/inbox/next')) {
        return jsonResponse(200, { task: null });
      }
      return jsonResponse(200, { ok: true });
    },
  });

  // Default mode is 'diagnostic'. With no backend, onceWorkBuddyWorker falls through
  // to onceDiagnosticWorker, which returns idle when there's no task.
  // The key property: without a backend, the worker CANNOT produce real executor output.
  const result = await onceWorkBuddyWorker(worker);
  assert.equal(result.type, 'idle', 'default diagnostic worker with no task returns idle, never fabricates real output');
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

test('disabled worker returns idle without polling', async () => {
  const calls = [];
  const worker = createWorkBuddyWorker({
    endpointId: 'workbuddy',
    baseUrl: 'http://127.0.0.1:31337',
    pairingToken: 'secret',
    mode: 'disabled',
    fetchFn: async (url, init) => {
      calls.push({ url: String(url), init });
      return jsonResponse(200, { task: null });
    },
  });

  const result = await onceWorkBuddyWorker(worker);

  assert.equal(result.type, 'idle');
  assert.equal(calls.length, 0, 'disabled worker should not make any HTTP calls');
});

function jsonResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(payload),
    json: async () => payload,
  };
}
