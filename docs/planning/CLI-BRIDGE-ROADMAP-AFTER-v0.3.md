# CLI Bridge Roadmap after v0.3

## 1. Purpose

This document is the active route alignment document after:

text docs/planning/CLI-BRIDGE-v0.3-PLANNING-HANDOFF.md 

It prevents local agents from using older W1/W2 or pre-v0.3 planning assumptions as the active project state.

Current route anchor:

text commit: 79143b725ae804d5432f72d7cc9678976fef456c handoff: docs/planning/CLI-BRIDGE-v0.3-PLANNING-HANDOFF.md 

## 2. Current Baseline

The project must no longer be treated as:

text W1/W2 blocked pre-Week-3 pre-Packet pre-PendingPrompt pre-loop 

The current state is:

text v0.3 handoff completed with explicit caveats 

v0.3 is not a fully validated real-world closed loop. It is a completed restricted slice with two important blocked validations:

1. real ChatGPT Web manual E2E remains blocked by execution environment;
2. real Codex Managed PTY manual delivery remains blocked / experimental.

Therefore:

text Do not treat v0.3 as fully production-ready. Do treat v0.3 as the current implementation and planning baseline. Do not regress the route to W1/W2. Do not erase the caveats. 

## 3. v0.3 Meaning

v0.3 means:

text Codex -> ChatGPT -> Codex steps are now stateful, auditable, cancellable, and fallback-aware. 

v0.3 does not mean:

text automatic agent loop automatic ChatGPT send unconfirmed prompt delivery fully validated real browser E2E fully validated real Codex Managed PTY delivery 

## 4. v0.3 Delivered Scope

According to CLI-BRIDGE-v0.3-PLANNING-HANDOFF.md, v0.3 delivered the first constrained slice: Bidirectional Loop Orchestration.

Implemented scope:

text InMemoryBridgeLoopStore Codex output -> BridgePacket -> codex-output-ready loop ChatGPT fill action audit event ChatGPT extraction -> Pending Prompt Pending Prompt user confirmation gate confirmed prompt -> AgentAdapter delivery automatic tests for unconfirmed prompt not being delivered 

Extension / Local Server loop bridge scope:

text Bridge Panel still keeps only Fill / Extract / Copy actions Bridge Panel adds loop status display Fill success moves loop UI into awaiting-user-send Extract success moves loop UI into pending-confirmation apps/local-server/src/routes/bridge-loop.ts added as controlled route helper Route helper wraps existing loop store steps only No new HTTP endpoint added by route helper Automatic tests cover controlled loop steps 

## 5. v0.3 Caveats

### 5.1 ChatGPT Web Manual E2E

Status:

text blocked in previous execution environment 

Validated:

text npm run build-extension can generate Chrome extension dist Local Server can start GET /health returns 200 Extension code still contains no auto-send path 

Not validated:

text Codex output filled into ChatGPT User manually sends ChatGPT prompt ChatGPT response extracted into Pending Prompt Bridge Panel loop status changes through the full real page path 

Required future manual checks:

text streaming blocked fallback to final complete assistant response when no selection / marker exists clipboard fallback when composer is unavailable Bridge Panel loop status changes correctly in real ChatGPT page 

### 5.2 Codex Managed PTY Manual Delivery

Status:

text blocked / experimental 

Validated:

text codex CLI exists codex-cli version observed as 0.130.0 automatic tests cover mock managed process start / write / recent output 

Not validated:

text real Managed PTY manual delivery real managed session safety under interactive environment 

Current decision:

text Managed PTY remains experimental. clipboard-first handoff remains the safe primary fallback. Do not add stop session just to validate PTY. Do not add arbitrary shell control. 

## 6. Guardrails That Still Apply

The following remain hard constraints:

text Do not auto-click ChatGPT send. Do not bypass Pending Prompt user confirmation. Do not expose any generic shell endpoint. Do not attach to an existing terminal. Do not add stop-session behavior just to validate Managed PTY. Do not simulate keyboard input. Do not implement automatic agent loop. Do not connect WorkBuddy yet. Do not connect MCP yet. Do not connect Claude Code yet. Do not read app-prompt yet. Do not add GitHub API / CI automatic reading inside the product. Do not add multi-agent selector before endpoint capability gating exists. 

## 7. Revised Route

### v0.3.x — Validation and Handoff Patch Layer

Purpose:

text Close remaining validation gaps without expanding product scope. 

Allowed scope:

text Validate real ChatGPT Web manual E2E if user environment allows it. Validate Bridge Panel loop status on real ChatGPT page. Validate streaming blocked behavior on real ChatGPT page. Validate final assistant fallback extraction on real ChatGPT page. Validate clipboard fallback when composer is unavailable. Reconfirm Managed PTY remains experimental or explicitly freeze it. Update docs if validation succeeds or remains blocked. 

Not allowed:

text No WorkBuddy integration. No Claude Code adapter. No OpenCode / DeepSeek TUI adapter. No MCP. No automatic agent loop. No shell endpoint. No auto-send. No stop session. No attach existing terminal. 

Gate:

text npm run build-extension npm run lint npm run typecheck npm run test manual ChatGPT Web validation when available remote review of pushed commit 

### v0.4 — AgentEndpoint Abstraction

Purpose:

text Generalize the bridge from a fixed ChatGPT Web <-> Codex path into endpoint-based routing. 

Core model:

text sourceEndpoint -> packet -> pending state -> user confirmation -> targetEndpoint 

Deliverables:

text AgentEndpoint AgentEndpointCapabilities EndpointRegistry transport taxonomy capability-gated action exposure MockPromptEndpoint / MockAgentEndpoint tests 

Endpoint candidates:

text chatgpt-web codex-cli clipboard mock-prompt mock-agent 

Capability fields:

text canExecute canReview canSummarize canAcceptPrompt canReturnOutput transport risk 

Transport priority:

text 1. mock 2. clipboard 3. command 4. managed-pty 5. file-protocol 6. web-dom 

Hard boundary:

text v0.4 defines abstraction and mock capability gates. v0.4 must not connect real Claude Code, OpenCode, DeepSeek TUI, or WorkBuddy. v0.4 must not introduce MockReviewEndpoint or review lifecycle; review-related endpoints are deferred to v0.5. 

Gate:

text Endpoint actions cannot be invoked unless capabilities allow them. No generic shell endpoint exists. Mock endpoint roundtrip works. Existing ChatGPT Web bridge tests still pass. Existing PendingPrompt flow still passes. 

### v0.5 — Agent-to-Agent Review Mock Lifecycle

Purpose:

text Support review requests between agents without executing follow-up actions automatically. 

Status:

text completed and closed out in docs/planning/CLI-BRIDGE-v0.5-CLOSEOUT-REVIEW.md; implementation commit 02ab7c522888faea527b6189b88e03b9068b315a 

Initial path:

text MockAgent -> MockReviewAgent 

New concepts:

text AgentReviewRequest AgentReviewResult PendingReview review-only role contract second confirmation for follow-up execution 

Lifecycle:

text draft -> previewed -> confirmed -> sent -> returned cancelled failed 

Safety rules:

text ReviewRequest defaults to review-only. ReviewResult is never auto-executed. ReviewResult is never automatically sent back to the source agent. Follow-up execution prompt requires a second confirmation. All transferred content must pass redaction. Audit events must cover create / preview / confirm / send / return / cancel / fail. 

Gate:

text passed. Mock review lifecycle passes. ReviewResult can produce a next-prompt draft. Next-prompt draft remains pending. No automatic execution. No shell endpoint. No source-agent auto-feedback loop. 

### v0.6 — First Real Review Target: Codex -> Claude Code

Purpose:

text Plan the first real agent-to-agent review path. v0.6 may enter planning only after v0.5 closeout; it must not directly implement a Claude Code adapter. 

Status:

text completed and closed out in docs/planning/CLI-BRIDGE-v0.6-CLOSEOUT-REVIEW.md; implementation commit 0090fe726cf8594a68914f0552cf5d116d0af30e 

Recommended first path:

text Codex output -> Claude Code review 

Reason:

text Codex is the execution-oriented agent. Claude Code is the stronger review target for implementation quality, scope control, and architecture consistency. 

Scope:

text Planning only. Compare controlled transports. Draft review-only prompt contract. Preserve second confirmation. Define how Codex output summary and changed file summary / diff stat may become AgentReviewRequest input. Define how ReviewResult may be captured without auto-execution. Do not auto-send ReviewResult back to Codex. 

Non-goals:

text No direct Claude Code adapter implementation during planning. No Claude Code execution dispatch. No automatic Codex follow-up. No OpenCode. No DeepSeek TUI. No WorkBuddy real integration. No PR automation. No shell endpoint. 

Gate:

text passed. Clipboard-only Codex -> Claude Code review handoff works as a copy-ready review-only payload. ReviewResult parser rejects execution flags. Follow-up prompt requires second confirmation. v0.3 caveats and Claude clipboard E2E risk remain documented. 

### v0.7 — Claude Code -> Codex Review / Execution Feasibility

Purpose:

text Plan reverse review from Claude Code output or plan into Codex feasibility review. v0.7 may enter planning only after v0.6 closeout; it must not directly implement Claude -> Codex. 

Status:

text completed and closed out in docs/planning/CLI-BRIDGE-v0.7-CLOSEOUT-REVIEW.md; implementation commit ead108c53fe61775f91d3cccb2e837233cd5436f 

Scope:

text Planning only. Define Claude Code output / plan input shape. Draft Codex feasibility-only prompt contract. Preserve second confirmation. Define how Codex can assess minimum patch scope and optional next prompt draft without executing. Keep output as pending follow-up. No auto-execution. 

Gate:

text passed. Clipboard-only Claude Code output / plan -> Codex feasibility handoff works as a copy-ready feasibility-only payload. ReviewResult remains non-executing. Execution prompt requires separate confirmation. No command transport, managed PTY expansion, shell endpoint, or source-agent auto feedback was introduced. 

### v0.8 — WorkBuddy State Integration

Purpose:

text Plan WorkBuddy as a project/task context source and review/result sink. v0.8 may enter planning only after v0.7 closeout; it must not directly implement WorkBuddy integration. 

Status:

text completed and closed out in docs/planning/CLI-BRIDGE-v0.8-CLOSEOUT-REVIEW.md; implementation commit d87ba84524b6d61e227580417a99e09953683088 

WorkBuddy roles:

text Project state source Task source Prompt draft source Review result sink Execution ledger sink Next prompt draft sink 

Hard boundary:

text WorkBuddy must not become an execution agent. WorkBuddy must not trigger Codex or Claude automatically. WorkBuddy must not bypass PendingReview / PendingDispatch. WorkBuddy must not become a terminal controller. 

### v0.9 — Additional TUI Agents

Candidates:

text OpenCode DeepSeek TUI other local TUI agents 

Purpose:

text Plan additional TUI agents only after v0.8 closeout. v0.9 must not directly implement OpenCode, DeepSeek, command transport, or managed PTY transport. 

Status:

text completed and closed out in docs/planning/CLI-BRIDGE-v0.9-CLOSEOUT-REVIEW.md; implementation commit bd20c01b0eabdb7285c20d0b3c7c4f5b1c6cb8d6 

Entry condition:

text EndpointRegistry is stable. Mock review lifecycle is stable. Codex -> Claude review is stable. Claude -> Codex review is stable. WorkBuddy state integration is stable. 

Preferred transport:

text clipboard 

Managed PTY is a separately approved fallback only. It must not be the default v0.9 path while the v0.3 Codex Managed PTY real delivery caveat remains active.

Command transport is allowed only if the tool has a stable non-interactive review-only CLI mode and receives separate approval.

### v1.0 — Remote Review Gate Hardening

Purpose:

text Turn GitHub remote verification into a stronger release gate. 

Status:

text completed and closed out in docs/planning/CLI-BRIDGE-v1.0-CLOSEOUT-REVIEW.md; implementation commit 809d32b221697d76abf122cf80f1a58df2264864 

Scope:

text Verify reported commit exists on remote. Verify branch is pushed. Verify remote latest commit matches reported commit. Check PR if present. Check CI / Actions if present. Compare remote diff scope. Block next phase if CI fails. Block next phase if remote commit does not match report. 

Non-goals:

text No automatic PR creation. No automatic merge. No automatic push. No GitHub write automation unless explicitly approved. 

## 8. Immediate Next Step

The immediate next step is not v0.4 implementation.

The immediate next step is:

text v0.3-HANDOFF-REVIEW 

Purpose:

text Review docs/planning/CLI-BRIDGE-v0.3-PLANNING-HANDOFF.md and decide whether the project may enter v0.4 planning. 

Possible verdicts:

text PASS: v0.3 handoff is sufficient; proceed to v0.4 planning. PATCH REQUIRED: v0.3.x validation or documentation patch is needed first. BLOCKED: runtime or safety gate failed and must be fixed before planning forward. 

Expected current verdict:

text PATCH REQUIRED 

Reason:

text v0.3 is completed with caveats, but real ChatGPT Web E2E and real Codex Managed PTY manual delivery are not validated. These do not necessarily block v0.4 planning, but they must remain explicit caveats. 

## 9. Route Summary

text Current: v0.3 handoff completed with caveats Next: v0.3-HANDOFF-REVIEW Then: v0.3.x validation patch if needed Then: v0.4 AgentEndpoint Abstraction Then: v0.5 Agent-to-Agent Review Mock Lifecycle Then: v0.6 Codex -> Claude Code Review Then: v0.7 Claude Code -> Codex Review Then: v0.8 WorkBuddy State Integration Then: v0.9 Additional TUI Agents Then: v1.0 GitHub Remote Review Gate Hardening 

## 10. Deferred List

Remain deferred until explicitly scheduled:

text Real Claude Code Adapter Real Codex Managed PTY expansion OpenCode Adapter DeepSeek TUI Adapter WorkBuddy real integration MCP tools app-prompt integration Automatic PR creation Automatic CI interpretation inside product Automatic merge Automatic push Automatic agent loop Shell endpoint Stop session Attach existing terminal Unconfirmed review-result execution 

## 11. Agent Instruction

Local agents must treat this file as the active post-v0.3 route.

Do not use older W1/W2 blocked status as the active project state.

Do not implement v0.4 until v0.3-HANDOFF-REVIEW has produced a verdict.

Do not erase the v0.3 caveats. The caveats are part of the route boundary.
