# CLI Bridge v0.4 Planning Handoff

## 1. Verdict

Status: PASS for planning.

v0.4 may enter implementation planning, but v0.4 implementation has not started and requires a separate goal.

v0.4 is a PATCH-sized abstraction layer. It is not a REWORK and must not rewrite the existing ChatGPT Web, PendingPrompt, BridgePacket, Audit, or BridgeLoop paths.

v0.3 caveats remain active:

1. ChatGPT Web real manual E2E is not validated.
2. Codex Managed PTY real delivery remains experimental.

Repository baseline for this handoff:

- branch: `main`
- latest remote commit before this handoff: `c881e2d3ebd67ab62fa1116a408e18281e7400c4`
- v0.3-HANDOFF-REVIEW: completed
- v0.4 planning verdict: PASS for planning
- v0.4 implementation: not started

## 2. Current Architecture Reading

Current implemented architecture:

- `BridgePacket` is the redacted transfer unit. It stores `processedContent`, uses memory-only `rawContentRef`, includes metrics and safety metadata, and rejects persisted `rawContent`.
- `PendingPrompt` is the confirmation gate. It remains draft / previewed / confirmed / sent / failed / cancelled, and confirmed prompts are the only prompts that can be delivered.
- `AgentAdapter` is a delivery interface with `name` and `sendPrompt(prompt)`.
- `MockAgentAdapter` is the current stable test adapter. It records delivered prompts and does not execute anything.
- `CodexManagedPtyAdapter` exists, but real Managed PTY delivery is still experimental. It must not be expanded in v0.4.
- `InMemoryBridgeLoopStore` makes Codex -> ChatGPT -> Codex steps stateful and auditable.
- Templates support `review-cli-output` and `generate-codex-prompt`; preview output is explicitly `autoSend: false`.
- Audit and redaction are tied to packet and prompt lifecycle events.
- The extension Bridge Panel still exposes only `填入 / 提取 / 复制` and a loop status display. It does not auto-send ChatGPT messages.

Important missing document:

- `docs/planning/CLI-BRIDGE-AGENT-TO-AGENT-REVIEW-PLAN.md` does not exist in the repository. Local agents must not infer review planning from that missing file.

## 3. v0.4 Problem Statement

The current bridge still uses fixed source and target concepts such as `codex`, `chatgpt-web`, and `clipboard`.

The existing `AgentAdapter` is not enough to represent an endpoint because it only covers prompt delivery. It does not describe endpoint identity, capability, risk, or transport.

v0.4 must introduce a thin endpoint abstraction so future routes can be capability-gated before any UI, route helper, or adapter exposes an action.

The real problem is not routing many agents. The real problem is proving that actions are denied unless the target endpoint explicitly supports them.

Directly connecting Claude Code, WorkBuddy, OpenCode, or DeepSeek TUI before this abstraction would risk:

- bypassing PendingPrompt confirmation;
- expanding transport scope;
- exposing review or execute actions too early;
- creating a multi-agent selector before endpoint capability gates exist;
- weakening the no-shell-endpoint boundary.

## 4. v0.4 Scope

v0.4 includes only:

- AgentEndpoint concept.
- AgentEndpointCapabilities.
- EndpointRegistry minimal contract.
- transport taxonomy.
- MockPromptEndpoint / MockAgentEndpoint.
- capability guard checks.
- automatic tests.
- planning and handoff documentation.

v0.4 implementation should preserve existing main paths:

- ChatGPT Web panel remains usable.
- Fill / Extract / Copy are not reworked.
- PendingPrompt still requires confirmation before delivery.
- Packet / Redaction / Audit are not bypassed.
- MockAgentAdapter tests remain valid.
- Codex Managed PTY remains experimental.

## 5. Hard Non-Goals

v0.4 must not include:

- UI multi-agent selector.
- real Claude Code adapter.
- real WorkBuddy integration.
- real OpenCode adapter.
- real DeepSeek TUI adapter.
- MCP tools.
- app-prompt integration.
- review lifecycle.
- MockReviewEndpoint.
- AgentReviewRequest.
- AgentReviewResult.
- PendingReview.
- GitHub API / CI automatic reading inside the product.
- automatic ChatGPT send.
- automatic agent loop.
- shell endpoint.
- `/exec`, `/shell`, `/run`, or `/command` endpoint.
- stop session.
- attach existing terminal.
- Codex Managed PTY expansion.

Review-related endpoint work is deferred to v0.5.

## 6. AgentEndpoint Contract Draft

Suggested type shape for implementation planning only:

```ts
type AgentEndpointTransport =
  | 'mock'
  | 'clipboard'
  | 'command'
  | 'managed-pty'
  | 'file-protocol'
  | 'web-dom';

type AgentEndpointRisk = 'low' | 'medium' | 'high' | 'experimental';

type AgentEndpointCapabilities = {
  canAcceptPrompt: boolean;
  canReturnOutput: boolean;
  canReview: boolean;
  canExecute: boolean;
  canSummarize: boolean;
};

type AgentEndpoint = {
  id: string;
  label: string;
  transport: AgentEndpointTransport;
  risk: AgentEndpointRisk;
  capabilities: AgentEndpointCapabilities;
  adapterName?: string;
  experimental?: boolean;
};
```

Field intent:

- `id`: stable registry key.
- `label`: reader-facing name only; not used for permission checks.
- `transport`: declares the endpoint transport class.
- `risk`: keeps experimental and high-risk endpoints visible.
- `capabilities`: gates all exposed actions.
- `adapterName`: optional link to an existing `AgentAdapter`.
- `experimental`: explicit caveat marker, especially for Managed PTY.

Fields deferred from v0.4:

- credentials;
- command args;
- UI placement;
- routing priority;
- review role contracts;
- endpoint health checks.

## 7. EndpointRegistry Minimal Contract

Minimum responsibilities:

- `register(endpoint)`
- `get(endpointId)`
- `list()`
- `can(endpointId, action)`
- `validateAction(endpointId, action)`

The registry should only answer whether an endpoint exists and whether an action is allowed by capability.

The registry must not:

- execute prompts;
- read shell output;
- own transport details;
- own UI workflow;
- auto-select an agent;
- implement review lifecycle;
- create shell, exec, run, or command endpoints.

## 8. Relationship to Existing AgentAdapter

`AgentAdapter` should remain.

`AgentEndpoint` should describe endpoint identity, transport, risk, and capabilities. `AgentAdapter` should remain the delivery mechanism for confirmed prompts.

Recommended relationship:

- AgentEndpoint describes what an endpoint may do.
- EndpointRegistry validates whether an action may be exposed.
- AgentAdapter performs prompt delivery after confirmation.
- PendingPromptStore keeps the confirmation and send lifecycle.
- BridgeLoopStore keeps the current workflow orchestration.

`MockAgentAdapter` can be associated with a MockAgentEndpoint or MockPromptEndpoint.

`CodexManagedPtyAdapter` remains experimental and should not be expanded in v0.4.

No migration is required in v0.4. Add a thin abstraction and guard tests first.

## 9. Task Breakdown

### V4-0 Baseline Audit

Objective: confirm v0.3 baseline and forbidden scope.

Allowed files:

- `docs/planning/*`

Forbidden files:

- product source unless a later implementation task explicitly needs it.

Steps:

1. Confirm current branch and remote state.
2. Confirm v0.3 caveats remain documented.
3. Confirm `CLI-BRIDGE-AGENT-TO-AGENT-REVIEW-PLAN.md` is absent or, if later added, is not treated as v0.4 scope.

Tests:

- `npm run build-extension`
- `npm run lint`
- `npm run typecheck`
- `npm run test`

Acceptance criteria:

- v0.4 implementation boundary is clear.

### V4-1 Shared Endpoint Types

Objective: add endpoint types only.

Allowed files:

- `packages/shared/src/types.ts`
- `packages/shared/src/schemas.ts`
- `tests/*`

Forbidden files:

- `apps/extension/src/ui/*`
- real adapter files for Claude, WorkBuddy, OpenCode, or DeepSeek.

Steps:

1. Add transport, risk, capability, endpoint, and action types.
2. Add schema validation if runtime validation is needed.
3. Add tests for valid and invalid endpoint capability shapes.

Acceptance criteria:

- no behavior change;
- no real endpoint integration.

### V4-2 EndpointRegistry

Objective: add a minimal in-memory endpoint registry and capability guard.

Allowed files:

- `apps/local-server/src/endpoints/*`
- `tests/*`

Forbidden files:

- HTTP route endpoints;
- shell execution files;
- UI selector files.

Steps:

1. Implement register / get / list.
2. Implement `can` or equivalent capability guard.
3. Implement denied-result behavior for unsupported actions.

Acceptance criteria:

- unknown endpoint denied;
- false capability denied;
- no generic shell endpoint exists.

### V4-3 Mock Prompt / Mock Agent Endpoint

Objective: register only mock prompt / mock agent endpoints.

Allowed files:

- `apps/local-server/src/endpoints/*`
- existing mock adapter only if a thin association is necessary;
- `tests/*`

Forbidden:

- MockReviewEndpoint.
- review lifecycle.
- real Claude / WorkBuddy / OpenCode / DeepSeek files.

Steps:

1. Register MockPromptEndpoint or MockAgentEndpoint.
2. Set `canAcceptPrompt: true`.
3. Keep review-related capabilities false.

Acceptance criteria:

- mock endpoint can accept prompt only when capability allows it;
- review action denied because v0.4 has no review endpoint.

### V4-4 Capability Guard Tests

Objective: prove capability-gated action exposure works.

Allowed files:

- `tests/*`

Forbidden:

- UI selector.
- real endpoint integrations.

Test requirements:

- action denied when capability false;
- review denied in v0.4;
- execute denied unless explicitly supported by mock-only endpoint;
- no WorkBuddy / Claude / OpenCode / DeepSeek files introduced;
- no shell / exec / run / command route introduced.

### V4-5 v0.4 Closeout Handoff

Objective: update planning docs after v0.4 implementation.

Allowed files:

- `docs/planning/*`

Steps:

1. Record completed scope.
2. Preserve v0.3 caveats.
3. Record v0.5 review lifecycle as deferred.
4. Run full local gate.
5. Commit, push, and remote-verify.

Acceptance criteria:

- v0.4 is complete only if endpoint abstraction and capability gates are tested.

## 10. Test Strategy

Required v0.4 tests:

- endpoint capability schema accepts a valid endpoint.
- endpoint capability schema rejects invalid transport / risk / capability values.
- registry register / list / get works.
- duplicate endpoint id is rejected or deterministically replaced by documented behavior.
- unknown endpoint action is denied.
- action denied when capability is false.
- MockPromptEndpoint or MockAgentEndpoint can accept prompt only when `canAcceptPrompt` is true.
- review action is denied because v0.4 has no review endpoint.
- no MockReviewEndpoint file, type, or registration exists.
- no shell endpoint exists.
- no `/exec`, `/shell`, `/run`, or `/command` endpoint exists.
- existing PendingPrompt tests pass.
- existing BridgeLoop tests pass.
- existing ChatGPT DOM tests pass.
- templates remain `autoSend: false`.
- no WorkBuddy / Claude / OpenCode / DeepSeek files are introduced.

## 11. Acceptance Gates

v0.4 implementation cannot close until:

- `npm run build-extension` passes.
- `npm run lint` passes.
- `npm run typecheck` passes.
- `npm run test` passes.
- endpoint capability guard tests pass.
- no shell / exec / run / command endpoint exists.
- no real Claude / WorkBuddy / OpenCode / DeepSeek files are introduced.
- no MockReviewEndpoint exists.
- review lifecycle remains deferred to v0.5.
- existing ChatGPT Web bridge tests still pass.
- existing PendingPrompt flow tests still pass.
- existing BridgeLoop tests still pass.
- templates still have `autoSend: false`.
- v0.3 caveats remain in docs.
- commit and push complete.
- local `HEAD` equals remote `refs/heads/main`.

## 12. Risks

- Abstraction too broad: too many endpoint fields would become a platform rewrite.
- Multi-agent selector creep: a UI selector would imply product readiness before capability gates mature.
- AgentEndpoint / AgentAdapter overlap: endpoint must describe capability; adapter must deliver after confirmation.
- Managed PTY confusion: Codex Managed PTY must remain experimental.
- Review flow creep: MockReviewEndpoint, PendingReview, and review lifecycle belong to v0.5, not v0.4.
- UI complexity increase: v0.4 should not add new UI.
- Security boundary bypass: capability names must not justify shell execution or unconfirmed prompt delivery.
- Missing review-plan file: local agents must not infer review scope from `CLI-BRIDGE-AGENT-TO-AGENT-REVIEW-PLAN.md` because it is not present.

## 13. Deferred List

Deferred until explicitly scheduled:

- MockReviewEndpoint.
- AgentReviewRequest.
- AgentReviewResult.
- PendingReview.
- review lifecycle.
- real Claude Code adapter.
- real WorkBuddy integration.
- real OpenCode adapter.
- real DeepSeek TUI adapter.
- MCP tools.
- app-prompt integration.
- GitHub API / CI automatic reading inside the product.
- UI multi-agent selector.
- automatic ChatGPT send.
- automatic agent loop.
- shell endpoint.
- stop session.
- attach existing terminal.
- Codex Managed PTY expansion.

## 14. Next Action

Create a separate v0.4 implementation goal.

The implementation goal should only execute:

```text
V4-1 shared endpoint types -> V4-2 EndpointRegistry -> V4-3 MockPromptEndpoint / MockAgentEndpoint -> V4-4 capability guard tests -> V4-5 closeout docs
```

Do not start v0.4 implementation without that separate goal.
