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
  fillComposerText,
  submitAuthorizedPrompt,
  type FillComposerResult,
  type SubmitPromptResult,
} from './chatgpt-dom.ts';
import {
  detectStreamingState,
  waitForStableAssistantResponse,
  type StableAssistantResponseResult,
} from './extraction.ts';

export interface SourceRelayPollerOptions {
  root?: ParentNode;
  intervalMs?: number;
  setIntervalFn?: typeof globalThis.setInterval;
  clearIntervalFn?: typeof globalThis.clearInterval;
  isStreaming?: (root?: ParentNode) => boolean;
  submitPrompt?: (
    expectedContentHash: string,
    options: { root?: ParentNode; expectedPromptText?: string },
  ) => Promise<SubmitPromptResult>;
  waitForAssistantResponse?: (options: { root?: ParentNode }) => Promise<StableAssistantResponseResult>;
  onEvent?: (event: SourceRelayPollerEvent) => void;
}

export type SourceRelayPollerEvent =
  | { type: 'waiting'; reason: 'unpaired' | 'streaming' | 'in-flight' | 'stopped' }
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
  const submitPrompt = options.submitPrompt ?? submitAuthorizedPrompt;
  const waitForAssistantResponse = options.waitForAssistantResponse
    ?? ((waitOptions: { root?: ParentNode }) => waitForStableAssistantResponse(waitOptions));

  const tick = async (): Promise<FillComposerResult | null> => {
    if (stopped) {
      options.onEvent?.({ type: 'waiting', reason: 'stopped' });
      return null;
    }
    if (inFlight) {
      options.onEvent?.({ type: 'waiting', reason: 'in-flight' });
      return null;
    }
    if (!hasPairingToken()) {
      await loadPairingTokenFromStorage();
    }
    if (!hasPairingToken()) {
      options.onEvent?.({ type: 'waiting', reason: 'unpaired' });
      return null;
    }
    if (isStreaming(options.root)) {
      options.onEvent?.({ type: 'waiting', reason: 'streaming' });
      return null;
    }

    // Send heartbeat periodically to keep the source adapter availability alive.
    const now = Date.now();
    if (now - lastHeartbeatTime >= HEARTBEAT_INTERVAL_MS) {
      try {
        const hb = await sendChatGptWebHeartbeat();
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

      // Auto-submit and wait for response.
      const submitResult = await submitPrompt(fillResult.status === 'filled' ? '' : '', {
        root: options.root,
        expectedPromptText: task.prompt,
      });
      if (!submitResult.ok) {
        options.onEvent?.({ type: 'failed', reason: 'submit-failed' });
        return fillResult;
      }
      options.onEvent?.({ type: 'submitted', promptId: task.id });

      // Wait for the assistant response to stabilize.
      const response = await waitForAssistantResponse({ root: options.root });
      if (!response.ok) {
        options.onEvent?.({ type: 'failed', reason: 'extract-failed' });
        return fillResult;
      }

      // Post the result back to the server.
      const returned = await postChatGptWebResult(task.id, response.text);
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

  const timer = setIntervalFn(
    () => {
      tick().catch(() => options.onEvent?.({ type: 'failed', reason: 'poller-error' }));
    },
    options.intervalMs ?? DEFAULT_SOURCE_RELAY_POLL_INTERVAL_MS,
  );

  return {
    stop() {
      stopped = true;
      clearIntervalFn(timer);
    },
    tick,
  };
}

let activeSourceRelayPoller: SourceRelayPollerHandle | null = null;

export function ensureSourceRelayPoller(
  options: SourceRelayPollerOptions = {},
): SourceRelayPollerHandle {
  if (activeSourceRelayPoller) {
    return activeSourceRelayPoller;
  }
  activeSourceRelayPoller = startSourceRelayPoller(options);
  return activeSourceRelayPoller;
}

export function stopActiveSourceRelayPoller(): void {
  if (activeSourceRelayPoller) {
    activeSourceRelayPoller.stop();
    activeSourceRelayPoller = null;
  }
}
