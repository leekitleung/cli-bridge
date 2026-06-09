# Requirements Document

## Introduction

CLI Bridge's mid-layer console is currently two separate, conversation/goal-centric
views: `/console` (review-only) and `/console/goals` (goal-driven). Each opens onto an
isolated action surface with no sense of "where am I and what is this work part of."

This feature restructures the console information architecture so that **Project** is the
first-class, top-level entity. A user entering the console first selects (or lands on) a
Project, and everything else — conversation timeline, goals, plans, steps, reviews, prompt
drafts, audit log, and long-term memory — is presented as facets *of that project*.

The product intent is a **project cockpit + conversational workflow**, not a bare AI chat
box. At any moment the interface must answer: where has this project progressed, what is the
current goal, which steps are done, where is it gated, and what is the next step.

### Information architecture

```
Workspace
└─ Project
   ├─ Activity Timeline       project-scoped activity (Phase A: derived feed;
   │                          Phase B: true conversation log)
   ├─ Goals                   project goals / current work items
   ├─ Plans                   execution plan per goal
   ├─ Steps                   plan steps + gate state
   ├─ Reviews                 review records
   ├─ Prompt Drafts           prompts awaiting confirmation
   ├─ Audit Log               operation audit
   └─ Memory                  project long-term memory / fact summary (Phase B)
```

### Non-negotiable constraints (carried from current architecture)

- The console remains a **thin client**: it holds no business logic. Every action calls a
  `/bridge/*` endpoint that already enforces redaction, capability gating, plan-level
  approval, the per-step state-mutating gate, the step ceiling, and tier permission.
- The console never calls a CLI directly, never auto-executes a follow-up step, and never
  bypasses a confirmation gate.
- The pairing token is entered by the user and kept only in page memory.
- Changes must land in canonical product docs before or with implementation
  (per the cli-bridge governance contract).

### Out of scope

- Backend goal/plan/step orchestration logic (already exists; only new read/list surfaces
  for project grouping may be required).
- Multi-user accounts, auth providers, or remote hosting.
- Replacing the existing gate/approval security model.

---

## Glossary

- **Project**: the top-level container that owns an activity timeline, goals, plans,
  steps, reviews, prompt drafts, audit entries, and memory.
- **Activity Timeline**: the chronological record scoped to one project. Phase A derives it
  from real records (goals, plan/step transitions, reviews, prompts); Phase B may back it with
  a true conversation/message store.
- **Goal**: a unit of work to be planned and executed within a project.
- **Plan / Step / Gate**: a goal's generated execution plan, its ordered steps, and the
  human approval points (plan-level approval + per-step state-mutating gate).
- **Project Status**: the right-side panel summarizing progress, active slice, goals,
  latest audit, and memory for the current project.
- **Command Bar**: the bottom input that accepts a project goal, "continue", history search,
  or "generate plan" and routes it to the correct gated endpoint.
- **Endpoint / Agent Slot**: an external execution target (e.g. Claude Code, Codex, and in
  the future WorkBuddy/qclaw/openclaw/hermes/AgentTeam). These attach *under* a project; they
  do not replace the project.

---

## Requirements

### Requirement 1: Project is the first-class entry point

**User Story:** As a CLI Bridge operator, I want to land on a project rather than an isolated
chat, so that all history and progress are framed by which project I am working on.

#### Acceptance Criteria

1. WHEN the console loads after the user connects with a valid pairing token THEN the system SHALL present a Project as the active context, not an undifferentiated chat surface.
2. THE system SHALL display a Projects list (left navigation) showing each known project with its name and a short status label (e.g. "v2.0 in progress", "idle").
3. WHEN the user selects a project from the Projects list THEN the system SHALL set it as the active project and refresh the workspace and status panels to that project's scope.
4. THE system SHALL persist the active project selection so that refreshing data does not silently reset the project. (Phase A persists the non-sensitive active-project key in `localStorage`; the pairing token stays in memory only.)
5. IF no projects exist THEN the system SHALL present an explicit empty state with an affordance to create or initialize the first project, rather than a blank or broken view.

### Requirement 2: Three-region project cockpit layout

**User Story:** As an operator, I want a stable three-region layout (navigation, workspace,
status), so that I always know where to look for history, actions, and progress.

#### Acceptance Criteria

1. THE system SHALL render a left region containing the Projects list and, below it, the current project's section navigation (Conversations, Goals, Reviews, Prompts, Audit, Memory).
2. THE system SHALL render a center "Project Workspace" region containing the current goal card, the conversation timeline, and any inline plan/approval card for the active goal.
3. THE system SHALL render a right "Project Status" region that summarizes progress, active slice, goals, latest audit, and memory for the active project.
4. THE system SHALL render a top bar showing the product name, active project name, current branch (when available), and connection status.
5. THE system SHALL render a bottom command bar spanning the workspace width for project-level input.
6. WHEN the viewport is narrow THEN the system SHALL degrade gracefully (e.g. collapsible side regions) without losing access to navigation or status.

### Requirement 3: Project-scoped activity timeline

**User Story:** As an operator, I want a timeline that records what happened *in this project*,
so that progress has context instead of being a global feed.

> **Data-availability note (Phase A):** the backend has no conversation/message store. In
> Phase A this region is a **derived activity feed** synthesized from real records — goals,
> plan/approval transitions, step results, reviews, and prompt drafts — not a free-form chat
> log. A true turn-by-turn conversation log ("You" / "Bridge" dialogue bubbles) requires a
> backend conversation store and is deferred to Phase B (see design "Data Availability").

#### Acceptance Criteria

1. WHEN a project is active THEN the system SHALL show only that project's activity timeline entries.
2. THE system SHALL visually distinguish entry origin in the timeline (e.g. operator-initiated action vs bridge/system result).
3. THE system SHALL render timeline entries in chronological order with the most recent context reachable.
4. WHEN switching the active project THEN the system SHALL replace the timeline with the newly selected project's entries.
5. THE system SHALL surface plan/approval and step results as timeline entries or clearly linked cards so that the timeline reflects the project's actual progress.
6. WHERE Phase B adds a backend conversation store THEN the system SHALL render true dialogue turns; until then the derived activity feed SHALL be the documented Phase A behavior.

### Requirement 4: Project status panel answers "where is this project now"

**User Story:** As an operator, I want a status panel that always answers where the project
stands, what the current goal is, what is done, where it is gated, and what is next.

> **Data-availability note:** the current bridge exposes only goal/plan/step state and
> `BridgeMetricsSummary` (packet counts, confirm/cancel rates). It does **not** expose
> version/milestone, slice counts, test results, git commits-ahead, or memory. Therefore the
> mockup's rich figures (e.g. "v2.0 4/6 slices", "tests 297/297", "ahead 4 commits") are
> **Phase B** items requiring a dedicated status/memory source. Phase A populates only what is
> derivable and shows explicit "unavailable" states for the rest.

#### Acceptance Criteria

1. (Phase A) THE system SHALL display a Progress summary derived from goal/plan/step state (e.g. completed-vs-total steps of the active plan) with a visual progress indicator. (Phase B) WHERE a version/milestone and slice source exists THEN the system SHALL display version/milestone label and completed-vs-total slice count.
2. (Phase A) THE system SHALL display the Active Goal/Plan with its status and the next runnable step when derivable from plan state.
3. THE system SHALL display the project's Goals list with per-goal status (e.g. done / next / pending).
4. (Phase B) WHERE the bridge provides commit/test/slice data THEN the system SHALL display the Latest Audit summary (last committed slice, test pass count, commits ahead of remote); in Phase A this SHALL render as "unavailable".
5. (Phase B) WHERE a project memory store exists THEN the system SHALL display project Memory highlights; in Phase A the Memory section SHALL render as an explicit empty/placeholder state.
6. IF a step is currently blocked at a gate THEN the system SHALL make that gated state visible in the status panel so the operator can see what is blocking progress.
7. WHERE the bridge does not provide a given status field THEN the system SHALL show an explicit "unavailable"/empty indicator rather than fabricating a value.

### Requirement 5: Current goal card and gated goal workflow

**User Story:** As an operator, I want to drive the current goal (generate plan, approve,
advance steps) from the project workspace, so that planning and execution live inside the
project context.

#### Acceptance Criteria

1. THE system SHALL show a Current Goal card in the workspace with the goal title/section and its status (e.g. draft, planning, awaiting-approval, in-progress).
2. THE system SHALL provide goal actions (create goal, generate plan, approve plan, run next step, approve gate, cancel) that each call the corresponding existing `/bridge/goals*` endpoint.
3. WHEN the user generates a plan THEN the system SHALL show the plan as review-only and awaiting approval, and SHALL NOT run any step.
4. WHEN a step is state-mutating THEN the system SHALL surface it as blocked-needs-gate and SHALL require a separate gate approval before it can run.
5. THE system SHALL NOT auto-advance to the next step after a step completes; advancing SHALL require an explicit user action.
6. WHEN a plan-level or step-level action fails THEN the system SHALL show a clear, non-destructive error state and SHALL NOT bypass any gate to retry.
7. THE system SHALL display plan steps with index, intent, kind, tier, status, and gate affordance, consistent with the existing goal data model.

### Requirement 6: Project section views (Reviews, Prompts, Audit, Memory)

**User Story:** As an operator, I want to open each project facet (reviews, prompt drafts,
audit, memory) within the project, so that I can inspect supporting records without leaving
the project context.

#### Acceptance Criteria

1. WHEN the user selects "Reviews" THEN the system SHALL list the active project's review records with id, target endpoint, and status.
2. WHEN the user selects "Prompts" THEN the system SHALL list pending prompt drafts with id, status, and transport, and SHALL clearly mark them as requiring explicit confirmation (never auto-sent).
3. WHEN the user selects "Audit" THEN the system SHALL show the project's audit entries / operation history.
4. WHEN the user selects "Memory" THEN the system SHALL show the project's long-term memory / fact summary. (Phase A: explicit empty/placeholder state, since no backend memory store exists yet; Phase B: real memory entries.)
5. WHEN the user selects "Conversations" or "Goals" THEN the system SHALL focus the corresponding workspace content.
6. THE system SHALL keep all section views scoped to the active project.

### Requirement 7: Review creation preserves the gated review flow

**User Story:** As an operator, I want to create and dispatch a review from within a project,
so that review work is attributed to the project while keeping the existing safety gates.

#### Acceptance Criteria

1. THE system SHALL allow creating a review (target endpoint + content) from within the active project.
2. WHEN a review is created THEN the system SHALL follow the existing create → confirm → dispatch flow against the `/bridge/reviews*` endpoints.
3. WHEN a dispatch produces a next-prompt THEN the system SHALL present it as a draft requiring separate confirmation and SHALL NOT auto-execute it.
4. THE system SHALL associate created reviews with the active project so they appear in that project's Reviews view.

### Requirement 8: Command bar routes project-level intent

**User Story:** As an operator, I want a single bottom input to enter a project goal,
continue current work, search history, or generate a plan, so that I have one natural entry
point for project-level intent.

#### Acceptance Criteria

1. THE system SHALL provide a bottom command bar whose placeholder communicates its supported intents (enter project goal / continue current project / search history / generate plan).
2. WHEN the user submits input interpreted as a new goal THEN the system SHALL create a goal in the active project via the goals endpoint.
3. WHEN the user submits a "continue" or "generate plan" intent THEN the system SHALL route to the corresponding gated goal action for the active project.
4. THE system SHALL never dispatch a CLI execution or bypass a gate directly from the command bar; it SHALL only create drafts/goals or trigger gated actions that still require their normal confirmation.
5. IF no project is active THEN the command bar SHALL prompt the user to select or create a project before acting.
6. WHEN an intent triggers `POST /bridge/goals/plan` (which spawns a review-only CLI server-side) THEN the system SHALL show an explicit in-progress indicator, because plan generation is not an instantaneous local action.

### Requirement 9: Preserve thin-client security and gate guarantees

**User Story:** As the system owner, I want the redesign to preserve every existing safety
guarantee, so that a nicer UI never weakens the security model.

#### Acceptance Criteria

1. THE console SHALL contain no business logic; all redaction, capability gating, plan approval, per-step gating, step ceiling, and tier permission SHALL remain enforced by `/bridge/*` endpoints.
2. THE console SHALL never call a CLI directly and SHALL never auto-execute a state-mutating step.
3. THE console SHALL keep the pairing token only in page memory and SHALL require it for all bridge calls.
4. WHEN any bridge call returns an auth failure THEN the system SHALL surface a clear connection/auth error and SHALL NOT proceed with dependent actions.
5. THE redesign SHALL NOT remove or weaken any confirmation gate present in the current `/console` and `/console/goals` flows.

### Requirement 10: Extensible project structure for future agent endpoints

**User Story:** As the system owner, I want the project structure to accommodate future
execution endpoints (WorkBuddy, qclaw, openclaw, hermes, AgentTeam), so that adding them does
not fracture the information architecture.

#### Acceptance Criteria

1. THE system SHALL model execution endpoints / agent slots as belonging *under* a project, not as replacements for the project as the top-level entity.
2. WHEN a new endpoint type is added THEN the project layout (navigation, workspace, status) SHALL accommodate it without requiring a different top-level entity.
3. THE system SHALL keep the Project → {Timeline, Goals, Plans, Steps, Reviews, Prompts, Audit, Memory} hierarchy stable as endpoints are added.

### Requirement 11: UX quality, accessibility, and feedback

**User Story:** As an operator, I want the cockpit to feel responsive, legible, and
accessible, so that I can operate it efficiently and without ambiguity.

#### Acceptance Criteria

1. THE system SHALL provide visible status/feedback for every action (in-progress, success, error) so the operator is never left guessing.
2. THE system SHALL provide loading and empty states for each region (projects, timeline, status fields, section views).
3. THE system SHALL meet baseline accessibility expectations: keyboard operability of primary actions, sufficient color contrast for status pills/text, and meaningful labels for inputs and controls.
4. THE system SHALL keep destructive or gated actions visually distinct from safe/read actions (e.g. cancel and gate-approval styled distinctly from refresh/read).
5. THE system SHALL preserve readability of long content (timeline entries, audit/step results) with appropriate wrapping/scrolling instead of overflow.
6. THE system SHALL reflect data changes (new timeline entries, status updates) after an action without requiring a full manual page reload.
