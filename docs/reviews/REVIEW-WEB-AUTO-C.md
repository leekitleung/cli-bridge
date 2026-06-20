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
