# CLI Bridge v2.12 — Typed Verification Result Model — Implementation Handoff

**Status**: IMPLEMENTATION HANDOFF — AUTHORIZED for `EX-2.12-1`
**Date**: 2026-06-13
**Based on**:
- `docs/planning/ADR-0017-typed-verification-result-model.md` (ACCEPTED)
- `docs/planning/ADR-0016-project-verification-evidence-status-source.md`
- `packages/shared/src/types.ts` (`SlotArtifact`, `HarnessVerificationRecord`,
  `VerificationStatusSummary`, `HarnessVerificationView`)
- `packages/shared/src/schemas.ts` (`validateSlotArtifact`,
  `TEAMSPEC_ALLOWED_FIELDS.artifact`)
- `apps/local-server/src/project-observability/builders.ts`
  (`buildVerificationStatusSummary`, `buildHarnessVerification`)
- `apps/local-server/src/routes/bridge-api.ts` (existing artifact recording path,
  existing `/verification` route)
- `apps/local-server/src/routes/project-console.ts` (status-panel Verification card)
- `docs/contracts/bridge-projects-api.md`
- `tests/bridge-project-observability.test.mjs`,
  `tests/project-console-behavior.test.mjs`,
  `tests/bridge-teams-api.test.mjs`

---

## 0. Purpose

Implement ADR-0017 only: add a strictly additive, typed, non-free-text
verification result model and inert display surface. This gives the bridge a
typed sink for future verification producers without adding any execution,
provider, or raw-output capability.

This slice is data/model/presentation only. It MUST NOT run tests/harness/build
as product behavior, spawn/exec, read or run `git`, call CI/GitHub/provider APIs,
make outbound network requests, infer pass/fail from `verificationNotes`, render
raw notes/output/content, expose paths/hashes/diff, or add any run/apply/write
affordance.

Execution-agent verification commands are allowed only as review checks listed
in §5. They must not become bridge runtime behavior.

---

## 1. Allowed files

Modify only:

- `packages/shared/src/types.ts`
  - Add a closed `VerificationResult` const/type, following the existing
    `SLOT_STATUSES` / `TEAM_STATUSES` `as const` style.
  - Add an additive `VerificationEvidence` type or equivalent typed structure.
  - Add optional typed result/evidence fields to `SlotArtifact`,
    `HarnessVerificationRecord`, `VerificationStatusSummary`, and/or
    `HarnessVerificationView` as needed.
  - Do not remove or rename `verificationNotes`, `notes`, `harnessStatus`, or
    existing `summary` fields.
- `packages/shared/src/schemas.ts`
  - Update artifact validation/allowlists only for the new typed field(s).
  - Reject malformed typed results.
  - Do not add command/output/path/hash fields.
- `apps/local-server/src/project-observability/builders.ts`
  - Derive typed verification fields/counts only from explicit typed input
    fields.
  - Never derive a typed result by parsing `verificationNotes`.
  - Keep `buildVerificationStatusSummary` and `buildHarnessVerification`
    deterministic and note-free in the new summary surface.
- `apps/local-server/src/routes/bridge-api.ts`
  - Wiring-only changes to accept the optional typed artifact field through the
    existing `POST /bridge/projects/:key/teams/:teamId/artifacts` path if needed.
  - No new route. No execution/provider logic. No `git`/CI/network.
- `apps/local-server/src/routes/project-console.ts`
  - Render the typed result/status as inert text in the existing Verification
    card/section.
  - No button/link/command/run/apply affordance.
- `docs/contracts/bridge-projects-api.md`
  - Document the additive typed fields and no-inference/no-raw-output guarantee.
- `CHANGELOG.md`
  - Record `EX-2.12-1`.
- Tests:
  - `tests/bridge-project-observability.test.mjs`
  - `tests/project-console-behavior.test.mjs`
  - `tests/bridge-teams-api.test.mjs`
  - `tests/project-console-ui.test.mjs` only if console source assertions need
    updating.

If any required change falls outside this list, STOP and report. Do not expand
scope.

---

## 2. Required implementation shape

Use a closed typed result set. Recommended values:

```ts
export const VERIFICATION_RESULTS = [
  'passed',
  'failed',
  'skipped',
  'errored',
  'unknown',
] as const;
export type VerificationResult = typeof VERIFICATION_RESULTS[number];
```

The exact name may follow local style, but the result set must be closed and
typed. Do not introduce a free-text outcome field.

Add typed evidence/result fields additively. Acceptable shapes include either:

- `SlotArtifact.verificationResult?: VerificationResult` plus derived record /
  summary counts, or
- `SlotArtifact.verificationEvidence?: VerificationEvidence` where
  `VerificationEvidence` contains only typed/sanitized fields.

If `VerificationEvidence` includes a label, it must be a sanitized label such as
`commandLabel`, not a raw command line. Do not store stdout/stderr, provider
payloads, raw notes, stack traces, absolute paths, isolated paths, `sha256`, or
diff.

The existing free-text fields remain for backward compatibility:

- `SlotArtifact.verificationNotes?: string`
- `HarnessVerificationRecord.notes?: string`
- `HarnessVerificationRecord.harnessStatus: string`

The new typed result is set only when explicitly supplied through the typed
field. A note like `"npm test passed"` MUST NOT produce `result: "passed"`.

---

## 3. Console binding

The console may render typed result/counts as inert text in the existing
Verification card/section. It must:

- read only typed fields / summary fields, never `records[].notes` for the typed
  status;
- render missing/malformed typed result as inert `unknown` or `not yet available`;
- show no raw notes/output/content;
- add no run/apply/promote/write/discard/commit controls.

Existing v2.11 summary behavior must remain intact.

---

## 4. Required tests

Map tests to ADR-0017 acceptance conditions:

1. **Closed result set**: valid typed values are accepted; malformed values are
   rejected/fail closed by schema or builder behavior.
2. **Additive compatibility**: legacy artifacts with only `verificationNotes`
   still work; `records[].notes`, `harnessStatus`, and v2.11 `summary` remain
   compatible.
3. **No inference**: an artifact with `verificationNotes: "npm test passed"` and
   no typed result produces no typed `passed` result.
4. **Explicit typed result**: an artifact with an explicit typed result produces
   typed record/summary/console output.
5. **No raw surface**: typed evidence/summary/console do not include raw notes,
   raw output, artifact content, `sha256`, absolute/isolated paths, or diff.
6. **Inert display**: console typed status is text-only and adds no run/apply/
   write affordance.
7. **Determinism**: builder output for typed fields is deterministic for the same
   input.
8. **No product execution / no provider**: source checks or behavior tests prove
   no spawn/exec, no product test runner, no `git`, no CI/GitHub/provider API,
   and no outbound network was added.

---

## 5. Verification commands

Run and report all:

- `npm run typecheck`
- `npm run lint`
- `node --test tests/bridge-project-observability.test.mjs`
- `node --test tests/project-console-behavior.test.mjs`
- `node --test tests/bridge-teams-api.test.mjs`
- `node --test tests/project-console-ui.test.mjs`
- `npm test`
- `git diff --check`

If PowerShell blocks `npm.ps1`, use `npm.cmd` for the same scripts and report
that substitution.

---

## 6. Boundary checklist

- [ ] ADR-0017 only; ADR-0018 and ADR-0019 remain unimplemented.
- [ ] Typed result set is closed; no free-text outcome field.
- [ ] Typed result is only explicit input; never inferred from
      `verificationNotes`.
- [ ] Existing `verificationNotes`, `records[].notes`, `harnessStatus`, and v2.11
      `summary` stay backward compatible.
- [ ] New typed summary/display is note-free and raw-output-free.
- [ ] No product spawn/exec/test runner; no shell/run endpoint.
- [ ] No `git`, CI, GitHub/provider API, credential handling, or network.
- [ ] No raw output, raw provider payload, artifact content, path, hash, or diff
      in any new surface.
- [ ] No run/apply/promote/write/discard/commit affordance.
- [ ] Builders remain pure/deterministic.
- [ ] Missing/malformed typed result fails closed.

---

## 7. Closeout

`EX-2.12-1` is owned by the execution agent. The execution agent should prepare
the implementation diff, run §5 verification, and report changed files, tests,
boundary evidence, and unresolved questions.

Do not commit/push from the EX batch unless `REVIEW-2.12-1` authorizes the
closeout commit. Do not continue into ADR-0018 or any other slice.

---

## 8. Deferred

ADR-0018 local live verification execution, ADR-0019 Git/CI/GitHub provider
integration, command execution, provider status reads, credential handling, raw
output display, raw notes display, diff/raw content, and apply-from-preview all
remain deferred.
