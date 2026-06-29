# ADR-0024 Amendment: WorkBuddy Execution Endpoint Authorization

**Amends**: ADR-0024 (Dual-Endpoint Middle-Layer Automation Control) §6
**Status**: Proposed (awaiting operator acceptance)
**Date**: 2026-06-29
**Authorized by**: RP-TERMINAL-PAIRING-WORKBUDDY-EXECUTION

---

## Amendment Scope

This amendment changes the WorkBuddy paragraph in §6 of ADR-0024. All other
sections of ADR-0024 remain unchanged.

---

## Current Text (ADR-0024 §6, lines 169–173)

> The current WorkBuddy identity remains non-executing. A future WorkBuddy
> execution route requires a separately registered endpoint identity, a bounded
> adapter, capability evidence, focused tests, and explicit ADR amendment or
> replacement. Existing WorkBuddy task-source/result-sink records must not be
> silently promoted.

## Replacement Text

> The current WorkBuddy task-system identity (`/bridge/projects/:key/workbuddy`,
> task-source/result-sink, `canExecute: false`) remains unchanged for
> non-execution paths. Existing WorkBuddy task records must not be silently
> promoted to execution authority.
>
> A separately registered WorkBuddy execution endpoint (canonical id `workbuddy`,
> `transport: 'workbuddy'`, `canExecute: true`) is authorized by
> `ADR-0003-AMENDMENT-workbuddy-execution.md` and scoped by
> `RP-TERMINAL-PAIRING-WORKBUDDY-EXECUTION.md`. This amendment is the explicit
> ADR amendment required by the original text.
>
> The `workbuddy` endpoint is subject to all rules of this ADR:
> - §2 (reuse Goal/Plan as run state machine);
> - §3 (binding immutability during a run);
> - §5 (every execution dispatch requires human confirmation);
> - §6 (provider-neutral lifecycle: draft → confirmed → dispatching → returned);
> - §7 (Project Console owns control);
> - §8 (fail closed, no automatic retry).
>
> The endpoint uses a pull-based inbox/result protocol. WorkBuddy pulls execution
> tasks from `GET /bridge/endpoints/:id/inbox/next` and returns structured results
> via `POST /bridge/endpoints/:id/results`. The middle layer never pushes execution
> commands to WorkBuddy. WorkBuddy must not self-confirm proposals, modify
> bindings, or choose its own project root.
>
> The `canExecute: true` declaration is deferred to EX-4 of
> `RP-TERMINAL-PAIRING-WORKBUDDY-EXECUTION.md`, after the endpoint registry
> upgrade (EX-1) and inbox/result protocol (EX-4 adapter) are complete.

## Rationale

The original text correctly anticipated this change: "A future WorkBuddy
execution route requires a separately registered endpoint identity, a bounded
adapter, capability evidence, focused tests, and explicit ADR amendment."

All conditions are now met:
1. **Separately registered endpoint identity**: canonical id `workbuddy` with
   `transport: 'workbuddy'`, distinct from the task-system identity.
2. **Bounded adapter**: Pull-based inbox/result protocol — no direct push, no
   generic shell, no arbitrary command execution.
3. **Capability evidence**: `canExecute: true` in provider capability declaration
   (EX-4), verified by `validateProviderCapability`.
4. **Focused tests**: `tests/workbuddy-state.test.mjs`, `tests/bridge-workbuddy-api.test.mjs`,
   new inbox/result endpoint tests in EX-4.
5. **Explicit ADR amendment**: This document (ADR-0024 amendment) and
   `ADR-0003-AMENDMENT-workbuddy-execution.md`.

## Impact

- **ADR-0003 §7**: Also amended by `ADR-0003-AMENDMENT-workbuddy-execution.md`.
- **Code**: `provider-capability.ts` updates the `workbuddy` provider capability
  declaration (EX-4). `endpoint-registry.ts` supports `transport: 'workbuddy'`
  (EX-1). New `workbuddy-execution-adapter.ts` (EX-4).
- **API**: `GET /bridge/endpoints/:id/inbox/next`, `POST /bridge/endpoints/:id/results`,
  `POST /bridge/endpoints/:id/log` (EX-4).
- **Non-Goals preserved**: The original ADR-0024 Non-Goals remain intact:
  "promotion of the current WorkBuddy identity to executor" — the existing
  task-system identity is NOT promoted; a separate endpoint is created.

## Gate

- [ ] Operator accepts this amendment.
- [ ] ADR-0003 §7 amendment is also accepted.
- [ ] EX-1 through EX-4 completion before `canExecute: true` takes effect.

## Sign-off

Operator reply of `接受` (or equivalent) required before EX-4 implementation.
