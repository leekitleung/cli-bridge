# ADR-0026: Conversation Execution Activation

Status: Proposed

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
- Returned model or ChatGPT content remains untrusted data.
- Extension code may not choose target routes or confirm actions.
- Existing route authentication and pairing boundaries remain unchanged.

## Acceptance Conditions

This ADR requires explicit human acceptance before EX implementation.
