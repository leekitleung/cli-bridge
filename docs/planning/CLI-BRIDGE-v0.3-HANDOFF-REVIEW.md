# CLI Bridge v0.3 Handoff Review

## Review Basis

- Roadmap: `docs/planning/CLI-BRIDGE-ROADMAP-AFTER-v0.3.md`
- Handoff: `docs/planning/CLI-BRIDGE-v0.3-PLANNING-HANDOFF.md`
- Baseline commit: `79143b725ae804d5432f72d7cc9678976fef456c`

## Verdict

PATCH REQUIRED.

v0.3 is a completed restricted implementation slice, but it is not a fully validated real-world closed loop. The project may not be treated as production-ready, and local agents must not regress the route to W1/W2 or erase the caveats.

This review does not find a runtime or safety failure that would require BLOCKED. It does find that the post-v0.3 roadmap and this handoff-review record must be tracked before v0.4 planning proceeds.

## Scope Review

Confirmed delivered scope:

- `InMemoryBridgeLoopStore` exists.
- Codex output can become a `BridgePacket` and `codex-output-ready` loop.
- ChatGPT fill action can produce a `fill_chatgpt` audit event.
- ChatGPT extraction can create a Pending Prompt.
- Pending Prompt retains the user confirmation gate.
- Confirmed prompt can be delivered through the existing `AgentAdapter` abstraction.
- Bridge Panel still exposes only `填入 / 提取 / 复制`.
- Bridge Panel displays loop status.
- `apps/local-server/src/routes/bridge-loop.ts` is a controlled helper only, not an HTTP endpoint.

## Caveat Review

Confirmed caveats:

- Real ChatGPT Web manual E2E remains unvalidated.
- Real Codex Managed PTY manual delivery remains blocked / experimental.
- Clipboard-first handoff remains the safe primary fallback.

Required future manual checks:

- Streaming blocked behavior on real ChatGPT Web.
- Final complete assistant fallback when no selection or marker exists.
- Clipboard fallback when composer is unavailable.
- Bridge Panel loop status changes on the real ChatGPT page.
- Real Managed PTY prompt delivery under an interactive environment.

## Guardrail Review

Confirmed guardrails remain intact:

- No automatic ChatGPT send.
- No Pending Prompt confirmation bypass.
- No generic shell endpoint.
- No attach existing terminal.
- No stop session behavior.
- No keyboard simulation.
- No automatic agent loop.
- No WorkBuddy integration.
- No MCP integration.
- No Claude Code integration.
- No app-prompt integration.
- No GitHub API / CI automatic reading inside the product.
- No multi-agent selector.

## Patch Applied

This review records the active post-v0.3 route and preserves v0.3 caveats as route boundaries. It does not implement v0.4.

## v0.4 Planning Gate

v0.4 planning may begin only after this review record and the post-v0.3 roadmap are committed and remote-verified.

v0.4 implementation remains out of scope for this review.
