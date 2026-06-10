# Changelog

All notable changes to CLI Bridge are documented here.

## [Unreleased] — v2.0 (feat/v2.0-goal-data-model)

### Added

- **Project Workspace Console** (`GET /console/project`) — a project-centric
  cockpit that consolidates goals, plans, reviews, prompts, audit, and status
  into a single three-region interface (left navigation, center workspace, right
  status panel). Project is the top-level entity; the conversation timeline is a
  derived activity feed from existing bridge data (Phase A).
  - Three-region CSS Grid layout with responsive degradation (<1100px, <760px).
  - Project-scoped activity timeline derived from goals/steps/reviews/prompts.
  - Current Goal card with full gated workflow (create/plan/approve/step/gate/cancel).
  - Project Status panel: step progress, active goal, goals summary, blocked-gate
    indicator; version/milestone/tests/commits/memory marked "unavailable (Phase B)".
  - Section views: Reviews (with inline create→confirm→dispatch), Prompts, Audit, Memory.
  - Command bar with intent routing: new goal / continue / generate plan.
  - Accessibility: `aria-live` status regions, visible focus rings, keyboard-operable
    section nav with `role="tab"`.
  - Pairing token stays in memory only; active project key in `localStorage`.
  - Existing `/console` and `/console/goals` retained during transition.
- **Spec and review documentation** (`.kiro/specs/project-workspace-console/`):
  requirements, design (with Data Availability table), and implementation tasks.
- **Review record** (`docs/reviews/PROJECT-WORKSPACE-CONSOLE-SPEC-REVIEW.md`).

### Changed

- **Task 15** — Project Workspace Console data layer migrated to read-only
  `/bridge/projects` aggregation endpoints (replaces individual GET calls to
  `/bridge/goals`, `/bridge/reviews`, `/bridge/pending-prompts`). Status panel
  now uses server-computed `ProjectDerivedStatus`; project list renders real
  multi-project navigation. All POST action endpoints unchanged.

### Unchanged

- All existing `/bridge/*` endpoint contracts, security model, gate enforcement,
  and thin-client guarantees are preserved verbatim.
- Existing console routes (`/console`, `/console/goals`) continue to work.
- Full test suite passes (330/330).
