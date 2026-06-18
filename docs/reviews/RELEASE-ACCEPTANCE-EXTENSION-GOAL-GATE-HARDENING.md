# Release Acceptance - Extension Goal Gate Hardening

**Date**: 2026-06-18

**Branch**: `main`

**Implementation commit**: `1f3073af302397860afd55378f8a535336b21309`

**Verdict**: **PASS WITH REMOTE-EVIDENCE WARNINGS**

## Release blocker and fix

The live Chrome extension used a Chrome-assigned unpacked extension ID,
`fhchgdnhoghcjnlajjhejikndobkenmi`. Its service-worker requests therefore
carried the real origin
`chrome-extension://fhchgdnhoghcjnlajjhejikndobkenmi`, while the local server
allowed only the placeholder development origin. The server rejected outbound
acknowledgements with `403 Invalid origin` before pairing-token validation.
The claimed outbound then expired as `claim-lease-expired`, so neither the
server relay context nor the content-script active relay session was created.

The origin guard now accepts only syntactically valid Chrome extension origins
(`chrome-extension://` plus 32 `a-p` characters). The pairing token remains
the authentication gate: the live-origin HTTP regression returns `401`
without a token and `200` only with the valid token. Malformed extension and
non-extension origins remain rejected.

## Live Chrome and ChatGPT evidence

The release E2E used the built unpacked extension, the real
`https://chatgpt.com` UI, and the loopback server:

- outbound prompt: `ff1162df-508a-4e86-bf70-1d07d66d980c`;
- session: `s-release-origin-fix-20260618`;
- endpoint seeded server-side: `mock-inbound-agent`;
- the extension poller filled
  `Reply exactly: CLI Bridge inbound origin fix verified`;
- the composer remained unsent until the browser Send button was clicked;
- after refresh, the panel reported `回程上下文可用`, proving fill plus ack
  created the active relay session;
- ChatGPT returned `CLI Bridge inbound origin fix verified`;
- explicit selected-text preview reported
  `待确认: 已从选中文本提取，确认后回传`;
- no return occurred before `确认回传` was clicked;
- after confirmation, the panel reported `已回传执行端` and cleared the active
  relay session;
- server-owned routing queued inbound message
  `f5de2344-9da5-4fab-8386-7c6b53b958e0` for
  `mock-inbound-agent`, with the expected session, packet, source
  `chatgpt-web-extract`, and exact content.

## Boundary evidence

- **No auto-send**: live composer state stayed pending before the explicit Send
  click; focused poller coverage rejects submission and automatic clipboard
  writes.
- **Server-owned routing**: the outbound seed supplied the endpoint to the
  server; extract-return supplied only session and content.
- **No `endpointId` in content script routing**: source inspection and focused
  tests confirm the content-side extract-return body has no endpoint field and
  the server ignores any body-supplied endpoint.
- **Explicit return confirmation**: live preview did not route until the
  separate confirmation action.

## Runbook

`PLAN-MULTI-EXECUTOR-RELAY.md` and `scripts/manual-inbound-e2e.mjs` now match
the current popup pairing and panel workflow:

1. pair through the extension popup;
2. wait for `回程上下文可用`;
3. explicitly select the reply text;
4. click `预览回传`;
5. inspect the preview and click `确认回传`.

## Verification

```text
npm run lint             PASS
npm run typecheck        PASS
npm run build-extension  PASS
npm test                 PASS (857/857)
focused boundary tests   PASS (47/47)
git diff --check         PASS
remote-review-gate       PASS
```

The focused boundary set covered the origin/token gate, background proxy
allowlist, outbound ack and active-session behavior, no-auto-send, explicit
extract confirmation, inbound routing, and failed-ack fallback.

## Remote evidence

Before this report was added:

- local implementation HEAD:
  `1f3073af302397860afd55378f8a535336b21309`;
- `origin/main`:
  `1f3073af302397860afd55378f8a535336b21309`;
- divergence: `0/0`;
- remote-review gate: PASS, no hard failures.

GitHub CLI authentication was unavailable, so PR and CI evidence remain
explicit `pr-unavailable` and `ci-unavailable` warnings. They are not
represented as passes.

## Final decision

The original live release blocker is fixed and reproduced by regression
coverage. The real Chrome/ChatGPT outbound, manual send, selected-text preview,
explicit confirmation, and inbound return path passed without crossing the
approved architecture boundaries. The slice is accepted for release, with only
the stated GitHub evidence warnings.
