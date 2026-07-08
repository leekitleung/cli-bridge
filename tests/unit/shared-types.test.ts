// Unit tests for shared types

import { test, describe } from 'node:test';
import assert from 'node:assert';

describe('AutomationLoopRun types', () => {
  test('should define loop statuses', () => {
    const statuses = ['draft', 'running', 'completed', 'cancelled', 'failed'] as const;
    assert.ok(statuses.includes('running'));
    assert.ok(statuses.includes('completed'));
  });

  test('should define loop structure', () => {
    const loop = {
      id: 'loop-1',
      status: 'running' as const,
      projectId: 'project-1',
      goalId: 'goal-1',
      sourceEndpointId: 'codex',
      targetEndpointId: 'workbuddy',
      maxCycles: 10,
      noProgressLimit: 3,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      deadlineAt: Date.now() + 3600000,
    };

    assert.strictEqual(loop.status, 'running');
    assert.strictEqual(loop.maxCycles, 10);
    assert.ok(loop.deadlineAt > loop.createdAt);
  });

  test('should support pending input for config', () => {
    const config = {
      planId: 'plan-1',
      workingDirectory: '/tmp',
      preferredExecutor: 'workbuddy',
      autoVerify: true,
      verifyTimeoutMs: 60000,
    };

    const loop = {
      id: 'loop-1',
      pendingInput: JSON.stringify(config),
    };

    const parsed = JSON.parse(loop.pendingInput!);
    assert.strictEqual(parsed.planId, 'plan-1');
    assert.strictEqual(parsed.autoVerify, true);
  });
});

describe('AutomationLoopCycle types', () => {
  test('should define cycle structure', () => {
    const cycle = {
      id: 'cycle-1',
      loopId: 'loop-1',
      cycleIndex: 0,
      status: 'pending' as const,
      workBuddyTaskId: 'task-1',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    assert.strictEqual(cycle.status, 'pending');
    assert.strictEqual(cycle.cycleIndex, 0);
  });

  test('should track execution results', () => {
    const cycle = {
      id: 'cycle-1',
      status: 'completed' as const,
      result: {
        ok: true,
        stdout: 'success',
        durationMs: 100,
      },
    };

    assert.strictEqual(cycle.result!.ok, true);
    assert.strictEqual(cycle.result!.durationMs, 100);
  });
});

describe('BridgePacket types', () => {
  test('should define packet structure', () => {
    const packet = {
      id: 'packet-1',
      direction: 'outbound' as const,
      sourceEndpointId: 'codex',
      targetEndpointId: 'chatgpt-web',
      prompt: { text: 'Hello', processedContent: 'Hello' },
      status: 'pending' as const,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    assert.strictEqual(packet.direction, 'outbound');
    assert.strictEqual(packet.status, 'pending');
  });

  test('should support redaction', () => {
    const packet = {
      id: 'packet-1',
      prompt: {
        text: 'secret command',
        processedContent: '*****',
      },
    };

    assert.strictEqual(packet.prompt.processedContent, '*****');
  });
});

describe('Endpoint types', () => {
  test('should define endpoint capabilities', () => {
    const caps = {
      id: 'workbuddy',
      name: 'WorkBuddy',
      transport: 'workbuddy' as const,
      canAcceptPrompt: true,
      canReturnOutput: true,
      canExecute: true,
    };

    assert.strictEqual(caps.transport, 'workbuddy');
    assert.strictEqual(caps.canExecute, true);
  });
});

describe('WorkBuddy task types', () => {
  test('should define task structure', () => {
    const task = {
      taskId: 'task-1',
      endpointId: 'local-workbuddy',
      projectId: 'cli-bridge',
      proposalId: 'prop-1',
      planId: 'plan-1',
      goalId: 'goal-1',
      bindingHash: 'hash-1',
      prompt: 'Do something',
      workingDirectory: '/tmp',
      timeoutMs: 30000,
      status: 'pending' as const,
      createdAt: Date.now(),
    };

    assert.strictEqual(task.status, 'pending');
    assert.strictEqual(task.timeoutMs, 30000);
  });

  test('should define task statuses', () => {
    const statuses = ['pending', 'claimed', 'running', 'completed', 'failed'] as const;
    for (const status of statuses) {
      const task = { status };
      assert.strictEqual(task.status, status);
    }
  });

  test('should support task results', () => {
    const result = {
      ok: true,
      stdout: 'output',
      stderr: '',
      exitCode: 0,
      durationMs: 150,
    };

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.exitCode, 0);
  });
});
