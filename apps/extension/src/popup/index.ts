import {
  PROTECTED_HEALTH_PATH,
} from '../../../../packages/shared/src/constants.ts';

type ProxyResult = {
  ok: boolean;
  status: number;
  error?: string;
};

const root = document.createElement('main');
Object.assign(root.style, {
  width: '300px',
  boxSizing: 'border-box',
  padding: '12px',
  display: 'grid',
  gap: '10px',
  color: '#111827',
  background: '#ffffff',
  fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  fontSize: '13px',
});

const title = document.createElement('h1');
title.textContent = 'CLI Bridge';
Object.assign(title.style, {
  margin: '0',
  fontSize: '15px',
});

const help = document.createElement('p');
help.textContent = '粘贴本地服务显示的配对口令。口令只保留在当前浏览器会话中，不写入 ChatGPT 页面。';
Object.assign(help.style, {
  margin: '0',
  color: '#4b5563',
  lineHeight: '1.4',
});

const input = document.createElement('input');
input.type = 'password';
input.placeholder = 'pairing token';
input.autocomplete = 'off';
input.setAttribute('aria-label', 'Pairing token');
Object.assign(input.style, {
  width: '100%',
  boxSizing: 'border-box',
  border: '1px solid #d1d5db',
  borderRadius: '6px',
  padding: '8px',
  font: 'inherit',
});

const actions = document.createElement('div');
Object.assign(actions.style, {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: '8px',
});

const saveButton = document.createElement('button');
saveButton.type = 'button';
saveButton.textContent = '保存并测试';

const clearButton = document.createElement('button');
clearButton.type = 'button';
clearButton.textContent = '清除';

for (const button of [saveButton, clearButton]) {
  Object.assign(button.style, {
    minHeight: '32px',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    background: '#f9fafb',
    color: '#111827',
    cursor: 'pointer',
    font: 'inherit',
  });
}

const status = document.createElement('output');
Object.assign(status.style, {
  minHeight: '18px',
  color: '#374151',
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

async function loadSavedToken() {
  const stored = await chrome.storage.session.get('cliBridgePairingToken');
  if (typeof stored?.cliBridgePairingToken === 'string' && stored.cliBridgePairingToken.length > 0) {
    input.placeholder = '已配对；输入新口令可替换';
    renderStatus('当前会话已配对，可在 ChatGPT 页面刷新连接。', 'success');
  } else {
    renderStatus('未配对。');
  }
}

saveButton.addEventListener('click', async () => {
  const token = input.value.trim();
  if (token.length === 0) {
    renderStatus('请输入配对口令。', 'failed');
    return;
  }

  renderStatus('正在测试连接...');
  const result = await proxyHealth(token);
  if (!result.ok) {
    renderStatus(result.status === 401 || result.status === 403
      ? '口令无效，请重新输入。'
      : '无法连接本地服务，请确认 local server 已启动。', 'failed');
    return;
  }

  await chrome.storage.session.set({ cliBridgePairingToken: token });
  input.value = '';
  input.placeholder = '已配对；输入新口令可替换';
  renderStatus('当前会话已配对并通过连接测试。', 'success');
});

clearButton.addEventListener('click', async () => {
  await chrome.storage.session.remove('cliBridgePairingToken');
  input.value = '';
  input.placeholder = 'pairing token';
  renderStatus('已清除配对口令。');
});

actions.append(saveButton, clearButton);
root.append(title, help, input, actions, status);
document.body.append(root);

void loadSavedToken();
