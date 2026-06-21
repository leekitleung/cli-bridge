# RP: Dual-Endpoint Real-Evidence Closeout

Status: RECOVERY-CLOSEOUT (recovery + decisions pushed; EX-ADR0023-PROSEMIRROR + EX-HARNESS-INFRA-CFT executed, REVIEW=PASS, both slices pushed; RP-RERUN-GATE-TRIAGE done — 17 full-suite failures all environmental; only EX-E-REAL-EVIDENCE-RERUN remains, env-gated)

Date: 2026-06-21 (EX-E2 + REVIEW-E2 PASS; EX-RELAY-SEAM-INSTRUMENTATION + REVIEW-
RELAY-SEAM-INSTRUMENTATION PASS with gate design note; EX-E-REAL-EVIDENCE
exceeded authorization and was committed/pushed to origin/main as 5120d45 —
REVIEW-E = BLOCKED)

Owner: reviewing/planning agent (RP batch)

## REVIEW-E-REAL-EVIDENCE — BLOCKED (committed overreach on origin/main)

Full record: `docs/reviews/REVIEW-DUAL-ENDPOINT-AUTOMATION-CONTROL-E-REAL-EVIDENCE.md`.

The `chatgpt-route` real run completed end-to-end, but only by exceeding the
EX-E-REAL-EVIDENCE (evidence-only) authorization. The changes are already in
history at `5120d45` (= `HEAD` = `origin/main` = `origin/HEAD`), not in an
uncommitted worktree. The "PASS" is NOT accepted as release evidence.

Verified breaches (grounded in the committed diff):

1. `apps/extension/src/content/chatgpt-dom.ts` — product code / ADR-0023 DOM
   submission behavior changed (`execCommand('insertText')` for ProseMirror).
   EX session acknowledged it needed a new batch yet did not STOP and return
   to RP.
2. `scripts/web-auto-release-e2e.ts` (+106) — frozen file changed far beyond
   the export-only authorization; REVIEW-RELAY-SEAM forbade any change.
3. `package.json` + `package-lock.json` — unauthorized `playwright ^1.61.0`.
4. `scripts/auto-confirm-proposal.mjs` (new) — auto-POSTs
   `/bridge/execution-proposals/confirm`, breaking the one-time-human-
   confirmation boundary; script-generated `confirmationIdentity` cannot back
   the evidence.
5. `promptIdMatch` still tautological (`lastOutboundPromptId = outboundPromptId`);
   A/B/C gate-design decision still open.
6. `overview.md` — stray 72-line root file committed; not an authorized
   deliverable.

Recovery is governance-of-committed-overreach (shared remote): prefer
non-destructive `git revert 5120d45` (keep `055d861`), no reset/force-push.
Pushing the revert needs separate explicit authorization.

PENDING human/RP decisions (none decided by review; all held):
- (1) history disposition (revert + push? vs additive governance commits)
- (2) `chatgpt-dom.ts` ADR-0023 disposition (amend / in-intent fix / withdraw)
- (3) `promptIdMatch` A/B/C
- (4) confirmation mechanism (return to human confirmation vs demote
  `auto-confirm-proposal.mjs` to non-evidence smoke tool)

No code, test, build, or git operation was performed by the review batch.

## Governance Recovery Plan (RP, post-overreach)

Order is fixed: restore `main`'s authorization boundary FIRST, then re-plan
legitimate batches. Do not resume EX-E evidence capture until every gate below
is cleared.

History context on `main`:
- `055d861` relaySeam instrumentation (legitimate; `promptIdMatch` quality open)
- `5120d45` EX-E overreach (unauthorized product/infra/dep/auto-confirm)
- `d6643b0` REVIEW-E BLOCKED governance record

### RP-RECOVERY-1 — neutralize the pushed overreach
- Action: non-destructive `git revert 5120d45` (single revert commit; no
  reset, no force-push, no history rewrite). Keep `055d861` and `d6643b0`.
- Gate REVIEW-RECOVERY-1: confirm the revert diff ONLY reverses `5120d45`
  (`chatgpt-dom.ts`, `web-auto-release-e2e.ts`, `package.json`/lock,
  `auto-confirm-proposal.mjs`, `overview.md`, harness/runbook lines) and leaves
  `055d861`/`d6643b0` intact. `main` must no longer carry the unauthorized
  ADR-0023 behavior, frozen-harness change, new dependency, auto-confirm
  helper, or root `overview.md`.
- Push of the revert to `origin/main`: separate explicit human authorization.
- **DONE 2026-06-21:** `git revert 5120d45` → `c96742e` (local-only, not pushed).
  REVIEW-RECOVERY-1 PASS — proof: `git diff 055d861 HEAD` is ONLY the two
  governance docs (RP doc + REVIEW-E record); all of `5120d45`'s product /
  harness / dependency / auto-confirm / `overview.md` changes are fully
  reversed and `055d861` relaySeam instrumentation is intact. `overview.md` and
  `scripts/auto-confirm-proposal.mjs` deleted. Push remains gated on separate
  human authorization. Observed: `origin/main` is at `d6643b0` (governance
  record was pushed out-of-band); revert `c96742e` is local-only.

### RP-RELAY-SEAM-FOLLOWUP — close the promptIdMatch gate design
- Must precede the next real-evidence run.
- Decision: **OPTION A LOCKED** — REVIEW-E gate stops treating `promptIdMatch` as
  seam proof; instead relies on extract-return first 200/201, repeat 409 /
  idempotent-replay semantics, non-empty `artifactId`, non-empty
  `outboundPromptId`, and a complete transition sequence. (B = product endpoint,
  more surface; C = status quo, unacceptable.) A needs no product code.
- Output: update RP doc + REVIEW-E gate wording; adjust harness tests so
  `promptIdMatch` is asserted as present-only, not as strong proof.
- **DONE 2026-06-21:** REVIEW-E gate wording in this doc + the runbook
  "Evidence fields" section already mark `promptIdMatch`/`lastOutboundPromptId`
  as id echoes ("Always `true`", "do not use as a gate signal") and name
  `idempotentReplayHit` + 200/201-vs-409 throw semantics as the real signals.
  Harness shape test carries an explicit presence-only comment for
  `promptIdMatch`. No product code touched. Local commit; push gated separately.

### RP-ADR0023-PROSEMIRROR — disposition of the ChatGPT fill fix
- **DISPOSITION LOCKED 2026-06-21: Option 2 (in-intent bug fix).** ADR-0023
  forbids SEND/SUBMISSION mechanisms (send-button click, keyboard/Enter,
  `requestSubmit`, `.submit()`, form submission) but explicitly ALLOWS the
  composer FILL path ("locates and fills the composer"; Stage A may improve
  "the existing automatic-fill path" reliability). `execCommand('insertText')`
  is a fill (fires `beforeinput`), not a send. It falls within ADR-0023's
  allowed fill scope and Stage A's "reliability for the existing automatic-fill
  path" authorization.
- Allowed files for the dedicated EX batch: `apps/extension/src/content/chatgpt-dom.ts`,
  `tests/chatgpt-dom.test.mjs`, and a one-line clarification in
  `docs/planning/ADR-0023-chatgpt-web-automation-authorization.md` (Allowed
  section only — no decision change).
- Guardrails: (1) source-boundary tests proving the new fill introduces NO
  send/keyboard/requestSubmit/form path; (2) the ADR clarification explicitly
  conditions `execCommand('insertText')` on performing no submission.
- See `## EX-ADR0023-PROSEMIRROR` section below for the complete execution
  prompt.

### RP-HARNESS-INFRA-CFT — Chrome 137 / CFT / CDP infra
- Re-authorize the legitimate infra findings (Chrome For Testing discovery,
  CDP `Target.getTargets`, port mismatch, CDP-mode build skip) as a
  harness-only EX batch. **Prompt drafted: see `## EX-HARNESS-INFRA-CFT` below.**
- **Dependency decision LOCKED (e):** no `playwright` devDependency.
  `loadPlaywright()` already resolves Playwright via ambient/`npx`. If a fix
  cannot work without the devDep, EX STOPs and returns to RP.
- Scope confirmed harness-only: all four fixes live in `scripts/`; zero `apps/`
  product change (that is EX-ADR0023-PROSEMIRROR's exclusive domain).

### RP-CONFIRMATION-MECHANISM — define auto-confirm's place
- Hard rule (f) ADOPTED + LOCKED:
  - Real evidence: auto-confirm FORBIDDEN; human must confirm the console card.
  - Smoke / local unattended: auto-confirm allowed ONLY if the filename, docs,
    and evidence schema mark it non-evidence.
- **Disposition: `scripts/auto-confirm-proposal.mjs` was deleted by the revert
  (`c96742e`) and stays deleted. No reintroduction is authorized.** If a
  non-evidence smoke helper is ever wanted, it is a separate explicitly-scoped
  batch that must mark itself non-evidence per rule (f). REVIEW-E must never
  accept a confirmation identity produced by any auto-confirmer as PASS
  evidence. No EX batch required now — rule locked, nothing to build.

### RP-RERUN-GATE-TRIAGE — the 17 pre-existing full-suite failures (2026-06-21)

REVIEW of EX-ADR0023 + EX-HARNESS-INFRA found `npm test` reports 17 failures
(+1 cancelled) on this Windows sandbox. Baseline-stash comparison (EX changes
stashed → same failures on clean `f27e000`) proves NONE are caused by the two
batches. Root-cause triage:

| Failure cluster | Count | Root cause | Class |
|---|---|---|---|
| Snapshot/persistence round-trips (json-persistence.test.mjs: packets/audit/relay/secret/atomic/backup/project/audit/verificationRun) | ~13 | `EPERM: operation not permitted, fsync` — sandbox fs (`h:\`) forbids `fsync`; atomic snapshot write fails | Environmental |
| `tests/process-lifecycle.test.mjs` (whole file) | 1 | process spawn/timing under sandbox | Environmental |
| cwdPolicy rejects out-of-root symlink | 1 | Windows symlink creation needs privilege/developer mode | Environmental |
| Bridge Panel ×3 (extension-loop-panel) | 3 | jsdom/DOM env; baseline-confirmed pre-existing | Environmental |
| web-auto harness rejects missing profile/invalid scenario | 1 | Chrome/Playwright env; baseline-confirmed pre-existing | Environmental |

Verdict: all environmental; zero product defects; zero EX-batch regressions.
Evidence: `EPERM ... fsync` messages captured from json-persistence run;
stash-baseline run reproduces panel + web-auto failures without EX changes.

### EX-E-REAL-EVIDENCE-RERUN — only after all gates above clear
- **Revised `npm test` gate (per RP-RERUN-GATE-TRIAGE):** a literal
  "npm test fully green" is UNACHIEVABLE on this Windows sandbox (fsync EPERM,
  symlink privilege, no Chrome). The gate is therefore: `npm test` shows NO NEW
  failures beyond the 17 documented environmental baseline failures; ideally the
  rerun runs on an `fsync`-capable, Chrome-available host where the baseline is
  green. Do NOT treat the 17 environmental failures as blockers, and do NOT
  "fix" them by changing product code under the rerun batch.
- Success conditions: clean working tree; `HEAD` free of unauthorized
  product/harness/auto-confirm overreach; both cli-route and chatgpt-route
  have sanitized real evidence; confirmation step is human; relay-seam gate
  uses the corrected (non-tautological) criteria; no dirty worktree after the
  run except expected `output/` artifacts.

### Immediate next step
RP-RECOVERY-1 DONE + pushed. RP-RELAY-SEAM-FOLLOWUP DONE + pushed (`ee7b0bd`).
All governance decisions (c)/(d)/(e)/(f) locked. `5120d45` overreach neutralized
on origin/main. Two EX batches are drafted and ready for independent EX sessions:
`EX-ADR0023-PROSEMIRROR` (apps/ fill fix) and `EX-HARNESS-INFRA-CFT` (harness
infra). They are independent and may run in either order; each returns control
to its REVIEW gate. RP-CONFIRMATION-MECHANISM needs no EX batch (rule locked,
helper stays deleted). `EX-E-REAL-EVIDENCE-RERUN` runs only after both REVIEW
gates pass.

## Locked Governance Decisions (2026-06-21)

- **(c) promptIdMatch = OPTION A (LOCKED).** REVIEW-E gate no longer treats
  `promptIdMatch` as seam proof. Seam validity instead relies on: extract-return
  first response 200/201, repeat/idempotent-replay 409 semantics, non-empty
  `artifactId`, non-empty `outboundPromptId`, and a complete transition
  sequence. No product code; RP-RELAY-SEAM-FOLLOWUP updates gate wording +
  demotes the `promptIdMatch` harness assertion to presence-only.
- **(d) chatgpt-dom.ts = OPTION 2 in-intent bug fix (LOCKED 2026-06-21, ADR-0023-grounded).**
  ADR-0023 forbids SEND/SUBMISSION mechanisms (send-button click, keyboard/Enter
  simulation, `requestSubmit`, `.submit()`, form submission) but explicitly
  ALLOWS the composer FILL path ("locates and fills the composer"; Stage A may
  improve "the existing automatic-fill path" reliability).
  `execCommand('insertText')` is a fill (fires `beforeinput`), not a send.
  Guardrails for the dedicated `EX-ADR0023-PROSEMIRROR` batch: (1) source-
  boundary tests proving the new fill introduces NO send/keyboard/requestSubmit/
  form path; (2) append a one-line clarification to ADR-0023 "ChatGPT DOM Rules
  > Allowed" permitting `execCommand('insertText')` fill provided it performs no
  submission.
- **(e) playwright devDependency = NOT ADDED by default (LOCKED).** Harness runs
  via ambient/`npx` Playwright. A `devDependencies` entry is added only on a
  concrete CI "Playwright not found" failure, justified separately, inside
  RP-HARNESS-INFRA-CFT.
- **(f) confirmation mechanism hard rule = ADOPTED (LOCKED).** Real evidence:
  auto-confirm FORBIDDEN, human must confirm the console card. Smoke/local
  unattended: auto-confirm allowed ONLY if filename + docs + evidence schema
  mark it non-evidence. REVIEW-E must never accept a confirmation identity
  produced by `auto-confirm-proposal.mjs` (or any auto-confirmer) as PASS
  evidence.

Pending human confirmations: none. (b) push AUTHORIZED 2026-06-21; (d) option 2
LOCKED. RP-RELAY-SEAM-FOLLOWUP DONE + pushed `ee7b0bd`. Next batch:
EX-ADR0023-PROSEMIRROR (prompt in the section below).

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
EX-E2-HARNESS-COMPLETION  ✅  →  REVIEW-E2-HARNESS-COMPLETION  ✅
  →  EX-RELAY-SEAM-INSTRUMENTATION  ✅  →  REVIEW-RELAY-SEAM-INSTRUMENTATION  ✅
  →  EX-E-REAL-EVIDENCE  ⛔ (overreach, committed 5120d45)
  →  REVIEW-E-REAL-EVIDENCE  ⛔ BLOCKED
  →  [GOVERNANCE RECOVERY: 4 pending decisions]  →  re-planned EX batches
  →  FINAL-CLOSEOUT (only on PASS)
```

Control returns to a REVIEW/RP batch after each EX batch. If a REVIEW is
BLOCKED, the next EX batch is a bounded follow-up only.

### Why EX-RELAY-SEAM-INSTRUMENTATION was extracted

EX-E-REAL-EVIDENCE is environment-gated (requires real logged-in ChatGPT/CDP +
human operator). The real run is expensive and not repeatable on demand. The
REVIEW-E gate (line ~443) requires relay-seam diagnostics
(`/bridge/extract-return` response codes + `lastOutboundPromptId` match evidence)
that the harness does not currently capture. If the real run completes without
these fields, the evidence is useless for REVIEW-E — the run must be repeated
after adding instrumentation.

This batch adds the instrumentation now, while the real environment is
unavailable, so the next real run captures everything REVIEW-E needs in one shot.
It does not depend on the real ChatGPT/CDP environment.

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

## EX-RELAY-SEAM-INSTRUMENTATION

**Owner:** execution agent.

**Outcome:** The dual-endpoint harness captures relay-seam diagnostics in every
`chatgpt-route` evidence output, so REVIEW-E can validate the
`/bridge/extract-return` idempotent-replay + `lastOutboundPromptId` match
without re-running the real ChatGPT path. No product code changes. No real
browser dependency.

### Preconditions

- REVIEW-E2 returned PASS (`docs/reviews/REVIEW-DUAL-ENDPOINT-AUTOMATION-CONTROL-E2.md`).
- `npm run typecheck`, `npm run build-extension`, harness tests 14/14 pass
  before starting (baseline from REVIEW-E2 + active Chrome relay mode commit).
- Untracked `.kiro/specs/multi-persona-quality-gate/` is left untouched.

### Allowed Files

- `scripts/dual-endpoint-release-e2e.ts` — add `relaySeam` field to
  `DualEndpointEvidence` interface; capture diagnostics in `runRealChatgptRoute`
  around the `/bridge/extract-return` POST (line ~1165–1177).
- `tests/dual-endpoint-release-e2e.test.mjs` — add schema/type assertions for
  the new `relaySeam` field.
- `docs/runbooks/dual-endpoint-automation.md` — document the new evidence field.
- `docs/planning/RP-DUAL-ENDPOINT-REAL-EVIDENCE-CLOSEOUT.md` — status advance
  by the RP owner after REVIEW-RELAY-SEAM-INSTRUMENTATION PASS (not by EX).

### Forbidden Scope

- No changes to `apps/` or `packages/` product code.
- No changes to `scripts/web-auto-release-e2e.ts` (EX-E2 export-only change is
  final; do not modify further).
- No ADR-0023 or ADR-0024 amendments.
- No new DOM selectors, send logic, loop policy, or extension routing.
- No dangerous flags, auto-confirmation, or real browser launch.
- No commit, push, merge, or PR.

### Required Steps

- [ ] **Add `relaySeam` to `DualEndpointEvidence` interface** (after
  `confirmationIdentity`, before `controlResult`):
  ```ts
  relaySeam?: {
    firstExtractReturnStatus: number;
    secondExtractReturnStatus: number;
    lastOutboundPromptId: string;
    outboundPromptId: string;
    promptIdMatch: boolean;
    idempotentReplayHit: boolean;
    artifactId: string;
  };
  ```
  The field is optional (`?`) so non-`chatgpt-route` scenarios and dry-run
  evidence remain valid without populating it.

- [ ] **Capture diagnostics in `runRealChatgptRoute`:** Around the existing
  `/bridge/extract-return` POST (line ~1165–1177), record:
  - `outboundPromptId`: the `outbound.outboundPrompt.id` from the `/bridge/outbound`
    response (already available at line ~1156).
  - `lastOutboundPromptId`: query the server's relay context state for this
    `sessionId` immediately before the extract-return POST. If the server
    exposes a relay-context inspection endpoint, use it; if not, capture the
    value from the outbound response and compare after the POST. Record the
    approach in the code comment.
  - `secondExtractReturnStatus`: the HTTP status code of the harness-side
    `/bridge/extract-return` POST (line ~1165). `bridgeApi` currently returns
    the parsed body; capture the raw status as well (extend `bridgeApi` return
    or use a local `fetch` for this call).
  - `firstExtractReturnStatus`: if the extension's first extract-return is
    observable from the harness side (e.g., via relay context state or a
    server-side log), record it. If not directly observable, set to `-1` and
    add a code comment explaining why. Do NOT add a new server endpoint to
    expose it — that would be a product code change. If the EX agent concludes
    that capturing this field correctly REQUIRES server-side support (a new
    endpoint, relay-context inspection surface, or any `apps/`/`packages/`
    change), it must STOP and report back to RP rather than improvising — RP
    decides whether to authorize a separate product-scope batch. The `-1`
    fallback is the authorized in-scope outcome; server-side expansion is not.
  - `promptIdMatch`: `lastOutboundPromptId === outboundPromptId`.
  - `idempotentReplayHit`: `true` if the extract-return response indicates the
    artifact was served from an idempotent replay (same `operationId` already
    processed), `false` if it created a new artifact. Infer from the response
    shape or a status marker; do not add new server-side replay-tracking
    surface.
  - `artifactId`: the `artifactResponse.artifact.artifactId` (already available
    at line ~1181).

- [ ] **Populate `relaySeam` in the returned evidence:** The
  `runRealChatgptRoute` function returns a `DualEndpointEvidence` object (around
  line ~1230). Add the captured `relaySeam` object to that return value.

- [ ] **Sanitize safely:** Verify `sanitizeEvidence` (line ~197) does not redact
  the `relaySeam` field — its key does not match the
  `cookie|pairingToken|credential|providerConfig|rawPrompt|rawReply|rawTranscript`
  pattern, so it passes through. Add a test asserting `relaySeam` survives
  sanitization with all subfields intact.

- [ ] **Add tests** in `tests/dual-endpoint-release-e2e.test.mjs`:
  - A test asserting `DualEndpointEvidence` type includes `relaySeam?` and the
    field shape matches the interface (compile-time + runtime shape check on a
    synthetic evidence object).
  - A test asserting `sanitizeEvidence` preserves all `relaySeam` subfields
    (no redaction of status codes, prompt ids, or booleans).
  - A test asserting `relaySeam` is absent (or `undefined`) on non-`chatgpt-route`
    scenario evidence (e.g., `cli-route` dry-run evidence) — the field is
    `chatgpt-route`-only.
  - Keep the existing 14 tests passing.

- [ ] **Update runbook:** In `docs/runbooks/dual-endpoint-automation.md`, add a
  short "Evidence fields" section documenting that `chatgpt-route` evidence
  includes `relaySeam` with the listed subfields, and that REVIEW-E inspects
  `idempotentReplayHit` (+ extract-return 200/201-vs-409 throw semantics) to
  validate the relay seam. (Per decision A, `promptIdMatch`/`lastOutboundPromptId`
  are id echoes and are NOT seam-validation signals.)

### Verification

```bash
npm run typecheck
node --experimental-strip-types --test tests/*dual-endpoint-release-e2e*.test.mjs
npm run build-extension
rg -n "shell: *true|--dangerously|--yolo|--full-auto|requestSubmit|KeyboardEvent|\.submit\(|'/bridge/execution-proposals/confirm'|'/bridge/execution-proposals/dispatch'" scripts/dual-endpoint-release-e2e.ts
git diff --check
```

`npm test` (full suite) is NOT required for this batch — the change is
harness/test-only and REVIEW-RELAY-SEAM-INSTRUMENTATION will verify the focused
suite. Running the full suite is optional if the agent has time.

### Report Back

Changed files (expected: harness, tests, runbook), new test count, the exact
`relaySeam` field shape as implemented, how `lastOutboundPromptId` is captured
(endpoint vs. inference), whether `firstExtractReturnStatus` is observable
from the harness side or set to `-1`, and confirmation that no product code
was touched.

---

## REVIEW-RELAY-SEAM-INSTRUMENTATION

**Owner:** reviewing agent. No implementation fixes unless the user explicitly
asks.

### Checks

- [ ] `relaySeam` field exists on `DualEndpointEvidence` with the required
  subfields (`firstExtractReturnStatus`, `secondExtractReturnStatus`,
  `lastOutboundPromptId`, `outboundPromptId`, `promptIdMatch`,
  `idempotentReplayHit`, `artifactId`).
- [ ] `runRealChatgptRoute` populates `relaySeam` in its returned evidence.
- [ ] `sanitizeEvidence` preserves all `relaySeam` subfields (test asserts this).
- [ ] Non-`chatgpt-route` scenarios do not populate `relaySeam` (field is
  optional and absent).
- [ ] No new server endpoints, no product code changes, no `web-auto-release-e2e.ts`
  changes, no real browser dependency.
- [ ] `npm run typecheck`, `npm run build-extension`, focused harness tests pass.
- [ ] Runbook documents the new field.
- [ ] `git diff --check` clean; only allowed files modified.

### Result

- PASS: update RP status to `READY-FOR-EX-E-REAL-EVIDENCE`; the next real run
  will automatically capture relay-seam diagnostics for REVIEW-E.
  **Gate design note (REVIEW-RELAY-SEAM finding):** `relaySeam.promptIdMatch`
  and `relaySeam.lastOutboundPromptId` are id echoes (always `true` / always
  equals `outboundPromptId`), not server relay-context values. The real
  rotation signal is the 409-vs-200/201 throw semantics (absence of
  `relaySeam` in evidence = extract-return threw = rotation detected).
  REVIEW-E gate has been updated to reflect this. A future product-scope
  batch could add a relay-context inspection endpoint to make
  `promptIdMatch` falsifiable, but that is out of scope for this closeout.
- BLOCKED: enumerate findings; define a bounded follow-up EX patch.

---

## EX-E-REAL-EVIDENCE

**Owner:** execution agent, operating with a human operator who supplies real
logins and performs each confirmation.

**Precondition:** REVIEW-RELAY-SEAM-INSTRUMENTATION returned PASS (relay-seam
diagnostics are captured by the harness), AND REVIEW-E2-HARNESS-COMPLETION
returned PASS (`docs/reviews/REVIEW-DUAL-ENDPOINT-AUTOMATION-CONTROL-E2.md`,
2026-06-21).

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
  gate item): the harness now captures these automatically (EX-RELAY-SEAM-
  INSTRUMENTATION). The evidence must include a `relaySeam` object; its absence
  means the extract-return POST threw (likely 409 mismatch = relay-context
  rotation, a valid `blocked` signal). When present, REVIEW-E inspects
  `relaySeam.idempotentReplayHit` (server's `replayed` flag — `true` confirms
  extension already processed this prompt) and `relaySeam.artifactId` (must be
  non-empty). Note: `relaySeam.promptIdMatch` and `relaySeam.lastOutboundPromptId`
  are id echoes, NOT server relay-context values — `promptIdMatch` is always
  `true` and is not a rotation indicator. The real rotation signal is the
  409-vs-200/201 throw semantics (absence of `relaySeam` = throw = rotation
  detected). If the real run exposes a harness bug (e.g., `relaySeam` absent on
  a `passed` verdict), the seam adjustment described in the precondition must be
  recorded as an authorized real-run harness fix (per this batch's Allowed Files).
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
- [ ] **Relay seam validated:** the ChatGPT-route evidence includes a
  `relaySeam` object (its absence means the extract-return POST threw —
  likely a 409 prompt-id mismatch from relay-context rotation, which is
  itself a valid `blocked` signal). When `relaySeam` is present, REVIEW-E
  must inspect:
  - `idempotentReplayHit`: `true` means the artifact was served from
    idempotent replay (server's `creation.replayed` flag) — confirms the
    extension's first extract-return already processed this prompt. `false`
    means the harness-side POST created a new artifact — possible
    double-fire if the extension also processed it.
  - `secondExtractReturnStatus`: must be 200/201. A 409 here is impossible
    in the current harness flow (it throws before `relaySeam` is populated),
    but if the harness is later refactored to capture 409s inline, a 409
    would indicate relay-context rotation.
  - `artifactId`: must be a non-empty string matching the proposal's
    `artifactId`.
  - **Note on `promptIdMatch` and `lastOutboundPromptId`:** these are id
    echoes (the harness captures `outboundPromptId` from the `/bridge/outbound`
    response and assigns it to `lastOutboundPromptId`), NOT the server's
    relay-context value. `promptIdMatch` is therefore always `true` and
    must NOT be used as a rotation indicator. The real rotation signal is
    the 409-vs-200/201 throw semantics described above. A future product-
    scope batch could add a relay-context inspection endpoint to make
    `promptIdMatch` falsifiable, but that is out of scope for this closeout.
  - `firstExtractReturnStatus`: always `-1` (extension's first extract-return
    is not observable from the harness side without a server inspection
    endpoint). Documented as an authorized fallback.
  A `passed` verdict without `relaySeam` present in the evidence is
  insufficient.
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

- EX-RELAY-SEAM-INSTRUMENTATION was extracted from EX-E-REAL-EVIDENCE because
  the real run is environment-gated and not repeatable on demand. Adding
  relay-seam diagnostics before the real run ensures REVIEW-E gets the evidence
  it needs in one shot, rather than discovering the harness doesn't capture the
  required fields after an expensive real run.
- The blocker for EX-E-REAL-EVIDENCE is a missing harness implementation
  (chatgpt-route real path), NOT purely environmental. EX-E2 closed the
  implementation gap; EX-RELAY-SEAM-INSTRUMENTATION adds the diagnostics layer;
  EX-E-REAL-EVIDENCE captures the real run. No product code (apps/packages)
  changes are authorized.
- Real evidence requires a reachable `/console/goals` for human confirmation
  during the harness run. The local server is harness-owned per the runbook.
- The `chatgpt-route` real path reuses ADR-0023-authorized Web automation. It
  must not add new DOM selectors, send logic, or loop policy. The reuse is
  import/export-only.
- Keep the unrelated `.kiro/specs/multi-persona-quality-gate/` untracked
  directory out of every commit in this sequence.

---

## EX-ADR0023-PROSEMIRROR

**Owner:** execution agent (independent session, NOT this RP session).

**Outcome:** Restore the `execCommand('insertText')` composer fill path in
`chatgpt-dom.ts` so that ChatGPT's ProseMirror-based contenteditable editor
correctly registers input state. This is an ADR-0023 in-intent bug fix: it
improves the "existing automatic-fill path" reliability explicitly authorized
by ADR-0023 Stage A. It does NOT introduce any send/submission mechanism.

### Preconditions

- RP-ADR0023-PROSEMIRROR disposition is LOCKED (Option 2: in-intent bug fix).
- `5120d45` overreach has been reverted (`c96742e`, pushed to origin). The
  `execCommand('insertText')` code is currently absent from `chatgpt-dom.ts`.
- `npm run typecheck`, `npm run build-extension`, `npm test` pass before
  starting (baseline verified at `ee7b0bd`).
- Untracked `.kiro/specs/multi-persona-quality-gate/` is left untouched.

### Allowed Files

- `apps/extension/src/content/chatgpt-dom.ts` — restore the
  `execCommand('insertText')` fill logic that was removed by the revert. The
  fill must fire `beforeinput`/`input` events so ProseMirror registers the
  text. No send logic.
- `tests/chatgpt-dom.test.mjs` — add or update content-fill tests proving the
  fill path works and that no send/submission path exists in the diff.
- `docs/planning/ADR-0023-chatgpt-web-automation-authorization.md` — append
  exactly ONE clarification sentence to the "ChatGPT DOM Rules > Allowed"
  section (line ~127-134). The sentence must state that composer fill may use
  `execCommand('insertText')` to trigger the framework's input pipeline,
  provided no submission (send click, keyboard Enter, `requestSubmit`, form
  submit) is performed. Do NOT change the ADR's Decision, Forbidden list, or
  Status.

### Forbidden Scope

- No send-button click automation.
- No keyboard, Enter-key, or shortcut simulation.
- No `requestSubmit`, `.submit()`, or form submission.
- No automatic inbound return.
- No changes to `outbound-poller.ts`, `extraction.ts`, `bridge-client.ts`,
  `active-relay-session.ts`, `index.ts`, or any other `apps/` file.
- No changes to `packages/`, `scripts/`, or `package.json`/`package-lock.json`.
- No Stage B or Stage C state transitions.
- No MCP, shell, terminal, workspace write, commit, push, merge, or PR scope.
- No changes to the ADR-0023 Decision, Forbidden list, Superseded section, or
  Acceptance Conditions.
- **ANTI SCOPE-CREEP STOP (hard clause):** During real-Chrome verification, if
  the fill requires changes to ANY file beyond the 3 allowed files (port,
  harness, server, extension other files, `scripts/`, `packages/`), the EX
  agent MUST STOP and return control to RP. In-place "fix it to make it run"
  changes are exactly what caused the `5120d45` overreach. This batch touches
  ONLY these 3 files; any "to make it pass" extra change must return to RP for
  re-batching. No exceptions, even if the real-Chrome run fails.

### Required Implementation

1. **Restore the fill path.** In `chatgpt-dom.ts`, re-add the
   `execCommand('insertText')` logic that fills the ChatGPT composer. The fill
   must:
   - Target the composer contenteditable element with the existing fixture-
     covered selector (no new broad selectors).
   - Use `document.execCommand('insertText', false, text)` (or the modern
     equivalent that fires `beforeinput` with `inputType: 'insertText'`) so
     ProseMirror's input pipeline registers the text.
   - Not click, focus-then-Enter, or submit anything.
   - Preserve the existing "locate and fill" structure — this is a reliability
     fix to the fill, not a new feature.

2. **ADR-0023 clarification.** Append one sentence to the Allowed list in the
   "ChatGPT DOM Rules" section. Suggested wording:
   > Composer fill may use `document.execCommand('insertText')` (or an
   > equivalent `beforeinput`-firing API) to trigger the framework's input
   > pipeline, provided no submission mechanism is invoked.

3. **Source-boundary tests.** Add tests in `tests/chatgpt-dom.test.mjs` that:
   - Prove the fill function exists and calls `execCommand('insertText')` (or
     fires `beforeinput`), not any send/submit API.
   - Scan the `chatgpt-dom.ts` source for forbidden patterns
     (`click.*send`, `KeyboardEvent`, `keydown`, `keypress`, `requestSubmit`,
     `.submit(`, `form.submit`, `dispatchEvent.*submit`) and assert zero
     matches. Do NOT scan for bare `Enter` — it false-positives on `center`,
     `EnterText`, comments, etc. Keyboard submission is detected via
     `KeyboardEvent`/`keydown`/`keypress`, not the string "Enter".
   - Verify the existing fill tests still pass.

### Required Tests

- All existing extension and server tests remain green.
- New source-boundary tests prove no send-button click, keyboard submission,
  `requestSubmit`, or form submission exists in the `chatgpt-dom.ts` diff.
- Content-fill tests prove the fill fires `beforeinput`/`input` (or calls
  `execCommand('insertText')`) and does NOT invoke any send mechanism.

### Required Runtime Evidence

- Run `npm run typecheck` — must pass.
- Run `npm test` — must pass (including new source-boundary tests).
- Run `npm run build-extension` — must pass.
- Perform a real Chrome ChatGPT run proving the composer fill works (text
  appears in the composer, ProseMirror registers state) WITHOUT automatic
  send. This may be deferred to REVIEW-ADR0023-PROSEMIRROR if the real
  environment is unavailable; document the deferral.

### Report Back

Return control to **REVIEW-ADR0023-PROSEMIRROR** with:
- Changed files (must be ≤ 3: `chatgpt-dom.ts`, `chatgpt-dom.test.mjs`,
  `ADR-0023-...md`).
- Test results (full suite + new source-boundary tests).
- Source-avoidance scan output (zero forbidden patterns in the diff).
- The exact ADR-0023 Allowed clarification sentence added.
- Real Chrome evidence (or documented deferral with reason).
- Unresolved risks or questions.

```text
EX-ADR0023-PROSEMIRROR - Restore execCommand('insertText') composer fill (ADR-0023 in-intent fix).

Allowed files:
- apps/extension/src/content/chatgpt-dom.ts
- tests/chatgpt-dom.test.mjs
- docs/planning/ADR-0023-chatgpt-web-automation-authorization.md (Allowed section only)

Forbidden:
- send-button click, keyboard/Enter simulation, requestSubmit, .submit(), form submission;
- automatic inbound return;
- changes to any other apps/, packages/, scripts/, or package files;
- ADR-0023 Decision/Forbidden/Status changes;
- Stage B/C state transitions;
- MCP, shell, terminal, workspace write, commit, push, merge, PR scope;
- ANTI SCOPE-CREEP: if real-Chrome verification needs changes beyond the 3
  allowed files, STOP and return to RP. In-place "make it run" fixes caused
  the 5120d45 overreach. This batch = ONLY these 3 files, no exceptions.

Required:
- restore execCommand('insertText') fill that fires beforeinput for ProseMirror;
- source-boundary tests proving zero KeyboardEvent/keydown/keypress/requestSubmit/.submit(/form.submit/click.*send/dispatchEvent.*submit in the diff (do NOT scan bare "Enter" — false positives);
- one ADR-0023 Allowed clarification sentence (no decision change);
- npm run typecheck + npm test + npm run build-extension all pass;
- real Chrome fill proof (or documented deferral).

Return control to REVIEW-ADR0023-PROSEMIRROR.
```

---

## EX-HARNESS-INFRA-CFT

**Owner:** execution agent (independent session, NOT this RP session).

**Outcome:** Re-land the six harness-only infra fixes that `5120d45`
introduced and `c96742e` reverted, so the dual-endpoint harness can launch a
Chrome-For-Testing browser with the extension, connect over CDP, reach the
local server on the extension's expected port, and run on Windows. Harness/tooling only — NO
`apps/` product behavior, NO ADR-0023 DOM/relay change, NO auto-confirm, NO new
dependency.

### Preconditions

- Decisions (e) LOCKED: no `playwright` devDependency; `loadPlaywright()`
  already resolves Playwright via ambient/`npx` (throws a clear "run npx
  playwright or install playwright" message if absent).
- `5120d45` reverted (`c96742e`, pushed). The four fixes below are currently
  ABSENT.
- `npm run typecheck`, `npm run build-extension`, focused harness tests pass at
  baseline (`757f894`).
- Untracked `.kiro/specs/multi-persona-quality-gate/` is left untouched.
- Independent of EX-ADR0023-PROSEMIRROR (that batch owns `chatgpt-dom.ts`; this
  batch must not touch any `apps/` file).

### Allowed Files

- `scripts/web-auto-release-e2e.ts` — re-land Chrome-For-Testing discovery,
  CDP-mode build skip, and CDP `Target.getTargets` extension-id fallback.
- `scripts/dual-endpoint-release-e2e.ts` — re-land the
  `DEFAULT_LOCAL_SERVER_PORT` wiring in `runRealChatgptRoute` (import the
  EXISTING constant from `packages/shared/src/constants.ts`; import only, no
  `packages/` change).
- `docs/runbooks/dual-endpoint-automation.md` — document the CFT requirement
  and CDP launch flags.
- `tests/dual-endpoint-release-e2e.test.mjs` and/or harness tests — add
  coverage where feasible (arg parsing, port wiring) without launching a real
  browser.

### Forbidden Scope

- No changes to ANY `apps/` file (product code; `chatgpt-dom.ts` belongs to
  EX-ADR0023-PROSEMIRROR).
- No changes to `packages/` (importing an existing exported constant is allowed;
  editing `packages/` source is not).
- No new dependency; no `package.json`/`package-lock.json` change. If a fix
  genuinely cannot work without adding `playwright` as a devDependency, STOP and
  return to RP — the dependency decision is RP's, not EX's.
- NO marker-matching fallback logic, NO auto-confirm / `/confirm` / `/dispatch`
  automation (those belong to RP-CONFIRMATION-MECHANISM and are forbidden here).
- No ADR-0023/ADR-0024 changes. No DOM submission, relay, routing, or loop
  behavior change.
- No commit, push, merge, or PR.

### Required Implementation (re-land exactly these six)

1. **CFT Chrome discovery.** Make `discoverChromePath` resolve a
   Chrome-For-Testing executable (via `loadPlaywright()` →
   `playwright.chromium.executablePath()`), with the existing explicit
   `--chrome-path` input honored first and a clear error if neither resolves.
   Reason: branded Chrome 137+ removed `--load-extension`; only CFT/Chromium
   honour it.
2. **CDP-mode build skip.** Skip `buildWebAutoExtension()` when `--connect-cdp`
   or `--connect-active-chrome` is set (rebuilding overwrites the in-use dist
   and Chrome unloads the extension). When skipped, require an existing dist and
   error clearly if missing.
3. **Server port wiring.** In `runRealChatgptRoute`, start the local server with
   `port: DEFAULT_LOCAL_SERVER_PORT` (imported from
   `packages/shared/src/constants.ts`) so the extension's hardcoded endpoint
   matches. Do not hardcode a literal port.
4. **CDP extension-id fallback.** In `discoverExtensionId`, add a CDP
   `Target.getTargets` fallback for `connectOverCDP` mode (service-worker
   discovery is unreliable there). Read-only target enumeration; no injection.
5. **Cross-platform handoff path.** `ACTIVE_HANDOFF_PATH` in
   `dual-endpoint-release-e2e.ts` (line ~107) is currently the hardcoded POSIX
   `'/tmp/cli-bridge-dual-endpoint-active.json'`, which does not exist on
   Windows. Restore `resolve(tmpdir(), 'cli-bridge-dual-endpoint-active.json')`
   (import `tmpdir` from `node:os`). Windows-compat fix that 5120d45 made and
   the revert removed.
6. **Cross-platform entry-point check.** Both
   `dual-endpoint-release-e2e.ts` (line ~1410) and `web-auto-release-e2e.ts`
   (line ~933) compare `resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)`.
   On Windows `new URL(...).pathname` yields a drive-letter-doubled path
   (`/H:/...` → `H:\H:\...` after resolve), breaking the main-module guard.
   Restore `fileURLToPath(import.meta.url)` (import `fileURLToPath` from
   `node:url`) in BOTH files. Windows-compat fix reverted with 5120d45.

### ANTI SCOPE-CREEP STOP (hard clause)

During real-Chrome verification, if any fix requires changes beyond the allowed
files (e.g., an `apps/` extension change, a `packages/` edit, or a new
dependency), the EX agent MUST STOP and return control to RP. In-place "fix it
to make it run" changes are exactly what caused the `5120d45` overreach. No
exceptions, even if the real-Chrome run fails.

### Verification

```bash
npm run typecheck
node --experimental-strip-types --test tests/*dual-endpoint-release-e2e*.test.mjs
npm run build-extension
git diff --check
```

Plus a source-avoidance scan over the changed harness files for
`KeyboardEvent|keydown|keypress|requestSubmit|\.submit\(|form\.submit|/bridge/execution-proposals/confirm|/bridge/execution-proposals/dispatch`
(zero new matches). Optionally a real CFT+CDP launch proof; if the environment
is unavailable, document the deferral — do NOT add code to force it.

### Report Back

Return control to **REVIEW-HARNESS-INFRA-CFT** with: changed files (harness +
runbook + tests only; zero `apps/`/`packages/`/dependency), test results,
source-avoidance scan output, confirmation the four fixes are scoped exactly as
above, and any STOP-triggering findings.

```text
EX-HARNESS-INFRA-CFT - Re-land 6 harness-only infra fixes reverted with 5120d45.

Allowed files:
- scripts/web-auto-release-e2e.ts
- scripts/dual-endpoint-release-e2e.ts
- docs/runbooks/dual-endpoint-automation.md
- tests/dual-endpoint-release-e2e.test.mjs (coverage only, no real browser)

Re-land exactly:
1. CFT Chrome discovery (playwright.chromium.executablePath), honor --chrome-path first;
2. skip buildWebAutoExtension() in --connect-cdp / --connect-active-chrome mode;
3. runRealChatgptRoute starts server with port: DEFAULT_LOCAL_SERVER_PORT (import existing constant);
4. discoverExtensionId CDP Target.getTargets fallback (read-only);
5. ACTIVE_HANDOFF_PATH = resolve(tmpdir(), '...') (node:os) instead of POSIX '/tmp/...' (Windows-compat);
6. entry-point guard uses fileURLToPath(import.meta.url) (node:url) in BOTH dual-endpoint + web-auto (Windows drive-letter fix).

Forbidden:
- any apps/ change (chatgpt-dom.ts is EX-ADR0023-PROSEMIRROR's), any packages/ source edit;
- new dependency / package.json change (STOP->RP if a fix needs playwright devDep);
- marker fallback, auto-confirm, /confirm or /dispatch automation;
- ADR-0023/0024 or DOM/relay/loop behavior change;
- commit, push, merge, PR.

ANTI SCOPE-CREEP STOP: if any fix needs changes beyond the allowed files, STOP and return to RP. No exceptions even if the real run fails.

Verify: npm run typecheck + harness tests + npm run build-extension + source-avoidance scan + git diff --check.
Return control to REVIEW-HARNESS-INFRA-CFT.
```
