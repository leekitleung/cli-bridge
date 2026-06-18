import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

test('manual inbound helper uses server-owned outbound routing', async () => {
  const source = await readFile(resolve(import.meta.dirname, '../scripts/manual-inbound-e2e.mjs'), 'utf8');
  const requestBody = source.match(/body: JSON\.stringify\(([^\n]+)\)/)?.[1] ?? '';
  assert.equal(requestBody.includes('endpointId'), false);
  assert.equal(source.includes('args.endpoint'), false);
  assert.equal(source.includes('carries an endpointId'), false);
  assert.equal(source.includes('  endpointId:'), false);
  assert.match(source, /server-configured inbound-capable endpoint/);
  assert.match(source, /mock-inbound-agent/);
});
