// ADR-0035: ChatGPT Web Source Relay Poller.
//
// Mirrors the outbound-poller pattern but for the source relay protocol.
// The extension polls for pending source prompts, fills them into the
// ChatGPT composer, submits, observes the response, and posts results back.

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
  | { type: 'failed'; reason: 'fill-failed' | 'submit-failed' | 'extract-failed' | 'return-failed' | 'poller-error' };

export interface SourceRelayPollerHandle {
  stop(): void;
  tick(): Promise<FillComposerResult | null>;
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

export function startSourceRelayPoller(
  options: SourceRelayPollerOptions = {},
): SourceRelayPollerHandle {
  let stopped = false;
  let inFlight = false;
  let lastHeartbeatTime = 0;
  let consecutiveHeartbeatFailures = 0;
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

  const tick = async (): Promise<FillComposerResult | null> => {
    if (stopped) {
      console.debug('[SourceRelayPoller] tick skipped: stopped');
      options.onEvent?.({ type: 'waiting', reason: 'stopped' });
      return null;
    }
    if (inFlight) {
      console.debug('[SourceRelayPoller] tick skipped: in-flight');
      options.onEvent?.({ type: 'waiting', reason: 'in-flight' });
      return null;
    }
    if (!hasPairingToken()) {
      console.debug('[SourceRelayPoller] no pairing token, attempting to load from storage');
      await loadPairingTokenFromStorage();
    }
    if (!hasPairingToken()) {
      console.debug('[SourceRelayPoller] tick skipped: unpaired (no token after load attempt)');
      options.onEvent?.({ type: 'waiting', reason: 'unpaired' });
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
          options.onEvent?.({ type: 'heartbeat', ok: true });
        } else {
          consecutiveHeartbeatFailures++;
          options.onEvent?.({ type: 'heartbeat', ok: false });
          if (consecutiveHeartbeatFailures >= MAX_CONSECUTIVE_HEARTBEAT_FAILURES) {
            options.onEvent?.({ type: 'failed', reason: 'poller-error' });
          }
        }
      } catch {
        consecutiveHeartbeatFailures++;
        options.onEvent?.({ type: 'heartbeat', ok: false });
      }
      // Don't process source prompts on the same tick as heartbeat.
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
      const claimed = await pollChatGptWebNext();
      const task = claimed.ok ? claimed.data?.task : null;
      if (!task) return null;
      options.onEvent?.({ type: 'claimed', promptId: task.id });

      // Fill the composer with the source prompt.
      const fillResult = await fillComposerText(task.prompt, {
        root: options.root,
      });
      if (!fillResult.ok) {
        options.onEvent?.({ type: 'failed', reason: 'fill-failed' });
        return fillResult;
      }
      options.onEvent?.({ type: 'delivered', promptId: task.id });

      // Compute the hash of the filled content so submitAuthorizedPrompt can verify.
      const composerHash = await computeContentHash(options.root);
      if (!composerHash) {
        options.onEvent?.({ type: 'failed', reason: 'fill-failed' });
        return fillResult;
      }

      // Auto-submit and wait for response.
      const submitResult = await submitPrompt(composerHash, {
        root: options.root,
        expectedPromptText: task.prompt,
      });
      if (!submitResult.ok) {
        options.onEvent?.({ type: 'failed', reason: 'submit-failed' });
        return fillResult;
      }
      options.onEvent?.({ type: 'submitted', promptId: task.id });

      // Wait for the assistant response to stabilize.
      const response = await waitForAssistantResponse({ root: options.root, timeoutMs: responseTimeoutMs });
      const responseText = response.text.trim();
      if (!response.ok && responseText.length === 0) {
        options.onEvent?.({ type: 'failed', reason: 'extract-failed' });
        return fillResult;
      }

      // Post the result back to the server.
      const returned = await postChatGptWebResult(task.id, responseText);
      if (!returned.ok) {
        options.onEvent?.({ type: 'failed', reason: 'return-failed' });
        return fillResult;
      }
      options.onEvent?.({ type: 'returned', promptId: task.id });
      return fillResult;
    } finally {
      inFlight = false;
    }
  };

  const runTick = () => {
    tick().catch((err) => {
      console.error('[SourceRelayPoller] tick failed:', err);
      options.onEvent?.({ type: 'failed', reason: 'poller-error' });
    });
  };

  const timer = setIntervalFn(
    runTick,
    options.intervalMs ?? DEFAULT_SOURCE_RELAY_POLL_INTERVAL_MS,
  );

  if (options.startImmediately !== false) {
    runTick();
  }

  return {
    stop() {
      stopped = true;
      clearIntervalFn(timer);
    },
    tick,
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
