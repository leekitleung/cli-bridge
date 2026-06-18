import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseReviewArgs,
  runReviewWorkflow,
} from '../apps/local-server/src/cli/review-workflow.ts';

// Fake fetch that records calls and returns scripted responses keyed by path.
function fakeFetch(routes, calls) {
  return async (url, init) => {
    const path = new URL(url).pathname;
    calls.push({ path, body: init?.body ? JSON.parse(init.body) : null, headers: init?.headers });
    const scripted = routes[path];
    const entry = typeof scripted === 'function' ? scripted() : scripted;
    return {
      ok: entry.ok ?? true,
      status: entry.status ?? 200,
      json: async () => entry.body ?? {},
    };
  };
}

test('parseReviewArgs maps target aliases and requires a prompt source + token', () => {
  const bad = parseReviewArgs(['--target', 'claude'], {});
  assert.equal(bad.ok, false); // missing prompt source

  const noToken = parseReviewArgs(['--target', 'claude', '--prompt', 'x'], {});
  assert.equal(noToken.ok, false);

  const ok = parseReviewArgs(['--target', 'codex', '--prompt', 'review x'], { CLI_BRIDGE_TOKEN: 't' });
  assert.equal(ok.ok, true);
  assert.equal(ok.values.target, 'codex-command');
  assert.equal(ok.values.token, 't');
  assert.equal(ok.values.prompt, 'review x');

  const claude = parseReviewArgs(['--target', 'claude', '--prompt', 'y', '--token', 'z'], {});
  assert.equal(claude.values.target, 'claude-code-command');
});

test('parseReviewArgs accepts --prompt-file and --stdin, rejects multiple sources', () => {
  const file = parseReviewArgs(['--prompt-file', 'x.md', '--token', 't'], {});
  assert.equal(file.ok, true);
  assert.equal(file.values.promptFile, 'x.md');

  const stdin = parseReviewArgs(['--stdin', '--token', 't'], {});
  assert.equal(stdin.ok, true);
  assert.equal(stdin.values.readStdin, true);

  const multi = parseReviewArgs(['--prompt', 'a', '--stdin', '--token', 't'], {});
  assert.equal(multi.ok, false);
  assert.match(multi.error, /only one of/);
});

test('parseReviewArgs rejects an unknown target', () => {
  const res = parseReviewArgs(['--target', 'bash', '--prompt', 'x', '--token', 't'], {});
  assert.equal(res.ok, false);
  assert.match(res.error, /unknown target/);
});

test('runReviewWorkflow runs create -> confirm -> dispatch and returns the result', async () => {
  const calls = [];
  const routes = {
    '/bridge/reviews': { status: 201, body: { review: { id: 'rev-1', status: 'previewed' } } },
    '/bridge/reviews/confirm': { body: { review: { id: 'rev-1', status: 'confirmed' } } },
    '/bridge/reviews/dispatch': {
      body: {
        review: { id: 'rev-1', status: 'returned' },
        result: { summary: 'ok', findings: ['none'] },
      },
    },
  };
  const result = await runReviewWorkflow({
    baseUrl: 'http://127.0.0.1:31337',
    token: 't',
    sessionId: 's1',
    sourceEndpointId: 'codex-command',
    targetEndpointId: 'claude-code-command',
    prompt: 'review this',
    fetchFn: fakeFetch(routes, calls),
  });

  assert.equal(result.ok, true);
  assert.equal(result.reviewId, 'rev-1');
  assert.equal(result.status, 'returned');
  assert.equal(result.summary, 'ok');
  // Exactly the three review endpoints, in order, and only reviews* paths.
  assert.deepEqual(calls.map((c) => c.path), [
    '/bridge/reviews',
    '/bridge/reviews/confirm',
    '/bridge/reviews/dispatch',
  ]);
  for (const c of calls) {
    assert.match(c.path, /^\/bridge\/reviews/);
    assert.equal(c.headers['x-cli-bridge-pairing-token'], 't');
  }
});

test('runReviewWorkflow surfaces a draft follow-up without executing it', async () => {
  const routes = {
    '/bridge/reviews': { status: 201, body: { review: { id: 'rev-2', status: 'previewed' } } },
    '/bridge/reviews/confirm': { body: { review: { id: 'rev-2', status: 'confirmed' } } },
    '/bridge/reviews/dispatch': {
      body: {
        review: { id: 'rev-2', status: 'returned' },
        result: { summary: 's', findings: [] },
        nextPrompt: { id: 'pp-1', status: 'draft' },
      },
    },
  };
  const result = await runReviewWorkflow({
    baseUrl: 'http://127.0.0.1:31337',
    token: 't',
    sessionId: 's1',
    sourceEndpointId: 'codex-command',
    targetEndpointId: 'claude-code-command',
    prompt: 'review this',
    fetchFn: fakeFetch(routes, []),
  });
  assert.equal(result.nextPromptDraftId, 'pp-1');
  assert.equal(result.nextPromptStatus, 'draft');
});

test('runReviewWorkflow stops at confirm when confirm fails, never dispatches', async () => {
  const calls = [];
  const routes = {
    '/bridge/reviews': { status: 201, body: { review: { id: 'rev-3', status: 'previewed' } } },
    '/bridge/reviews/confirm': { ok: false, status: 409, body: { message: 'Review cannot be confirmed' } },
    '/bridge/reviews/dispatch': { body: {} },
  };
  const result = await runReviewWorkflow({
    baseUrl: 'http://127.0.0.1:31337',
    token: 't',
    sessionId: 's1',
    sourceEndpointId: 'codex-command',
    targetEndpointId: 'claude-code-command',
    prompt: 'review this',
    fetchFn: fakeFetch(routes, calls),
  });
  assert.equal(result.ok, false);
  assert.equal(result.step, 'confirm');
  // dispatch must NOT have been called.
  assert.equal(calls.some((c) => c.path === '/bridge/reviews/dispatch'), false);
});

test('runReviewWorkflow reports a network error at the create step', async () => {
  const result = await runReviewWorkflow({
    baseUrl: 'http://127.0.0.1:31337',
    token: 't',
    sessionId: 's1',
    sourceEndpointId: 'codex-command',
    targetEndpointId: 'claude-code-command',
    prompt: 'review this',
    fetchFn: async () => { throw new Error('connection refused'); },
  });
  assert.equal(result.ok, false);
  assert.equal(result.step, 'create');
  assert.match(result.failureReason, /connection refused/);
});

test('review HTTP timeout spans response body consumption', async () => {
  const started = Date.now();
  const result = await runReviewWorkflow({
    baseUrl: 'http://127.0.0.1:31337',
    token: 't',
    sessionId: 's1',
    sourceEndpointId: 'codex-command',
    targetEndpointId: 'claude-code-command',
    prompt: 'review this',
    timeoutMs: 50,
    fetchFn: async () => ({
      ok: true,
      status: 200,
      json: async () => await new Promise(() => {}),
    }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.step, 'create');
  assert.equal(result.failureReason, 'review-http-timeout');
  assert.ok(Date.now() - started < 1000);
});
