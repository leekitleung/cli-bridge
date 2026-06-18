import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';

import { runContainedProcess } from '../apps/local-server/src/process/contained-process.ts';

test('timeout terminates a child process tree and waits for close', async () => {
  const dir = mkdtempSync(resolve(tmpdir(), 'cli-bridge-process-'));
  const pidPath = resolve(dir, 'grandchild.pid');
  try {
    const script = [
      "const { spawn } = require('node:child_process');",
      "const { writeFileSync } = require('node:fs');",
      "const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });",
      'writeFileSync(process.argv[1], String(child.pid));',
      'setInterval(() => {}, 1000);',
    ].join('');
    const result = await runContainedProcess(process.execPath, ['-e', script, pidPath], {
      timeoutMs: 150,
      killGraceMs: 75,
      outputCapBytes: 1024,
    });
    assert.equal(result.timedOut, true);
    const grandchildPid = Number(readFileSync(pidPath, 'utf8'));
    assert.throws(() => process.kill(grandchildPid, 0), /ESRCH/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('timeout escalates after grace when SIGTERM is ignored', async () => {
  const started = Date.now();
  const result = await runContainedProcess(
    process.execPath,
    ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"],
    { timeoutMs: 80, killGraceMs: 80, outputCapBytes: 1024 },
  );
  assert.equal(result.timedOut, true);
  assert.ok(Date.now() - started >= 140);
  assert.ok(Date.now() - started < 2000);
});

test('stdout and stderr share one byte budget', async () => {
  const result = await runContainedProcess(
    process.execPath,
    ['-e', "process.stdout.write('12345678'); process.stderr.write('abcdefgh')"],
    { timeoutMs: 1000, killGraceMs: 50, outputCapBytes: 10 },
  );
  assert.equal(result.truncated, true);
  assert.ok(result.stdout.length + result.stderr.length <= 10);
});
