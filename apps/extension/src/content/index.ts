import { mountBridgePanel, PANEL_ROOT_ID } from '../ui/bridge-panel.tsx';
import { loadPairingTokenFromStorage } from './bridge-client.ts';
import { startOutboundPromptPoller } from './outbound-poller.ts';

function mountOnce(): void {
  if (!document.body || document.getElementById(PANEL_ROOT_ID)) {
    return;
  }

  mountBridgePanel(document);
  loadPairingTokenFromStorage()
    .then((token) => {
      if (token) {
        startOutboundPromptPoller({
          root: document,
          clipboard: globalThis.navigator?.clipboard,
        });
      }
    })
    .catch(() => {});
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mountOnce, { once: true });
} else {
  mountOnce();
}
