# CLI Bridge v2.13 — Local Live Verification Execution — Implementation Handoff

**Status**: IMPLEMENTATION HANDOFF — AUTHORIZED for `EX-2.13-1`
**Date**: 2026-06-13
**Based on**:
- `docs/planning/ADR-0018-local-live-verification-execution.md` (ACCEPTED)
- `docs/planning/ADR-0017-typed-verification-result-model.md`
- `docs/reviews/CLI-BRIDGE-v2.13-REVIEW-ADR-0018-b-local-live-verification-acceptance.md`
- `packages/shared/src/types.ts` (`Project`, `VerificationEvidence`,
  `VerificationResult`)
- `packages/shared/src/schemas.ts` (`validateSlotArtifact`,
  typed verification evidence validation)
- `apps/local-server/src/routes/bridge-api.ts` (`createBridgeRuntime`,
  `BridgeRuntimeOptions`, project PATCH, `/verification`)
- `apps/local-server/src/storage/project-store.ts`
  (`CreateProjectInput`, `InMemoryProjectStore`)
- `apps/local-server/src/storage/workspace-apply-store.ts`
  (`normalizeProjectWorkspaceRoots` only; do not reuse baseline fallback for
  execution)
- `apps/local-server/src/project-observability/builders.ts`
  (`buildVerificationStatusSummary`, `buildHarnessVerification`)
- `apps/local-server/src/routes/project-console.ts`
- `apps/local-server/src/storage/json-snapshot-store.ts`
- `docs/contracts/bridge-projects-api.md`
- relevant tests under `tests/`

---

## 0. Purpose

Implement ADR-0018 only: add a bounded, operator-configured, human-gated local
verification capability that runs a preconfigured profile and maps its exit
status to ADR-0017 typed verification evidence.

This is the first v2.x slice that authorizes product-side local process spawn,
so the boundary is intentionally narrow:

- the operator config defines profiles;
- the project stores only a `verifyProfileId` reference;
- the console can only display the gate and trigger the selected profile;
- no project, HTTP body, console input, model output, or artifact can define a
  command, argv, cwd, or env;
- the run cwd comes only from `projectWorkspaceRoots[projectKey]`;
- missing project-specific root returns 409/unavailable and does not spawn;
- raw output is capped transiently and discarded.

ADR-0019 (`git`/CI/GitHub/provider integration) remains out of scope.

---

## 1. Allowed Files

Modify only:

- `packages/shared/src/types.ts`
  - Add `VerifyProfile`, risk-label types, project `verifyProfileId?`, and a
    minimal `VerificationRunRecord`/DTO shape if needed.
  - Extend typed verification evidence only with sanitized fields authorized by
    ADR-0018: `commandLabel`, timing, `truncated`, `outputDiscarded`.
  - Do not add stdout/stderr, argv, command line, env, cwd/path, provider
    payload, `sha256`, raw notes, or diff fields.
- `packages/shared/src/schemas.ts`
  - Validate `verifyProfileId` and any new profile/result DTOs.
  - Reject project/console-supplied `command`, `argv`, `cwd`, `env`, `stdout`,
    `stderr`, `output`, `path`, `sha256`, and extra raw fields.
- `apps/local-server/src/storage/project-store.ts`
  - Persist additive `verifyProfileId?` on projects; default off.
  - Allow removal with `null` through the route layer.
  - Do not persist any root, argv, cwd, env, or profile definition in the project
    record.
- `apps/local-server/src/verification/profile-runner.ts` (new)
  - Contained runner for operator profiles: `shell: false`, structured argv,
    cwd containment, env allowlist, timeout/kill, output cap + discard,
    exit-status mapping, and single-run locking.
  - Include test injection for the spawn function so tests never need to run a
    real external command.
- `apps/local-server/src/storage/verification-run-store.ts` (new)
  - Minimal project-scoped store for sanitized run records only.
  - No raw output, env, argv, command line, absolute cwd, path, or root.
- `apps/local-server/src/project-observability/builders.ts`
  - Fold sanitized live verification records into the existing `/verification`
    typed summary/view.
  - Keep builders deterministic and note/raw-output-free.
- `apps/local-server/src/storage/json-snapshot-store.ts`
  - Persist sanitized verification run records if the runtime has `dataDir`.
  - Do not persist operator profiles, `projectWorkspaceRoots`, absolute cwd, raw
    output, argv, env, or root values.
- `apps/local-server/src/routes/bridge-api.ts`
  - Add `BridgeRuntimeOptions.verifyProfiles` and a test-injectable runner.
  - Add project PATCH support for `verifyProfileId` only; reject/ignore any
    command-like fields.
  - Add the profile-gated verification trigger route specified in §3.
  - Add redacted audit events.
- `apps/local-server/src/routes/project-console.ts`
  - Add the human gate and inert result display for live verification.
  - No free-form text/command input; no raw-output panel.
- `docs/contracts/bridge-projects-api.md`
  - Document the opt-in, trigger route, response shape, fail-closed cases, and
    hard boundaries.
- `CHANGELOG.md`
  - Record `EX-2.13-1`.
- Tests:
  - `tests/verification-profile-runner.test.mjs` (new)
  - `tests/bridge-projects-api.test.mjs`
  - `tests/bridge-project-observability.test.mjs`
  - `tests/project-console-behavior.test.mjs`
  - `tests/project-console-ui.test.mjs` only if source assertions need updating
  - `tests/json-persistence.test.mjs`

If any required change falls outside this list, STOP and report. Do not expand
scope.

---

## 2. Required Runtime Model

Add an operator-only profile configuration surface to `createBridgeRuntime()`:

```ts
createBridgeRuntime({
  projectWorkspaceRoots: { alpha: 'H:/trusted/alpha' },
  verifyProfiles: [
    {
      id: 'unit-tests',
      label: 'Unit tests',
      argv: ['npm.cmd', 'test'],
      cwdPolicy: { kind: 'project-root' },
      env: ['PATH', 'SystemRoot'],
      timeoutMs: 120000,
      outputCapBytes: 65536,
      networkRisk: 'unknown',
      mutationRisk: 'read-only',
    },
  ],
});
```

Exact property names may follow local style, but the semantics are fixed:

- `id`: sanitized profile id, referenced by `Project.verifyProfileId`.
- `label`: sanitized command label; the only command-identifying text returned,
  stored, audited, or rendered.
- `argv: string[]`: structured argv; executed with `shell: false`; not
  interpolated from project/API/console input.
- `cwdPolicy`: resolves to project root or a relative subdirectory inside it.
  Traversal/escape fails closed.
- `env`: allowlist of variable names to pass through; no blanket environment
  inheritance.
- `timeoutMs`: bounded by a hard server cap.
- `outputCapBytes`: caps transient capture; stdout/stderr are discarded.
- `networkRisk`: `'unknown' | 'declared-offline' | 'may-network'`; label only.
- `mutationRisk`: `'read-only' | 'may-mutate'`; label only.

Operator profiles are runtime configuration. They are not stored in project
records or JSON snapshots and are not editable through bridge endpoints.

---

## 3. Required HTTP Shape

Keep existing `GET /bridge/projects/:key/verification` compatible. It may add
sanitized live-verification fields, but must continue to return the ADR-0016 /
ADR-0017 summary and records without raw notes/output.

Add only these v2.13 surfaces:

1. `PATCH /bridge/projects/:key`
   - Allow additive `verifyProfileId`.
   - `verifyProfileId: string` must reference an operator-configured profile.
   - `verifyProfileId: null` removes opt-in.
   - Keep `label`, `description`, and `workspaceApplyEnabled` behavior intact.
   - Reject disallowed command-like fields: `verifyCommand`, `command`, `argv`,
     `cwd`, `env`, `shell`, `stdout`, `stderr`, `output`, `baselineRoot`,
     `workspaceRoot`, `projectWorkspaceRoots`.

2. `GET /bridge/projects/:key/verification/profiles`
   - Returns sanitized profile metadata only: `id`, `label`, `networkRisk`,
     `mutationRisk`, selected/available state.
   - Never returns argv, cwd, env, absolute roots, timeout internals, or output
     caps unless expressed as non-sensitive policy labels.

3. `POST /bridge/projects/:key/verification/confirm`
   - Body is either empty or `{ "confirm": true }`; no command/profile override.
   - Uses `Project.verifyProfileId` as the selected profile.
   - Requires existing project, not archived, configured profile, configured
     `projectWorkspaceRoots[projectKey]`, and available per-project lock.
   - Missing/disabled profile, missing project-specific root, denied/missing
     confirm, lock contention, or invalid cwd returns 4xx and spawns nothing.
   - On attempted execution, maps result to ADR-0017 typed evidence and stores a
     sanitized project verification record.
   - Response returns typed result + sanitized label/timing/flags only.

Do not add generic `/exec`, `/shell`, `/run`, or `/command` endpoints. Do not add
`git`, CI, GitHub, provider, or credential endpoints.

---

## 4. Required Runner Semantics

The runner must:

- resolve cwd only from `projectWorkspaceRoots[projectKey]`; it MUST NOT use
  `baselineRoot` or `resolveBaselineRootForProject()` fallback;
- reject missing project-specific root before spawn;
- resolve `cwdPolicy` with `path.resolve()` and containment checks so the final
  cwd stays inside the project root;
- use `child_process.spawn(file, args, { shell: false, cwd, env })`;
- construct `env` from the profile allowlist only;
- never pass user/project/API/console strings into argv/cwd/env except the
  project key used to look up the root and the profile id reference;
- enforce one in-flight run per project;
- enforce timeout and kill; timeout maps to `errored`;
- capture stdout/stderr transiently only up to `outputCapBytes`, set
  `truncated` if exceeded, then discard;
- map exit status:
  - exit code 0 -> `passed`
  - finite non-zero exit code -> `failed`
  - spawn error, timeout/kill, or signal -> `errored`
  - no profile/not run -> `unknown`
- return/store only typed result, profile id/label, timing, `truncated`, and
  `outputDiscarded`.

The runner tests should use injected fake spawn behavior for pass/fail/error/
timeout/truncation/lock cases.

---

## 5. Console Requirements

The project console may:

- display selected profile label plus `networkRisk` and `mutationRisk`;
- show a confirm/cancel gate before POSTing to `/verification/confirm`;
- show typed result/timing/flags after completion;
- refresh the existing verification summary after completion.

The console must not:

- render raw stdout/stderr or raw notes;
- expose command, argv, cwd, env, absolute paths, roots, or output content;
- include a free-form text input for command/profile/cwd/env;
- add apply/commit/push/merge/promote/discard controls;
- trigger verification automatically on load, tab switch, plan advance, or model
  output.

---

## 6. Required Tests

Add focused coverage mapped to ADR-0018 acceptance conditions:

1. **Profile-only authority**: project PATCH can store/remove `verifyProfileId`;
   command-like fields are rejected/ignored and never stored.
2. **Profile metadata redaction**: `GET /verification/profiles` returns label and
   risk labels only; no argv/cwd/env/root/output cap/absolute path.
3. **Human-gated trigger**: no confirm -> 4xx/no runner; confirm -> runner
   invoked only for the referenced profile.
4. **No shell / structured argv**: runner uses `shell: false` and never builds a
   shell string.
5. **Run root no fallback**: with `baselineRoot` but no
   `projectWorkspaceRoots[projectKey]`, trigger returns 409/unavailable and the
   fake runner is not invoked.
6. **Project root isolation**: project A and B use their own configured roots;
   project B's profile cannot run in project A's root.
7. **cwd containment**: valid relative subdir allowed; traversal/absolute escape
   rejected before spawn.
8. **Env allowlist**: only named env vars are passed; no blanket host env.
9. **Typed mapping**: exit 0/non-zero/spawn error/timeout map to
   passed/failed/errored.
10. **Timeout/kill + lock**: timeout kills/maps errored; concurrent trigger for
    same project rejects fail-closed.
11. **No raw output**: stdout/stderr are capped/discarded; response, store,
    snapshot, audit, and console contain no raw output.
12. **Audit redaction**: audit has project/profile label/typed result/timing only;
    no absolute cwd/root/argv/env/stdout/stderr.
13. **Console gate**: risk labels displayed; confirm/cancel only; no input,
    links, raw output, or write controls; no auto-trigger.
14. **No bridge network/git/provider**: source checks prove the new v2.13 code
    adds no `git`, CI, GitHub/provider client, credentials, `fetch`/HTTP client,
    or network call. Do not assert OS-level no-network for the child.
15. **Backward compatibility**: with no `verifyProfileId`, existing
    `/verification` behavior and full test suite remain green.
16. **Persistence**: sanitized run records and project `verifyProfileId` persist
    if `dataDir` is configured; operator profiles and roots do not.

---

## 7. Verification Commands

Run and report all:

- `npm run typecheck`
- `npm run lint`
- `node --test tests/verification-profile-runner.test.mjs`
- `node --test tests/bridge-projects-api.test.mjs`
- `node --test tests/bridge-project-observability.test.mjs`
- `node --test tests/project-console-behavior.test.mjs`
- `node --test tests/project-console-ui.test.mjs`
- `node --test tests/json-persistence.test.mjs`
- `npm test`
- `git diff --check`

If PowerShell blocks `npm.ps1`, use `npm.cmd` for the same scripts and report
that substitution.

---

## 8. Boundary Checklist

- [ ] ADR-0018 only; ADR-0019 remains unimplemented.
- [ ] Operator profiles only; no project/API/console-defined command/argv/cwd/env.
- [ ] No generic shell/exec/run/command endpoint.
- [ ] `shell: false` structured argv.
- [ ] cwd from `projectWorkspaceRoots[projectKey]` only; no `baselineRoot`
      fallback.
- [ ] Missing project-specific root -> 409/unavailable and no spawn.
- [ ] cwd traversal/escape rejected.
- [ ] Env allowlist only; no blanket inheritance.
- [ ] Timeout/kill, output cap/discard, and per-project lock implemented.
- [ ] No raw stdout/stderr/output/env/argv/cwd/root/path/hash/diff in response,
      store, snapshot, audit, or console.
- [ ] Console has human gate with risk labels; no input and no auto-trigger.
- [ ] No bridge-initiated network, `git`, CI, GitHub/provider, or credentials.
- [ ] No apply/commit/push/merge/promote/discard/write controls.
- [ ] Existing typed verification summary remains backward compatible.

---

## 9. Closeout

`EX-2.13-1` is owned by the execution agent. The execution agent should prepare
one implementation diff, run §7 verification, and report changed files, tests,
boundary evidence, and unresolved questions.

Do not commit or push from the EX batch unless `REVIEW-2.13-1` authorizes the
closeout commit. Do not continue into ADR-0019 or any other slice.

---

## 10. Deferred

ADR-0019 Git/CI/GitHub/provider integration, credentials, CI polling, provider
status reads, hard OS/container network isolation, root editing UI, root
persistence, workspace apply/commit/push/merge, apply-from-preview, raw output
display, raw notes display, diff/raw content, and scheduler/model-triggered
runs remain deferred.

---

## 11. REVIEW-2.13-1 Prompt

Use this prompt for the senior review agent after `EX-2.13-1` returns an
uncommitted implementation diff:

```text
You are REVIEW-2.13-1 for CLI Bridge v2.13 Local Live Verification Execution.

Review the uncommitted EX-2.13-1 diff against:
- docs/planning/ADR-0018-local-live-verification-execution.md
- docs/planning/CLI-BRIDGE-v2.13-LOCAL-LIVE-VERIFICATION-HANDOFF.md
- docs/reviews/CLI-BRIDGE-v2.13-REVIEW-ADR-0018-b-local-live-verification-acceptance.md
- ADR-0017 typed verification evidence boundaries
- ADR-0007 §2 prerequisites

Start by confirming:
1. baseline commit and whether EX committed/pushed (it should not);
2. changed files are exactly within the handoff allowed range;
3. no unrelated runtime, docs, or formatting churn is batched in.

Then review the actual code paths:
1. verify-profile config is operator/server-only and never editable through
   project body, console input, model output, artifact data, or snapshot;
2. project stores only `verifyProfileId`, default off and removable;
3. trigger route uses the project's configured profile only and accepts no
   command/profile override;
4. runner uses `shell:false` structured argv, env allowlist, timeout/kill,
   output cap/discard, and per-project single-run lock;
5. cwd derives only from `projectWorkspaceRoots[projectKey]`; missing root
   returns 409/unavailable with no spawn; no `baselineRoot` fallback; traversal
   and cross-project root escapes are rejected;
6. exit-status mapping is exactly: 0 passed, non-zero failed, spawn
   error/timeout/signal errored, no profile/not-run unknown;
7. response/store/snapshot/audit/console expose only typed result,
   sanitized profile label/id, timing, and flags; no raw stdout/stderr/output,
   argv, env, cwd, root, path, sha256, diff, raw notes, provider payload, or
   absolute path;
8. console gate displays label + `networkRisk` + `mutationRisk`, has
   confirm/cancel only, no free-form input, and no auto-trigger;
9. no `git`, CI, GitHub/provider client, credentials, bridge-initiated network,
   scheduler/daemon/queue/model trigger, apply/commit/push/merge, or
   apply-from-preview is introduced;
10. ADR-0019 remains unimplemented.

Run and report:
- npm run typecheck
- npm run lint
- node --test tests/verification-profile-runner.test.mjs
- node --test tests/bridge-projects-api.test.mjs
- node --test tests/bridge-project-observability.test.mjs
- node --test tests/project-console-behavior.test.mjs
- node --test tests/project-console-ui.test.mjs
- node --test tests/json-persistence.test.mjs
- npm test
- git diff --check

Return one of:
- PASS — closeout authorized, with commit message recommendation;
- CHANGES REQUIRED — list bounded follow-up findings only;
- BLOCKED — explain the boundary or design problem that prevents review.

Findings must lead the report, ordered by severity with file/line evidence.
If PASS, confirm whether the dedicated EX closeout commit may be created and
whether a separate REVIEW record commit is needed.
```
