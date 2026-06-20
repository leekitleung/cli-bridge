# REVIEW-WEB-AUTO-B - One-Round Automatic Web Relay

Status: PASS

Date: 2026-06-19

## Decision

`EX-WEB-AUTO-B` is accepted.

The Stage B exit gate now has real logged-in Chrome-for-Testing evidence proving
outbound through inbound with no extension interaction after initial pairing.

## Findings

1. Earlier real browser evidence did not reach `returned`.

   Evidence: `output/playwright/stage-b-one-round-4.png`

   Observed server state:

   ```text
   queued
   claimed
   filled-and-acknowledged
   waiting-manual-send
   submitted
   responding
   failed:streaming
   ```

   `inboundStatus` was `null` and `inboundHasExpectedReply` was `false`.
The browser page showed the submitted prompt, but no stable assistant reply
was available to route back before timeout. This blocks the required
outbound-to-inbound acceptance proof.

2. Follow-up profile checks did not produce a logged-in replay environment.

   Evidence:

   - `output/playwright/stage-b-profile4-check.png`
   - `output/playwright/stage-b-default-check.png`
   - `output/playwright/stage-b-default-dom-debug.png`

   `Profile 4` had no ChatGPT/OpenAI cookies. A copied `Default` profile had
   ChatGPT/OpenAI cookies, but ChatGPT rendered `authStatus:"logged_out"` in the
   isolated browser and showed the login/sign-up page. The extension loaded in
   the isolated `Default` copy, but the session was not logged in, so it cannot
   satisfy the required logged-in outbound-to-inbound run.

3. The existing Chrome process is not currently automatable for this gate.

   Checks on local ports `9222`, `9223`, `9333`, and `9334` found no Chrome
   DevTools Protocol endpoint. The real Chrome profiles `Default`, `Profile 2`,
   and `Profile 4` also did not have the local `CLI Bridge` unpacked extension
   installed. Without a debug-enabled, logged-in Chrome session that has the
   extension loaded, the REVIEW-B gate cannot be completed by automation.

4. Follow-up logged-in Chrome-for-Testing evidence passed the gate.

   Evidence: `output/playwright/stage-b-cft-one-round.png`

   Observed server state:

   ```text
   queued
   claimed
   filled-and-acknowledged
   waiting-manual-send
   submitted
   responding
   response-ready
   returned
   ```

   `inboundStatus` was `claimed`, `inboundHasExpectedReply` was `true`, and the
   inbound content matched the submitted marker.

## Accepted Local Evidence

- `npm run typecheck` passed.
- `npm run build-extension` passed.
- Targeted Stage B tests passed: 92 tests.
- Full `npm test` passed after updating the Stage B boundary test.
- Forbidden-scope scan over `apps/extension/src` and `apps/extension/dist`
  returned no matches for:

  ```text
  requestSubmit|KeyboardEvent|\.submit\(|localStorage|document\.cookie|CodexManaged|MockAgent|/bridge/run|/bridge/shell|/bridge/exec
  ```

## Boundary Review

- The extension uses a single native ChatGPT send button click only after
  composer hash verification and submitted-prompt page evidence.
- It does not use Enter-key simulation, `requestSubmit`, form `.submit()`,
  shell/run endpoints, browser secret reads, or executor selection.
- The server owns return routing through relay context; the extension does not
  choose an inbound endpoint.
- Response timeout now terminates the outbound record as `failed` rather than
  leaving it active.

## Stage C Authorization

`RP-WEB-AUTO-C` may proceed. Stage C implementation remains unauthorized until
that planning batch defines the bounded loop policy and an execution prompt.
