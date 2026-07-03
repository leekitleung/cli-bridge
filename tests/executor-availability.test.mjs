// Executor availability model tests (ADR-0031 Task 2, updated ADR-0034).
import assert from 'node:assert/strict';
import test from 'node:test';

test('workbuddy pull executor is unknown without readiness signal', async () => {
  const { resolveExecutorAvailability } = await import('../apps/local-server/src/conversation/executor-availability.ts');
  const availability = resolveExecutorAvailability({
    endpoint: { id: 'workbuddy', transport: 'workbuddy', capabilities: { canExecute: true } },
    workbuddyReady: false,
    executorReady: false,
    now: 1000,
  });

  assert.equal(availability.status, 'unknown');
  assert.equal(availability.claimMode, 'pull');
});

test('workbuddy pull executor is online only with executorReady', async () => {
  const { resolveExecutorAvailability } = await import('../apps/local-server/src/conversation/executor-availability.ts');
  const availability = resolveExecutorAvailability({
    endpoint: { id: 'workbuddy', transport: 'workbuddy', capabilities: { canExecute: true } },
    workbuddyReady: true,
    executorReady: true,
    lastSeenAt: 900,
    now: 1000,
  });

  assert.equal(availability.status, 'online');
  assert.equal(availability.executorReady, true);
});

test('workbuddy pull executor with diagnostic only stays unknown', async () => {
  const { resolveExecutorAvailability } = await import('../apps/local-server/src/conversation/executor-availability.ts');
  // workbuddyReady (channel) true but executorReady (real worker) false.
  const availability = resolveExecutorAvailability({
    endpoint: { id: 'workbuddy', transport: 'workbuddy', capabilities: { canExecute: true } },
    workbuddyReady: true,
    executorReady: false,
    lastSeenAt: 900,
    now: 1000,
  });

  assert.equal(availability.status, 'unknown');
  assert.equal(availability.executorReady, false);
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
    executorReady: true,
    lastSeenAt: 900,
    now: 1000,
  });

  assert.deepEqual(availability.capabilities, ['canExecute']);
});
