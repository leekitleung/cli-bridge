import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';

import { startLocalServer, type LocalServerHandle } from '../apps/local-server/src/server.ts';
import { PAIRING_TOKEN_HEADER } from '../packages/shared/src/constants.ts';

declare const chrome: any;

export type WebAutoScenario = 'stage-b-one-round' | 'stage-c-two-rounds' | 'all';

export type WebAutoFailureCode =
  | 'invalid-args'
  | 'build-failed'
  | 'playwright-unavailable'
  | 'chrome-unavailable'
  | 'chrome-launch-failed'
  | 'extension-missing'
  | 'extension-id-missing'
  | 'not-logged-in'
  | 'panel-unpaired'
  | 'chatgpt-timeout'
  | 'outbound-failed'
  | 'inbound-missing'
  | 'hard-stop-failed'
  | 'cleanup-failed'
  | 'unexpected-error';

export interface WebAutoHarnessArgs {
  scenario: WebAutoScenario;
  profileDir?: string;
  chromePath?: string;
  connectCdp?: string;
  connectActiveChrome?: boolean;
  activeChromeHelper?: string;
  remoteDebuggingPort?: number;
  basePort?: number;
  outputDir: string;
  keepBrowser: boolean;
  dryRun: boolean;
}

export interface ScenarioEvidence {
  scenario: Exclude<WebAutoScenario, 'all'>;
  timestamp: string;
  ok: boolean;
  git: {
    commit: string | null;
    dirty: boolean;
  };
  extensionId?: string;
  chromeVersion?: string;
  serverPort?: number;
  promptIds: string[];
  loopId?: string;
  outboundEvidence: {
    promptId: string;
    status: string | undefined;
    sequence: string[];
  }[];
  inboundMarkers: {
    marker: string;
    present: boolean;
    status?: string;
  }[];
  hardStop?: {
    status?: string;
    reason?: string;
    createdOutbound: boolean;
  };
  screenshotPath?: string;
  failure?: {
    code: WebAutoFailureCode;
    message: string;
  };
}

export interface RuntimeContext {
  handle: LocalServerHandle;
  page: any;
  context: any;
  browserHandle: BrowserHandle;
  extensionId: string;
  chromeVersion: string;
  outputDir: string;
  git: ScenarioEvidence['git'];
}

export interface BrowserHandle {
  context: any;
  close(): Promise<void>;
}

class ScenarioFailureError extends Error {
  readonly cause: unknown;

  constructor(error: unknown) {
    super(error instanceof Error ? error.message : String(error));
    this.name = 'ScenarioFailureError';
    this.cause = error;
  }
}

const DEFAULT_OUTPUT_DIR = 'output/playwright/web-auto-release';
const EXPECTED_SEQUENCE = [
  'queued',
  'claimed',
  'filled-and-acknowledged',
  'waiting-manual-send',
  'submitted',
  'responding',
  'response-ready',
  'returned',
];
const INBOUND_ENDPOINT_ID = 'mock-inbound-agent';

function usage(): string {
  return [
    'Usage:',
    '  node --experimental-strip-types scripts/web-auto-release-e2e.ts --scenario <stage-b-one-round|stage-c-two-rounds|all> --profile-dir <path>',
    '  node --experimental-strip-types scripts/web-auto-release-e2e.ts --scenario <stage-b-one-round|stage-c-two-rounds|all> --connect-cdp http://127.0.0.1:<port>',
    '  node --experimental-strip-types scripts/web-auto-release-e2e.ts --scenario <stage-b-one-round|stage-c-two-rounds|all> --connect-active-chrome',
    '',
    'Options:',
    '  --connect-cdp <url>',
    '  --connect-active-chrome',
    '  --active-chrome-helper <url>',
    '  --chrome-path <path>',
    '  --remote-debugging-port <port>',
    '  --base-port <port>',
    '  --output-dir <path>',
    '  --keep-browser',
    '  --dry-run',
  ].join('\n');
}

function parsePort(value: string | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  const port = Number(value);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`${name} must be an integer port`);
  }
  return port;
}

export function parseArgs(argv: string[]): WebAutoHarnessArgs {
  const raw: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      throw new Error(`Unexpected argument: ${token}`);
    }
    const key = token.slice(2);
    if (key === 'keep-browser' || key === 'dry-run' || key === 'connect-active-chrome') {
      raw[key] = true;
      continue;
    }
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      throw new Error(`Missing value for --${key}`);
    }
    raw[key] = next;
    i += 1;
  }

  const scenario = (raw.scenario ?? process.env.CLI_BRIDGE_WEB_AUTO_SCENARIO ?? 'all') as string;
  if (!['stage-b-one-round', 'stage-c-two-rounds', 'all'].includes(scenario)) {
    throw new Error('scenario must be stage-b-one-round, stage-c-two-rounds, or all');
  }
  const profileDir = (raw['profile-dir'] ?? process.env.CLI_BRIDGE_WEB_AUTO_PROFILE_DIR) as string | undefined;
  const connectCdp = (raw['connect-cdp'] ?? process.env.CLI_BRIDGE_WEB_AUTO_CONNECT_CDP) as string | undefined;
  const connectActiveChrome = raw['connect-active-chrome'] === true || process.env.CLI_BRIDGE_WEB_AUTO_CONNECT_ACTIVE_CHROME === '1';
  const activeChromeHelper = (raw['active-chrome-helper'] ?? process.env.CLI_BRIDGE_WEB_AUTO_ACTIVE_CHROME_HELPER) as string | undefined;
  const browserModes = [
    profileDir && profileDir.trim().length > 0 ? profileDir : undefined,
    connectCdp && connectCdp.trim().length > 0 ? connectCdp : undefined,
    connectActiveChrome ? 'active-chrome' : undefined,
  ].filter(Boolean);
  if (browserModes.length === 0) {
    throw new Error('profile-dir, connect-cdp, or connect-active-chrome is required');
  }
  if (browserModes.length > 1) {
    throw new Error('profile-dir, connect-cdp, and connect-active-chrome are mutually exclusive');
  }

  return {
    scenario: scenario as WebAutoScenario,
    profileDir,
    chromePath: (raw['chrome-path'] ?? process.env.CLI_BRIDGE_WEB_AUTO_CHROME_PATH) as string | undefined,
    connectCdp,
    connectActiveChrome,
    activeChromeHelper,
    remoteDebuggingPort: parsePort(
      (raw['remote-debugging-port'] ?? process.env.CLI_BRIDGE_WEB_AUTO_REMOTE_DEBUGGING_PORT) as string | undefined,
      'remote-debugging-port',
    ),
    basePort: parsePort((raw['base-port'] ?? process.env.CLI_BRIDGE_WEB_AUTO_BASE_PORT) as string | undefined, 'base-port'),
    outputDir: ((raw['output-dir'] ?? process.env.CLI_BRIDGE_WEB_AUTO_OUTPUT_DIR) as string | undefined)
      ?? DEFAULT_OUTPUT_DIR,
    keepBrowser: raw['keep-browser'] === true || process.env.CLI_BRIDGE_WEB_AUTO_KEEP_BROWSER === '1',
    dryRun: raw['dry-run'] === true || process.env.CLI_BRIDGE_WEB_AUTO_DRY_RUN === '1',
  };
}

export function sanitizeEvidence(value: unknown, secretValues: string[] = []): unknown {
  const secrets = secretValues.filter((secret) => secret.length > 0);
  const redact = (text: string): string => {
    let next = text;
    for (const secret of secrets) {
      next = next.split(secret).join('[REDACTED_SECRET]');
    }
    next = next.replace(/cliBridgePairingToken["']?\s*[:=]\s*["'][^"']+["']/g, 'cliBridgePairingToken:"[REDACTED_SECRET]"');
    next = next.replace(/(cookie|set-cookie)["']?\s*[:=]\s*["'][^"']+["']/gi, '$1:"[REDACTED_COOKIE]"');
    return next;
  };
  if (typeof value === 'string') return redact(value);
  if (Array.isArray(value)) return value.map((item) => sanitizeEvidence(item, secrets));
  if (value && typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      if (/cookie|pairingToken/i.test(key)) {
        output[key] = '[REDACTED]';
      } else {
        output[key] = sanitizeEvidence(nested, secrets);
      }
    }
    return output;
  }
  return value;
}

export function classifyError(error: unknown): { code: WebAutoFailureCode; message: string } {
  const message = error instanceof Error ? error.message : String(error);
  if (/build/i.test(message)) return { code: 'build-failed', message };
  if (/playwright/i.test(message)) return { code: 'playwright-unavailable', message };
  if (/chrome.*path|chrome.*missing|not executable/i.test(message)) return { code: 'chrome-unavailable', message };
  if (/launch/i.test(message)) return { code: 'chrome-launch-failed', message };
  if (/extension.*dist/i.test(message)) return { code: 'extension-missing', message };
  if (/extension id/i.test(message)) return { code: 'extension-id-missing', message };
  if (/logged in|login|sign up|sign-up/i.test(message)) return { code: 'not-logged-in', message };
  if (/panel|已连接|pair/i.test(message)) return { code: 'panel-unpaired', message };
  if (/timeout|timed out|composer did not become ready/i.test(message)) return { code: 'chatgpt-timeout', message };
  if (/outbound.*failed|prompt failed/i.test(message)) return { code: 'outbound-failed', message };
  if (/inbound/i.test(message)) return { code: 'inbound-missing', message };
  if (/hard stop|max-rounds|third/i.test(message)) return { code: 'hard-stop-failed', message };
  if (/cleanup|close/i.test(message)) return { code: 'cleanup-failed', message };
  return { code: 'unexpected-error', message };
}

export async function findAvailablePort(preferred?: number): Promise<number> {
  if (preferred) {
    await assertPortAvailable(preferred);
    return preferred;
  }
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('failed to allocate port')));
        return;
      }
      const port = address.port;
      server.close(() => resolvePort(port));
    });
  });
}

async function assertPortAvailable(port: number): Promise<void> {
  return new Promise((resolveAvailable, reject) => {
    const server = createServer();
    server.once('error', () => reject(new Error(`port ${port} is already in use`)));
    server.listen(port, '127.0.0.1', () => {
      server.close(() => resolveAvailable());
    });
  });
}

async function runProcess(command: string, args: string[]): Promise<string> {
  return new Promise((resolveProcess, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    });
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      output += chunk.toString();
    });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) {
        resolveProcess(output);
      } else {
        reject(new Error(`${command} ${args.join(' ')} failed: ${output.slice(0, 2000)}`));
      }
    });
  });
}

export async function buildExtension(): Promise<void> {
  await runProcess(process.execPath, ['scripts/build-extension.mjs']);
}

async function collectGit(): Promise<ScenarioEvidence['git']> {
  try {
    const commit = (await runProcess('git', ['rev-parse', '--short', 'HEAD'])).trim() || null;
    const status = await runProcess('git', ['status', '--short']);
    return { commit, dirty: status.trim().length > 0 };
  } catch {
    return { commit: null, dirty: true };
  }
}

async function loadPlaywright(): Promise<any> {
  try {
    const dynamicImport = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<any>;
    return await dynamicImport('playwright');
  } catch {
    const npxRoot = resolve(process.env.HOME ?? '', '.npm/_npx');
    let candidates: string[] = [];
    try {
      const dirs = await readdir(npxRoot);
      candidates = dirs.map((dir) => resolve(npxRoot, dir, 'node_modules/playwright/package.json'));
    } catch {
      candidates = [];
    }
    const found = candidates.find((candidate) => existsSync(candidate));
    if (!found) {
      throw new Error('playwright package unavailable; run npx playwright or install playwright');
    }
    return createRequire(found)('playwright');
  }
}

async function discoverChromePath(input?: string): Promise<string> {
  if (input) {
    if (!existsSync(input)) {
      throw new Error(`Chrome path missing or not executable: ${input}`);
    }
    return input;
  }
  const playwright = await loadPlaywright();
  const executablePath = playwright.chromium.executablePath();
  if (!executablePath || !existsSync(executablePath)) {
    throw new Error(
      'Chrome path not provided (--chrome-path) and Playwright could not resolve a Chromium executable; pass --chrome-path or run playwright install',
    );
  }
  return executablePath;
}

export async function disconnectConnectedBrowser(browser: any): Promise<void> {
  if (typeof browser.disconnect === 'function') {
    await browser.disconnect();
    return;
  }
  await browser.close();
}

export async function launchBrowser(args: WebAutoHarnessArgs, extensionDist: string): Promise<BrowserHandle> {
  const playwright = await loadPlaywright();
  if (args.connectCdp) {
    const browser = await playwright.chromium.connectOverCDP(args.connectCdp);
    const context = browser.contexts()[0];
    if (!context) {
      throw new Error('connected CDP browser has no context');
    }
    return {
      context,
      async close() {
        await disconnectConnectedBrowser(browser);
      },
    };
  }
  if (args.connectActiveChrome) {
    if (!args.activeChromeHelper) {
      throw new Error('active Chrome helper URL is required for connect-active-chrome');
    }
    new URL(args.activeChromeHelper);
    throw new Error('active Chrome helper mode is implemented by dual-endpoint-release-e2e; web-auto standalone still requires profile-dir or connect-cdp');
  }
  if (!args.profileDir) {
    throw new Error('profile-dir is required when not using connect-cdp or connect-active-chrome');
  }
  const remotePort = await findAvailablePort(args.remoteDebuggingPort);
  const chromePath = await discoverChromePath(args.chromePath);
  const context = await playwright.chromium.launchPersistentContext(args.profileDir, {
    headless: false,
    executablePath: chromePath,
    args: [
      `--remote-debugging-port=${remotePort}`,
      '--no-first-run',
      `--disable-extensions-except=${extensionDist}`,
      `--load-extension=${extensionDist}`,
    ],
  });
  return {
    context,
    async close() {
      await context.close();
    },
  };
}

async function closeServer(handle: LocalServerHandle | undefined): Promise<void> {
  if (!handle) return;
  await new Promise<void>((resolveClose, reject) => {
    handle.server.close((error) => {
      if (error) reject(error);
      else resolveClose();
    });
  });
}

export async function selectCliBridgeExtensionId(workers: any[]): Promise<string | undefined> {
  for (const worker of workers) {
    const workerUrl = String(worker.url());
    if (!workerUrl.startsWith('chrome-extension://')) continue;
    try {
      const manifest = await worker.evaluate(() => chrome.runtime.getManifest());
      if (manifest?.name === 'CLI Bridge') return new URL(workerUrl).host;
    } catch {
      // Ignore unrelated or unavailable extension workers.
    }
  }
  return undefined;
}

export async function discoverExtensionId(context: any): Promise<string> {
  let workers = context.serviceWorkers();
  if (workers.length === 0) {
    try {
      const worker = await context.waitForEvent('serviceworker', { timeout: 10_000 });
      workers = [worker];
    } catch {
      workers = context.serviceWorkers();
    }
  }
  const extensionId = await selectCliBridgeExtensionId(workers);
  if (extensionId) {
    return extensionId;
  }

  // CDP Target.getTargets fallback (read-only): enumerate browser targets to
  // discover the extension id when serviceWorkers() is unreliable in
  // connectOverCDP mode. No injection — only target enumeration.
  const browser = context.browser?.();
  if (browser && typeof browser.newBrowserCDPSession === 'function') {
    try {
      const cdpSession = await browser.newBrowserCDPSession();
      try {
        const { targetInfos } = await cdpSession.send('Target.getTargets');
        for (const target of targetInfos ?? []) {
          if (target.type !== 'service_worker') continue;
          if (!String(target.url).startsWith('chrome-extension://')) continue;
          // The service worker target title reflects the extension name.
          if (target.title !== 'CLI Bridge') continue;
          try {
            return new URL(target.url).host;
          } catch {
            continue;
          }
        }
      } finally {
        await cdpSession.detach();
      }
    } catch {
      // CDP enumeration unavailable; fall through to error.
    }
  }

  throw new Error('extension id could not be discovered');
}

export async function ensureChatGptPage(ctx: RuntimeContext): Promise<void> {
  let page = ctx.context.pages().find((candidate: any) => String(candidate.url()).includes('chatgpt.com'));
  if (!page) page = await ctx.context.newPage();
  ctx.page = page;
  await page.goto('https://chatgpt.com/?temporary-chat=true', { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.locator('body').waitFor({ timeout: 10_000 });
  try {
    await page.waitForFunction(() => document.body.innerText.includes('CLI BRIDGE'), null, { timeout: 15_000 });
  } catch {
    // Fall through to the explicit body-text checks below so the failure is
    // classified with the current page state.
  }
  const text = await page.locator('body').innerText({ timeout: 10_000 });
  if (/log in|sign up|登录|注册/i.test(text) && !text.includes('CLI BRIDGE')) {
    throw new Error('ChatGPT profile is not logged in');
  }
  if (!text.includes('CLI BRIDGE')) {
    throw new Error('CLI Bridge extension panel did not load');
  }
  if (text.includes('正在回答') || text.includes('Stop generating')) {
    throw new Error('ChatGPT page is streaming and not stable');
  }
}

async function waitForChatGptComposer(ctx: RuntimeContext): Promise<void> {
  const waitOnce = async (): Promise<boolean> => {
    try {
      await ctx.page.waitForFunction(() => {
        const selectors = [
          'textarea[data-testid="prompt-textarea"]',
          '[contenteditable="true"][data-testid="prompt-textarea"]',
          '#prompt-textarea[contenteditable="true"]',
          '.ProseMirror[contenteditable="true"]',
          '[role="textbox"][contenteditable="true"]',
        ];
        const composer = selectors
          .map((selector) => document.querySelector(selector))
          .find((candidate) => candidate instanceof HTMLElement);
        const bodyText = document.body.innerText;
        return Boolean(composer) &&
          !bodyText.includes('正在回答') &&
          !bodyText.includes('Stop generating') &&
          !bodyText.includes('Something went wrong');
      }, null, { timeout: 20_000 });
      return true;
    } catch {
      return false;
    }
  };

  if (await waitOnce()) return;

  await ctx.page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded', timeout: 30_000 });
  if (await waitOnce()) return;

  await ctx.page.goto('https://chatgpt.com/?temporary-chat=true', { waitUntil: 'domcontentloaded', timeout: 30_000 });
  const ready = await waitOnce();
  if (!ready) {
    throw new Error('ChatGPT composer did not become ready');
  }
}

export function hasChatGptComposerForHarness(document: Document): boolean {
  try {
    const view = document.defaultView;
    if (!view) return false;
    const selectors = [
      'textarea[data-testid="prompt-textarea"]',
      '[contenteditable="true"][data-testid="prompt-textarea"]',
      '#prompt-textarea[contenteditable="true"]',
      '.ProseMirror[contenteditable="true"]',
      '[role="textbox"][contenteditable="true"]',
    ];
    const composer = selectors
      .map((selector) => document.querySelector(selector))
      .find((candidate) => candidate instanceof view.HTMLElement);
    const bodyText = document.body.innerText ?? document.body.textContent ?? '';
    return Boolean(composer) &&
      !bodyText.includes('正在回答') &&
      !bodyText.includes('Stop generating') &&
      !bodyText.includes('Something went wrong');
  } catch {
    return false;
  }
}

export async function injectPairingToken(ctx: RuntimeContext): Promise<void> {
  const popup = await ctx.context.newPage();
  try {
    await popup.goto(`chrome-extension://${ctx.extensionId}/popup/index.html`, { timeout: 10_000 });
    await popup.evaluate(async (token: string) => {
      await chrome.storage.session.set({ cliBridgePairingToken: token });
    }, ctx.handle.pairingToken);
  } finally {
    await popup.close();
  }
  await ctx.page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 });
  await ctx.page.waitForFunction(() => document.body.innerText.includes('已连接'), null, { timeout: 20_000 });
  await waitForChatGptComposer(ctx);
}

async function getReports(ctx: RuntimeContext): Promise<{ prompts: any[]; messages: any[] }> {
  const headers = { [PAIRING_TOKEN_HEADER]: ctx.handle.pairingToken };
  const outbound = await fetch(`${ctx.handle.url}/bridge/outbound/report`, { headers }).then((response) => response.json());
  const inbound = await fetch(`${ctx.handle.url}/bridge/inbound?endpointId=${INBOUND_ENDPOINT_ID}`, { headers })
    .then((response) => response.json());
  return {
    prompts: outbound.outboundReport?.prompts ?? [],
    messages: inbound.inboundMessages ?? [],
  };
}

export async function waitPromptReturned(
  ctx: RuntimeContext,
  promptId: string,
  marker: string,
): Promise<{ prompt: any; inbound: any }> {
  const deadline = Date.now() + 150_000;
  let lastStatus = 'missing';
  while (Date.now() < deadline) {
    const { prompts, messages } = await getReports(ctx);
    const prompt = prompts.find((candidate) => candidate.id === promptId);
    const inbound = messages.find((candidate) => String(candidate.content ?? '').includes(marker));
    lastStatus = prompt?.status ?? 'missing';
    if (prompt?.status === 'returned' && inbound) return { prompt, inbound };
    if (prompt?.status === 'failed') {
      throw new Error(`outbound prompt failed: ${prompt.failureReason ?? 'unknown'}`);
    }
    await new Promise((resolveSleep) => setTimeout(resolveSleep, 2000));
  }
  throw new Error(`timeout waiting for returned outbound ${promptId}; last status ${lastStatus}`);
}

function markerFor(scenario: string, suffix: string): string {
  return `CLI_BRIDGE_${scenario.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_${suffix}_${randomUUID().slice(0, 8)}`;
}

function evidenceSequence(prompt: any): string[] {
  return (prompt?.evidence ?? []).map((event: { type?: string }) => String(event.type ?? 'unknown'));
}

function assertSequence(sequence: string[]): void {
  if (EXPECTED_SEQUENCE.join('|') !== sequence.join('|')) {
    throw new Error(`unexpected outbound evidence sequence: ${sequence.join(' -> ')}`);
  }
}

async function writeScenarioEvidence(
  ctx: RuntimeContext,
  evidence: ScenarioEvidence,
  timestamp: string,
): Promise<ScenarioEvidence> {
  await mkdir(ctx.outputDir, { recursive: true });
  const jsonPath = resolve(ctx.outputDir, `${timestamp}-${evidence.scenario}.json`);
  const sanitized = sanitizeEvidence(evidence, [ctx.handle.pairingToken]) as ScenarioEvidence;
  await writeFile(jsonPath, `${JSON.stringify(sanitized, null, 2)}\n`, 'utf8');
  return sanitized;
}

async function writeScenarioFailureEvidence(
  ctx: RuntimeContext,
  scenario: Exclude<WebAutoScenario, 'all'>,
  timestamp: string,
  failure: { code: WebAutoFailureCode; message: string },
): Promise<ScenarioEvidence> {
  const screenshotPath = ctx.page ? await screenshot(ctx, timestamp, `${scenario}-failure`) : undefined;
  return writeScenarioEvidence(ctx, {
    scenario,
    timestamp,
    ok: false,
    git: ctx.git,
    extensionId: ctx.extensionId,
    chromeVersion: ctx.chromeVersion,
    serverPort: ctx.handle.port,
    promptIds: [],
    outboundEvidence: [],
    inboundMarkers: [],
    screenshotPath,
    failure,
  }, timestamp);
}

async function screenshot(ctx: RuntimeContext, timestamp: string, scenario: string): Promise<string> {
  await mkdir(ctx.outputDir, { recursive: true });
  const path = resolve(ctx.outputDir, `${timestamp}-${scenario}.png`);
  await ctx.page.screenshot({ path, fullPage: true });
  return path;
}

async function runStageB(ctx: RuntimeContext, timestamp: string): Promise<ScenarioEvidence> {
  const marker = markerFor('stage-b-one-round', 'RETURN');
  const prompt = `CLI Bridge release E2E Stage B. Reply exactly: ${marker}`;
  const response = await fetch(`${ctx.handle.url}/bridge/outbound`, {
    method: 'POST',
    headers: {
      [PAIRING_TOKEN_HEADER]: ctx.handle.pairingToken,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ sessionId: `web-auto-stage-b-${Date.now()}`, prompt }),
  });
  const body = await response.json();
  if (response.status !== 201) {
    throw new Error(`Stage B outbound create failed: ${JSON.stringify(body)}`);
  }
  const promptId = body.outboundPrompt.id;
  const returned = await waitPromptReturned(ctx, promptId, marker);
  const sequence = evidenceSequence(returned.prompt);
  assertSequence(sequence);
  const screenshotPath = await screenshot(ctx, timestamp, 'stage-b-one-round');
  return writeScenarioEvidence(ctx, {
    scenario: 'stage-b-one-round',
    timestamp,
    ok: true,
    git: ctx.git,
    extensionId: ctx.extensionId,
    chromeVersion: ctx.chromeVersion,
    serverPort: ctx.handle.port,
    promptIds: [promptId],
    outboundEvidence: [{ promptId, status: returned.prompt.status, sequence }],
    inboundMarkers: [{ marker, present: true, status: returned.inbound.status }],
    screenshotPath,
  }, timestamp);
}

async function runStageC(ctx: RuntimeContext, timestamp: string): Promise<ScenarioEvidence> {
  const round1Marker = markerFor('stage-c-two-rounds', 'ROUND_1');
  const round2Marker = markerFor('stage-c-two-rounds', 'ROUND_2');
  const blockedMarker = markerFor('stage-c-two-rounds', 'SHOULD_NOT_RUN');
  const createResponse = await fetch(`${ctx.handle.url}/bridge/loops`, {
    method: 'POST',
    headers: {
      [PAIRING_TOKEN_HEADER]: ctx.handle.pairingToken,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      sessionId: `web-auto-stage-c-${Date.now()}`,
      projectId: 'cli-bridge',
      goalId: 'web-auto-release-e2e',
      initialPrompt: `CLI Bridge release E2E Stage C round 1. Reply exactly: ${round1Marker}`,
      maxRounds: 2,
      perRoundTimeoutMs: 120_000,
      totalDeadlineMs: 600_000,
    }),
  });
  const created = await createResponse.json();
  if (createResponse.status !== 201) {
    throw new Error(`Stage C loop create failed: ${JSON.stringify(created)}`);
  }
  const loopId = created.loop.id;
  const promptIds = [created.outboundPrompt.id];
  const round1 = await waitPromptReturned(ctx, promptIds[0], round1Marker);
  const round1Sequence = evidenceSequence(round1.prompt);
  assertSequence(round1Sequence);

  const advanceResponse = await fetch(`${ctx.handle.url}/bridge/loops/advance`, {
    method: 'POST',
    headers: {
      [PAIRING_TOKEN_HEADER]: ctx.handle.pairingToken,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      loopId,
      inboundContent: round1.inbound.content,
      nextPrompt: `CLI Bridge release E2E Stage C round 2. Reply exactly: ${round2Marker}`,
    }),
  });
  const advanced = await advanceResponse.json();
  if (advanceResponse.status !== 200 || !advanced.outboundPrompt) {
    throw new Error(`Stage C advance did not create round 2: ${JSON.stringify(advanced)}`);
  }
  promptIds.push(advanced.outboundPrompt.id);
  const round2 = await waitPromptReturned(ctx, promptIds[1], round2Marker);
  const round2Sequence = evidenceSequence(round2.prompt);
  assertSequence(round2Sequence);

  const stopResponse = await fetch(`${ctx.handle.url}/bridge/loops/advance`, {
    method: 'POST',
    headers: {
      [PAIRING_TOKEN_HEADER]: ctx.handle.pairingToken,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      loopId,
      inboundContent: round2.inbound.content,
      nextPrompt: `CLI Bridge release E2E Stage C should not run. Marker: ${blockedMarker}`,
    }),
  });
  const stopped = await stopResponse.json();
  const hardStop = {
    status: stopped.loop?.status,
    reason: stopped.loop?.evidence?.at?.(-1)?.reason,
    createdOutbound: Boolean(stopped.outboundPrompt),
  };
  if (hardStop.status !== 'done' || hardStop.reason !== 'max-rounds-reached' || hardStop.createdOutbound) {
    throw new Error(`Stage C hard stop failed: ${JSON.stringify(hardStop)}`);
  }
  const bodyText = await ctx.page.locator('body').innerText({ timeout: 10_000 });
  if (bodyText.includes(blockedMarker)) {
    throw new Error('third-round marker appeared on ChatGPT page');
  }
  const screenshotPath = await screenshot(ctx, timestamp, 'stage-c-two-rounds');
  return writeScenarioEvidence(ctx, {
    scenario: 'stage-c-two-rounds',
    timestamp,
    ok: true,
    git: ctx.git,
    extensionId: ctx.extensionId,
    chromeVersion: ctx.chromeVersion,
    serverPort: ctx.handle.port,
    promptIds,
    loopId,
    outboundEvidence: [
      { promptId: promptIds[0], status: round1.prompt.status, sequence: round1Sequence },
      { promptId: promptIds[1], status: round2.prompt.status, sequence: round2Sequence },
    ],
    inboundMarkers: [
      { marker: round1Marker, present: true, status: round1.inbound.status },
      { marker: round2Marker, present: true, status: round2.inbound.status },
    ],
    hardStop,
    screenshotPath,
  }, timestamp);
}

async function writeFailureEvidence(
  args: WebAutoHarnessArgs,
  scenario: Exclude<WebAutoScenario, 'all'>,
  git: ScenarioEvidence['git'],
  failure: { code: WebAutoFailureCode; message: string },
): Promise<void> {
  await mkdir(args.outputDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const evidence: ScenarioEvidence = {
    scenario,
    timestamp,
    ok: false,
    git,
    promptIds: [],
    outboundEvidence: [],
    inboundMarkers: [],
    failure,
  };
  await writeFile(
    resolve(args.outputDir, `${timestamp}-${scenario}.json`),
    `${JSON.stringify(sanitizeEvidence(evidence), null, 2)}\n`,
    'utf8',
  );
}

async function createRuntimeContext(
  args: WebAutoHarnessArgs,
  failureScenario: Exclude<WebAutoScenario, 'all'>,
  timestamp: string,
  git: ScenarioEvidence['git'],
): Promise<RuntimeContext> {
  const extensionDist = resolve(process.cwd(), 'apps/extension/dist');
  if (!existsSync(extensionDist)) {
    throw new Error('extension dist missing; run npm run build-extension');
  }
  const browserHandle = await launchBrowser(args, extensionDist);
  let handle: LocalServerHandle | undefined;
  let ctx: RuntimeContext | undefined;
  try {
    const extensionId = await discoverExtensionId(browserHandle.context);
    const serverPort = await findAvailablePort(args.basePort);
    handle = await startLocalServer(serverPort, { inboundRelayEndpointId: INBOUND_ENDPOINT_ID });
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
    await ensureChatGptPage(ctx);
    await injectPairingToken(ctx);
    return ctx;
  } catch (error) {
    if (ctx) {
      const failure = classifyError(error);
      await writeScenarioFailureEvidence(ctx, failureScenario, timestamp, failure);
    }
    await closeServer(handle);
    if (!args.keepBrowser) await browserHandle.close();
    throw ctx ? new ScenarioFailureError(error) : error;
  }
}

export async function runHarness(args: WebAutoHarnessArgs): Promise<ScenarioEvidence[]> {
  if (args.dryRun) {
    if (args.profileDir && !existsSync(args.profileDir)) throw new Error(`profile-dir does not exist: ${args.profileDir}`);
    if (args.connectCdp) new URL(args.connectCdp);
    if (args.connectActiveChrome) {
      if (!args.activeChromeHelper) throw new Error('active Chrome helper URL is required for connect-active-chrome');
      new URL(args.activeChromeHelper);
    }
    if (args.chromePath) await discoverChromePath(args.chromePath);
    return [];
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const scenarios: Exclude<WebAutoScenario, 'all'>[] = args.scenario === 'all'
    ? ['stage-b-one-round', 'stage-c-two-rounds']
    : [args.scenario];
  await buildExtension();
  const git = await collectGit();
  const ctx = await createRuntimeContext(args, scenarios[0], timestamp, git);
  const results: ScenarioEvidence[] = [];
  try {
    for (const scenario of scenarios) {
      try {
        if (scenario === 'stage-b-one-round') {
          results.push(await runStageB(ctx, timestamp));
        } else {
          results.push(await runStageC(ctx, timestamp));
        }
      } catch (error) {
        const failure = classifyError(error);
        results.push(await writeScenarioFailureEvidence(ctx, scenario, timestamp, failure));
        throw new ScenarioFailureError(error);
      }
    }
    return results;
  } finally {
    let cleanupError: Error | undefined;
    try {
      await closeServer(ctx.handle);
    } catch (error) {
      cleanupError = error instanceof Error ? error : new Error(String(error));
    }
    if (!args.keepBrowser) {
      try {
        await ctx.browserHandle.close();
      } catch (error) {
        cleanupError = error instanceof Error ? error : new Error(String(error));
      }
    }
    if (cleanupError) {
      throw cleanupError;
    }
  }
}

async function main(): Promise<void> {
  let args: WebAutoHarnessArgs;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(usage());
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
    return;
  }

  const git = await collectGit();
  try {
    const results = await runHarness(args);
    if (args.dryRun) {
      console.log(JSON.stringify({ ok: true, dryRun: true }, null, 2));
      return;
    }
    console.log(JSON.stringify({
      ok: true,
      evidence: results.map((result) => ({
        scenario: result.scenario,
        screenshotPath: result.screenshotPath,
        promptIdsHash: createHash('sha256').update(result.promptIds.join('|')).digest('hex').slice(0, 12),
      })),
    }, null, 2));
  } catch (error) {
    const failure = classifyError(error);
    if (!(error instanceof ScenarioFailureError)) {
      const scenario = args.scenario === 'stage-c-two-rounds' ? 'stage-c-two-rounds' : 'stage-b-one-round';
      await writeFailureEvidence(args, scenario, git, failure);
    }
    console.error(JSON.stringify({ ok: false, failure }, null, 2));
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
