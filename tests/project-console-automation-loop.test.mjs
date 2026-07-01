import assert from 'node:assert/strict';
import test from 'node:test';
import { renderProjectConsoleHtml } from '../apps/local-server/src/routes/project-console.ts';

test('console renders automation loop panel without shell routes', () => {
  const html = renderProjectConsoleHtml();
  assert.match(html, /automation-loop/);
  assert.match(html, /automation-loop-card/);
  // No new shell/run/exec endpoints introduced by automation loop
  assert.doesNotMatch(html, /\/bridge\/projects\/.*\/shell/);
});

test('console includes loop action buttons', () => {
  const html = renderProjectConsoleHtml();
  assert.match(html, /loop-action/);
});

test('console does not expose raw pairing token in DOM', () => {
  const html = renderProjectConsoleHtml();
  assert.doesNotMatch(html, /localStorage\.setItem\(['"]cli-bridge-pairing-token/);
});
