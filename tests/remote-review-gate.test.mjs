import assert from 'node:assert/strict';
import os from 'node:os';
import test from 'node:test';

import {
  buildRemoteReviewGateReport,
  detectDiffScopeContradiction,
  parseGithubRunList,
  parsePullRequestView,
  runReadOnlyCommand,
} from '../scripts/remote-review-gate.mjs';

test('remote review gate passes when clean local head matches remote head', () => {
  const report = buildRemoteReviewGateReport({
    branch: 'main',
    localHead: 'abc123',
    upstream: 'origin/main',
    remoteHead: 'abc123',
    workingTreeClean: true,
    pr: {
      status: 'absent',
    },
    ci: { status: 'pass' },
    remoteDiffScope: {
      status: 'summarized',
      summary: 'none',
    },
  });

  assert.equal(report.verdict, 'pass');
  assert.equal(report.remoteMatchesLocal, true);
  assert.equal(report.pushed, true);
  assert.deepEqual(report.failures, []);
  assert.equal(report.pr.status, 'absent');
  assert.equal(report.ci.status, 'pass');
});

test('remote review gate fails on dirty working tree', () => {
  const report = buildRemoteReviewGateReport({
    branch: 'main',
    localHead: 'abc123',
    upstream: 'origin/main',
    remoteHead: 'abc123',
    workingTreeClean: false,
    pr: {
      status: 'unavailable',
      reason: 'not checked',
    },
    ci: {
      status: 'unavailable',
      reason: 'not checked',
    },
    remoteDiffScope: {
      status: 'unavailable',
      reason: 'not checked',
    },
  });

  assert.equal(report.verdict, 'fail');
  assert.ok(report.failures.includes('working-tree-dirty'));
});

test('remote review gate fails on remote mismatch', () => {
  const report = buildRemoteReviewGateReport({
    branch: 'main',
    localHead: 'abc123',
    upstream: 'origin/main',
    remoteHead: 'def456',
    workingTreeClean: true,
    pr: {
      status: 'absent',
    },
    ci: {
      status: 'absent',
    },
    remoteDiffScope: {
      status: 'summarized',
      summary: '1 file changed',
    },
  });

  assert.equal(report.verdict, 'fail');
  assert.equal(report.remoteMatchesLocal, false);
  assert.equal(report.pushed, false);
  assert.ok(report.failures.includes('remote-head-mismatch'));
});

test('remote review gate reports missing upstream as failure', () => {
  const report = buildRemoteReviewGateReport({
    branch: 'main',
    localHead: 'abc123',
    upstream: null,
    remoteHead: null,
    workingTreeClean: true,
    pr: {
      status: 'unavailable',
      reason: 'no upstream',
    },
    ci: {
      status: 'unavailable',
      reason: 'no upstream',
    },
    remoteDiffScope: {
      status: 'unavailable',
      reason: 'no upstream',
    },
  });

  assert.equal(report.verdict, 'fail');
  assert.ok(report.failures.includes('missing-upstream'));
});

test('remote review gate blocks present failing CI', () => {
  const report = buildRemoteReviewGateReport({
    branch: 'main',
    localHead: 'abc123',
    upstream: 'origin/main',
    remoteHead: 'abc123',
    workingTreeClean: true,
    pr: {
      status: 'present',
      number: 10,
      state: 'OPEN',
    },
    ci: {
      status: 'fail',
      conclusion: 'failure',
    },
    remoteDiffScope: {
      status: 'summarized',
      summary: 'none',
    },
  });

  assert.equal(report.verdict, 'fail');
  assert.ok(report.failures.includes('ci-failing'));
});

for (const status of ['absent', 'pending', 'unavailable']) {
  test(`remote review gate fails when required CI is ${status}`, () => {
    const report = buildRemoteReviewGateReport({
      branch: 'main',
      localHead: 'abc',
      upstream: 'origin/main',
      remoteHead: 'abc',
      workingTreeClean: true,
      pr: { status: 'present' },
      ci: { status },
      remoteDiffScope: { status: 'summarized', summary: 'none' },
    });
    assert.equal(report.verdict, 'fail');
    assert.ok(report.failures.includes(`ci-${status}`));
  });
}

test('remote gate subprocesses time out with a stable failure', () => {
  const started = Date.now();
  const result = runReadOnlyCommand(
    process.execPath,
    ['-e', 'setInterval(() => {}, 1000)'],
    { timeoutMs: 50 },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /timed out/i);
  assert.ok(Date.now() - started < 1000);
});

test('remote gate stdout and stderr share one output budget', () => {
  const result = runReadOnlyCommand(
    process.execPath,
    ['-e', "process.stdout.write('12345678'); process.stderr.write('abcdefgh')"],
    { outputCapBytes: 10 },
  );
  assert.notEqual(result.status, 0);
  assert.ok(Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr) <= 10);
});

test('github parser distinguishes absent PR and unavailable PR', () => {
  assert.deepEqual(parsePullRequestView({
    status: 1,
    stderr: 'no pull requests found for branch',
    stdout: '',
  }), {
    status: 'absent',
  });

  assert.deepEqual(parsePullRequestView({
    status: 1,
    stderr: 'authentication required',
    stdout: '',
  }), {
    status: 'unavailable',
    reason: 'authentication required',
  });
});

test('github run parser reports absent, pending, pass, and fail states', () => {
  assert.deepEqual(parseGithubRunList({
    status: 0,
    stdout: '[]',
    stderr: '',
  }), {
    status: 'absent',
  });

  assert.equal(parseGithubRunList({
    status: 0,
    stdout: '[{"status":"in_progress","conclusion":"","url":"https://example.test/run"}]',
    stderr: '',
  }).status, 'pending');

  assert.equal(parseGithubRunList({
    status: 0,
    stdout: '[{"status":"completed","conclusion":"success","url":"https://example.test/run"}]',
    stderr: '',
  }).status, 'pass');

  assert.equal(parseGithubRunList({
    status: 0,
    stdout: '[{"status":"completed","conclusion":"failure","url":"https://example.test/run"}]',
    stderr: '',
  }).status, 'fail');
});

test('remote review gate CLI entry prints JSON and exits non-zero on a failing verdict', async () => {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const { resolve } = await import('node:path');
  const execFileAsync = promisify(execFile);

  const scriptPath = resolve(process.cwd(), 'scripts/remote-review-gate.mjs');

  // Run in a directory that is not a git repository so the gate fails
  // deterministically (no upstream / no remote head), and assert that the
  // CLI entry actually executes: it must print a JSON report and exit 1.
  let stdout = '';
  let exitCode = 0;
  try {
    const result = await execFileAsync(
      process.execPath,
      [scriptPath, '--no-github'],
      { cwd: os.tmpdir() },
    );
    stdout = result.stdout;
  } catch (error) {
    stdout = error.stdout ?? '';
    exitCode = error.code ?? 1;
  }

  assert.ok(stdout.trim().length > 0, 'CLI entry must print a report to stdout');
  const report = JSON.parse(stdout);
  assert.equal(report.verdict, 'fail');
  assert.equal(exitCode, 1);
});

test('pushed is true only with upstream, matching remote head, and clean tree', () => {
  const pushed = buildRemoteReviewGateReport({
    branch: 'main',
    localHead: 'abc123',
    upstream: 'origin/main',
    remoteHead: 'abc123',
    workingTreeClean: true,
    pr: { status: 'absent' },
    ci: { status: 'absent' },
    remoteDiffScope: { status: 'summarized', summary: 'none' },
  });
  assert.equal(pushed.pushed, true);

  const dirty = buildRemoteReviewGateReport({
    branch: 'main',
    localHead: 'abc123',
    upstream: 'origin/main',
    remoteHead: 'abc123',
    workingTreeClean: false,
    pr: { status: 'absent' },
    ci: { status: 'absent' },
    remoteDiffScope: { status: 'summarized', summary: 'none' },
  });
  assert.equal(dirty.pushed, false, 'a dirty tree must not be reported as pushed');

  const noUpstream = buildRemoteReviewGateReport({
    branch: 'main',
    localHead: 'abc123',
    upstream: null,
    remoteHead: null,
    workingTreeClean: true,
    pr: { status: 'unavailable', reason: 'no upstream' },
    ci: { status: 'unavailable', reason: 'no upstream' },
    remoteDiffScope: { status: 'unavailable', reason: 'no upstream' },
  });
  assert.equal(noUpstream.pushed, false, 'no upstream must not be reported as pushed');
});

test('remote review gate fails when remote diff scope contradicts reported changed files', () => {
  const report = buildRemoteReviewGateReport({
    branch: 'main',
    localHead: 'abc123',
    upstream: 'origin/main',
    remoteHead: 'def456',
    workingTreeClean: true,
    reportedChangedFiles: ['src/only-local.ts'],
    pr: { status: 'absent' },
    ci: { status: 'absent' },
    remoteDiffScope: {
      status: 'summarized',
      summary: ' src/other.ts | 2 +-\n 1 file changed',
    },
  });

  assert.equal(report.verdict, 'fail');
  assert.ok(report.failures.includes('remote-diff-scope-contradiction'));
});

test('detectDiffScopeContradiction handles none, match, and mismatch cases', () => {
  // No reported files supplied: never a contradiction (soft signal only).
  assert.equal(
    detectDiffScopeContradiction({ status: 'summarized', summary: 'x.ts | 1 +' }, undefined),
    false,
  );

  // Reported empty + remote none: consistent.
  assert.equal(
    detectDiffScopeContradiction({ status: 'summarized', summary: 'none' }, []),
    false,
  );

  // Reported files but remote says none: contradiction.
  assert.equal(
    detectDiffScopeContradiction({ status: 'summarized', summary: 'none' }, ['a.ts']),
    true,
  );

  // Reported file present in summary: consistent.
  assert.equal(
    detectDiffScopeContradiction(
      { status: 'summarized', summary: ' src/a.ts | 3 +++\n 1 file changed' },
      ['src/a.ts'],
    ),
    false,
  );

  // Unavailable diff scope: cannot contradict.
  assert.equal(
    detectDiffScopeContradiction({ status: 'unavailable', reason: 'x' }, ['a.ts']),
    false,
  );
});
