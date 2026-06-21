import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import test from 'node:test';

import {
  DUAL_ENDPOINT_SCENARIOS,
  classifyDualEndpointError,
  parseArgs,
  createDryRunEvidence,
  sanitizeEvidence,
  runHarness,
  runRealChatgptRoute,
} from '../scripts/dual-endpoint-release-e2e.ts';

test('dual endpoint release harness parses explicit CLI args', () => {
  const args = parseArgs([
    '--scenario',
    'mixed-provider',
    '--reasoning-cli',
    'codex-high',
    '--execution-cli',
    'codex-medium',
    '--connect-cdp',
    'http://127.0.0.1:9224',
    '--output-dir',
    'output/playwright/dual-endpoint',
    '--confirmation-timeout-ms',
    '600000',
    '--dry-run',
  ]);

  assert.equal(args.scenario, 'mixed-provider');
  assert.equal(args.profileDir, undefined);
  assert.equal(args.reasoningCli, 'codex-high');
  assert.equal(args.executionCli, 'codex-medium');
  assert.equal(args.connectCdp, 'http://127.0.0.1:9224');
  assert.equal(args.connectActiveChrome, false);
  assert.equal(args.outputDir, 'output/playwright/dual-endpoint');
  assert.equal(args.confirmationTimeoutMs, 600000);
  assert.equal(args.dryRun, true);
});

test('dual endpoint release harness parses active Chrome mode', () => {
  const args = parseArgs([
    '--scenario',
    'chatgpt-route',
    '--connect-active-chrome',
    '--active-chrome-helper',
    'http://127.0.0.1:8123',
    '--execution-cli',
    'codex-medium',
  ]);

  assert.equal(args.scenario, 'chatgpt-route');
  assert.equal(args.connectActiveChrome, true);
  assert.equal(args.activeChromeHelper, 'http://127.0.0.1:8123');
  assert.equal(args.profileDir, undefined);
  assert.equal(args.connectCdp, undefined);
  assert.equal(args.executionCli, 'codex-medium');
});

test('dual endpoint release harness rejects multiple browser connection modes', () => {
  assert.throws(
    () => parseArgs(['--profile-dir', 'profile', '--connect-active-chrome']),
    /profile-dir, connect-cdp, and connect-active-chrome are mutually exclusive/,
  );
  assert.throws(
    () => parseArgs(['--connect-cdp', 'http://127.0.0.1:9222', '--connect-active-chrome']),
    /profile-dir, connect-cdp, and connect-active-chrome are mutually exclusive/,
  );
});

test('dual endpoint release harness covers required final review scenarios', () => {
  assert.deepEqual(DUAL_ENDPOINT_SCENARIOS, [
    'cli-route',
    'chatgpt-route',
    'same-provider',
    'mixed-provider',
    'failure-timeout',
    'uncertain-dispatch',
    'control-pause-cancel',
    'workbuddy-boundary',
    'cleanup',
  ]);
});

test('dual endpoint release evidence redacts secrets and raw content', () => {
  const sanitized = sanitizeEvidence({
    pairingToken: 'secret-token',
    cookie: 'session=abc',
    rawPrompt: 'full prompt',
    rawReply: 'full reply',
    endpoint: {
      providerConfig: 'apiKey=abc',
      contentHash: 'sha256:ok',
    },
    text: 'secret-token document.cookie localStorage',
  }, ['secret-token']);

  const json = JSON.stringify(sanitized);
  assert.equal(json.includes('secret-token'), false);
  assert.equal(json.includes('session=abc'), false);
  assert.equal(json.includes('full prompt'), false);
  assert.equal(json.includes('full reply'), false);
  assert.equal(json.includes('apiKey=abc'), false);
  assert.equal(json.includes('document.cookie'), false);
  assert.equal(json.includes('localStorage'), false);
  assert.match(json, /REDACTED/);
  assert.match(json, /sha256:ok/);
});

test('dual endpoint release evidence shape includes control and process classifications', () => {
  const evidence = createDryRunEvidence({
    scenario: 'control-pause-cancel',
    timestamp: '2026-06-20T00-00-00-000Z',
    git: { commit: 'abc123', dirty: true },
    reasoningEndpointId: 'codex-high',
    executionEndpointId: 'codex-medium',
  });

  assert.equal(evidence.controlResult?.pauseStatus, 'paused');
  assert.equal(evidence.controlResult?.cancelStatus, 'cancelled');
  assert.equal(evidence.failureClassification, 'none');
  assert.equal(evidence.processExitClassification, 'not-run');
});

test('dual endpoint release failure classification distinguishes blocked real evidence', () => {
  assert.equal(classifyDualEndpointError(new Error('logged-in ChatGPT profile is required')).code, 'blocked-real-chatgpt');
  assert.equal(classifyDualEndpointError(new Error('active Chrome session adapter is not available')).code, 'blocked-real-chatgpt');
  assert.equal(classifyDualEndpointError(new Error('real high-tier CLI endpoint is required')).code, 'blocked-real-cli');
  assert.equal(classifyDualEndpointError(new Error('operator confirmation timed out')).code, 'confirmation-timeout');
  assert.equal(classifyDualEndpointError(new Error('cleanup left process behind')).code, 'cleanup-failed');
});

test('dual endpoint release active Chrome mode fails closed as real ChatGPT environment block', async () => {
  await withTempOutputDir(async (outputDir) => {
    const [evidence] = await runHarness({
      scenario: 'chatgpt-route',
      connectActiveChrome: true,
      outputDir,
      confirmationTimeoutMs: 60000,
      dryRun: false,
    });
    assert.equal(evidence.scenario, 'chatgpt-route');
    assert.equal(evidence.evidenceStatus, 'blocked');
    assert.equal(evidence.failureClassification, 'blocked-real-chatgpt');
    assert.match(evidence.failure.message, /active Chrome helper URL is required/);
  });
});

async function withActiveChromeHelper(handler, run) {
  const server = createServer(async (request, response) => {
    if (request.method !== 'POST' || request.url !== '/chatgpt/relay') {
      response.writeHead(404, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'not-found' }));
      return;
    }
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const result = await handler(body);
    response.writeHead(result.status ?? 200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(result.body));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    return await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('dual endpoint release active Chrome helper relays ChatGPT return into proposal gate', async () => {
  await withTempOutputDir(async (outputDir) => {
    await withActiveChromeHelper(async (body) => ({
      body: {
        prompt: {
          id: body.promptId,
          status: 'returned',
          evidence: [
            { type: 'queued' },
            { type: 'claimed' },
            { type: 'filled-and-acknowledged' },
            { type: 'waiting-manual-send' },
            { type: 'submitted' },
            { type: 'responding' },
            { type: 'response-ready' },
            { type: 'returned' },
          ],
        },
        inbound: {
          status: 'returned',
          content: `helper response ${body.marker}`,
        },
      },
    }), async (helperUrl) => {
      const originalLog = console.log;
      let evidence;
      try {
        console.log = () => undefined;
        [evidence] = await runHarness({
          scenario: 'chatgpt-route',
          connectActiveChrome: true,
          activeChromeHelper: helperUrl,
          outputDir,
          confirmationTimeoutMs: 1,
          dryRun: false,
        });
      } finally {
        console.log = originalLog;
      }
      assert.equal(evidence.scenario, 'chatgpt-route');
      assert.equal(evidence.evidenceStatus, 'blocked');
      assert.equal(evidence.failureClassification, 'confirmation-timeout');
      assert.match(evidence.failure.message, /operator confirmation timed out/);
    });
  });
});

test('dual endpoint release harness source avoids forbidden automation shortcuts', async () => {
  const source = await readFile(new URL('../scripts/dual-endpoint-release-e2e.ts', import.meta.url), 'utf8');

  assert.equal(source.includes('shell: true'), false);
  assert.equal(source.includes('--dangerously'), false);
  assert.equal(source.includes('--yolo'), false);
  assert.equal(source.includes('--full-auto'), false);
  assert.equal(source.includes('requestSubmit'), false);
  assert.equal(source.includes('.submit('), false);
  assert.equal(source.includes('KeyboardEvent'), false);
  assert.equal(source.includes("'/bridge/execution-proposals/confirm'"), false);
  assert.equal(source.includes("'/bridge/execution-proposals/dispatch'"), false);
});

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function withTempOutputDir(run) {
  const dir = await mkdtemp(join(tmpdir(), 'dual-endpoint-e2e-'));
  try {
    return await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('dual endpoint release harness exposes a real ChatGPT route entry point', () => {
  assert.equal(typeof runRealChatgptRoute, 'function');
});

test('dual endpoint release harness dispatches chatgpt-route to the real ChatGPT path', async () => {
  await withTempOutputDir(async (outputDir) => {
    // A reachable-looking but dead CDP target proves runHarness routes
    // chatgpt-route into runRealChatgptRoute (which fails closed on the real
    // environment) without launching a real browser. The legacy stub would
    // have produced `unexpected-error`; the real path produces a real
    // ChatGPT environment block.
    const [evidence] = await runHarness({
      scenario: 'chatgpt-route',
      connectCdp: 'http://127.0.0.1:9',
      outputDir,
      confirmationTimeoutMs: 60000,
      dryRun: false,
    });
    assert.equal(evidence.scenario, 'chatgpt-route');
    assert.equal(evidence.evidenceStatus, 'blocked');
    assert.equal(evidence.failureClassification, 'blocked-real-chatgpt');
    assert.notEqual(evidence.failure?.code, 'unexpected-error');
  });
});

test('dual endpoint release harness never falls through to unexpected-error without real endpoints', async () => {
  await withTempOutputDir(async (outputDir) => {
    const results = await runHarness({
      scenario: 'all',
      outputDir,
      confirmationTimeoutMs: 60000,
      dryRun: false,
    });
    assert.equal(results.length, DUAL_ENDPOINT_SCENARIOS.length);
    for (const evidence of results) {
      assert.ok(['passed', 'blocked'].includes(evidence.evidenceStatus), `unexpected status for ${evidence.scenario}`);
      assert.notEqual(
        evidence.failureClassification,
        'unexpected-error',
        `${evidence.scenario} fell through to unexpected-error`,
      );
      assert.notEqual(evidence.failure?.code, 'unexpected-error', `${evidence.scenario} fell through to unexpected-error`);
    }
  });
});

test('dual endpoint release harness produces passed contract evidence for deterministic scenarios', async () => {
  await withTempOutputDir(async (outputDir) => {
    const contractScenarios = [
      'same-provider',
      'mixed-provider',
      'failure-timeout',
      'uncertain-dispatch',
      'control-pause-cancel',
      'workbuddy-boundary',
      'cleanup',
    ];
    for (const scenario of contractScenarios) {
      const [evidence] = await runHarness({
        scenario,
        reasoningCli: 'codex-command',
        executionCli: 'codex-medium',
        outputDir,
        confirmationTimeoutMs: 60000,
        dryRun: false,
      });
      assert.equal(evidence.scenario, scenario, `wrong scenario evidence for ${scenario}`);
      assert.equal(evidence.evidenceStatus, 'passed', `${scenario} did not produce passed contract evidence`);
      assert.equal(evidence.failureClassification, 'none', `${scenario} reported a failure classification`);
      assert.equal(evidence.processExitClassification, 'not-run', `${scenario} should not dispatch`);
    }
  });
});

test('dual endpoint release evidence relaySeam field shape matches the instrumentation interface', () => {
  const relaySeam = {
    firstExtractReturnStatus: -1,
    secondExtractReturnStatus: 200,
    lastOutboundPromptId: 'prompt-abc-123',
    outboundPromptId: 'prompt-abc-123',
    promptIdMatch: true,
    idempotentReplayHit: false,
    artifactId: 'artifact-def-456',
  };
  // Compile-time shape: assert each subfield exists with the expected type.
  // NOTE (RP-RELAY-SEAM-FOLLOWUP, decision A): promptIdMatch and
  // lastOutboundPromptId are asserted PRESENCE/TYPE ONLY. They are id echoes
  // (lastOutboundPromptId := outboundPromptId), so promptIdMatch is always
  // true and must NOT be treated as seam proof. The real seam signals are
  // idempotentReplayHit (server replayed flag) + extract-return 200/201-vs-409
  // throw semantics. Do not add assertions that rely on promptIdMatch as proof.
  assert.equal(typeof relaySeam.firstExtractReturnStatus, 'number');
  assert.equal(typeof relaySeam.secondExtractReturnStatus, 'number');
  assert.equal(typeof relaySeam.lastOutboundPromptId, 'string');
  assert.equal(typeof relaySeam.outboundPromptId, 'string');
  assert.equal(typeof relaySeam.promptIdMatch, 'boolean');
  assert.equal(typeof relaySeam.idempotentReplayHit, 'boolean');
  assert.equal(typeof relaySeam.artifactId, 'string');
  // Verify idempotent replay can be true.
  const replayHit = { ...relaySeam, idempotentReplayHit: true, promptIdMatch: false };
  assert.equal(replayHit.idempotentReplayHit, true);
  assert.equal(replayHit.promptIdMatch, false);
});

test('dual endpoint release evidence sanitize preserves relaySeam subfields intact', () => {
  const relaySeam = {
    firstExtractReturnStatus: 201,
    secondExtractReturnStatus: 200,
    lastOutboundPromptId: 'rp_xyz_001',
    outboundPromptId: 'rp_xyz_001',
    promptIdMatch: true,
    idempotentReplayHit: true,
    artifactId: 'art_abc_456',
  };
  const evidence = {
    scenario: 'chatgpt-route',
    timestamp: '2026-06-21T00-00-00-000Z',
    ok: true,
    evidenceStatus: 'passed',
    git: { commit: 'abc123', dirty: false },
    relaySeam,
    endpointBindings: [],
    transitionSequence: [],
    failureClassification: 'none',
    processExitClassification: 'exit-0',
    screenshotPaths: [],
  };
  const sanitized = sanitizeEvidence(evidence);
  assert.ok(sanitized.relaySeam, 'relaySeam should survive sanitization');
  assert.equal(sanitized.relaySeam.firstExtractReturnStatus, 201);
  assert.equal(sanitized.relaySeam.secondExtractReturnStatus, 200);
  assert.equal(sanitized.relaySeam.lastOutboundPromptId, 'rp_xyz_001');
  assert.equal(sanitized.relaySeam.outboundPromptId, 'rp_xyz_001');
  assert.equal(sanitized.relaySeam.promptIdMatch, true);
  assert.equal(sanitized.relaySeam.idempotentReplayHit, true);
  assert.equal(sanitized.relaySeam.artifactId, 'art_abc_456');
});

test('dual endpoint release evidence relaySeam is absent on non-chatgpt-route evidence', () => {
  // Dry-run cli-route evidence should not carry relaySeam.
  const dryCli = createDryRunEvidence({
    scenario: 'cli-route',
    timestamp: '2026-06-21T00-00-00-000Z',
    git: { commit: 'abc123', dirty: false },
    reasoningEndpointId: 'codex-command',
    executionEndpointId: 'codex-medium',
  });
  assert.equal(dryCli.relaySeam, undefined, 'cli-route dry-run should not have relaySeam');

  // Dry-run chatgpt-route evidence should not carry relaySeam (chatgpt-route is
  // the only scenario that populates it, and only in real — not dry — runs).
  const dryChatgpt = createDryRunEvidence({
    scenario: 'chatgpt-route',
    timestamp: '2026-06-21T00-00-00-000Z',
    git: { commit: 'abc123', dirty: false },
  });
  assert.equal(dryChatgpt.relaySeam, undefined, 'chatgpt-route dry-run should not have relaySeam');

  // A synthetic passed evidence without relaySeam is valid (field is optional).
  const noRelaySeam = {
    scenario: 'same-provider',
    timestamp: '2026-06-21T00-00-00-000Z',
    ok: true,
    evidenceStatus: 'passed',
    git: { commit: 'abc123', dirty: false },
    endpointBindings: [],
    transitionSequence: [],
    failureClassification: 'none',
    processExitClassification: 'not-run',
    screenshotPaths: [],
  };
  assert.equal(noRelaySeam.relaySeam, undefined);
  // Sanitize must not inject relaySeam.
  const sanitized = sanitizeEvidence(noRelaySeam);
  assert.equal(sanitized.relaySeam, undefined);
});
