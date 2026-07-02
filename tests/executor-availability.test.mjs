// Executor availability model tests (ADR-0031 Task 2).
import assert from 'node:assert/strict';
import test from 'node:test';

test('workbuddy pull executor is unknown without readiness signal', async () => {
  const { resolveExecutorAvailability } = await import('../apps/local-server/src/conversation/executor-availability.ts');
  const availability = resolveExecutorAvailability({
    endpoint: { id: 'workbuddy', transport: 'workbuddy', capabilities: { canExecute: true } },
    workbuddyReady: false,
    now: 1000,
  });

  assert.equal(availability.status, 'unknown');
  assert.equal(availability.claimMode, 'pull');
});

test('workbuddy pull executor is online with fresh readiness signal', async () => {
  const { resolveExecutorAvailability } = await import('../apps/local-server/src/conversation/executor-availability.ts');
  const availability = resolveExecutorAvailability({
    endpoint: { id: 'workbuddy', transport: 'workbuddy', capabilities: { canExecute: true } },
    workbuddyReady: true,
    lastSeenAt: 900,
    now: 1000,
  });

  assert.equal(availability.status, 'online');
});

test('push executor is always online', async () => {
  const { resolveExecutorAvailability } = await import('../apps/local-server/src/conversation/executor-availability.ts');
  const availability = resolveExecutorAvailability({
    endpoint: { id: 'codex-cli', transport: 'command', capabilities: { canExecute: true, canReturnOutput: true } },
    now: 1000,
  });

  assert.equal(availability.status, 'online');
  assert.equal(availability.claimMode, 'push');
});

test('executor availability includes enabled capabilities', async () => {
  const { resolveExecutorAvailability } = await import('../apps/local-server/src/conversation/executor-availability.ts');
  const availability = resolveExecutorAvailability({
    endpoint: { id: 'workbuddy', transport: 'workbuddy', capabilities: { canExecute: true, canSummarize: false } },
    workbuddyReady: true,
    lastSeenAt: 900,
    now: 1000,
  });

  assert.deepEqual(availability.capabilities, ['canExecute']);
});
