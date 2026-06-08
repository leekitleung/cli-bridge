import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CLAUDE_REVIEW_ARGS,
  CODEX_REVIEW_ARGS,
  createClaudeReviewCommandAdapter,
  createCodexReviewCommandAdapter,
  createCommandReviewAdapter,
  selectReviewText,
} from '../apps/local-server/src/adapters/command-review-adapter.ts';
import { InMemoryEndpointRegistry } from '../apps/local-server/src/endpoints/endpoint-registry.ts';
import {
  CLAUDE_CODE_REVIEW_COMMAND_ENDPOINT,
  CODEX_REVIEW_COMMAND_ENDPOINT,
  DEFAULT_AGENT_ENDPOINTS,
} from '../apps/local-server/src/endpoints/mock-endpoints.ts';
import { InMemoryAuditLog } from '../apps/local-server/src/storage/audit-log.ts';
import { InMemoryPacketStore } from '../apps/local-server/src/storage/packet-store.ts';
import { InMemoryPendingPromptStore } from '../apps/local-server/src/storage/pending-prompt-store.ts';
import { InMemoryPendingReviewStore } from '../apps/local-server/src/storage/pending-review-store.ts';

const now = 1770000000000;

// Tests must not depend on a real local install: inject a fixed resolver.
const fakeLauncherResolver = (command) => ({ executable: `/fake/${command}`, prependArgs: [] });

function fakeRunner(result, capture) {
  return {
    async run(execution, launcher, options) {
      if (capture) {
        capture.execution = execution;
        capture.launcher = launcher;
        capture.options = options;
      }
      if (typeof result === 'function') {
        return result(execution, options);
      }
      return result;
    },
  };
}

function okRun(stdout) {
  return { exitCode: 0, stdout, stderr: '', timedOut: false };
}

test('claude review command endpoint is review-only command transport', () => {
  assert.equal(CLAUDE_CODE_REVIEW_COMMAND_ENDPOINT.transport, 'command');
  assert.equal(CLAUDE_CODE_REVIEW_COMMAND_ENDPOINT.capabilities.canReview, true);
  assert.equal(CLAUDE_CODE_REVIEW_COMMAND_ENDPOINT.capabilities.canExecute, false);
  assert.equal(CLAUDE_CODE_REVIEW_COMMAND_ENDPOINT.capabilities.canAcceptPrompt, false);
  assert.equal(CODEX_REVIEW_COMMAND_ENDPOINT.transport, 'command');
  assert.equal(CODEX_REVIEW_COMMAND_ENDPOINT.capabilities.canExecute, false);
});

test('claude review argv is non-interactive review-only with tools disabled', () => {
  assert.ok(CLAUDE_REVIEW_ARGS.includes('-p'));
  assert.ok(CLAUDE_REVIEW_ARGS.includes('--output-format'));
  assert.ok(CLAUDE_REVIEW_ARGS.includes('json'));
  assert.ok(CLAUDE_REVIEW_ARGS.includes('--tools'));
  assert.ok(CLAUDE_REVIEW_ARGS.includes('--permission-mode'));
  assert.ok(CLAUDE_REVIEW_ARGS.includes('plan'));
});

test('codex review argv uses read-only non-interactive exec with stdin', () => {
  assert.deepEqual(CODEX_REVIEW_ARGS.slice(0, 4), ['exec', '-s', 'read-only', '--json']);
  assert.ok(CODEX_REVIEW_ARGS.includes('--ephemeral'));
  assert.equal(CODEX_REVIEW_ARGS[CODEX_REVIEW_ARGS.length - 1], '-');
});

test('adapter passes the prompt via stdin and fixed argv, never a shell string', async () => {
  const capture = {};
  const adapter = createClaudeReviewCommandAdapter();
  const result = await adapter.review(
    { prompt: 'review this output', reviewRequestId: 'r1', cwd: '/repo' },
    { runner: fakeRunner(okRun('{"summary":"ok","findings":[]}'), capture), launcherResolver: fakeLauncherResolver },
  );

  assert.equal(result.ok, true);
  assert.equal(capture.execution.command, 'claude');
  assert.deepEqual(capture.execution.args, CLAUDE_REVIEW_ARGS);
  assert.equal(capture.execution.stdin, 'review this output');
  assert.equal(capture.execution.cwd, '/repo');
});

test('adapter parses a clean ReviewResult from CLI stdout', async () => {
  const adapter = createCodexReviewCommandAdapter();
  const result = await adapter.review(
    { prompt: 'p', reviewRequestId: 'r1', resultId: 'res-1', now },
    {
      runner: fakeRunner(okRun(JSON.stringify({
        summary: 'Looks fine',
        findings: ['no blocking issues'],
        nextPromptDraft: 'consider adding a test',
      }))),
      launcherResolver: fakeLauncherResolver,
    },
  );

  assert.equal(result.ok, true);
  assert.equal(result.result.summary, 'Looks fine');
  assert.deepEqual(result.result.findings, ['no blocking issues']);
  assert.equal(result.result.nextPromptDraft, 'consider adding a test');
  assert.equal(result.adapterName, 'codex-review-command');
});

test('adapter fails closed when the CLI returns execution fields', async () => {
  const adapter = createClaudeReviewCommandAdapter();
  const result = await adapter.review(
    { prompt: 'p', reviewRequestId: 'r1' },
    {
      runner: fakeRunner(okRun(JSON.stringify({
        summary: 'tries to execute',
        findings: [],
        autoSend: true,
      }))),
      launcherResolver: fakeLauncherResolver,
    },
  );

  assert.equal(result.ok, false);
  assert.equal(result.failureReason, 'review-result-forbidden-autoSend');
});

test('adapter fails closed on bad JSON and on non-zero exit', async () => {
  const adapter = createClaudeReviewCommandAdapter();

  const badJson = await adapter.review(
    { prompt: 'p', reviewRequestId: 'r1' },
    { runner: fakeRunner(okRun('not json')), launcherResolver: fakeLauncherResolver },
  );
  assert.equal(badJson.ok, false);
  assert.equal(badJson.failureReason, 'review-result-invalid-json');

  const nonZero = await adapter.review(
    { prompt: 'p', reviewRequestId: 'r1' },
    { runner: fakeRunner({ exitCode: 2, stdout: '', stderr: 'err', timedOut: false }), launcherResolver: fakeLauncherResolver },
  );
  assert.equal(nonZero.ok, false);
  assert.equal(nonZero.failureReason, 'command-nonzero-exit');
});

test('adapter never invokes a non-allowlisted command', async () => {
  let called = false;
  const adapter = createCommandReviewAdapter({
    adapterName: 'rogue',
    command: 'bash',
    buildArgs: () => ['-c', 'echo pwn'],
  });
  const result = await adapter.review(
    { prompt: 'p', reviewRequestId: 'r1' },
    {
      runner: {
        async run() {
          called = true;
          return okRun('{}');
        },
      },
    },
  );
  assert.equal(called, false);
  assert.equal(result.ok, false);
  assert.equal(result.failureReason, 'command-not-allowlisted');
});

test('selectReviewText handles bare JSON, Claude envelope, and Codex JSONL shapes', () => {
  const reviewJson = '{"summary":"ok","findings":["none"]}';

  // 1. bare ReviewResult JSON
  assert.equal(
    selectReviewText({ ok: true, stdout: reviewJson, stderr: '', exitCode: 0, durationMs: 1, timedOut: false, truncated: false }),
    reviewJson,
  );

  // 2. Claude --output-format json envelope: ReviewResult inside `result`
  const envelope = JSON.stringify({ type: 'result', result: reviewJson });
  assert.equal(
    selectReviewText({ ok: true, stdout: envelope, stderr: '', exitCode: 0, durationMs: 1, timedOut: false, truncated: false }),
    reviewJson,
  );

  // 3. Codex --json JSONL stream: last event carrying text wins
  const jsonl = [
    JSON.stringify({ type: 'task_started' }),
    JSON.stringify({ type: 'item', message: reviewJson }),
  ].join('\n');
  assert.equal(
    selectReviewText({ ok: true, stdout: jsonl, stderr: '', exitCode: 0, durationMs: 1, timedOut: false, truncated: false }),
    reviewJson,
  );

  // 4. Real Codex `exec --json` shape: agent_message nested under item.text
  const codexStream = [
    JSON.stringify({ type: 'thread.started', thread_id: 't1' }),
    JSON.stringify({ type: 'turn.started' }),
    JSON.stringify({ type: 'item.completed', item: { id: 'item_0', type: 'agent_message', text: reviewJson } }),
    JSON.stringify({ type: 'turn.completed' }),
  ].join('\n');
  assert.equal(
    selectReviewText({ ok: true, stdout: codexStream, stderr: '', exitCode: 0, durationMs: 1, timedOut: false, truncated: false }),
    reviewJson,
  );
});

test('adapter parses a Claude envelope-wrapped ReviewResult end to end', async () => {
  const adapter = createClaudeReviewCommandAdapter();
  const inner = JSON.stringify({ summary: 'wrapped ok', findings: ['x'] });
  const result = await adapter.review(
    { prompt: 'p', reviewRequestId: 'r1', resultId: 'res-1', now },
    {
      runner: fakeRunner(okRun(JSON.stringify({ type: 'result', result: inner }))),
      launcherResolver: fakeLauncherResolver,
    },
  );
  assert.equal(result.ok, true);
  assert.equal(result.result.summary, 'wrapped ok');
});

test('adapter still rejects execution fields inside a Claude envelope', async () => {
  const adapter = createClaudeReviewCommandAdapter();
  const inner = JSON.stringify({ summary: 'x', findings: [], autoSend: true });
  const result = await adapter.review(
    { prompt: 'p', reviewRequestId: 'r1' },
    {
      runner: fakeRunner(okRun(JSON.stringify({ type: 'result', result: inner }))),
      launcherResolver: fakeLauncherResolver,
    },
  );
  assert.equal(result.ok, false);
  assert.equal(result.failureReason, 'review-result-forbidden-autoSend');
});

test('a returned command review result drives PendingReview to returned with a draft follow-up', async () => {
  const registry = new InMemoryEndpointRegistry([
    ...DEFAULT_AGENT_ENDPOINTS,
    CLAUDE_CODE_REVIEW_COMMAND_ENDPOINT,
    CODEX_REVIEW_COMMAND_ENDPOINT,
  ]);
  const packetStore = new InMemoryPacketStore();
  const auditLog = new InMemoryAuditLog();
  const pendingPromptStore = new InMemoryPendingPromptStore(packetStore, auditLog);
  const pendingReviewStore = new InMemoryPendingReviewStore(
    registry,
    packetStore,
    auditLog,
    pendingPromptStore,
  );

  const review = pendingReviewStore.createDraft({
    id: 'review-1',
    sessionId: 'session-1',
    sourceEndpointId: 'codex-command',
    targetEndpointId: 'claude-code-command',
    prompt: 'Review the Codex output',
    now,
  });
  pendingReviewStore.preview(review.id, now + 1);
  pendingReviewStore.confirm(review.id, now + 2);
  pendingReviewStore.sendConfirmed(review.id, now + 3);

  const adapter = createClaudeReviewCommandAdapter();
  const reviewResult = await adapter.review(
    { prompt: 'Review the Codex output', reviewRequestId: review.id, id: 'res-1', now: now + 4 },
    {
      runner: fakeRunner(okRun(JSON.stringify({
        summary: 'minor issue',
        findings: ['add null check'],
        nextPromptDraft: 'Ask Codex to add a null check after confirmation',
      }))),
      launcherResolver: fakeLauncherResolver,
    },
  );
  assert.equal(reviewResult.ok, true);

  const returned = pendingReviewStore.returnResult(review.id, {
    id: reviewResult.result.id,
    summary: reviewResult.result.summary,
    findings: reviewResult.result.findings,
    nextPromptDraft: reviewResult.result.nextPromptDraft,
    now: now + 5,
  });

  assert.equal(returned.ok, true);
  assert.equal(pendingReviewStore.get(review.id).status, 'returned');
  assert.equal(returned.nextPrompt.status, 'draft');

  // The draft follow-up must NOT be auto-sendable without an explicit confirm.
  const sendResult = await pendingPromptStore.sendConfirmedPrompt(
    returned.nextPrompt.id,
    { name: 'mock', sendPrompt: async () => ({ ok: true, transport: 'mock' }) },
    now + 6,
  );
  assert.equal(sendResult.ok, false);
  assert.equal(sendResult.failureReason, 'pending-prompt-not-confirmed');
});
