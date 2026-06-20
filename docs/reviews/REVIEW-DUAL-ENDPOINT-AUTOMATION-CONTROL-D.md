# REVIEW-D: Dual-Endpoint Automation Control

Status: PASS

Date: 2026-06-20

Reviewed scope:

- `apps/local-server/src/routes/console-goals.ts`
- `apps/local-server/src/routes/bridge-api.ts`
- `apps/extension/src/ui/bridge-panel.tsx`
- `apps/extension/src/ui/state.ts`
- `apps/extension/src/content/bridge-client.ts`
- `tests/console-goals-ui.test.mjs`
- `tests/bridge-client.test.mjs`
- `tests/extension-control.test.mjs`

## Findings

None blocking.

## Passed Evidence

- The goal console renders a Start Binding card before execution confirmation
  with reasoning/execution endpoint ids, roles, tiers, project, working
  directory, permission profile, step, round, limits, and deadline.
- The goal console renders a per-proposal confirmation card with prompt preview,
  content hash, and binding hash before confirmation.
- Confirm, edit, pause, resume, cancel, and dispatch actions call server APIs
  and refresh from server state after each action.
- Proposal action controls are disabled while the console refreshes server
  state, preventing stale local action use during refresh.
- The extension mirrors server-owned binding/proposal state and only exposes
  pause, resume, and cancel controls.
- Extension pause/resume/cancel payloads are limited to proposal id and optional
  reason; the extension does not expose execution confirmation, proposal edit,
  endpoint selection, permission mutation, or project-root mutation APIs.
- Rendered console diagnostics avoid secrets, cookies, raw transcripts, and
  pairing-token values.

## Boundary Notes

The extension scan reports existing non-execution confirmation and DOM event
strings:

- `confirmPendingPrompt` and `/bridge/pending-prompts/confirm` are the existing
  pending prompt return path, not execution proposal confirmation.
- `dispatchEvent` matches existing ChatGPT composer DOM event helpers, not
  execution dispatch.
- `executionEndpointId`, `executionPermissionProfile`, and
  `executionWorkingDirectoryRef` appear only in the extension state mirror used
  for display text. No extension payload sends those authority fields.

Execution proposal confirmation and dispatch remain confined to the local
console/server API path:

`/console/goals` -> `/bridge/execution-proposals/confirm` or
`/bridge/execution-proposals/dispatch`.

No new provider adapter, new execution capability, generic shell, automatic
retry/failover, extension-side endpoint selection, or extension-side execution
confirmation was introduced by EX-D.

## Verification

```bash
node --experimental-strip-types --test tests/console-goals-ui.test.mjs tests/*extension*control*.test.mjs tests/bridge-client.test.mjs
```

Result: PASS, 30/30. The first sandboxed run passed 28/30 and failed only on
two local listener tests with `listen EPERM: operation not permitted
127.0.0.1`; rerunning with local-listen permission passed 30/30.

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

Result: PASS, 981/981.

```bash
rg -n "endpointId|permissionProfile|workingDirectory|confirm" apps/extension/src
```

Result: REVIEWED. Matches are display-only mirror fields, existing pending
prompt confirmation, or DOM event helper names; no execution proposal
confirmation/edit/dispatch or authority mutation is exposed by the extension.

```bash
rg -n "child_process|spawn\(|exec\(|/bridge/execution-proposals/(confirm|dispatch)|confirmAutomationControl|editAutomationControl|executionEndpointId:|executionPermissionProfile:|executionWorkingDirectoryRef:" apps/extension/src apps/local-server/src/routes/console-goals.ts apps/local-server/src/routes/bridge-api.ts
```

Result: REVIEWED. Execution proposal confirm/dispatch routes appear only in
the local console/server path; extension matches are display-only types.

```bash
git diff --check
```

Result: PASS.

## Decision

REVIEW-D passes. The RP may advance to `READY-FOR-EX-E`.
