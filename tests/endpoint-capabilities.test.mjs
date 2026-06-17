import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import test from 'node:test';

import {
  validateAgentEndpoint,
} from '../packages/shared/src/schemas.ts';
import {
  CLAUDE_CODE_REVIEW_ENDPOINT,
  CLAUDE_CODE_REVIEW_COMMAND_ENDPOINT,
  CODEX_FEASIBILITY_REVIEW_ENDPOINT,
  CODEX_REVIEW_COMMAND_ENDPOINT,
  DEFAULT_AGENT_ENDPOINTS,
  MOCK_REVIEW_ENDPOINT,
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

test('default mock endpoints preserve v0.4 boundaries', () => {
  const endpointIds = DEFAULT_AGENT_ENDPOINTS.map((endpoint) => endpoint.id);

  assert.deepEqual(endpointIds, [
    'mock-agent',
    'clipboard',
    'chatgpt-web',
    'codex-cli',
  ]);

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

test('mock review endpoint can review but cannot execute or accept prompts', () => {
  assert.equal(MOCK_REVIEW_ENDPOINT.id, 'mock-review-agent');
  assert.equal(MOCK_REVIEW_ENDPOINT.transport, 'mock');
  assert.equal(MOCK_REVIEW_ENDPOINT.risk, 'low');
  assert.equal(MOCK_REVIEW_ENDPOINT.capabilities.canReview, true);
  assert.equal(MOCK_REVIEW_ENDPOINT.capabilities.canExecute, false);
  assert.equal(MOCK_REVIEW_ENDPOINT.capabilities.canAcceptPrompt, false);
  assert.equal(MOCK_REVIEW_ENDPOINT.capabilities.canReturnOutput, true);
});

test('claude-code review endpoint uses clipboard review-only capabilities', () => {
  assert.equal(CLAUDE_CODE_REVIEW_ENDPOINT.id, 'claude-code');
  assert.equal(CLAUDE_CODE_REVIEW_ENDPOINT.transport, 'clipboard');
  assert.equal(CLAUDE_CODE_REVIEW_ENDPOINT.risk, 'medium');
  assert.equal(CLAUDE_CODE_REVIEW_ENDPOINT.capabilities.canReview, true);
  assert.equal(CLAUDE_CODE_REVIEW_ENDPOINT.capabilities.canExecute, false);
  assert.equal(CLAUDE_CODE_REVIEW_ENDPOINT.capabilities.canAcceptPrompt, false);
  assert.equal(CLAUDE_CODE_REVIEW_ENDPOINT.capabilities.canReturnOutput, true);
  assert.equal(CLAUDE_CODE_REVIEW_ENDPOINT.capabilities.canSummarize, false);
});

test('codex feasibility review endpoint uses clipboard review-only capabilities', () => {
  assert.equal(CODEX_FEASIBILITY_REVIEW_ENDPOINT.id, 'codex-feasibility');
  assert.equal(CODEX_FEASIBILITY_REVIEW_ENDPOINT.transport, 'clipboard');
  assert.equal(CODEX_FEASIBILITY_REVIEW_ENDPOINT.risk, 'medium');
  assert.equal(CODEX_FEASIBILITY_REVIEW_ENDPOINT.capabilities.canReview, true);
  assert.equal(CODEX_FEASIBILITY_REVIEW_ENDPOINT.capabilities.canExecute, false);
  assert.equal(CODEX_FEASIBILITY_REVIEW_ENDPOINT.capabilities.canAcceptPrompt, false);
  assert.equal(CODEX_FEASIBILITY_REVIEW_ENDPOINT.capabilities.canReturnOutput, true);
  assert.equal(CODEX_FEASIBILITY_REVIEW_ENDPOINT.capabilities.canSummarize, false);
});

test('review command endpoints are review-only and cannot execute arbitrary prompts', () => {
  for (const endpoint of [CLAUDE_CODE_REVIEW_COMMAND_ENDPOINT, CODEX_REVIEW_COMMAND_ENDPOINT]) {
    assert.equal(endpoint.transport, 'command');
    assert.equal(endpoint.capabilities.canReview, true);
    assert.equal(endpoint.capabilities.canExecute, false);
    assert.equal(endpoint.capabilities.canAcceptPrompt, false);
    assert.equal(endpoint.capabilities.canReturnOutput, true);
  }
});

test('templates remain manual previews with autoSend false', () => {
  assert.equal(createTemplatePreview('review-cli-output', {
    content: 'review this',
  }).autoSend, false);
  assert.equal(createTemplatePreview('generate-codex-prompt', {
    content: 'generate this',
  }).autoSend, false);
});

test('v0.8 does not introduce unsupported TUI agents or shell-style route files', async () => {
  const forbiddenPathPatterns = [
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

  const implementationFiles = files.filter((file) => file.includes('/apps/local-server/src/endpoints/'));
  const sourceText = await Promise.all(implementationFiles.map((file) => readFile(file, 'utf8')));
  assert.equal(sourceText.join('\n').includes("targetEndpointId: 'workbuddy'"), false);

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
