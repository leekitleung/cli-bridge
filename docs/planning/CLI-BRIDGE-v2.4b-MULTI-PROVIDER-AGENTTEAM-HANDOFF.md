# CLI Bridge v2.4b — Multi-provider AgentTeam Implementation Handoff

**Status**: IMPLEMENTATION HANDOFF — authorized by ADR-0006  
**Date**: 2026-06-12  
**Based on**: `ADR-0006-multi-provider-agentteam.md` (ACCEPTED)

---

## 0. Purpose

This handoff defines the minimum implementation slice for v2.4b
Multi-provider AgentTeam. The feature extends the existing v2.3 TeamSpec,
SlotArtifact, audit, and conflict-report surfaces with explicit provider and
session correlation while preserving the v2.3 safety boundary.

The implementation remains sequential, patch-only, non-autonomous, and
read-only for conflict reports.

---

## 1. API Shape Decision

ADR-0006 requires preserving existing TeamSpec routes and adding fields instead
of creating a new product surface.

**Chosen shape**: extend existing project TeamSpec routes:

- `POST /bridge/projects/:key/teams`
- `GET /bridge/projects/:key/teams`
- `POST /bridge/projects/:key/teams/:teamId/artifacts`
- `GET /bridge/projects/:key/teams/:teamId/conflicts`
- `POST /bridge/projects/:key/teams/:teamId/slots/:slotId/advance`

No new endpoint is added.

Request shape additions:

```json
{
  "provider": "claude",
  "endpointId": "claude-code-command",
  "logicalSlots": [
    {
      "id": "s0",
      "role": "planner",
      "stepIndex": 0,
      "tier": "patch-proposal",
      "isolation": "patch-only",
      "providerId": "codex",
      "endpointId": "codex-command"
    }
  ]
}
```

Backward compatibility:

- Existing single-provider TeamSpec payloads remain valid.
- A slot with no `providerId` defaults to team-level `provider`.
- A slot with no `endpointId` defaults to team-level `endpointId`.

---

## 2. Scope

Implemented capability:

- Optional per-slot `providerId` and `endpointId`.
- Static capability parity validation for each slot provider.
- Provider/run correlation fields on SlotArtifact:
  - `providerId`
  - `endpointId`
  - `bridgeRunId`
  - optional `externalSessionId`
- Slot audit metadata stores provider/session correlation in
  `result.failureReason` JSON.
- Conflict reports include provider ids for conflicting artifacts and remain
  read-only.
- Console Teams read-only view may show per-slot provider labels.

Not implemented:

- Bridge-governed parallel slots.
- Provider-native parallel team execution.
- Worktree, branch, or shared-workspace isolation.
- Workspace-write auto-apply.
- Auto-commit, auto-push, auto-merge, PR creation, merge queue.
- Scheduler, queue, daemon, or background dispatch.
- Model arbitration or provider-race winner selection.
- WorkBuddy executor promotion.

---

## 3. Allowed Modification Range

| Area | Files |
|---|---|
| Shared DTOs | `packages/shared/src/types.ts` |
| Shared validation | `packages/shared/src/schemas.ts` |
| Provider capability metadata | `apps/local-server/src/storage/provider-capability.ts` |
| Team store defaults / artifacts | `apps/local-server/src/storage/team-store.ts` |
| Team routes / audit / conflict enrichment | `apps/local-server/src/routes/bridge-api.ts` |
| Console read-only team display | `apps/local-server/src/routes/project-console.ts` |
| Tests | `tests/bridge-teams-api.test.mjs` |
| Changelog | `CHANGELOG.md` |

---

## 4. Forbidden List

- No new endpoint.
- No execution provider dispatch path.
- No parallel slot orchestration; `maxConcurrentBridgeSlots` remains 1.
- No `bridgeGovernedParallelSlots=true`.
- No isolation mode beyond `patch-only`.
- No artifact auto-apply, merge, winner selection, commit, push, PR, or merge
  queue behavior.
- No use of `canExecute=true` to trigger execution.
- No raw provider output persistence unless `outputRedacted=true`.
- No API key or secret persistence.
- No WorkBuddy executor promotion.

---

## 5. Verification Criteria

Required commands:

```text
npm run typecheck
npm run lint
npm test
git diff --check
```

Required tests:

- Existing single-provider TeamSpec payload remains valid.
- Slot provider defaults to team-level provider/endpoint when omitted.
- Per-slot provider binding accepts known providers and rejects unknown
  provider/capability failures.
- Hard invariants remain enforced:
  - `maxConcurrentBridgeSlots=1`;
  - `bridgeGovernedParallelSlots=false`;
  - `isolationModes=['patch-only']`;
  - cross-provider teams cannot run two slots at once.
- Failed slot stops team and later provider slot does not auto-start.
- Partial artifact with raw output is rejected unless redacted and schema-valid.
- Cross-provider conflict report is read-only and includes provider metadata;
  no winner/apply fields are present.
- Slot audit metadata includes `providerId`, `endpointId`, `bridgeRunId`, and
  excludes raw provider output and API keys.

---

## 6. Closeout Checklist

- [x] ADR-0006 Acceptance Condition 1 satisfied by compatibility/default tests.
- [x] ADR-0006 Acceptance Condition 2 satisfied by hard-invariant tests.
- [x] ADR-0006 Acceptance Condition 3 satisfied by fail-closed/conflict tests.
- [x] ADR-0006 Acceptance Condition 4 satisfied by audit correlation tests.
- [x] ADR-0006 Acceptance Condition 5 satisfied: `canExecute=true` remains
      inert and no new execution endpoint exists.
- [x] Full verification commands pass.
