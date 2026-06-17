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
  assert.equal(delivered.status, 'delivered');
  assert.equal(delivered.claimToken, undefined);
});
