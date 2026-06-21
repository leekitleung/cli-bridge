# RP: Dual-Endpoint Real-Evidence Closeout

Status: READY-FOR-EX-E-REAL-EVIDENCE

Date: 2026-06-21 (re-verified; EX-E2 completed and REVIEW-E2 PASS)

Owner: reviewing/planning agent (RP batch)

## Context

`RP-DUAL-ENDPOINT-AUTOMATION-CONTROL.md` defined EX-A through EX-E. EX-A..EX-D
are implemented and individually reviewed PASS. EX-E delivered the release
harness (`scripts/dual-endpoint-release-e2e.ts`), the `dual-endpoint:e2e` npm
script, scenario contract tests, evidence redaction, and
`docs/runbooks/dual-endpoint-automation.md`.

`REVIEW-DUAL-ENDPOINT-AUTOMATION.md` is `BLOCKED-ON-REAL-EVIDENCE`. Code,
typecheck, build, and `npm test` (986/986) all pass.

This RP plans the closeout. The operator chose Option 1: complete the harness
real execution paths (prioritizing `chatgpt-route` mandated by ADR-0024), then
run real-evidence capture. This does not authorize new product behavior — the
harness is release-evidence tooling, not a product surface.

## RP Finding (re-verification 2026-06-21)

Status reverted from `READY-FOR-EX-E-REAL-EVIDENCE` to `BLOCKED-HARNESS-INCOMPLETE`,
now advanced to `READY-FOR-EX-E2-HARNESS-COMPLETION` after operator decision.

The prior readiness signal was not grounded in the harness call chain. EX-E-REAL-EVIDENCE
as previously written would fail its own REVIEW-E gate.

### Critical gap (phase-blocking)

`runHarness()` in `scripts/dual-endpoint-release-e2e.ts` implements a real
execution path ONLY for `cli-route` (the `runRealCliRoute` branch, line ~438).
For `chatgpt-route` and the other seven scenarios, even when real logins are
supplied and `blockedReason()` returns undefined, execution falls through to a
stub (line ~618) that writes `blocked` evidence classified as `unexpected-error`.

ADR-0024 §1 ("Both Routes Use the Middle Layer") and the FINAL REVIEW gate
("real-chain sanitized evidence exists for CLI and ChatGPT routes") require
real evidence for BOTH routes. The ChatGPT route cannot be evidenced with the
harness as committed. This is a missing implementation, not an environment gap.

The existing ADR-0023-authorized Web automation harness
(`scripts/web-auto-release-e2e.ts`) has the reusable Chrome launch, extension
pairing, ChatGPT relay, and inbound return machinery. Its `runHarness` and
several helpers are exported; its `createRuntimeContext`, `launchBrowser`,
`injectPairingToken`, `ensureChatGptPage`, and `waitPromptReturned` are
internal (not exported). EX-E2 may export these existing helpers without
changing their behavior.

### Secondary defect (doc/code mismatch)

Example commands in `docs/runbooks/dual-endpoint-automation.md` and in the
prior EX-E-REAL-EVIDENCE batch use `--reasoning-cli codex-high`. Verification
confirms `codex-high` is not a registered endpoint anywhere in
`apps/local-server/src`. The registered reasoning endpoints are `codex-command`
and `claude-code-command` (see `apps/local-server/src/endpoints/mock-endpoints.ts`
and `apps/local-server/src/routes/bridge-api.ts`). `runRealCliRoute` correctly
rejects `codex-high`. Following the documented example classifies `cli-route`
as `blocked-real-cli`.

Fix: align the runbook and all example commands with the registered endpoint
ids (`codex-command` or `claude-code-command`). For same-provider evidence,
`codex-command` (reasoning) + `codex-medium` (execution) are two distinct
registered profiles of Codex, satisfying ADR-0024 §5.

### Remaining scenarios

The other seven scenarios (`same-provider`, `mixed-provider`, `failure-timeout`,
`uncertain-dispatch`, `control-pause-cancel`, `workbuddy-boundary`, `cleanup`)
currently fall through to the same stub. The FINAL REVIEW gate requires real
evidence only for "CLI and ChatGPT routes." The remaining scenarios may be
satisfied by contract-level evidence (deterministic harness assertions that
prove the binding, failure, control, and boundary behavior) as long as the
REVIEW accepts the evidence shape. The stub must not produce `unexpected-error`
for these — it must produce valid `passed` contract evidence or `blocked` with
a real environment reason.

### Test coverage gap

Contract tests (`tests/dual-endpoint-release-e2e.test.mjs`, 6/6 PASS) cover
`parseArgs`, `DUAL_ENDPOINT_SCENARIOS` membership, `sanitizeEvidence`,
`createDryRunEvidence` shape, `classifyDualEndpointError`, and source-avoidance.
No test exercises non-dry-run `runHarness` for `chatgpt-route`, so the gap is
not caught by the suite.

### Verification re-run this batch

`npm run typecheck` PASS; focused harness tests 6/6 PASS. `npm test` (986/986)
and `npm run build-extension` were NOT re-run this batch (figures carried from
REVIEW-DUAL-ENDPOINT-AUTOMATION).

## Repository State (verified 2026-06-21)

- Branch `main` at `610b0b9 fix: harden automation proposal selection`.
- Working tree clean except untracked `.kiro/specs/multi-persona-quality-gate/`
  (unrelated; MUST NOT be swept into any closeout commit).
- `package.json` script: `"dual-endpoint:e2e": "node --experimental-strip-types scripts/dual-endpoint-release-e2e.ts"`.
- Harness flags: `--scenario`, `--reasoning-cli`, `--execution-cli`,
  `--profile-dir`, `--connect-cdp`, `--dry-run`, `--output-dir`,
  `--confirmation-timeout-ms`.
- Registered reasoning endpoints: `codex-command`, `claude-code-command`.
- Registered execution endpoint in harness: `codex-medium` (via
  `CODEX_MEDIUM_ENDPOINT` constant).
- `scripts/web-auto-release-e2e.ts` exports: `runHarness`, `parseArgs`,
  `sanitizeEvidence`, `classifyError`, `findAvailablePort`,
  `disconnectConnectedBrowser`, `selectCliBridgeExtensionId`,
  `hasChatGptComposerForHarness`. Internal (not exported):
  `createRuntimeContext`, `launchBrowser`, `discoverExtensionId`,
  `ensureChatGptPage`, `injectPairingToken`, `waitForChatGptComposer`,
  `waitPromptReturned`, `getReports`, `buildExtension`.

## Control Flow

```
EX-E2-HARNESS-COMPLETION  →  REVIEW-E2-HARNESS-COMPLETION
  →  EX-E-REAL-EVIDENCE  →  REVIEW-E-REAL-EVIDENCE
  →  FINAL-CLOSEOUT (only on PASS)
```

Control returns to a REVIEW/RP batch after each EX batch. If a REVIEW is
BLOCKED, the next EX batch is a bounded follow-up only.

## Global Boundaries (carried from RP-DUAL-ENDPOINT-AUTOMATION-CONTROL)

- Fixed endpoint bindings; no swap after approval.
- One-time human confirmation per execution dispatch.
- Pause/cancel and all failure paths stop without automatic retry.
- Current WorkBuddy identity stays `canExecute=false` and is rejected as executor.
- No dry-run or simulated result may substitute for real-chain evidence.
- No commit, push, merge, or PR without explicit user authorization and the
  required REVIEW gate.
- ADR-0023 Web automation behavior (DOM submission, relay, routing, loop) must
  not change. EX-E2 reuses the existing harness; it does not add new page
  automation.

---

## EX-E2-HARNESS-COMPLETION

**Owner:** execution agent.

**Outcome:** The dual-endpoint release harness has real execution paths for
`chatgpt-route` (mandatory) and valid evidence output for all remaining
scenarios. The runbook examples use registered endpoint ids. No product code
changes.

### Preconditions

- REVIEW-E2 has not started; this is the first EX batch after the operator
  chose Option 1.
- `npm run typecheck`, `npm run build-extension`, `npm test` pass before
  starting (baseline from REVIEW-DUAL-ENDPOINT-AUTOMATION).
- Untracked `.kiro/specs/multi-persona-quality-gate/` is left untouched.

### Allowed Files

- `scripts/dual-endpoint-release-e2e.ts` — primary implementation target.
- `scripts/web-auto-release-e2e.ts` — ONLY to export existing internal helpers
  (`createRuntimeContext`, `launchBrowser`, `discoverExtensionId`,
  `ensureChatGptPage`, `injectPairingToken`, `waitForChatGptComposer`,
  `waitPromptReturned`, `getReports`, `buildExtension`, or a subset as needed).
  Must NOT change any existing behavior, selectors, relay logic, or ADR-0023
  boundaries. Export-only modification.
- `tests/dual-endpoint-release-e2e.test.mjs` — add tests for new paths.
- `docs/runbooks/dual-endpoint-automation.md` — fix `codex-high` references
  and update commands to match registered endpoint ids.
- `package.json` — only if a script or dependency change is needed (unlikely).

### Forbidden Scope

- No changes to `apps/` or `packages/` product code.
- No ADR-0024 or ADR-0023 amendments.
- No new DOM selectors, send logic, loop policy, or extension routing in
  `web-auto-release-e2e.ts`.
- No dangerous flags (`shell: true`, `--dangerously`, `--yolo`, `--full-auto`),
  `requestSubmit`, `KeyboardEvent`, `.submit()`, or
  `/bridge/execution-proposals/confirm` / `/dispatch` auto-confirmation calls.
- No commit, push, merge, or PR.

### Required Steps

- [ ] **Export helpers from `web-auto-release-e2e.ts`:** Add `export` to the
  existing internal functions that `chatgpt-route` needs (at minimum
  `createRuntimeContext` and its dependencies, or a narrower
  `createChatgptRuntimeContext` wrapper). Do not change any line of behavior;
  only add the `export` keyword or a thin re-export wrapper.

- [ ] **Implement `runRealChatgptRoute()` in `dual-endpoint-release-e2e.ts`:**
  This function must:
  1. Start the local server with `additionalEndpoints: [CODEX_MEDIUM_ENDPOINT]`
     and the same `goalPlanCommandOptions` mock runner used by
     `runRealCliRoute` (so the plan is deterministic).
  2. Create a Goal, Plan, and immutable dual-endpoint binding with
     `reasoningEndpointId: 'chatgpt-web'` (or the server's ChatGPT endpoint id),
     `executionEndpointId: 'codex-medium'`, `reasoningTier: 'high'`,
     `executionTier: 'medium'`.
  3. Approve the plan (locks the binding).
  4. Launch Chrome with the extension using the exported
     `createRuntimeContext` (or equivalent helpers) from
     `web-auto-release-e2e.ts`, with the operator-supplied `--profile-dir` or
     `--connect-cdp`.
  5. Inject the pairing token and ensure the ChatGPT page is ready.
  6. Send a bounded reasoning prompt to ChatGPT via the relay
     (`/bridge/outbound` or the existing relay path used by
     `web-auto-release-e2e.ts`). The prompt must request a concise read-only
     verification result and must NOT request execution, file edits, endpoint
     selection, or permission grants.
  7. Wait for the ChatGPT return via `waitPromptReturned` (or equivalent).
  8. Normalize the returned content into a `ReasoningArtifact` with
     `kind: 'execution-proposal'`, compute its `contentHash`, and persist it
     through `/bridge/reviews/dispatch` (same as `runRealCliRoute`).
  9. Create an execution proposal for the locked binding's `codex-medium`
     endpoint via `/bridge/execution-proposals`, with the same bounded
     `CODEX_REVIEW_ARGS` and read-only stdin used by `runRealCliRoute`.
  10. Write the active-handoff JSON and log it (same pattern as
      `runRealCliRoute`).
  11. Wait for operator confirmation via `waitForOperatorDispatch`.
  12. Return a `DualEndpointEvidence` with `evidenceStatus: 'passed'`,
      `endpointBindings`, `transitionSequence`, `confirmationIdentity`,
      `processExitClassification`, and `failureClassification: 'none'`.
  13. In a `finally` block: unlink the handoff, close the server, and close the
      browser (unless `--keep-browser` is passed — reuse the web-auto pattern).

- [ ] **Wire `chatgpt-route` into `runHarness()`:** Replace the stub fallthrough
  for `scenario === 'chatgpt-route'` with a call to `runRealChatgptRoute()`,
  wrapped in the same try/catch → `blockedEvidence` pattern used for
  `cli-route`.

- [ ] **Make remaining scenarios produce valid evidence:** For
  `same-provider`, `mixed-provider`, `failure-timeout`, `uncertain-dispatch`,
  `control-pause-cancel`, `workbuddy-boundary`, and `cleanup`, replace the
  `unexpected-error` stub with one of:
  - A real path (if the scenario is a variant of cli-route or chatgpt-route
    with different endpoint pairing).
  - A deterministic contract check that asserts the binding/failure/control/
    boundary behavior and writes `passed` evidence with
    `processExitClassification: 'not-run'` (for scenarios that don't dispatch).
  - `blocked` evidence with a REAL environment reason (not `unexpected-error`)
    if the scenario genuinely cannot run without real endpoints.
  The simplest correct approach is preferred. See "Scenario evidence
  requirements" below.

- [ ] **Fix runbook endpoint ids:** Replace all `--reasoning-cli codex-high`
  references in `docs/runbooks/dual-endpoint-automation.md` with
  `--reasoning-cli codex-command` (or `claude-code-command`). Update the
  same-provider example to use `codex-command` + `codex-medium`.

- [ ] **Add tests** in `tests/dual-endpoint-release-e2e.test.mjs`:
  - A test that asserts `runRealChatgptRoute` is defined and callable (contract
    level; real run needs login).
  - A test that asserts `runHarness` dispatches to `runRealChatgptRoute` for
    `chatgpt-route` when `profileDir` or `connectCdp` is supplied (use a mock
    or spy; do not launch a real browser).
  - A test that asserts the remaining scenarios produce `passed` or `blocked`
    evidence — never `unexpected-error` — when `dryRun: false` and no real
    endpoints are supplied (assert the failure code is a real environment
    reason like `blocked-real-cli`, not `unexpected-error`).
  - Keep the existing 6 tests passing.

### Scenario evidence requirements

| Scenario | Real evidence needed? | Acceptable evidence |
|---|---|---|
| `cli-route` | YES (already implemented) | Real run with `codex-command`/`claude-code-command` + `codex-medium` |
| `chatgpt-route` | YES (ADR-0024 §1 mandatory) | Real run with ChatGPT profile/CDP + `codex-medium` |
| `same-provider` | No | Contract: two Codex profiles (`codex-command` + `codex-medium`) are visibly distinct and locked |
| `mixed-provider` | No | Contract: two compatible tools pair freely and lock |
| `failure-timeout` | No | Contract: timeout/malformed reasoning pauses, no dispatch, no retry |
| `uncertain-dispatch` | No | Contract: uncertain dispatch pauses, no replay |
| `control-pause-cancel` | No | Contract: pause/cancel prevents next transition |
| `workbuddy-boundary` | No | Contract: WorkBuddy rejected as executor |
| `cleanup` | YES (from any real run) | Real run leaves no harness-owned process |

### Verification

```bash
npm run typecheck
node --experimental-strip-types --test tests/*dual-endpoint-release-e2e*.test.mjs
npm run build-extension
npm test
rg -n "shell: *true|--dangerously|--yolo|--full-auto|requestSubmit|KeyboardEvent|\.submit\(|'/bridge/execution-proposals/confirm'|'/bridge/execution-proposals/dispatch'" scripts/dual-endpoint-release-e2e.ts scripts/web-auto-release-e2e.ts
rg -n "codex-high" docs/runbooks/dual-endpoint-automation.md
git diff --check
```

The `codex-high` scan must return zero matches in the runbook. The
source-avoidance scan must show no new dangerous patterns (existing matches in
`web-auto-release-e2e.ts` are pre-approved ADR-0023 behavior and must not
change).

### Report Back

Changed files (expected: harness, web-auto exports, tests, runbook), new test
count, per-scenario evidence output shape, confirmation that no product code
was touched, and any unresolved questions about the ChatGPT relay integration.

---

## REVIEW-E2-HARNESS-COMPLETION

**Owner:** reviewing agent. No implementation fixes unless the user explicitly
asks.

### Checks

- [ ] `runRealChatgptRoute()` exists and follows the same binding → artifact →
  proposal → confirmation → dispatch → correlation lifecycle as
  `runRealCliRoute()`.
- [ ] The ChatGPT relay reuse does not change ADR-0023 DOM submission, send
  logic, loop policy, or extension routing. The `web-auto-release-e2e.ts`
  diff is export-only (no behavior change).
- [ ] All nine scenarios produce valid evidence (`passed` or `blocked` with a
  real environment reason) — never `unexpected-error` from the stub.
- [ ] Runbook commands use registered endpoint ids (`codex-command` /
  `claude-code-command`), not `codex-high`.
- [ ] No dangerous flags, auto-confirmation, or product code changes.
- [ ] Tests pass and cover the new `chatgpt-route` path at contract level.
- [ ] `npm run typecheck`, `npm run build-extension`, `npm test` all pass.

### Result

- PASS: update this RP status to `READY-FOR-EX-E-REAL-EVIDENCE`; proceed to
  real-evidence capture.
- BLOCKED: enumerate findings; define a bounded follow-up EX patch.

---

## EX-E-REAL-EVIDENCE

**Owner:** execution agent, operating with a human operator who supplies real
logins and performs each confirmation.

**Precondition:** REVIEW-E2-HARNESS-COMPLETION returned PASS (see
`docs/reviews/REVIEW-DUAL-ENDPOINT-AUTOMATION-CONTROL-E2.md`, 2026-06-21).

**Carry-forward risk from REVIEW-E2 (must validate this batch):** the ChatGPT
real path is structurally faithful but unverified end-to-end. Validate the relay
seam — the harness persists the ChatGPT reply by POSTing `/bridge/extract-return`
a second time (harness-side) with `planId` + `operationId` +
`artifactKind:execution-proposal`, relying on `createIdempotent` replay and
`relayContext.lastOutboundPromptId` still matching after the extension's first
extract-return. If the extension consumes/rotates the relay context, attach the
automation `planId` to the original outbound prompt instead, and record the
harness adjustment as an authorized real-run bug fix.

**Outcome:** Sanitized real-chain evidence under
`output/playwright/dual-endpoint-automation/` proving both reasoning routes
converge on the same confirmation-bound execution lifecycle with fixed bindings
and clean shutdown.

### Preconditions

- A real logged-in high-tier reasoning CLI endpoint (`codex-command` or
  `claude-code-command`).
- A distinct medium/low execution CLI endpoint (`codex-medium`),
  `canExecute=true`.
- A logged-in ChatGPT Web profile (`--profile-dir`) or an existing CDP browser
  session (`--connect-cdp`).
- `npm run typecheck`, `npm run build-extension`, `npm test` pass before the run.
- Untracked `.kiro/specs/multi-persona-quality-gate/` is left untouched.

### Allowed Files

- `output/playwright/dual-endpoint-automation/**` (generated evidence only).
- `scripts/dual-endpoint-release-e2e.ts` and
  `docs/runbooks/dual-endpoint-automation.md` ONLY if a real run exposes a
  harness/runbook bug; the defect must be recorded in the REVIEW notes.
- No other product code may change. This is an evidence-capture batch.

### Required Steps

- [ ] Probe and record real CLI login state, tier, and profile for both the
  reasoning and execution endpoints (identities/roles only; no secrets in notes).
- [ ] Probe and record ChatGPT Web login state or the CDP profile target.
- [ ] Register endpoint identities per the runbook: reasoning role
  `planner-reviewer` tier `high` `canExecute=false`; execution role
  `bounded-executor` tier `medium`/`low` `canExecute=true`.
- [ ] Run the full real-chain suite (no `--dry-run`):
  ```bash
  npm run dual-endpoint:e2e -- --scenario all --reasoning-cli codex-command --execution-cli codex-medium --profile-dir output/playwright/stage-b-cft-open-profile
  ```
  For CDP-based ChatGPT evidence, substitute
  `--connect-cdp http://127.0.0.1:9224` for `--profile-dir`.
- [ ] For every execution proposal, the human operator inspects the
  `/console/goals` confirmation card (endpoint ids/roles, tiers, project,
  working directory, permission profile, step, round, limits, deadline, prompt
  preview, content hash, binding hash) and confirms exactly once.
- [ ] Confirm `cli-route` and `chatgpt-route` produce real (not blocked, not
  `dry-*`) evidence. Confirm the remaining scenarios produce `passed` contract
  evidence or `blocked` with a real environment reason.
- [ ] **Capture relay-seam diagnostics in the `chatgpt-route` evidence** (REVIEW-E
  gate item): record every `/bridge/extract-return` HTTP response code and the
  `lastOutboundPromptId` value at the moment of the harness-side second POST.
  REVIEW-E must inspect these, not just the final scenario verdict — a relay
  double-fire or prompt-id mismatch yields a silent stale artifact or a
  duplicate-proposal rejection that the contract tests cannot detect. If the
  harness does not already surface these fields in its sanitized evidence,
  adding that capture is an authorized real-run harness fix (per this batch's
  Allowed Files), and the seam adjustment described in the precondition must be
  recorded.
- [ ] Verify the default run leaves no harness-owned server, browser, or child
  CLI process. Record any intentionally retained external CDP browser as an
  exception.

### Gate

- BLOCKED if any route cannot supply a real logged-in endpoint. Report the exact
  missing environment condition; do not substitute dry-run or simulated results.

### Verification

```bash
npm run typecheck
node --experimental-strip-types --test tests/*dual-endpoint-release-e2e*.test.mjs
npm run build-extension
npm test
npm run dual-endpoint:e2e -- --scenario all --reasoning-cli codex-command --execution-cli codex-medium --profile-dir output/playwright/stage-b-cft-open-profile
rg -n "pairingToken|document\.cookie|localStorage|shell: *true|--dangerously|--yolo|--full-auto|requestSubmit|KeyboardEvent|\.submit\(" scripts apps packages
git diff --check
```

### Report Back

Changed files (expected: evidence only), per-scenario classifications, the
evidence JSON directory/timestamp, confirmation identities, process exit
classifications, cleanup result, and any unresolved environment questions.

---

## REVIEW-E-REAL-EVIDENCE

**Owner:** reviewing agent. No implementation fixes in this batch unless the user
explicitly asks.

### Checks

- [ ] Both the CLI route and the ChatGPT route have real (non-blocked, non-`dry-*`)
  sanitized evidence.
- [ ] **Relay seam validated:** the ChatGPT-route evidence shows the
  `/bridge/extract-return` response codes and the `lastOutboundPromptId` at the
  harness-side second POST, proving no double-fire and a matching prompt id (no
  silent stale artifact or duplicate-proposal rejection). A `passed` verdict
  without these diagnostics is insufficient.
- [ ] Fixed bindings were not replaced after approval (lineage/hash stable).
- [ ] Every dispatch carried a unique, single-use human confirmation.
- [ ] `failure-timeout`, `control-pause-cancel`, and `uncertain-dispatch` all
  fail-closed with no automatic retry.
- [ ] WorkBuddy identity remained non-executing and was rejected as executor.
- [ ] Cleanup left no harness-owned server/browser/CLI (or recorded a justified
  CDP exception).
- [ ] Evidence excludes pairing tokens, cookies, credentials, raw provider
  config, absolute private profile contents, complete prompts/replies, and
  unredacted command output.

### Result

- PASS: proceed to FINAL-CLOSEOUT; record the decision in the review and RP.
- BLOCKED: keep `BLOCKED-ON-REAL-EVIDENCE`, enumerate the missing real
  environment conditions, and define a bounded follow-up EX patch if a
  harness/runbook defect was found.

---

## FINAL-CLOSEOUT

**Owner:** reviewing/planning agent. Execute ONLY after REVIEW-E-REAL-EVIDENCE
returns PASS and the user authorizes closeout.

### Steps

- [ ] Update `RP-DUAL-ENDPOINT-AUTOMATION-CONTROL.md` status from
  `BLOCKED-ON-REAL-EVIDENCE` to the closed/passed state.
- [ ] Update `REVIEW-DUAL-ENDPOINT-AUTOMATION.md` to `PASS` with the real
  evidence references.
- [ ] Update this RP status to closed.
- [ ] Run final verification:
  ```bash
  npm run typecheck
  node --experimental-strip-types --test tests/*dual-endpoint-release-e2e*.test.mjs
  npm run build-extension
  npm test
  rg -n "pairingToken|document\.cookie|localStorage|shell: *true|--dangerously|--yolo|--full-auto|requestSubmit|KeyboardEvent|\.submit\(" scripts apps packages
  git diff --check
  ```
- [ ] Commit the final evidence and review/RP docs in ONE dedicated closeout
  commit for this slice. Do NOT include the unrelated untracked
  `.kiro/specs/multi-persona-quality-gate/` directory or any other unrelated
  dirty state. Push/PR only with explicit user authorization.

## Planning Notes / Risks

- The blocker is a missing harness implementation (chatgpt-route real path),
  NOT purely environmental. EX-E2 closes the implementation gap; EX-E-REAL-EVIDENCE
  captures the real run. No product code (apps/packages) changes are authorized.
- Real evidence requires a reachable `/console/goals` for human confirmation
  during the harness run. The local server is harness-owned per the runbook.
- The `chatgpt-route` real path reuses ADR-0023-authorized Web automation. It
  must not add new DOM selectors, send logic, or loop policy. The reuse is
  import/export-only.
- Keep the unrelated `.kiro/specs/multi-persona-quality-gate/` untracked
  directory out of every commit in this sequence.
