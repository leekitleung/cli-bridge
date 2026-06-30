# Local Console Auto-Pairing And Extension Session Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove manual pairing-token entry for the local Project Console while preserving bridge authorization and intentionally allowing the extension to obtain the same local automation session after the Console is opened.

**Architecture:** Keep `/bridge/*` authorization mandatory, but add a loopback-only, process-lifetime local automation session separate from the printed pairing token. The Console receives an HttpOnly same-origin session cookie; the extension receives a separate session token only through a one-time Console claim nonce and stores it in `chrome.storage.session`.

**Tech Stack:** TypeScript local server, self-contained `/console/project` HTML, MV3 extension background/content scripts, existing origin/pairing gates, Node test runner with jsdom.

---

## Decision Summary

This plan is not "remove auth". It removes one manual input step for local operator UX.

Accepted risk:

- Opening local `/console/project` may authorize the installed CLI Bridge extension for the same local server process.
- If ChatGPT Web automation is enabled by ADR-0023 / later Web Auto stages, the extension may use this session for existing controlled auto-send / auto-return routes.

Still forbidden:

- No public unauthenticated `/bridge/*`.
- No token in URL query or fragment.
- No raw pairing token in HTML, localStorage, server logs, audit records, screenshots, or docs.
- No non-loopback browser origin auto-pairing.
- No arbitrary shell, `/exec`, `/run`, generic command, Git, PR, or workspace mutation bypass.
- No route-level permission bypass. Existing controlled route authorization still applies.

## Product Behavior

Current behavior:

1. Server prints a random pairing token.
2. Operator copies it into `/console/project`.
3. Console calls `/bridge/*` with `x-cli-bridge-pairing-token`.
4. Extension popup separately stores the token in `chrome.storage.session`.

Target behavior:

1. Server still creates and prints the random pairing token for manual fallback.
2. `GET /console/project` on `127.0.0.1` or `[::1]` creates a local automation session.
3. Server sets an HttpOnly SameSite cookie for Console requests.
4. Console shows `Local console and extension paired` after `/health/private` succeeds through the cookie path.
5. The Console page includes a short-lived, one-time extension claim nonce, not the raw token.
6. A new extension content script runs only on `http://127.0.0.1:31337/console/project` and sends the nonce to the extension background.
7. The background exchanges the nonce with the local server and stores the returned extension session token in `chrome.storage.session`.
8. ChatGPT Web content scripts continue to use the background proxy and existing session storage.
9. Revoke clears the server-side local session, the Console cookie, and the extension session token.

## Scope Fence

In scope:

- Loopback-only Console auto-pairing.
- Explicit accepted-risk path for the extension to obtain a local automation session from the Console claim nonce.
- Session revocation from Console.
- Tests proving no URL/localStorage/visible-DOM token leakage.
- Tests proving extension can claim a session only with a valid one-time nonce.

Out of scope:

- Stable or user-configured long-lived token.
- Auto-open launcher changes.
- New ChatGPT DOM auto-send logic.
- Any new general execution endpoint.
- Any route permission expansion beyond the existing controlled bridge APIs.

## File Structure

Create:

- `apps/local-server/src/security/local-auto-pair-session.ts`
  - Owns process-lifetime local sessions, one-time extension claim nonces, expiry, and revocation.

- `apps/extension/src/content/console-auto-pair.ts`
  - Runs only on the local Console page.
  - Reads a one-time nonce from the Console bootstrap element.
  - Sends it to the extension background.

- `tests/local-auto-pair-session.test.mjs`
  - Store and route-level tests for session cookie, claim nonce, expiry, replay, and revoke.

- `tests/extension-console-auto-pair.test.mjs`
  - Extension tests for the localhost content script and background claim handling.

Modify:

- `apps/local-server/src/server.ts`
  - Create the local session store.
  - Set the Console session cookie on `GET /console/project`.
  - Accept Console local-session cookies and extension local-session tokens in `checkAuth()`.
  - Add narrow claim/revoke routes outside generic bridge execution.

- `apps/local-server/src/routes/project-console.ts`
  - Render auto-pair status and the one-time extension claim nonce.
  - Keep manual token entry as fallback.
  - Add Revoke local session action.

- `apps/extension/manifest.json`
  - Add a localhost Console content script match for `http://127.0.0.1:31337/console/project`.

- `apps/extension/src/background/index.ts`
  - Accept a `cli-bridge-claim-local-session` message.
  - Exchange a nonce for an extension session token.
  - Store the token in `chrome.storage.session`.
  - Clear it on revoke.

- `apps/extension/src/content/bridge-client.ts`
  - Treat `cliBridgePairingToken` as an opaque bridge credential. It may be a printed pairing token or an extension local-session token.

- `tests/project-console-behavior.test.mjs`
  - Add Console auto-pair UI/token-discipline tests.

- `tests/background-proxy.test.mjs`
  - Add background claim and storage tests.

Do not modify:

- ChatGPT DOM submit selectors or auto-send behavior.
- Command runner, Git, workspace apply, or arbitrary execution routes.

---

## Security Model

Credential types:

```ts
type BridgeCredentialKind = 'printed-pairing-token' | 'console-local-session' | 'extension-local-session';
```

Server accepts:

- `x-cli-bridge-pairing-token: <printed pairing token>` from existing manual clients.
- Cookie `cli_bridge_console_session=<console session token>` only for same-origin Console requests.
- `x-cli-bridge-pairing-token: <extension local-session token>` from the extension background proxy after nonce claim.

Server rejects:

- Console cookies from non-loopback origins.
- Extension session tokens that are expired, revoked, unknown, or used after server restart.
- Claim nonce replay.
- Claim nonce requests from non-loopback origins.

Token discipline:

- Printed pairing token is never embedded in Console HTML.
- Console session cookie is HttpOnly and SameSite.
- Extension session token is returned only to the extension background after one-time claim.
- Claim nonce may be present in Console HTML, but it is high entropy, short TTL, single use, and not accepted as a bridge credential.

## Task 0: ADR/RP Boundary Record

**Files:**
- Create: `docs/planning/ADR-0025-local-console-auto-pairing-extension-session.md`
- Modify: `docs/superpowers/plans/2026-06-30-local-console-auto-pairing-extension-session.md` only if review changes the plan

- [ ] **Step 1: Create ADR with explicit accepted risk**

Create `docs/planning/ADR-0025-local-console-auto-pairing-extension-session.md`:

```md
# ADR-0025: Local Console Auto-Pairing And Extension Session

Status: Proposed

Date: 2026-06-30

## Context

Manual pairing-token entry in the Project Console adds operator friction. The
operator wants to reduce manual steps, not remove the bridge security boundary.
ChatGPT Web / extension automation may already support automatic send or return
under ADR-0023 and later Web Auto stages.

## Decision

CLI Bridge may auto-pair the local Project Console on loopback and may allow the
installed CLI Bridge extension to claim a local automation session after the
Console is opened.

This is an explicit accepted risk: opening local Console can authorize the
extension for the same local server process. That authorization is still scoped
to existing controlled bridge routes and does not create arbitrary execution
authority.

## Constraints

- Loopback only: `127.0.0.1` and `[::1]`.
- Process lifetime only: server restart invalidates sessions.
- No token in URL, localStorage, config, logs, or visible DOM.
- Console auth uses an HttpOnly same-origin cookie.
- Extension auth uses a separate one-time nonce claim and session token.
- Revoke clears server session and extension storage.
- `/bridge/*` remains authenticated.
- No new shell, run, exec, Git, PR, or workspace mutation bypass.

## Acceptance

This ADR requires explicit human acceptance before EX implementation.
```

- [ ] **Step 2: Review decision status**

Run:

```bash
rg -n "Status: Proposed|accepted risk|Loopback only|No token in URL" docs/planning/ADR-0025-local-console-auto-pairing-extension-session.md
```

Expected: all required boundary phrases are present.

- [ ] **Step 3: Commit ADR only**

```bash
git add docs/planning/ADR-0025-local-console-auto-pairing-extension-session.md
git commit -m "docs: propose local console auto pairing boundary"
```

## Task 1: Local Auto-Pair Session Store

**Files:**
- Create: `apps/local-server/src/security/local-auto-pair-session.ts`
- Test: `tests/local-auto-pair-session.test.mjs`

- [ ] **Step 1: Write failing store tests**

Create `tests/local-auto-pair-session.test.mjs`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createLocalAutoPairSessionStore,
} from '../apps/local-server/src/security/local-auto-pair-session.ts';

test('local auto-pair store creates console session and one-time extension claim', () => {
  const store = createLocalAutoPairSessionStore({ now: () => 1000 });
  const session = store.createConsoleSession();

  assert.equal(typeof session.consoleSessionToken, 'string');
  assert.equal(typeof session.extensionClaimNonce, 'string');
  assert.notEqual(session.consoleSessionToken, session.extensionClaimNonce);
  assert.equal(store.verifyConsoleSession(session.consoleSessionToken), true);

  const claimed = store.claimExtensionSession(session.extensionClaimNonce);
  assert.equal(claimed.ok, true);
  assert.equal(typeof claimed.extensionSessionToken, 'string');
  assert.equal(store.verifyExtensionSession(claimed.extensionSessionToken), true);

  const replay = store.claimExtensionSession(session.extensionClaimNonce);
  assert.equal(replay.ok, false);
  assert.match(replay.message, /invalid or expired/);
});

test('local auto-pair store expires and revokes sessions', () => {
  let now = 1000;
  const store = createLocalAutoPairSessionStore({
    now: () => now,
    sessionTtlMs: 100,
    claimTtlMs: 50,
  });
  const session = store.createConsoleSession();
  now = 1060;
  assert.equal(store.claimExtensionSession(session.extensionClaimNonce).ok, false);

  now = 1001;
  const fresh = store.createConsoleSession();
  const claimed = store.claimExtensionSession(fresh.extensionClaimNonce);
  assert.equal(claimed.ok, true);
  store.revokeConsoleSession(fresh.consoleSessionToken);
  assert.equal(store.verifyConsoleSession(fresh.consoleSessionToken), false);
  assert.equal(store.verifyExtensionSession(claimed.extensionSessionToken), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node --experimental-strip-types --test tests/local-auto-pair-session.test.mjs
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement store**

Create `apps/local-server/src/security/local-auto-pair-session.ts`:

```ts
import { randomBytes } from 'node:crypto';

export interface LocalAutoPairSessionStoreOptions {
  now?: () => number;
  sessionTtlMs?: number;
  claimTtlMs?: number;
}

export interface ConsoleSessionBootstrap {
  consoleSessionToken: string;
  extensionClaimNonce: string;
  expiresAt: number;
  claimExpiresAt: number;
}

interface SessionRecord extends ConsoleSessionBootstrap {
  extensionSessionToken?: string;
  revokedAt?: number;
  claimUsedAt?: number;
}

function token(): string {
  return randomBytes(32).toString('hex');
}

export function createLocalAutoPairSessionStore(options: LocalAutoPairSessionStoreOptions = {}) {
  const now = options.now ?? (() => Date.now());
  const sessionTtlMs = options.sessionTtlMs ?? 8 * 60 * 60 * 1000;
  const claimTtlMs = options.claimTtlMs ?? 2 * 60 * 1000;
  const byConsole = new Map<string, SessionRecord>();
  const byClaim = new Map<string, SessionRecord>();
  const byExtension = new Map<string, SessionRecord>();

  function active(record: SessionRecord | undefined): record is SessionRecord {
    return !!record && !record.revokedAt && record.expiresAt > now();
  }

  return {
    createConsoleSession(): ConsoleSessionBootstrap {
      const record: SessionRecord = {
        consoleSessionToken: token(),
        extensionClaimNonce: token(),
        expiresAt: now() + sessionTtlMs,
        claimExpiresAt: now() + claimTtlMs,
      };
      byConsole.set(record.consoleSessionToken, record);
      byClaim.set(record.extensionClaimNonce, record);
      return {
        consoleSessionToken: record.consoleSessionToken,
        extensionClaimNonce: record.extensionClaimNonce,
        expiresAt: record.expiresAt,
        claimExpiresAt: record.claimExpiresAt,
      };
    },
    verifyConsoleSession(consoleSessionToken: string): boolean {
      return active(byConsole.get(consoleSessionToken));
    },
    claimExtensionSession(extensionClaimNonce: string): { ok: true; extensionSessionToken: string } | { ok: false; message: string } {
      const record = byClaim.get(extensionClaimNonce);
      if (!active(record) || record.claimUsedAt || record.claimExpiresAt <= now()) {
        return { ok: false, message: 'extension claim nonce invalid or expired' };
      }
      record.claimUsedAt = now();
      record.extensionSessionToken = token();
      byExtension.set(record.extensionSessionToken, record);
      return { ok: true, extensionSessionToken: record.extensionSessionToken };
    },
    verifyExtensionSession(extensionSessionToken: string): boolean {
      return active(byExtension.get(extensionSessionToken));
    },
    revokeConsoleSession(consoleSessionToken: string): boolean {
      const record = byConsole.get(consoleSessionToken);
      if (!record) return false;
      record.revokedAt = now();
      return true;
    },
  };
}
```

- [ ] **Step 4: Run store tests**

```bash
node --experimental-strip-types --test tests/local-auto-pair-session.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/local-server/src/security/local-auto-pair-session.ts tests/local-auto-pair-session.test.mjs
git commit -m "feat: add local auto pair session store"
```

## Task 2: Server Auto-Pair Cookie, Claim, And Revoke Routes

**Files:**
- Modify: `apps/local-server/src/server.ts`
- Modify: `apps/local-server/src/routes/project-console.ts`
- Test: `tests/local-launcher.test.mjs`

- [ ] **Step 1: Write failing server tests**

Append to `tests/local-launcher.test.mjs`:

```js
test('Project Console auto-pairs with HttpOnly cookie and no token in URL', async () => {
  const handle = await startLocalServer(0);
  try {
    const consoleRes = await fetch(`${handle.url}/console/project`);
    assert.equal(consoleRes.status, 200);
    const html = await consoleRes.text();
    const cookie = consoleRes.headers.get('set-cookie') || '';
    assert.match(cookie, /cli_bridge_console_session=/);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);
    assert.equal(html.includes(handle.pairingToken), false);
    assert.equal(consoleRes.url.includes(handle.pairingToken), false);

    const privateRes = await fetch(`${handle.url}/health/private`, {
      headers: {
        cookie,
        origin: handle.url,
      },
    });
    assert.equal(privateRes.status, 200);
  } finally {
    await new Promise(resolve => handle.server.close(resolve));
  }
});

test('extension claim nonce can be used once to obtain extension session token', async () => {
  const handle = await startLocalServer(0);
  try {
    const consoleRes = await fetch(`${handle.url}/console/project`);
    const html = await consoleRes.text();
    const nonce = html.match(/data-extension-claim-nonce="([^"]+)"/)?.[1];
    assert.ok(nonce, 'expected extension claim nonce');

    const claim = await fetch(`${handle.url}/bridge/local-auto-pair/extension-claim`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: handle.url },
      body: JSON.stringify({ nonce }),
    });
    assert.equal(claim.status, 200);
    const payload = await claim.json();
    assert.equal(typeof payload.extensionSessionToken, 'string');
    assert.equal(payload.extensionSessionToken.includes(handle.pairingToken), false);

    const replay = await fetch(`${handle.url}/bridge/local-auto-pair/extension-claim`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: handle.url },
      body: JSON.stringify({ nonce }),
    });
    assert.equal(replay.status, 409);

    const health = await fetch(`${handle.url}/health/private`, {
      headers: {
        origin: 'chrome-extension://cli-bridge',
        'x-cli-bridge-pairing-token': payload.extensionSessionToken,
      },
    });
    assert.equal(health.status, 200);
  } finally {
    await new Promise(resolve => handle.server.close(resolve));
  }
});
```

- [ ] **Step 2: Run tests to verify failure**

```bash
node --experimental-strip-types --test tests/local-launcher.test.mjs
```

Expected: FAIL because no Console cookie or claim route exists.

- [ ] **Step 3: Implement server route changes**

Implementation requirements:

- In `startLocalServer()`, instantiate `createLocalAutoPairSessionStore()`.
- On `GET /console/project`, create a console session and set:
  - `Set-Cookie: cli_bridge_console_session=<token>; HttpOnly; SameSite=Strict; Path=/`
  - Use `Secure` only when the server is served over HTTPS; loopback HTTP must still work.
- Pass only `extensionClaimNonce` into `renderProjectConsoleHtml({ extensionClaimNonce })`.
- Add `POST /bridge/local-auto-pair/extension-claim`.
  - It is not a generic bridge route.
  - It requires allowed loopback origin.
  - It accepts `{ nonce }`.
  - It returns `{ extensionSessionToken, expiresAt }`.
  - It fails replay with `409`.
- Add `POST /bridge/local-auto-pair/revoke`.
  - It accepts the Console cookie or extension session token.
  - It revokes the owning local session.
  - It clears the Console cookie.
- Update `checkAuth()` so `/bridge/*` and `/health/private` accept:
  - existing printed pairing token header;
  - valid Console cookie from same-origin Console requests;
  - valid extension local-session token in the existing pairing header.

- [ ] **Step 4: Run server tests**

```bash
node --experimental-strip-types --test tests/local-launcher.test.mjs tests/local-auto-pair-session.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/local-server/src/server.ts apps/local-server/src/routes/project-console.ts tests/local-launcher.test.mjs
git commit -m "feat: auto pair local project console"
```

## Task 3: Console UI Status And Token Discipline

**Files:**
- Modify: `apps/local-server/src/routes/project-console.ts`
- Test: `tests/project-console-behavior.test.mjs`

- [ ] **Step 1: Write failing Console UI tests**

Append to `tests/project-console-behavior.test.mjs`:

```js
test('local auto-pair bootstrap does not expose raw token in URL, visible DOM, or localStorage', async () => {
  const html = renderProjectConsoleHtml({ extensionClaimNonce: 'claim-abc' });
  const storage = {};
  const dom = new JSDOM(html, {
    url: 'http://127.0.0.1:31337/console/project',
    runScripts: 'dangerously',
    resources: 'usable',
    beforeParse(win) {
      Object.defineProperty(win, 'localStorage', {
        value: {
          getItem: key => storage[key] ?? null,
          setItem: (key, value) => { storage[key] = value; },
          removeItem: key => { delete storage[key]; },
        },
        configurable: true,
      });
      win.fetch = async (url, init = {}) => {
        const path = new URL(String(url)).pathname;
        if (path === '/health/private') {
          return { ok: true, status: 200, json: async () => ({ ok: true }) };
        }
        return { ok: true, status: 200, json: async () => ({}) };
      };
    },
  });

  assert.equal(dom.window.location.href.includes('claim-abc'), false);
  assert.equal(dom.window.document.body.textContent.includes('claim-abc'), false);
  assert.equal(storage['cli-bridge-pairing-token'], undefined);
  assert.ok(dom.window.document.querySelector('[data-extension-claim-nonce="claim-abc"]'));
});

test('console revoke calls local auto-pair revoke without exposing token', async () => {
  const html = renderProjectConsoleHtml({ extensionClaimNonce: 'claim-abc' });
  const calls = [];
  const dom = new JSDOM(html, {
    url: 'http://127.0.0.1:31337/console/project',
    runScripts: 'dangerously',
    resources: 'usable',
    beforeParse(win) {
      Object.defineProperty(win, 'localStorage', {
        value: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
        configurable: true,
      });
      win.fetch = async (url, init = {}) => {
        const path = new URL(String(url)).pathname;
        calls.push({ path, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null });
        return { ok: true, status: 200, json: async () => ({ ok: true }) };
      };
    },
  });

  dom.window.document.getElementById('revoke-local-session').click();
  await waitFor(() => calls.some(c => c.path === '/bridge/local-auto-pair/revoke'));
  assert.equal(JSON.stringify(calls).includes('claim-abc'), false);
});
```

- [ ] **Step 2: Run tests to verify failure**

```bash
node --experimental-strip-types --test tests/project-console-behavior.test.mjs
```

Expected: FAIL because bootstrap/revoke UI does not exist.

- [ ] **Step 3: Implement Console UI changes**

Required UI behavior:

- `renderProjectConsoleHtml(options?: { extensionClaimNonce?: string })`.
- Add a hidden bootstrap node:

```html
<meta name="cli-bridge-extension-claim" data-extension-claim-nonce="...">
```

- Add visible status text:
  - `Local console paired`
  - `Extension claim available`
  - `Manual token fallback`
- Add button:

```html
<button type="button" id="revoke-local-session">Revoke local session</button>
```

- The page should call `/health/private` without a pairing header first; the cookie path should authenticate it.
- Manual token entry remains available when cookie auth fails.
- Revoke uses `POST /bridge/local-auto-pair/revoke`; after success, it clears in-memory token state and shows manual fallback.
- Do not store any pairing credential in `localStorage`.

- [ ] **Step 4: Run Console tests**

```bash
node --experimental-strip-types --test tests/project-console-behavior.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/local-server/src/routes/project-console.ts tests/project-console-behavior.test.mjs
git commit -m "feat: show local auto pair console state"
```

## Task 4: Extension Claim From Local Console

**Files:**
- Modify: `apps/extension/manifest.json`
- Create: `apps/extension/src/content/console-auto-pair.ts`
- Modify: `apps/extension/src/background/index.ts`
- Modify: `apps/extension/src/content/bridge-client.ts`
- Test: `tests/extension-console-auto-pair.test.mjs`
- Test: `tests/background-proxy.test.mjs`
- Test: `tests/extension-build.test.mjs`

- [ ] **Step 1: Write failing extension tests**

Create `tests/extension-console-auto-pair.test.mjs`:

```js
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('manifest injects console auto-pair script only on local Project Console', () => {
  const manifest = JSON.parse(readFileSync('apps/extension/manifest.json', 'utf8'));
  const script = manifest.content_scripts.find(s => (s.js || []).some(p => p.includes('console-auto-pair')));
  assert.ok(script, 'expected console auto-pair content script');
  assert.deepEqual(script.matches, ['http://127.0.0.1:31337/console/project']);
});

test('console auto-pair source uses only claim nonce and never localStorage', () => {
  const source = readFileSync('apps/extension/src/content/console-auto-pair.ts', 'utf8');
  assert.match(source, /data-extension-claim-nonce/);
  assert.match(source, /cli-bridge-claim-local-session/);
  assert.equal(source.includes('localStorage'), false);
  assert.equal(source.includes('cliBridgePairingToken'), false);
});
```

Append to `tests/background-proxy.test.mjs`:

```js
test('background exchanges console claim nonce and stores extension session token', async () => {
  const stored = {};
  global.chrome = {
    storage: {
      session: {
        set: async value => Object.assign(stored, value),
        get: async key => ({ [key]: stored[key] }),
      },
    },
    runtime: { onMessage: { addListener: () => {} } },
  };
  const { handleConsoleAutoPairClaim } = await import('../apps/extension/src/background/index.ts');
  const result = await handleConsoleAutoPairClaim('claim-abc', async (_url, init) => {
    assert.equal(init.method, 'POST');
    assert.equal(JSON.parse(init.body).nonce, 'claim-abc');
    return { ok: true, status: 200, json: async () => ({ extensionSessionToken: 'ext-session' }) };
  });
  assert.equal(result.ok, true);
  assert.equal(stored.cliBridgePairingToken, 'ext-session');
});
```

- [ ] **Step 2: Run tests to verify failure**

```bash
node --experimental-strip-types --test tests/extension-console-auto-pair.test.mjs tests/background-proxy.test.mjs
```

Expected: FAIL because files/functions are missing.

- [ ] **Step 3: Implement localhost content script**

Create `apps/extension/src/content/console-auto-pair.ts`:

```ts
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
```

- [ ] **Step 4: Implement background claim handler**

In `apps/extension/src/background/index.ts`, export:

```ts
export async function handleConsoleAutoPairClaim(
  nonce: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: boolean; status: number; error?: string }> {
  const response = await fetchImpl('http://127.0.0.1:31337/bridge/local-auto-pair/extension-claim', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ALLOWED_EXTENSION_ORIGIN },
    body: JSON.stringify({ nonce }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || typeof data?.extensionSessionToken !== 'string') {
    return { ok: false, status: response.status, error: data?.message || 'claim-failed' };
  }
  await chrome.storage.session.set({ cliBridgePairingToken: data.extensionSessionToken });
  return { ok: true, status: response.status };
}
```

Add message handling for:

```ts
{ type: 'cli-bridge-claim-local-session', nonce: string }
```

- [ ] **Step 5: Update manifest**

Add content script:

```json
{
  "matches": ["http://127.0.0.1:31337/console/project"],
  "js": ["dist/content/console-auto-pair.js"]
}
```

Ensure build wiring includes the new content entry. If the build script has explicit entry lists, add `apps/extension/src/content/console-auto-pair.ts`.

- [ ] **Step 6: Run extension tests and build**

```bash
node --experimental-strip-types --test tests/extension-console-auto-pair.test.mjs tests/background-proxy.test.mjs tests/extension-build.test.mjs
npm run build-extension
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/extension/manifest.json apps/extension/src/content/console-auto-pair.ts apps/extension/src/background/index.ts apps/extension/src/content/bridge-client.ts tests/extension-console-auto-pair.test.mjs tests/background-proxy.test.mjs tests/extension-build.test.mjs
git commit -m "feat: let extension claim local console session"
```

## Task 5: Revoke And Safety Regression Coverage

**Files:**
- Modify: `apps/local-server/src/server.ts`
- Modify: `apps/extension/src/background/index.ts`
- Modify: `apps/extension/src/content/bridge-client.ts`
- Test: `tests/local-auto-pair-session.test.mjs`
- Test: `tests/background-proxy.test.mjs`
- Test: `tests/project-console-behavior.test.mjs`

- [ ] **Step 1: Add revoke regression tests**

Add tests covering:

```js
test('local auto-pair revoke invalidates console and extension credentials', async () => {
  // Start server.
  // GET /console/project.
  // Claim extension session.
  // POST /bridge/local-auto-pair/revoke with console cookie.
  // Assert /health/private fails with old console cookie.
  // Assert /health/private fails with old extension session token.
});
```

Add source scan tests:

```js
test('local auto-pairing does not add URL token parsing or localStorage token storage', () => {
  const consoleSource = readFileSync('apps/local-server/src/routes/project-console.ts', 'utf8');
  assert.equal(consoleSource.includes('location.hash'), false);
  assert.equal(consoleSource.includes('URLSearchParams(location.search)'), false);
  assert.equal(consoleSource.includes('cli-bridge-pairing-token'), false);
});
```

- [ ] **Step 2: Run tests to verify failure**

```bash
node --experimental-strip-types --test tests/local-auto-pair-session.test.mjs tests/background-proxy.test.mjs tests/project-console-behavior.test.mjs
```

Expected: FAIL until revoke path is complete.

- [ ] **Step 3: Implement revoke end-to-end**

Requirements:

- Server revoke invalidates both Console and extension tokens for one local session.
- Revoke response clears `cli_bridge_console_session`.
- Background handles `cli-bridge-clear-local-session` by removing `cliBridgePairingToken`.
- Console revoke sends both local server revoke and extension clear message when possible.
- Manual token fallback remains available after revoke.

- [ ] **Step 4: Run focused tests**

```bash
node --experimental-strip-types --test tests/local-auto-pair-session.test.mjs tests/background-proxy.test.mjs tests/project-console-behavior.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/local-server/src/server.ts apps/extension/src/background/index.ts apps/extension/src/content/bridge-client.ts tests/local-auto-pair-session.test.mjs tests/background-proxy.test.mjs tests/project-console-behavior.test.mjs
git commit -m "feat: revoke local auto pair sessions"
```

## Task 6: Automated Browser Acceptance

**Files:**
- Test only unless defects are found.

- [ ] **Step 1: Run full checks**

```bash
npm run typecheck
npm run lint
node --experimental-strip-types --test tests/local-auto-pair-session.test.mjs tests/extension-console-auto-pair.test.mjs tests/local-launcher.test.mjs tests/project-console-behavior.test.mjs tests/background-proxy.test.mjs tests/extension-build.test.mjs
npm run build-extension
npm test
git diff --check
```

Expected: all pass.

- [ ] **Step 2: Run browser automation**

Use Playwright or Computer Use to verify:

1. Start local server.
2. Open `http://127.0.0.1:31337/console/project`.
3. Confirm Console shows paired without manual token entry.
4. Confirm `/health/private` succeeds without typing token.
5. Confirm visible page text does not include the printed pairing token.
6. Confirm URL does not include token or nonce.
7. Confirm extension session claim succeeds.
8. Open ChatGPT Web with the extension installed.
9. Confirm extension status shows paired.
10. Revoke from Console.
11. Confirm Console falls back to manual token entry.
12. Confirm extension status becomes unpaired or requests refresh.

- [ ] **Step 3: Token leak scan**

Run:

```bash
rg "<printed-token-from-this-run>" . --glob '!node_modules/**'
```

Expected: no matches.

- [ ] **Step 4: Commit acceptance notes only if a tracked doc requires it**

Do not commit screenshots or token-bearing artifacts.

## Acceptance Criteria

- Opening local Project Console requires no manual token input.
- `/bridge/*` remains authenticated.
- Printed pairing token still works as manual fallback.
- Console auth is loopback-only and process-lifetime.
- Console credential is not JS-readable if using the cookie path.
- Extension can claim a local automation session after Console opens.
- Extension claim nonce is one-time, short-lived, and not a bridge credential.
- Extension session token is stored only in `chrome.storage.session`.
- Revoke invalidates Console and extension session credentials.
- No token in URL, localStorage, visible DOM, config, logs, reports, or artifacts.
- Existing ChatGPT Web auto-send/auto-return boundaries remain controlled by ADR-0023 and related Web Auto plans.
- No generic shell/run/exec endpoint is introduced.

## Review Checklist

- Does any unauthenticated endpoint grant bridge authority without a one-time nonce?
- Does any token enter URL query, hash, localStorage, config, or logs?
- Can non-loopback origins auto-pair?
- Can a stale extension claim nonce be replayed?
- Does revoke invalidate both Console and extension credentials?
- Are extension permissions limited to `http://127.0.0.1:31337/console/project` and `https://chatgpt.com/*`?
- Does the implementation preserve route-level authorization and existing operation hashes?

## Execution Status

- ADR-0025: **Accepted** (2026-06-30, REVIEW-Task2)
- Task 0: ✅ ADR created
- Task 1: ✅ Session store implemented
- Task 2: ✅ Server auto-pair routes implemented
- Task 3: 🔲 Console UI token discipline
- Task 4: 🔲 Extension claim from local Console
- Task 5: 🔲 Revoke + safety regression
- Task 6: 🔲 Browser automation acceptance

## Execution Recommendation

Use Subagent-Driven execution after ADR acceptance:

1. Task 0 by reviewing/planning agent.
2. Task 1 and Task 2 serially because server auth depends on store semantics.
3. Task 3 and Task 4 serially because the extension claim depends on server route shape.
4. Task 5 as a bounded repair/hardening batch.
5. Task 6 by the reviewing agent with real browser/extension evidence.

Do not execute Task 3+ before REVIEW-Task2 is complete.
