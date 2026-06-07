import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createTemplatePreview,
  validateTemplatePreviewInput,
} from '../packages/shared/src/templates.ts';

test('review CLI output template produces a bounded preview without auto-send metadata', () => {
  const preview = createTemplatePreview('review-cli-output', {
    content: 'npm test failed at storage.test.mjs',
    context: {
      cwd: '/repo',
      branch: 'main',
    },
  });

  assert.equal(preview.templateId, 'review-cli-output');
  assert.equal(preview.autoSend, false);
  assert.match(preview.preview, /Review this CLI output/);
  assert.match(preview.preview, /npm test failed/);
  assert.match(preview.preview, /cwd: \/repo/);
  assert.match(preview.preview, /branch: main/);
});

test('generate Codex prompt template creates a manual execution prompt preview', () => {
  const preview = createTemplatePreview('generate-codex-prompt', {
    content: 'Fix the failing metrics summary test.',
  });

  assert.equal(preview.templateId, 'generate-codex-prompt');
  assert.equal(preview.autoSend, false);
  assert.match(preview.preview, /Create a Codex execution prompt/);
  assert.match(preview.preview, /Fix the failing metrics summary test/);
});

test('template preview input schema rejects unknown templates and empty content', () => {
  assert.deepEqual(validateTemplatePreviewInput('review-cli-output', {
    content: 'valid',
  }), {
    ok: true,
    errors: [],
  });
  assert.equal(validateTemplatePreviewInput('unknown-template', {
    content: 'valid',
  }).ok, false);
  assert.equal(validateTemplatePreviewInput('review-cli-output', {
    content: '',
  }).ok, false);
});
