import { mountBridgePanel, PANEL_ROOT_ID } from '../ui/bridge-panel.tsx';

function mountOnce(): void {
  if (!document.body || document.getElementById(PANEL_ROOT_ID)) {
    return;
  }

  mountBridgePanel(document);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mountOnce, { once: true });
} else {
  mountOnce();
}
