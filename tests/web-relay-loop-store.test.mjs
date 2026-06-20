import assert from 'node:assert/strict';
import test from 'node:test';

import { InMemoryAuditLog } from '../apps/local-server/src/storage/audit-log.ts';
import { InMemoryPacketStore } from '../apps/local-server/src/storage/packet-store.ts';
import { InMemoryOutboundPromptStore } from '../apps/local-server/src/storage/outbound-prompt-store.ts';
import { InMemoryWebRelayLoopStore } from '../apps/local-server/src/storage/web-relay-loop-store.ts';

function setup() {
  const auditLog = new InMemoryAuditLog();
  const packetStore = new InMemoryPacketStore();
  const outboundStore = new InMemoryOutboundPromptStore(packetStore, auditLog);
  const loopStore = new InMemoryWebRelayLoopStore(outboundStore);
  return { outboundStore, loopStore };
}

function createLoop(loopStore, overrides = {}) {
  const result = loopStore.create({
    projectId: 'cli-bridge',
    goalId: 'goal-stage-c',
    sessionId: 'loop-session',
    endpointId: 'mock-inbound-agent',
    initialPrompt: 'round one prompt',
    now: 1000,
    ...overrides,
  });
  assert.equal(result.error, undefined);
  assert.ok(result.loop);
  assert.ok(result.outboundPrompt);
  return result;
}

function returnOutbound(outboundStore, outboundPromptId, now = 2000) {
  const claimed = outboundStore.claimNext(now);
  assert.equal(claimed.id, outboundPromptId);
  const acknowledged = outboundStore.acknowledge({
    id: outboundPromptId,
    claimToken: claimed.claimToken,
    ok: true,
    now: now + 1,
  });
  assert.equal(acknowledged.status, 'waiting_manual_send');
  assert.equal(outboundStore.markSubmitted(outboundPromptId, now + 2).status, 'submitted');
  assert.equal(outboundStore.markResponding(outboundPromptId, now + 3).status, 'responding');
  assert.equal(outboundStore.markResponseReady(outboundPromptId, now + 4).status, 'response_ready');
  assert.equal(outboundStore.markReturned(outboundPromptId, now + 5).status, 'returned');
}

test('web relay loop creates one outbound and advances to the next bounded round', () => {
  const { outboundStore, loopStore } = setup();
  const first = createLoop(loopStore, { maxRounds: 2 });
  assert.equal(first.loop.status, 'running');
  assert.equal(first.loop.round, 1);
  assert.equal(first.outboundPrompt.loopId, first.loop.id);

  returnOutbound(outboundStore, first.outboundPrompt.id);
  const advanced = loopStore.advance({
    loopId: first.loop.id,
    inboundContent: 'first reply',
    nextPrompt: 'round two prompt',
    now: 3000,
  });
  assert.equal(advanced.error, undefined);
  assert.equal(advanced.loop.round, 2);
  assert.equal(advanced.outboundPrompt.loopId, first.loop.id);

  returnOutbound(outboundStore, advanced.outboundPrompt.id, 4000);
  const stopped = loopStore.advance({
    loopId: first.loop.id,
    inboundContent: 'second reply',
    nextPrompt: 'must not be created',
    now: 5000,
  });
  assert.equal(stopped.loop.status, 'done');
  assert.equal(stopped.loop.evidence.at(-1).reason, 'max-rounds-reached');
  assert.equal(stopped.outboundPrompt, undefined);
});

test('web relay loop enforces hard maximum of ten rounds', () => {
  const { loopStore } = setup();
  const result = loopStore.create({
    projectId: 'cli-bridge',
    goalId: 'goal-stage-c',
    sessionId: 'loop-session',
    endpointId: 'mock-inbound-agent',
    initialPrompt: 'round one prompt',
    maxRounds: 11,
  });
  assert.equal(result.error, 'maxRounds exceeds hard maximum of 10');
});

test('web relay loop pause, resume, and cancel prevent next outbound creation', () => {
  const { outboundStore, loopStore } = setup();
  const created = createLoop(loopStore);
  assert.equal(loopStore.pause(created.loop.id).status, 'paused');
  const pausedAdvance = loopStore.advance({
    loopId: created.loop.id,
    inboundContent: 'reply while paused',
    nextPrompt: 'blocked',
  });
  assert.equal(pausedAdvance.error, 'Loop is not running');
  assert.equal(loopStore.resume(created.loop.id).status, 'running');
  const cancelled = loopStore.cancel(created.loop.id);
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(outboundStore.getPrompt(created.outboundPrompt.id).status, 'cancelled');
});

test('web relay loop fails closed on repeated content', () => {
  const { outboundStore, loopStore } = setup();
  const first = createLoop(loopStore, { maxRounds: 3 });
  returnOutbound(outboundStore, first.outboundPrompt.id);
  const second = loopStore.advance({
    loopId: first.loop.id,
    inboundContent: 'same reply',
    nextPrompt: 'round two prompt',
    now: 3000,
  });
  returnOutbound(outboundStore, second.outboundPrompt.id, 4000);
  const repeated = loopStore.advance({
    loopId: first.loop.id,
    inboundContent: 'same reply',
    nextPrompt: 'round three prompt',
    now: 5000,
  });
  assert.equal(repeated.loop.status, 'failed');
  assert.equal(repeated.error, 'repeated-content');
});

test('web relay loop fails closed on no-progress threshold', () => {
  const { outboundStore, loopStore } = setup();
  const first = createLoop(loopStore, { maxRounds: 3, noProgressLimit: 1 });
  returnOutbound(outboundStore, first.outboundPrompt.id);
  const second = loopStore.advance({
    loopId: first.loop.id,
    inboundContent: 'first distinct reply',
    progressHash: 'sha256:0000000000000000000000000000000000000000000000000000000000000001',
    nextPrompt: 'round two prompt',
    now: 3000,
  });
  returnOutbound(outboundStore, second.outboundPrompt.id, 4000);
  const stopped = loopStore.advance({
    loopId: first.loop.id,
    inboundContent: 'second distinct reply',
    progressHash: 'sha256:0000000000000000000000000000000000000000000000000000000000000001',
    nextPrompt: 'round three prompt',
    now: 5000,
  });
  assert.equal(stopped.loop.status, 'failed');
  assert.equal(stopped.error, 'no-progress');
});

test('web relay loop rejects advance before current outbound returned', () => {
  const { loopStore } = setup();
  const created = createLoop(loopStore);
  const advanced = loopStore.advance({
    loopId: created.loop.id,
    inboundContent: 'premature reply',
    nextPrompt: 'blocked',
    now: 3000,
  });
  assert.equal(advanced.error, 'Current outbound has not returned');
});

test('web relay loop fails closed on uncertain submitted round after restart', () => {
  const { outboundStore, loopStore } = setup();
  const created = createLoop(loopStore);
  const claimed = outboundStore.claimNext(2000);
  outboundStore.acknowledge({
    id: created.outboundPrompt.id,
    claimToken: claimed.claimToken,
    ok: true,
    now: 2001,
  });
  outboundStore.markSubmitted(created.outboundPrompt.id, 2002);
  const advanced = loopStore.advance({
    loopId: created.loop.id,
    inboundContent: 'reply',
    nextPrompt: 'must not replay',
    now: 3000,
  });
  assert.equal(advanced.loop.status, 'failed');
  assert.equal(advanced.error, 'uncertain-submission');
});

test('web relay loop hydration recovery does not replay uncertain submitted outbound', () => {
  const { outboundStore, loopStore } = setup();
  const created = createLoop(loopStore);
  const claimed = outboundStore.claimNext(2000);
  outboundStore.acknowledge({
    id: created.outboundPrompt.id,
    claimToken: claimed.claimToken,
    ok: true,
    now: 2001,
  });
  outboundStore.markSubmitted(created.outboundPrompt.id, 2002);

  const restoredLoopStore = new InMemoryWebRelayLoopStore(outboundStore);
  assert.equal(restoredLoopStore.hydrateLoops(loopStore.exportLoops()), 1);
  assert.equal(restoredLoopStore.recoverAfterRestart(3000), 1);

  const loop = restoredLoopStore.get(created.loop.id);
  const outbound = outboundStore.getPrompt(created.outboundPrompt.id);
  assert.equal(loop.status, 'failed');
  assert.equal(loop.failureReason, 'restart-uncertain-submission');
  assert.equal(outbound.status, 'failed');
  assert.equal(outbound.failureReason, 'restart-uncertain-submission');

  const advanced = restoredLoopStore.advance({
    loopId: created.loop.id,
    inboundContent: 'reply',
    nextPrompt: 'must not replay',
    now: 4000,
  });
  assert.equal(advanced.error, 'Loop is not running');
  assert.equal(restoredLoopStore.list().length, 1);
});

test('web relay loop hydration recovery leaves returned rounds resumable from metadata', () => {
  const { outboundStore, loopStore } = setup();
  const created = createLoop(loopStore, { maxRounds: 2 });
  returnOutbound(outboundStore, created.outboundPrompt.id, 2000);

  const restoredLoopStore = new InMemoryWebRelayLoopStore(outboundStore);
  assert.equal(restoredLoopStore.hydrateLoops(loopStore.exportLoops()), 1);
  assert.equal(restoredLoopStore.recoverAfterRestart(3000), 0);
  const advanced = restoredLoopStore.advance({
    loopId: created.loop.id,
    inboundContent: 'reply after restart',
    nextPrompt: 'round two prompt',
    now: 4000,
  });
  assert.equal(advanced.error, undefined);
  assert.equal(advanced.loop.round, 2);
  assert.equal(advanced.outboundPrompt.loopId, created.loop.id);
});

test('web relay loop enforces per-round timeout and total deadline', () => {
  const { outboundStore, loopStore } = setup();
  const timed = createLoop(loopStore, {
    perRoundTimeoutMs: 10,
    totalDeadlineMs: 10_000,
  });
  returnOutbound(outboundStore, timed.outboundPrompt.id, 2000);
  const roundTimeout = loopStore.advance({
    loopId: timed.loop.id,
    inboundContent: 'late reply',
    nextPrompt: 'blocked',
    now: 3000,
  });
  assert.equal(roundTimeout.error, 'per-round-timeout');

  const deadline = createLoop(loopStore, {
    id: 'deadline-loop',
    totalDeadlineMs: 10,
  });
  returnOutbound(outboundStore, deadline.outboundPrompt.id, 4000);
  const expired = loopStore.advance({
    loopId: deadline.loop.id,
    inboundContent: 'reply',
    nextPrompt: 'blocked',
    now: 5000,
  });
  assert.equal(expired.error, 'total-deadline-reached');
});
