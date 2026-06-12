# Changelog

All notable changes to CLI Bridge are documented here.

## [Unreleased] — v2.x

### Planning / ADR
- Added repository agent workflow governance docs: `AGENTS.md` for hard batch
  rules and `docs/planning/CLI-BRIDGE-AGENT-WORKFLOW.md` for the RP/EX/REVIEW
  process.
- **ADR-0004 Model API Middle Layer** ACCEPTED. Senior review passed.
- **v2.4a PlannerModel Implementation Handoff** approved, handoff review complete.
- **ADR-0005 CriticModel Advisory Review** ACCEPTED (senior review, with
  conditions on the implementation handoff). CriticModel is advisory-only
  (`canExecute=false`). Arbiter, Replanner, Summarizer, and any bounded
  self-iteration remain unauthorized.
- **v2.4a-8 CriticModel Implementation Handoff** added and implemented as an
  advisory-only `criticSource: "model-api"` option on existing model planning.
- **ADR-0006 Multi-provider AgentTeam** ACCEPTED (senior review, with
  conditions on the v2.4b implementation handoff) for Track C / v2.4b. The v2.3
  safety boundary is unchanged: sequential, concurrency 1, patch-only, read-only
  conflict reports. Parallel slots, worktree isolation, workspace-write,
  auto-commit/push/merge, merge queue, and model arbitration remain
  unauthorized.
- **v2.4b Multi-provider AgentTeam Implementation Handoff** added and
  implemented within the existing TeamSpec routes.
- Drafted **ADR-0007 Workspace-write Expansion (v2.5+)** as a PROPOSED /
  DEFERRED skeleton. It makes no decision and authorizes nothing; it only scopes
  the prerequisites, open questions, and risks any future workspace-write ADR
  must resolve. All v2.5+ capabilities (workspace-write, worktree isolation,
  merge queue, auto-commit/push/merge, advanced executors) remain forbidden.
- Drafted **ADR-0008 Patch Apply to Isolated Worktree** as PROPOSED — the first
  focused v2.5 workspace-write capability. Scope is the smallest possible: opt-in,
  human-gated, reversible apply of an approved patch into a bridge-managed
  isolated worktree (never the main tree), with no VCS mutation, no parallelism,
  and no autonomy. Requires explicit human accept/reject before any code.

### Added — v2.4a PlannerModel Minimal Implementation
- **`POST /bridge/goals/plan`** now supports optional `plannerSource` field:
  - `"review-cli"` (default): existing behavior unchanged.
  - `"model-api"`: uses memory-only API key + OpenAI-compatible adapter to
    generate advisory PlanDraft. No plan attached to goal.
- **Model provider interface**: `apps/local-server/src/model/provider-interface.ts`
  with `ModelProvider.plan()` contract.
- **OpenAI adapter**: `apps/local-server/src/model/openai-adapter.ts` using Node
  built-in `fetch`, no npm dependencies. Supports timeout, budget, retry.
- **In-memory API key store**: `apps/local-server/src/model/api-key.ts`. Keys
  never persisted to disk, snapshot, audit, or HTTP response.
- **PlannerModel**: `apps/local-server/src/model/planner-model.ts` with fail-closed
  schema validation, PolicyEngine checks, step ceiling enforcement, and
  forbidden-kind rejection. Schema/policy failures return 409, not 200.
- **Audit enrichment**: `model_plan_request` / `model_plan_result` events with
  full metadata (status, provider, endpoint, tokenBudget, usage, latencyMs,
  failureKind, failureReason). Request written before provider call, result
  for all outcomes. No raw prompt/response/key in audit.
- **Input budget + parse classification**: conservative token estimation before
  sending; JSON parse errors classified as non-retryable model output failures.
- **Console**: minimal read-only "Model API: unavailable" status display; no
  execute/dispatch/apply actions.
- **Tests**: 16 model API tests. Total: 523/523 passing tests.
- **No new endpoint, no npm dependencies, no shell/exec/run/command,
  no auto-apply/commit/push/merge, no parallel slots, no WorkBuddy executor,
  no CriticModel/ArbiterModel.**
- **Closeout**: `docs/planning/CLI-BRIDGE-v2.4a-CLOSEOUT-REVIEW.md` approved.

### Added — v2.4a-8 CriticModel Advisory Review
- **`POST /bridge/goals/plan`** with `plannerSource: "model-api"` now accepts
  optional `criticSource: "model-api"` and returns structured advisory critique
  beside the draft. `criticSource` defaults to `"none"`.
- **Provider contract**: `ModelProvider.critique()` added for advisory
  CriticModel calls; no state mutation or execution authority.
- **Critic prompt + validation**: fixed system preamble and fail-closed schema /
  forbidden-action checks for executable instructions, shell/git content, secret
  requests, gate bypass, and workspace-write instructions.
- **Audit enrichment**: `model_critique_request` /
  `model_critique_result` events with metadata only; no raw prompt, response,
  API key, file content, or CLI content.
- **Tests**: model API coverage includes CriticModel happy path, `blocking` as
  label-only, schema fail-closed, forbidden-action rejection, audit redaction,
  default compatibility, and route pairing validation.
- **No new endpoint, no new dependency, no self-iteration, no auto-apply,
  no commit/push/merge, no execution path, and no goal/plan/step mutation from
  critique output.**

### Added — v2.4b Multi-provider AgentTeam
- **Per-slot provider binding**: TeamSpec logical slots may declare
  `providerId` and `endpointId`; omitted values default to the team-level
  provider/endpoint for backward compatibility.
- **Capability parity checks**: each slot provider is validated against the
  shared static capability declaration; unknown providers fail closed.
- **Provider/session correlation**: SlotArtifact and slot audit metadata carry
  `providerId`, `endpointId`, `bridgeRunId`, and optional `externalSessionId`
  without raw provider output or API keys.
- **Conflict enrichment**: read-only conflict reports include provider ids for
  conflicting artifacts and still expose no winner/apply behavior.
- **Tests**: coverage for defaults, mixed providers, unknown provider
  fail-closed, sequential/no-parallel guard across providers, failed-provider
  stop behavior, artifact redaction, audit correlation, and read-only conflict
  reports.
- **No new endpoint, no bridge-governed parallel slots, no worktree, no
  workspace-write auto-apply, no commit/push/merge, no model arbitration, and no
  execution path from `canExecute=true` metadata.**

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
- Patch review follow-up: artifact `planStepId` is derived from the approved plan and rejects mismatches; `blocked-needs-gate` is supported with `slot_gated` audit semantics; cancelled slots now cancel the team; `slot_started` is only written when advancing to `executing`; malformed encoded slot routes no longer throw 500.

### Tests
- 15 new API-level tests covering artifact recording (happy path, redaction rejection, unknown slot, cross-project, audit), conflict report (clean, same-file conflict, cross-project), and slot advance (sequential order, skip rejection, double executing, failed-stops-team, pending-rejection, cross-project, audit events).
- 4 patch review follow-up tests covering `planStepId` mismatch rejection, `blocked-needs-gate` audit, cancelled-team lifecycle, and malformed encoded slot routes.
- Console UI tests continue to pass with no new shell/exec/run paths; allowlist unchanged.

### Safety
- No new shell/exec/run/command endpoints.
- No auto-apply, auto-commit, auto-push, auto-merge.
- No parallel slots, worktree, branch, shared workspace.
- No WorkBuddy executor, Model API, scheduler, daemon.
- Console remains read-only with no execute/dispatch/apply/merge buttons.
- Verdict: 498/498 tests pass; typecheck pass; lint pass; diff check pass.

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
