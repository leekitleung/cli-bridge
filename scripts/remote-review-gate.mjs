import { spawnSync } from 'node:child_process';

function runReadOnlyCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? process.cwd(),
    encoding: 'utf8',
    shell: false,
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

function trimOrNull(value) {
  const trimmed = String(value ?? '').trim();
  return trimmed.length > 0 ? trimmed : null;
}

function splitUpstream(upstream) {
  if (!upstream || !upstream.includes('/')) {
    return null;
  }
  const [remote, ...branchParts] = upstream.split('/');
  const branch = branchParts.join('/');
  if (!remote || !branch) {
    return null;
  }
  return {
    remote,
    branch,
  };
}

function normalizeReason(stderr, fallback) {
  return trimOrNull(stderr) ?? fallback;
}

export function parsePullRequestView(result) {
  if (result.status !== 0) {
    const stderr = result.stderr ?? '';
    if (/no pull requests? found/i.test(stderr)) {
      return {
        status: 'absent',
      };
    }
    return {
      status: 'unavailable',
      reason: normalizeReason(stderr, 'gh pr view unavailable'),
    };
  }

  try {
    const parsed = JSON.parse(result.stdout);
    return {
      status: 'present',
      number: parsed.number,
      state: parsed.state,
      url: parsed.url,
      headRefName: parsed.headRefName,
      baseRefName: parsed.baseRefName,
    };
  } catch {
    return {
      status: 'unavailable',
      reason: 'invalid gh pr view json',
    };
  }
}

export function parseGithubRunList(result) {
  if (result.status !== 0) {
    return {
      status: 'unavailable',
      reason: normalizeReason(result.stderr, 'gh run list unavailable'),
    };
  }

  let runs;
  try {
    runs = JSON.parse(result.stdout);
  } catch {
    return {
      status: 'unavailable',
      reason: 'invalid gh run list json',
    };
  }

  if (!Array.isArray(runs) || runs.length === 0) {
    return {
      status: 'absent',
    };
  }

  const [latest] = runs;
  const status = latest.status;
  const conclusion = latest.conclusion;
  const base = {
    workflowName: latest.workflowName,
    databaseId: latest.databaseId,
    url: latest.url,
    conclusion,
  };

  if (status !== 'completed') {
    return {
      status: 'pending',
      ...base,
    };
  }

  if (['success', 'neutral', 'skipped'].includes(conclusion)) {
    return {
      status: 'pass',
      ...base,
    };
  }

  return {
    status: 'fail',
    ...base,
  };
}

export function buildRemoteReviewGateReport(input) {
  const remoteMatchesLocal = Boolean(input.localHead && input.remoteHead && input.localHead === input.remoteHead);
  const failures = [];
  const warnings = [];

  if (!input.workingTreeClean) {
    failures.push('working-tree-dirty');
  }
  if (!input.upstream) {
    failures.push('missing-upstream');
  }
  if (input.upstream && !input.remoteHead) {
    failures.push('missing-remote-head');
  }
  if (input.localHead && input.remoteHead && !remoteMatchesLocal) {
    failures.push('remote-head-mismatch');
  }
  if (input.ci?.status === 'fail') {
    failures.push('ci-failing');
  }

  for (const [name, value] of [
    ['pr', input.pr],
    ['ci', input.ci],
    ['remoteDiffScope', input.remoteDiffScope],
  ]) {
    if (value?.status === 'unavailable') {
      warnings.push(`${name}-unavailable`);
    }
  }

  return {
    branch: input.branch,
    localHead: input.localHead,
    upstream: input.upstream,
    remoteHead: input.remoteHead,
    remoteMatchesLocal,
    workingTreeClean: input.workingTreeClean,
    pushed: remoteMatchesLocal,
    pr: input.pr,
    ci: input.ci,
    remoteDiffScope: input.remoteDiffScope,
    verdict: failures.length === 0 ? 'pass' : 'fail',
    failures,
    warnings,
  };
}

function collectGitEvidence(cwd) {
  const branch = trimOrNull(runReadOnlyCommand('git', ['branch', '--show-current'], { cwd }).stdout);
  const localHead = trimOrNull(runReadOnlyCommand('git', ['rev-parse', 'HEAD'], { cwd }).stdout);
  const upstreamResult = runReadOnlyCommand('git', ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], { cwd });
  const upstream = upstreamResult.status === 0 ? trimOrNull(upstreamResult.stdout) : null;
  const statusResult = runReadOnlyCommand('git', ['status', '--porcelain'], { cwd });
  const workingTreeClean = statusResult.status === 0 && statusResult.stdout.trim().length === 0;

  let remoteHead = null;
  let remoteDiffScope = {
    status: 'unavailable',
    reason: 'no upstream',
  };
  const upstreamParts = splitUpstream(upstream);
  if (upstreamParts) {
    const remoteResult = runReadOnlyCommand('git', [
      'ls-remote',
      upstreamParts.remote,
      `refs/heads/${upstreamParts.branch}`,
    ], { cwd });
    remoteHead = remoteResult.status === 0
      ? trimOrNull(remoteResult.stdout.split(/\s+/)[0])
      : null;
    if (remoteHead && localHead === remoteHead) {
      remoteDiffScope = {
        status: 'summarized',
        summary: 'none',
      };
    } else if (remoteHead && localHead) {
      const diffResult = runReadOnlyCommand('git', ['diff', '--stat', `${localHead}..${remoteHead}`], { cwd });
      remoteDiffScope = diffResult.status === 0
        ? {
            status: 'summarized',
            summary: diffResult.stdout.trim() || 'none',
          }
        : {
            status: 'unavailable',
            reason: normalizeReason(diffResult.stderr, 'git diff unavailable'),
          };
    }
  }

  return {
    branch,
    localHead,
    upstream,
    remoteHead,
    workingTreeClean,
    remoteDiffScope,
  };
}

function collectGithubEvidence(cwd, branch) {
  const pr = parsePullRequestView(runReadOnlyCommand('gh', [
    'pr',
    'view',
    '--json',
    'number,state,url,headRefName,baseRefName',
  ], { cwd }));

  const ci = parseGithubRunList(runReadOnlyCommand('gh', [
    'run',
    'list',
    '--branch',
    branch ?? '',
    '--limit',
    '1',
    '--json',
    'status,conclusion,workflowName,databaseId,url',
  ], { cwd }));

  return {
    pr,
    ci,
  };
}

export function collectRemoteReviewGateReport(options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const gitEvidence = collectGitEvidence(cwd);
  const githubEvidence = options.checkGithub === false
    ? {
        pr: {
          status: 'unavailable',
          reason: 'github check disabled',
        },
        ci: {
          status: 'unavailable',
          reason: 'github check disabled',
        },
      }
    : collectGithubEvidence(cwd, gitEvidence.branch);

  return buildRemoteReviewGateReport({
    ...gitEvidence,
    ...githubEvidence,
  });
}

function parseCliArgs(argv) {
  return {
    checkGithub: !argv.includes('--no-github'),
    pretty: argv.includes('--pretty'),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const options = parseCliArgs(process.argv.slice(2));
  const report = collectRemoteReviewGateReport(options);
  console.log(JSON.stringify(report, null, options.pretty ? 2 : 0));
  process.exit(report.verdict === 'pass' ? 0 : 1);
}
