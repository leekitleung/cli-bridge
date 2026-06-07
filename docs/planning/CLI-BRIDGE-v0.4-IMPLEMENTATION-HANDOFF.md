# CLI Bridge v0.4 Implementation Handoff

## Status

v0.4 AgentEndpoint Abstraction Minimal Patch is implemented.

This is a PATCH-sized abstraction layer, not a REWORK. Existing ChatGPT Web, PendingPrompt, BridgePacket, Audit, BridgeLoop, extension panel, and adapter behavior remain in place.

## Baseline

- branch: `main`
- implementation started from planning handoff commit: `aa13c2ac4a9d9154f252356f90cf9ec3a6536253`
- v0.4 planning handoff: `docs/planning/CLI-BRIDGE-v0.4-PLANNING-HANDOFF.md`
- v0.3 caveats remain:
  - ChatGPT Web real manual E2E is not validated.
  - Codex Managed PTY real delivery remains experimental.

## Implemented Scope

Shared endpoint types:

- `AgentEndpointTransport`
- `AgentEndpointRisk`
- `EndpointAction`
- `AgentEndpointCapabilities`
- `AgentEndpoint`

Endpoint validation:

- `validateAgentEndpoint`
- `assertAgentEndpoint`

Endpoint registry:

- `InMemoryEndpointRegistry.register`
- `InMemoryEndpointRegistry.get`
- `InMemoryEndpointRegistry.list`
- `InMemoryEndpointRegistry.can`
- `InMemoryEndpointRegistry.validateAction`

Mock endpoint metadata:

- `mock-agent`
- `clipboard`
- `chatgpt-web`
- `codex-cli`

Capability guard behavior:

- duplicate endpoint id returns `duplicate-endpoint-id`.
- unknown endpoint returns `endpoint-not-found`.
- unsupported action returns `capability-denied`.
- `codex-cli` remains `experimental` and cannot execute.
- review capability is false for all v0.4 endpoints.

## Explicitly Not Implemented

v0.4 did not implement:

- MockReviewEndpoint.
- AgentReviewRequest.
- AgentReviewResult.
- PendingReview.
- review lifecycle.
- real Claude Code adapter.
- WorkBuddy integration.
- OpenCode adapter.
- DeepSeek TUI adapter.
- MCP tools.
- app-prompt integration.
- multi-agent selector UI.
- Codex Managed PTY expansion.
- new HTTP route.
- `/exec`, `/shell`, `/run`, or `/command` endpoint.
- shell control.
- automatic agent loop.
- automatic ChatGPT send.
- automatic GitHub / CI reading inside the product.
- automatic PR / merge / push behavior.

Review-related endpoint work remains deferred to v0.5.

## Tests Added

- `tests/endpoint-capabilities.test.mjs`
- `tests/endpoint-registry.test.mjs`

Coverage includes:

- valid endpoint passes validation.
- invalid transport and risk are denied.
- missing capability is denied.
- empty id is denied.
- registry register / list / get works.
- duplicate id is denied.
- unknown endpoint is denied.
- capability false is denied.
- `mock-agent` can accept prompt but cannot review or execute.
- `codex-cli` is experimental and cannot execute.
- `chatgpt-web` can accept prompt and return output.
- no `mock-review-agent`.
- no Claude / WorkBuddy / OpenCode / DeepSeek files.
- no `/exec`, `/shell`, `/run`, or `/command` route.
- templates remain `autoSend: false`.

## Acceptance Gate

The implementation is not complete unless all local gates pass:

- `npm run build-extension`
- `npm run lint`
- `npm run typecheck`
- `npm run test`

The final execution report must include branch, commit, pushed status, remote, PR, Actions, remote verification, skipped scope, and remaining risks.

## Next Step

Proceed to v0.4 closeout / review after the implementation commit is pushed and remote-verified.

Do not begin v0.5 until v0.4 closeout confirms capability gates and deferred review scope.
