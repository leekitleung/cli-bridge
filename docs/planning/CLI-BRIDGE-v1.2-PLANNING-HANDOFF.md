# CLI Bridge v1.2 Planning Handoff

## 1. Verdict

Status: PLANNING + IMPLEMENTATION for a single restricted slice — Bridge Panel
Runtime Wiring.

v1.1 exposed the core relay loop over authenticated `/bridge` HTTP endpoints but
the browser extension still operated in local-DOM-only mode and never called
them. v1.2 connects the Bridge Panel to those endpoints so that Fill / Extract
actions also record a server-side packet / pending prompt, while preserving every
existing safety boundary.

## 2. Problem Statement

- The Bridge Panel updated only optimistic local state; the server never saw the
  user's Fill / Extract activity.
- The "safe semi-automatic relay" value (redaction + audit + metrics) was
  reachable over HTTP but not from the actual UI a user interacts with.

## 3. Scope (this slice)

Allowed implementation:

- new `apps/extension/src/content/bridge-client.ts`: a thin authenticated client
  for the `/bridge` endpoints, holding the pairing token in memory.
- pairing-token storage via `chrome.storage.local`, with a message API in the
  background service worker (`cli-bridge-set-token` / `cli-bridge-get-token`).
- Bridge Panel calls, after a successful local DOM action:
  - Fill success -> `POST /bridge/packets` (records redacted content).
  - Extract success -> `POST /bridge/pending-prompts` (creates a draft prompt).
- minimal Chrome API type declarations (`apps/extension/src/chrome.d.ts`).
- `storage` permission added to the extension manifest.
- tests for the client (token gating, header/body shape, GET vs POST, network
  error handling).

## 4. Hard Non-Goals (unchanged boundaries)

v1.2 must not add:

- automatic ChatGPT send, keyboard simulation, or `requestSubmit` / `.submit()`.
- any confirm/send of a pending prompt from the panel (confirm + send remain
  separate, explicit server actions; the panel only creates draft state).
- reading page secrets (`localStorage`, `document.cookie`).
- agent-control affordances in the panel UI (still only Fill / Extract / Copy).
- HTTP exposure of endpoint registry / review lifecycle / WorkBuddy.

## 5. Safety Rules

- The client refuses to call fetch when no pairing token is present; the panel
  silently stays in local-only mode (graceful degradation).
- All server calls are best-effort: a failure never blocks the local DOM action
  or throws into the UI.
- The pairing token is read from `chrome.storage.local`; it is never written to
  tracked source and never logged.
- The content script runs only on `https://chatgpt.com/*`; the browser sets the
  origin header, which the server's origin guard already enforces.

## 6. Acceptance Gates

- panel wiring builds and the bundled content script contains no auto-send path.
- bridge-client gates on token presence and assembles correct requests.
- pure DOM/clipboard/extraction modules remain free of server vocabulary.
- full local gate passes: build, lint, typecheck, test.

## 7. Implementation Status

Completed Bridge Panel Runtime Wiring:

- added `bridge-client.ts` with `createPacket`, `createPendingPrompt`,
  `confirm/send/cancel`, `getMetrics`, `list*`, and `loadPairingTokenFromStorage`.
- Bridge Panel loads the token on mount and, on successful Fill / Extract, syncs
  to `/bridge/packets` and `/bridge/pending-prompts` (best-effort, token-gated).
- background service worker stores/returns the pairing token via messages.
- manifest gains `storage`; added minimal `chrome.d.ts`.
- tests: `tests/bridge-client.test.mjs` covers unpaired no-op, paired
  header/body, GET-without-body, and network-error handling. W2 boundary tests
  split into pure-module purity vs wired-module hard-safety checks.

Not added (still deferred):

- panel-driven confirm/send (kept as explicit separate steps).
- endpoint-registry / review / WorkBuddy HTTP exposure.
- a pairing UI/popup (token is set programmatically or via storage for now).

Local gate: build, lint, typecheck, test all pass on Windows.

## 8. Deferred List

- a proper pairing popup UI for entering the token.
- panel surfacing of live metrics / pending-prompt list.
- persistent (non-memory) server storage (planned next slice).
