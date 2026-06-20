# REVIEW-C: Dual-Endpoint Automation Control

Status: PASS

Date: 2026-06-20

Reviewed scope:

- `packages/shared/src/types.ts`
- `packages/shared/src/schemas.ts`
- `apps/local-server/src/storage/execution-proposal-store.ts`
- `apps/local-server/src/execution/execution-dispatcher.ts`
- `apps/local-server/src/adapters/command-runner.ts`
- `apps/local-server/src/storage/provider-capability.ts`
- `apps/local-server/src/routes/bridge-api.ts`
- `tests/execution-proposal.test.mjs`
- `tests/provider-capability.test.mjs`
- Existing `command-runner` and `goal-orchestrator` tests.

## Findings

None blocking.

## Passed Evidence

- `ExecutionProposal` has explicit draft, awaiting-confirmation, confirmed,
  dispatching, returned, failed, paused, cancelled, and timed-out states.
- Confirmation is bound to proposal id, Plan, step, artifact, content hash,
  binding hash, execution endpoint, permission profile, project, and expiration.
- Confirmation is single-use: replay after confirmation is rejected.
- Edited proposals create a new proposal id and cancel the previous proposal,
  invalidating old confirmations.
- Dispatch rechecks current Plan status, binding hash, execution endpoint,
  step endpoint, provider capability, and current proposal status.
- Uncertain command outcomes such as timeout pause the proposal and do not retry.
- WorkBuddy remains non-executing and is rejected before any runner call.
- The HTTP route chain creates an awaiting-confirmation proposal, confirms it
  with content-bound fields, dispatches once through the locked binding, and
  rejects replay.
- Provider invocation uses the existing allowlisted command runner with fixed
  command/argv validation and `shell:false` below the runner boundary.

## Boundary Notes

The EX-C boundary scan command reports the pre-existing
`apps/local-server/src/adapters/CodexManagedPtyAdapter.ts` `child_process` /
`spawn` usage. REVIEW-C did not treat this as EX-C dispatch authority because
the new execution proposal path does not import or call that adapter. The new
dispatch path is:

`/bridge/execution-proposals/dispatch` ->
`dispatchExecutionProposal(...)` -> `runAllowlistedCommand(...)` ->
`runContainedProcess(...)`.

No generic executable, arbitrary argv route, shell mode, dangerous flag,
automatic retry, fallback dispatch, WorkBuddy adapter, Git, deploy, or PR action
was added by EX-C.

## Verification

```bash
npm run typecheck
```

Result: PASS.

```bash
node --experimental-strip-types --test tests/*execution-proposal*.test.mjs tests/*command-runner*.test.mjs tests/goal-orchestrator.test.mjs tests/*provider-capability*.test.mjs
```

Result: PASS, 54/54.

```bash
npm test
```

Result: PASS, 974/974. The first sandboxed run failed only because local
listener tests hit `listen EPERM: operation not permitted 127.0.0.1`; rerunning
with approved local-listen permissions passed.

```bash
rg -n "shell: *true|--dangerously|--yolo|--full-auto|child_process|exec\(|execSync\(|spawn\(" apps/local-server/src/execution apps/local-server/src/adapters
```

Result: REVIEWED. Matches are limited to pre-existing
`apps/local-server/src/adapters/CodexManagedPtyAdapter.ts`; no match appears in
`apps/local-server/src/execution`.

```bash
git diff --check
```

Result: PASS.

## Decision

REVIEW-C passes. The RP may advance to `READY-FOR-EX-D`.
