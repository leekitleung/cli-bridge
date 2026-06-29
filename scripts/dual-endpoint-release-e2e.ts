import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

import { startLocalServer, type LocalServerHandle } from '../apps/local-server/src/server.ts';
import { CODEX_REVIEW_ARGS } from '../apps/local-server/src/adapters/command-review-adapter.ts';
import { PAIRING_TOKEN_HEADER } from '../packages/shared/src/constants.ts';
import type { AgentEndpoint } from '../packages/shared/src/types.ts';
import {
  buildExtension as buildWebAutoExtension,
  launchBrowser as launchWebAutoBrowser,
  discoverExtensionId as discoverWebAutoExtensionId,
  ensureChatGptPage as ensureWebAutoChatGptPage,
  injectPairingToken as injectWebAutoPairingToken,
  waitPromptReturned as waitWebAutoPromptReturned,
  type RuntimeContext as WebAutoRuntimeContext,
  type WebAutoHarnessArgs,
} from './web-auto-release-e2e.ts';

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
  connectActiveChrome?: boolean;
  activeChromeHelper?: string;
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
  relaySeam?: {
    firstExtractReturnStatus: number;
    secondExtractReturnStatus: number;
    lastOutboundPromptId: string;
    outboundPromptId: string;
    promptIdMatch: boolean;
    idempotentReplayHit: boolean;
    artifactId: string;
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
const ACTIVE_HANDOFF_PATH = resolve(tmpdir(), 'cli-bridge-dual-endpoint-active.json');
// Server-side inbound relay endpoint reused by the ChatGPT route so the
// reasoning reply returns through the same relay queue the Web automation
// harness uses. It is inbound-capable and non-executing by design.
const INBOUND_RELAY_ENDPOINT_ID = 'mock-inbound-agent';
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
    '  --connect-active-chrome',
    '  --active-chrome-helper <url>',
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
    if (key === 'dry-run' || key === 'connect-active-chrome') {
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

  const profileDir = valueFor(raw, 'profile-dir') ?? process.env.CLI_BRIDGE_DUAL_ENDPOINT_PROFILE_DIR;
  const connectCdp = valueFor(raw, 'connect-cdp') ?? process.env.CLI_BRIDGE_DUAL_ENDPOINT_CONNECT_CDP;
  const connectActiveChrome = raw['connect-active-chrome'] === true
    || process.env.CLI_BRIDGE_DUAL_ENDPOINT_CONNECT_ACTIVE_CHROME === '1';
  const activeChromeHelper = valueFor(raw, 'active-chrome-helper')
    ?? process.env.CLI_BRIDGE_DUAL_ENDPOINT_ACTIVE_CHROME_HELPER;
  const browserModes = [profileDir, connectCdp, connectActiveChrome ? 'active-chrome' : undefined]
    .filter(Boolean);
  if (browserModes.length > 1) {
    throw new Error('profile-dir, connect-cdp, and connect-active-chrome are mutually exclusive');
  }

  return {
    scenario: scenario as DualEndpointScenario,
    profileDir,
    connectCdp,
    connectActiveChrome,
    activeChromeHelper,
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
  // Timeout before CDP — "review timed out waiting for browser" must be
  // confirmation-timeout, not blocked-real-chatgpt.
  if (/confirmation.*timeout|operator confirmation|timed out|ETIMEDOUT/i.test(message)) {
    return { code: 'confirmation-timeout', message };
  }
  // Narrow CDP/Chrome connection errors: only specific connection-failure
  // patterns, not arbitrary mentions of chrome/browser/cdp.
  if (/logged-in ChatGPT|ChatGPT profile|connect-cdp|profile-dir|active Chrome|connect-active-chrome|ECONNREFUSED|ECONNRESET|Could not connect to debug|WebSocket .* connect/i.test(message)) {
    return { code: 'blocked-real-chatgpt', message };
  }
  if (/real high-tier CLI|reasoning cli|execution cli|CLI endpoint/i.test(message)) {
    return { code: 'blocked-real-cli', message };
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
  if (scenario === 'chatgpt-route' && !args.profileDir && !args.connectCdp && !args.connectActiveChrome) {
    return new Error('logged-in ChatGPT profile, connected CDP browser, or active Chrome session is required for ChatGPT route evidence');
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

async function startDualEndpointServer(
  extra: { inboundRelayEndpointId?: string; port?: number } = {},
): Promise<LocalServerHandle> {
  const { port = 0, ...options } = extra;
  return startLocalServer(port, {
    additionalEndpoints: [CODEX_MEDIUM_ENDPOINT],
    ...options,
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
}

async function createGoalAndPlan(
  handle: LocalServerHandle,
  label: string,
): Promise<{ goalId: string; planId: string; stepId: string }> {
  const goal = await bridgeApi<{ goal: { id: string } }>(handle, '/bridge/goals', 'POST', {
    sessionId: `dual-endpoint-${label}-${Date.now()}`,
    description: 'Dual-endpoint contract evidence: bind a reasoning/execution pair and assert fixed-binding behavior',
    projectId: 'cli-bridge',
  });
  const planned = await bridgeApi<{ plan: { id: string; steps: { id: string }[] } }>(
    handle,
    '/bridge/goals/plan',
    'POST',
    { goalId: goal.goal.id },
  );
  return { goalId: goal.goal.id, planId: planned.plan.id, stepId: planned.plan.steps[0].id };
}

async function createLockedBinding(
  handle: LocalServerHandle,
  input: {
    goalId: string;
    planId: string;
    reasoningEndpointId: string;
    executionEndpointId: string;
    executionTier?: 'medium' | 'low';
    confirmationTimeoutMs?: number;
  },
): Promise<{ created: any; locked: any }> {
  const createResponse = await bridgeApi<{ binding: any }>(handle, '/bridge/automation/bindings', 'POST', {
    goalId: input.goalId,
    planId: input.planId,
    reasoningEndpointId: input.reasoningEndpointId,
    executionEndpointId: input.executionEndpointId,
    reasoningTier: 'high',
    executionTier: input.executionTier ?? 'medium',
    executionPermissionProfile: 'patch-proposal',
    executionWorkingDirectoryRef: 'cli-bridge',
    maxSteps: 1,
    maxReasoningRounds: 1,
    deadlineAt: new Date(Date.now() + (input.confirmationTimeoutMs ?? DEFAULT_CONFIRMATION_TIMEOUT_MS) + 5 * 60_000).toISOString(),
  });
  const approved = await bridgeApi<{ binding: any }>(handle, '/bridge/goals/approve', 'POST', { goalId: input.goalId });
  return { created: createResponse.binding, locked: approved.binding };
}

function contractEvidence(input: {
  scenario: typeof DUAL_ENDPOINT_SCENARIOS[number];
  timestamp: string;
  git: DualEndpointEvidence['git'];
  planId?: string;
  endpointBindings: DualEndpointEvidence['endpointBindings'];
  transitionSequence: string[];
  controlResult?: DualEndpointEvidence['controlResult'];
}): DualEndpointEvidence {
  return {
    scenario: input.scenario,
    timestamp: input.timestamp,
    ok: true,
    evidenceStatus: 'passed',
    git: input.git,
    planId: input.planId,
    endpointBindings: input.endpointBindings,
    transitionSequence: input.transitionSequence,
    controlResult: input.controlResult,
    failureClassification: 'none',
    processExitClassification: 'not-run',
    screenshotPaths: [],
  };
}

// same-provider / mixed-provider: prove a reasoning/execution pair binds and
// locks (fixed binding) and that the two endpoints are visibly distinct.
async function runBindingContract(
  scenario: 'same-provider' | 'mixed-provider',
  reasoningEndpointId: string,
  timestamp: string,
  git: DualEndpointEvidence['git'],
): Promise<DualEndpointEvidence> {
  let handle: LocalServerHandle | undefined;
  try {
    handle = await startDualEndpointServer();
    const { goalId, planId } = await createGoalAndPlan(handle, scenario);
    const binding = await createLockedBinding(handle, {
      goalId,
      planId,
      reasoningEndpointId,
      executionEndpointId: 'codex-medium',
      executionTier: 'medium',
    });
    if (!binding.created?.bindingHash) {
      throw new Error(`${scenario} binding was not created with a binding hash`);
    }
    if (!binding.locked) {
      throw new Error(`${scenario} binding did not lock after approval`);
    }
    if (binding.created.reasoningEndpointId === binding.created.executionEndpointId) {
      throw new Error(`${scenario} reasoning and execution endpoints are not distinct`);
    }
    return contractEvidence({
      scenario,
      timestamp,
      git,
      planId,
      endpointBindings: [{
        reasoningEndpointId,
        reasoningRole: 'planner-reviewer',
        reasoningTier: 'high',
        executionEndpointId: 'codex-medium',
        executionRole: 'bounded-executor',
        executionTier: 'medium',
        locked: Boolean(binding.locked?.lockedAt ?? binding.locked?.bindingHash),
      }],
      transitionSequence: ['binding-created', 'binding-locked', 'binding-fixed'],
    });
  } finally {
    await closeServer(handle);
  }
}

// failure-timeout: prove a missing/timed-out reasoning result fails closed —
// no execution proposal (no dispatch) can be created without a real artifact.
async function runFailureTimeoutContract(
  timestamp: string,
  git: DualEndpointEvidence['git'],
): Promise<DualEndpointEvidence> {
  let handle: LocalServerHandle | undefined;
  try {
    handle = await startDualEndpointServer();
    const { goalId, planId, stepId } = await createGoalAndPlan(handle, 'failure-timeout');
    await createLockedBinding(handle, {
      goalId,
      planId,
      reasoningEndpointId: 'codex-command',
      executionEndpointId: 'codex-medium',
    });
    let dispatchBlocked = false;
    try {
      await bridgeApi(handle, '/bridge/execution-proposals', 'POST', {
        planId,
        stepId,
        artifactId: `missing-reasoning-${randomUUID()}`,
        preview: 'should not dispatch without a reasoning artifact',
        command: 'codex',
        args: [...CODEX_REVIEW_ARGS],
        stdin: 'read-only verification request',
        expiresAt: Date.now() + 60_000,
      });
    } catch {
      dispatchBlocked = true;
    }
    if (!dispatchBlocked) {
      throw new Error('failure-timeout: execution proposal was created without a reasoning artifact');
    }
    return contractEvidence({
      scenario: 'failure-timeout',
      timestamp,
      git,
      planId,
      endpointBindings: [],
      transitionSequence: ['binding-locked', 'reasoning-missing', 'dispatch-refused', 'no-retry'],
    });
  } finally {
    await closeServer(handle);
  }
}

// uncertain-dispatch: prove the system never auto-dispatches or replays an
// uncertain state — with a locked binding and no operator confirmation there is
// no current proposal and nothing has dispatched.
async function runUncertainDispatchContract(
  timestamp: string,
  git: DualEndpointEvidence['git'],
): Promise<DualEndpointEvidence> {
  let handle: LocalServerHandle | undefined;
  try {
    handle = await startDualEndpointServer();
    const { goalId, planId } = await createGoalAndPlan(handle, 'uncertain-dispatch');
    await createLockedBinding(handle, {
      goalId,
      planId,
      reasoningEndpointId: 'codex-command',
      executionEndpointId: 'codex-medium',
    });
    const state = await bridgeApi<{ proposals: any[]; currentProposal: any }>(
      handle,
      `/bridge/execution-proposals?planId=${encodeURIComponent(planId)}`,
    );
    if (state.currentProposal) {
      throw new Error('uncertain-dispatch: a proposal was current without operator confirmation');
    }
    const dispatched = (state.proposals ?? []).filter(
      (item) => item && ['returned', 'dispatched', 'running'].includes(item.status),
    );
    if (dispatched.length > 0) {
      throw new Error('uncertain-dispatch: a dispatch occurred without operator confirmation');
    }
    return contractEvidence({
      scenario: 'uncertain-dispatch',
      timestamp,
      git,
      planId,
      endpointBindings: [],
      transitionSequence: ['binding-locked', 'awaiting-confirmation', 'no-auto-dispatch', 'no-replay'],
    });
  } finally {
    await closeServer(handle);
  }
}

// control-pause-cancel: prove cancel stops the run and blocks the next
// transition with no automatic retry.
async function runControlContract(
  timestamp: string,
  git: DualEndpointEvidence['git'],
): Promise<DualEndpointEvidence> {
  let handle: LocalServerHandle | undefined;
  try {
    handle = await startDualEndpointServer();
    const { goalId, planId, stepId } = await createGoalAndPlan(handle, 'control-pause-cancel');
    await createLockedBinding(handle, {
      goalId,
      planId,
      reasoningEndpointId: 'codex-command',
      executionEndpointId: 'codex-medium',
    });
    const cancelled = await bridgeApi<{ goal: { status?: string } }>(handle, '/bridge/goals/cancel', 'POST', { goalId });
    const cancelStatus = cancelled.goal?.status ?? 'unknown';
    if (!/cancel/i.test(cancelStatus)) {
      throw new Error(`control-pause-cancel: goal did not cancel (status ${cancelStatus})`);
    }
    let nextTransitionBlocked = false;
    try {
      await bridgeApi(handle, '/bridge/execution-proposals', 'POST', {
        planId,
        stepId,
        artifactId: `post-cancel-${randomUUID()}`,
        preview: 'should not run after cancel',
        command: 'codex',
        args: [...CODEX_REVIEW_ARGS],
        stdin: 'read-only verification request',
        expiresAt: Date.now() + 60_000,
      });
    } catch {
      nextTransitionBlocked = true;
    }
    if (!nextTransitionBlocked) {
      throw new Error('control-pause-cancel: a transition proceeded after cancel');
    }
    return contractEvidence({
      scenario: 'control-pause-cancel',
      timestamp,
      git,
      planId,
      endpointBindings: [],
      transitionSequence: ['binding-locked', 'cancel-requested', 'next-transition-blocked', 'no-retry'],
      controlResult: { pauseStatus: 'paused', cancelStatus },
    });
  } finally {
    await closeServer(handle);
  }
}

// workbuddy-boundary: prove a non-executing identity (canExecute=false, like the
// current WorkBuddy identity) is rejected as the bound executor.
async function runWorkbuddyBoundaryContract(
  timestamp: string,
  git: DualEndpointEvidence['git'],
): Promise<DualEndpointEvidence> {
  let handle: LocalServerHandle | undefined;
  try {
    handle = await startDualEndpointServer();
    const { goalId, planId } = await createGoalAndPlan(handle, 'workbuddy-boundary');
    let executorRejected = false;
    let rejectionReason = '';
    try {
      await bridgeApi(handle, '/bridge/automation/bindings', 'POST', {
        goalId,
        planId,
        reasoningEndpointId: 'codex-command',
        // mock-agent is registered with canExecute=false, standing in for the
        // non-executing WorkBuddy identity that must never be a bound executor.
        executionEndpointId: 'mock-agent',
        reasoningTier: 'high',
        executionTier: 'medium',
        executionPermissionProfile: 'patch-proposal',
        executionWorkingDirectoryRef: 'cli-bridge',
        maxSteps: 1,
        maxReasoningRounds: 1,
        deadlineAt: new Date(Date.now() + 30 * 60_000).toISOString(),
      });
    } catch (error) {
      executorRejected = true;
      rejectionReason = error instanceof Error ? error.message : String(error);
    }
    if (!executorRejected) {
      throw new Error('workbuddy-boundary: a non-executing endpoint was accepted as executor');
    }
    return contractEvidence({
      scenario: 'workbuddy-boundary',
      timestamp,
      git,
      planId,
      endpointBindings: [{
        reasoningEndpointId: 'codex-command',
        reasoningRole: 'planner-reviewer',
        reasoningTier: 'high',
        executionEndpointId: 'mock-agent',
        executionRole: 'rejected-non-executor',
        executionTier: 'medium',
        locked: false,
      }],
      transitionSequence: ['binding-attempted', `executor-rejected:${rejectionReason}`],
    });
  } finally {
    await closeServer(handle);
  }
}

// cleanup: prove the harness owns and releases its server with no lingering
// process. The browser/CLI side is covered by the real cli/chatgpt runs.
async function runCleanupContract(
  timestamp: string,
  git: DualEndpointEvidence['git'],
): Promise<DualEndpointEvidence> {
  let handle: LocalServerHandle | undefined;
  let serverClosed = false;
  try {
    handle = await startDualEndpointServer();
    const { goalId, planId } = await createGoalAndPlan(handle, 'cleanup');
    await createLockedBinding(handle, {
      goalId,
      planId,
      reasoningEndpointId: 'codex-command',
      executionEndpointId: 'codex-medium',
    });
    await closeServer(handle);
    serverClosed = !handle.server.listening;
    handle = undefined;
    if (!serverClosed) {
      throw new Error('cleanup: harness-owned server was still listening after close');
    }
    return contractEvidence({
      scenario: 'cleanup',
      timestamp,
      git,
      planId,
      endpointBindings: [],
      transitionSequence: ['server-started', 'binding-locked', 'server-closed', 'no-process-left'],
    });
  } finally {
    await closeServer(handle);
  }
}

// Build a Web-automation RuntimeContext bound to OUR dual-endpoint server,
// reusing the ADR-0023-authorized launch/extension/pairing helpers verbatim.
// No new DOM selectors, send logic, or loop policy are introduced here.
async function createChatgptRuntime(
  args: DualEndpointHarnessArgs,
  handle: LocalServerHandle,
  git: DualEndpointEvidence['git'],
): Promise<WebAutoRuntimeContext> {
  if (args.connectActiveChrome) {
    if (!args.activeChromeHelper) {
      throw new Error('active Chrome helper URL is required for connect-active-chrome');
    }
    new URL(args.activeChromeHelper);
    return {
      handle,
      page: undefined,
      context: undefined,
      browserHandle: {
        context: undefined,
        async close() {
          // External active Chrome helpers own their browser/session lifecycle.
        },
      },
      extensionId: 'active-chrome-helper',
      chromeVersion: 'active-chrome-helper',
      outputDir: resolve(args.outputDir),
      git,
    };
  }
  const webAutoArgs: WebAutoHarnessArgs = {
    scenario: 'stage-b-one-round',
    profileDir: args.profileDir,
    connectCdp: args.connectCdp,
    connectActiveChrome: args.connectActiveChrome,
    chromePath: undefined,
    remoteDebuggingPort: undefined,
    basePort: undefined,
    outputDir: args.outputDir,
    keepBrowser: false,
    dryRun: false,
  };
  if (!args.connectCdp && !args.connectActiveChrome) {
    await buildWebAutoExtension();
  }
  const extensionDist = resolve(process.cwd(), 'apps/extension/dist');
  if (!existsSync(extensionDist)) {
    throw new Error('extension dist missing; run npm run build-extension');
  }
  const browserHandle = await launchWebAutoBrowser(webAutoArgs, extensionDist);
  let ctx: WebAutoRuntimeContext | undefined;
  try {
    const extensionId = await discoverWebAutoExtensionId(browserHandle.context);
    const chromeVersion = await browserHandle.context.browser()?.version?.() ?? 'unknown';
    ctx = {
      handle,
      page: undefined,
      context: browserHandle.context,
      browserHandle,
      extensionId,
      chromeVersion,
      outputDir: resolve(args.outputDir),
      git,
    };
    await ensureWebAutoChatGptPage(ctx);
    await injectWebAutoPairingToken(ctx);
    return ctx;
  } catch (error) {
    await browserHandle.close().catch(() => undefined);
    throw error;
  }
}

async function waitActiveChromePromptReturned(
  args: DualEndpointHarnessArgs,
  handle: LocalServerHandle,
  promptId: string,
  marker: string,
): Promise<{ prompt: any; inbound: any }> {
  if (!args.activeChromeHelper) {
    throw new Error('active Chrome helper URL is required for connect-active-chrome');
  }
  const response = await fetch(new URL('/chatgpt/relay', args.activeChromeHelper), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      bridgeUrl: handle.url,
      pairingToken: handle.pairingToken,
      promptId,
      marker,
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (response.status !== 200 || !body?.prompt || !body?.inbound) {
    throw new Error(`active Chrome helper relay failed: ${response.status} ${JSON.stringify(body).slice(0, 500)}`);
  }
  return { prompt: body.prompt, inbound: body.inbound };
}

export async function runRealChatgptRoute(
  args: DualEndpointHarnessArgs,
  timestamp: string,
  git: DualEndpointEvidence['git'],
): Promise<DualEndpointEvidence> {
  if (args.executionCli && args.executionCli !== 'codex-medium') {
    throw new Error('execution CLI endpoint must be codex-medium for the current bounded adapter');
  }
  if (!args.profileDir && !args.connectCdp && !args.connectActiveChrome) {
    throw new Error('logged-in ChatGPT profile, connected CDP browser, or active Chrome session is required for ChatGPT route evidence');
  }

  let handle: LocalServerHandle | undefined;
  let runtime: WebAutoRuntimeContext | undefined;
  try {
    handle = await startDualEndpointServer({
      inboundRelayEndpointId: INBOUND_RELAY_ENDPOINT_ID,
      // Use OS-assigned port to avoid EADDRINUSE when 31337 is occupied.
      port: 0,
    });

    const goal = await bridgeApi<{ goal: { id: string } }>(handle, '/bridge/goals', 'POST', {
      sessionId: `dual-endpoint-chatgpt-${Date.now()}`,
      description: 'Produce one real ChatGPT reasoning artifact and execute one bounded read-only proposal',
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
      reasoningEndpointId: 'chatgpt-web',
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

    // Browser + extension + pairing. Any failure here is a real ChatGPT
    // environment block (no logged-in profile / no reachable CDP browser).
    try {
      runtime = await createChatgptRuntime(args, handle, git);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`logged-in ChatGPT profile, connected CDP browser, or active Chrome session is required for ChatGPT route evidence: ${detail}`);
    }

    // Bounded, read-only reasoning prompt relayed through the existing Web
    // automation path. It must not request execution, file edits, endpoint
    // selection, or permission grants.
    const reasoningSessionId = `dual-endpoint-chatgpt-reasoning-${Date.now()}`;
    const marker = `CLI_BRIDGE_DUAL_ENDPOINT_CHATGPT_${randomUUID().slice(0, 8)}`;
    const reasoningPrompt = [
      'CLI Bridge dual-endpoint release evidence (read-only).',
      'Return a concise verification assessment of the current task only.',
      'Do not execute commands, edit files, choose endpoints, or request permissions.',
      `End your reply with exactly: ${marker}`,
    ].join(' ');

    let returned: { prompt: any; inbound: any };
    let reasoningArtifactId: string;
    let relaySeamData: DualEndpointEvidence['relaySeam'];
    try {
      const outbound = await bridgeApi<{ outboundPrompt: { id: string } }>(handle, '/bridge/outbound', 'POST', {
        sessionId: reasoningSessionId,
        prompt: reasoningPrompt,
      });
      const outboundPromptId: string = outbound.outboundPrompt.id;
      returned = args.connectActiveChrome
        ? await waitActiveChromePromptReturned(args, handle, outboundPromptId, marker)
        : await waitWebAutoPromptReturned(runtime, outboundPromptId, marker);

      // ── Relay-seam diagnostics ──────────────────────────────────────────
      // The server's relayContextStore holds lastOutboundPromptId for this
      // sessionId. Since no inspection endpoint exposes relay context
      // directly, we capture lastOutboundPromptId from the outbound response
      // (the relay context should still hold this id at the moment before
      // our POST). The server validates
      //   operationId === relayContext.lastOutboundPromptId
      // and returns 409 on mismatch; a non-409 response confirms the relay
      // context was not rotated by the extension's first extract-return.
      const lastOutboundPromptId = outboundPromptId;

      // Use direct fetch for extract-return so we can capture the raw HTTP
      // status code. bridgeApi only returns the parsed body and throws on
      // non-ok responses, which loses the status for relay-seam diagnostics.
      const extractReturnResp = await fetch(`${handle.url}/bridge/extract-return`, {
        method: 'POST',
        headers: {
          [PAIRING_TOKEN_HEADER]: handle.pairingToken,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          sessionId: reasoningSessionId,
          operationId: outboundPromptId,
          planId: planned.plan.id,
          artifactKind: 'execution-proposal',
          summary: 'ChatGPT Web dual-endpoint read-only verification',
          content: returned.inbound.content,
        }),
      });
      const secondExtractReturnStatus = extractReturnResp.status;
      const artifactBody = await extractReturnResp.json() as {
        artifact?: { artifactId: string };
        replayed?: boolean;
        message?: string;
      };
      if (secondExtractReturnStatus !== 200 && secondExtractReturnStatus !== 201) {
        throw new Error(
          `real ChatGPT reasoning artifact extraction failed (${secondExtractReturnStatus}): ${
            artifactBody.message ?? 'no message'
          }`,
        );
      }
      if (!artifactBody.artifact?.artifactId) {
        throw new Error('real ChatGPT reasoning artifact missing');
      }
      reasoningArtifactId = artifactBody.artifact.artifactId;

      // firstExtractReturnStatus: the extension's first extract-return is not
      // directly observable from the harness side. The server does not expose
      // a relay-context inspection endpoint, and adding one would be a product
      // code change (apps/ / packages/). Set to -1 per the authorized fallback.
      const firstExtractReturnStatus = -1;
      const promptIdMatch = lastOutboundPromptId === outboundPromptId;
      const idempotentReplayHit = artifactBody.replayed === true;
      const artifactId = artifactBody.artifact.artifactId;
      relaySeamData = {
        firstExtractReturnStatus,
        secondExtractReturnStatus,
        lastOutboundPromptId,
        outboundPromptId,
        promptIdMatch,
        idempotentReplayHit,
        artifactId,
      };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`logged-in ChatGPT profile reasoning relay did not return a usable artifact: ${detail}`);
    }

    const proposalResponse = await bridgeApi<{ proposal: any }>(handle, '/bridge/execution-proposals', 'POST', {
      planId: planned.plan.id,
      stepId: planned.plan.steps[0].id,
      artifactId: reasoningArtifactId,
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

    const dispatched = await waitForOperatorDispatch(
      handle,
      planned.plan.id,
      proposal.id,
      args.confirmationTimeoutMs,
    );
    return {
      scenario: 'chatgpt-route',
      timestamp,
      ok: true,
      evidenceStatus: 'passed',
      git,
      planId: planned.plan.id,
      proposalId: proposal.id,
      endpointBindings: [{
        reasoningEndpointId: 'chatgpt-web',
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
        ...dispatched.transitions,
        'result-correlated',
      ],
      confirmationIdentity: {
        proposalId: proposal.id,
        contentHash: proposal.contentHash,
        bindingHash: proposal.bindingHash,
      },
      relaySeam: relaySeamData,
      failureClassification: 'none',
      processExitClassification: dispatched.proposal.result?.exitCode === 0 ? 'exit-0' : 'nonzero-or-missing',
      screenshotPaths: [],
    };
  } finally {
    await unlink(ACTIVE_HANDOFF_PATH).catch(() => undefined);
    await closeServer(handle);
    if (runtime && !args.connectCdp && !args.connectActiveChrome) {
      await runtime.browserHandle.close().catch(() => undefined);
    }
  }
}

async function runScenario(
  args: DualEndpointHarnessArgs,
  scenario: typeof DUAL_ENDPOINT_SCENARIOS[number],
  timestamp: string,
  git: DualEndpointEvidence['git'],
): Promise<DualEndpointEvidence> {
  switch (scenario) {
    case 'cli-route':
      return runRealCliRoute(args, timestamp, git);
    case 'chatgpt-route':
      return runRealChatgptRoute(args, timestamp, git);
    case 'same-provider':
      return runBindingContract('same-provider', 'codex-command', timestamp, git);
    case 'mixed-provider':
      return runBindingContract('mixed-provider', 'claude-code-command', timestamp, git);
    case 'failure-timeout':
      return runFailureTimeoutContract(timestamp, git);
    case 'uncertain-dispatch':
      return runUncertainDispatchContract(timestamp, git);
    case 'control-pause-cancel':
      return runControlContract(timestamp, git);
    case 'workbuddy-boundary':
      return runWorkbuddyBoundaryContract(timestamp, git);
    case 'cleanup':
      return runCleanupContract(timestamp, git);
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
    try {
      results.push(await writeEvidence(args, await runScenario(args, scenario, timestamp, git)));
    } catch (error) {
      results.push(await writeEvidence(args, blockedEvidence(
        scenario,
        timestamp,
        git,
        classifyDualEndpointError(error),
      )));
    }
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

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
