# CLI Bridge v2.4a-5 — Observability Verification Handoff

**Status**: APPROVED — ready for `EX-2.4a-5`
**Date**: 2026-06-12
**Track**: Track A — Observability Completion
**Based on**:
- `CLI-BRIDGE-POST-v2.3-PLANNING-HANDOFF.md`
- `CLI-BRIDGE-v2.3-CLOSEOUT-REVIEW.md`
- `CLI-BRIDGE-v2.4a-CLOSEOUT-REVIEW.md`
- `docs/contracts/bridge-projects-api.md`

---

## 0. Purpose

This handoff defines a small read-only observability completion slice for the
existing project verification endpoint:

```text
GET /bridge/projects/:key/verification
```

The endpoint currently returns placeholder `unavailable` records derived from
completed plan steps. v2.3 already records `SlotArtifact.verificationNotes`
for AgentTeam slots. This slice projects those existing artifact notes into the
verification view without running commands, invoking models, mutating state, or
adding execution authority.

---

## 1. Scope

### 1.1 What this slice implements

| Capability | Detail |
|-----------|--------|
| Artifact-backed verification records | Include read-only records derived from `SlotArtifact.verificationNotes`. |
| Project isolation | Only artifacts from teams whose `projectId` matches the project key are visible. |
| Existing fallback | Projects without artifact verification notes continue returning `status: "unavailable"`. |
| Contract update | Document the artifact-backed records in `docs/contracts/bridge-projects-api.md`. |
| Tests | Cover positive, empty/unavailable, project isolation, and read-only method rejection. |

### 1.2 What this slice must not implement

- No harness runner.
- No shell/exec/run/command endpoint.
- No process spawning.
- No model API calls.
- No new endpoint.
- No mutation in observability builders or GET handlers.
- No workspace-write, auto-apply, auto-commit, auto-push, or auto-merge.
- No v2.4b multi-provider behavior.
- No v2.5+ workspace isolation or merge queue behavior.

---

## 2. Expected Behavior

### 2.1 Source data

Use existing `TeamSpec` and `SlotArtifact` data:

- A `TeamSpec` belongs to a project via `team.projectId`.
- A `SlotArtifact` belongs to a team via `artifact.teamId`.
- A verification note exists when `artifact.verificationNotes` is a non-empty
  string after trimming.

### 2.2 Record mapping

For each matching artifact with notes, add one `HarnessVerificationRecord`:

| Field | Source |
|-------|--------|
| `stepId` | `artifact.planStepId` |
| `stepIndex` | Matching team slot `stepIndex` if available; otherwise omitted. |
| `stepIntent` | Matching project plan step intent if available; otherwise `artifact.summary`. |
| `stepStatus` | Matching team slot status if available; otherwise omitted. |
| `harnessStatus` | `"recorded"` |
| `notes` | `artifact.verificationNotes.trim()` |
| `teamId` | `artifact.teamId` |
| `slotId` | `artifact.slotId` |
| `createdAt` | `artifact.createdAt` |

Records should sort newest first by `createdAt`, with deterministic fallback
ordering by `teamId`, `slotId`, and `stepId`.

### 2.3 View status

- If at least one artifact-backed record exists, return `status: "recorded"`.
- If no artifact-backed record exists, preserve the current behavior:
  `status: "unavailable"` with placeholder records for completed plan steps.

Do not infer pass/fail from free-text notes. The endpoint only reports that
verification evidence was recorded.

---

## 3. Allowed Modification Range

Implementation may modify:

- `packages/shared/src/types.ts`
  - Extend `HarnessVerificationRecord` with optional read-only metadata fields:
    `notes`, `teamId`, `slotId`, `createdAt`.
- `apps/local-server/src/project-observability/builders.ts`
  - Extend `ObservabilityInput` to accept teams/artifacts or add a narrow
    verification-specific input type.
  - Build artifact-backed verification records.
- `apps/local-server/src/routes/bridge-api.ts`
  - Pass project-scoped team/artifact data into the verification builder.
- `docs/contracts/bridge-projects-api.md`
  - Document the artifact-backed verification response.
- `tests/bridge-project-observability.test.mjs`
  - Add or update tests for the behavior in this handoff.

No other files are authorized without review.

---

## 4. Verification Requirements

Run:

```text
npm run typecheck
npm run lint
npm test -- tests/bridge-project-observability.test.mjs
npm test
git diff --check
```

Required test coverage:

- Project with a team artifact containing `verificationNotes` returns
  `status: "recorded"` and at least one record with `teamId`, `slotId`,
  `stepId`, `notes`, and `harnessStatus: "recorded"`.
- Project with no artifact notes continues returning `status: "unavailable"`.
- Artifact notes from another project are not visible.
- `POST /bridge/projects/:key/verification` remains 405.
- No runtime mutation occurs during GET verification calls.

---

## 5. Boundary Evidence For Closeout

The execution report must include:

- changed files;
- verification command results;
- evidence that no endpoint was added;
- evidence that no shell/exec/run/command path was added;
- evidence that no dependency changed;
- evidence that v2.4b/v2.5+ capabilities were not implemented.

---

## 6. Review Decision Needed

Before implementation, a reviewing/planning agent should decide whether this
handoff is approved as the next `EX-*` slice.

Recommended next batch if approved:

```text
EX-2.4a-5: Artifact-backed read-only verification observability
```
