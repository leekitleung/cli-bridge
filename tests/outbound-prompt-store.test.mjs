import assert from 'node:assert/strict';
import test from 'node:test';

import { InMemoryAuditLog } from '../apps/local-server/src/storage/audit-log.ts';
import {
  CLAIMED_OUTBOUND_PROMPT_TTL_MS,
  InMemoryOutboundPromptStore,
} from '../apps/local-server/src/storage/outbound-prompt-store.ts';
import { InMemoryPacketStore } from '../apps/local-server/src/storage/packet-store.ts';

function createStore() {
  return new InMemoryOutboundPromptStore(
    new InMemoryPacketStore(),
    new InMemoryAuditLog(),
  );
}

test('claimNext fails a stale claimed outbound prompt instead of replaying it', () => {
  const store = createStore();
  const created = store.createOutboundPrompt({
    sessionId: 'session-lease',
    prompt: 'recover me',
    now: 1_000,
  });

  const firstClaim = store.claimNext(2_000);
  assert.equal(firstClaim.id, created.id);
  assert.equal(firstClaim.status, 'claimed');
  assert.equal(typeof firstClaim.claimToken, 'string');

  const tooSoon = store.claimNext(2_000 + CLAIMED_OUTBOUND_PROMPT_TTL_MS - 1);
  assert.equal(tooSoon, undefined);

  const replay = store.claimNext(2_000 + CLAIMED_OUTBOUND_PROMPT_TTL_MS + 1);
  assert.equal(replay, undefined);
  const [expired] = store.listPrompts();
  assert.equal(expired.status, 'failed');
  assert.equal(expired.failureReason, 'claim-lease-expired');
  assert.equal(expired.claimToken, undefined);
  assert.equal(store.acknowledge({
    id: created.id,
    claimToken: firstClaim.claimToken,
    ok: true,
    now: 2_000 + CLAIMED_OUTBOUND_PROMPT_TTL_MS + 2,
  }), undefined);
});

test('acknowledge requires the current claim token', () => {
  const store = createStore();
  const created = store.createOutboundPrompt({
    sessionId: 'session-fenced',
    prompt: 'fence me',
    now: 1_000,
  });
  const claimed = store.claimNext(2_000);

  assert.equal(store.acknowledge({
    id: created.id,
    claimToken: 'wrong-token',
    ok: true,
    now: 2_100,
  }), undefined);
  const delivered = store.acknowledge({
    id: created.id,
    claimToken: claimed.claimToken,
    ok: true,
    now: 2_101,
  });
  assert.equal(delivered.status, 'waiting_manual_send');
  assert.equal(delivered.claimToken, undefined);
  assert.equal(delivered.evidence.at(-1).type, 'waiting-manual-send');
});

test('outbound status report is sanitized and cancellation is terminal', () => {
  const store = createStore();
  const created = store.createOutboundPrompt({
    sessionId: 'session-report',
    prompt: 'SECRET_TOKEN=super-secret report me',
    now: 1_000,
  });
  const claimed = store.claimNext(2_000);
  const delivered = store.acknowledge({
    id: created.id,
    claimToken: claimed.claimToken,
    ok: true,
    now: 2_100,
  });
  assert.equal(delivered.status, 'waiting_manual_send');

  const cancelled = store.cancel(created.id, 2_200);
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.claimToken, undefined);

  const report = store.createAcceptanceReport(3_000);
  assert.equal(report.status.cancelled, 1);
  assert.equal(report.prompts[0].status, 'cancelled');
  assert.equal(JSON.stringify(report).includes('super-secret'), false);
  assert.equal(JSON.stringify(report).includes('SECRET_TOKEN'), false);
  assert.equal('prompt' in report.prompts[0], false);
});

test('Stage B outbound authorization and one-round state transitions are fenced', () => {
  const store = createStore();
  const created = store.createOutboundPrompt({
    sessionId: 'session-auto',
    prompt: 'auto relay',
    now: 1_000,
  });
  assert.equal(created.authorization.target, 'chatgpt-web');
  assert.match(created.authorization.contentHash, /^sha256:/);
  assert.equal(typeof created.authorization.expiresAt, 'number');

  const claimed = store.claimNext(2_000);
  const filled = store.acknowledge({
    id: created.id,
    claimToken: claimed.claimToken,
    ok: true,
    now: 2_100,
  });
  assert.equal(filled.status, 'waiting_manual_send');

  assert.equal(store.markResponding(created.id, 2_150), undefined);
  assert.equal(store.markSubmitted(created.id, 2_200).status, 'submitted');
  assert.equal(store.markResponding(created.id, 2_300).status, 'responding');
  assert.equal(store.markResponseReady(created.id, 2_400).status, 'response_ready');
  assert.equal(store.markReturned(created.id, 2_500).status, 'returned');
  assert.deepEqual(
    store.listPrompts()[0].evidence.map((event) => event.type),
    ['queued', 'claimed', 'filled-and-acknowledged', 'waiting-manual-send', 'submitted', 'responding', 'response-ready', 'returned'],
  );
});

test('Stage B expired authorization cannot be submitted', () => {
  const store = createStore();
  const created = store.createOutboundPrompt({
    sessionId: 'session-expire',
    prompt: 'expire relay',
    now: 1_000,
    expiresInMs: 100,
  });
  const claimed = store.claimNext(1_050);
  store.acknowledge({
    id: created.id,
    claimToken: claimed.claimToken,
    ok: true,
    now: 1_060,
  });

  assert.equal(store.markSubmitted(created.id, 1_200), undefined);
  assert.equal(store.listPrompts()[0].status, 'expired');
});
