# CLI Bridge v1.1 Planning Handoff

## 1. Verdict

Status: PLANNING + IMPLEMENTATION for a single restricted slice — Core Relay
Runtime Wiring.

A release-candidate review of v1.0 found that the core relay loop (BridgePacket
+ redaction + audit, Pending Prompt lifecycle, metrics) was implemented as
in-memory libraries exercised only by tests, with no user-runnable path: the
local server exposed only `/health` and `/health/private`. v1.1 closes that gap
by exposing the already-reviewed core loop over authenticated local HTTP
endpoints, without expanding the agent/control surface.

## 2. Problem Statement

- v0.1–v1.0 built BridgePacket, redaction, audit log, Pending Prompt lifecycle,
  and a metrics summary, but none of it is reachable at runtime.
- Users running `npm run start:local-server` get only health checks.
- The value proposition ("safe semi-automatic context relay") cannot be
  exercised end-to-end outside the test suite.

## 3. Scope (this slice)

Allowed implementation:

- new authenticated local HTTP endpoints under the `/bridge` prefix, reusing the
  existing origin guard + pairing token used by `/health/private`.
- wiring of existing in-memory stores into one per-server instance:
  - `InMemoryPacketStore`
  - `InMemoryAuditLog`
  - `InMemoryPendingPromptStore`
  - `createMetricsSummary`
- delivery only via `MockAgentAdapter` (transport `mock`).
- request body JSON parsing with explicit malformed-input handling.
- tests covering the new endpoints, auth, and failure paths.

Endpoint set:

```text
POST /bridge/packets              create a redacted packet from raw content
GET  /bridge/packets              list packets (processedContent only)
POST /bridge/pending-prompts      create a pending prompt (status: draft)
POST /bridge/pending-prompts/confirm   confirm a pending prompt
POST /bridge/pending-prompts/send      send a CONFIRMED prompt via MockAgent only
POST /bridge/pending-prompts/cancel    cancel a pending prompt
GET  /bridge/pending-prompts      list pending prompts
GET  /bridge/metrics              current metrics summary
```

## 4. Hard Non-Goals (unchanged boundaries)

v1.1 must not add:

- any `/exec`, `/shell`, `/run`, or `/command` endpoint, or any generic shell
  surface.
- real Codex Managed PTY delivery over HTTP (managed-pty stays experimental and
  is not exposed as a runtime transport here).
- automatic ChatGPT send, automatic agent loop, or auto-confirm.
- HTTP exposure of the endpoint registry, agent-to-agent review lifecycle, or
  WorkBuddy state — those remain library contracts pending their own slices,
  because they front deferred real integrations (Claude Code, WorkBuddy, etc.).
- product-runtime GitHub API / CI readers.
- raw content in any response or persisted record.

## 5. Safety Rules

- every `/bridge` request requires an allowed origin and a valid pairing token,
  identical to `/health/private`.
- `send` requires the prompt to already be `confirmed`; a draft or previewed
  prompt cannot be delivered.
- delivery target is `MockAgentAdapter` only; no real agent is invoked.
- responses expose `processedContent` only; raw content stays memory-only in the
  packet store and is never serialized.
- malformed JSON, missing fields, unknown ids, and not-confirmed states return
  explicit 4xx with a structured `{ status: 'error', message }`.

## 6. Acceptance Gates

- the local server exposes the `/bridge` endpoints behind auth.
- an unauthenticated `/bridge` request is rejected exactly like `/health/private`.
- a full create-packet -> create-prompt -> confirm -> send (mock) -> metrics
  loop works over HTTP.
- sending an unconfirmed prompt is rejected and does not call the adapter.
- malformed JSON returns 400.
- no forbidden endpoint pattern is introduced.
- full local gate passes: build, lint, typecheck, test.

## 7. Deferred List

- endpoint-registry / review-lifecycle / WorkBuddy HTTP exposure.
- real Codex Managed PTY runtime transport.
- real Claude Code / WorkBuddy / MCP / app-prompt integration.
- persistent (non-memory) storage.
- browser-extension calls to these endpoints (panel still uses local DOM actions
  plus clipboard fallback; wiring the panel to `/bridge` is a later slice).

## 8. Implementation Status

Completed Core Relay Runtime Wiring:

- added `apps/local-server/src/routes/bridge-api.ts` with a per-server
  `BridgeRuntime` (`InMemoryPacketStore` + `InMemoryAuditLog` +
  `InMemoryPendingPromptStore` + `MockAgentAdapter`).
- wired `server.ts` to route `/bridge/*` behind the same origin + pairing-token
  auth as `/health/private` (shared `checkAuth` helper).
- endpoints: `POST/GET /bridge/packets`, `POST/GET /bridge/pending-prompts`,
  `POST /bridge/pending-prompts/confirm|send|cancel`, `GET /bridge/metrics`.
- `send` only delivers a `confirmed` prompt and only via `MockAgentAdapter`.
- responses serialize `processedContent` only; raw content is never returned.
- request bodies are size-limited and JSON-validated; malformed JSON, missing
  fields, unknown ids, and not-confirmed states return explicit 4xx.
- tests: `tests/bridge-api.test.mjs` covers auth rejection, the full
  create -> confirm -> send (mock) -> metrics loop, malformed JSON, missing
  fields, unknown-id send, and absence of any shell-style endpoint.

Not added (still deferred):

- endpoint-registry / review-lifecycle / WorkBuddy HTTP exposure.
- real Codex Managed PTY runtime transport.
- automatic send / agent loop.
- browser-extension calls to `/bridge` (panel still uses local DOM + clipboard).

Local gate: `npm run build-extension`, `npm run lint`, `npm run typecheck`,
`npm run test` all pass on Windows (118/118).
