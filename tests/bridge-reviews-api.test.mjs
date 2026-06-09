import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BRIDGE_REVIEWS_PATH,
  BRIDGE_REVIEWS_CONFIRM_PATH,
  BRIDGE_REVIEWS_RUN_PATH,
  BRIDGE_REVIEWS_CANCEL_PATH,
  createBridgeRuntime,
  handleBridgeRequest,
  isBridgePath,
} from '../apps/local-server/src/routes/bridge-api.ts';

// Builds a minimal async-iterable request carrying a JSON body, matching what
// readJsonBody consumes. No real socket / server is involved.
function jsonRequest(body) {
  const text = body === undefined ? '' : JSON.stringify(body);
  async function* gen() {
    if (text.length > 0) {
      yield Buffer.from(text, 'utf8');
    }
  }
  return gen();
}

// Fake review adapter so tests never spawn a real CLI.
function fakeReviewAdapter(reviewResultJson, capture) {
  return {
    name: 'fake-review',
    async review(input) {
      if (capture) {
        capture.prompt = input.prompt;
      }
      const parsed = JSON.parse(reviewResultJson);
      return {
        ok: true,
        adapterName: 'fake-review',
        result: {
          id: input.resultId ?? 'res-fake',
          reviewRequestId: input.reviewRequestId,
          summary: parsed.summary,
          findings: parsed.findings,
          nextPromptDraft: parsed.nextPromptDraft,
          createdAt: input.now ?? Date.now(),
        },
        meta: { command: 'claude', argv: [], exitCode: 0, durationMs: 1, timedOut: false, truncated: false },
      };
    },
  };
}

function failingReviewAdapter(failureReason) {
  return {
    name: 'fake-review',
    async review() {
      return {
        ok: false,
        adapterName: 'fake-review',
        failureReason,
        meta: { command: 'claude', argv: [], exitCode: 1, durationMs: 1, timedOut: false, truncated: false },
      };
    },
  };
}

function runtimeWith(adapter) {
  return createBridgeRuntime({ reviewAdapterFor: () => adapter });
}

test('review paths are recognized bridge paths', () => {
  assert.equal(isBridgePath(BRIDGE_REVIEWS_PATH), true);
  assert.equal(isBridgePath(BRIDGE_REVIEWS_CONFIRM_PATH), true);
  assert.equal(isBridgePath(BRIDGE_REVIEWS_RUN_PATH), true);
  assert.equal(isBridgePath(BRIDGE_REVIEWS_CANCEL_PATH), true);
});

test('create review rejects a non-runnable target endpoint', async () => {
  const runtime = runtimeWith(fakeReviewAdapter('{}'));
  const res = await handleBridgeRequest(runtime, 'POST', BRIDGE_REVIEWS_PATH, jsonRequest({
    sessionId: 's1',
    sourceEndpointId: 'codex-command',
    targetEndpointId: 'chatgpt-web',
    prompt: 'review this',
  }));
  assert.equal(res.statusCode, 400);
});

test('a confirmed review runs the CLI and returns a draft follow-up over HTTP', async () => {
  const runtime = runtimeWith(fakeReviewAdapter(JSON.stringify({
    summary: 'looks ok',
    findings: ['nit: rename x'],
    nextPromptDraft: 'rename x after confirmation',
  })));

  const create = await handleBridgeRequest(runtime, 'POST', BRIDGE_REVIEWS_PATH, jsonRequest({
    sessionId: 's1',
    sourceEndpointId: 'codex-command',
    targetEndpointId: 'claude-code-command',
    prompt: 'review this output',
  }));
  assert.equal(create.statusCode, 201);
  const reviewId = create.payload.review.id;
  assert.equal(create.payload.review.status, 'previewed');

  // Cannot run before confirm.
  const runEarly = await handleBridgeRequest(runtime, 'POST', BRIDGE_REVIEWS_RUN_PATH, jsonRequest({ reviewId }));
  assert.equal(runEarly.statusCode, 409);

  const confirm = await handleBridgeRequest(runtime, 'POST', BRIDGE_REVIEWS_CONFIRM_PATH, jsonRequest({ reviewId }));
  assert.equal(confirm.statusCode, 200);
  assert.equal(confirm.payload.review.status, 'confirmed');

  const run = await handleBridgeRequest(runtime, 'POST', BRIDGE_REVIEWS_RUN_PATH, jsonRequest({ reviewId }));
  assert.equal(run.statusCode, 200);
  assert.equal(run.payload.review.status, 'returned');
  assert.equal(run.payload.result.summary, 'looks ok');
  assert.equal(run.payload.nextPrompt.status, 'draft');
});

test('a review whose CLI returns execution fields fails and creates no prompt', async () => {
  const runtime = runtimeWith(failingReviewAdapter('review-result-forbidden-autoSend'));

  const create = await handleBridgeRequest(runtime, 'POST', BRIDGE_REVIEWS_PATH, jsonRequest({
    sessionId: 's1',
    sourceEndpointId: 'codex-command',
    targetEndpointId: 'claude-code-command',
    prompt: 'review this output',
  }));
  const reviewId = create.payload.review.id;
  await handleBridgeRequest(runtime, 'POST', BRIDGE_REVIEWS_CONFIRM_PATH, jsonRequest({ reviewId }));

  const run = await handleBridgeRequest(runtime, 'POST', BRIDGE_REVIEWS_RUN_PATH, jsonRequest({ reviewId }));
  assert.equal(run.statusCode, 409);
  assert.equal(runtime.pendingReviewStore.get(reviewId).status, 'failed');
  assert.equal(runtime.pendingPromptStore.listPrompts().length, 0);
});

test('dispatch wraps the user content with review-only instructions before running', async () => {
  const capture = {};
  const runtime = createBridgeRuntime({
    reviewAdapterFor: () => fakeReviewAdapter('{"summary":"ok","findings":[]}', capture),
  });
  const create = await handleBridgeRequest(runtime, 'POST', BRIDGE_REVIEWS_PATH, jsonRequest({
    sessionId: 's1',
    sourceEndpointId: 'codex-command',
    targetEndpointId: 'claude-code-command',
    prompt: 'MY RAW CONTENT TO REVIEW',
  }));
  const reviewId = create.payload.review.id;
  await handleBridgeRequest(runtime, 'POST', BRIDGE_REVIEWS_CONFIRM_PATH, jsonRequest({ reviewId }));
  await handleBridgeRequest(runtime, 'POST', BRIDGE_REVIEWS_RUN_PATH, jsonRequest({ reviewId }));

  // The prompt sent to the CLI is the review-instruction wrapper containing the
  // user content, not the raw content alone.
  assert.match(capture.prompt, /Review Agent/);
  assert.match(capture.prompt, /ReviewResult-shaped JSON/);
  assert.match(capture.prompt, /MY RAW CONTENT TO REVIEW/);
});

test('a review can be cancelled before running', async () => {
  const runtime = runtimeWith(fakeReviewAdapter('{"summary":"x","findings":[]}'));
  const create = await handleBridgeRequest(runtime, 'POST', BRIDGE_REVIEWS_PATH, jsonRequest({
    sessionId: 's1',
    sourceEndpointId: 'codex-command',
    targetEndpointId: 'claude-code-command',
    prompt: 'review this output',
  }));
  const reviewId = create.payload.review.id;
  const cancel = await handleBridgeRequest(runtime, 'POST', BRIDGE_REVIEWS_CANCEL_PATH, jsonRequest({ reviewId }));
  assert.equal(cancel.statusCode, 200);
  assert.equal(cancel.payload.review.status, 'cancelled');
});

test('missing reviewId returns 400 on confirm/run/cancel', async () => {
  const runtime = runtimeWith(fakeReviewAdapter('{}'));
  for (const path of [BRIDGE_REVIEWS_CONFIRM_PATH, BRIDGE_REVIEWS_RUN_PATH, BRIDGE_REVIEWS_CANCEL_PATH]) {
    const res = await handleBridgeRequest(runtime, 'POST', path, jsonRequest({}));
    assert.equal(res.statusCode, 400);
  }
});
