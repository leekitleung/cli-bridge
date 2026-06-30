# ADR-0025: Local Console Auto-Pairing And Extension Session

Status: Accepted

Date: 2026-06-30

Accepted By: Senior Developer (REVIEW-Task2)

Acceptance Rationale: The constraints are narrow, the risk is explicit, and the
scope fence prevents route-permission bypass. Task 1 (session store) and Task 2
(server routes) have been implemented with TDD, 111/111 tests passing, typecheck
clean. The implementation adheres to all boundary phrases: loopback-only origin
check, HttpOnly cookie, separate one-time nonce claim, no token in
URL/localStorage/DOM, revoke clears both Console and extension credentials, no
new shell/exec/run endpoint.

## Context

Manual pairing-token entry in the Project Console adds operator friction. The
operator wants to reduce manual steps, not remove the bridge security boundary.
ChatGPT Web / extension automation may already support automatic send or
automatic return under ADR-0023 and later Web Auto stages.

The current Project Console can be opened locally without a separate Console
session. Existing `/bridge/*` requests are authenticated by a printed pairing
token sent in `x-cli-bridge-pairing-token`. The extension can store that token
manually in `chrome.storage.session`.

## Decision

CLI Bridge may auto-pair the local Project Console on loopback and may allow
the installed CLI Bridge extension to claim a local automation session after the
Console is opened.

This is an explicit accepted risk: opening the local Console can authorize the
extension for the same local server process. That authorization is still scoped
to existing controlled bridge routes and does not create arbitrary execution
authority.

## Constraints

- Loopback only: `127.0.0.1` and `[::1]`.
- Process lifetime only: server restart invalidates local sessions.
- `/bridge/*` remains authenticated.
- No token in URL, localStorage, config, logs, screenshots, reports, or visible
  DOM.
- Console auth uses an HttpOnly same-origin cookie.
- Extension auth uses a separate one-time nonce claim and a separate session
  token stored in `chrome.storage.session`.
- The printed pairing token remains available as a manual fallback and is never
  embedded in Console HTML.
- Revoke clears the server-side local session, the Console cookie, and extension
  session storage.
- Claim nonce replay, expired sessions, revoked sessions, and non-loopback
  origins fail closed.
- No new shell, run, exec, Git, PR, workspace mutation, or route-permission
  bypass is authorized by this ADR.

## Relationship To ADR-0023

ADR-0023 controls ChatGPT Web automatic send and automatic return behavior. This
ADR does not widen those automation rules. It only changes how the local Console
and installed extension may obtain a bridge credential for the current local
server process.

If ADR-0023 or later Web Auto stages allow automatic send or return, the
extension may use the local automation session created by this ADR for those
already-authorized controlled routes. Returned ChatGPT content remains untrusted
data and grants no execution authority.

## Acceptance Conditions

This ADR requires explicit human acceptance before EX implementation.

Acceptance means:

- local Console auto-pairing is authorized only inside the loopback,
  process-lifetime, no-token-leakage constraints above;
- extension session claim is authorized only through a short-lived one-time
  Console nonce;
- implementation must follow the matching plan in
  `docs/superpowers/plans/2026-06-30-local-console-auto-pairing-extension-session.md`;
- each EX batch must return to review before the next execution slice.

While this ADR remains Proposed, implementation is blocked except for planning,
review, and documentation changes.
