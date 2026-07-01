# ADR-0027: Generic Conversation Route Adapters

Status: Proposed

Date: 2026-07-01

## Context

ADR-0026 made Conversation actions dispatchable from the local Project Console,
but execution dispatch is still coupled to a specific endpoint id. This makes
Conversation automation feel like a WorkBuddy shortcut rather than a pairing
between the selected source and target tools.

## Decision

Conversation automation will dispatch through registered target route adapters.
The pairing chooses source and target endpoints. The target endpoint resolves to
a route adapter based on endpoint transport and capabilities. The adapter owns
preview, confirm, and dispatch behavior for that route.

## Constraints

- Auto-dispatch remains local Console session authority only.
- Extension and ChatGPT content scripts cannot confirm or dispatch actions.
- Endpoints without a registered adapter are not auto-dispatchable.
- Managed PTY and web relay remain non-auto-dispatch routes in this ADR.
- No generic shell, run, exec, Git, PR, or workspace mutation endpoint is added.

## Acceptance Conditions

This ADR requires explicit human acceptance before execution implementation.
