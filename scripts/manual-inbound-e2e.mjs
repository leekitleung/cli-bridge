// Manual inbound-routing E2E helper.
//
// This DOES NOT auto-send, inject into a terminal, or write back to any
// executor. It only seeds the one precondition that REVIEW-INBOUND-ROUTING-E2E
// found missing for a real-browser test: an outbound prompt that carries an
// endpointId + sessionId, targeting an inbound-capable endpoint.
//
// Why this is needed (see docs/planning/PLAN-MULTI-EXECUTOR-RELAY.md runbook):
//   - The panel's manual "填入" button creates a packet with the panel's own
//     panel-<timestamp> session and NO endpointId, so it NEVER establishes a
//     relay context. extract-return for that session always falls back to a
//     pending-prompt.
//   - Only a delivered outbound that carries an endpointId writes a relay
//     context. The extension poller claims this outbound, fills the composer,
//     and acks delivery — which records both the relay context (server) and the
//     active relay session (panel). Extract then routes into the inbound queue.
//
// Usage (server must already be running; copy its pairing token):
//   node --experimental-strip-types scripts/manual-inbound-e2e.mjs \
//     --token <PAIRING_TOKEN> [--session s-manual-1] \
//     [--base http://127.0.0.1:31337] [--prompt "review this output"]
//
// Then in the browser:
//   1. The extension poller fills the ChatGPT composer (no auto-send).
//   2. Send the message manually; wait for the reply.
//   3. Select the reply text to return, then click "预览回传".
//   4. Review the preview and click "确认回传".
//   5. Verify: this script's printed inbound-check URL shows the reviewed reply.

import process from 'node:process';

import {
  ALLOWED_EXTENSION_ORIGIN,
  LOCAL_SERVER_BASE_URL,
  PAIRING_TOKEN_HEADER,
} from '../packages/shared/src/constants.ts';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith('--')) {
      const key = token.slice(2);
      const value = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[(i += 1)] : 'true';
      args[key] = value;
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const token = args.token ?? process.env.CLI_BRIDGE_PAIRING_TOKEN;
  if (!token) {
    console.error('Missing pairing token. Pass --token <PAIRING_TOKEN> or set CLI_BRIDGE_PAIRING_TOKEN.');
    process.exitCode = 1;
    return;
  }
  const base = args.base ?? LOCAL_SERVER_BASE_URL;
  const sessionId = args.session ?? `s-manual-${Date.now()}`;
  const endpointId = 'mock-inbound-agent';
  const prompt = args.prompt ?? 'review this output (manual inbound E2E)';

  const headers = {
    origin: ALLOWED_EXTENSION_ORIGIN,
    [PAIRING_TOKEN_HEADER]: token,
    'content-type': 'application/json',
  };

  const res = await fetch(`${base}/bridge/outbound`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ sessionId, prompt }),
  });
  const body = await res.json().catch(() => ({}));
  if (res.status !== 201) {
    console.error(`Failed to create outbound (status ${res.status}):`, body);
    process.exitCode = 1;
    return;
  }

  console.log('Created outbound prompt:');
  console.log(`  id:         ${body.outboundPrompt.id}`);
  console.log(`  sessionId:  ${sessionId}`);
  console.log(`  endpointId: ${endpointId}`);
  console.log('');
  console.log('Next steps in the browser:');
  console.log('  1. The extension poller fills the ChatGPT composer (no auto-send).');
  console.log('  2. Send the message manually and wait for the reply.');
  console.log('  3. Select the reply text to return, then click "预览回传".');
  console.log('  4. Review the preview and click "确认回传".');
  console.log('');
  console.log('Verify the reviewed reply landed in the inbound queue:');
  console.log(`  GET ${base}/bridge/inbound?endpointId=${endpointId}`);
  console.log(`  (header ${PAIRING_TOKEN_HEADER}: <token>, origin: ${ALLOWED_EXTENSION_ORIGIN})`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
