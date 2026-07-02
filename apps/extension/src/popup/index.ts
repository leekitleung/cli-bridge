import {
  PROTECTED_HEALTH_PATH,
} from '../../../../packages/shared/src/constants.ts';

type ProxyResult = {
  ok: boolean;
  status: number;
  error?: string;
};

const theme = document.createElement('style');
theme.textContent = `
  :root { color-scheme: light dark; --bg: #f7f7f5; --surface: #ffffff; --text: #181a19; --muted: #5f6a65; --border: #d7ddd9; --accent: #10a37f; }
  @media (prefers-color-scheme: dark) {
    :root { --bg: #0d0d0d; --surface: #171717; --text: #f4f4f5; --muted: #a1a1aa; --border: #303030; }
  }
  button:focus-visible, input:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  details { margin-top: 4px; }
  summary { cursor: pointer; color: var(--muted); font-size: 12px; }
  summary:hover { color: var(--text); }
`;
document.head.append(theme);

const root = document.createElement('main');
Object.assign(root.style, {
  width: '300px',
  boxSizing: 'border-box',
  padding: '12px',
  display: 'grid',
  gap: '10px',
  color: 'var(--text)',
  background: 'var(--bg)',
  fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  fontSize: '13px',
});

const title = document.createElement('h1');
title.textContent = 'Local Bridge';
Object.assign(title.style, {
  margin: '0',
  fontSize: '15px',
});

const help = document.createElement('p');
help.textContent = 'ChatGPT Web connector status. Use Project Console for pairing, routing, and execution.';
Object.assign(help.style, {
  margin: '0',
  color: 'var(--muted)',
  lineHeight: '1.4',
});

const connectionLine = document.createElement('div');
connectionLine.textContent = 'Checking local session...';
connectionLine.setAttribute('data-cli-bridge-popup-connection', 'true');
Object.assign(connectionLine.style, {
  fontWeight: '600',
  minHeight: '18px',
});

const actions = document.createElement('div');
Object.assign(actions.style, {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr 1fr',
  gap: '8px',
});

const openConsoleButton = document.createElement('button');
openConsoleButton.type = 'button';
openConsoleButton.textContent = 'Open Project Console';

const refreshButton = document.createElement('button');
refreshButton.type = 'button';
refreshButton.textContent = 'Refresh Status';

const clearButton = document.createElement('button');
clearButton.type = 'button';
clearButton.textContent = 'Clear Session';

for (const button of [openConsoleButton, refreshButton, clearButton]) {
  Object.assign(button.style, {
    minHeight: '44px',
    border: '1px solid var(--border)',
    borderRadius: '6px',
    background: 'var(--surface)',
    color: 'var(--text)',
    cursor: 'pointer',
    font: 'inherit',
  });
}

const status = document.createElement('output');
status.setAttribute('role', 'status');
status.setAttribute('aria-live', 'polite');
Object.assign(status.style, {
  minHeight: '18px',
  color: 'var(--muted)',
  overflowWrap: 'anywhere',
});

function renderStatus(text: string, kind: 'idle' | 'success' | 'failed' = 'idle') {
  status.textContent = text;
  status.style.color = kind === 'success'
    ? '#15803d'
    : kind === 'failed'
      ? '#b91c1c'
      : '#374151';
}

function proxyHealth(token: string): Promise<ProxyResult> {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(
        {
          type: 'cli-bridge-proxy-fetch',
          path: PROTECTED_HEALTH_PATH,
          method: 'GET',
          token,
        },
        (response: unknown) => {
          if (chrome.runtime?.lastError || !response) {
            resolve({ ok: false, status: 0, error: 'network-error' });
            return;
          }
          resolve(response as ProxyResult);
        },
      );
    } catch {
      resolve({ ok: false, status: 0, error: 'network-error' });
    }
  });
}

// --- Manual token fallback (collapsed) ---

const fallback = document.createElement('details');
const fallbackSummary = document.createElement('summary');
fallbackSummary.textContent = 'Manual token fallback';
fallback.append(fallbackSummary);

const fallbackBody = document.createElement('div');
Object.assign(fallbackBody.style, {
  display: 'grid',
  gap: '8px',
  marginTop: '8px',
});

const input = document.createElement('input');
input.type = 'password';
input.placeholder = 'pairing token';
input.autocomplete = 'off';
input.setAttribute('aria-label', 'Pairing token');
Object.assign(input.style, {
  width: '100%',
  boxSizing: 'border-box',
  border: '1px solid var(--border)',
  color: 'var(--text)',
  background: 'var(--bg)',
  borderRadius: '6px',
  padding: '8px',
  font: 'inherit',
});

const saveButton = document.createElement('button');
saveButton.type = 'button';
saveButton.textContent = 'Save & Test';

Object.assign(saveButton.style, {
  minHeight: '44px',
  border: '1px solid var(--border)',
  borderRadius: '6px',
  background: 'var(--surface)',
  color: 'var(--text)',
  cursor: 'pointer',
  font: 'inherit',
});

saveButton.addEventListener('click', async () => {
  const token = input.value.trim();
  if (token.length === 0) {
    renderStatus('Please enter a pairing token.', 'failed');
    return;
  }

  renderStatus('Testing connection...');
  const result = await proxyHealth(token);
  if (!result.ok) {
    renderStatus(result.status === 401 || result.status === 403
      ? 'Token invalid, please re-enter.'
      : 'Cannot reach local server. Ensure local server is running.', 'failed');
    return;
  }

  await chrome.storage.session.set({ cliBridgePairingToken: token });
  input.value = '';
  input.placeholder = 'Paired; enter a new token to replace';
  renderStatus('Session paired and connection verified.', 'success');
  await loadSavedToken();
});

fallbackBody.append(input, saveButton);
fallback.append(fallbackBody);

// --- Connection state ---

async function loadSavedToken() {
  const stored = await chrome.storage.session.get('cliBridgePairingToken');
  const token = typeof stored?.cliBridgePairingToken === 'string' ? stored.cliBridgePairingToken : '';
  if (token.length === 0) {
    connectionLine.textContent = 'Browser session not paired';
    renderStatus('Open Project Console to pair automatically, or use manual fallback.');
    return;
  }

  const result = await proxyHealth(token);
  if (result.ok) {
    connectionLine.textContent = 'Local Bridge connected';
    renderStatus('Connected session available for ChatGPT Web.', 'success');
  } else if (result.status === 401 || result.status === 403) {
    connectionLine.textContent = 'Session invalid';
    renderStatus('Token expired or revoked. Open Project Console to re-pair.', 'failed');
  } else {
    connectionLine.textContent = 'Local Bridge offline';
    renderStatus('Cannot reach local server. Ensure local server is running.', 'failed');
  }
}

openConsoleButton.addEventListener('click', async () => {
  await chrome.tabs.create({ url: 'http://127.0.0.1:31337/console/project' });
});

refreshButton.addEventListener('click', async () => {
  renderStatus('Refreshing...');
  await loadSavedToken();
});

clearButton.addEventListener('click', async () => {
  await chrome.storage.session.remove('cliBridgePairingToken');
  input.value = '';
  input.placeholder = 'pairing token';
  connectionLine.textContent = 'Browser session not paired';
  renderStatus('Session cleared.');
});

actions.append(openConsoleButton, refreshButton, clearButton);
root.append(title, help, connectionLine, actions, fallback, status);
document.body.append(root);

void loadSavedToken();
