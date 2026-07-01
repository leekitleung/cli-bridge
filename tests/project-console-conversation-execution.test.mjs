// Conversation execution UI behavior tests (jsdom).

import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { renderProjectConsoleHtml } from '../apps/local-server/src/routes/project-console.ts';

test('conversation action UI elements are present in console HTML', () => {
  const html = renderProjectConsoleHtml();
  const dom = new JSDOM(html, {
    url: 'http://127.0.0.1:31337/console/project',
    runScripts: 'dangerously',
    resources: 'usable',
    beforeParse(win) {
      Object.defineProperty(win, 'localStorage', {
        value: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
        configurable: true,
      });
      win.fetch = async () => ({ ok: true, status: 200, json: async () => ({}) });
    },
  });
  const doc = dom.window.document;

  // Verify conversation transcript container exists
  const transcript = doc.getElementById('conversation-transcript');
  assert.ok(transcript, 'conversation transcript element must exist');

  // Verify composer mode toggle exists
  const toggle = doc.getElementById('composer-mode-toggle');
  assert.ok(toggle, 'composer mode toggle must exist');

  // No exec/shell/run paths
  assert.equal(/\/(exec|shell|run)['"`]/.test(html), false);
});

test('project console HTML uses only conversation action API paths', () => {
  const html = renderProjectConsoleHtml();
  // No exec/shell/run paths
  assert.equal(/\/(exec|shell|run)['"`]/.test(html), false);
  // Conversation action paths reference confirm/dispatch, not arbitrary exec
  assert.ok(html.includes('conversation/actions/'), 'conversation action routes present in JS');
  assert.ok(html.includes('/confirm') && html.includes('/dispatch'), 'confirm/dispatch paths present');
});
