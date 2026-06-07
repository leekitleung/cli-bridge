# CLI Bridge v0.5 Planning Handoff

## 1. Verdict

Status: PASS for planning.

v0.5 may enter planning after v0.4 closeout. v0.5 implementation has not started and requires a separate goal.

v0.5 is a mock review lifecycle planning phase. It must not connect real Claude Code, WorkBuddy, OpenCode, DeepSeek TUI, MCP, or app-prompt.

## 2. Baseline

Current baseline:

- v0.4 closeout: PASS.
- v0.4 implemented endpoint metadata and capability gates.
- v0.4 did not implement review lifecycle.
- v0.4 did not implement MockReviewEndpoint.

v0.3 caveats remain:

- ChatGPT Web real manual E2E is not validated.
- Codex Managed PTY real delivery remains experimental.

Missing planning source:

- `docs/planning/CLI-BRIDGE-AGENT-TO-AGENT-REVIEW-PLAN.md` still does not exist. v0.5 planning must be based on current roadmap and v0.4 closeout, not on an absent file.

## 3. v0.5 Goal

v0.5 should introduce a mock agent-to-agent review lifecycle without executing follow-up actions automatically.

Initial path:

```text
MockAgent -> MockReviewAgent
```

The purpose is to model review-only handoff and result capture before any real review target is connected.

## 4. Proposed v0.5 Scope

v0.5 may include:

- `AgentReviewRequest`
- `AgentReviewResult`
- `PendingReview`
- review-only role contract
- MockReviewEndpoint
- review lifecycle state machine
- second confirmation for follow-up execution prompt
- tests
- docs / closeout handoff

Lifecycle:

```text
draft -> previewed -> confirmed -> sent -> returned -> cancelled -> failed
```

Review result handling:

- ReviewResult may produce a next-prompt draft.
- Next-prompt draft must remain pending.
- Follow-up execution prompt requires a separate confirmation.

## 5. Hard Non-Goals

v0.5 must not include:

- real Claude Code adapter.
- real WorkBuddy integration.
- real OpenCode adapter.
- real DeepSeek TUI adapter.
- MCP tools.
- app-prompt integration.
- shell endpoint.
- `/exec`, `/shell`, `/run`, or `/command` endpoint.
- stop session.
- attach existing terminal.
- Codex Managed PTY expansion.
- automatic ChatGPT send.
- automatic agent loop.
- automatic source-agent feedback loop.
- automatic execution of ReviewResult.
- automatic sending of ReviewResult back to the source agent.
- PR automation.
- GitHub API / CI automatic reading inside the product.

## 6. Relationship to v0.4

v0.4 endpoint capability gates must be used to deny review actions unless the target endpoint explicitly supports review.

v0.5 may introduce a MockReviewEndpoint because v0.4 closeout has completed and review lifecycle is now the scheduled scope.

v0.5 must not mutate existing v0.4 endpoints into review endpoints unless the change is explicit, tested, and mock-only.

Recommended relationship:

- AgentEndpoint describes review capability.
- EndpointRegistry validates whether review action can be exposed.
- PendingReview owns review request lifecycle.
- PendingPrompt remains separate and still gates execution prompts.
- ReviewResult can create a PendingPrompt draft, but cannot confirm or send it.

## 7. Contract Draft

Suggested planning-only type shape:

```ts
type AgentReviewStatus =
  | 'draft'
  | 'previewed'
  | 'confirmed'
  | 'sent'
  | 'returned'
  | 'cancelled'
  | 'failed';

type AgentReviewRequest = {
  id: string;
  sessionId: string;
  sourceEndpointId: string;
  targetEndpointId: string;
  packetId: string;
  status: AgentReviewStatus;
  prompt: string;
  createdAt: number;
  updatedAt: number;
  confirmedAt?: number;
  sentAt?: number;
  returnedAt?: number;
  cancelledAt?: number;
  failedAt?: number;
  failureReason?: string;
};

type AgentReviewResult = {
  id: string;
  reviewRequestId: string;
  summary: string;
  findings: string[];
  nextPromptDraft?: string;
  createdAt: number;
};
```

Fields to defer:

- severity taxonomy.
- file-level inline comments.
- reviewer identity beyond endpoint id.
- real transport metadata.
- PR / GitHub references.

## 8. Task Breakdown

### V5-0 Baseline Audit

Objective: confirm v0.4 closeout and active caveats.

Allowed files:

- docs only.

Acceptance:

- v0.5 implementation goal starts from v0.4 closeout commit.

### V5-1 Review Types and Schema

Objective: define review request/result types and validators.

Allowed files:

- `packages/shared/src/types.ts`
- `packages/shared/src/schemas.ts`
- tests

Acceptance:

- invalid status denied.
- missing source/target endpoint denied.
- ReviewResult cannot be marked executable.

### V5-2 PendingReview Store

Objective: implement mock review lifecycle.

Allowed files:

- `apps/local-server/src/storage/*`
- tests

Acceptance:

- draft / preview / confirm / send / return / cancel / fail covered.
- unconfirmed review cannot be sent.
- returned review does not auto-create confirmed prompt.

### V5-3 MockReviewEndpoint

Objective: add mock-only review endpoint.

Allowed files:

- `apps/local-server/src/endpoints/*`
- tests

Acceptance:

- review capability true only for MockReviewEndpoint.
- execute capability false.
- no real Claude / WorkBuddy / OpenCode / DeepSeek endpoint.

### V5-4 Review Result to Next Prompt Draft

Objective: allow ReviewResult to produce a next PendingPrompt draft.

Allowed files:

- storage / tests

Acceptance:

- next prompt remains draft.
- second confirmation required before delivery.
- no automatic source-agent feedback loop.

### V5-5 v0.5 Closeout

Objective: document completed mock review lifecycle and deferred real integrations.

Allowed files:

- docs/planning

Acceptance:

- full gate passes.
- commit + push + remote verified.

## 9. Test Strategy

Required tests:

- ReviewRequest schema accepts valid draft.
- invalid review status rejected.
- sourceEndpointId and targetEndpointId required.
- review action denied when target endpoint cannot review.
- MockReviewEndpoint can review but cannot execute.
- unconfirmed PendingReview cannot be sent.
- confirmed PendingReview can be sent to MockReviewEndpoint.
- ReviewResult is returned and stored.
- ReviewResult is never auto-executed.
- ReviewResult is never automatically sent back to the source agent.
- ReviewResult nextPromptDraft creates only a PendingPrompt draft.
- next PendingPrompt requires second confirmation before delivery.
- redaction applies to review request content.
- audit events cover create / preview / confirm / send / return / cancel / fail.
- no shell endpoint.
- no real Claude / WorkBuddy / OpenCode / DeepSeek files.
- existing v0.4 endpoint guard tests still pass.
- existing PendingPrompt and BridgeLoop tests still pass.

## 10. Acceptance Gates

v0.5 implementation cannot close until:

- `npm run build-extension` passes.
- `npm run lint` passes.
- `npm run typecheck` passes.
- `npm run test` passes.
- mock review lifecycle tests pass.
- review result cannot auto-execute.
- follow-up execution prompt requires second confirmation.
- no shell / exec / run / command endpoint exists.
- no real Claude / WorkBuddy / OpenCode / DeepSeek integration exists.
- v0.3 caveats remain documented.
- v0.4 endpoint guard behavior remains intact.
- commit + push complete.
- local `HEAD` equals remote `refs/heads/main`.

## 11. Risks

- Review lifecycle may blur into execution lifecycle.
- ReviewResult may be treated as an execution command.
- MockReviewEndpoint may invite premature Claude Code integration.
- Follow-up prompt may bypass second confirmation if lifecycle is not explicit.
- Audit events may become incomplete if create / return / fail are not all covered.
- Redaction could be bypassed if review request content does not go through BridgePacket.
- UI pressure may introduce a multi-agent selector too early.

## 12. Deferred List

Deferred until later phases:

- real Claude Code adapter.
- Codex -> Claude real review.
- Claude -> Codex feasibility review.
- WorkBuddy state integration.
- OpenCode adapter.
- DeepSeek TUI adapter.
- MCP tools.
- app-prompt integration.
- GitHub API / CI automatic reading inside product.
- automatic source-agent feedback.
- automatic execution.
- shell endpoint.
- stop session.
- attach existing terminal.

## 13. Next Action

Create a separate v0.5 implementation goal.

Do not begin v0.5 implementation without explicit approval.
