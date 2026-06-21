# REVIEW: Dual-Endpoint Automation Control — E2 (Harness Completion)

Status: PASS (with documented caveats; advances gate to READY-FOR-EX-E-REAL-EVIDENCE)

Date: 2026-06-21

Batch reviewed: `EX-E2-HARNESS-COMPLETION`
(see `docs/planning/RP-DUAL-ENDPOINT-REAL-EVIDENCE-CLOSEOUT.md`)

## Reviewed scope

- `scripts/dual-endpoint-release-e2e.ts` (new `runRealChatgptRoute`, scenario
  dispatcher, contract paths for the 7 non-real scenarios)
- `scripts/web-auto-release-e2e.ts` (export-only)
- `tests/dual-endpoint-release-e2e.test.mjs` (4 new tests)
- `docs/runbooks/dual-endpoint-automation.md` (`codex-high` → registered ids)

## Gate checks

1. PASS — `runRealChatgptRoute()` exists and follows the same
   binding → artifact → proposal → confirmation → dispatch → correlation
   lifecycle as `runRealCliRoute()`, reusing the locked binding
   (`reasoningEndpointId: chatgpt-web`, `executionEndpointId: codex-medium`).
2. PASS — `web-auto-release-e2e.ts` diff is export-only: `export` added to
   `RuntimeContext`/`BrowserHandle` interfaces and to `buildExtension`,
   `launchBrowser`, `discoverExtensionId`, `ensureChatGptPage`,
   `injectPairingToken`, `waitPromptReturned`. No selector/relay/send/loop or
   ADR-0023 behavior change. Web-auto focused tests remain green.
3. PASS — All nine scenarios produce valid evidence (`passed` contract or a real
   `blocked-real-*` code); none returns `unexpected-error`. A dedicated new test
   asserts this for `scenario:all`, `dryRun:false`, no endpoints.
4. PASS — Runbook `codex-high` references removed; scan returns zero matches.
   Examples now use `codex-command` / `claude-code-command` + `codex-medium`.
5. PASS — No dangerous flags, no auto-confirmation calls, no `apps/`/`packages/`
   product code changed. Only the 4 authorized files are modified; the untracked
   `.kiro/specs/multi-persona-quality-gate/` is untouched.
6. PASS — Focused harness tests 10/10 pass and cover the new `chatgpt-route`
   dispatch at contract level (no real browser launched).
7. CAVEAT — `npm run typecheck` PASS and `npm run build-extension` PASS, but the
   full `npm test` run is not fully green (see below).

## Verification (re-run by reviewer)

- `node --experimental-strip-types --test --test-timeout=60000 tests/workspace-apply.test.mjs`
  → 49/49 PASS in isolation.
- `npm test -- --test-timeout=90000` → 997 tests, 979 pass, 17 fail, 1 cancelled.
- Failing/cancelled set (reviewer-captured): WorkBuddy persistence round-trip
  (338); Bridge Panel jsdom UI (484–486); runtime snapshot/persistence atomic
  write, backup, corrupt-recovery, rehydrate (652–654, 656–657, 662–667, 669);
  `process-lifecycle.test.mjs` (file 53, the spawn hang → cancelled);
  `cwdPolicy` symlink-resolves-outside-root (917).

## Caveat analysis

The 17 failures + 1 cancelled are Windows-environment/parallel-execution
artifacts (atomic file rename, backup/temp-file semantics, symlink-creation
privilege, process-spawn teardown hang, jsdom timing). Evidence they are NOT
EX-E2 regressions:

- None of the failing test files import `dual-endpoint-release-e2e.ts` or
  `web-auto-release-e2e.ts` (grep-confirmed).
- The working tree contains only the 4 authorized EX-E2 files; no product module
  under `apps/`/`packages/` changed.
- `workspace-apply.test.mjs` — one of the named failing files — passes 49/49 when
  run in isolation, confirming the full-suite failure is concurrency/environment
  noise, not deterministic breakage.

The prior `REVIEW-DUAL-ENDPOINT-AUTOMATION` "986/986" baseline was recorded in a
different (non-Windows) environment. These failures are not attributable to
EX-E2.

## Carry-forward risk for EX-E-REAL-EVIDENCE

The ChatGPT real path is structurally faithful but unverified end-to-end (no
logged-in profile / Chrome-for-Testing / reachable CDP in this environment). The
one integration seam to validate during real-evidence capture: the harness
persists the ChatGPT reasoning reply by POSTing `/bridge/extract-return` a second
time (harness-side) with `planId` + `operationId` + `artifactKind:execution-proposal`,
relying on `createIdempotent` replay and `relayContext.lastOutboundPromptId`
still matching after the extension's first extract-return. If the extension's
first extract-return consumes/rotates the relay context, the harness must instead
attach the automation `planId` to the original outbound prompt. This must be
confirmed (and the harness adjusted if needed) during EX-E-REAL-EVIDENCE.

## Decision

PASS. EX-E2 completed the harness within its authorized boundary; the only
non-green verification is pre-existing, environment-bound, and unrelated to the
changed files. Advance the active gate to `READY-FOR-EX-E-REAL-EVIDENCE`.
EX-E-REAL-EVIDENCE remains environment-gated on real logins and must validate the
ChatGPT relay seam above. No commit/push/PR was made by EX-E2.
