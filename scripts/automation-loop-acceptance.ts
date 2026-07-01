/**
 * ADR-0028 Automation Loop Acceptance Script
 *
 * Verifies end-to-end: create loop, run bounded ticks, stop at max-cycles,
 * extension session auth rejection.
 *
 * Usage:
 *   node --experimental-strip-types scripts/automation-loop-acceptance.ts
 */

import { createBridgeRuntime, handleBridgeRequest } from '../apps/local-server/src/routes/bridge-api.ts';
import assert from 'node:assert/strict';

const CONSOLE_AUTH = { kind: 'console-cookie' as const };
const EXT_AUTH = { kind: 'extension-session' as const };

function mockBody(body: unknown) {
  const text = JSON.stringify(body);
  const chunks = [Buffer.from(text)];
  let done = false;
  return {
    [Symbol.asyncIterator]() {
      return {
        next() {
          if (done) return Promise.resolve({ done: true as const, value: undefined });
          done = true;
          return Promise.resolve({ done: false as const, value: text });
        },
      };
    },
  };
}

async function main() {
  console.log('ADR-0028 acceptance: starting…');

  // 1. Create isolated runtime
  const runtime = createBridgeRuntime();
  runtime.endpointRegistry.register({
    id: 'workbuddy', label: 'WorkBuddy', transport: 'workbuddy', risk: 'medium',
    capabilities: { canAcceptPrompt: true, canReturnOutput: true, canReview: false, canExecute: true, canSummarize: false },
  });
  runtime.projectStore.upsert({ key: 'cli-bridge', label: 'CLI Bridge' });

  // 2. Create loop with maxCycles: 2
  const createRes = await handleBridgeRequest(runtime, 'POST',
    '/bridge/projects/cli-bridge/automation-loops',
    mockBody({ sourceEndpointId: 'chatgpt-web', targetEndpointId: 'workbuddy', maxCycles: 2, noProgressLimit: 2, deadlineMs: 600_000 }));
  assert.equal(createRes.statusCode, 201, 'create loop must return 201');
  const loopId = (createRes.payload as { loop: { id: string } }).loop.id;
  console.log('  created loop:', loopId);

  // 3. Run two ticks — should dispatch both
  const tick1 = await handleBridgeRequest(runtime, 'POST',
    `/bridge/projects/cli-bridge/automation-loops/${loopId}/tick`,
    mockBody({ input: 'cycle one' }), undefined, CONSOLE_AUTH);
  assert.equal(tick1.statusCode, 200, 'tick 1 must succeed');
  const t1 = tick1.payload as { type: string };
  assert.equal(t1.type, 'dispatched', 'tick 1 must be dispatched');

  const tick2 = await handleBridgeRequest(runtime, 'POST',
    `/bridge/projects/cli-bridge/automation-loops/${loopId}/tick`,
    mockBody({ input: 'cycle two' }), undefined, CONSOLE_AUTH);
  assert.equal(tick2.statusCode, 200, 'tick 2 must succeed');
  const t2 = tick2.payload as { type: string };
  assert.equal(t2.type, 'dispatched', 'tick 2 must be dispatched');

  // 4. Third tick should stop with max-cycles
  const tick3 = await handleBridgeRequest(runtime, 'POST',
    `/bridge/projects/cli-bridge/automation-loops/${loopId}/tick`,
    mockBody({ input: 'cycle three' }), undefined, CONSOLE_AUTH);
  assert.equal(tick3.statusCode, 200, 'tick 3 must return 200');
  const t3 = tick3.payload as { type: string; reason: string };
  assert.equal(t3.type, 'stopped', 'tick 3 must be stopped');
  assert.equal(t3.reason, 'max-cycles', 'stop reason must be max-cycles');
  console.log('  max-cycles stop: OK');

  // 5. Extension session cannot tick
  const extTick = await handleBridgeRequest(runtime, 'POST',
    `/bridge/projects/cli-bridge/automation-loops/${loopId}/tick`,
    mockBody({ input: 'blocked' }), undefined, EXT_AUTH);
  assert.equal(extTick.statusCode, 403, 'extension session must 403 on tick');
  console.log('  extension session rejected: OK');

  // 6. Extension session cannot run
  const extRun = await handleBridgeRequest(runtime, 'POST',
    `/bridge/projects/cli-bridge/automation-loops/${loopId}/run`,
    mockBody({ input: 'blocked' }), undefined, EXT_AUTH);
  assert.equal(extRun.statusCode, 403, 'extension session must 403 on run');
  console.log('  extension session run rejected: OK');

  // 7. No raw token in loop data
  const listRes = await handleBridgeRequest(runtime, 'GET',
    '/bridge/projects/cli-bridge/automation-loops', null, undefined, CONSOLE_AUTH);
  const loops = (listRes.payload as { loops: Record<string, unknown>[] }).loops;
  const loop = loops.find((l: { id: string }) => l.id === loopId);
  assert.ok(loop, 'loop must appear in list');
  for (const key of ['token', 'pairingToken', 'authorization', 'credential']) {
    assert.equal(key in (loop as Record<string, unknown>), false, `loop must not expose ${key}`);
  }
  console.log('  no token leakage: OK');

  console.log('ADR-0028 acceptance: ALL PASSED');
}

main().catch((err) => {
  console.error('ADR-0028 acceptance FAILED:', err.message);
  process.exit(1);
});
