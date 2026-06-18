import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

test('README documents pairing recovery for server down and wrong token', async () => {
  const readme = await readFile(resolve(import.meta.dirname, '../README.md'), 'utf8');
  assert.match(readme, /Recovery notes:/);
  assert.match(readme, /local server cannot be reached/);
  assert.match(readme, /pairing token is invalid/);
  assert.match(readme, /copy the newest token printed\s+by `npm start`/);
  assert.match(readme, /刷新连接/);
});
