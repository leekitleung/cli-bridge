// ADR-0025: Console auto-pair content script.
// Runs only on http://127.0.0.1:31337/console/project (extension isolated world).
// Reads the one-time extension claim nonce from the Console bootstrap element
// and sends it to the extension background for exchange.
// Also listens for revoke messages posted by the Console page script (regular
// world) and relays them to the extension background.

import {
  SOURCE_RELAY_WAKE_OWNER_MESSAGE,
} from '../source-relay-messages.ts';

const SOURCE_RELAY_STATUS_PATH = '/bridge/source/chatgpt-web/status';
const SOURCE_RELAY_WAKE_INTERVAL_MS = 1000;

function readClaimNonce(): string | null {
  const node = document.querySelector('[data-extension-claim-nonce]');
  const nonce = node?.getAttribute('data-extension-claim-nonce')?.trim();
  return nonce && nonce.length > 0 ? nonce : null;
}

async function claimLocalSession(): Promise<void> {
  const nonce = readClaimNonce();
  if (!nonce || typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return;
  chrome.runtime.sendMessage({ type: 'cli-bridge-claim-local-session', nonce });
}

function sendSourceRelayWake(): void {
  if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return;
  chrome.runtime.sendMessage({ type: SOURCE_RELAY_WAKE_OWNER_MESSAGE });
}

async function hasPendingSourceRelayPrompt(): Promise<boolean> {
  // MV3: content scripts cannot reach loopback directly — proxy through the
  // background service worker which has host_permissions for 127.0.0.1.
  if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
    return false;
  }
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { type: 'cli-bridge-proxy-fetch', path: SOURCE_RELAY_STATUS_PATH, method: 'GET', token: null },
      (response: unknown) => {
        if (!response || !(response as { ok?: boolean }).ok) {
          resolve(false);
          return;
        }
        const data = (response as { data?: { pending?: unknown } }).data;
        resolve(typeof data?.pending === 'number' && data.pending > 0);
      },
    );
  });
}

async function wakeSourceRelayOwnerIfPending(): Promise<void> {
  if (document.visibilityState === 'hidden') return;
  if (await hasPendingSourceRelayPrompt()) {
    sendSourceRelayWake();
  }
}

function startSourceRelayWakeLoop(): void {
  window.setInterval(() => {
    void wakeSourceRelayOwnerIfPending();
  }, SOURCE_RELAY_WAKE_INTERVAL_MS);
  document.addEventListener('visibilitychange', () => {
    void wakeSourceRelayOwnerIfPending();
  });
}

// The Console page (regular web world) posts a message on revoke.  Because
// chrome.runtime is not available in the regular page context, the Console
// page uses window.postMessage and this listener (running in the extension's
// isolated content script world) relays it to the extension background.
window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  if (event.origin !== window.location.origin) return;
  const data = event.data;
  if (data && typeof data === 'object' && data.type === 'cli-bridge-clear-local-session') {
    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage({ type: 'cli-bridge-clear-local-session' });
    }
  }
});

void claimLocalSession();
startSourceRelayWakeLoop();
