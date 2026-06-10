# Changelog

All notable changes to CLI Bridge are documented here.

## [Unreleased] — v2.0 (feat/v2.0-goal-data-model)

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
