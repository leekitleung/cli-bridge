# REVIEW-WEB-AUTO-C - Bounded Web Relay Loops

Status: PASS

Date: 2026-06-19

## Decision

`EX-WEB-AUTO-C` is accepted.

Stage C adds server-owned bounded loop records and loop routes without adding
new extension-side submission authority. The real Chrome-for-Testing run proved
two automatic rounds and a hard stop at `maxRounds = 2`.

## Findings

No blocking findings.

## Accepted Evidence

- `npm run typecheck` passed.
- `node --experimental-strip-types --test tests/web-relay-loop-store.test.mjs tests/json-persistence.test.mjs tests/bridge-api.test.mjs` passed: 42 tests.
- `npm test` passed.
- `npm run build-extension` passed.
- `git diff --check` passed.
- Forbidden-scope scan over `apps/extension/src` and `apps/extension/dist`
  returned no matches for:

  ```text
  requestSubmit|KeyboardEvent|\.submit\(|localStorage|document\.cookie|CodexManaged|MockAgent|/bridge/run|/bridge/shell|/bridge/exec
  ```

## Chrome E2E Evidence

Evidence: `output/playwright/stage-c-cft-two-rounds-current.png`

Observed final run:

```text
createStatus: 201
round1.promptStatus: returned
round1.evidence: queued -> claimed -> filled-and-acknowledged -> waiting-manual-send -> submitted -> responding -> response-ready -> returned
round1.inboundHasMarker: true
advance1Status: 200
round2Created: true
round2.promptStatus: returned
round2.evidence: queued -> claimed -> filled-and-acknowledged -> waiting-manual-send -> submitted -> responding -> response-ready -> returned
round2.inboundHasMarker: true
stopStatus: 200
stopLoopStatus: done
stopReason: max-rounds-reached
stopCreatedOutbound: false
bodyHasRound1: true
bodyHasRound2: true
bodyHasShouldNotRun: false
```

The accepted CFT run used a logged-in Chrome-for-Testing session with the
unpacked extension loaded through CDP on port `9224`. Pairing token material was
kept out of logs and source files.

## Boundary Review

- Loop state is server-owned in `InMemoryWebRelayLoopStore`; the extension still
  performs only the Stage B one-round transport for each outbound.
- Loop records persist in the JSON snapshot as `webRelayLoops`.
- Hydration recovery fails active loops with uncertain outbound state, including
  `submitted` and `responding`, and marks the current outbound failed instead of
  replaying it.
- `maxRounds` defaults to `3` and hard-fails above `10`.
- Stop conditions are covered for max rounds, hard max, per-round timeout, total
  deadline, pause/cancel, repeated content, no-progress, premature return, and
  restart uncertainty.
- The active relay session remains sanitized: no endpoint id is stored by the
  extension-owned session.
- The extension does not make routing decisions, read browser secrets, use
  Enter-key simulation, use `requestSubmit`, use form `.submit()`, or expose
  shell/run/workspace/Git/MCP authority.

## Notes

Two intermediate CFT harness attempts were discarded because the harness read
the wrong response shape (`outboundReport.prompts` and `inboundMessages` require
their documented wrappers/filters). The final accepted run used the corrected
report paths and passed.

Post-review validation policy update: ordinary logged-in browser validation is
now the primary development and product-readiness path for Web Auto work.
Chrome-for-Testing and Playwright-controlled sessions remain supplemental
release evidence tools. Login, Cloudflare, account interstitial, or human
verification failures are environment blockers and must not be bypassed by
expanding extension authority.

2026-06-24 daily ordinary-browser follow-up:

- Deterministic gates were rerun after tightening loop-report sanitization:
  `node --experimental-strip-types --test tests/bridge-api.test.mjs` passed
  15/15, `npm run typecheck` passed, `npm run build-extension` passed,
  `npm test` passed 1011/1011, and `git diff --check` passed.
- `npm run web-auto:e2e -- --dry-run --scenario all --connect-cdp
  http://127.0.0.1:9224` passed argument/preflight validation.
- Real ordinary-browser validation could not start because no browser CDP
  listener was available on `127.0.0.1:9224`; the escalated harness attempt
  failed closed with `ECONNREFUSED 127.0.0.1:9224` before any prompt was
  created. Sanitized blocker evidence was written to
  `output/playwright/web-auto-release-daily/2026-06-24T14-33-11-742Z-stage-b-one-round.json`.
- No extension authority was expanded to bypass the missing browser session.

2026-06-25 Computer Use follow-up:

- The missing-CDP blocker was narrowed: Chrome 149 did not expose remote
  debugging from the default user data directory even when the process carried
  `--remote-debugging-port=9224`. A non-default user data directory with a
  foreground Chrome process exposed CDP successfully on `127.0.0.1:9226` and
  `127.0.0.1:9227`.
- Loading the unpacked extension required omitting `--disable-extensions-except`;
  with only `--load-extension`, CDP showed the CLI Bridge popup target at
  `chrome-extension://fignfifoniblkonapihmkfakmlgkbkcf/popup/index.html`.
- The release harness was tightened to discover CLI Bridge from CDP popup
  targets when a connected browser does not expose a stable service-worker
  target/title. `node --experimental-strip-types --test
  tests/web-auto-release-e2e.test.mjs` passed 12/12.
- After the CDP and extension-discovery issues were fixed, the harness advanced
  to the real environment blocker and failed closed with `not-logged-in` for the
  isolated ChatGPT profile before any prompt was created. Sanitized blocker
  evidence was written to
  `output/playwright/web-auto-release-daily/2026-06-24T21-42-03-233Z-stage-b-one-round.json`.
- After the operator logged in, the harness-owned profile path with
  `--base-port 31337` loaded the CLI Bridge panel and local-server pairing path,
  but ChatGPT remained behind Cloudflare/human verification and the composer did
  not become ready. The run failed closed before creating any prompt. Sanitized
  blocker evidence was written to
  `output/playwright/web-auto-release-daily/2026-06-24T22-10-52-114Z-stage-b-one-round.json`,
  with the screenshot at
  `output/playwright/web-auto-release-daily/2026-06-24T22-10-52-114Z-stage-b-one-round-failure.png`.
- This is an environment blocker under the Stage C review policy. No CAPTCHA or
  human-verification bypass was attempted, and no extension authority was
  expanded.
