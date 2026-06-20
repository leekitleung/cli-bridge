# REVIEW-A: Dual-Endpoint Automation Control

Status: PASS

Date: 2026-06-20

Reviewed scope:

- `packages/shared/src/types.ts`
- `packages/shared/src/schemas.ts`
- `apps/local-server/src/storage/automation-binding-store.ts`
- `apps/local-server/src/storage/goal-store.ts`
- `apps/local-server/src/routes/bridge-api.ts`
- `apps/local-server/src/storage/json-snapshot-store.ts`
- `tests/automation-binding-store.test.mjs`
- `tests/bridge-goals-api-automation-binding.test.mjs`

## Findings

1. Resolved: derive API can leave a new current Plan without a valid binding.

   `apps/local-server/src/routes/bridge-api.ts` creates the derived Plan before
   validating and creating the derived binding. If
   `automationBindingStore.deriveBinding(...)` rejects, for example because the
   requested execution endpoint is unknown or non-executing, the catch returns
   409 but the `goalStore.derivePlan(...)` mutation has already happened. That
   makes the new derived Plan current for the goal with no corresponding valid
   binding.

   Evidence: `derivePlan(...)` is called before `deriveBinding(...)` in
   `apps/local-server/src/routes/bridge-api.ts`.

   Follow-up result: PASS. The route now validates a derived binding before
   mutating `goalStore`, and `tests/bridge-goals-api-automation-binding.test.mjs`
   proves failed derive does not replace the current Plan or create an orphan
   binding.

2. Resolved: EX-A touched snapshot persistence outside the allowed file
   list.

   `apps/local-server/src/storage/json-snapshot-store.ts` was modified to add
   `automationBindings` to snapshot read/write. This is useful for durable
   binding state, but it is not in EX-A's allowed file list. REVIEW-A cannot
   treat the batch as strictly scope-clean unless the reviewing/planning owner
   explicitly accepts this file into the EX-A allowed range or requests a
   follow-up that removes/re-scopes it.

   Follow-up result: PASS. The RP EX-A allowed file list now explicitly includes
   `apps/local-server/src/storage/json-snapshot-store.ts` for binding
   persistence wiring.

## Passed Evidence

- Schemas define `RunEndpointBinding` and derived `Plan.parentPlanId`.
- Binding hash covers goal, plan, parent plan, endpoint identities, tiers,
  permission profile, project reference, limits, and deadline.
- Binding store rejects non-executing execution endpoints and invalid tiers.
- Binding lock rejects post-lock mutation.
- Focused tests cover compatible endpoint pairing, same-provider profiles,
  missing capabilities, tier mismatch, unknown project reference, invalid
  limits, hash mismatch, post-lock mutation, API create/inspect/derive, and
  cancel-before-step advance.
- No execution proposal, dispatch route, provider call, console UI, extension
  endpoint selection, or WorkBuddy execution promotion was added by EX-A.

## Verification

```bash
npm run typecheck
```

Result: PASS.

```bash
node --experimental-strip-types --test tests/*automation-binding*.test.mjs tests/goal-store.test.mjs tests/bridge-goals-api.test.mjs
```

Result: PASS, 55/55.

```bash
npm test
```

Result: PASS, 956/956.

```bash
rg -n "shell: *true|dangerously|bypass|requestSubmit|KeyboardEvent|\.submit\(" packages/shared/src apps/local-server/src
```

Result: no new provider invocation or submit primitive. Matches are existing
denylist/comment/policy text.

```bash
git diff --check
```

Result: PASS.

## Decision

REVIEW-A passes. RP may advance to `READY-FOR-EX-B`.
