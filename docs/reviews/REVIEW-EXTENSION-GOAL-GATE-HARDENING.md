# REVIEW - Extension Goal Gate Hardening

**Date**: 2026-06-18

**Reviewer**: Codex review batch

**Branch**: `codex/extension-goal-gate-hardening`

**Base**: `80edd4e` (`origin/main` at review start)

**Verdict**: **PASS** - the bounded extension hardening diff is accepted for
local closeout. No commit or push was performed by this review.

## Scope

This review covers the uncommitted extension hardening slice present on the
branch at review time:

- move pairing-token entry from the ChatGPT page into an extension-owned popup;
- replace automatic clipboard fallback with explicit user copy actions;
- require preview plus explicit confirmation before an extracted result is
  returned;
- retain and consume a bounded active relay session for return routing;
- fence outbound acknowledgements with a claim token and expire stale claims;
- narrow background proxy access to an explicit method/path allowlist;
- add bounded client and proxy request timeouts;
- update extension build output and focused regression coverage.

The review did not authorize product expansion, automatic ChatGPT send,
endpoint selection in the content script, arbitrary loopback proxying, or work
on another roadmap slice.

## Review history

The first acceptance pass returned **CHANGES REQUIRED** because the full test
suite reported `855/856`:

- `tests/extract-return.test.mjs` still asserted the previous
  extract-immediately-routes behavior.
- The implementation intentionally changed that contract to
  preview -> explicit confirmation -> return.

A bounded follow-up changed only that test. The replacement assertion verifies
that the preview handler does not call `createExtractReturn`, while the confirm
handler routes through `submitExtractReturn` and retains the existing no
`endpointId` and no-auto-send boundaries.

## Acceptance evidence

| # | Criterion | Evidence |
| --- | --- | --- |
| 1 | Pairing token stays out of page DOM | The content panel no longer renders a password/token input; the extension popup owns token entry and storage. |
| 2 | Pairing is verified before persistence | Popup `保存并测试` probes protected health and persists only a successful token. Empty and unreachable-server states produce explicit errors. |
| 3 | No automatic send | Source and regression tests reject `requestSubmit`, synthetic `KeyboardEvent`, and send-button automation. |
| 4 | No implicit clipboard write | Composer failures return a failed result unless clipboard fallback is explicitly enabled; the poller test proves zero automatic clipboard writes. |
| 5 | Return requires human confirmation | Preview only records extracted text. Confirm without a preview is blocked; confirmed content routes through `submitExtractReturn`. |
| 6 | Return routing remains server-owned | The content script supplies a session, not an endpoint. Tests retain the no-`endpointId` boundary and exercise inbound versus pending-prompt fallback. |
| 7 | Relay context is bounded | Active relay state expires after its TTL, blocks a second outbound claim while awaiting return, survives a failed return, and clears after successful return. |
| 8 | Outbound acknowledgement is fenced | Claim responses carry an opaque claim token; acknowledgement requires the current token and rejects missing, stale, or mismatched claims. |
| 9 | Stale claims do not replay | Expired claims become failed with `claim-lease-expired`; focused storage coverage confirms no automatic replay. |
| 10 | Proxy surface is explicit | Background proxy accepts only listed GET/POST route pairs and rejects arbitrary `/bridge/*` paths. |
| 11 | Network waits are bounded | Client/background requests use a 10-second abort/response timeout and normalize failures to `network-error`. |
| 12 | Build is loadable | Extension build emits background, content, popup HTML/JS, and a manifest whose popup path is rewritten for `dist`. |

## Role scorecard

The repository does not define an existing role-scoring rubric for this batch.
This review therefore uses an explicit 10-point scale: `9-10` strong,
`8-8.9` pass with contained gaps, `6-7.9` conditional, and `<6` fail. Scores
measure this bounded slice only, not the whole product.

| Review role | Score | Assessment |
| --- | ---: | --- |
| Product owner / scope guardian | **9.2/10** | The slice stays focused on a safer manual relay loop and does not add auto-send, arbitrary execution, or a new roadmap capability. Deduction: operator recovery for expired claims remains manual. |
| Architecture reviewer | **8.8/10** | Routing authority remains server-side, claim fencing is explicit, and popup/content/background responsibilities are clearer. Deduction: active relay state is in-memory and stale claims intentionally fail rather than enter a governed retry flow. |
| Security and privacy reviewer | **9.3/10** | Pairing secrets leave the shared page DOM, proxy routes are allowlisted, automatic clipboard writes are removed, acknowledgements are fenced, and network waits are bounded. Deduction: not every timeout path has a focused hung-body regression test. |
| UX reviewer | **8.6/10** | Pairing, connection failure, preview, confirmation, and blocked states are explicit and readable; fixtures show no panel overflow. Deduction: validation used fixtures rather than a live Chrome plus ChatGPT session, and pairing still spans popup and page surfaces. |
| QA / verifier | **9.1/10** | Focused tests pass `118/118`, the repaired contract test passes `7/7`, the full suite passes `856/856`, build/type/lint/diff gates pass, and key UI states were exercised with Playwright. Deduction: no live-site end-to-end or remote CI evidence. |
| Release / repository gatekeeper | **7.2/10** | The branch has a reproducible local green gate and a documented review trail. Deduction: the worktree is dirty, the slice is uncommitted/unpushed, generated artifacts are untracked, and remote/CI parity is unverified. |

**Unweighted overall score**: **8.7/10**.

**Local acceptance threshold**: met.

**Release-ready threshold**: not met until repository sync, remote CI, and the
separately authorized live end-to-end gate are complete.

## Interactive validation

Fresh Playwright CLI validation used the built extension scripts through local
HTTP fixtures:

1. Popup initially rendered `未配对`.
2. Submitting an empty token rendered `请输入配对口令`.
3. An unreachable local server rendered an explicit connection failure and did
   not report success.
4. The ChatGPT panel rendered without token-entry controls.
5. Clicking `确认回传` before preview rendered `没有待回传内容`.
6. Clicking `预览回传` extracted only the marked assistant block and changed
   the panel to `待确认` without returning it automatically.

This fixture validation covers the UI state machine and built scripts. It does
not claim a live Chrome extension plus live ChatGPT plus live local-server
end-to-end run.

## Verification

Final verification was run after the bounded test follow-up:

```text
npm run lint             PASS
npm run typecheck        PASS
npm run build-extension  PASS
npm test                 PASS (856/856, 0 failed)
git diff --check         PASS
```

The focused follow-up test also passed independently:

```text
node --experimental-strip-types --test tests/extract-return.test.mjs
PASS (7/7, 0 failed)
```

## Changed-file boundary

The reviewed diff is limited to these families:

- extension manifest, background proxy, content relay/extraction/poller, panel,
  popup, and extension build script;
- local-server outbound route/store fencing;
- shared outbound prompt type/schema;
- directly affected regression tests.

The acceptance follow-up itself changed only
`tests/extract-return.test.mjs`. This report adds no production behavior.

## Residual risk

1. Live Chrome/ChatGPT DOM compatibility remains dependent on the current
   ChatGPT page structure; fixtures and unit tests cannot fully prove the live
   site integration.
2. The 10-second timeout paths are structurally covered, but there is no focused
   hung-response regression test for every newly bounded fetch path.
3. Stale claims intentionally fail instead of replaying. Operators need to
   recreate failed work; this is the safer no-duplicate default for this slice.
4. The worktree remains uncommitted and includes generated/untracked validation
   artifacts. Repository-sync and remote/CI evidence are therefore not part of
   this local acceptance verdict.

## Decision

**PASS for local acceptance.** The prior full-suite blocker is resolved, the
authorized behavior and safety boundaries are covered, and all required local
verification gates pass. Control returns to the repository owner for any
separately authorized commit, push, remote review, or live end-to-end gate.
