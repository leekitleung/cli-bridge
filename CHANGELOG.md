# Changelog

All notable changes to CLI Bridge are documented here.

## [Unreleased] — v2.x

## [v2.3] — 2026-06-12 — AgentTeam Sequential Closeout

### Added
- **SlotArtifact recording API**: `POST /bridge/projects/:key/teams/:teamId/artifacts` with redaction guard, slot/project validation, and `artifact_recorded` audit events.
- **Conflict report read-only API**: `GET /bridge/projects/:key/teams/:teamId/conflicts` using `detectFileConflicts()` on stored artifacts; returns `{ clean, conflicts }` without apply/merge behavior.
- **Controlled slot state advance API**: `POST /bridge/projects/:key/teams/:teamId/slots/:slotId/advance` with sequential guard (cannot skip `currentSlotIndex`, cannot have two executing slots, failed/cancelled stops team).
- **Slot lifecycle audit events**: `slot_started`, `slot_done`, `slot_failed`, `slot_gated` event types, written in slot advance paths with `teamId`/`slotId`/`planStepId`/`projectId` metadata.
- **Console Team view enhancement**: Artifact summaries and conflict status displayed per team; no execute/dispatch/apply buttons added.
- **Artifact summaries inline in GET /teams**: Team listing response now includes `artifactCount`, `artifactSummaries`, `conflictStatus`, and `conflictCount` per team.

### Changed
- **Path matcher refactored**: `matchProjectTeamPath` now handles `artifacts`, `conflicts`, and `slots-advance` sub-routes alongside `approve`/`cancel`.

### Fixed
- `recordArtifact()` and `hydrateArtifact()` both now align with `validateSlotArtifact` plus `outputRedacted` guard.
- `detectFileConflicts()` optimized to sort-first O(n log n) from O(n^2) prefix scan.
- `currentSlotIndex` sentinel semantics documented; `cancel()` lifecycle documents orchestrator cleanup responsibility.

### Tests
- 15 new API-level tests covering artifact recording (happy path, redaction rejection, unknown slot, cross-project, audit), conflict report (clean, same-file conflict, cross-project), and slot advance (sequential order, skip rejection, double executing, failed-stops-team, pending-rejection, cross-project, audit events).
- Console UI tests continue to pass with no new shell/exec/run paths; allowlist unchanged.

### Safety
- No new shell/exec/run/command endpoints.
- No auto-apply, auto-commit, auto-push, auto-merge.
- No parallel slots, worktree, branch, shared workspace.
- No WorkBuddy executor, Model API, scheduler, daemon.
- Console remains read-only with no execute/dispatch/apply/merge buttons.
- Verdict: 494/494 tests pass; typecheck pass; lint pass.

## [v2.3] — 2026-06-11 — AgentTeam Hardening

### Added
- **Typed lifecycle audit metadata**: `team_created`, `team_approved`, `team_cancelled` audit event types, aligned with `teamMatch.sub` on approve/cancel endpoints.
- **Provider capability validation**: `provider-capability.ts` enforces each provider's supported isolation/mode/execution at TeamSpec create time; explicitly rejects WorkBuddy as executor.
- **SlotArtifact redaction guard**: `recordArtifact()` now rejects artifacts with `rawProviderOutput` and `outputRedacted: false`, aligned with `validateSlotArtifact()`.
- **Hydrate validation parity**: `hydrateArtifact()` now reuses `validateSlotArtifact()` plus `outputRedacted` redaction check, matching the write-time guard.

### Changed
- **Conflict detection optimization**: `detectFileConflicts()` now uses sort-first O(n log n) approach, avoiding O(n²) prefix scan in the inner loop.

### Fixed
- Approve/cancel endpoints now correctly write `team_approved` / `team_cancelled` audit events (previously all wrote `team_created`).
- Cross-project isolation: approve/cancel endpoints return 404 when team's projectId doesn't match the URL project key.
- Goal project isolation: team create rejects goals from a different project with a clear error message.
- Duplicate team ID now returns 409 across projects without overwriting existing teams.

### Documented
- `currentSlotIndex` sentinel semantics (stays at last index after completion; use `team.status === 'done'` for completion detection).
- `cancel()` lifecycle: orchestrator cleanup responsibility when cancelling an executing team.

## [v2.0] — feat/v2.0-goal-data-model

### Added

- **Project Workspace Console** (`GET /console/project`) — a project-centric
  cockpit that consolidates goals, plans, reviews, prompts, audit, and status
  into a single three-region interface (left navigation, center workspace, right
  status panel).
  - Three-region CSS Grid layout with responsive degradation (<1100px, <760px).
  - Project-scoped activity timeline derived from goals/steps/reviews/prompts.
  - Current Goal card with full gated workflow (create/plan/approve/step/gate/cancel).
  - Project Status panel: step progress, active goal, goals summary, blocked-gate
    indicator.
  - Section views: Reviews (with inline create→confirm→dispatch), Prompts, Audit, Memory.
  - Command bar with intent routing: new goal / continue / generate plan.
  - Accessibility: `aria-live` status regions, visible focus rings, keyboard-operable
    section nav with `role="tab"`.
  - Pairing token stays in memory only; active project key in `localStorage`.
  - Existing `/console` and `/console/goals` retained during transition.

- **Project metadata editing** (`PATCH /bridge/projects/:key`):
  - Inline edit in console top-bar (click project label).
  - Accepts `{ label, description }` only; rejects `key`, `createdAt`, `archivedAt`.
  - Idempotent repeated PATCH with same body.

- **Project archive / unarchive**:
  - `POST /bridge/projects/:key/archive` — soft-archived projects are hidden
    from default listing and block new goal/review/prompt creation (409).
  - `POST /bridge/projects/:key/unarchive` — restore to active.
  - Default project (`cli-bridge`) cannot be archived (409/UI guard).
  - `GET /bridge/projects?includeArchived=true` shows archived projects.
  - Console left-nav: archive/unarchive buttons + show-archived toggle.

- **AuditEvent.projectId propagation**:
  - All project-scoped audit call sites (PendingPrompt, PendingReview,
    goal-plan generator, command review runner) now carry `projectId`.
  - `/bridge/projects/:key` audit filtering: authoritative `projectId` match;
    legacy events without `projectId` fall back to packetId match.

- **Snapshot persistence closeout**:
  - Project metadata (label, description, archivedAt) survives restart.
  - `AuditEvent.projectId` survives restart.
  - Legacy audit events without `projectId` hydrate and remain queryable
    via packetId fallback.

### Changed

- **Task 15** — Project Workspace Console data layer migrated to read-only
  `/bridge/projects` aggregation endpoints (replaces individual GET calls to
  `/bridge/goals`, `/bridge/reviews`, `/bridge/pending-prompts`). Status panel
  now uses server-computed `ProjectDerivedStatus`; project list renders real
  multi-project navigation. All POST action endpoints unchanged.

### Unchanged

- All existing `/bridge/*` endpoint contracts, security model, gate enforcement,
  and thin-client guarantees are preserved.
- Existing console routes (`/console`, `/console/goals`) continue to work.
- No new shell/exec/spawn/daemon/auto-run paths.
- Full test suite passes (383/383).
