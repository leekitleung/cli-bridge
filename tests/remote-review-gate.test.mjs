import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildRemoteReviewGateReport,
  parseGithubRunList,
  parsePullRequestView,
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
    ci: {
      status: 'absent',
    },
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
  assert.equal(report.ci.status, 'absent');
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
