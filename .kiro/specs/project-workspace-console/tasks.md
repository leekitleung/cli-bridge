# Implementation Plan

## Overview

Phase A delivers the full project cockpit UI/UX against a client-side projection over
existing `/bridge/*` endpoints — no backend schema change, thin-client guarantees preserved.
Phase B is an optional follow-on that promotes Project to a backend entity. Tasks are ordered
so each builds on the previous and ends in a runnable, test-verified state.

## Task Dependency Graph

```json
{
  "waves": [
    { "wave": 1, "tasks": [1] },
    { "wave": 2, "tasks": [2] },
    { "wave": 3, "tasks": [3, 4] },
    { "wave": 4, "tasks": [5, 6, 7] },
    { "wave": 5, "tasks": [8, 9] },
    { "wave": 6, "tasks": [10] },
    { "wave": 7, "tasks": [11] },
    { "wave": 8, "tasks": [12] },
    { "wave": 9, "tasks": [13] },
    { "wave": 10, "tasks": [14] },
    { "wave": 11, "tasks": [15] },
    { "wave": 12, "tasks": [16] },
    { "wave": 13, "tasks": [17] }
  ]
}
```

```
1 ─▶ 2 ─▶ 3 ─▶ 4 ─▶ 5 ─▶ 6 ─▶ 7 ─▶ 8 ─▶ 9 ─▶ 10 ─▶ 11 ─▶ 12
                                                        │
                                              (Phase B) ▼
                                          13 ─▶ 14 ─▶ 15 ─▶ 16 ─▶ 17
```

- Tasks 1–2 are foundational (shell + API client); everything depends on them.
- Tasks 3–9 are feature regions and are mostly sequential but share the cache from task 4.
- Task 10 (polish) depends on regions existing (3–9).
- Task 11 (tests) depends on the implemented behavior (1–10).
- Task 12 closes Phase A docs.
- Tasks 13–16 (Phase B) depend on Phase A being complete (12).

## Tasks

## Phase A — Project cockpit (UI-only, projection-based)

- [ ] 1. Scaffold the cockpit route and three-region shell
  - Add `renderProjectConsoleHtml()` in `apps/local-server/src/routes/project-console.ts` and `CONSOLE_PROJECT_PATH = '/console/project'`
  - Wire the route into the server alongside `/console` and `/console/goals` (retain both)
  - Render the static three-region CSS Grid (TopBar, LeftNav, Workspace, StatusPanel, CommandBar) with design tokens as CSS custom properties
  - Add cross-links to the classic consoles
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 9.1_

- [ ] 2. Implement the thin API client and connect flow
  - Add the `api()` fetch wrapper sending `x-cli-bridge-pairing-token` (token kept in memory only)
  - Implement connect using `GET /bridge/metrics` as the auth probe; show connection pill states (connected / auth failed)
  - Block dependent actions until connected
  - _Requirements: 9.3, 9.4, 11.1_

- [ ] 3. Build the project projection and project list
  - Implement `buildProjects(goals, reviews, prompts, metrics)` deriving `ProjectProjection[]` keyed by the default `"cli-bridge"` project
  - Render the LeftNav `ProjectList` with name + status label; selecting sets `store.activeProjectKey` (mirrored to `localStorage`)
  - Implement the empty state with a "create/initialize first project" affordance
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

- [ ] 4. Render the project-scoped activity timeline
  - Load `GET /bridge/goals`, `/bridge/reviews`, `/bridge/pending-prompts`, `/bridge/metrics` on connect/refresh into `store.cache`
  - Render a **derived activity feed** (goals, plan/approval transitions, step results, reviews, prompts) with origin-distinguished entries (operator action vs bridge/system result), in chronological order, scoped to the active project
  - Replace timeline content on project switch (no cross-project leakage)
  - Note: a true conversation log is deferred to Phase B (no backend message store exists)
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

- [ ] 5. Implement the Current Goal card and gated goal workflow
  - Render `CurrentGoalCard` (goal title + status) and `PlanCard` (steps table: index, intent, kind, tier, status, gate button)
  - Wire actions to existing endpoints: create goal, generate plan (review-only), approve plan, run next step (single advance), approve gate, cancel
  - Enforce client-side: no step action shown before plan approval; mutating steps show `blocked-needs-gate`; never auto-advance; surface non-destructive errors
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 9.2, 9.5_

- [ ] 6. Implement the Project Status panel (derivable fields only)
  - Implement `buildStatus()` deriving step progress (done/total of active plan), active goal/plan, goals summary, and blocked-gate indicator from goal/plan/step state
  - Render the StatusPanel sections; render explicit "unavailable"/empty states for version/milestone, slice count, test results, commits-ahead, and memory (no backend source in Phase A — see design "Data Availability")
  - _Requirements: 4.1, 4.2, 4.3, 4.6, 4.7_

- [ ] 7. Implement section views (Reviews, Prompts, Audit, Memory) and SectionNav
  - Add `SectionNav` switching `store.view`; render Reviews (id/target/status), Prompts (id/status/transport, marked "requires confirm — not auto-sent"), Audit (operation history), Memory
  - Keep all section content scoped to the active project; route Conversations/Goals back to the workspace content
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

- [ ] 8. Implement the gated review creation flow
  - Add review creation (target endpoint + content) within the active project
  - Wire create → confirm → dispatch against `/bridge/reviews*`; present any next-prompt as a draft requiring separate confirmation (never auto-executed)
  - Ensure created reviews appear in the project's Reviews view
  - _Requirements: 7.1, 7.2, 7.3, 7.4_

- [ ] 9. Implement the command bar with intent routing
  - Render the bottom CommandBar with an intent-communicating placeholder
  - Route submitted input: new-goal → `POST /bridge/goals`; continue/generate-plan → corresponding gated goal action; never dispatch a CLI or bypass a gate
  - Prompt to select/create a project when none is active
  - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_

- [ ] 10. Apply UX polish, responsiveness, and accessibility
  - Add loading/empty/error states per region; in-place refresh after actions (no full reload)
  - Implement responsive degradation (status panel toggle <1100px, nav drawer <760px)
  - Add semantic landmarks, keyboard operability, focus rings, `aria-live` status region, labels, and text-plus-color status pills; style gated/destructive actions distinctly
  - _Requirements: 2.6, 11.1, 11.2, 11.3, 11.4, 11.5, 11.6_

- [ ] 11. Add Phase A tests
  - `tests/project-console-ui.test.mjs`: assert three regions, project list, section nav, status panel, command bar, classic-console links, and absence of direct-CLI markers
  - Projection unit tests for `buildProjects()` / `buildStatus()` including empty-data and missing-field cases
  - Gate-preservation tests: correct endpoint call order (create→confirm→dispatch; plan→approve→step→gate); never a CLI directly
  - Confirm existing `console-ui` and `console-goals-ui` tests still pass
  - _Requirements: 1.1, 3.4, 5.3, 5.4, 5.5, 9.1, 9.2, 9.5_

- [ ] 12. Update canonical product docs for Phase A
  - Record the new `/console/project` route, project-cockpit IA, and thin-client guarantees in the cli-bridge canonical docs (per the repo governance contract: docs before/with implementation)
  - Update `CHANGELOG.md`
  - _Requirements: 9.1, 10.3_

## Phase B — Backend Project entity (optional follow-on)

- [ ] 13. Introduce the Project data model and store
  - Add `Project` type and optional `projectId?` to `Goal`, `AgentReviewRequest`, `PendingPrompt` in `packages/shared/src/types.ts` (additive, backward-compatible)
  - Add an in-memory `ProjectStore` following existing store patterns; backfill records without `projectId` to the default `"cli-bridge"` project
  - _Requirements: 10.1, 10.2, 10.3_

- [ ] 14. Add read-only project aggregation endpoints
  - Add `GET /bridge/projects` and `GET /bridge/projects/:key` returning summaries and per-project grouped data + derived status
  - Introduce no new mutation authority and no new gate
  - _Requirements: 4.1, 4.4, 6.6, 10.1_

- [ ] 15. Switch the cockpit data layer to real project endpoints
  - Replace the client projection source with the new endpoints behind the same view contracts (localized change)
  - Verify status fidelity (cross-entity grouping) improves without changing gated workflows
  - _Requirements: 1.2, 4.3, 6.6_

- [ ] 16. Add Phase B tests and doc updates
  - `tests/project-store.test.mjs` (grouping + `projectId` backfill) and `tests/bridge-projects-api.test.mjs` (read-only aggregation; assert no new mutation authority)
  - Update canonical docs and `CHANGELOG.md` for the Project entity
  - _Requirements: 10.1, 10.2, 10.3_

- [ ] 17. Add backend sources for the full status panel (Phase B)
  - Add read-only sources for the fields with no backing data today: version/milestone + slice progress, latest-audit (tests/commits-ahead), and a project memory store; optionally a conversation/message store for a true dialogue timeline
  - Surface them via the project aggregation endpoints; keep all additions read-only with no new mutation authority
  - Switch the cockpit's "unavailable" status fields and the derived activity feed to the real sources behind the existing view contracts
  - _Requirements: 4.1, 4.4, 4.5, 6.4, 3.6_

## Notes

- **Thin-client is non-negotiable.** No task introduces business logic, CLI invocation,
  auto-execution, or gate bypass on the client. All mutations route through existing gated
  `/bridge/*` endpoints (design Properties 1–4).
- **Phase A ships independently.** It requires no backend schema change; it reads existing
  endpoints and groups client-side under a default `"cli-bridge"` project.
- **Phase B is optional.** Promote Project to a stored entity only when cross-entity grouping
  fidelity is needed; it must stay additive (optional `projectId`, read-only aggregation, no
  new mutation authority) and preserve existing data via default-project backfill.
- **Governance.** Per the cli-bridge AGENTS contract, canonical product docs and `CHANGELOG.md`
  are updated before/with implementation (tasks 12 and 16).
- **Testing reuses the existing `tests/*.test.mjs` harness** and the `console-ui` /
  `console-goals-ui` HTML-assertion precedent; existing console tests must keep passing.
