import {
  acknowledgeOutboundPrompt,
  claimNextOutboundPrompt,
  createExtractReturn,
  hasPairingToken,
  markOutboundPromptStage,
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
import {
  cancelActiveRelaySession,
  getActiveRelaySession,
  recordRelaySessionStage,
  setActiveRelaySession,
} from './active-relay-session.ts';

export interface OutboundPollerOptions {
  root?: ParentNode;
  clipboard?: Clipboard;
  intervalMs?: number;
  setIntervalFn?: typeof globalThis.setInterval;
  clearIntervalFn?: typeof globalThis.clearInterval;
  /**
   * Returns true when ChatGPT is still generating a reply. While streaming we
   * skip claiming and filling so an in-flight answer is never clobbered.
   * Defaults to {@link detectStreamingState} over the configured root.
   */
  isStreaming?: (root?: ParentNode) => boolean;
  autoRelay?: boolean;
  submitPrompt?: (
    expectedContentHash: string,
    options: { root?: ParentNode; expectedPromptText?: string },
  ) => Promise<SubmitPromptResult>;
  waitForAssistantResponse?: (options: { root?: ParentNode }) => Promise<StableAssistantResponseResult>;
  onEvent?: (event: OutboundPollerEvent) => void;
}

export type OutboundPollerEvent =
  | { type: 'waiting'; reason: 'unpaired' | 'active-session' | 'streaming' | 'in-flight' | 'stopped' }
  | { type: 'claimed'; sessionId: string }
  | { type: 'delivered'; sessionId: string }
  | { type: 'submitted'; sessionId: string }
  | { type: 'returned'; sessionId: string }
  | { type: 'failed'; reason: 'fill-failed' | 'ack-failed' | 'poller-error' };

export interface OutboundPollerHandle {
  stop(): void;
  tick(): Promise<FillComposerResult | null>;
}

export const DEFAULT_OUTBOUND_POLL_INTERVAL_MS = 3000;

export function startOutboundPromptPoller(
  options: OutboundPollerOptions = {},
): OutboundPollerHandle {
  let stopped = false;
  let inFlight = false;
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
      recordRelaySessionStage('unpaired');
      options.onEvent?.({ type: 'waiting', reason: 'unpaired' });
      return null;
    }
    if (getActiveRelaySession()) {
      options.onEvent?.({ type: 'waiting', reason: 'active-session' });
      return null;
    }

    // Do not claim or fill while ChatGPT is still generating a reply; filling
    // the composer mid-stream would clobber the in-flight answer. We leave the
    // prompt queued and retry on the next interval.
    if (isStreaming(options.root)) {
      recordRelaySessionStage('paired');
      options.onEvent?.({ type: 'waiting', reason: 'streaming' });
      return null;
    }

    inFlight = true;
    try {
      recordRelaySessionStage('claiming');
      const claimed = await claimNextOutboundPrompt();
      const outboundPrompt = claimed.ok ? claimed.data?.outboundPrompt : null;
      if (!outboundPrompt) {
        recordRelaySessionStage('paired');
        return null;
      }
      recordRelaySessionStage('claimed', {
        sessionId: outboundPrompt.sessionId,
        outboundPromptId: outboundPrompt.id,
        packetId: outboundPrompt.packetId,
      });
      options.onEvent?.({ type: 'claimed', sessionId: outboundPrompt.sessionId });

      recordRelaySessionStage('filling');
      const fillResult = await fillComposerText(outboundPrompt.prompt, {
        root: options.root,
        clipboard: options.clipboard,
      });
      recordRelaySessionStage('acknowledging');
      const ackResult = await acknowledgeOutboundPrompt(
        outboundPrompt.id,
        outboundPrompt.claimToken,
        fillResult.ok,
        fillResult.reason,
      );
      // Only record the active relay session when the prompt actually landed in
      // the composer AND the server acknowledged delivery. A fill failure /
      // clipboard fallback or a failed ack must not update it.
      if (fillResult.ok && ackResult.ok) {
        setActiveRelaySession({
          sessionId: outboundPrompt.sessionId,
          outboundPromptId: outboundPrompt.id,
          packetId: outboundPrompt.packetId,
          updatedAt: Date.now(),
        });
        options.onEvent?.({ type: 'delivered', sessionId: outboundPrompt.sessionId });
        if (options.autoRelay) {
          const submitResult = await submitPrompt(outboundPrompt.authorization.contentHash, {
            root: options.root,
            expectedPromptText: outboundPrompt.prompt,
          });
          if (!submitResult.ok) {
            recordRelaySessionStage('failed', {
              reason: submitResult.reason ?? 'submit-failed',
            });
            await markOutboundPromptStage(
              outboundPrompt.id,
              'failed',
              submitResult.reason ?? 'submit-failed',
            );
            return fillResult;
          }
          const submitted = await markOutboundPromptStage(outboundPrompt.id, 'submitted');
          if (!submitted.ok) {
            recordRelaySessionStage('failed', { reason: 'submitted-ack-failed' });
            await markOutboundPromptStage(outboundPrompt.id, 'failed', 'submitted-ack-failed');
            return fillResult;
          }
          recordRelaySessionStage('submitted', {
            sessionId: outboundPrompt.sessionId,
            outboundPromptId: outboundPrompt.id,
            packetId: outboundPrompt.packetId,
          });
          options.onEvent?.({ type: 'submitted', sessionId: outboundPrompt.sessionId });
          const responding = await markOutboundPromptStage(outboundPrompt.id, 'responding');
          if (!responding.ok) {
            recordRelaySessionStage('failed', { reason: 'responding-ack-failed' });
            await markOutboundPromptStage(outboundPrompt.id, 'failed', 'responding-ack-failed');
            return fillResult;
          }
          recordRelaySessionStage('responding');
          const response = await waitForAssistantResponse({ root: options.root });
          if (!response.ok) {
            recordRelaySessionStage('failed', {
              reason: response.reason ?? 'response-not-ready',
            });
            await markOutboundPromptStage(
              outboundPrompt.id,
              'failed',
              response.reason ?? 'response-not-ready',
            );
            return fillResult;
          }
          const responseReady = await markOutboundPromptStage(outboundPrompt.id, 'response-ready');
          if (!responseReady.ok) {
            recordRelaySessionStage('failed', { reason: 'response-ready-ack-failed' });
            await markOutboundPromptStage(outboundPrompt.id, 'failed', 'response-ready-ack-failed');
            return fillResult;
          }
          recordRelaySessionStage('response-ready');
          const returned = await createExtractReturn(
            outboundPrompt.sessionId,
            response.text,
            outboundPrompt.id,
          );
          if (!returned.ok) {
            recordRelaySessionStage('failed', { reason: returned.error ?? 'return-failed' });
            await markOutboundPromptStage(
              outboundPrompt.id,
              'failed',
              returned.error ?? 'return-failed',
            );
            return fillResult;
          }
          const returnedStage = await markOutboundPromptStage(outboundPrompt.id, 'returned');
          if (!returnedStage.ok) {
            recordRelaySessionStage('failed', { reason: 'returned-ack-failed' });
            await markOutboundPromptStage(outboundPrompt.id, 'failed', 'returned-ack-failed');
            return fillResult;
          }
          recordRelaySessionStage('returned');
          cancelActiveRelaySession('auto-returned');
          options.onEvent?.({ type: 'returned', sessionId: outboundPrompt.sessionId });
        }
      } else {
        recordRelaySessionStage('failed', {
          reason: fillResult.ok ? 'ack-failed' : (fillResult.reason ?? 'fill-failed'),
        });
        options.onEvent?.({
          type: 'failed',
          reason: fillResult.ok ? 'ack-failed' : 'fill-failed',
        });
      }
      return fillResult;
    } finally {
      inFlight = false;
    }
  };

  const timer = setIntervalFn(
    () => {
      tick().catch(() => options.onEvent?.({ type: 'failed', reason: 'poller-error' }));
    },
    options.intervalMs ?? DEFAULT_OUTBOUND_POLL_INTERVAL_MS,
  );

  return {
    stop() {
      stopped = true;
      clearIntervalFn(timer);
    },
    tick,
  };
}

let activeOutboundPoller: OutboundPollerHandle | null = null;

/**
 * Start the outbound poller at most once per page. Repeated calls (e.g. on
 * load and again after the user pairs in the panel) return the existing
 * handle instead of spawning a second polling loop.
 */
export function ensureOutboundPromptPoller(
  options: OutboundPollerOptions = {},
): OutboundPollerHandle {
  if (activeOutboundPoller) {
    return activeOutboundPoller;
  }
  activeOutboundPoller = startOutboundPromptPoller(options);
  return activeOutboundPoller;
}

/** Stop the active poller, if any (e.g. when the user clears the pairing token). */
export function stopActiveOutboundPoller(): void {
  if (activeOutboundPoller) {
    activeOutboundPoller.stop();
    activeOutboundPoller = null;
  }
}
