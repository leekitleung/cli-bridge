// Local operator launcher for hands-on (实操) verification testing.
//
// This script is OPERATOR-ONLY tooling. It does NOT change the default
// `npm run start:local-server` behavior. It boots the same local server with
// an injected operator config so a human can actually exercise the live
// verification surfaces that otherwise fail-closed (HTTP 409):
//   - ADR-0018 verification profile runs (spawns real local commands)
//   - ADR-0019-a read-only local git status
//   - ADR-0019-b / ADR-0022 GitHub combined checks (real outbound HTTPS)
//
// SAFETY NOTES (read before running):
//   * Verification profiles spawn REAL local processes inside the configured
//     trusted workspace root. Only point profiles at commands you trust.
//   * GitHub checks make a REAL outbound HTTPS call to the configured apiBaseUrl
//     using a stored operator token. The minimal fine-grained token scope is
//     read-only "Checks: read" + "Commit statuses: read".
//   * Tokens are taken from env ONLY and held in a memory-only store. Never put
//     a token in the JSON config file or commit it.
//   * WINDOWS: the profile runner spawns with shell:false (ADR-0018 boundary).
//     Node refuses to spawn .cmd/.bat batch wrappers (e.g. `npm` / `npm.cmd`)
//     without a shell, so verification profiles on Windows must point argv[0]
//     at a real executable (e.g. `node`, or an absolute path to a tool .exe).
//     On macOS/Linux `npm run <script>` works directly.
//
// Config source: env CLI_BRIDGE_LOCAL_CONFIG = path to a JSON file; when unset it
// defaults to scripts/local-config.json (see scripts/local-config.example.json).
// Token source: env
//   CLI_BRIDGE_GH_TOKEN                 (global default for all projects)
//   CLI_BRIDGE_GH_TOKEN__<projectKey>   (per-project override; '-' → '_')

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  DEFAULT_LOCAL_SERVER_PORT,
  PAIRING_TOKEN_HEADER,
} from '../packages/shared/src/constants.ts';
import type {
  GithubChecksProviderConfig,
  VerifyProfile,
} from '../packages/shared/src/types.ts';
import {
  startLocalServer,
  type LocalServerHandle,
} from '../apps/local-server/src/server.ts';
import { GithubTokenStore } from '../apps/local-server/src/verification/github-token-store.ts';
import { redactSensitiveContent } from '../apps/local-server/src/security/redaction.ts';
import type { BridgeRuntimeOptions } from '../apps/local-server/src/routes/bridge-api.ts';

export interface LocalProjectConfig {
  key: string;
  label?: string;
  description?: string;
  gitStatusEnabled?: boolean;
  verifyProfileId?: string | null;
  githubChecksEnabled?: boolean;
}

export interface LocalConfig {
  port?: number;
  baselineRoot?: string;
  projectWorkspaceRoots?: Record<string, string>;
  verifyProfiles?: VerifyProfile[];
  githubChecksConfig?: Record<string, GithubChecksProviderConfig>;
  projects?: LocalProjectConfig[];
}

const CREATE_PROJECT_PATH = '/bridge/projects';

/** Default config file used when CLI_BRIDGE_LOCAL_CONFIG is unset/empty. */
const DEFAULT_CONFIG_FILENAME = 'local-config.json';

function scriptsDir(): string {
  return dirname(fileURLToPath(import.meta.url));
}

/**
 * Resolve which config file to load (RP-2.19). The env var still takes
 * precedence; when unset/empty, default to scripts/local-config.json.
 */
export function resolveConfigPath(
  env: NodeJS.ProcessEnv = process.env,
  defaultDir: string = scriptsDir(),
): { path: string; fromEnv: boolean } {
  const fromEnvValue = env.CLI_BRIDGE_LOCAL_CONFIG;
  if (typeof fromEnvValue === 'string' && fromEnvValue.trim().length > 0) {
    return { path: resolve(fromEnvValue.trim()), fromEnv: true };
  }
  return { path: resolve(defaultDir, DEFAULT_CONFIG_FILENAME), fromEnv: false };
}

/** Whether the launcher should best-effort open the console in a browser. */
export function shouldAutoOpen(env: NodeJS.ProcessEnv = process.env): boolean {
  const flag = env.CLI_BRIDGE_NO_OPEN;
  return !(typeof flag === 'string' && flag.trim().length > 0);
}

/** The console URL to open. Never carries the pairing token (no query/fragment). */
export function buildConsoleOpenTarget(
  handle: Pick<LocalServerHandle, 'url'>,
): string {
  return `${handle.url}/console/project`;
}

/** Minimal fetch-like signature so tests can inject a fake. */
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

/** Parse + shallow-validate a JSON config string. Throws on invalid input. */
export function parseConfig(raw: string): LocalConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Config is not valid JSON.');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Config must be a JSON object.');
  }
  const config = parsed as LocalConfig;
  if (config.projects !== undefined && !Array.isArray(config.projects)) {
    throw new Error('config.projects must be an array when present.');
  }
  for (const project of config.projects ?? []) {
    if (!project || typeof project.key !== 'string' || project.key.trim().length === 0) {
      throw new Error('Each config.projects[] entry must have a non-empty string key.');
    }
  }
  return config;
}

/** Read + parse the config file (env path, else the default scripts path). */
export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  defaultDir: string = scriptsDir(),
): LocalConfig {
  const { path: abs, fromEnv } = resolveConfigPath(env, defaultDir);
  let raw: string;
  try {
    raw = readFileSync(abs, 'utf8');
  } catch {
    if (fromEnv) {
      throw new Error(`Cannot read config file: ${abs}`);
    }
    throw new Error(
      `No launcher config found at ${abs}. Set CLI_BRIDGE_LOCAL_CONFIG or create ` +
        'scripts/local-config.json (copy scripts/local-config.example.json).',
    );
  }
  return parseConfig(raw);
}

/** Resolve a per-project token from env: per-project override first, then global. */
export function resolveTokenForProject(
  projectKey: string,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const envKey = `CLI_BRIDGE_GH_TOKEN__${projectKey.replace(/-/g, '_')}`;
  const perProject = env[envKey];
  if (typeof perProject === 'string' && perProject.length > 0) return perProject;
  const global = env.CLI_BRIDGE_GH_TOKEN;
  if (typeof global === 'string' && global.length > 0) return global;
  return undefined;
}

/**
 * 409 acceptance policy (F2). A duplicate `409` is only an idempotent success
 * for the create-project POST. Every other request (PATCH config, etc.) must
 * fail closed so a misconfiguration is loud, not silent.
 */
export function shouldAccept409(method: string, path: string): boolean {
  return method.toUpperCase() === 'POST' && path === CREATE_PROJECT_PATH;
}

/** Build a memory-only GithubTokenStore from env for github-checks projects. */
export function buildTokenStore(
  config: LocalConfig,
  env: NodeJS.ProcessEnv = process.env,
): { store: GithubTokenStore; tokenProjects: string[] } {
  const store = new GithubTokenStore();
  const tokenProjects: string[] = [];
  for (const project of config.projects ?? []) {
    if (!project.githubChecksEnabled) continue;
    const token = resolveTokenForProject(project.key, env);
    if (token) {
      store.setToken(project.key, token);
      tokenProjects.push(project.key);
    }
  }
  return { store, tokenProjects };
}

/** Map a parsed config to backward-compatible startLocalServer runtime options. */
export function buildRuntimeOptions(
  config: LocalConfig,
  githubTokenStore: GithubTokenStore,
): BridgeRuntimeOptions {
  return {
    baselineRoot: config.baselineRoot,
    projectWorkspaceRoots: config.projectWorkspaceRoots,
    verifyProfiles: config.verifyProfiles,
    githubChecksConfig: config.githubChecksConfig,
    githubTokenStore,
  };
}

/**
 * Create + configure each project over loopback with the pairing token.
 * Uses an injected fetch-like fn for testability. Fails closed on any non-2xx
 * except the idempotent create-project 409 (shouldAccept409). Error messages
 * never include the token.
 */
export async function bootstrapProjects(opts: {
  baseUrl: string;
  pairingToken: string;
  projects: LocalProjectConfig[];
  fetchFn: FetchLike;
}): Promise<void> {
  const { baseUrl, pairingToken, projects, fetchFn } = opts;

  async function request(method: string, path: string, body: unknown): Promise<void> {
    const response = await fetchFn(`${baseUrl}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        [PAIRING_TOKEN_HEADER]: pairingToken,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (response.ok) return;
    if (response.status === 409 && shouldAccept409(method, path)) return;
    // Fail closed. The response body comes from an injected/remote boundary, so
    // it is treated as untrusted: run it through the shared redaction utility
    // before it can reach console/error output. Never include the token.
    const rawDetail = await response.text().catch(() => '');
    const detail = rawDetail ? redactSensitiveContent(rawDetail).processedContent : '';
    throw new Error(
      `Launcher bootstrap failed: ${method} ${path} → ${response.status}` +
        (detail ? ` ${detail}` : ''),
    );
  }

  for (const project of projects) {
    await request('POST', CREATE_PROJECT_PATH, {
      key: project.key,
      label: project.label ?? project.key,
      description: project.description,
    });
    await request('PATCH', `${CREATE_PROJECT_PATH}/${encodeURIComponent(project.key)}`, {
      gitStatusEnabled: project.gitStatusEnabled ?? false,
      githubChecksEnabled: project.githubChecksEnabled ?? false,
      verifyProfileId: project.verifyProfileId ?? undefined,
    });
  }
}

async function closeLocalServer(handle: LocalServerHandle, timeoutMs: number): Promise<void> {
  if (!handle.server.listening) return;
  await new Promise<void>((resolveClose) => {
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveClose();
    };
    const timer = setTimeout(() => {
      handle.server.closeAllConnections?.();
      finish();
    }, timeoutMs);
    handle.server.close(() => finish());
  });
}

export async function bootstrapStartedServer(
  handle: LocalServerHandle,
  projects: LocalProjectConfig[],
  fetchFn: FetchLike,
  shutdownTimeoutMs = 2_000,
): Promise<void> {
  try {
    await bootstrapProjects({
      baseUrl: handle.url,
      pairingToken: handle.pairingToken,
      projects,
      fetchFn,
    });
  } catch (error) {
    await closeLocalServer(handle, shutdownTimeoutMs);
    throw error;
  }
}

interface ShutdownProcess {
  exitCode?: number;
  once(event: NodeJS.Signals, listener: () => void | Promise<void>): unknown;
  removeListener(event: NodeJS.Signals, listener: () => void | Promise<void>): unknown;
}

export function installShutdownHandlers(
  handle: LocalServerHandle,
  processLike: ShutdownProcess = process,
  timeoutMs = 2_000,
): () => void {
  let closing = false;
  const shutdown = async (): Promise<void> => {
    if (closing) return;
    closing = true;
    await closeLocalServer(handle, timeoutMs);
    processLike.exitCode = 0;
  };
  processLike.once('SIGINT', shutdown);
  processLike.once('SIGTERM', shutdown);
  return () => {
    processLike.removeListener('SIGINT', shutdown);
    processLike.removeListener('SIGTERM', shutdown);
  };
}

/**
 * Build the console summary lines. Never includes any token value — only the
 * pairing token (which is the loopback auth secret the operator needs) and
 * non-secret project flags.
 */
export function formatStartupSummary(
  handle: Pick<LocalServerHandle, 'url' | 'pairingToken'>,
  config: LocalConfig,
  tokenProjects: string[],
): string[] {
  const lines: string[] = [];
  lines.push(`CLI Bridge local server (configured) listening on ${handle.url}`);
  lines.push(`Project Workspace UI: ${handle.url}/console/project`);
  lines.push(`Pairing token: ${handle.pairingToken}`);
  lines.push('');
  lines.push('Configured projects:');
  for (const project of config.projects ?? []) {
    const root = config.projectWorkspaceRoots?.[project.key];
    const flags = [
      project.gitStatusEnabled ? 'git-status' : null,
      project.verifyProfileId ? `verify:${project.verifyProfileId}` : null,
      project.githubChecksEnabled ? 'github-checks' : null,
    ].filter(Boolean);
    lines.push(
      `  - ${project.key} [${flags.join(', ') || 'no live features'}]` +
        `${root ? ` root=${root}` : ' (no workspace root → live features 409)'}`,
    );
  }
  if (tokenProjects.length > 0) {
    lines.push('');
    lines.push(`GitHub token loaded (memory-only) for: ${tokenProjects.join(', ')}`);
  }
  return lines;
}

function isMainModule(): boolean {
  const entryPoint = process.argv[1];
  if (!entryPoint) return false;
  return import.meta.url === pathToFileURL(entryPoint).href;
}

/** Best-effort, non-fatal browser open. Never throws; never carries a token. */
function openInBrowser(target: string): void {
  try {
    if (process.platform === 'win32') {
      // `start` is a cmd builtin; empty title arg avoids quoting issues.
      spawn('cmd', ['/c', 'start', '', target], { detached: true, stdio: 'ignore' }).unref();
    } else if (process.platform === 'darwin') {
      spawn('open', [target], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [target], { detached: true, stdio: 'ignore' }).unref();
    }
  } catch {
    // Opening is a convenience only; ignore any failure.
  }
}

async function main(): Promise<void> {
  const config = loadConfig();
  const port = typeof config.port === 'number' ? config.port : DEFAULT_LOCAL_SERVER_PORT;

  const { store: githubTokenStore, tokenProjects } = buildTokenStore(config);

  const handle = await startLocalServer(port, buildRuntimeOptions(config, githubTokenStore));

  await bootstrapStartedServer(
    handle,
    config.projects ?? [],
    fetch as unknown as FetchLike,
  );
  installShutdownHandlers(handle);

  for (const line of formatStartupSummary(handle, config, tokenProjects)) {
    console.log(line);
  }

  // RP-2.19: best-effort open the console. Suppressible (CLI_BRIDGE_NO_OPEN) and
  // only when interactive. The pairing token is never placed in the URL.
  if (shouldAutoOpen() && process.stdout.isTTY) {
    openInBrowser(buildConsoleOpenTarget(handle));
  }
}

if (isMainModule()) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
