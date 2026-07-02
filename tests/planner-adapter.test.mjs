// Planner adapter boundary tests (ADR-0031 Task 3).
import assert from 'node:assert/strict';
import test from 'node:test';

test('default runtime does not silently register mock planner', async () => {
  const { createBridgeRuntime } = await import('../apps/local-server/src/routes/bridge-api.ts');
  const runtime = createBridgeRuntime();

  assert.equal(runtime.plannerRegistry.has('mock-planner'), false);
});

test('runtime can register and retrieve a test-only planner', async () => {
  const { createBridgeRuntime } = await import('../apps/local-server/src/routes/bridge-api.ts');
  const runtime = createBridgeRuntime({
    plannerAdapters: [{
      id: 'test-planner',
      mode: 'test-only',
      async plan(input) {
        return {
          id: `out-${Date.now()}`,
          sessionId: input.sessionId,
          plannerEndpointId: 'test-planner',
          visibleText: `OK: ${input.userText}`,
          intent: 'answer',
          createdAt: new Date().toISOString(),
        };
      },
    }],
  });

  assert.equal(runtime.plannerRegistry.has('test-planner'), true);
  assert.equal(runtime.plannerRegistry.has('mock-planner'), false);

  const adapter = runtime.plannerRegistry.get('test-planner');
  assert.ok(adapter);
  assert.equal(adapter.mode, 'test-only');
});

test('default runtime has no default planner', async () => {
  const { createBridgeRuntime } = await import('../apps/local-server/src/routes/bridge-api.ts');
  const runtime = createBridgeRuntime();

  const planner = runtime.plannerRegistry.defaultPlanner();
  assert.equal(planner, undefined);
});
