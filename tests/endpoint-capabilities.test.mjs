import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import test from 'node:test';

import {
  validateAgentEndpoint,
} from '../packages/shared/src/schemas.ts';
import {
  DEFAULT_AGENT_ENDPOINTS,
} from '../apps/local-server/src/endpoints/mock-endpoints.ts';
import {
  createTemplatePreview,
} from '../packages/shared/src/templates.ts';

const root = process.cwd();

const validEndpoint = {
  id: 'mock-agent',
  label: 'Mock Agent',
  transport: 'mock',
  risk: 'low',
  capabilities: {
    canAcceptPrompt: true,
    canReturnOutput: false,
    canReview: false,
    canExecute: false,
    canSummarize: false,
  },
  adapterName: 'mock-agent',
};

test('valid endpoint passes schema validation', () => {
  assert.deepEqual(validateAgentEndpoint(validEndpoint), {
    ok: true,
    errors: [],
  });
});

test('invalid transport, risk, missing capability, and empty id are denied', () => {
  assert.equal(validateAgentEndpoint({
    ...validEndpoint,
    transport: 'ssh',
  }).ok, false);
  assert.equal(validateAgentEndpoint({
    ...validEndpoint,
    risk: 'critical',
  }).ok, false);
  assert.equal(validateAgentEndpoint({
    ...validEndpoint,
    id: '',
  }).ok, false);
  assert.equal(validateAgentEndpoint({
    ...validEndpoint,
    label: '',
  }).ok, false);
  assert.equal(validateAgentEndpoint({
    ...validEndpoint,
    capabilities: {
      canAcceptPrompt: true,
      canReturnOutput: false,
      canReview: false,
      canExecute: false,
    },
  }).ok, false);
  assert.equal(validateAgentEndpoint({
    ...validEndpoint,
    adapterName: 123,
  }).ok, false);
  assert.equal(validateAgentEndpoint({
    ...validEndpoint,
    experimental: 'yes',
  }).ok, false);
});

test('default mock endpoints expose v0.4 capabilities only', () => {
  const endpointIds = DEFAULT_AGENT_ENDPOINTS.map((endpoint) => endpoint.id);

  assert.deepEqual(endpointIds, [
    'mock-agent',
    'clipboard',
    'chatgpt-web',
    'codex-cli',
  ]);
  assert.equal(endpointIds.includes('mock-review-agent'), false);

  const mockAgent = DEFAULT_AGENT_ENDPOINTS.find((endpoint) => endpoint.id === 'mock-agent');
  assert.equal(mockAgent?.capabilities.canAcceptPrompt, true);
  assert.equal(mockAgent?.capabilities.canReview, false);
  assert.equal(mockAgent?.capabilities.canExecute, false);

  const codex = DEFAULT_AGENT_ENDPOINTS.find((endpoint) => endpoint.id === 'codex-cli');
  assert.equal(codex?.risk, 'experimental');
  assert.equal(codex?.experimental, true);
  assert.equal(codex?.capabilities.canExecute, false);

  const chatgpt = DEFAULT_AGENT_ENDPOINTS.find((endpoint) => endpoint.id === 'chatgpt-web');
  assert.equal(chatgpt?.capabilities.canAcceptPrompt, true);
  assert.equal(chatgpt?.capabilities.canReturnOutput, true);
  assert.equal(chatgpt?.capabilities.canSummarize, true);
  assert.equal(chatgpt?.capabilities.canReview, false);
  assert.equal(chatgpt?.capabilities.canExecute, false);
});

test('templates remain manual previews with autoSend false', () => {
  assert.equal(createTemplatePreview('review-cli-output', {
    content: 'review this',
  }).autoSend, false);
  assert.equal(createTemplatePreview('generate-codex-prompt', {
    content: 'generate this',
  }).autoSend, false);
});

test('v0.4 does not introduce review, real-agent, or shell route files', async () => {
  const forbiddenPathPatterns = [
    /mock-review/i,
    /claude/i,
    /workbuddy/i,
    /opencode/i,
    /deepseek/i,
  ];
  const forbiddenRouteNames = new Set([
    'exec.ts',
    'shell.ts',
    'run.ts',
    'command.ts',
  ]);

  const files = await listProjectFiles([
    resolve(root, 'apps'),
    resolve(root, 'packages'),
    resolve(root, 'tests'),
  ]);
  for (const file of files) {
    for (const pattern of forbiddenPathPatterns) {
      assert.equal(pattern.test(file), false, `forbidden file path: ${file}`);
    }
  }

  const routeFiles = await listProjectFiles([resolve(root, 'apps/local-server/src/routes')]);
  for (const file of routeFiles) {
    assert.equal(forbiddenRouteNames.has(file.split('/').at(-1)), false, `forbidden route file: ${file}`);
  }
});

async function listProjectFiles(paths) {
  const files = [];
  for (const path of paths) {
    const entries = await readdir(path, {
      withFileTypes: true,
    });
    for (const entry of entries) {
      const childPath = join(path, entry.name);
      if (entry.isDirectory()) {
        files.push(...await listProjectFiles([childPath]));
      } else {
        files.push(childPath);
      }
    }
  }

  return files;
}
