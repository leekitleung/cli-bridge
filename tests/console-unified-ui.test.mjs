import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { renderProjectConsoleHtml } from '../apps/local-server/src/routes/project-console.ts';

test('Project Workspace is the single product shell and owns goals/reviews contexts', () => {
  const html = renderProjectConsoleHtml();
  assert.match(html, /data-project-ui-shell="project"/);
  assert.match(html, /--bg:\s*#f7f7f5/);
  assert.match(html, /--accent:\s*#10a37f/);
  assert.match(html, /--bg:\s*#0d0d0d/);
  assert.match(html, /id="goals-context"/);
  assert.match(html, /id="reviews-context"/);
  assert.match(html, /lc === '\/goals'/);
  assert.match(html, /lc === '\/reviews'/);
  assert.match(html, /lc === '\/project'/);
  assert.doesNotMatch(html, /class="project-ui-nav"/);
});

test('extension panel uses the same Project Workspace color system', async () => {
  const source = await readFile(new URL('../apps/extension/src/ui/bridge-panel.tsx', import.meta.url), 'utf8');
  const popup = await readFile(new URL('../apps/extension/src/popup/index.ts', import.meta.url), 'utf8');

  assert.match(source, /--cb-panel-bg:\s*#ffffff/);
  assert.match(source, /--cb-text:\s*#181a19/);
  assert.match(source, /--cb-border:\s*#d7ddd9/);
  assert.match(source, /--cb-accent:\s*#10a37f/);
  assert.match(source, /--cb-panel-bg:\s*#171717/);
  assert.match(popup, /--bg:\s*#f7f7f5/);
  assert.match(popup, /--surface:\s*#ffffff/);
  assert.match(popup, /--text:\s*#181a19/);
  assert.match(popup, /--border:\s*#d7ddd9/);
  assert.match(popup, /--accent:\s*#10a37f/);
  assert.match(popup, /--bg:\s*#0d0d0d/);
});
