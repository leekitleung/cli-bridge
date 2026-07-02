# Extension Connection UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reposition the browser extension UI as a minimal connection/status surface for ChatGPT Web as planner/source, with execution control and WorkBuddy state kept in `/console/project`.

**Architecture:** Keep the extension as a connector, not a control plane. The popup becomes a connection health panel with an Open Console shortcut and manual-token fallback. The ChatGPT page panel defaults to planner/source connection status; existing legacy relay tools move behind an explicit collapsed advanced section so current tests and manual rescue paths are not removed abruptly.

**Tech Stack:** Chrome MV3 extension, TypeScript, DOM-only popup/page UI, Node native tests, esbuild extension build.

---

## Scope

Current state:

- `apps/extension/src/popup/index.ts` is primarily a pairing token form.
- `apps/extension/src/ui/bridge-panel.tsx` is a large ChatGPT-page operation panel with fill/preview/return/automation controls.
- WorkBuddy execution status now belongs to `/console/project`, not the browser extension.

Target state:

- Popup answers: “Is Local Bridge connected? Is this browser session paired? Can I open Project Console?”
- ChatGPT page panel answers: “Is this page connected as planner/source?”
- Pairing configuration, route selection, WorkBuddy task/log visibility, accept/reject, dispatch, execution status remain in `/console/project`.

## Non-Goals

- No WorkBuddy status in extension UI.
- No source/target pairing selector in extension UI.
- No executor logs in extension UI.
- No accept/reject/dispatch/confirm controls in extension UI.
- No new generic `/shell`, `/exec`, `/run`, Git, PR, or workspace mutation route.
- No token persistence in `chrome.storage.local`, URL, DOM, or localStorage.

## File Map

- Create `docs/planning/ADR-0033-extension-connection-ui.md`
  - Records extension UI boundary change.
- Modify `apps/extension/src/popup/index.ts`
  - Convert popup to connection status + Open Console + Clear Session + advanced manual token fallback.
- Modify `apps/extension/src/chrome.d.ts`
  - Add minimal `chrome.tabs.create` typing if missing.
- Modify `apps/extension/src/ui/bridge-panel.tsx`
  - Make ChatGPT panel default to source connection status and Open Console.
  - Move old relay controls into collapsed “Legacy relay tools”.
- Modify `apps/extension/src/ui/state.ts`
  - Add planner/source status copy if needed.
- Modify `tests/extension-loop-panel.test.mjs`
  - Update source/UI assertions for connection-first page panel.
- Modify `tests/extension-build.test.mjs`
  - Update build assertions away from old primary fill/preview/return labels.
- Modify `tests/background-proxy.test.mjs`
  - Assert no new proxy authority is added.
- Modify `tests/console-unified-ui.test.mjs`
  - Keep popup theme coverage while checking new button labels.

---

## Task 0: ADR-0033 Boundary

**Files:**
- Create: `docs/planning/ADR-0033-extension-connection-ui.md`

- [ ] **Step 1: Write ADR**

Create `docs/planning/ADR-0033-extension-connection-ui.md`:

```markdown
# ADR-0033: Extension Connection UI Boundary

Status: Proposed

Date: 2026-07-02

## Context

ADR-0031 made conversation planner-gated. ADR-0032 added a local WorkBuddy
execution connector. After these changes, the browser extension should not act
as the execution control plane. Its role is to connect ChatGPT Web as a planner
or source surface and provide connection diagnostics.

## Decision

The extension UI is reduced to connection status:

- Popup: Local Bridge health, browser session pairing status, Open Project
  Console, Clear Session, and advanced manual-token fallback.
- ChatGPT page panel: planner/source connection status and Open Project Console.
- Existing manual relay utilities may remain only as collapsed legacy tools.

The extension must not expose WorkBuddy execution state, executor logs,
source/target pairing selection, accept/reject, dispatch, or route controls.

## Security Boundary

- No token in URL, DOM, localStorage, or chrome.storage.local.
- No WorkBuddy inbox/result/log route in extension proxy allowlist.
- No executor authority in content script or popup.
- No auto-send boundary expansion.

## Consequences

Users use `/console/project` as the main UI. The extension becomes a small
diagnostic and connector surface.
```

- [ ] **Step 2: Commit ADR proposal**

Run:

```bash
git add docs/planning/ADR-0033-extension-connection-ui.md
git commit -m "docs: propose extension connection ui boundary"
```

Expected: ADR proposal commit.

- [ ] **Step 3: Review gate**

Stop here until ADR-0033 is explicitly accepted.

---

## Task 1: Popup Connection Panel

**Files:**
- Modify: `apps/extension/src/popup/index.ts`
- Modify: `apps/extension/src/chrome.d.ts`
- Modify: `tests/extension-loop-panel.test.mjs`
- Modify: `tests/console-unified-ui.test.mjs`

- [ ] **Step 1: Add failing source assertions**

Add to `tests/extension-loop-panel.test.mjs`:

```js
test('extension popup is connection-first with manual token fallback only', async () => {
  const source = await readFile(resolve(root, 'apps/extension/src/popup/index.ts'), 'utf8');

  assert.match(source, /Local Bridge/);
  assert.match(source, /Open Project Console/);
  assert.match(source, /Clear Session/);
  assert.match(source, /Manual token fallback/);
  assert.match(source, /chrome\.tabs\.create/);
  assert.equal(source.includes('chrome.storage.local'), false);
  assert.equal(source.includes('WorkBuddy'), false);
  assert.equal(source.includes('dispatch'), false);
});
```

Update `tests/console-unified-ui.test.mjs` so popup theme assertions still read
`apps/extension/src/popup/index.ts`, and add:

```js
assert.match(popup, /Open Project Console/);
assert.match(popup, /Manual token fallback/);
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
node --experimental-strip-types --test tests/extension-loop-panel.test.mjs tests/console-unified-ui.test.mjs
```

Expected: fail because popup still centers on `保存并测试` and has no Open Console button.

- [ ] **Step 3: Add minimal Chrome tabs typing**

If `apps/extension/src/chrome.d.ts` lacks `tabs.create`, add:

```ts
declare namespace chrome {
  namespace tabs {
    function create(options: { url: string }): Promise<unknown>;
  }
}
```

If the file already declares `chrome.tabs`, extend the existing declaration instead of duplicating it.

- [ ] **Step 4: Rewrite popup content structure**

In `apps/extension/src/popup/index.ts`, keep the existing theme and `proxyHealth()` helper. Replace the user-facing DOM copy and control layout with:

```ts
const title = document.createElement('h1');
title.textContent = 'Local Bridge';

const help = document.createElement('p');
help.textContent = 'ChatGPT Web connector status. Use Project Console for pairing, routing, and WorkBuddy execution.';

const connectionLine = document.createElement('div');
connectionLine.textContent = 'Checking local session...';
connectionLine.setAttribute('data-cli-bridge-popup-connection', 'true');

const openConsoleButton = document.createElement('button');
openConsoleButton.type = 'button';
openConsoleButton.textContent = 'Open Project Console';

const refreshButton = document.createElement('button');
refreshButton.type = 'button';
refreshButton.textContent = 'Refresh Status';

const clearButton = document.createElement('button');
clearButton.type = 'button';
clearButton.textContent = 'Clear Session';

const fallback = document.createElement('details');
const fallbackSummary = document.createElement('summary');
fallbackSummary.textContent = 'Manual token fallback';
fallback.append(fallbackSummary, input, saveButton);
```

Keep the existing password input and save/test button, but move them inside `fallback`.

Add:

```ts
openConsoleButton.addEventListener('click', async () => {
  await chrome.tabs.create({ url: 'http://127.0.0.1:31337/console/project' });
});
```

Change status copy:

```ts
async function loadSavedToken() {
  const stored = await chrome.storage.session.get('cliBridgePairingToken');
  if (typeof stored?.cliBridgePairingToken === 'string' && stored.cliBridgePairingToken.length > 0) {
    connectionLine.textContent = 'Browser session paired';
    renderStatus('Connected session available for ChatGPT Web.', 'success');
  } else {
    connectionLine.textContent = 'Browser session not paired';
    renderStatus('Open Project Console to pair automatically, or use manual fallback.');
  }
}
```

Append order:

```ts
actions.append(openConsoleButton, refreshButton, clearButton);
root.append(title, help, connectionLine, actions, fallback, status);
```

- [ ] **Step 5: Verify popup tests**

Run:

```bash
node --experimental-strip-types --test tests/extension-loop-panel.test.mjs tests/console-unified-ui.test.mjs
```

Expected: pass.

- [ ] **Step 6: Commit**

Run:

```bash
git add apps/extension/src/popup/index.ts apps/extension/src/chrome.d.ts tests/extension-loop-panel.test.mjs tests/console-unified-ui.test.mjs
git commit -m "feat: make extension popup connection-first"
```

---

## Task 2: ChatGPT Page Panel Default Surface

**Files:**
- Modify: `apps/extension/src/ui/bridge-panel.tsx`
- Modify: `apps/extension/src/ui/state.ts`
- Modify: `tests/extension-loop-panel.test.mjs`
- Modify: `tests/extension-build.test.mjs`
- Modify: `tests/chatgpt-dom.test.mjs`

- [ ] **Step 1: Add failing assertions for default panel**

In `tests/extension-loop-panel.test.mjs`, replace the old four-stage primary UI assertion with:

```js
test('Bridge Panel defaults to planner source connection UI', async () => {
  const source = await readFile(resolve(root, 'apps/extension/src/ui/bridge-panel.tsx'), 'utf8');

  assert.match(source, /ChatGPT Web source/);
  assert.match(source, /Open Project Console/);
  assert.match(source, /Legacy relay tools/);
  assert.match(source, /data-cli-bridge-source-status/);
  assert.equal(source.includes('WorkBuddy'), false);
  assert.equal(source.includes('/bridge/endpoints/workbuddy'), false);
  assert.equal(source.includes('/bridge/endpoints/:id/results'), false);
});
```

In `tests/extension-build.test.mjs`, change build assertions so the built content script must include:

```js
assert.equal(contentSource.includes('ChatGPT Web source'), true);
assert.equal(contentSource.includes('Open Project Console'), true);
assert.equal(contentSource.includes('Legacy relay tools'), true);
```

Do not require `填入`, `预览回传`, or `确认回传` as top-level built-script labels.

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
node --experimental-strip-types --test tests/extension-loop-panel.test.mjs tests/extension-build.test.mjs tests/chatgpt-dom.test.mjs
```

Expected: fail because current panel still advertises the four-stage relay as primary.

- [ ] **Step 3: Add source status element and Open Console button**

In `apps/extension/src/ui/bridge-panel.tsx`, change:

```ts
title.textContent = 'CLI BRIDGE';
```

to:

```ts
title.textContent = 'ChatGPT Web source';
```

Replace:

```ts
scope.textContent = '1 连接 · 2 发送至 ChatGPT · 3 选择并预览 · 4 确认回传';
```

with:

```ts
scope.textContent = 'Connected to Local Bridge as planner/source. Use Project Console for routing and execution.';
scope.setAttribute('data-cli-bridge-source-status', 'true');
```

Create:

```ts
const openConsoleButton = root.createElement('button');
openConsoleButton.type = 'button';
openConsoleButton.textContent = 'Open Project Console';
```

Add it to the styled button loop.

Add click handler:

```ts
openConsoleButton.addEventListener('click', () => {
  window.open('http://127.0.0.1:31337/console/project', '_blank', 'noopener,noreferrer');
});
```

- [ ] **Step 4: Move legacy controls into collapsed details**

Create:

```ts
const legacyTools = root.createElement('details');
const legacySummary = root.createElement('summary');
legacySummary.textContent = 'Legacy relay tools';
legacyTools.append(legacySummary);

const legacyBody = root.createElement('div');
Object.assign(legacyBody.style, { display: 'grid', gap: '8px', marginTop: '8px' });
legacyBody.append(
  input,
  fillButton,
  returnActions,
  loopStatus,
  relayStatus,
  automationStatus,
  automationActions,
  status,
  preview,
);
legacyTools.append(legacyBody);
```

Change `panelBody.append(...)` to:

```ts
panelBody.append(
  scope,
  connectionStatus,
  connectionActions,
  openConsoleButton,
  legacyTools,
);
```

Keep the existing handlers intact. This intentionally preserves current relay mechanics while removing them from the default UI.

- [ ] **Step 5: Verify page panel tests**

Run:

```bash
node --experimental-strip-types --test tests/extension-loop-panel.test.mjs tests/extension-build.test.mjs tests/chatgpt-dom.test.mjs
```

Expected: pass.

- [ ] **Step 6: Commit**

Run:

```bash
git add apps/extension/src/ui/bridge-panel.tsx apps/extension/src/ui/state.ts tests/extension-loop-panel.test.mjs tests/extension-build.test.mjs tests/chatgpt-dom.test.mjs
git commit -m "feat: make chatgpt extension panel connection-first"
```

---

## Task 3: Proxy Authority Regression

**Files:**
- Modify: `tests/background-proxy.test.mjs`
- No source modification expected unless tests reveal an existing mismatch.

- [ ] **Step 1: Add authority regression test**

Add to `tests/background-proxy.test.mjs`:

```js
test('extension proxy does not expose WorkBuddy executor routes', async () => {
  const { calls, fetchImpl } = stubFetch(() => jsonResponse(200, {}));

  const inbox = await handleProxyFetch({
    path: '/bridge/endpoints/workbuddy/inbox/next',
    method: 'GET',
    token: 'tok',
  }, fetchImpl);
  const result = await handleProxyFetch({
    path: '/bridge/endpoints/workbuddy/results',
    method: 'POST',
    token: 'tok',
    body: { taskId: 'task-1', ok: true },
  }, fetchImpl);
  const log = await handleProxyFetch({
    path: '/bridge/endpoints/workbuddy/log',
    method: 'POST',
    token: 'tok',
    body: { taskId: 'task-1', message: 'x' },
  }, fetchImpl);

  assert.equal(inbox.error, 'invalid-path');
  assert.equal(result.error, 'invalid-path');
  assert.equal(log.error, 'invalid-path');
  assert.equal(calls.length, 0);
});
```

- [ ] **Step 2: Run test**

Run:

```bash
node --experimental-strip-types --test tests/background-proxy.test.mjs
```

Expected: pass. If it fails, remove WorkBuddy executor routes from `isAllowedProxyRoute()`.

- [ ] **Step 3: Commit**

Run:

```bash
git add tests/background-proxy.test.mjs apps/extension/src/background/index.ts
git commit -m "test: lock extension proxy away from workbuddy executor routes"
```

---

## Task 4: Build and Browser Acceptance

**Files:**
- Modify: `tests/extension-build.test.mjs`
- No source modification expected unless build assertions expose stale text.

- [ ] **Step 1: Build extension**

Run:

```bash
npm run build-extension
```

Expected: `apps/extension/dist/manifest.json`, popup, background, content, and console auto-pair scripts generated.

- [ ] **Step 2: Run focused extension tests**

Run:

```bash
node --experimental-strip-types --test \
  tests/extension-build.test.mjs \
  tests/extension-loop-panel.test.mjs \
  tests/background-proxy.test.mjs \
  tests/extension-console-auto-pair.test.mjs \
  tests/extension-control.test.mjs \
  tests/chatgpt-dom.test.mjs \
  tests/content-safety.test.mjs
```

Expected: pass.

- [ ] **Step 3: Manual browser acceptance**

Use a built extension in Chrome or the existing browser automation harness.

Verify:

1. Popup shows `Local Bridge`, `Open Project Console`, `Refresh Status`, `Clear Session`.
2. Popup does not show WorkBuddy status or route controls.
3. Popup manual token field is hidden under `Manual token fallback`.
4. ChatGPT page panel title is `ChatGPT Web source`.
5. ChatGPT page panel has `Open Project Console`.
6. ChatGPT page panel does not show WorkBuddy status, route selection, accept/reject, dispatch, or executor logs.
7. Legacy relay tools are collapsed by default.
8. Clearing session still removes `cliBridgePairingToken`.

- [ ] **Step 4: Run full gates**

Run:

```bash
npm run typecheck
npm run lint
npm test
git diff --check
```

Expected: all pass.

- [ ] **Step 5: Commit final acceptance updates**

Run:

```bash
git add tests/extension-build.test.mjs
git commit -m "test: verify extension connection ui build"
```

If no files changed in Task 4, skip this commit.

---

## Acceptance Criteria

- Extension popup is connection-first, not pairing-first.
- Popup can open `/console/project`.
- Manual token entry remains available only as a fallback.
- ChatGPT page panel is connection/source-first.
- Old relay controls are not primary UI.
- Extension UI does not expose WorkBuddy execution state.
- Extension proxy cannot call WorkBuddy executor routes.
- No token is stored in `chrome.storage.local`, localStorage, DOM, URL, or build artifacts.
- Full test suite passes.

## Recommended Execution Mode

Use **Subagent-Driven** execution:

1. Task 0: ADR proposal and review.
2. Task 1: popup UI.
3. Task 2: ChatGPT page panel.
4. Task 3: proxy authority regression.
5. Task 4: build/browser acceptance.

Return to REVIEW after each task because this touches user-facing UI and extension security boundaries.

