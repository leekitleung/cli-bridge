# Dual-Endpoint Automation Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers:subagent-driven-development` or `superpowers:executing-plans` to
> implement one authorized EX batch at a time. Return to the named REVIEW batch
> before starting the next EX batch.

Status: BLOCKED-ON-REAL-EVIDENCE

Date: 2026-06-20

**Goal:** Route either a high-tier CLI model or ChatGPT Web through one
middle-layer control plane to a fixed medium/low execution endpoint, with
immutable bindings and human confirmation before every execution dispatch.

**Architecture:** Extend the existing Goal/Plan/PlanStep and AgentEndpoint
contracts instead of creating a second workflow. Normalize all upper reasoning
routes into provider-neutral artifacts, then create single-use execution
proposals governed by the project console and dispatched only through bounded
registered adapters.

**Tech Stack:** TypeScript, Node.js HTTP server, existing shared schemas and
stores, React extension UI, Node test runner, Chrome-for-Testing release harness.

---

## Preconditions

Execution is blocked until all of the following are true:

1. ADR-0024 is explicitly accepted by the operator.
2. The reviewing agent changes this RP status to `READY-FOR-EX-A`.
3. The dirty working tree is inspected and the authorized batch can be applied
   without overwriting unrelated Stage A/B/C/D work.

Acceptance of ADR-0024 authorizes only EX-A. Each later batch requires the prior
REVIEW result to pass and update this plan's active gate.

## Global Boundaries

All batches must preserve these rules:

- reuse Goal/Plan/PlanStep as the workflow owner;
- route both CLI and ChatGPT Web reasoning through the middle layer;
- lock reasoning endpoint, execution endpoint, tiers, project, permissions,
  limits, and deadline for the life of a plan;
- require one-time human confirmation for every execution dispatch;
- pause on ambiguity or failure and never retry automatically;
- keep the project console authoritative;
- keep current WorkBuddy identity at `canExecute=false`;
- preserve ADR-0023 DOM submission, relay, routing, and loop behavior;
- no generic shell, arbitrary argv, permission bypass, auto Git, deployment,
  dynamic routing, failover, or parallel execution.

No EX batch may commit, push, merge, create a PR, or continue into the next batch
without explicit user authorization and the required REVIEW gate.

## Target File Map

The exact file set is refined by each REVIEW gate. The intended ownership is:

- `packages/shared/src/types.ts` and `packages/shared/src/schemas.ts`: common
  binding, artifact, proposal, confirmation, and state contracts.
- `apps/local-server/src/storage/automation-binding-store.ts`: immutable binding
  persistence and lineage.
- `apps/local-server/src/storage/execution-proposal-store.ts`: proposal,
  confirmation, dispatch, and terminal-state transitions.
- `apps/local-server/src/goal/goal-orchestrator.ts`: integrate the new records
  into existing PlanStep ownership and pause/cancel precedence.
- `apps/local-server/src/reasoning/`: provider-neutral reasoning adapter
  contract and transport-specific normalization.
- `apps/local-server/src/execution/`: bounded execution adapter contract and
  confirmation-bound dispatch coordinator.
- `apps/local-server/src/routes/bridge-api.ts`: project-scoped control APIs.
- `apps/local-server/src/routes/console-goals.ts`: authoritative confirmation
  and control UI.
- extension UI files: status mirror and emergency pause/resume/cancel only.
- `scripts/dual-endpoint-release-e2e.ts`: sanitized real-chain evidence.

New files should remain narrow. Existing large route files may be modified only
for wiring; state transition logic belongs in focused stores/coordinators.

## EX-A - Contracts and Immutable Binding State

**Outcome:** A Plan can hold one validated, immutable dual-endpoint binding with
lineage, limits, project reference, permission profile, and binding hash. This
batch creates no reasoning or execution transport.

### Allowed Files

- `packages/shared/src/types.ts`
- `packages/shared/src/schemas.ts`
- `apps/local-server/src/storage/automation-binding-store.ts`
- `apps/local-server/src/storage/json-snapshot-store.ts`
- `apps/local-server/src/storage/goal-store.ts`
- `apps/local-server/src/goal/goal-orchestrator.ts`
- `apps/local-server/src/routes/bridge-api.ts`
- focused tests named `*automation-binding*`, `*goal-store*`, or
  `*bridge-goals-api*`

### Required Steps

- [ ] Write failing tests for two freely paired compatible endpoints, separate
  profiles of the same provider, missing capabilities, tier mismatch, unknown
  project reference, invalid limits, hash mismatch, and post-lock mutation.
- [ ] Add schemas for `RunEndpointBinding` and derived-plan lineage. Require one
  high-tier reasoning endpoint and one medium/low execution endpoint with
  `canExecute=true`.
- [ ] Store endpoint ids and server-resolved references only. Do not copy secret
  provider configuration or raw filesystem data into the binding.
- [ ] Compute a deterministic binding hash over all authority-bearing fields.
- [ ] Lock the binding when its Plan is approved. Reject mutation after lock.
- [ ] Derive endpoint or permission changes into a new Plan with `parentPlanId`;
  do not alter the old Plan.
- [ ] Expose project-scoped create, inspect, and derive APIs without adding a
  dispatch route.
- [ ] Prove pause/cancel remains server-owned and wins before PlanStep advance.

### Forbidden Scope

- invoking Codex, Claude, ChatGPT, WorkBuddy, or any model API;
- execution proposal or confirmation behavior;
- console or extension UI changes;
- ChatGPT relay, DOM, loop, or routing changes.

### Verification

```bash
npm run typecheck
node --experimental-strip-types --test tests/*automation-binding*.test.mjs tests/goal-store.test.mjs tests/bridge-goals-api.test.mjs
npm test
rg -n "shell: *true|dangerously|bypass|requestSubmit|KeyboardEvent|\.submit\(" packages/shared/src apps/local-server/src
git diff --check
```

### REVIEW-A Gate

Review the real diff, affected Goal/Plan call chain, schema rejection cases,
binding hash coverage, lineage, pause/cancel precedence, and absence of provider
invocation. PASS changes the RP status to `READY-FOR-EX-B`.

## EX-B - Provider-Neutral Reasoning Artifacts

**Outcome:** Existing high-tier Codex/Claude planning or review paths and the
existing ChatGPT Web return path can each produce the same bounded
`ReasoningArtifact`. Neither path can execute or choose an executor.

### Allowed Files

- `packages/shared/src/types.ts`
- `packages/shared/src/schemas.ts`
- `apps/local-server/src/model/provider-interface.ts`
- `apps/local-server/src/model/planner-model.ts`
- `apps/local-server/src/adapters/command-review-adapter.ts`
- new focused files under `apps/local-server/src/reasoning/`
- `apps/local-server/src/goal/goal-plan-parser.ts`
- `apps/local-server/src/goal/goal-orchestrator.ts`
- `apps/local-server/src/storage/goal-store.ts`
- `apps/local-server/src/routes/bridge-api.ts`
- focused tests named `*reasoning-artifact*`, `*model-api*`,
  `*goal-orchestrator*`, or `*inbound-routing*`

### Required Steps

- [ ] Write failing conformance tests that feed equivalent plan/review results
  through CLI and ChatGPT transports and assert the same artifact envelope.
- [ ] Define a `ReasoningAdapter` that accepts the locked Plan binding and
  returns only `plan-draft`, `review-result`, or `execution-proposal` data.
- [ ] Normalize existing high-tier Codex and Claude review/planning output
  without granting their reasoning profiles execution authority.
- [ ] Correlate an ADR-0023 ChatGPT return to its locked Plan and normalize the
  already sanitized inbound result. Do not add new page automation.
- [ ] Validate hashes, goal/plan identity, endpoint identity, artifact kind,
  size limits, and schema before persistence.
- [ ] Reject any artifact field that tries to select an executor, permission
  profile, working directory, approval, executable, or arbitrary argv.
- [ ] On parse, timeout, correlation, or capability failure, pause the Plan and
  create no follow-up artifact automatically.

### Forbidden Scope

- execution process creation or dispatch;
- automatic retry or provider fallback;
- ChatGPT DOM selectors, send logic, loop policy, or extension routing;
- promoting WorkBuddy or model API endpoints to `canExecute=true`.

### Verification

```bash
npm run typecheck
node --experimental-strip-types --test tests/*reasoning-artifact*.test.mjs tests/model-api.test.mjs tests/goal-orchestrator.test.mjs tests/inbound-routing-e2e.test.mjs
npm test
npm run build-extension
rg -n "canExecute: *true|shell: *true|requestSubmit|KeyboardEvent|\.submit\(" apps/local-server/src/reasoning apps/local-server/src/model apps/extension/src
git diff --check
```

### REVIEW-B Gate

Review transport parity, content-size and schema limits, endpoint correlation,
failure pause behavior, and ADR-0023 boundaries. PASS changes the RP status to
`READY-FOR-EX-C`.

## EX-C - Execution Proposal, Confirmation, and Dispatch

**Outcome:** A reasoning artifact may create a bounded proposal for the locked
execution endpoint. Only a current, single-use, content-bound human confirmation
may dispatch it through a registered adapter.

### Allowed Files

- `packages/shared/src/types.ts`
- `packages/shared/src/schemas.ts`
- `apps/local-server/src/storage/execution-proposal-store.ts`
- new focused files under `apps/local-server/src/execution/`
- `apps/local-server/src/adapters/command-runner.ts`
- existing Codex/Claude adapter files only where bounded dispatch requires it
- `apps/local-server/src/storage/provider-capability.ts`
- `apps/local-server/src/goal/goal-orchestrator.ts`
- `apps/local-server/src/routes/bridge-api.ts`
- focused tests named `*execution-proposal*`, `*command-runner*`,
  `*goal-orchestrator*`, or `*provider-capability*`

### Required Steps

- [ ] Write failing transition tests for draft, awaiting confirmation,
  confirmed, dispatching, returned, failed, paused, cancelled, and timed out.
- [ ] Test stale, replayed, edited, wrong-plan, wrong-step, wrong-content,
  wrong-binding, expired, cancelled, and post-pause confirmations.
- [ ] Persist a proposal preview and content hash without persisting provider
  credentials or unredacted model transcripts.
- [ ] Bind confirmation to Plan, step, proposal, artifact content, binding hash,
  endpoint, permission profile, project, and expiration.
- [ ] Make edit create a new proposal id and invalidate the old confirmation.
- [ ] Dispatch only to the execution endpoint in the locked binding and only
  after rechecking current capabilities and pause/cancel state.
- [ ] Keep provider invocation inside bounded adapters using `shell:false` and
  fixed executable/flag allowlists. Reject arbitrary executable and argv input.
- [ ] Treat uncertain process creation or result correlation as paused. Never
  replay automatically.
- [ ] Leave current WorkBuddy identity non-executing and prove rejection in a
  focused test.

### Forbidden Scope

- generic shell, terminal, MCP, workspace, or browser-computer APIs;
- dangerous permission-bypass flags;
- automatic commit, push, merge, PR creation, or deployment;
- batch approval, confirmation reuse, dynamic routing, or fallback;
- WorkBuddy execution adapter implementation.

### Verification

```bash
npm run typecheck
node --experimental-strip-types --test tests/*execution-proposal*.test.mjs tests/*command-runner*.test.mjs tests/goal-orchestrator.test.mjs tests/*provider-capability*.test.mjs
npm test
rg -n "shell: *true|--dangerously|--yolo|--full-auto|child_process|exec\(|execSync\(|spawn\(" apps/local-server/src/execution apps/local-server/src/adapters
git diff --check
```

The boundary scan is reviewed semantically: approved `spawn` use must remain in
the bounded runner with `shell:false`; any generic execution surface fails.

### REVIEW-C Gate

Review every dispatch call chain, transition atomicity, confirmation binding,
adapter flags, timeout uncertainty, WorkBuddy rejection, and pause/cancel
precedence. PASS changes the RP status to `READY-FOR-EX-D`.

## EX-D - Authoritative Console and Extension Mirror

**Outcome:** The project console exposes complete start and execution confirmation
cards. The extension mirrors state and offers pause/resume/cancel without gaining
endpoint or permission authority.

### Allowed Files

- `apps/local-server/src/routes/console-goals.ts`
- `apps/local-server/src/routes/bridge-api.ts` only for UI-facing API wiring
- existing project-console tests
- `apps/extension/src/ui/bridge-panel.tsx`
- `apps/extension/src/ui/state.ts`
- `apps/extension/src/content/bridge-client.ts` only for status/control calls
- focused tests named `*console-goals-ui*`, `*extension*control*`, or
  `*bridge-client*`

### Required Steps

- [x] Write failing UI tests for the complete start-binding card and complete
  per-proposal confirmation card.
- [x] Show endpoint ids, roles, tier/model profiles, prompt preview/hash,
  project, working directory, permission profile, step, round, limits, and
  deadline before confirmation.
- [x] Implement confirm, edit, cancel, pause, and resume through server APIs.
- [x] Disable stale controls and refresh from server state after every action.
- [x] Mirror current binding identities, step, round, state, and pending
  confirmation in the extension.
- [x] Limit extension actions to pause, resume, and cancel. Prove it cannot send
  endpoint ids, permissions, project roots, proposal edits, or confirmations.
- [x] Keep secrets, raw transcripts, cookies, and pairing tokens out of rendered
  diagnostics and screenshots.

### Forbidden Scope

- DOM submission, outbound polling, loop policy, inbound routing, or pairing
  behavior changes;
- endpoint selection or execution confirmation in the extension;
- optimistic state that overrides the server;
- new provider adapters or execution capabilities.

### Verification

```bash
npm run typecheck
node --experimental-strip-types --test tests/console-goals-ui.test.mjs tests/*extension*control*.test.mjs tests/bridge-client.test.mjs
npm run build-extension
npm test
rg -n "endpointId|permissionProfile|workingDirectory|confirm" apps/extension/src
git diff --check
```

The extension scan must show display-only fields and pause/resume/cancel calls;
any endpoint selection, permission mutation, proposal edit, or confirmation
payload fails review.

### REVIEW-D Gate

Review rendered card completeness, stale-action handling, server authority,
redaction, accessibility, and extension payloads. PASS changes the RP status to
`READY-FOR-EX-E`.

## EX-E - Release Harness and Runbook

**Outcome:** Sanitized evidence proves both reasoning routes converge on the
same confirmation-bound execution lifecycle, with fixed endpoint bindings and
clean shutdown.

### Allowed Files

- `scripts/dual-endpoint-release-e2e.ts`
- focused harness tests named `*dual-endpoint-release-e2e*`
- `package.json` for one harness script entry
- `docs/runbooks/dual-endpoint-automation.md`
- `docs/reviews/REVIEW-DUAL-ENDPOINT-AUTOMATION.md`

### Required Scenarios

- [ ] CLI route: a real logged-in high-tier Codex or Claude reasoning endpoint
  produces an artifact, the operator confirms the proposal, and the fixed
  medium/low execution endpoint returns a correlated result.
- [ ] ChatGPT route: the accepted Web automation produces an equivalent
  artifact, the operator confirms through the same API/UI, and the same class
  of execution endpoint returns a correlated result.
- [ ] Same-provider route: distinct high and medium/low endpoint profiles of one
  provider remain visibly distinct and locked.
- [ ] Mixed-provider route: two compatible tools may be freely paired at start
  and cannot be swapped after approval.
- [ ] Failure route: timeout or malformed reasoning pauses without dispatch or
  retry.
- [ ] Uncertain-dispatch route: the Plan pauses and no replay occurs.
- [ ] Control route: pause/cancel prevents the next reasoning or dispatch
  transition.
- [ ] WorkBuddy boundary: current WorkBuddy identity is rejected as executor.
- [ ] Cleanup route: no harness-owned server, Chrome, or child CLI remains.

### Evidence Contract

Each scenario writes sanitized JSON and relevant screenshots under
`output/playwright/dual-endpoint-automation/`. Evidence includes scenario,
timestamp, git commit/dirty flag, Plan and proposal ids, endpoint ids and roles,
tiers, binding/content hashes, transition sequence, confirmation identity,
pause/cancel result, failure classification, process exit classification, and
screenshot paths.

Evidence excludes pairing tokens, cookies, credentials, raw provider config,
absolute private profile contents, complete prompts, complete replies, and
unredacted command output.

### Verification

```bash
npm run typecheck
node --experimental-strip-types --test tests/*dual-endpoint-release-e2e*.test.mjs
npm run build-extension
npm test
npm run dual-endpoint:e2e -- --scenario all
rg -n "pairingToken|document\.cookie|localStorage|shell: *true|--dangerously|--yolo|--full-auto|requestSubmit|KeyboardEvent|\.submit\(" scripts apps packages
git diff --check
```

The runbook must state prerequisites, endpoint registration, profile/tier setup,
exact commands, human confirmation steps, expected sanitized outputs, cleanup,
and failure-specific troubleshooting.

### FINAL REVIEW Gate

`docs/reviews/REVIEW-DUAL-ENDPOINT-AUTOMATION.md` may conclude `PASS` only when:

- all five REVIEW gates inspected real diffs and call chains;
- both upper reasoning routes used the same middle-layer contract;
- endpoint bindings remained fixed for every run;
- every execution had a unique human confirmation;
- pause/cancel and all failure paths stopped without automatic retry;
- current WorkBuddy remained non-executing;
- real-chain sanitized evidence exists for CLI and ChatGPT routes;
- default cleanup left no harness-owned process;
- typecheck, focused tests, build, full tests, and boundary scans passed.

Any missing real provider or logged-in ChatGPT evidence is `FAIL` or explicitly
blocked evidence, never a simulated pass.
