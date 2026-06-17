import {
  acknowledgeOutboundPrompt,
  claimNextOutboundPrompt,
  hasPairingToken,
} from './bridge-client.ts';
import {
  fillComposerText,
  type FillComposerResult,
} from './chatgpt-dom.ts';
import { detectStreamingState } from './extraction.ts';
import { getActiveRelaySession, setActiveRelaySession } from './active-relay-session.ts';

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
}

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

  const tick = async (): Promise<FillComposerResult | null> => {
    if (stopped || inFlight || !hasPairingToken() || getActiveRelaySession()) {
      return null;
    }

    // Do not claim or fill while ChatGPT is still generating a reply; filling
    // the composer mid-stream would clobber the in-flight answer. We leave the
    // prompt queued and retry on the next interval.
    if (isStreaming(options.root)) {
      return null;
    }

    inFlight = true;
    try {
      const claimed = await claimNextOutboundPrompt();
      const outboundPrompt = claimed.ok ? claimed.data?.outboundPrompt : null;
      if (!outboundPrompt) {
        return null;
      }

      const fillResult = await fillComposerText(outboundPrompt.prompt, {
        root: options.root,
        clipboard: options.clipboard,
      });
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
      }
      return fillResult;
    } finally {
      inFlight = false;
    }
  };

  const timer = setIntervalFn(
    () => {
      tick().catch(() => {});
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
