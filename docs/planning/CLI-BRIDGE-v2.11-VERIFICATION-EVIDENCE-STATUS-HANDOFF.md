# CLI Bridge v2.11 — Verification Evidence Status Source — Implementation Handoff

**Status**: IMPLEMENTATION HANDOFF — AUTHORIZED for `EX-2.11-1`
**Date**: 2026-06-13
**Based on**:
- `docs/planning/ADR-0016-project-verification-evidence-status-source.md` (ACCEPTED, with acceptance conditions)
- `apps/local-server/src/project-observability/builders.ts` (`buildHarnessVerification`, `buildDerivedMemory`, `ObservabilityInput`)
- `packages/shared/src/types.ts` (`HarnessVerificationView`, `HarnessVerificationRecord`)
- `apps/local-server/src/routes/bridge-api.ts` (`/verification` observability route)
- `apps/local-server/src/routes/project-console.ts` (status-panel Verification card)
- `docs/contracts/bridge-projects-api.md`
- `tests/bridge-project-observability.test.mjs`, `tests/project-console-behavior.test.mjs`

---

## 0. Purpose

Replace the placeholder console status-panel **Verification** card with a real,
strictly read-only, **note-free** verification-evidence summary derived from
records the bridge already holds. This adds no execution and no new raw-data
surface. The existing `/verification.records[].notes` raw field is left intact
for backward compatibility, but the new summary and the console panel MUST NOT
consume or render it.

Out of scope, do NOT implement: running tests/harness/build, spawn/exec, `git`,
CI, network, GitHub/provider API, raw-notes/content display, pass/fail inference
from free text, stored verification-text display, `sha256`/absolute-path/diff
exposure, and any write/apply-from-preview surface.

---

## 1. Allowed files

Modify only:

- `packages/shared/src/types.ts` — add an additive `VerificationStatusSummary`
  type and an optional `summary?: VerificationStatusSummary` field on
  `HarnessVerificationView`. Do not remove or change `records` / `notes`.
- `apps/local-server/src/project-observability/builders.ts` — add a pure
  `buildVerificationStatusSummary(input)` (or compute the summary inside
  `buildHarnessVerification`) that derives counts/recency only; attach it as the
  additive `summary` field. Must not copy `notes` into the summary.
- `apps/local-server/src/routes/project-console.ts` — bind the right-panel
  Verification card to `verification.summary` (note-free). No new fetch; uses
  the existing `/verification` response already cached.
- `docs/contracts/bridge-projects-api.md` — document the additive `summary`
  field and its note-free guarantee.
- `CHANGELOG.md` — record the `EX-2.11-1` implementation.
- `tests/bridge-project-observability.test.mjs` and
  `tests/project-console-behavior.test.mjs` — add the tests in §4.

Do NOT modify `bridge-api.ts` unless wiring strictly requires it; if the summary
is a field on the view returned by `buildHarnessVerification`, the route needs no
change. If a blocking issue forces a change outside this list, STOP and report;
do not expand scope.

---

## 2. Summary shape (additive, note-free)

Illustrative (implementer finalizes exact fields):

```ts
export interface VerificationStatusSummary {
  evidenceCount: number;        // # artifacts with verificationNotes present
  lastRecordedAt?: number;      // most recent evidence timestamp (recency only)
  doneStepCount?: number;       // from existing plan/step status
  totalStepCount?: number;
  recentAuditCount?: number;    // count from existing audit view, optional
}
```

Rules:

- Every field is a count, timestamp, or discrete stored status — never note
  text, provider output, artifact content, path, hash, or inferred outcome.
- `evidenceCount` counts artifacts whose `verificationNotes` is a non-empty
  trimmed string (same source rule as `buildHarnessVerification`), but only the
  count is emitted, never the note string.
- The builder is a pure function of `ObservabilityInput` (deterministic).
- `summary` is additive; existing `records` (including raw `notes`) is unchanged
  for backward compatibility, but the console panel binds to `summary` only.

---

## 3. Console binding

- The right-panel Verification card reads `store.cache.verification.summary` and
  renders counts/recency as inert text.
- It MUST NOT read `verification.records[].notes` or render any note text.
- Missing/malformed `summary` → inert "unavailable" (fail-closed), no new fetch,
  no run, no network.
- No button/link/command/affordance is added.

---

## 4. Required tests

Mapped to ADR-0016 acceptance conditions:

1. **Builder note-free**: given input artifacts whose `verificationNotes`
   contain raw text (e.g. `"npm test passed"`), the produced `summary` contains
   the correct `evidenceCount`/recency but the serialized `summary` does NOT
   include the raw note text.
2. **Legacy records still carry notes**: assert `records[].notes` is unchanged
   (backward compatible) while `summary` is note-free — proving the two are
   distinct.
3. **No pass/fail inference**: a note like `"npm test passed"` does not produce
   any pass/fail/green/red field in `summary`.
4. **Determinism**: same input → identical `summary`.
5. **Console note-free**: with a `/verification` fixture whose `records[].notes`
   contains raw text, the rendered status panel shows counts/recency and does
   NOT contain the note text.
6. **Fail-closed**: missing/malformed `summary` renders inert "unavailable"
   without triggering a fetch/run/network call.
7. **No execution / no network**: assert no spawn/exec/git/network in the change
   (static/behavioral as appropriate).
8. **Backward compatibility**: existing observability/console/project/
   persistence tests still pass; the view change is additive.

---

## 5. Verification commands

Run and report all:

- `npm run typecheck`
- `npm run lint`
- `node --test tests/bridge-project-observability.test.mjs`
- `node --test tests/project-console-behavior.test.mjs`
- `node --test tests/project-console-ui.test.mjs`
- `npm test`
- `git diff --check`

---

## 6. Boundary checklist (must all hold at closeout)

- [ ] Summary is counts/recency/discrete-status only; no note text.
- [ ] Console panel binds to `summary`, never to `records[].notes`.
- [ ] Existing `records[].notes` unchanged (backward compatible).
- [ ] No test/harness/build run; no spawn/exec.
- [ ] No `git`/CI/GitHub/network/provider API.
- [ ] No pass/fail inference from free text.
- [ ] No `sha256`/absolute path/isolated dir path/diff/raw content.
- [ ] No stored verification-text display.
- [ ] No write/apply/promote/commit/discard/run affordance.
- [ ] Builder is a pure, deterministic function of its inputs.
- [ ] Fail-closed unavailable rendering on missing/malformed summary.

---

## 7. Closeout

- One dedicated `EX-2.11-1` commit carrying only the files in §1.
- Do not commit/push from the EX batch unless the closeout review authorizes it;
  control returns to `REVIEW-2.11-1` first.
- Report changed files, test results, boundary evidence, and any unresolved
  questions. Do not continue into another slice without returning to a
  review/planning batch.

---

## 8. Deferred (separate ADRs required)

Live harness/test execution and pass/fail, `git`/CI/GitHub integration, stored
verification-text display (needs a typed non-free-text field first), raw-notes
display, diff/raw content, and apply-from-preview.
