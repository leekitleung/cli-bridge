import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

let acceptanceSource = null;

function getSource() {
  if (!acceptanceSource) {
    const url = new URL('../scripts/automation-loop-acceptance.ts', import.meta.url);
    acceptanceSource = readFileSync(url, 'utf8');
  }
  return acceptanceSource;
}

test('automation loop acceptance script is wired', () => {
  const source = getSource();
  assert.match(source, /maxCycles:\s*2/);
  assert.match(source, /extension session cannot tick/i);
  assert.doesNotMatch(source, /localStorage\.setItem\(['"]cli-bridge-pairing-token/);
});

test('acceptance script validates max-cycles stop', () => {
  const source = getSource();
  assert.match(source, /stop reason must be max-cycles/);
});

test('acceptance script validates extension session 403', () => {
  const source = getSource();
  assert.match(source, /extension session must 403/);
});
