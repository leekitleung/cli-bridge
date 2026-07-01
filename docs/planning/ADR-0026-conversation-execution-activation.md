# ADR-0026: Conversation Execution Activation

Status: Accepted

Date: 2026-07-01

## Context

ADR-0025 made the Project Console and installed extension obtain local bridge
credentials without manual token entry. Conversation mode can now receive text,
but currently only writes transcript events and route-status explanations. Users
see `draft`, `queued`, or `not-implemented` without a governed next action.

## Decision

CLI Bridge may turn Conversation messages into server-owned action previews for
existing governed routes. Review-command targets may create previewed review
requests. WorkBuddy targets may create confirmable execution requests that are
queued only after explicit confirmation.

## Constraints

- No automatic dispatch from raw conversation text.
- No generic shell, run, exec, Git, PR, or workspace mutation endpoint.
- Managed PTY conversation dispatch remains blocked.
- All mutating actions require server-owned confirmation state.
- Conversation action confirm/dispatch requires local Console cookie auth.
- Returned model or ChatGPT content remains untrusted data.
- Extension code may not choose target routes or confirm/dispatch actions.
- Existing route authentication and pairing boundaries remain unchanged.

## Acceptance

**Accepted by:** Senior Developer (高级开发工程师), 2026-07-01

**Review notes:**
- All 8 constraints verified against implementation plan (Tasks 0–7).
- Auth boundary tightened in `caaca75`: confirm/dispatch requires local Console
  cookie auth; extension session token must 403. Tested in Task 4 Step 2.
- Architecture preserves existing review/WorkBuddy gates — no new shell/run/exec
  endpoints introduced.
- UI action buttons mapped exclusively to `/conversation/actions/:id/confirm` and
  `/dispatch` routes.
- No token-bearing artifacts in URL, DOM, localStorage, logs, or commits.

**Next:** Proceed to EX implementation per the 7-task plan in
`docs/superpowers/plans/2026-07-01-conversation-execution-activation.md`.
