# ADR-0003 Amendment: WorkBuddy Execution Authorization

**Amends**: ADR-0003 (Controlled Execution Layer) §7
**Status**: Proposed (awaiting operator acceptance)
**Date**: 2026-06-29
**Authorized by**: RP-TERMINAL-PAIRING-WORKBUDDY-EXECUTION

---

## Amendment Scope

This amendment changes §7 of ADR-0003. All other sections of ADR-0003 remain
unchanged.

---

## Current Text (ADR-0003 §7, lines 99–104)

> 7. WorkBuddy role
>
> - WorkBuddy remains a task/context source and a result/ledger sink only.
> - WorkBuddy MUST NOT trigger execution, MUST NOT bypass plan approval or the
>   state-changing gate, and MUST NOT become a controller (unchanged v0.8 boundary).

## Replacement Text

> 7. WorkBuddy role
>
> - WorkBuddy's task-system identity (task/context source, result/ledger sink)
>   remains unchanged for non-execution paths. Existing WorkBuddy task records
>   must not be silently promoted to execution authority.
> - WorkBuddy may execute as a separately registered endpoint (`workbuddy-executor`)
>   through the controlled execution layer defined by this ADR. This endpoint:
>   - uses a pull-based inbox/result protocol (WorkBuddy pulls tasks; the middle
>     layer never pushes execution commands to WorkBuddy);
>   - is subject to all gates defined in §4 (state-changing gate), §5 (plan
>     approval), and §6 (audit, interrupt);
>   - requires human confirmation for every execution dispatch (per ADR-0024 §5);
>   - must not self-confirm proposals, modify bindings, or choose its own project
>     root.
> - WorkBuddy MUST NOT bypass plan approval or the state-changing gate, and
>   MUST NOT become a controller over other endpoints. These boundaries from the
>   v0.8 framework remain binding.
> - The implementation is scoped by `RP-TERMINAL-PAIRING-WORKBUDDY-EXECUTION.md`
>   and its EX-1 through EX-6 phases. The `canExecute: true` declaration is gated
>   behind a complete endpoint registry, inbox/result protocol, bounded adapter,
>   capability evidence, and focused tests.

## Clarification Paragraph (unchanged)

The existing clarification (lines 105–114, "WorkBuddy's current task-system
identity, not a permanent product limit...") is superseded by this amendment
and may be removed or marked as historical. The directional intent it described
is now the active decision.

---

## Rationale

The original boundary ("MUST NOT trigger execution") was correct for v2.2 when
WorkBuddy was purely a task source and result sink. Since then:

1. The middle-layer gating infrastructure is complete (Goal → Plan → Approve →
   Proposal → Confirm → Dispatch → Audit).
2. ADR-0024 established immutable bindings and per-dispatch human confirmation.
3. The project needs WorkBuddy as an execution endpoint to enable the
   full terminal-pairing UX (project preset → goal snapshot → plan binding).

The residual risk is bounded by:
- Pull-based inbox (WorkBuddy cannot be pushed commands)
- Human confirmation gate (per ADR-0024 §5)
- Immutable binding (no mid-run endpoint swap)
- Schema-validated structured results (malformed outputs rejected)
- Audit trail (endpointId, bindingHash, proposalId, result status)

---

## Impact

- **Code**: `provider-capability.ts` changes `workbuddy.canExecute: false → true`
  in EX-4. `schemas.ts` removes the `'WorkBuddy cannot be an executor'` rejection
  in EX-4.
- **Tests**: `provider-capability.test.mjs` assertions about WorkBuddy being
  non-executing change from "expect failure" to "expect success" in EX-4.
- **ADR-0024 §6**: Also amended by `ADR-0024-AMENDMENT-workbuddy-endpoint.md`.

## Gate

- [ ] Operator accepts this amendment.
- [ ] `canExecute: true` must NOT be changed until EX-4 gating conditions are met
  (endpoint registry, inbox/result protocol, adapter, tests).
- [ ] ADR-0024 §6 amendment is also accepted.

## Sign-off

Operator reply of `接受` (or equivalent) required before EX-4 implementation.
