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

test('command planner adapter converts CLI JSON output into planner envelope', async () => {
  const { createCodexPlannerAdapter } = await import('../apps/local-server/src/conversation/command-planner-adapter.ts');

  const adapter = createCodexPlannerAdapter({
    id: 'operator-codex-planner',
    commandOptions: {
      launcherResolver: () => ({ executable: 'codex', prependArgs: [] }),
      runner: {
        async run(execution) {
          assert.equal(execution.command, 'codex');
          assert.match(execution.stdin, /format this/i);
          return {
            exitCode: 0,
            stdout: JSON.stringify({
              visibleText: 'I can format this.',
              intent: 'request_execution',
              proposedInstruction: {
                summary: 'Format text',
                payload: 'format this',
                targetExecutorIds: ['workbuddy'],
                riskHints: ['pure-transform'],
              },
            }),
            stderr: '',
            timedOut: false,
            truncated: false,
          };
        },
      },
    },
  });

  const envelope = await adapter.plan({
    sessionId: 's1',
    projectId: 'cli-bridge',
    userText: 'format this',
    history: [],
  });

  assert.equal(envelope.id.length > 0, true);
  assert.equal(envelope.sessionId, 's1');
  assert.equal(envelope.plannerEndpointId, 'operator-codex-planner');
  assert.equal(envelope.visibleText, 'I can format this.');
  assert.equal(envelope.intent, 'request_execution');
  assert.equal(envelope.proposedInstruction.payload, 'format this');
});

test('command planner adapter ignores Codex user echo JSONL events', async () => {
  const { createCodexPlannerAdapter } = await import('../apps/local-server/src/conversation/command-planner-adapter.ts');

  const adapter = createCodexPlannerAdapter({
    id: 'operator-codex-planner',
    commandOptions: {
      launcherResolver: () => ({ executable: 'codex', prependArgs: [] }),
      runner: {
        async run() {
          return {
            exitCode: 0,
            stdout: [
              JSON.stringify({ type: 'item.completed', item: { type: 'user_message', text: 'hi' } }),
              JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'Hi. What would you like to do?' } }),
              JSON.stringify({ type: 'turn.completed' }),
            ].join('\n'),
            stderr: '',
            timedOut: false,
            truncated: false,
          };
        },
      },
    },
  });

  const envelope = await adapter.plan({
    sessionId: 's1',
    projectId: 'cli-bridge',
    userText: 'hi',
    history: [],
  });

  assert.equal(envelope.visibleText, 'Hi. What would you like to do?');
  assert.equal(envelope.intent, 'answer');
});
