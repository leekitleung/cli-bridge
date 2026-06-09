import {
  acknowledgeOutboundPrompt,
  claimNextOutboundPrompt,
  hasPairingToken,
} from './bridge-client.ts';
import {
  fillComposerText,
  type FillComposerResult,
} from './chatgpt-dom.ts';

export interface OutboundPollerOptions {
  root?: ParentNode;
  clipboard?: Clipboard;
  intervalMs?: number;
  setIntervalFn?: typeof globalThis.setInterval;
  clearIntervalFn?: typeof globalThis.clearInterval;
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

  const tick = async (): Promise<FillComposerResult | null> => {
    if (stopped || inFlight || !hasPairingToken()) {
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
      await acknowledgeOutboundPrompt(
        outboundPrompt.id,
        fillResult.ok,
        fillResult.reason,
      );
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
