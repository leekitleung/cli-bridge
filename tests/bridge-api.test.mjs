import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ALLOWED_EXTENSION_ORIGIN,
  PAIRING_TOKEN_HEADER,
} from '../packages/shared/src/constants.ts';
import { startLocalServer } from '../apps/local-server/src/server.ts';

function closer(handle) {
  return async () => {
    await new Promise((resolve, reject) => {
      handle.server.close((error) => (error ? reject(error) : resolve(undefined)));
    });
  };
}

function authHeaders(handle, extra = {}) {
  return {
    origin: ALLOWED_EXTENSION_ORIGIN,
    [PAIRING_TOKEN_HEADER]: handle.pairingToken,
    'content-type': 'application/json',
    ...extra,
  };
}

test('bridge endpoints require origin and pairing token like protected health', async (t) => {
  const handle = await startLocalServer(0);
  t.after(closer(handle));

  // No Origin header cannot be a cross-site request on a loopback-bound server,
  // so the pairing token is the gate: no-origin + valid token succeeds.
  const noOrigin = await fetch(`${handle.url}/bridge/metrics`, {
    headers: { [PAIRING_TOKEN_HEADER]: handle.pairingToken },
  });
  assert.equal(noOrigin.status, 200);

  // A cross-origin (non-allowlisted) request is still blocked even with a token.
  const crossOrigin = await fetch(`${handle.url}/bridge/metrics`, {
    headers: { origin: 'https://evil.example', [PAIRING_TOKEN_HEADER]: handle.pairingToken },
  });
  assert.equal(crossOrigin.status, 403);

  const noToken = await fetch(`${handle.url}/bridge/metrics`, {
    headers: { origin: ALLOWED_EXTENSION_ORIGIN },
  });
  assert.equal(noToken.status, 401);

  const badToken = await fetch(`${handle.url}/bridge/metrics`, {
    headers: { origin: ALLOWED_EXTENSION_ORIGIN, [PAIRING_TOKEN_HEADER]: 'wrong' },
  });
  assert.equal(badToken.status, 403);
});

test('bridge runs a full create -> confirm -> send (mock) -> metrics loop over HTTP', async (t) => {
  const handle = await startLocalServer(0);
  t.after(closer(handle));

  const createPacket = await fetch(`${handle.url}/bridge/packets`, {
    method: 'POST',
    headers: authHeaders(handle),
    body: JSON.stringify({ sessionId: 's1', content: 'OPENAI=sk-abcdefghijklmnopqrstuvwxyz123456 build output' }),
  });
  assert.equal(createPacket.status, 201);
  const packetBody = await createPacket.json();
  assert.equal(packetBody.packet.sessionId, 's1');
  // redaction applied, raw secret not present, raw content not serialized
  assert.match(packetBody.packet.processedContent, /\[REDACTED_OPENAI_KEY\]/);
  assert.equal(JSON.stringify(packetBody).includes('sk-abcdefghijklmnopqrstuvwxyz123456'), false);
  assert.equal('rawContent' in packetBody.packet, false);

  const createPrompt = await fetch(`${handle.url}/bridge/pending-prompts`, {
    method: 'POST',
    headers: authHeaders(handle),
    body: JSON.stringify({ sessionId: 's1', prompt: 'next codex prompt' }),
  });
  assert.equal(createPrompt.status, 201);
  const promptBody = await createPrompt.json();
  const promptId = promptBody.pendingPrompt.id;
  assert.equal(promptBody.pendingPrompt.status, 'draft');

  // cannot send before confirm
  const earlySend = await fetch(`${handle.url}/bridge/pending-prompts/send`, {
    method: 'POST',
    headers: authHeaders(handle),
    body: JSON.stringify({ promptId }),
  });
  assert.equal(earlySend.status, 409);

  const confirm = await fetch(`${handle.url}/bridge/pending-prompts/confirm`, {
    method: 'POST',
    headers: authHeaders(handle),
    body: JSON.stringify({ promptId }),
  });
  assert.equal(confirm.status, 200);
  assert.equal((await confirm.json()).pendingPrompt.status, 'confirmed');

  const send = await fetch(`${handle.url}/bridge/pending-prompts/send`, {
    method: 'POST',
    headers: authHeaders(handle),
    body: JSON.stringify({ promptId }),
  });
  assert.equal(send.status, 200);
  const sendBody = await send.json();
  assert.equal(sendBody.pendingPrompt.status, 'sent');
  assert.equal(sendBody.delivery.transport, 'mock');

  const metrics = await fetch(`${handle.url}/bridge/metrics`, {
    headers: authHeaders(handle),
  });
  assert.equal(metrics.status, 200);
  const metricsBody = await metrics.json();
  assert.equal(metricsBody.metrics.packetSentCount, 1);
  assert.ok(metricsBody.metrics.redactionHitCount >= 1);
});

test('bridge rejects malformed JSON with 400', async (t) => {
  const handle = await startLocalServer(0);
  t.after(closer(handle));

  const response = await fetch(`${handle.url}/bridge/packets`, {
    method: 'POST',
    headers: authHeaders(handle),
    body: '{ not valid json',
  });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).status, 'error');
});

test('bridge rejects missing required fields with 400', async (t) => {
  const handle = await startLocalServer(0);
  t.after(closer(handle));

  const response = await fetch(`${handle.url}/bridge/pending-prompts`, {
    method: 'POST',
    headers: authHeaders(handle),
    body: JSON.stringify({ sessionId: 's1' }),
  });
  assert.equal(response.status, 400);
});

test('bridge send of unknown prompt does not crash and returns 409', async (t) => {
  const handle = await startLocalServer(0);
  t.after(closer(handle));

  const response = await fetch(`${handle.url}/bridge/pending-prompts/send`, {
    method: 'POST',
    headers: authHeaders(handle),
    body: JSON.stringify({ promptId: 'does-not-exist' }),
  });
  assert.equal(response.status, 409);
});

test('bridge outbound queue claims redacted prompts and records fill acknowledgements', async (t) => {
  const handle = await startLocalServer(0);
  t.after(closer(handle));

  const createOutbound = await fetch(`${handle.url}/bridge/outbound`, {
    method: 'POST',
    headers: authHeaders(handle),
    body: JSON.stringify({
      sessionId: 's-out',
      prompt: 'OPENAI=sk-abcdefghijklmnopqrstuvwxyz123456 review this output',
    }),
  });
  assert.equal(createOutbound.status, 201);
  const createBody = await createOutbound.json();
  assert.equal(createBody.outboundPrompt.status, 'queued');
  assert.match(createBody.outboundPrompt.prompt, /\[REDACTED_OPENAI_KEY\]/);
  assert.equal(JSON.stringify(createBody).includes('sk-abcdefghijklmnopqrstuvwxyz123456'), false);

  const claimed = await fetch(`${handle.url}/bridge/outbound/next`, {
    headers: authHeaders(handle),
  });
  assert.equal(claimed.status, 200);
  const claimedBody = await claimed.json();
  assert.equal(claimedBody.outboundPrompt.id, createBody.outboundPrompt.id);
  assert.equal(claimedBody.outboundPrompt.status, 'claimed');

  const ack = await fetch(`${handle.url}/bridge/outbound/ack`, {
    method: 'POST',
    headers: authHeaders(handle),
    body: JSON.stringify({
      outboundPromptId: createBody.outboundPrompt.id,
      claimToken: claimedBody.outboundPrompt.claimToken,
      ok: true,
    }),
  });
  assert.equal(ack.status, 200);
  const ackBody = await ack.json();
  assert.equal(ackBody.outboundPrompt.status, 'waiting_manual_send');
  assert.equal(ackBody.outboundPrompt.evidence.at(-1).type, 'waiting-manual-send');

  const emptyClaim = await fetch(`${handle.url}/bridge/outbound/next`, {
    headers: authHeaders(handle),
  });
  assert.equal(emptyClaim.status, 200);
  assert.equal((await emptyClaim.json()).outboundPrompt, null);
});

test('bridge outbound Stage A status, report, and cancel are sanitized', async (t) => {
  const handle = await startLocalServer(0);
  t.after(closer(handle));

  const createOutbound = await fetch(`${handle.url}/bridge/outbound`, {
    method: 'POST',
    headers: authHeaders(handle),
    body: JSON.stringify({
      sessionId: 's-stage-a',
      prompt: 'SECRET_TOKEN=super-secret stage a evidence',
    }),
  });
  assert.equal(createOutbound.status, 201);
  const created = (await createOutbound.json()).outboundPrompt;

  const statusBefore = await fetch(`${handle.url}/bridge/outbound/status`, {
    headers: authHeaders(handle),
  });
  assert.equal(statusBefore.status, 200);
  assert.equal((await statusBefore.json()).outboundStatus.queued, 1);

  const cancel = await fetch(`${handle.url}/bridge/outbound/cancel`, {
    method: 'POST',
    headers: authHeaders(handle),
    body: JSON.stringify({ outboundPromptId: created.id }),
  });
  assert.equal(cancel.status, 200);
  assert.equal((await cancel.json()).outboundPrompt.status, 'cancelled');

  const report = await fetch(`${handle.url}/bridge/outbound/report`, {
    headers: authHeaders(handle),
  });
  assert.equal(report.status, 200);
  const body = await report.json();
  assert.equal(body.outboundReport.status.cancelled, 1);
  assert.equal(body.outboundReport.prompts[0].status, 'cancelled');
  assert.equal('prompt' in body.outboundReport.prompts[0], false);
  assert.equal(JSON.stringify(body).includes('super-secret'), false);
  assert.equal(JSON.stringify(body).includes(handle.pairingToken), false);
});

test('bridge outbound Stage B stage endpoint advances one-round states in order', async (t) => {
  const handle = await startLocalServer(0);
  t.after(closer(handle));

  const create = await fetch(`${handle.url}/bridge/outbound`, {
    method: 'POST',
    headers: authHeaders(handle),
    body: JSON.stringify({ sessionId: 's-stage-b', prompt: 'auto relay' }),
  });
  assert.equal(create.status, 201);
  const created = (await create.json()).outboundPrompt;
  assert.match(created.authorization.contentHash, /^sha256:/);

  const claim = await fetch(`${handle.url}/bridge/outbound/next`, { headers: authHeaders(handle) });
  const claimed = (await claim.json()).outboundPrompt;
  const earlyResponding = await fetch(`${handle.url}/bridge/outbound/stage`, {
    method: 'POST',
    headers: authHeaders(handle),
    body: JSON.stringify({ outboundPromptId: created.id, stage: 'responding' }),
  });
  assert.equal(earlyResponding.status, 409);

  const ack = await fetch(`${handle.url}/bridge/outbound/ack`, {
    method: 'POST',
    headers: authHeaders(handle),
    body: JSON.stringify({ outboundPromptId: created.id, claimToken: claimed.claimToken, ok: true }),
  });
  assert.equal(ack.status, 200);

  for (const [stage, expected] of [
    ['submitted', 'submitted'],
    ['responding', 'responding'],
    ['response-ready', 'response_ready'],
    ['returned', 'returned'],
  ]) {
    const response = await fetch(`${handle.url}/bridge/outbound/stage`, {
      method: 'POST',
      headers: authHeaders(handle),
      body: JSON.stringify({ outboundPromptId: created.id, stage }),
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).outboundPrompt.status, expected);
  }

  const failCreate = await fetch(`${handle.url}/bridge/outbound`, {
    method: 'POST',
    headers: authHeaders(handle),
    body: JSON.stringify({ sessionId: 's-stage-b-fail', prompt: 'auto relay timeout' }),
  });
  const failCreated = (await failCreate.json()).outboundPrompt;
  const failClaim = await fetch(`${handle.url}/bridge/outbound/next`, { headers: authHeaders(handle) });
  const failClaimed = (await failClaim.json()).outboundPrompt;
  await fetch(`${handle.url}/bridge/outbound/ack`, {
    method: 'POST',
    headers: authHeaders(handle),
    body: JSON.stringify({ outboundPromptId: failCreated.id, claimToken: failClaimed.claimToken, ok: true }),
  });
  const failed = await fetch(`${handle.url}/bridge/outbound/stage`, {
    method: 'POST',
    headers: authHeaders(handle),
    body: JSON.stringify({ outboundPromptId: failCreated.id, stage: 'failed', failureReason: 'streaming' }),
  });
  assert.equal(failed.status, 200);
  const failedBody = await failed.json();
  assert.equal(failedBody.outboundPrompt.status, 'failed');
  assert.equal(failedBody.outboundPrompt.failureReason, 'streaming');
});

test('bridge Stage C loop routes create, advance, report, pause and cancel', async (t) => {
  const handle = await startLocalServer(0);
  t.after(closer(handle));

  const create = await fetch(`${handle.url}/bridge/loops`, {
    method: 'POST',
    headers: authHeaders(handle),
    body: JSON.stringify({
      projectId: 'cli-bridge',
      goalId: 'goal-stage-c',
      sessionId: 'loop-http',
      initialPrompt: 'round one',
      maxRounds: 2,
    }),
  });
  assert.equal(create.status, 201);
  const created = await create.json();
  assert.equal(created.loop.status, 'running');
  assert.equal(created.loop.round, 1);
  assert.equal(created.outboundPrompt.loopId, created.loop.id);

  const claim = await fetch(`${handle.url}/bridge/outbound/next`, { headers: authHeaders(handle) });
  const claimed = (await claim.json()).outboundPrompt;
  await fetch(`${handle.url}/bridge/outbound/ack`, {
    method: 'POST',
    headers: authHeaders(handle),
    body: JSON.stringify({ outboundPromptId: claimed.id, claimToken: claimed.claimToken, ok: true }),
  });
  for (const stage of ['submitted', 'responding', 'response-ready', 'returned']) {
    await fetch(`${handle.url}/bridge/outbound/stage`, {
      method: 'POST',
      headers: authHeaders(handle),
      body: JSON.stringify({ outboundPromptId: claimed.id, stage }),
    });
  }

  const advance = await fetch(`${handle.url}/bridge/loops/advance`, {
    method: 'POST',
    headers: authHeaders(handle),
    body: JSON.stringify({
      loopId: created.loop.id,
      inboundContent: 'first reply',
      nextPrompt: 'round two',
    }),
  });
  assert.equal(advance.status, 200);
  const advanced = await advance.json();
  assert.equal(advanced.loop.round, 2);
  assert.equal(advanced.outboundPrompt.loopId, created.loop.id);

  const report = await fetch(`${handle.url}/bridge/loops/report`, { headers: authHeaders(handle) });
  assert.equal(report.status, 200);
  assert.equal((await report.json()).loopReport.loops.length, 1);

  const pause = await fetch(`${handle.url}/bridge/loops/pause`, {
    method: 'POST',
    headers: authHeaders(handle),
    body: JSON.stringify({ loopId: created.loop.id }),
  });
  assert.equal(pause.status, 200);
  assert.equal((await pause.json()).loop.status, 'paused');

  const cancel = await fetch(`${handle.url}/bridge/loops/cancel`, {
    method: 'POST',
    headers: authHeaders(handle),
    body: JSON.stringify({ loopId: created.loop.id }),
  });
  assert.equal(cancel.status, 200);
  assert.equal((await cancel.json()).loop.status, 'cancelled');
});

test('bridge Stage C loop route rejects maxRounds beyond hard cap', async (t) => {
  const handle = await startLocalServer(0);
  t.after(closer(handle));

  const create = await fetch(`${handle.url}/bridge/loops`, {
    method: 'POST',
    headers: authHeaders(handle),
    body: JSON.stringify({
      projectId: 'cli-bridge',
      goalId: 'goal-stage-c',
      sessionId: 'loop-http',
      initialPrompt: 'round one',
      maxRounds: 11,
    }),
  });
  assert.equal(create.status, 400);
  assert.match((await create.json()).message, /hard maximum/);
});

test('bridge Stage C loop report is sanitized and default bounded', async (t) => {
  const handle = await startLocalServer(0);
  t.after(closer(handle));

  const secretPrompt = 'round one with OPENAI=sk-abcdefghijklmnopqrstuvwxyz123456';
  const create = await fetch(`${handle.url}/bridge/loops`, {
    method: 'POST',
    headers: authHeaders(handle),
    body: JSON.stringify({
      projectId: 'cli-bridge',
      goalId: 'goal-stage-c-sanitized',
      sessionId: 'loop-http-sanitized',
      initialPrompt: secretPrompt,
    }),
  });
  assert.equal(create.status, 201);
  const created = await create.json();
  assert.equal(created.loop.maxRounds, 3);
  assert.equal(JSON.stringify(created).includes('sk-abcdefghijklmnopqrstuvwxyz123456'), false);

  const earlyAdvance = await fetch(`${handle.url}/bridge/loops/advance`, {
    method: 'POST',
    headers: authHeaders(handle),
    body: JSON.stringify({
      loopId: created.loop.id,
      inboundContent: 'reply before current outbound returns',
      nextPrompt: 'must not be created',
    }),
  });
  assert.equal(earlyAdvance.status, 409);
  const earlyBody = await earlyAdvance.json();
  assert.match(earlyBody.message, /has not returned/);

  const report = await fetch(`${handle.url}/bridge/loops/report`, { headers: authHeaders(handle) });
  assert.equal(report.status, 200);
  const body = await report.json();
  assert.equal(body.loopReport.loops.length, 1);
  const loop = body.loopReport.loops[0];
  assert.equal(loop.id, created.loop.id);
  assert.equal(loop.maxRounds, 3);
  assert.equal(Array.isArray(loop.evidence), true);
  assert.equal('currentOutboundPromptId' in loop, false);
  assert.equal('seenContentHashes' in loop, false);
  assert.equal('lastProgressHash' in loop, false);
  assert.equal(JSON.stringify(body).includes('sk-abcdefghijklmnopqrstuvwxyz123456'), false);

  const list = await fetch(`${handle.url}/bridge/loops`, { headers: authHeaders(handle) });
  assert.equal(list.status, 200);
  const listBody = await list.json();
  assert.equal(listBody.loops.length, 1);
  assert.equal(listBody.loops[0].id, created.loop.id);
  assert.equal('currentOutboundPromptId' in listBody.loops[0], false);
  assert.equal('seenContentHashes' in listBody.loops[0], false);
  assert.equal('lastProgressHash' in listBody.loops[0], false);
  assert.equal(JSON.stringify(listBody).includes('sk-abcdefghijklmnopqrstuvwxyz123456'), false);
});

test('bridge does not expose any shell-style endpoint', async (t) => {
  const handle = await startLocalServer(0);
  t.after(closer(handle));

  for (const path of ['/bridge/exec', '/bridge/shell', '/bridge/command', '/bridge/run-shell']) {
    const response = await fetch(`${handle.url}${path}`, {
      headers: authHeaders(handle),
    });
    assert.equal(response.status, 404, `${path} must not exist`);
  }
});

// §7.4 Goal endpoints — gate tests

test('/bridge/goals endpoints require origin + pairing token', async (t) => {
  const handle = await startLocalServer(0);
  t.after(closer(handle));

  const paths = [
    '/bridge/goals',
    '/bridge/goals/plan',
    '/bridge/goals/approve',
    '/bridge/goals/step',
    '/bridge/goals/gate',
    '/bridge/goals/cancel',
  ];

  for (const path of paths) {
    // No auth at all.
    const noAuth = await fetch(`${handle.url}${path}`);
    assert.ok(
      noAuth.status === 401 || noAuth.status === 403,
      `${path} without auth: expected 401/403, got ${noAuth.status}`,
    );

    // Wrong token.
    const badToken = await fetch(`${handle.url}${path}`, {
      headers: { origin: ALLOWED_EXTENSION_ORIGIN, [PAIRING_TOKEN_HEADER]: 'wrong' },
    });
    assert.equal(badToken.status, 403, `${path} with bad token`);
  }
});

test('/bridge/run is NOT exposed as a goal endpoint', async (t) => {
  const handle = await startLocalServer(0);
  t.after(closer(handle));

  const res = await fetch(`${handle.url}/bridge/goals/run`, {
    headers: authHeaders(handle),
  });
  assert.equal(res.status, 404, '/bridge/goals/run must not exist');
});

test('/bridge/goals basic create → list flow over HTTP', async (t) => {
  const handle = await startLocalServer(0);
  t.after(closer(handle));

  const create = await fetch(`${handle.url}/bridge/goals`, {
    method: 'POST',
    headers: authHeaders(handle),
    body: JSON.stringify({ sessionId: 's-gate', description: 'Server integration test' }),
  });
  assert.equal(create.status, 201);
  const createBody = await create.json();
  assert.ok(createBody.goal.id);
  assert.equal(createBody.goal.status, 'draft');

  const list = await fetch(`${handle.url}/bridge/goals`, {
    headers: authHeaders(handle),
  });
  assert.equal(list.status, 200);
  const listBody = await list.json();
  assert.equal(listBody.goals.length, 1);
  assert.equal(listBody.goals[0].goal.id, createBody.goal.id);
});
