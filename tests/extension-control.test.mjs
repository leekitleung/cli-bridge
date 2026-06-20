import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

import {
  createAutomationMirrorStatus,
} from '../apps/extension/src/ui/state.ts';

const root = process.cwd();

test('extension automation mirror status exposes binding and pending confirmation without authority', () => {
  const status = createAutomationMirrorStatus({
    binding: {
      planId: 'plan-1',
      reasoningEndpointId: 'chatgpt-web',
      executionEndpointId: 'codex-medium',
      reasoningTier: 'high',
      executionTier: 'medium',
      executionPermissionProfile: 'patch-proposal',
      executionWorkingDirectoryRef: 'cli-bridge',
      maxSteps: 4,
      maxReasoningRounds: 2,
      deadlineAt: '2026-06-21T00:00:00.000Z',
    },
    proposal: {
      id: 'proposal-1',
      status: 'awaiting-confirmation',
      stepId: 'step-1',
      contentHash: 'sha256:abc',
    },
    round: 1,
  });

  assert.equal(status.kind, 'blocked');
  assert.match(status.label, /awaiting-confirmation/);
  assert.match(status.detail, /chatgpt-web/);
  assert.match(status.detail, /codex-medium/);
  assert.match(status.detail, /step-1/);
  assert.match(status.detail, /round 1/);
});

test('extension bridge panel mirrors automation state but cannot confirm, edit, or select authority fields', async () => {
  const source = await readFile(resolve(root, 'apps/extension/src/ui/bridge-panel.tsx'), 'utf8');

  assert.equal(source.includes('data-cli-bridge-automation-status'), true);
  assert.equal(source.includes('pauseAutomationControl'), true);
  assert.equal(source.includes('resumeAutomationControl'), true);
  assert.equal(source.includes('cancelAutomationControl'), true);
  assert.equal(source.includes('getAutomationControlStatus'), true);
  assert.equal(source.includes('data.currentProposal'), true);
  assert.equal(source.includes('data.currentBinding'), true);
  assert.equal(source.includes('proposals?.[0]'), false);
  assert.equal(source.includes('bindings?.[0]'), false);

  assert.equal(source.includes('confirmAutomationControl'), false);
  assert.equal(source.includes('editAutomationControl'), false);
  assert.equal(source.includes('/bridge/execution-proposals/confirm'), false);
  assert.equal(source.includes('/bridge/execution-proposals/dispatch'), false);
  assert.equal(source.includes('executionEndpointId:'), false);
  assert.equal(source.includes('executionPermissionProfile:'), false);
  assert.equal(source.includes('executionWorkingDirectoryRef:'), false);
});

test('extension control client has no confirmation or edit API export', async () => {
  const source = await readFile(resolve(root, 'apps/extension/src/content/bridge-client.ts'), 'utf8');

  assert.equal(source.includes('confirmAutomationControl'), false);
  assert.equal(source.includes('editAutomationControl'), false);
  assert.equal(source.includes('/bridge/execution-proposals/confirm'), false);
  assert.equal(source.includes('/bridge/execution-proposals/dispatch'), false);
});
