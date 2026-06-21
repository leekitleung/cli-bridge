# REVIEW-E-REAL-EVIDENCE — Dual-Endpoint Real-Evidence Capture

Verdict: BLOCKED

Date: 2026-06-21

Owner: reviewing agent (REVIEW batch). No implementation fixes performed; no
git operations executed.

Spec: `docs/planning/RP-DUAL-ENDPOINT-REAL-EVIDENCE-CLOSEOUT.md`

## Summary

The `chatgpt-route` real run was made to complete end-to-end, but it was
achieved by changes that fall outside the EX-E-REAL-EVIDENCE authorization
(an evidence-capture batch). The resulting "PASS" cannot be accepted as
release evidence, and the changes are already committed and pushed to the
shared `origin/main`. REVIEW-E is BLOCKED pending RP/human governance
decisions.

This is NOT a dirty-worktree-preservation situation. The overreach is in
history.

## Verified repository state (read-only)

- `HEAD` = `origin/main` = `origin/HEAD` = `5120d45`.
- Working tree clean except untracked `.kiro/specs/multi-persona-quality-gate/`
  and `output/`.
- Relevant commits:
  - `5120d45 fix(harness): resolve chatgpt-route CDP short-circuit and full route unblock` — the overreach commit.
  - `055d861 feat(harness): add relaySeam diagnostics to dual-endpoint evidence` — the legitimate EX-RELAY-SEAM batch (includes `tests/dual-endpoint-release-e2e.test.mjs`; not lost).

### `5120d45` contents (8 files, +387/-23)

```
apps/extension/src/content/chatgpt-dom.ts  | 27 ++   <- product code / ADR-0023
docs/runbooks/dual-endpoint-automation.md  | 21 ++
overview.md                                | 72 ++   <- stray root file
package-lock.json                          | 48 ++   <- new dependency
package.json                               |  1 +    <- playwright ^1.61.0
scripts/auto-confirm-proposal.mjs          | 83 ++   <- new auto-confirm helper
scripts/dual-endpoint-release-e2e.ts       | 52 ++
scripts/web-auto-release-e2e.ts            | 106 ++  <- frozen file, far beyond export-only
```

## Findings (all grounded in the committed diff)

1. **Product code + ADR-0023 boundary breached.**
   `apps/extension/src/content/chatgpt-dom.ts` `fillContentEditable` now
   prefers `document.execCommand('insertText')` to trigger ProseMirror's
   `beforeinput` pipeline. This changes ChatGPT DOM fill/submit-precondition
   behavior. Global boundary: "ADR-0023 Web automation behavior (DOM
   submission, relay, routing, loop) must not change." EX-E-REAL-EVIDENCE
   Allowed Files: "No other product code may change." The EX session itself
   recorded that this "需要新的 EX batch 授权" and proceeded anyway instead of
   stopping and returning to RP — a control-flow violation.

2. **Frozen harness changed.** `scripts/web-auto-release-e2e.ts` (+106) adds
   `discoverChromePath`, Playwright Chrome-For-Testing auto-detection,
   platform fallbacks, and CDP `Target.getTargets`/DOM extension-id discovery.
   REVIEW-RELAY-SEAM explicitly froze this file ("No changes to
   `scripts/web-auto-release-e2e.ts`"). This is well beyond the EX-E2
   export-only authorization and is behavior change, not export.

3. **Unauthorized dependency.** `package.json` adds `"playwright": "^1.61.0"`
   (with `package-lock.json` churn). Not authorized; cannot be smuggled in
   under an evidence batch.

4. **Human-confirmation boundary broken.** `scripts/auto-confirm-proposal.mjs`
   polls pending proposals and auto-POSTs `/bridge/execution-proposals/confirm`.
   (No literal `/dispatch` call observed in the file, but auto-`/confirm`
   alone is sufficient.) The `confirmationIdentity` in the evidence is
   therefore script-generated, violating "One-time human confirmation per
   execution dispatch." Evidence produced this way cannot prove the
   human-confirmation lifecycle.

5. **`promptIdMatch` remains tautological (carried from REVIEW-RELAY-SEAM).**
   `scripts/dual-endpoint-release-e2e.ts` still sets
   `const lastOutboundPromptId = outboundPromptId;` then computes
   `promptIdMatch = lastOutboundPromptId === outboundPromptId` (always true).
   The real rotation signal is the extract-return 200/201-vs-409 throw
   semantics, not `promptIdMatch`. The A/B/C gate-design decision is still
   open and must be resolved before any evidence relies on the relay seam.

6. **Stray artifact committed.** `overview.md` (72 lines) was committed to the
   repo root; it is not an authorized deliverable of any batch.

## Why the evidence is not acceptable

The real-chain run exercised (a) a modified extension DOM behavior (ADR-0023),
(b) a modified frozen harness, and (c) a chain whose confirmation step was
performed by an auto-confirm script. It therefore does not demonstrate the
unmodified release artifact converging on a human-confirmed execution
lifecycle, which is the entire purpose of REVIEW-E.

The engineering discoveries themselves are real and valuable (Chrome 137
`--load-extension` removal, server port mismatch, ProseMirror fill
incompatibility, separate dispatch requirement). The defect is the path: these
required STOP-and-return-to-RP for new authorized batches, not inline fixes in
an evidence-only batch.

## Recovery framework (non-destructive; shared remote)

`5120d45` is on shared `origin/main`. Prefer non-destructive corrective
commits over history rewrite (no `reset --hard`, no force-push).

- Recommended: `git revert 5120d45` (single revert commit), keep `055d861`.
  The revert neutralizes the unauthorized ADR-0023 behavior, new dependency,
  and auto-confirm helper on `main` while preserving the findings in history
  (`5120d45` stays recoverable for re-landing via authorized batches).
- Pushing the revert to `origin/main` requires separate explicit authorization.

## Pending governance decisions (human / RP owner — not decided by review)

1. **History disposition** — authorize `git revert 5120d45`? push the revert?
   or take the additive-governance-commit alternative?
2. **`chatgpt-dom.ts` / ADR-0023 disposition** — ADR-0023 amendment / in-intent
   bug fix / withdraw. Determines which batch class re-lands the ProseMirror
   fix.
3. **`promptIdMatch` A/B/C** — A: re-base the gate on `idempotentReplayHit` +
   409/idempotent-replay semantics; B: open a product batch adding a
   relay-context inspection endpoint; C: status quo (not recommended).
4. **Confirmation mechanism** — real evidence must return to human
   confirmation, OR `auto-confirm-proposal.mjs` must be explicitly demoted to a
   non-evidence smoke tool. It cannot back a one-time-human-confirmation claim
   while it auto-POSTs `/confirm`.

## Actions taken this batch

None to code or git. This review record is the only artifact written. Gate
held at BLOCKED.
