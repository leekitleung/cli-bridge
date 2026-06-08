# CLI Bridge

CLI Bridge is a **safe, verifiable, controlled-automation context relay** between
a CLI coding agent (Codex) and ChatGPT Web. It helps move CLI output into
ChatGPT and turn ChatGPT replies into reviewed prompts while keeping shell
execution and terminal control out of the product surface.

It is **not** a terminal controller. It does not run shell commands. As of
ADR-0001, automation is allowed only in staged, auditable slices: v1.5a can queue
an outbound prompt and let the browser extension fill the ChatGPT composer, but
it still does not auto-click ChatGPT send or run unattended agent loops.

## What works today

- **Local Server**: binds `127.0.0.1` only, exposes `GET /health` (public) and
  `GET /health/private` (origin guard + pairing token).
- **Browser extension**: mounts a Bridge Panel on ChatGPT Web with three
  actions — Fill / Extract / Copy — plus a clipboard fallback.
- **In-memory core relay, wired over local HTTP** (`/bridge/*`, authenticated):
  BridgePacket + redaction + audit log, Pending Prompt lifecycle
  (create / confirm / send-via-mock / cancel), and a metrics summary.
- **Browser panel synced to the server**: on a successful Fill / Extract, the
  Bridge Panel records a redacted packet / draft pending prompt via `/bridge`
  (token-gated, best-effort; falls back to local-only when unpaired).
- **v1.5a outbound prompt queue**: authenticated `/bridge/outbound*` endpoints
  can queue redacted Codex output for ChatGPT Web. The extension polls, fills the
  composer, and records an acknowledgement. It does **not** submit the prompt.
- **Optional JSON persistence**: set `CLI_BRIDGE_DATA_DIR` to make packets,
  audit events, and pending prompts survive a restart. Off by default
  (in-memory). Raw content is never written to disk; only redacted
  `processedContent` is persisted.
- **Still library-only** (validated by tests, not yet exposed over HTTP):
  bidirectional loop orchestration, endpoint registry with capability gating,
  agent-to-agent review lifecycle, and a WorkBuddy state contract.
- **Remote Review Gate**: a local, read-only release gate
  (`npm run remote-review-gate`) that checks local/remote HEAD match, working
  tree cleanliness, and (when GitHub CLI is available) PR / CI state.

> Status caveats: real Codex Managed PTY delivery remains experimental. Real
> ChatGPT Web manual E2E was validated on 2026-06-08 (see
> `docs/planning/CLI-BRIDGE-v1.4-VALIDATION-HANDOFF.md`). The bidirectional loop,
> endpoint registry, review lifecycle, and WorkBuddy contract are not yet exposed
> through a user-runnable path; they are validated by automated tests.

## Requirements

- Node.js 22+ (uses `--experimental-strip-types` to run TypeScript directly).
- A Chromium-based browser to load the extension (optional, for the panel).

## Install

```bash
npm install
```

## Local gate

Run all four checks before committing:

```bash
npm run build-extension   # bundle the extension into apps/extension/dist
npm run lint              # structural path checks
npm run typecheck         # tsc --noEmit
npm test                  # node --test suite
```

Each command exits non-zero on failure.

## Run the local server

```bash
npm run start:local-server
```

It logs the bound URL (default `http://127.0.0.1:31337`). Smoke check:

```bash
curl http://127.0.0.1:31337/health          # 200 ok
curl http://127.0.0.1:31337/health/private   # 401/403 without origin + pairing token
```

## Core relay endpoints

The local server exposes the core relay loop under `/bridge`. Every `/bridge`
request requires an allowed `origin` and a valid pairing-token header
(`x-cli-bridge-pairing-token`), exactly like `/health/private`.

| Method + path | Purpose |
| --- | --- |
| `POST /bridge/packets` | Create a redacted BridgePacket from `{ sessionId, content }` |
| `GET /bridge/packets` | List packets (processed content only) |
| `POST /bridge/pending-prompts` | Create a pending prompt `{ sessionId, prompt }` (status `draft`) |
| `POST /bridge/pending-prompts/confirm` | Confirm a prompt `{ promptId }` |
| `POST /bridge/pending-prompts/send` | Send a **confirmed** prompt via the mock agent `{ promptId }` |
| `POST /bridge/pending-prompts/cancel` | Cancel a prompt `{ promptId }` |
| `GET /bridge/pending-prompts` | List pending prompts |
| `POST /bridge/outbound` | Queue a redacted prompt for ChatGPT Web `{ sessionId, prompt }` |
| `GET /bridge/outbound/next` | Claim the next queued outbound prompt for extension fill |
| `POST /bridge/outbound/ack` | Acknowledge composer fill `{ outboundPromptId, ok, failureReason? }` |
| `GET /bridge/outbound` | List outbound prompts |
| `GET /bridge/metrics` | Current metrics summary |

Notes:

- Delivery (`/send`) only targets the in-memory **mock agent**; no real agent is
  invoked, and a prompt must already be `confirmed`.
- Outbound prompt queue delivery only fills the ChatGPT composer. It does not
  click send, submit forms, or simulate keyboard input.
- Responses expose redacted `processedContent` only; raw content stays
  memory-only and is never serialized.
- The endpoint registry, agent-to-agent review lifecycle, and WorkBuddy state
  remain library contracts and are intentionally **not** exposed over HTTP yet.

## Load the extension

1. Run `npm run build-extension`.
2. In Chrome, open `chrome://extensions`, enable Developer mode.
3. Choose "Load unpacked" and select **`apps/extension/dist`** (the built
   output — not the source directory).

## Remote review gate

```bash
npm run remote-review-gate            # human-readable JSON, exits 1 on a fail verdict
node scripts/remote-review-gate.mjs --no-github   # skip GitHub CLI lookups
node scripts/remote-review-gate.mjs --reported-file src/a.ts --reported-file src/b.ts
```

The gate is local and read-only. It never pushes, never creates PRs, never
merges, and adds no product-runtime GitHub/CI reader. `pushed` is reported true
only when an upstream exists, the remote HEAD matches local HEAD, and the working
tree is clean. When `--reported-file` is supplied, the gate hard-fails if the
remote diff scope contradicts the reported changed files.

## Security boundaries

CLI Bridge intentionally does **not** provide:

- any `/exec`, `/shell`, `/run`, or `/command` endpoint;
- stop-session or attach-to-existing-terminal behavior;
- automatic commit / push / merge / PR creation;
- MCP, app-prompt, OpenCode, DeepSeek TUI, or real WorkBuddy integration.

Automation boundary after ADR-0001:

- v1.5a allows automatic extension polling and composer fill only.
- automatic ChatGPT send, automatic extraction loops, and real Codex PTY delivery
  are allowed only as later explicit opt-in slices with visible audit logs,
  round limits, and interrupt controls.
- browser cookies, localStorage, page secrets, raw unredacted persistence, and
  generic shell control remain hard prohibited.

Sensitive content (API tokens, private keys, `.env` secret assignments) is
redacted before any persistence; raw content stays memory-only by default.
