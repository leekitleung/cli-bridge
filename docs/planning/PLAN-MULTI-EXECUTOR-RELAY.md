# PLAN: Multi-Executor Relay (ChatGPT Web as shared reviewer)

Status: PROPOSED — DESIGN ONLY (no implementation authorized)

Date: 2026-06-16

> This is a `docs/planning/` proposal. It does **not** define live behavior, does
> **not** authorize implementation, and does **not** change any current security
> boundary. Auto-send and executor write-back remain gated behind their own ADRs
> (see "ADR trigger points"). Implementation only proceeds through bounded
> `EX-*` batches after the prerequisite reviews/ADRs are accepted.

## 1. Why now (evidence base)

The single-executor manual loop was validated end-to-end in real Chrome/ChatGPT
on 2026-06-16 (REVIEW-CHATGPT-WEB-MANUAL-E2E-v0.2). Confirmed facts this plan is
allowed to build on:

- in-panel pairing works (no service-worker console needed);
- the MV3 content-script CORS blocker is resolved via the background
  service-worker proxy (`cli-bridge-proxy-fetch`), with `baseUrl` fixed server
  side and path/method allowlisted;
- `POST /bridge/outbound` queues a redacted prompt; the extension poller claims
  it (`GET /bridge/outbound/next`) and fills the ChatGPT composer;
- **no auto-send**: the extension only fills; the human clicks send;
- extract writes back to the local queue (`/bridge/pending-prompts`), reflected
  in `/bridge/metrics` and `/bridge/outbound` (`delivered`);
- the streaming guard holds: the poller does not claim/fill while ChatGPT is
  generating;
- pairing UX feedback exists (initial state, colorized status, paired
  placeholder) though further polish is noted as a known gap.

Because the single-executor path is proven, generalizing to multiple executors
is no longer building on an unverified assumption.

## 2. Target picture

A controlled, auditable relay where **many executors share one ChatGPT Web tab
as a reviewer/planner**:

```text
Executors (WorkBuddy / Codex CLI / Claude Code / future OpenCode ...)
  -> produce output, enqueue it as an outbound prompt (per executor session)
  -> extension fills the ChatGPT composer
  -> (optional, opt-in) auto-send  [ADR-gated]
  -> ChatGPT review/answer
  -> human clicks "extract"
  -> result routed back to the *originating executor's* inbound queue
  -> the executor pulls it (or a cli-bridge-managed session is written to) [ADR-gated]
```

Direction and automation are per-executor configurable. The default posture
stays human-gated (fill-only, manual send, pull-based return).

## 3. Roles

- **Executor**: anything that produces work and consumes review. Identified by a
  stable `endpointId` + a per-run `sessionId`. Examples: Codex CLI, Claude Code,
  WorkBuddy, future OpenCode.
- **Local server (relay)**: owns queues, redaction, audit, and routing. Binds
  loopback only; `/bridge/*` requires origin + pairing token.
- **Browser extension**: fills the composer (outbound) and extracts replies
  (inbound). Never auto-sends today.
- **ChatGPT Web**: the shared reviewer/planner. Not an executor.

## 4. The core abstraction: endpoint/session routing

Today outbound/pending records already carry `sessionId`; the registry
(`endpoint-registry`) and `provider-capability` already gate what an endpoint may
do. This plan makes routing explicit so multiple executors can share the tab
without cross-talk:

- Every outbound prompt is tagged with `{ endpointId, sessionId }`.
- Every extracted reply is routed back to the **same** `endpointId/sessionId`
  into a per-executor **inbound queue** (proposed `/bridge/inbound*`, mirroring
  the existing `/bridge/outbound*` shape).
- Executors **pull** their inbound results; cli-bridge does not push into a
  terminal it does not own (see §6 safety).

This keeps the relay as the single source of truth and makes "which reply goes
to which executor" a server-side routing decision, not a browser guess.

## 5. Contracts

### 5.1 Outbound (executor -> ChatGPT) — already exists
- `POST /bridge/outbound { sessionId, prompt }` → queued (redacted).
- `GET /bridge/outbound/next` → claim for composer fill.
- `POST /bridge/outbound/ack { outboundPromptId, ok, failureReason? }`.
- Change proposed: add explicit `endpointId` alongside `sessionId` (backward
  compatible; default to the current single executor).

### 5.2 Inbound / return (ChatGPT -> executor) — proposed
- Extraction continues to write a redacted record on the server.
- New: route that record into a per-executor inbound queue keyed by
  `endpointId/sessionId`.
- `GET /bridge/inbound/next?endpointId=...` (token-gated) → executor pulls its
  next reviewed result; `POST /bridge/inbound/ack` to mark consumed.
- No terminal injection, no keyboard simulation, no PTY attach in this contract.

## 6. Safety: how "return to the executor's input" is done

"Auto-extract back into the executor's input position" must NOT become terminal
control. Two acceptable forms only:

1. **Pull model (default, preferred)**: the executor polls its inbound queue, or
   a small CLI command prints/copies the latest reviewed result. cli-bridge
   never types into a terminal it did not spawn.
2. **Managed-session write (opt-in, ADR-gated)**: cli-bridge writes only into a
   session it owns/spawned (e.g. `CodexManagedPtyAdapter`, currently
   experimental). Writing into an arbitrary pre-existing terminal remains
   prohibited.

This preserves the product's defining property: automation relays and fills;
sending and execution stay human-confirmed (or explicitly, auditably opted in).

## 7. ADR trigger points (do not implement without these)

- **Auto-send (opt-in)**: requires an ADR consistent with ADR-0001's conditions
  — explicit per-executor switch, default off, visible audit log, round/turn
  limit, and an interrupt control. Until then the extension stays fill-only.
- **Managed-executor write-back**: requires an ADR; only cli-bridge-managed
  sessions, never attach-to-existing-terminal.
- **Server origin/CORS posture**: if the background SW proxy ever surfaces a
  `chrome-extension://<id>` origin the server rejects, that is decided in
  RP-EXTENSION-ORIGIN-POLICY, not silently widened here.
- **New execution authority** introduced by any new executor goes through the
  existing capability gating; no shell/exec/run/command endpoint is added.

## 8. Phased route (each phase is a separate bounded batch)

1. (DONE) Single-executor manual loop validated (v0.2).
2. (DONE) Pairing UX feedback (EX-PAIRING-UX-FEEDBACK).
3. Endpoint/session tagging on outbound + inbound return queue (`/bridge/inbound*`),
   pull-based. In-boundary; likely no new ADR (no new execution authority).
4. Executor pull clients (Codex/Claude/WorkBuddy read their inbound results via
   poll or CLI command). In-boundary.
5. New executor onboarding (OpenCode, ...) via `endpoint-registry` capability
   declarations. In-boundary unless a new authority is introduced.
6. Opt-in auto-send. **ADR required.**
7. Managed-executor write-back (Codex PTY, etc.). **ADR required, experimental.**

## 9. Explicitly NOT in this plan

- No auto-send implementation.
- No `send-button` detection, `KeyboardEvent`, `requestSubmit`, `.submit(`.
- No terminal injection / PTY attach to external terminals.
- No push transport (polling stays the transport until separately decided).
- No server CORS / origin allowlist widening.
- No change to redaction, loopback-only binding, or the pairing-token gate.

## 10. Open questions

- Inbound queue retention and multiplicity: one reply per outbound, or a stream
  per session? Start with one-reply-per-outbound for determinism.
- How a session correlates an extracted reply to its originating outbound when
  the human extracts manually (candidate: carry `sessionId` in the queued
  prompt and require the extractor to attach it).
- Whether WorkBuddy integrates as a true executor endpoint or stays a
  non-executing task-record producer (current v2.2 posture).
- Backpressure when multiple executors enqueue while one ChatGPT tab is the only
  consumer (sequential fairness vs priority).

## 11. Next action

Do not start phase 3 until this plan is reviewed/accepted. The immediate
follow-up is a review batch (RP) to ratify the endpoint/session return model and
produce the bounded `EX-*` prompt for the `/bridge/inbound*` contract.

---

## 12. RP review amendments — inbound contract (2026-06-16)

Review batch: RP-MULTI-EXECUTOR-RELAY-INBOUND-CONTRACT-REVIEW. No runtime code
changed; this is a documentation-only convergence of §4–§5 plus a bounded EX
prompt. Grounded in the current stores (`outbound-prompt-store`,
`pending-prompt-store`) and `endpoint-registry`.

### 12.1 Verdict
APPROVE WITH AMENDMENTS. The plan's direction holds, but the inbound contract
must be tightened on three points before implementation:
- inbound records are **created server-side from a relay context**, never from a
  content-script-supplied `endpointId` (anti-misroute);
- inbound is a **new record type and store**, not a rename/reuse of
  `pending-prompt` / `outbound-prompt` / `packet`;
- routing requires a **new endpoint capability** (`canReceiveInbound`), default
  false, gated through the existing registry.

### 12.2 Required amendments to the plan
- §5.2: `POST /bridge/inbound` is **not** called by the content script with a
  chosen `endpointId`. The extension only submits `{ sessionId, content }` on
  extract; the **local server resolves `endpointId` from the active relay
  context** (the most recent `delivered` outbound for that `sessionId`). If no
  context resolves, it **falls back to the existing pending-prompt path** (no
  inbound record, no regression to v0.2 behavior).
- §4: state that `endpointId` originates only from the endpoint registry; a
  `sessionId` binds to exactly one `endpointId` for its lifetime (first binding
  wins; conflicting rebind is rejected).
- §3/§7: add capability `canReceiveInbound` (pull) and reserve
  `canUseManagedWriteback` (ADR-gated) — both default false.

### 12.3 Final proposed `/bridge/inbound*` contract
All token + origin gated like the rest of `/bridge/*`.
- `POST /bridge/inbound { sessionId, content }` — **server/core only path** in
  practice: invoked by the extract→route flow. Server resolves `endpointId` via
  relay context; redacts `content` through the packet pipeline; rejects with a
  typed error if the resolved endpoint lacks `canReceiveInbound`. Returns the
  created `InboundMessage` (redacted) or a fallback indicator when it degrades
  to a pending prompt.
- `GET /bridge/inbound?endpointId=&sessionId=` — list (redacted), filtered by
  endpoint/session.
- `GET /bridge/inbound/next?endpointId=&sessionId=` — claim the oldest `queued`
  message **for that endpoint only**; sets `claimed` + `claimedAt`.
- `POST /bridge/inbound/ack { inboundMessageId, endpointId, ok, failureReason? }`
  — `ok:true` → `consumed`; `ok:false` → `failed`. Must verify the message's
  `endpointId` matches; mismatch → 403-style typed error.
- `POST /bridge/inbound/cancel { inboundMessageId, endpointId }` — optional,
  drops a mis-routed/obsolete message (`cancelled`).
- No endpoint may claim/ack another endpoint's message.

### 12.4 Data model draft (shared/types)
```text
type EndpointId = string;   // must exist in the endpoint registry
type SessionId  = string;   // bound to exactly one EndpointId for its lifetime

type InboundStatus = 'queued' | 'claimed' | 'consumed' | 'failed' | 'cancelled';
type InboundSource = 'chatgpt-web-extract';   // only source in phase 3

interface InboundMessage {
  id: string;
  endpointId: EndpointId;
  sessionId: SessionId;
  packetId: string;               // redacted content lives in the packet store
  content: string;                // processedContent only (never raw)
  source: InboundSource;
  sourceOutboundPromptId?: string; // provenance: which outbound this answers
  status: InboundStatus;
  createdAt: number;
  updatedAt: number;
  claimedAt?: number;
  consumedAt?: number;
  failureReason?: string;
}

interface RelayContext {           // server-side, per sessionId
  sessionId: SessionId;
  endpointId: EndpointId;
  lastOutboundPromptId: string;
  updatedAt: number;
}
```
Capability additions (AgentEndpoint.capabilities): `canReceiveInbound: boolean`
(phase 3), `canUseManagedWriteback: boolean` (reserved, ADR-gated). New
`EndpointAction`: `'receive-inbound'`.

### 12.5 State machine
```text
queued --claim(GET /inbound/next, endpoint match)--> claimed
claimed --ack ok:true--> consumed         (terminal)
claimed --ack ok:false--> failed          (terminal)
queued|claimed --cancel--> cancelled      (terminal)
```
Lease/claim-timeout (auto-reclaim of stale `claimed`) is deferred to a later
phase; phase 3 keeps claim→ack simple and records `claimedAt` so reclaim can be
added without a schema change. (Open question 12.7.)

### 12.6 Security invariants
- inbound is **pull-only**; the server never injects into any terminal.
- managed-session writeback and auto-send remain **ADR-gated**; not in phase 3.
- `endpointId` is registry-sourced and resolved server-side; content scripts
  never assert it.
- an endpoint can only claim/ack messages whose `endpointId` matches it.
- `canReceiveInbound` defaults false; routing to an endpoint without it →
  fallback to pending prompt, never an inbound record.
- content is redacted before persistence; raw content stays memory-only;
  loopback-only binding and pairing-token gate unchanged.
- no `send-button` / `KeyboardEvent` / `requestSubmit` / `.submit(` introduced.

### 12.7 Open questions
- Relay-context lifetime when one tab serves multiple endpoints in quick
  succession (only the latest binds per session) — acceptable for phase 3?
- Should `sessionId↔endpointId` binding be explicit (a pairing/registration
  call) rather than inferred from the first delivered outbound?
- Claim lease/timeout policy and at-least-once vs at-most-once delivery.
- Whether the extension needs to surface the resolved endpoint in the panel so
  the human knows where an extract will be routed.

### 12.8 Bounded EX prompt for phase 3 (DO NOT EXECUTE YET)
```text
Execute EX-BRIDGE-INBOUND-RETURN-QUEUE (phase 3 of PLAN-MULTI-EXECUTOR-RELAY).

Goal: add a pull-based inbound return queue so an extracted ChatGPT reply is
routed back to the originating executor (endpointId/sessionId), without auto-send,
terminal injection, or managed writeback.

Boundary:
- No auto-send; no send-button/KeyboardEvent/requestSubmit/.submit(.
- No terminal injection / PTY attach / managed writeback.
- No server CORS/origin policy change.
- Do NOT rename or repurpose pending-prompt/outbound-prompt/packet; add a new
  InboundMessage type + InMemoryInboundMessageStore.
- Content scripts may NOT assert endpointId; the server resolves it from relay
  context and falls back to the existing pending-prompt path when none resolves.
- W2 security-boundary test and "automation actions remain 填入/提取/复制" stay green.

Implement:
1. shared/types + schemas: InboundMessage, InboundStatus, RelayContext;
   AgentEndpoint.capabilities.canReceiveInbound (default false) + EndpointAction
   'receive-inbound'.
2. InMemoryInboundMessageStore (create/claimNextForEndpoint/ack/cancel/list),
   redaction via packet pipeline, audit events, JSON-snapshot hydrate/export
   behind CLI_BRIDGE_DATA_DIR.
3. RelayContext tracking: on outbound 'delivered', record {sessionId->endpointId,
   lastOutboundPromptId}. Outbound create/claim/ack carry endpointId
   (backward-compatible default for the current single executor).
4. Routing: a server-side extract→route step creates an InboundMessage when a
   relay context + canReceiveInbound resolve; otherwise create a pending prompt
   (current behavior).
5. Routes: POST /bridge/inbound, GET /bridge/inbound, GET /bridge/inbound/next,
   POST /bridge/inbound/ack, POST /bridge/inbound/cancel — all token+origin gated,
   endpoint-match enforced on claim/ack/cancel.
6. Metrics + audit coverage for inbound lifecycle.

Tests:
- endpoint/session routing: correct endpoint receives its message.
- wrong endpoint cannot claim/ack another endpoint's message.
- no active relay context -> falls back to pending prompt (no inbound record).
- inbound lifecycle queued->claimed->consumed and ->failed/->cancelled.
- canReceiveInbound=false -> fallback, never inbound.
- persistence round-trip when CLI_BRIDGE_DATA_DIR set; raw content never written.
- existing pending-prompts/outbound tests do not regress.
- W2 no-auto-send boundary remains green.

Verify: targeted tests + npm run typecheck + npm test + npm run build-extension
(only if extension code changed; this phase is server-side). Report changed
files, contract, test results, and confirmation no boundary was crossed. Stop
after phase 3; do not start auto-send or managed writeback.
```

### 12.9 Next action
Phase 3 is specified but NOT authorized to run here. Control returns to you:
issue "Execute EX-BRIDGE-INBOUND-RETURN-QUEUE" to start it, or request changes to
this contract first.

---

## 13. Manual inbound-routing E2E runbook (EX-INBOUND-E2E-OPERABILITY, 2026-06-16)

REVIEW-INBOUND-ROUTING-E2E proved the server-side chain
(`outbound(endpointId+sessionId) → claim → ack delivered → extract-return →
inbound → claim → ack consumed`) but surfaced three operability gaps that made a
real-browser test hard to reproduce. This batch addresses them without crossing
any boundary (no executor pull client, no auto-send, no terminal writeback).

### 13.1 Gaps and resolutions
- **G1 — no inbound-capable endpoint out of the box.** `DEFAULT_AGENT_ENDPOINTS`
  (mock-agent / clipboard / chatgpt-web / codex-cli) intentionally stay
  inbound-incapable. A dedicated **manual/local** endpoint
  `mock-inbound-agent` (`canReceiveInbound: true`) is now registered into the
  runtime registry. It is NOT in `DEFAULT_AGENT_ENDPOINTS` and does **not**
  represent enabling inbound on any real executor.
- **G2 — manual panel fill never establishes a relay context.** The panel "填入"
  button creates a packet with the panel's own `panel-<timestamp>` session and
  no `endpointId`; extract for that session always falls back to a pending
  prompt. To exercise inbound you MUST create an outbound with a `sessionId`;
  the trusted server runtime supplies the inbound endpoint, and the poller then
  fills + acks, recording relay context and the active relay session. Use
  `scripts/manual-inbound-e2e.mjs`; clients never send `endpointId`.
- **G3 — no panel observability.** The panel shows `暂无回程上下文` /
  `回程上下文可用` (`data-cli-bridge-relay-status`) without exposing session or
  endpoint identifiers. It never shows or accepts an `endpointId`; clearing the
  pairing token resets the status to `暂无回程上下文`.

### 13.2 Steps
1. Run `npm start`; copy its pairing token.
2. Seed an inbound-capable outbound:
   ```
   node --experimental-strip-types scripts/manual-inbound-e2e.mjs \
     --token <PAIRING_TOKEN> --session s-manual-1
   ```
3. In Chrome: reload `apps/extension/dist`, hard-reload chatgpt.com, open the
   extension popup, enter the token, and click `保存并测试`. Confirm `已连接`.
   After the poller fills the composer, the page panel should show
   `回程上下文可用`.
4. The composer is filled automatically (no auto-send). Send manually; wait for
   the reply.
5. Explicitly select the reply text to return. Click `预览回传`, verify the
   preview contains only that selection, then click `确认回传`. The panel status
   should report routed-to-inbound.
6. Verify the reviewed reply is queued for the executor:
   ```
   GET /bridge/inbound?endpointId=mock-inbound-agent
   (origin: chrome-extension://__CLI_BRIDGE_EXTENSION_ID__,
    header x-cli-bridge-pairing-token: <token>)
   ```

### 13.3 Still out of scope
Executor pull client, auto-send, terminal injection, and managed PTY writeback
remain unimplemented and ADR-gated per §6–§7.
