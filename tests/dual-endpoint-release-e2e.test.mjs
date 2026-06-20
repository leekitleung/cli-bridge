import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  DUAL_ENDPOINT_SCENARIOS,
  classifyDualEndpointError,
  parseArgs,
  createDryRunEvidence,
  sanitizeEvidence,
} from '../scripts/dual-endpoint-release-e2e.ts';

test('dual endpoint release harness parses explicit CLI args', () => {
  const args = parseArgs([
    '--scenario',
    'mixed-provider',
    '--profile-dir',
    'output/playwright/profile',
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
  assert.equal(args.profileDir, 'output/playwright/profile');
  assert.equal(args.reasoningCli, 'codex-high');
  assert.equal(args.executionCli, 'codex-medium');
  assert.equal(args.connectCdp, 'http://127.0.0.1:9224');
  assert.equal(args.outputDir, 'output/playwright/dual-endpoint');
  assert.equal(args.confirmationTimeoutMs, 600000);
  assert.equal(args.dryRun, true);
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
  assert.equal(classifyDualEndpointError(new Error('real high-tier CLI endpoint is required')).code, 'blocked-real-cli');
  assert.equal(classifyDualEndpointError(new Error('operator confirmation timed out')).code, 'confirmation-timeout');
  assert.equal(classifyDualEndpointError(new Error('cleanup left process behind')).code, 'cleanup-failed');
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
