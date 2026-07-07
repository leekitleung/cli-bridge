// ADR-0035: ChatGPT Web Source Relay Poller.
//
// Mirrors the outbound-poller pattern but for the source relay protocol.
// The extension polls for pending source prompts, fills them into the
// ChatGPT composer, submits, observes the response, and posts results back.
//
// Key improvements for connection stability:
// - Exponential backoff on connection failures
// - Specific failure reason codes for better diagnostics
// - Connection health tracking
// - Auto-recovery on token refresh

import {
  sendChatGptWebHeartbeat,
  pollChatGptWebNext,
  postChatGptWebResult,
  hasPairingToken,
  loadPairingTokenFromStorage,
} from './bridge-client.ts';
import {
  fillComposerText as fillComposerTextDefault,
  submitAuthorizedPrompt,
  type FillComposerResult,
  type SubmitPromptResult,
  detectChatGPTPageState,
  type ChatGPTPageState,
} from './chatgpt-dom.ts';
import {
  detectStreamingState,
  waitForStableAssistantResponse,
  type StableAssistantResponseResult,
} from './extraction.ts';
import {
  SOURCE_RELAY_REGISTER_OWNER_MESSAGE,
  SOURCE_RELAY_TICK_MESSAGE,
} from '../source-relay-messages.ts';

export interface SourceRelayPollerOptions {
  root?: ParentNode;
  intervalMs?: number;
  setIntervalFn?: typeof globalThis.setInterval;
  clearIntervalFn?: typeof globalThis.clearInterval;
  isStreaming?: (root?: ParentNode) => boolean;
  sendHeartbeat?: () => Promise<{ ok: boolean }>;
  fillComposerText?: (
    text: string,
    options: { root?: ParentNode },
  ) => Promise<FillComposerResult>;
  computeContentHash?: (root?: ParentNode) => Promise<string | null>;
  submitPrompt?: (
    expectedContentHash: string,
    options: { root?: ParentNode; expectedPromptText?: string },
  ) => Promise<SubmitPromptResult>;
  waitForAssistantResponse?: (options: { root?: ParentNode; timeoutMs?: number }) => Promise<StableAssistantResponseResult>;
  /** Whether this page is allowed to claim a source task. Defaults to a single-tab owner lock. */
  canClaim?: () => boolean | Promise<boolean>;
  /** Max time the poller waits for the assistant response to stabilize (ms). */
  responseTimeoutMs?: number;
  /** Run one tick as soon as the poller starts, before the interval fires. */
  startImmediately?: boolean;
  onEvent?: (event: SourceRelayPollerEvent) => void;
}

export type SourceRelayPollerEvent =
  | { type: 'waiting'; reason: 'unpaired' | 'streaming' | 'in-flight' | 'stopped' | 'not-active' }
  | { type: 'heartbeat'; ok: boolean }
  | { type: 'claimed'; promptId: string }
  | { type: 'delivered'; promptId: string }
  | { type: 'submitted'; promptId: string }
  | { type: 'returned'; promptId: string }
  | { type: 'failed'; reason: SourceRelayFailureReason; detail?: string }
  | { type: 'reconnecting'; attempt: number; maxAttempts: number; nextIntervalMs: number }
  | { type: 'connection-lost'; consecutiveFailures: number }
  | { type: 'connection-restored' }
  | { type: 'backoff-reset' };

export type SourceRelayFailureReason =
  | 'fill-failed'
  | 'submit-failed'
  | 'extract-failed'
  | 'return-failed'
  | 'heartbeat-failed'
  | 'poll-failed'
  | 'network-unreachable'
  | 'token-invalid'
  | 'timeout'
  | 'poller-error';

export interface SourceRelayPollerHandle {
  stop(): void;
  tick(): Promise<FillComposerResult | null>;
  /** Force a heartbeat to check connection status. */
  ping(): Promise<boolean>;
  /** Get current connection health info. */
  getHealth(): SourceRelayHealth;
}

export interface SourceRelayHealth {
  isRunning: boolean;
  consecutiveFailures: number;
  lastHeartbeatAt: number | null;
  lastSuccessfulTickAt: number | null;
  lastError: SourceRelayFailureReason | null;
  currentIntervalMs: number;
  isInBackoff: boolean;
  backoffAttempts: number;
  backoffRemainingMs: number;
  maxIntervalMs: number;
  totalRequests: number;
  successCount: number;
  failureCount: number;
}

export const DEFAULT_SOURCE_RELAY_POLL_INTERVAL_MS = 3000;
const HEARTBEAT_INTERVAL_MS = 30_000; // Send heartbeat every 30s.
const MAX_CONSECUTIVE_HEARTBEAT_FAILURES = 3;
const SOURCE_OWNER_STORAGE_KEY = 'cliBridgeSourceRelayOwner';
const SOURCE_OWNER_TTL_MS = 120_000;
/**
 * Default response wait timeout for the source relay poller. Keep this shorter
 * than the server-side timeout so a best-effort extracted answer can still be
 * posted before the server marks the source request failed.
 */
const DEFAULT_RESPONSE_TIMEOUT_MS = 110_000;

// Exponential backoff configuration for connection recovery
const INITIAL_BACKOFF_MS = 5_000;
const MAX_BACKOFF_MS = 60_000;
const BACKOFF_MULTIPLIER = 2;
const MAX_BACKOFF_ATTEMPTS = 6;

interface SourceRelayOwnerRecord {
  ownerKey: string;
  updatedAt: number;
}

function getSourceRelayOwnerKey(): string {
  const url = globalThis.location;
  if (!url) return 'unknown';
  return `${url.origin}${url.pathname}${url.search}`;
}

async function loadSourceRelayOwner(): Promise<SourceRelayOwnerRecord | null> {
  try {
    const storage = chrome?.storage?.session;
    if (!storage) return null;
    const result = await storage.get(SOURCE_OWNER_STORAGE_KEY);
    const owner = result?.[SOURCE_OWNER_STORAGE_KEY] as Partial<SourceRelayOwnerRecord> | undefined;
    if (
      owner
      && typeof owner.ownerKey === 'string'
      && typeof owner.updatedAt === 'number'
    ) {
      return { ownerKey: owner.ownerKey, updatedAt: owner.updatedAt };
    }
  } catch {
    // Storage unavailable: fall back to permissive behavior.
  }
  return null;
}

async function saveSourceRelayOwner(ownerKey: string, updatedAt: number): Promise<boolean> {
  try {
    const storage = chrome?.storage?.session;
    if (!storage) return false;
    await storage.set({ [SOURCE_OWNER_STORAGE_KEY]: { ownerKey, updatedAt } });
    return true;
  } catch {
    return false;
  }
}

function registerSourceRelayOwnerWithBackground(): void {
  try {
    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return;
    chrome.runtime.sendMessage({ type: SOURCE_RELAY_REGISTER_OWNER_MESSAGE });
  } catch {
    // Best effort only: storage owner lock still works if the background is unavailable.
  }
}

export async function canCurrentPageClaimSourceRelayTask(now = Date.now()): Promise<boolean> {
  const ownerKey = getSourceRelayOwnerKey();
  const visible = globalThis.document?.visibilityState !== 'hidden';
  const owner = await loadSourceRelayOwner();
  const ownerIsFresh = owner ? now - owner.updatedAt <= SOURCE_OWNER_TTL_MS : false;

  if (visible) {
    await saveSourceRelayOwner(ownerKey, now);
    registerSourceRelayOwnerWithBackground();
    return true;
  }

  if (ownerIsFresh && owner?.ownerKey === ownerKey) {
    await saveSourceRelayOwner(ownerKey, now);
    return true;
  }

  if (!chrome?.storage?.session) {
    return true;
  }

  return false;
}

/**
 * Calculate exponential backoff interval with jitter.
 */
function calculateBackoff(attempt: number): number {
  const base = Math.min(INITIAL_BACKOFF_MS * Math.pow(BACKOFF_MULTIPLIER, attempt), MAX_BACKOFF_MS);
  // Add jitter (±25%) to prevent thundering herd
  const jitter = base * 0.25 * (Math.random() * 2 - 1);
  return Math.round(base + jitter);
}

/**
 * Map bridge-client error codes to specific failure reasons.
 */
function mapErrorToFailureReason(error: unknown): SourceRelayFailureReason {
  if (typeof error === 'string') {
    if (error === 'no-pairing-token') return 'token-invalid';
    if (error === 'network-error') return 'network-unreachable';
    if (error.includes('401') || error.includes('403')) return 'token-invalid';
    if (error.includes('timeout')) return 'timeout';
  }
  return 'poller-error';
}

export function startSourceRelayPoller(
  options: SourceRelayPollerOptions = {},
): SourceRelayPollerHandle {
  let stopped = false;
  let inFlight = false;
  let lastHeartbeatTime = 0;
  let consecutiveHeartbeatFailures = 0;
  let lastSuccessfulTickTime = 0;
  let lastError: SourceRelayFailureReason | null = null;
  let backoffAttempts = 0;
  let isInBackoff = false;
  let currentBackoffIntervalMs = INITIAL_BACKOFF_MS;
  let backoffRemainingMs = 0;
  let tokenWasMissing = false;
  let totalRequests = 0;
  let successCount = 0;
  let failureCount = 0;

  const setIntervalFn = options.setIntervalFn ?? globalThis.setInterval.bind(globalThis);
  const clearIntervalFn = options.clearIntervalFn ?? globalThis.clearInterval.bind(globalThis);
  const isStreaming = options.isStreaming
    ?? ((root?: ParentNode) => detectStreamingState(root ?? null));
  const sendHeartbeat = options.sendHeartbeat ?? sendChatGptWebHeartbeat;
  const fillComposerText = options.fillComposerText ?? fillComposerTextDefault;
  const computeContentHash = options.computeContentHash
    ?? (async (root?: ParentNode) => {
      const { getComposerContentHash } = await import('./chatgpt-dom.ts');
      return getComposerContentHash(root ?? null);
    });
  const submitPrompt = options.submitPrompt ?? submitAuthorizedPrompt;
  const canClaim = options.canClaim ?? canCurrentPageClaimSourceRelayTask;
  const responseTimeoutMs = options.responseTimeoutMs ?? DEFAULT_RESPONSE_TIMEOUT_MS;
  const waitForAssistantResponse = options.waitForAssistantResponse
    ?? ((waitOptions: { root?: ParentNode; timeoutMs?: number }) => waitForStableAssistantResponse(waitOptions));

  const resetBackoff = () => {
    if (backoffAttempts > 0) {
      options.onEvent?.({ type: 'backoff-reset' });
    }
    backoffAttempts = 0;
    isInBackoff = false;
    currentBackoffIntervalMs = INITIAL_BACKOFF_MS;
    backoffRemainingMs = 0;
  };

  const recordFailure = (reason: SourceRelayFailureReason, detail?: string) => {
    lastError = reason;
    consecutiveHeartbeatFailures++;
    failureCount++;

    if (consecutiveHeartbeatFailures >= MAX_CONSECUTIVE_HEARTBEAT_FAILURES) {
      // Enter backoff mode
      if (!isInBackoff) {
        isInBackoff = true;
        options.onEvent?.({ type: 'connection-lost', consecutiveFailures: consecutiveHeartbeatFailures });
      }

      backoffAttempts = Math.min(backoffAttempts + 1, MAX_BACKOFF_ATTEMPTS);
      currentBackoffIntervalMs = calculateBackoff(backoffAttempts - 1);
      backoffRemainingMs = currentBackoffIntervalMs;
      options.onEvent?.({
        type: 'reconnecting',
        attempt: backoffAttempts,
        maxAttempts: MAX_BACKOFF_ATTEMPTS,
        nextIntervalMs: currentBackoffIntervalMs,
      });
    }
  };

  const recordSuccess = () => {
    if (consecutiveHeartbeatFailures > 0) {
      options.onEvent?.({ type: 'connection-restored' });
    }
    consecutiveHeartbeatFailures = 0;
    lastError = null;
    resetBackoff();
  };

  const recordRequestSuccess = () => {
    totalRequests++;
    successCount++;
  };

  const tick = async (): Promise<FillComposerResult | null> => {
    if (stopped) {
      console.debug('[SourceRelayPoller] tick skipped: stopped');
      options.onEvent?.({ type: 'waiting', reason: 'stopped' });
      return null;
    }

    // Skip tick during backoff (unless it's a forced ping)
    if (isInBackoff) {
      console.debug('[SourceRelayPoller] tick skipped: in backoff mode');
      return null;
    }

    if (inFlight) {
      console.debug('[SourceRelayPoller] tick skipped: in-flight');
      options.onEvent?.({ type: 'waiting', reason: 'in-flight' });
      return null;
    }

    // Check ChatGPT page state before proceeding
    const pageState = detectChatGPTPageState();
    console.debug(`[SourceRelayPoller] page state: ${pageState.state}, messages=${pageState.messageCount}`);

    // Skip if page is in a state where relay shouldn't happen
    if (pageState.state === 'rate-limited') {
      console.debug('[SourceRelayPoller] tick skipped: rate-limited');
      options.onEvent?.({ type: 'failed', reason: 'timeout', detail: 'Rate limited by ChatGPT' });
      return null;
    }
    if (pageState.state === 'auth-required') {
      console.debug('[SourceRelayPoller] tick skipped: auth-required');
      options.onEvent?.({ type: 'failed', reason: 'token-invalid', detail: 'Authentication required' });
      return null;
    }
    if (pageState.state === 'error' && pageState.lastError) {
      console.debug(`[SourceRelayPoller] page error detected: ${pageState.lastError}`);
      // Don't block relay for transient errors, but log them
    }

    // Try to load token if missing (handles token refresh scenario)
    if (!hasPairingToken()) {
      tokenWasMissing = true;
      await loadPairingTokenFromStorage();
    } else if (tokenWasMissing) {
      // Token was previously missing but now present - connection might be restored
      tokenWasMissing = false;
      resetBackoff();
    }

    if (!hasPairingToken()) {
      console.debug('[SourceRelayPoller] tick skipped: unpaired (no token)');
      options.onEvent?.({ type: 'waiting', reason: 'unpaired' });
      recordFailure('token-invalid', 'No pairing token available');
      return null;
    }

    console.debug('[SourceRelayPoller] checking canClaim...');
    const claimAllowed = await canClaim();
    console.debug(`[SourceRelayPoller] canClaim result: ${claimAllowed}`);

    // Send heartbeat periodically to keep the source adapter availability alive.
    const now = Date.now();
    const timeSinceLastHeartbeat = now - lastHeartbeatTime;
    console.debug(`[SourceRelayPoller] heartbeat check: last=${lastHeartbeatTime}, now=${now}, elapsed=${timeSinceLastHeartbeat}ms, interval=${HEARTBEAT_INTERVAL_MS}ms`);

    if (now - lastHeartbeatTime >= HEARTBEAT_INTERVAL_MS) {
      console.debug('[SourceRelayPoller] sending heartbeat...');
      try {
        const hb = await sendHeartbeat();
        console.debug(`[SourceRelayPoller] heartbeat result:`, hb);
        lastHeartbeatTime = now;

        if (hb.ok) {
          consecutiveHeartbeatFailures = 0;
          recordSuccess();
          options.onEvent?.({ type: 'heartbeat', ok: true });
        } else {
          consecutiveHeartbeatFailures++;
          // Cast to access status property which exists on BridgeClientResult
          const hbStatus = (hb as { ok: boolean; status?: number }).status;
          const reason = hbStatus === 401 || hbStatus === 403 ? 'token-invalid' : 'heartbeat-failed';
          recordFailure(reason);
          options.onEvent?.({ type: 'heartbeat', ok: false });

          if (consecutiveHeartbeatFailures >= MAX_CONSECUTIVE_HEARTBEAT_FAILURES) {
            options.onEvent?.({ type: 'failed', reason, detail: 'Heartbeat failed after retries' });
          }
        }
      } catch (err) {
        consecutiveHeartbeatFailures++;
        const reason = mapErrorToFailureReason(err);
        recordFailure(reason);
        console.debug('[SourceRelayPoller] heartbeat exception:', err);
        options.onEvent?.({ type: 'heartbeat', ok: false });

        if (consecutiveHeartbeatFailures >= MAX_CONSECUTIVE_HEARTBEAT_FAILURES) {
          options.onEvent?.({ type: 'failed', reason, detail: 'Heartbeat exception' });
        }
      }
      // Don't process source prompts on the same tick as heartbeat to avoid race conditions.
      return null;
    }

    if (isStreaming(options.root)) {
      options.onEvent?.({ type: 'waiting', reason: 'streaming' });
      return null;
    }

    if (!claimAllowed) {
      options.onEvent?.({ type: 'waiting', reason: 'not-active' });
      return null;
    }

    inFlight = true;
    try {
      // Poll for next source prompt
      const claimed = await pollChatGptWebNext();
      if (!claimed.ok) {
        const reason = mapErrorToFailureReason(claimed.error);
        recordFailure(reason);
        options.onEvent?.({ type: 'failed', reason, detail: 'Poll request failed' });
        return null;
      }

      const task = claimed.data?.task;
      if (!task) {
        // No pending task - this is normal, not an error
        recordSuccess();
        return null;
      }

      options.onEvent?.({ type: 'claimed', promptId: task.id });

      // Fill the composer with the source prompt.
      const fillResult = await fillComposerText(task.prompt, {
        root: options.root,
      });
      if (!fillResult.ok) {
        options.onEvent?.({ type: 'failed', reason: 'fill-failed', detail: fillResult.reason ?? undefined });
        return fillResult;
      }
      options.onEvent?.({ type: 'delivered', promptId: task.id });

      // Compute the hash of the filled content so submitAuthorizedPrompt can verify.
      const composerHash = await computeContentHash(options.root);
      if (!composerHash) {
        options.onEvent?.({ type: 'failed', reason: 'fill-failed', detail: 'Could not compute content hash' });
        return fillResult;
      }

      // Auto-submit and wait for response.
      const submitResult = await submitPrompt(composerHash, {
        root: options.root,
        expectedPromptText: task.prompt,
      });
      if (!submitResult.ok) {
        options.onEvent?.({ type: 'failed', reason: 'submit-failed', detail: submitResult.reason ?? undefined });
        return fillResult;
      }
      options.onEvent?.({ type: 'submitted', promptId: task.id });

      // Wait for the assistant response to stabilize.
      const response = await waitForAssistantResponse({ root: options.root, timeoutMs: responseTimeoutMs });
      const responseText = response.text.trim();

      if (!response.ok && responseText.length === 0) {
        const reason = response.reason === 'streaming' ? 'timeout' : 'extract-failed';
        options.onEvent?.({ type: 'failed', reason, detail: response.reason ?? undefined });
        return fillResult;
      }

      // Post the result back to the server.
      const returned = await postChatGptWebResult(task.id, responseText);
      if (!returned.ok) {
        const reason = mapErrorToFailureReason(returned.error);
        options.onEvent?.({ type: 'failed', reason, detail: 'Failed to post result to server' });
        return fillResult;
      }

      options.onEvent?.({ type: 'returned', promptId: task.id });
      recordRequestSuccess();
      recordSuccess();
      lastSuccessfulTickTime = Date.now();
      return fillResult;
    } catch (err) {
      const reason = mapErrorToFailureReason(err);
      recordFailure(reason);
      options.onEvent?.({ type: 'failed', reason, detail: 'Unexpected error in tick' });
      console.error('[SourceRelayPoller] tick failed:', err);
      return null;
    } finally {
      inFlight = false;
    }
  };

  const runTick = () => {
    tick().catch((err) => {
      console.error('[SourceRelayPoller] tick failed:', err);
      options.onEvent?.({ type: 'failed', reason: 'poller-error', detail: 'Tick catch block' });
    });
  };

  // SECURITY FIX: Add automatic recovery attempts during backoff mode
  // This runs at longer intervals than normal polling to avoid hammering the server
  // while still allowing automatic reconnection without user intervention
  const BACKOFF_RECOVERY_CHECK_INTERVAL_MS = 30_000; // Check every 30s during backoff

  // Internal ping function for recovery checks
  const runPing = async (): Promise<boolean> => {
    // SECURITY FIX: ping during backoff triggers immediate recovery attempt
    // This allows manual reconnection without waiting for backoff to expire
    if (isInBackoff) {
      resetBackoff();
    }

    try {
      const hb = await sendHeartbeat();
      const success = hb.ok;
      if (success) {
        lastHeartbeatTime = Date.now();
        recordSuccess();
      }
      return success;
    } catch {
      return false;
    }
  };

  const runRecoveryCheck = () => {
    if (isInBackoff && backoffAttempts > 0) {
      // Attempt a recovery ping with reduced backoff
      runPing().then((success) => {
        if (success) {
          console.debug('[SourceRelayPoller] Backoff recovery successful via auto-check');
        }
      });
    }
  };

  const timer = setIntervalFn(
    runTick,
    options.intervalMs ?? DEFAULT_SOURCE_RELAY_POLL_INTERVAL_MS,
  );

  // Recovery check timer runs independently to allow automatic reconnection
  const recoveryTimer = setIntervalFn(
    runRecoveryCheck,
    BACKOFF_RECOVERY_CHECK_INTERVAL_MS,
  );

  if (options.startImmediately !== false) {
    runTick();
  }

  return {
    stop() {
      stopped = true;
      clearIntervalFn(timer);
      clearIntervalFn(recoveryTimer);
    },
    tick,
    ping(): Promise<boolean> {
      return runPing();
    },
    getHealth(): SourceRelayHealth {
      return {
        isRunning: !stopped,
        consecutiveFailures: consecutiveHeartbeatFailures,
        lastHeartbeatAt: lastHeartbeatTime || null,
        lastSuccessfulTickAt: lastSuccessfulTickTime || null,
        lastError,
        currentIntervalMs: currentBackoffIntervalMs,
        isInBackoff,
        backoffAttempts,
        backoffRemainingMs,
        maxIntervalMs: MAX_BACKOFF_MS,
        totalRequests,
        successCount,
        failureCount,
      };
    },
  };
}

let activeSourceRelayPoller: SourceRelayPollerHandle | null = null;
let wakeListenerInstalled = false;

export async function wakeActiveSourceRelayPoller(): Promise<{ ok: boolean; active: boolean }> {
  if (!activeSourceRelayPoller) {
    return { ok: false, active: false };
  }
  await activeSourceRelayPoller.tick();
  return { ok: true, active: true };
}

export function installSourceRelayWakeListener(): boolean {
  if (wakeListenerInstalled) return true;
  if (typeof chrome === 'undefined' || !chrome.runtime?.onMessage) return false;
  chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    const typed = message as { type?: string };
    if (typed?.type !== SOURCE_RELAY_TICK_MESSAGE) return false;
    wakeActiveSourceRelayPoller()
      .then((result) => sendResponse(result))
      .catch(() => sendResponse({ ok: false, active: Boolean(activeSourceRelayPoller) }));
    return true;
  });
  wakeListenerInstalled = true;
  return true;
}

export function ensureSourceRelayPoller(
  options: SourceRelayPollerOptions = {},
): SourceRelayPollerHandle {
  if (activeSourceRelayPoller) {
    return activeSourceRelayPoller;
  }
  installSourceRelayWakeListener();
  activeSourceRelayPoller = startSourceRelayPoller(options);
  return activeSourceRelayPoller;
}

export function stopActiveSourceRelayPoller(): void {
  if (activeSourceRelayPoller) {
    activeSourceRelayPoller.stop();
    activeSourceRelayPoller = null;
  }
}
