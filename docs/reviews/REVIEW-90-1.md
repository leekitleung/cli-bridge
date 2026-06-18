# REVIEW-90-1 - Authority, Idempotency, Persistence, Secrets

**Date**: 2026-06-18

**Baseline**: `10d25a4` (`docs(review): open five-role 90 hardening loop`)

**Verdict**: **PASS; EX-90-2 AUTHORIZED**

## Findings closed during review

1. Snapshot reads initially classified every filesystem error as a missing file
   and accepted unsupported future schema versions. The follow-up fails closed
   for non-`ENOENT` reads, preserves legacy versions 0-2, and rejects future or
   invalid versions.
2. The content and background paths used session storage, but the real popup
   still used persistent `chrome.storage.local`. The popup and built extension
   now use `chrome.storage.session` exclusively and describe the session-only
   lifetime to the user.
3. Five legacy tests still encoded client-owned outbound `endpointId` routing
   or omitted the server-issued return `operationId`. They now exercise the
   approved server-owned routing contract without weakening production code.

## Boundary replay

- Pairing token remains required by protected bridge routes.
- Extension content and popup code contain no client-selected `endpointId`.
- A failed outbound acknowledgement creates no relay context.
- Claim-token and lease fencing tests remain green.
- No auto-send, keyboard simulation, or automatic clipboard write was added.
- Snapshots retain legacy version compatibility and fail explicitly for an
  unsupported version, unreadable storage, or corrupt primary and backup.

## Verification

- Focused EX-90-1 tests: `52/52` passed.
- Historical relay and extension boundary tests: `40/40` passed.
- Full suite: `865/865` passed.
- `npm run lint`: exit 0.
- `npm run typecheck`: exit 0.
- `npm run build-extension`: exit 0.
- `git diff --check`: clean.

## Scope decision

EX-90-1 is accepted. Only the terminal and lifecycle work defined by EX-90-2
is authorized next. Product workflow and visual changes remain forbidden until
REVIEW-90-2 passes.
