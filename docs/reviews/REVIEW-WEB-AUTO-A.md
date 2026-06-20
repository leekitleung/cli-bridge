# REVIEW-WEB-AUTO-A — Stage A Reliability and Evidence

**Batch**: `REVIEW-WEB-AUTO-A`
**Date**: 2026-06-19
**Verdict**: **PASS — Stage A accepted; return to RP/EX-WEB-AUTO-B**

## Findings

1. **PASS: real Chrome failure recovery is proven.** The isolated recovery run
   used one Chrome profile for a no-composer failure and a separate profile for
   the recovery claim. The failed prompt recorded `queued -> claimed -> failed`.
   The recovery prompt recorded
   `queued -> claimed -> filled-and-acknowledged -> waiting-manual-send`, and
   the screenshot shows the prompt visibly filled in the ChatGPT composer.

2. **PASS: Stage A keeps the manual-send boundary.** Boundary scan over
   `apps/extension/src` and `apps/extension/dist` found no `requestSubmit`,
   `KeyboardEvent`, `.submit(`, `send-button`, broad send selector, or runtime
   send-control click path.

3. **PASS: controlled-module historical boundaries replayed.** The active relay
   session still records no `endpointId`; the extension does not select an
   inbound route; extract-return continues to require the server-owned relay
   context and operation id; claim-token fencing remains intact; stale claims
   fail closed instead of replaying.

4. **PASS: Stage A evidence is sanitized.** The acceptance report exposes ids,
   status, target, and evidence only. It omits prompt content, pairing token,
   raw content, and endpoint routing data.

5. **Fixed during review: panel waiting-state regression.** Real Chrome showed
   the composer filled and server report in `waiting_manual_send`, while the
   panel displayed `自动填入失败`. Root cause: a later `waiting/active-session`
   poller event was handled by the panel's generic failure branch. The panel now
   treats `active-session` as neutral and preserves the delivered status.

## Changed Files Reviewed

- `docs/planning/ADR-0023-chatgpt-web-automation-authorization.md`
- `docs/planning/ADR-0002-v1.5b-command-transport.md`
- `apps/extension/src/content/active-relay-session.ts`
- `apps/extension/src/content/bridge-client.ts`
- `apps/extension/src/content/outbound-poller.ts`
- `apps/extension/src/ui/bridge-panel.tsx`
- `apps/local-server/src/routes/bridge-api.ts`
- `apps/local-server/src/storage/outbound-prompt-store.ts`
- `packages/shared/src/schemas.ts`
- `packages/shared/src/types.ts`
- related tests under `tests/`

## Verification

- `npm run typecheck` — PASS.
- `npm test` — PASS, 906 tests.
- `npm run build-extension` — PASS.
- Boundary scan over `apps/extension/src apps/extension/dist` — PASS, no
  forbidden Stage A submit primitives found.
- Targeted Stage A tests — PASS:
  - relay-session state machine evidence;
  - duplicate/active-session claim blocking;
  - reconnect/unpaired/streaming wait states;
  - timeout/no-composer failure;
  - cancellation;
  - report redaction;
  - claim-token fencing and stale-claim fail-closed.

## Chrome Evidence

- `output/playwright/stage-a-real-chrome-fixed.png`
  - extension loaded;
  - popup paired through `chrome.storage.session`;
  - ChatGPT page injected the CLI Bridge panel;
  - composer visibly filled with the Stage A outbound prompt;
  - panel status: `已填入: 请在 ChatGPT 中手动发送`;
  - server report for session `stage-a-real-chrome-2`:
    `queued -> claimed -> filled-and-acknowledged -> waiting-manual-send`;
  - report prompt shape:
    `evidence`, `id`, `packetId`, `sessionId`, `status`, `target`.

- `output/playwright/stage-a-isolated-failure.png`
  - no-composer failure prompt recorded:
    `queued -> claimed -> failed`.

- `output/playwright/stage-a-isolated-recovery.png`
  - recovery prompt visibly filled in the ChatGPT composer;
  - panel status: `已填入: 请在 ChatGPT 中手动发送`;
  - server report for session `stage-a-recovery-success-isolated`:
    `queued -> claimed -> filled-and-acknowledged -> waiting-manual-send`.

## Decision

Proceed to `EX-WEB-AUTO-B`. Stage A implementation is locally green, preserves
the manual-send boundary, and has real Chrome evidence for both the successful
claim/fill/ack path and failure recovery.

## Next Bounded Action

Start `EX-WEB-AUTO-B` under ADR-0023:

1. implement one-round automatic Web relay only;
2. require outbound authorization, redacted content hash, expiration, and
   composer-hash verification before any click;
3. use exactly one visible enabled native ChatGPT send control;
4. return only the matching stable assistant response through the server-owned
   relay context;
5. keep all non-Web transport prohibitions active.
