# REVIEW-B: Dual-Endpoint Automation Control

Status: PASS

Date: 2026-06-20

Reviewed scope:

- `packages/shared/src/types.ts`
- `packages/shared/src/schemas.ts`
- `apps/local-server/src/reasoning/reasoning-artifact.ts`
- `apps/local-server/src/reasoning/reasoning-artifact-store.ts`
- `apps/local-server/src/routes/bridge-api.ts`
- `apps/local-server/src/storage/goal-store.ts`
- `tests/reasoning-artifact.test.mjs`
- Existing `model-api`, `goal-orchestrator`, and `inbound-routing` tests.

## Findings

None blocking.

## Resolved Review-A/B Follow-up Items

1. Existing reasoning routes now produce bounded reasoning artifacts.

   `/bridge/goals/plan` with a locked `planId` records a `plan-draft`
   artifact from model-api output. `/bridge/reviews/run` with a locked `planId`
   records `review-result` artifacts through the existing command review
   dispatch surface. `/bridge/extract-return` records a ChatGPT return artifact
   only after relay and `operationId` correlation pass.

2. Failure paths pause the Plan and do not create follow-up artifacts.

   Correlation failures route through `recordReasoningArtifactOrPause(...)`,
   set Goal/Plan state to `paused`, and leave `reasoningArtifactStore` empty.
   Review run failures with a locked plan also pause the bound Plan.

3. Provider parity is covered through existing entry points.

   Focused tests cover model-api plan artifacts, ChatGPT Web return artifacts,
   Claude command review artifacts, Codex command review artifacts, forbidden
   authority fields, endpoint/plan correlation failures, oversize content, and
   operation mismatch with no artifact record.

## Passed Evidence

- `ReasoningArtifact` schema validates artifact identity, goal/plan, endpoint,
  binding hash, content hash, kind, summary, and timestamp.
- Normalization requires a locked binding, matching plan identity, matching
  reasoning endpoint, valid artifact kind, bounded content size, and non-empty
  summary.
- Normalization rejects fields that try to select executors, permissions,
  working directory, approval, executable, command, or argv.
- ChatGPT return artifact creation is deferred until inbound relay correlation
  succeeds; wrong `operationId` returns 409 and records no artifact.
- Command review artifacts preserve endpoint identity for both
  `claude-code-command` and `codex-command`.
- No execution proposal dispatch, provider fallback, DOM selector/send logic,
  extension route expansion, or WorkBuddy execution promotion was added by
  EX-B.

## Verification

```bash
npm run typecheck
```

Result: PASS.

```bash
node --experimental-strip-types --test tests/*reasoning-artifact*.test.mjs tests/model-api.test.mjs tests/goal-orchestrator.test.mjs tests/inbound-routing-e2e.test.mjs
```

Result: PASS, 68/68.

```bash
npm test
```

Result: PASS, 966/966.

```bash
npm run build-extension
```

Result: PASS.

```bash
rg -n "canExecute: *true|shell: *true|requestSubmit|KeyboardEvent|\.submit\(" apps/local-server/src/reasoning apps/local-server/src/model apps/extension/src
```

Result: PASS, no matches.

```bash
git diff --check
```

Result: PASS.

## Decision

REVIEW-B passes. The RP may advance to `READY-FOR-EX-C`.
