// ADR-0025: Console auto-pair content script.
// Runs only on http://127.0.0.1:31337/console/project.
// Reads the one-time extension claim nonce from the Console bootstrap element
// and sends it to the extension background for exchange.

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

void claimLocalSession();
