import assert from 'node:assert/strict';
import test from 'node:test';

import { redactSensitiveContent } from '../apps/local-server/src/security/redaction.ts';
import { createContentHash } from '../packages/shared/src/utils/hash.ts';
import {
  calculateCompressionRatio,
  createTokenEstimateMetrics,
  estimateTokenCount,
} from '../packages/shared/src/utils/token-estimate.ts';

test('createContentHash returns stable sha256-prefixed hashes', () => {
  assert.equal(
    createContentHash('review this result'),
    createContentHash('review this result'),
  );
  assert.notEqual(
    createContentHash('review this result'),
    createContentHash('review another result'),
  );
  assert.match(createContentHash('review this result'), /^sha256:[a-f0-9]{64}$/);
});

test('estimateTokenCount returns deterministic coarse estimates', () => {
  assert.equal(estimateTokenCount(''), 0);
  assert.equal(estimateTokenCount('   '), 0);
  assert.equal(estimateTokenCount('abcd'), 1);
  assert.equal(estimateTokenCount('abcde'), 2);
});

test('createTokenEstimateMetrics reports lengths and compression ratio', () => {
  assert.deepEqual(createTokenEstimateMetrics('abcdefghij', 'abcde'), {
    rawLength: 10,
    processedLength: 5,
    rawTokenEstimate: 3,
    processedTokenEstimate: 2,
    compressionRatio: 0.5,
  });
  assert.equal(calculateCompressionRatio(0, 10), undefined);
});

test('redactSensitiveContent redacts common API tokens without blocking', () => {
  const result = redactSensitiveContent([
    'Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456',
    'OPENAI=sk-abcdefghijklmnopqrstuvwxyz123456',
    'GITHUB=ghp_abcdefghijklmnopqrstuvwxyz123456',
  ].join('\n'));

  assert.equal(result.redactionApplied, true);
  assert.equal(result.blocked, false);
  assert.deepEqual(result.blockReasons, []);
  assert.match(result.processedContent, /Bearer \[REDACTED_TOKEN\]/);
  assert.match(result.processedContent, /\[REDACTED_OPENAI_KEY\]/);
  assert.match(result.processedContent, /\[REDACTED_GITHUB_TOKEN\]/);
  assert.doesNotMatch(result.processedContent, /abcdefghijklmnopqrstuvwxyz123456/);
});

test('redactSensitiveContent blocks private keys and env secret assignments', () => {
  const result = redactSensitiveContent([
    'API_TOKEN=super-secret-token',
    '-----BEGIN PRIVATE KEY-----',
    'private material',
    '-----END PRIVATE KEY-----',
  ].join('\n'));

  assert.equal(result.redactionApplied, true);
  assert.equal(result.blocked, true);
  assert.deepEqual(result.redactionSummary, [
    'private-key-block',
    'env-secret-assignment',
  ]);
  assert.deepEqual(result.blockReasons, [
    'private-key-block',
    'env-secret-assignment',
  ]);
  assert.match(result.processedContent, /API_TOKEN=\[REDACTED_ENV_SECRET\]/);
  assert.match(result.processedContent, /\[REDACTED_PRIVATE_KEY\]/);
  assert.doesNotMatch(result.processedContent, /private material/);
});

test('redactSensitiveContent redacts lowercase and colon-style secret assignments', () => {
  const result = redactSensitiveContent([
    'password=hunter2supersecretvalue',
    'api_key: abcdefghijklmnopqrstuv',
    'My_Secret = plain-text-secret',
  ].join('\n'));

  assert.equal(result.redactionApplied, true);
  assert.equal(result.blocked, true);
  assert.match(result.processedContent, /password=\[REDACTED_ENV_SECRET\]/);
  assert.match(result.processedContent, /api_key: \[REDACTED_ENV_SECRET\]/);
  assert.match(result.processedContent, /My_Secret = \[REDACTED_ENV_SECRET\]/);
  assert.doesNotMatch(result.processedContent, /hunter2supersecretvalue/);
  assert.doesNotMatch(result.processedContent, /plain-text-secret/);
});
