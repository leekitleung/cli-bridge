import { spawnSync } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const DEFAULT_COMMAND_TIMEOUT_MS = 10_000;
const DEFAULT_OUTPUT_CAP_BYTES = 256_000;

export function runReadOnlyCommand(command, args, options = {}) {
  const outputCapBytes = options.outputCapBytes ?? DEFAULT_OUTPUT_CAP_BYTES;
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? process.cwd(),
    shell: false,
    timeout: options.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS,
    maxBuffer: outputCapBytes + 1,
  });
  const stdoutRaw = Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(result.stdout ?? '');
  const stderrRaw = Buffer.isBuffer(result.stderr) ? result.stderr : Buffer.from(result.stderr ?? '');
  const stdout = stdoutRaw.subarray(0, outputCapBytes);
  const remaining = Math.max(0, outputCapBytes - stdout.byteLength);
  const stderr = stderrRaw.subarray(0, remaining);
  const truncated = stdoutRaw.byteLength + stderrRaw.byteLength > outputCapBytes;
  const timedOut = result.error?.code === 'ETIMEDOUT';
  return {
    status: timedOut || truncated ? 1 : (result.status ?? 1),
    stdout: stdout.toString('utf8'),
    stderr: timedOut ? 'command timed out' : stderr.toString('utf8'),
    timedOut,
    truncated,
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

function parseGithubRemoteUrl(value) {
  const remote = trimOrNull(value);
  if (!remote) return null;
  const https = remote.match(/^https:\/\/github\.com\/([^/]+)\/([^/.]+)(?:\.git)?$/);
  if (https) {
    return { owner: https[1], repo: https[2] };
  }
  const ssh = remote.match(/^git@github\.com:([^/]+)\/([^/.]+)(?:\.git)?$/);
  if (ssh) {
    return { owner: ssh[1], repo: ssh[2] };
  }
  return null;
}

function fetchGithubJson(path) {
  try {
    const output = execFileSync('curl', [
      '-sS',
      '-f',
      '-L',
      '-H',
      'Accept: application/vnd.github+json',
      `https://api.github.com${path}`,
    ], {
      encoding: 'utf8',
      maxBuffer: DEFAULT_OUTPUT_CAP_BYTES,
      timeout: DEFAULT_COMMAND_TIMEOUT_MS,
    });
    return { ok: true, data: JSON.parse(output) };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : 'github api unavailable',
    };
  }
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

export function parseGithubActionsRunsPayload(payload, headSha) {
  const runs = Array.isArray(payload?.workflow_runs) ? payload.workflow_runs : [];
  const matchingRuns = runs.filter((run) => !headSha || run.head_sha === headSha);
  if (matchingRuns.length === 0) {
    return { status: 'absent' };
  }
  const [latest] = matchingRuns;
  const base = {
    workflowName: latest.name,
    databaseId: latest.id,
    url: latest.html_url,
    conclusion: latest.conclusion,
  };
  if (latest.status !== 'completed') {
    return { status: 'pending', ...base };
  }
  if (['success', 'neutral', 'skipped'].includes(latest.conclusion)) {
    return { status: 'pass', ...base };
  }
  return { status: 'fail', ...base };
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
  if (input.ci?.status !== 'pass') {
    failures.push(input.ci?.status === 'fail' ? 'ci-failing' : `ci-${input.ci?.status ?? 'missing'}`);
  }

  // pushed is true only when the local HEAD is actually present on the remote
  // upstream HEAD. This is a real push verification, not a restatement of
  // remoteMatchesLocal: it additionally requires an upstream and a clean tree
  // so an uncommitted local change cannot be reported as "pushed".
  const pushed = Boolean(
    input.upstream &&
    remoteMatchesLocal &&
    input.workingTreeClean,
  );

  // Hard failure when the remote diff scope contradicts the reported changed
  // files. Only evaluated when the caller supplies reportedChangedFiles and a
  // summarized remote diff scope; otherwise the diff scope stays a soft signal.
  const diffScopeContradiction = detectDiffScopeContradiction(
    input.remoteDiffScope,
    input.reportedChangedFiles,
  );
  if (diffScopeContradiction) {
    failures.push('remote-diff-scope-contradiction');
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
    pushed,
    pr: input.pr,
    ci: input.ci,
    remoteDiffScope: input.remoteDiffScope,
    verdict: failures.length === 0 ? 'pass' : 'fail',
    failures,
    warnings,
  };
}

function normalizeChangedFileList(files) {
  if (!Array.isArray(files)) {
    return null;
  }
  return files
    .map((file) => String(file ?? '').trim())
    .filter((file) => file.length > 0)
    .sort();
}

export function detectDiffScopeContradiction(remoteDiffScope, reportedChangedFiles) {
  const reported = normalizeChangedFileList(reportedChangedFiles);
  if (!reported || remoteDiffScope?.status !== 'summarized') {
    return false;
  }

  const summary = String(remoteDiffScope.summary ?? '').trim();

  // No remote-only divergence: the report must also claim no changed files.
  if (summary === '' || summary === 'none') {
    return reported.length > 0;
  }

  // The remote diff summary lists changed files (git diff --stat style). Each
  // reported file must appear in the summary; a reported file that is absent
  // from the remote diff is a contradiction.
  return reported.some((file) => !summary.includes(file));
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

function collectPublicGithubEvidence(cwd, branch, localHead) {
  const upstreamResult = runReadOnlyCommand('git', ['config', '--get', 'remote.origin.url'], { cwd });
  if (upstreamResult.status !== 0) {
    return {
      status: 'unavailable',
      reason: 'origin url unavailable',
    };
  }
  const repo = parseGithubRemoteUrl(upstreamResult.stdout);
  if (!repo) {
    return {
      status: 'unavailable',
      reason: 'origin is not a github repository',
    };
  }
  const runs = fetchGithubJson(`/repos/${repo.owner}/${repo.repo}/actions/runs?branch=${encodeURIComponent(branch ?? '')}&per_page=10`);
  if (runs.ok) {
    return parseGithubActionsRunsPayload(runs.data, localHead);
  }
  return {
    status: 'unavailable',
    reason: runs.reason,
  };
}

function collectGithubEvidence(cwd, branch, localHead) {
  const pr = parsePullRequestView(runReadOnlyCommand('gh', [
    'pr',
    'view',
    '--json',
    'number,state,url,headRefName,baseRefName',
  ], { cwd }));

  let ci = parseGithubRunList(runReadOnlyCommand('gh', [
    'run',
    'list',
    '--branch',
    branch ?? '',
    '--limit',
    '1',
    '--json',
    'status,conclusion,workflowName,databaseId,url',
  ], { cwd }));
  if (ci.status === 'unavailable') {
    ci = collectPublicGithubEvidence(cwd, branch, localHead);
  }

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
    : collectGithubEvidence(cwd, gitEvidence.branch, gitEvidence.localHead);

  return buildRemoteReviewGateReport({
    ...gitEvidence,
    ...githubEvidence,
    reportedChangedFiles: options.reportedChangedFiles,
  });
}

function parseCliArgs(argv) {
  const reportedChangedFiles = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--reported-file' && index + 1 < argv.length) {
      reportedChangedFiles.push(argv[index + 1]);
      index += 1;
    }
  }

  return {
    checkGithub: !argv.includes('--no-github'),
    pretty: argv.includes('--pretty'),
    reportedChangedFiles: reportedChangedFiles.length > 0 ? reportedChangedFiles : undefined,
  };
}

function isMainModule() {
  const entryPoint = process.argv[1];
  if (!entryPoint) {
    return false;
  }
  return import.meta.url === pathToFileURL(entryPoint).href;
}

if (isMainModule()) {
  const options = parseCliArgs(process.argv.slice(2));
  const report = collectRemoteReviewGateReport(options);
  console.log(JSON.stringify(report, null, options.pretty ? 2 : 0));
  process.exit(report.verdict === 'pass' ? 0 : 1);
}
