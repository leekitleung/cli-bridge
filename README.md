# CLI Bridge

CLI Bridge is a **safe, verifiable, semi-automatic context relay** between a CLI
coding agent (Codex) and ChatGPT Web. It helps you move CLI output into ChatGPT
and turn ChatGPT replies into reviewed, human-confirmed prompts — without giving
any component terminal execution authority.

It is **not** a terminal controller. It does not run shell commands, does not
auto-click ChatGPT send, and does not run unattended agent loops. Every transfer
to an agent goes through an explicit user-confirmation gate.

## What works today

- **Local Server**: binds `127.0.0.1` only, exposes `GET /health` (public) and
  `GET /health/private` (origin guard + pairing token).
- **Browser extension**: mounts a Bridge Panel on ChatGPT Web with three
  actions — Fill / Extract / Copy — plus a clipboard fallback.
- **In-memory contract libraries** (exercised by the test suite, not yet wired
  to an HTTP/UI runtime): BridgePacket + redaction + audit log, Pending Prompt
  lifecycle, bidirectional loop orchestration, endpoint registry with capability
  gating, agent-to-agent review lifecycle, and a WorkBuddy state contract.
- **Remote Review Gate**: a local, read-only release gate
  (`npm run remote-review-gate`) that checks local/remote HEAD match, working
  tree cleanliness, and (when GitHub CLI is available) PR / CI state.

> Status caveats: real ChatGPT Web manual E2E and real Codex Managed PTY delivery
> remain unvalidated / experimental. The v0.4–v1.0 contract libraries are not yet
> exposed through a user-runnable path; they are validated by automated tests.

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
- automatic ChatGPT send or automatic agent loops;
- automatic commit / push / merge / PR creation;
- MCP, app-prompt, OpenCode, DeepSeek TUI, or real WorkBuddy integration.

Sensitive content (API tokens, private keys, `.env` secret assignments) is
redacted before any persistence; raw content stays memory-only by default.
