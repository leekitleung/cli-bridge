# REVIEW-90-3F - Product Workflow and Launch Follow-up

**Date**: 2026-06-18

**Baseline**: `5f2af77` plus accepted EX-90-1F and EX-90-2F changes

**Verdict**: **PASS; FINAL FIVE-ROLE RERUN AUTHORIZED**

## Findings closed

- `npm start` is now the primary safe product entrypoint and starts the loopback
  server with the server-owned inbound test route.
- Manual inbound E2E seeding no longer accepts a client-selected `endpointId`;
  outbound routing stays server-owned.
- The outbound poller emits visible claimed, delivered, and failed events while
  still never submitting ChatGPT messages.
- The ChatGPT panel exposes the approved four-stage workflow: connect, fill for
  ChatGPT, select/preview, and confirm return.
- Unpaired guarded actions are disabled, exactly one primary action is active
  at each connected workflow stage, and duplicate return clicks are locked while
  a return is in flight.
- The popup and ChatGPT panel support light/dark host themes, focus-visible
  outlines, status live regions, and 44px touch targets.
- The panel can collapse without losing the safety boundary.
- Project Console mobile navigation now exposes project navigation, history,
  and compact facts through a drawer instead of hiding context.

## Boundary replay

- No automatic ChatGPT send was added: no `requestSubmit`, synthetic
  `KeyboardEvent`, send-button automation, or implicit submit path.
- No automatic clipboard write was added; clipboard remains an explicit copy
  action.
- The extension content script still does not accept or display an endpoint
  selector.
- Bridge calls still require the pairing token, and pairing token entry remains
  in the extension-owned popup rather than the ChatGPT page DOM.
- Console UI remains a thin client over allowlisted `/bridge/*` endpoints; no
  shell, run, cwd, env, or arbitrary execution surface was introduced.
- The EX-90-1F persistence and EX-90-2F terminal boundaries were not widened by
  this product/UI slice.

## Verification

- Focused EX-90-3 tests:
  `npm test -- tests/local-launcher.test.mjs tests/manual-inbound-helper.test.mjs tests/inbound-routing-e2e.test.mjs tests/outbound-poller.test.mjs tests/extension-loop-panel.test.mjs tests/project-console-ui.test.mjs tests/project-console-behavior.test.mjs`
  passed `120/120`.
- `npm run lint`: exit 0.
- `npm run typecheck`: exit 0.
- `npm run build-extension`: exit 0.
- `git diff --check`: clean.
- Full suite: `npm test` exit 0.

## Visual evidence

Captured from the current build on 2026-06-18 with local service
`node --experimental-strip-types scripts/start.ts` already listening on
`127.0.0.1:31337`.

- `output/playwright/2026-06-18-90-3f/project-console-desktop.png`
- `output/playwright/2026-06-18-90-3f/project-console-mobile.png`
- `output/playwright/2026-06-18-90-3f/project-console-mobile-nav-open.png`
- `output/playwright/2026-06-18-90-3f/extension-popup-initial.png`
- `output/playwright/2026-06-18-90-3f/extension-popup-network-failure.png`
- `output/playwright/2026-06-18-90-3f/chatgpt-panel-unpaired.png`
- `output/playwright/2026-06-18-90-3f/chatgpt-panel-return-blocked.png`
- `output/playwright/2026-06-18-90-3f/chatgpt-panel-collapsed.png`

The ChatGPT panel screenshots use the built extension content script loaded into
a dark ChatGPT-shaped fixture. They prove the current built panel renders,
matches the host theme, disables unpaired actions, and collapses. They do not
claim a live logged-in ChatGPT Web account E2E run.

## Scope decision

EX-90-3 is accepted. The final evidence batch is authorized to record source
and build hashes, remote gate output, screenshot paths, and a fresh five-role
review. If any role scores below 90 or reports a red line, the next execution
batch must be limited to those findings only.
