# REVIEW-D UI Follow-up: Dual-Endpoint Automation Control

Status: PASS

Date: 2026-06-21

Reviewed commit: `83194bd`

Reviewed scope:

- `apps/local-server/src/routes/project-console.ts`
- `apps/local-server/src/routes/console.ts`
- `apps/local-server/src/routes/console-goals.ts`
- `apps/local-server/src/server.ts`
- `apps/local-server/src/routes/bridge-api.ts`
- `apps/local-server/src/storage/execution-proposal-store.ts`
- `apps/extension/src/content/bridge-client.ts`
- `apps/extension/src/ui/bridge-panel.tsx`
- Project console, bridge-client, and extension-control tests

## Findings

No blocking findings remain after `EX-D-UI-FOLLOWUP-FIX`.

## Passed Evidence

- `/goals`, `/reviews`, and `/project` are native Project Workspace contexts.
- `/console` and `/console/goals` redirect to `/console/project`; compatibility
  renderers return the same Project shell.
- Execution confirmation, edit, and dispatch remain local-server APIs. The
  extension exposes only status plus pause/resume/cancel calls.
- Project confirmation sends all server-checked authority fields, including
  plan, step, artifact, content hash, binding hash, endpoint, permission
  profile, and project id.
- Rendered binding/proposal values are escaped and pairing tokens remain
  memory-only.
- The server now exposes `currentProposal` and `currentBinding` so Project and
  extension UI do not infer authority from historical array order.
- Current proposal selection ignores terminal history and chooses the newest
  actionable proposal for the queried plan.
- Project and extension consume the server-correlated current binding/proposal
  pair instead of independently selecting `bindings[0]` and `proposals[0]`.
- Server-side pause/cancel transitions reject terminal or dispatching lifecycle
  rewrites instead of relying on UI button disabling.

## Verification

```bash
node --experimental-strip-types --test tests/console-unified-ui.test.mjs tests/project-console-ui.test.mjs tests/project-console-behavior.test.mjs tests/console-ui.test.mjs tests/console-goals-ui.test.mjs tests/extension-control.test.mjs tests/bridge-client.test.mjs
```

Result before the fix: PASS, 113/113, but the suite did not cover replacement
selection, cross-plan correlation, or terminal control rejection.

```bash
node --experimental-strip-types --test tests/execution-proposal.test.mjs tests/project-console-behavior.test.mjs tests/extension-control.test.mjs
```

RED result before implementation: FAIL, 5 failing tests. Failures covered
missing `getCurrent`, terminal transition acceptance, Project selecting stale
proposal/binding, and extension not consuming server-owned current fields.

GREEN result after implementation: PASS, 69/69.

```bash
node --experimental-strip-types --test tests/execution-proposal.test.mjs tests/bridge-client.test.mjs tests/extension-control.test.mjs tests/console-unified-ui.test.mjs tests/project-console-ui.test.mjs tests/project-console-behavior.test.mjs tests/console-ui.test.mjs tests/console-goals-ui.test.mjs
```

Result: PASS, 122/122.

```bash
npm run typecheck
```

Result: PASS.

```bash
npm run build-extension
```

Result: PASS.

```bash
npm test
```

Result: PASS, 996/996.

```bash
git diff --check
```

Result before this review artifact: PASS.

Result after the fix and this review update: PASS.

## Decision

REVIEW-D-UI-FOLLOWUP passes. The UI follow-up no longer blocks the RP from the
real-evidence batch. The next permitted batch is `EX-E-REAL-EVIDENCE`; do not
mark the final review PASS until the required real-chain evidence exists.
