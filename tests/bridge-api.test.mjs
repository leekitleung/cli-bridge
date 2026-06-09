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
      ok: true,
    }),
  });
  assert.equal(ack.status, 200);
  assert.equal((await ack.json()).outboundPrompt.status, 'delivered');

  const emptyClaim = await fetch(`${handle.url}/bridge/outbound/next`, {
    headers: authHeaders(handle),
  });
  assert.equal(emptyClaim.status, 200);
  assert.equal((await emptyClaim.json()).outboundPrompt, null);
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
