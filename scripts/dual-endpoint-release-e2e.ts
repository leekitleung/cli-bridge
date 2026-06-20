import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';

import { startLocalServer, type LocalServerHandle } from '../apps/local-server/src/server.ts';
import { CODEX_REVIEW_ARGS } from '../apps/local-server/src/adapters/command-review-adapter.ts';
import { PAIRING_TOKEN_HEADER } from '../packages/shared/src/constants.ts';
import type { AgentEndpoint } from '../packages/shared/src/types.ts';

export const DUAL_ENDPOINT_SCENARIOS = [
  'cli-route',
  'chatgpt-route',
  'same-provider',
  'mixed-provider',
  'failure-timeout',
  'uncertain-dispatch',
  'control-pause-cancel',
  'workbuddy-boundary',
  'cleanup',
] as const;

export type DualEndpointScenario = typeof DUAL_ENDPOINT_SCENARIOS[number] | 'all';

export type DualEndpointFailureCode =
  | 'invalid-args'
  | 'blocked-real-cli'
  | 'blocked-real-chatgpt'
  | 'confirmation-timeout'
  | 'cleanup-failed'
  | 'unexpected-error';

export interface DualEndpointHarnessArgs {
  scenario: DualEndpointScenario;
  profileDir?: string;
  connectCdp?: string;
  reasoningCli?: string;
  executionCli?: string;
  outputDir: string;
  confirmationTimeoutMs: number;
  dryRun: boolean;
}

export interface DualEndpointEvidence {
  scenario: typeof DUAL_ENDPOINT_SCENARIOS[number];
  timestamp: string;
  ok: boolean;
  evidenceStatus: 'passed' | 'blocked';
  git: {
    commit: string | null;
    dirty: boolean;
  };
  planId?: string;
  proposalId?: string;
  endpointBindings: {
    reasoningEndpointId: string;
    reasoningRole: string;
    reasoningTier: string;
    executionEndpointId: string;
    executionRole: string;
    executionTier: string;
    locked: boolean;
  }[];
  transitionSequence: string[];
  confirmationIdentity?: {
    proposalId: string;
    contentHash: string;
    bindingHash: string;
  };
  controlResult?: {
    pauseStatus: string;
    cancelStatus: string;
  };
  failureClassification: string;
  processExitClassification: string;
  failure?: {
    code: DualEndpointFailureCode;
    message: string;
  };
  screenshotPaths: string[];
}

const DEFAULT_OUTPUT_DIR = 'output/playwright/dual-endpoint-automation';
const DEFAULT_CONFIRMATION_TIMEOUT_MS = 10 * 60_000;
const ACTIVE_HANDOFF_PATH = '/tmp/cli-bridge-dual-endpoint-active.json';
const CODEX_MEDIUM_ENDPOINT: AgentEndpoint = {
  id: 'codex-medium',
  label: 'Codex Medium',
  transport: 'command',
  risk: 'medium',
  capabilities: {
    canAcceptPrompt: true,
    canReturnOutput: true,
    canReview: true,
    canExecute: true,
    canSummarize: true,
  },
};

function usage(): string {
  return [
    'Usage:',
    '  node --experimental-strip-types scripts/dual-endpoint-release-e2e.ts --scenario <cli-route|chatgpt-route|same-provider|mixed-provider|failure-timeout|uncertain-dispatch|control-pause-cancel|workbuddy-boundary|cleanup|all>',
    '',
    'Options:',
    '  --profile-dir <path>',
    '  --connect-cdp <url>',
    '  --reasoning-cli <endpoint-id>',
    '  --execution-cli <endpoint-id>',
    '  --output-dir <path>',
    '  --confirmation-timeout-ms <milliseconds>',
    '  --dry-run',
  ].join('\n');
}

function valueFor(raw: Record<string, string | true>, key: string): string | undefined {
  const value = raw[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function positiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error('confirmation-timeout-ms must be a positive integer');
  return parsed;
}

export function parseArgs(argv: string[]): DualEndpointHarnessArgs {
  const raw: Record<string, string | true> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) throw new Error(`Unexpected argument: ${token}`);
    const key = token.slice(2);
    if (key === 'dry-run') {
      raw[key] = true;
      continue;
    }
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) throw new Error(`Missing value for --${key}`);
    raw[key] = next;
    index += 1;
  }

  const scenario = valueFor(raw, 'scenario') ?? process.env.CLI_BRIDGE_DUAL_ENDPOINT_SCENARIO ?? 'all';
  if (![...DUAL_ENDPOINT_SCENARIOS, 'all'].includes(scenario as DualEndpointScenario)) {
    throw new Error(`scenario must be one of ${[...DUAL_ENDPOINT_SCENARIOS, 'all'].join(', ')}`);
  }

  return {
    scenario: scenario as DualEndpointScenario,
    profileDir: valueFor(raw, 'profile-dir') ?? process.env.CLI_BRIDGE_DUAL_ENDPOINT_PROFILE_DIR,
    connectCdp: valueFor(raw, 'connect-cdp') ?? process.env.CLI_BRIDGE_DUAL_ENDPOINT_CONNECT_CDP,
    reasoningCli: valueFor(raw, 'reasoning-cli') ?? process.env.CLI_BRIDGE_DUAL_ENDPOINT_REASONING_CLI,
    executionCli: valueFor(raw, 'execution-cli') ?? process.env.CLI_BRIDGE_DUAL_ENDPOINT_EXECUTION_CLI,
    outputDir: valueFor(raw, 'output-dir') ?? process.env.CLI_BRIDGE_DUAL_ENDPOINT_OUTPUT_DIR ?? DEFAULT_OUTPUT_DIR,
    confirmationTimeoutMs: positiveInteger(
      valueFor(raw, 'confirmation-timeout-ms') ?? process.env.CLI_BRIDGE_DUAL_ENDPOINT_CONFIRMATION_TIMEOUT_MS,
      DEFAULT_CONFIRMATION_TIMEOUT_MS,
    ),
    dryRun: raw['dry-run'] === true || process.env.CLI_BRIDGE_DUAL_ENDPOINT_DRY_RUN === '1',
  };
}

export function sanitizeEvidence(value: unknown, secretValues: string[] = []): unknown {
  const secrets = secretValues.filter((secret) => secret.length > 0);
  const redactString = (input: string): string => {
    let output = input;
    for (const secret of secrets) output = output.split(secret).join('[REDACTED_SECRET]');
    output = output.replace(/document\.cookie/g, '[REDACTED_COOKIE_ACCESS]');
    output = output.replace(/localStorage/g, '[REDACTED_STORAGE_ACCESS]');
    output = output.replace(/(cookie|set-cookie)["']?\s*[:=]\s*["'][^"']+["']/gi, '$1:"[REDACTED_COOKIE]"');
    output = output.replace(/(apiKey|token|credential|password)["']?\s*[:=]\s*["']?[^"',}\s]+/gi, '$1:"[REDACTED_SECRET]"');
    return output;
  };
  if (typeof value === 'string') return redactString(value);
  if (Array.isArray(value)) return value.map((item) => sanitizeEvidence(item, secrets));
  if (value && typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      if (/cookie|pairingToken|credential|providerConfig|rawPrompt|rawReply|rawTranscript/i.test(key)) {
        output[key] = '[REDACTED]';
      } else {
        output[key] = sanitizeEvidence(nested, secrets);
      }
    }
    return output;
  }
  return value;
}

export function classifyDualEndpointError(error: unknown): { code: DualEndpointFailureCode; message: string } {
  const message = error instanceof Error ? error.message : String(error);
  if (/logged-in ChatGPT|ChatGPT profile|connect-cdp|profile-dir/i.test(message)) {
    return { code: 'blocked-real-chatgpt', message };
  }
  if (/real high-tier CLI|reasoning cli|execution cli|CLI endpoint/i.test(message)) {
    return { code: 'blocked-real-cli', message };
  }
  if (/confirmation.*timeout|operator confirmation/i.test(message)) {
    return { code: 'confirmation-timeout', message };
  }
  if (/cleanup|process behind/i.test(message)) {
    return { code: 'cleanup-failed', message };
  }
  return { code: 'unexpected-error', message };
}

async function runProcess(command: string, args: string[]): Promise<string> {
  return new Promise((resolveProcess, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk.toString(); });
    child.stderr.on('data', (chunk) => { output += chunk.toString(); });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) resolveProcess(output);
      else reject(new Error(`${command} ${args.join(' ')} failed: ${output.slice(0, 2000)}`));
    });
  });
}

async function collectGit(): Promise<DualEndpointEvidence['git']> {
  try {
    const commit = (await runProcess('git', ['rev-parse', '--short', 'HEAD'])).trim() || null;
    const status = await runProcess('git', ['status', '--short']);
    return { commit, dirty: status.trim().length > 0 };
  } catch {
    return { commit: null, dirty: true };
  }
}

function scenarioList(scenario: DualEndpointScenario): typeof DUAL_ENDPOINT_SCENARIOS[number][] {
  return scenario === 'all' ? [...DUAL_ENDPOINT_SCENARIOS] : [scenario];
}

function blockedReason(args: DualEndpointHarnessArgs, scenario: typeof DUAL_ENDPOINT_SCENARIOS[number]): Error | undefined {
  if ((scenario === 'cli-route' || scenario === 'same-provider' || scenario === 'mixed-provider') && !args.reasoningCli) {
    return new Error('real high-tier CLI endpoint is required for CLI reasoning evidence');
  }
  if (!args.executionCli && scenario !== 'chatgpt-route') {
    return new Error('execution CLI endpoint is required for release evidence');
  }
  if (scenario === 'chatgpt-route' && !args.profileDir && !args.connectCdp) {
    return new Error('logged-in ChatGPT profile is required for ChatGPT route evidence');
  }
  if (args.profileDir && !existsSync(args.profileDir)) {
    return new Error(`logged-in ChatGPT profile is required; profile-dir does not exist: ${args.profileDir}`);
  }
  return undefined;
}

async function writeEvidence(
  args: DualEndpointHarnessArgs,
  evidence: DualEndpointEvidence,
): Promise<DualEndpointEvidence> {
  await mkdir(args.outputDir, { recursive: true });
  const path = resolve(args.outputDir, `${evidence.timestamp}-${evidence.scenario}.json`);
  const sanitized = sanitizeEvidence(evidence) as DualEndpointEvidence;
  await writeFile(path, `${JSON.stringify(sanitized, null, 2)}\n`, 'utf8');
  return sanitized;
}

function blockedEvidence(
  scenario: typeof DUAL_ENDPOINT_SCENARIOS[number],
  timestamp: string,
  git: DualEndpointEvidence['git'],
  failure: { code: DualEndpointFailureCode; message: string },
): DualEndpointEvidence {
  return {
    scenario,
    timestamp,
    ok: false,
    evidenceStatus: 'blocked',
    git,
    endpointBindings: [],
    transitionSequence: [],
    failureClassification: failure.code,
    processExitClassification: 'not-run',
    failure,
    screenshotPaths: [],
  };
}

export function createDryRunEvidence(input: {
  scenario: typeof DUAL_ENDPOINT_SCENARIOS[number];
  timestamp: string;
  git: DualEndpointEvidence['git'];
  reasoningEndpointId?: string;
  executionEndpointId?: string;
}): DualEndpointEvidence {
  const scenario = input.scenario;
  const planId = `dry-plan-${scenario}`;
  const proposalId = `dry-proposal-${randomUUID().slice(0, 8)}`;
  const reasoningEndpointId = scenario === 'chatgpt-route' ? 'chatgpt-web' : input.reasoningEndpointId ?? 'codex-high';
  const executionEndpointId = input.executionEndpointId ?? 'codex-medium';
  const bindingHash = createHash('sha256')
    .update(`${scenario}:${reasoningEndpointId}:${executionEndpointId}`)
    .digest('hex');
  const contentHash = createHash('sha256').update(`${scenario}:${proposalId}`).digest('hex');
  return {
    scenario,
    timestamp: input.timestamp,
    ok: true,
    evidenceStatus: 'passed',
    git: input.git,
    planId,
    proposalId,
    endpointBindings: [{
      reasoningEndpointId,
      reasoningRole: 'planner-reviewer',
      reasoningTier: 'high',
      executionEndpointId,
      executionRole: 'bounded-executor',
      executionTier: scenario === 'same-provider' ? 'medium' : 'low-or-medium',
      locked: true,
    }],
    transitionSequence: [
      'binding-created',
      'binding-locked',
      'artifact-recorded',
      'proposal-awaiting-confirmation',
      'operator-confirmed',
      'dispatch-started',
      'result-correlated',
    ],
    confirmationIdentity: {
      proposalId,
      contentHash: `sha256:${contentHash}`,
      bindingHash: `sha256:${bindingHash}`,
    },
    controlResult: scenario === 'control-pause-cancel'
      ? { pauseStatus: 'paused', cancelStatus: 'cancelled' }
      : undefined,
    failureClassification: 'none',
    processExitClassification: 'not-run',
    screenshotPaths: [],
  };
}

function dryRunEvidence(
  args: DualEndpointHarnessArgs,
  scenario: typeof DUAL_ENDPOINT_SCENARIOS[number],
  timestamp: string,
  git: DualEndpointEvidence['git'],
): DualEndpointEvidence {
  return createDryRunEvidence({
    scenario,
    timestamp,
    git,
    reasoningEndpointId: args.reasoningCli,
    executionEndpointId: args.executionCli,
  });
}

function deterministicPlanJson(goalId: string): string {
  const now = Date.now();
  return JSON.stringify({
    id: `plan-${goalId}`,
    goalId,
    status: 'awaiting-approval',
    permittedTiers: ['patch-proposal'],
    steps: [{
      id: 'step-1',
      planId: `plan-${goalId}`,
      index: 0,
      intent: 'Run one bounded read-only execution proposal',
      kind: 'propose-patch',
      targetEndpointId: 'codex-medium',
      tier: 'patch-proposal',
      isStateMutating: false,
      status: 'pending',
    }],
    createdAt: now,
    updatedAt: now,
    projectId: 'cli-bridge',
  });
}

async function closeServer(handle: LocalServerHandle | undefined): Promise<void> {
  if (!handle) return;
  await new Promise<void>((resolveClose, reject) => {
    handle.server.close(error => error ? reject(error) : resolveClose());
  });
}

async function bridgeApi<T>(
  handle: LocalServerHandle,
  path: string,
  method: 'GET' | 'POST' = 'GET',
  body?: unknown,
): Promise<T> {
  const response = await fetch(`${handle.url}${path}`, {
    method,
    headers: {
      [PAIRING_TOKEN_HEADER]: handle.pairingToken,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json() as T & { message?: string };
  if (!response.ok) {
    throw new Error(`${method} ${path}: ${payload.message ?? `HTTP ${response.status}`}`);
  }
  return payload;
}

async function waitForOperatorDispatch(
  handle: LocalServerHandle,
  planId: string,
  proposalId: string,
  timeoutMs: number,
): Promise<{ proposal: any; transitions: string[] }> {
  const deadline = Date.now() + timeoutMs;
  const transitions: string[] = [];
  while (Date.now() < deadline) {
    const state = await bridgeApi<{ proposals: any[] }>(
      handle,
      `/bridge/execution-proposals?planId=${encodeURIComponent(planId)}`,
    );
    const proposal = state.proposals.find(item => item.id === proposalId);
    if (proposal) {
      if (transitions.at(-1) !== proposal.status) transitions.push(proposal.status);
      if (proposal.status === 'returned') return { proposal, transitions };
      if (['failed', 'paused', 'cancelled', 'timed-out'].includes(proposal.status)) {
        throw new Error(`operator dispatch stopped in ${proposal.status}: ${proposal.failureReason ?? 'no reason'}`);
      }
    }
    await new Promise(resolveWait => setTimeout(resolveWait, 1000));
  }
  throw new Error('operator confirmation timed out');
}

async function runRealCliRoute(
  args: DualEndpointHarnessArgs,
  timestamp: string,
  git: DualEndpointEvidence['git'],
): Promise<DualEndpointEvidence> {
  const reasoningEndpointId = args.reasoningCli ?? 'codex-command';
  if (!['codex-command', 'claude-code-command'].includes(reasoningEndpointId)) {
    throw new Error('reasoning CLI endpoint must be codex-command or claude-code-command');
  }
  if (args.executionCli !== 'codex-medium') {
    throw new Error('execution CLI endpoint must be codex-medium for the current bounded adapter');
  }

  let handle: LocalServerHandle | undefined;
  try {
    handle = await startLocalServer(0, {
      additionalEndpoints: [CODEX_MEDIUM_ENDPOINT],
      goalPlanCommandOptions: {
        runner: {
          async run(execution) {
            const goalId = (execution.stdin ?? '').match(/Goal ID:\s*([a-f0-9-]+)/i)?.[1] ?? 'goal-unknown';
            return { exitCode: 0, stdout: deterministicPlanJson(goalId), stderr: '', timedOut: false };
          },
        },
        launcherResolver(command) {
          return { executable: command, prependArgs: [] };
        },
      },
    });

    const goal = await bridgeApi<{ goal: { id: string } }>(handle, '/bridge/goals', 'POST', {
      sessionId: `dual-endpoint-cli-${Date.now()}`,
      description: 'Produce one real CLI reasoning artifact and execute one bounded read-only proposal',
      projectId: 'cli-bridge',
    });
    const planned = await bridgeApi<{ plan: { id: string; steps: { id: string }[] } }>(
      handle,
      '/bridge/goals/plan',
      'POST',
      { goalId: goal.goal.id },
    );
    const bindingResponse = await bridgeApi<{ binding: any }>(handle, '/bridge/automation/bindings', 'POST', {
      goalId: goal.goal.id,
      planId: planned.plan.id,
      reasoningEndpointId,
      executionEndpointId: 'codex-medium',
      reasoningTier: 'high',
      executionTier: 'medium',
      executionPermissionProfile: 'patch-proposal',
      executionWorkingDirectoryRef: 'cli-bridge',
      maxSteps: 1,
      maxReasoningRounds: 1,
      deadlineAt: new Date(Date.now() + args.confirmationTimeoutMs + 5 * 60_000).toISOString(),
    });
    await bridgeApi(handle, '/bridge/goals/approve', 'POST', { goalId: goal.goal.id });

    const review = await bridgeApi<{ review: { id: string } }>(handle, '/bridge/reviews', 'POST', {
      sessionId: `dual-endpoint-reasoning-${Date.now()}`,
      sourceEndpointId: reasoningEndpointId === 'codex-command' ? 'claude-code-command' : 'codex-command',
      targetEndpointId: reasoningEndpointId,
      prompt: 'Assess this bounded task: return a concise read-only verification result. Do not execute, edit files, choose endpoints, or grant permissions.',
    });
    await bridgeApi(handle, '/bridge/reviews/confirm', 'POST', { reviewId: review.review.id });
    const reasoning = await bridgeApi<{ artifact: any }>(handle, '/bridge/reviews/dispatch', 'POST', {
      reviewId: review.review.id,
      planId: planned.plan.id,
      artifactKind: 'execution-proposal',
    });
    if (!reasoning.artifact) throw new Error('real CLI reasoning artifact missing');

    const proposalResponse = await bridgeApi<{ proposal: any }>(handle, '/bridge/execution-proposals', 'POST', {
      planId: planned.plan.id,
      stepId: planned.plan.steps[0].id,
      artifactId: reasoning.artifact.artifactId,
      preview: 'Codex Medium: bounded read-only verification result',
      command: 'codex',
      args: [...CODEX_REVIEW_ARGS],
      stdin: 'Return a concise read-only verification result for the current cli-bridge repository. Do not edit files or execute follow-up actions.',
      expiresAt: Date.now() + args.confirmationTimeoutMs,
    });
    const proposal = proposalResponse.proposal;

    const handoff = {
      awaitingHumanConfirmation: true,
      consoleUrl: `${handle.url}/console/goals`,
      pairingToken: handle.pairingToken,
      goalId: goal.goal.id,
      planId: planned.plan.id,
      proposal: {
        id: proposal.id,
        preview: proposal.preview,
        contentHash: proposal.contentHash,
        bindingHash: proposal.bindingHash,
        executionEndpointId: proposal.executionEndpointId,
        permissionProfile: proposal.executionPermissionProfile,
      },
    };
    await writeFile(ACTIVE_HANDOFF_PATH, `${JSON.stringify(handoff, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
    console.log(JSON.stringify(handoff, null, 2));

    const returned = await waitForOperatorDispatch(
      handle,
      planned.plan.id,
      proposal.id,
      args.confirmationTimeoutMs,
    );
    return {
      scenario: 'cli-route',
      timestamp,
      ok: true,
      evidenceStatus: 'passed',
      git,
      planId: planned.plan.id,
      proposalId: proposal.id,
      endpointBindings: [{
        reasoningEndpointId,
        reasoningRole: 'planner-reviewer',
        reasoningTier: 'high',
        executionEndpointId: 'codex-medium',
        executionRole: 'bounded-executor',
        executionTier: 'medium',
        locked: Boolean(bindingResponse.binding.bindingHash),
      }],
      transitionSequence: [
        'binding-created',
        'binding-locked',
        'artifact-recorded',
        ...returned.transitions,
        'result-correlated',
      ],
      confirmationIdentity: {
        proposalId: proposal.id,
        contentHash: proposal.contentHash,
        bindingHash: proposal.bindingHash,
      },
      failureClassification: 'none',
      processExitClassification: returned.proposal.result?.exitCode === 0 ? 'exit-0' : 'nonzero-or-missing',
      screenshotPaths: [],
    };
  } finally {
    await unlink(ACTIVE_HANDOFF_PATH).catch(() => undefined);
    await closeServer(handle);
  }
}

export async function runHarness(args: DualEndpointHarnessArgs): Promise<DualEndpointEvidence[]> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const git = await collectGit();
  const results: DualEndpointEvidence[] = [];
  for (const scenario of scenarioList(args.scenario)) {
    const blocked = blockedReason(args, scenario);
    if (blocked) {
      results.push(await writeEvidence(args, blockedEvidence(
        scenario,
        timestamp,
        git,
        classifyDualEndpointError(blocked),
      )));
      continue;
    }
    if (args.dryRun) {
      results.push(await writeEvidence(args, dryRunEvidence(args, scenario, timestamp, git)));
      continue;
    }
    if (scenario === 'cli-route') {
      try {
        results.push(await writeEvidence(args, await runRealCliRoute(args, timestamp, git)));
      } catch (error) {
        results.push(await writeEvidence(args, blockedEvidence(
          scenario,
          timestamp,
          git,
          classifyDualEndpointError(error),
        )));
      }
      continue;
    }
    const failure = classifyDualEndpointError(new Error('real provider harness execution is not available in this environment'));
    results.push(await writeEvidence(args, blockedEvidence(scenario, timestamp, git, failure)));
  }
  return results;
}

async function main(): Promise<void> {
  let args: DualEndpointHarnessArgs;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(usage());
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
    return;
  }
  const results = await runHarness(args);
  const ok = results.every((result) => result.ok);
  console.log(JSON.stringify({
    ok,
    evidence: results.map((result) => ({
      scenario: result.scenario,
      status: result.evidenceStatus,
      failure: result.failure?.code,
    })),
  }, null, 2));
  process.exitCode = ok ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
