# CLI Bridge

CLI Bridge is a **safe, verifiable, controlled-automation context relay** between
a CLI coding agent (Codex) and ChatGPT Web. It helps move CLI output into
ChatGPT and turn ChatGPT replies into reviewed prompts while keeping shell
execution and terminal control out of the product surface.

It is **not** a terminal controller. It does not expose shell endpoints. As of
ADR-0001 and ADR-0002, automation is allowed only in staged, auditable slices:
v1.5a can queue an outbound prompt and let the browser extension fill the
ChatGPT composer, while v1.5b is planned as fixed review-only local CLI command
transport. It still does not auto-click ChatGPT send or run unattended agent
loops.

## What works today

- **Local Server**: binds `127.0.0.1` only, exposes `GET /health` (public) and
  `GET /health/private` (origin guard + pairing token).
- **Browser extension**: mounts a collapsible, host-theme-aware Bridge Panel on
  ChatGPT Web with four explicit stages: connect, fill for ChatGPT, select and
  preview, then confirm return. It never clicks ChatGPT Send.
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
  audit events, prompts, inbound returns, and relay context survive a restart. Off by default
  (in-memory). Raw content is never written to disk; only redacted
  `processedContent` is persisted.
- **Still library-only** (validated by tests, not yet exposed over HTTP):
  bidirectional loop orchestration, endpoint registry with capability gating,
  and agent-to-agent review lifecycle.
- **Remote Review Gate**: a local, read-only release gate
  (`npm run remote-review-gate`) that checks local/remote HEAD match, working
  tree cleanliness, and (when GitHub CLI is available) PR / CI state.
- **Project Workspace Console** (`/console/project`): a project-centric
  cockpit that consolidates goals, plans, reviews, prompts, audit, and status
  into a single three-region interface. Data is loaded from the `/bridge/projects`
  aggregation endpoints. Project switching with loading state; status panel with
  server-computed progress, active goal, goals summary, and blocked-gate indicator.
  Includes inline metadata editing, archive/unarchive controls, and archived
  project visibility toggle. Project management actions use
  `/bridge/projects*`; other console actions use existing allowlisted
  `/bridge/*` controlled endpoints (goals, reviews, prompts, metrics).
  No shell/exec/spawn exposure.
- **Project aggregation endpoints**:
  - `GET /bridge/projects` → `{ projects: ProjectSummary[] }`
    where `ProjectSummary = { project, goalCount, activeGoalCount, reviewCount, promptCount, status }`.
    Archived projects are excluded by default; `?includeArchived=true` includes them.
  - `GET /bridge/projects/:key` → `{ project, summary, goals, reviews, pendingPrompts, auditEvents, status }`.
    The `status` field is a server-computed `ProjectDerivedStatus` with progress, activeGoal, goalsSummary, blockedGate,
    and `latestAudit`.
    Audit events are filtered by authoritative `projectId` match; legacy events without `projectId` fall back to packetId.
  - `PATCH /bridge/projects/:key` — update project `label` / `description`.
  - `POST /bridge/projects/:key/archive | :key/unarchive` — soft-archive/restore (default project excluded).
  - `projectId` validation: 1–64 chars, `a-z0-9-_` only, no slashes/spaces. Invalid values → 400.
  - Records without explicit `projectId` are backfilled to the default `"cli-bridge"` project at query time.
  - Archived project guards: creating goals/reviews/prompts with an archived `projectId` returns 409.
  - Detailed contract: see `docs/contracts/bridge-projects-api.md`.
- **Goal-driven execution (v2.0)**: Goal → Plan → Approve → Step → Gate → Audit
  flow with tier enforcement, step ceiling (hard 10), mutating-step gates, and
  controlled execution. See `docs/planning/ADR-0003-controlled-execution-layer.md`.
- **Read-only project observability (v2.1)**: `GET /bridge/projects/:key/{timeline,audit,memory,verification}`
  — server-derived views from existing stores. No new execution authority.
- **Explicit project creation (B3)**: `POST /bridge/projects` with `{ key, label?, description? }`.
  Duplicate / archived / default project keys return 409.
- **WorkBuddy non-executing task system (v2.2)**: `POST /bridge/projects/:key/workbuddy`
  with action multiplexing (`record-task` / `record-review-result` / `record-prompt-draft` /
  `record-ledger`). GET returns project-scoped task state. All strictly non-executing —
  no confirm, no send, no dispatch, no CLI invocation. Detailed contract: see
  `docs/contracts/bridge-workbuddy-api.md`.
  Archived project GET allowed, POST → 409.
  Console Tasks dashboard visible at `/console/project`.
- **Planned v1.5b route**: local review-only command transport for Codex CLI and
  Claude Code CLI, using fixed allowlisted argv, `shell: false`, no-tools /
  read-only constraints, and ReviewResult parsing. Web-DOM automatic send is
  superseded for v1.5b.

> Status caveat: real Codex Managed PTY delivery remains experimental. The
> browser relay remains intentionally manual at ChatGPT Send and return
> confirmation; this is a safety boundary, not an incomplete automation step.

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

## Start CLI Bridge

```bash
npm start
```

This is the primary product entrypoint. It binds loopback only, configures the
safe local inbound test route, prints the Project Workspace URL and a temporary
pairing token, and opens the console when run interactively. Set
`CLI_BRIDGE_NO_OPEN=1` to suppress browser opening. Advanced operator-specific
verification and GitHub configuration remains available through
`npm run start:local-server:configured`.

Smoke check:

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
| `GET /bridge/reviews` | List review requests |
| `POST /bridge/reviews` | Create a review `{ sessionId, sourceEndpointId, targetEndpointId, prompt }` (status `previewed`) |
| `POST /bridge/reviews/confirm` | Confirm a previewed review `{ reviewId }` (human gate) |
| `POST /bridge/reviews/dispatch` | Run a **confirmed** review via the local review-only CLI `{ reviewId }` |
| `POST /bridge/reviews/cancel` | Cancel a review `{ reviewId }` |
| `GET /bridge/metrics` | Current metrics summary |

Notes:

- Delivery (`/send`) only targets the in-memory **mock agent**; no real agent is
  invoked, and a prompt must already be `confirmed`.
- Outbound prompt queue delivery only fills the ChatGPT composer. It does not
  click send, submit forms, or simulate keyboard input.
- Review run (`/bridge/reviews/dispatch`) invokes a local, already-authorized
  review-only CLI (Codex / Claude Code) through the fixed allowlist runner
  (`shell: false`, no tools / read-only). It requires a **confirmed** review,
  never executes a follow-up automatically, and keeps any `nextPromptDraft` as a
  draft pending prompt requiring separate confirmation.
- Responses expose redacted `processedContent` only; raw content stays
  memory-only and is never serialized.
- The endpoint registry, agent-to-agent review lifecycle, and WorkBuddy state
  remain library contracts and are intentionally **not** exposed over HTTP yet.

## Console UI

Run the product entrypoint; it opens the project console by default:

```
npm start
```

The console is a thin view over the existing `/bridge/*` endpoints. Paste the
printed pairing token, click Connect, then create a review, which runs
create → confirm → dispatch against the review-only command transport. It holds
no business logic: every action calls a server endpoint that already enforces
redaction, capability gating, and the human confirmation gates. Any
`nextPromptDraft` stays a draft requiring separate confirmation; nothing is
auto-executed.

## Load the extension

1. Run `npm run build-extension`.
2. In Chrome, open `chrome://extensions`, enable Developer mode.
3. Choose "Load unpacked" and select **`apps/extension/dist`** (the built
   output — not the source directory).
4. Start with `npm start`, click the CLI Bridge extension icon, paste the
   printed pairing token, and choose **保存并测试**.
5. On ChatGPT, follow the numbered panel stages. Composer fill is automatic;
   sending and confirmed return are always manual.

Recovery notes:

- If the popup says the local server cannot be reached, keep `npm start`
  running and retry **保存并测试**.
- If the popup says the pairing token is invalid, copy the newest token printed
  by `npm start`, replace the old popup value, and choose **保存并测试** again.
- If the ChatGPT panel is still unpaired, click **刷新连接** after the popup
  reports a successful test.

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
- v1.5b proceeds through fixed local CLI review-only command transport, not
  ChatGPT Web automatic send.
- automatic ChatGPT send, automatic extraction loops, and real Codex PTY delivery
  are deferred unless a later ADR explicitly re-approves them with visible audit
  logs, round limits, and interrupt controls.
- browser cookies, localStorage, page secrets, raw unredacted persistence, and
  generic shell control remain hard prohibited.

Sensitive content (API tokens, private keys, `.env` secret assignments) is
redacted before any persistence; raw content stays memory-only by default.
