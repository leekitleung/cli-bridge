# ADR-0035: Pairing-Driven Conversation Routing

Status: Accepted

Date: 2026-07-03

## Context

ADR-0031 introduced policy-gated planner orchestration where every conversation
message routes through a single default planner adapter. This design has a
critical flaw: the planner is a **global singleton** — `runtime.plannerRegistry.defaultPlanner()` —
that is used regardless of which source endpoint is paired.

In the current architecture:

```text
conversation/messages
  → plannerRegistry.defaultPlanner()  ← always the first registered planner
  → gate evaluator
  → maybe target executor dispatch
```

This means:
- A `chatgpt-web → workbuddy` pairing still routes through the configured Codex planner.
- A `codex-cli → workbuddy` pairing uses the same Codex planner (coincidentally correct).
- There is no way for ChatGPT Web to serve as the actual source of answers.
- The pairing's `sourceEndpointId` is informational only — it has zero effect on routing.

## Decision

CLI Bridge will make the conversation pairing the **single source of truth** for
routing. The `sourceEndpointId` determines which source adapter handles the
conversation turn. The `targetEndpointId` determines which executor receives
dispatched tasks.

### Routing Model

```text
conversation/messages
  → pairing.sourceEndpointId
  → sourceAdapter.plan()
  → gate evaluator
  → maybe pairing.targetEndpointId dispatch
```

### Source Adapter Interface

Each source endpoint type implements a `ConversationSourceAdapter`:

```ts
interface ConversationSourceAdapter {
  endpointId: string;
  kind: 'chatgpt-web' | 'codex-cli' | 'claude-code' | 'local-workbuddy-status';
  isAvailable(input: SourceAvailabilityInput): boolean;
  plan(input: PlannerRequest): Promise<PlannerOutputEnvelope>;
}

interface SourceAvailabilityInput {
  projectId: string;
  endpointId: string;
  runtime: BridgeRuntime;
}
```

### Source Adapter Registry

```ts
class SourceAdapterRegistry {
  register(adapter: ConversationSourceAdapter): void;
  resolve(endpointId: string): ConversationSourceAdapter | undefined;
  list(): ConversationSourceAdapter[];
}
```

Key properties:
- **No default fallback.** If `resolve(sourceEndpointId)` returns undefined,
  the request is blocked with "source unavailable."
- **Source adapters are configured per-endpoint-type.** ChatGPT Web, Codex CLI,
  and Claude Code each have their own adapter.
- **WorkBuddy status queries** remain a local fast-path adapter for
  `endpointId: 'workbuddy'` but only for status/result queries — never for
  general conversation.

### ChatGPT Web Source Adapter

The ChatGPT Web source adapter is special: it does not run a local planner
command. Instead, it relays the prompt to the ChatGPT Web browser extension,
which submits it to the ChatGPT Web DOM and returns the assistant's response.

Protocol:

```text
POST /bridge/source/chatgpt-web/requests   ← bridge enqueues prompt
GET  /bridge/source/chatgpt-web/next        ← extension polls for prompt
POST /bridge/source/chatgpt-web/results     ← extension returns response
```

Security:
- All source relay endpoints use the existing bridge auth (pairing token or
  console cookie).
- ChatGPT extension claims are scoped to `chatgpt-web` source only.
- Raw tokens never appear in DOM, localStorage, or URL parameters.

### Conversation Transcript Model

The main conversation transcript shows only:

| Role | Visibility | Source |
|------|-----------|--------|
| `user` | user | User input text |
| `planner` | user | Source adapter `visibleText` |
| `target` | user | Real executor output only |
| `bridge` | internal | Route status (not shown to user) |

Transcript events with `visibility: 'internal'` are never rendered in the main
chat surface. This includes:
- `status` events (queued, dispatching, etc.)
- Diagnostic echo results
- Route/action/dispatch state transitions

### Pairing States

```
┌─────────────────────────────────────────────────────┐
│                 Conversation Pairing                  │
├──────────────┬──────────────────────────────────────┤
│ No pairing   │ 409 — "Conversation pairing is not    │
│              │ configured"                           │
│ Source       │ blocked — "Source unavailable"        │
│ unavailable  │ No fallback to default planner        │
│ Source OK,   │ blocked — "Executor unavailable"      │
│ target       │ Source answer still shown when        │
│ unavailable  │ planner intent is 'answer'            │
│ Both OK      │ Full routing: source → gate → target  │
└──────────────┴──────────────────────────────────────┘
```

### Migration Path

1. Create `ConversationSourceAdapter` interface and `SourceAdapterRegistry`.
2. Wrap existing command planners (Codex, Claude) as source adapters.
3. Add ChatGPT Web source adapter (relay protocol + extension handlers).
4. Rewrite `/conversation/messages` to route by `pairing.sourceEndpointId`.
5. Update the project console UI to show source-specific waiting states.
6. Remove `plannerRegistry.defaultPlanner()` and the global planner concept.

### Consequences

- **Positive**: Source endpoints are now first-class citizens. ChatGPT Web can
  serve as a real conversation source, not just a passive relay.
- **Positive**: No more accidental fallback — a misconfigured source is loud
  and explicit, not silent and wrong.
- **Positive**: The architecture is extensible — adding a new source endpoint
  requires only a new adapter, no changes to routing logic.
- **Neutral**: The local WorkBuddy status fast path becomes a source adapter
  (kind: `local-workbuddy-status`) rather than a pre-planner shortcut.
- **Neutral**: Existing command planner adapters must be wrapped, but their
  internal logic is unchanged.
