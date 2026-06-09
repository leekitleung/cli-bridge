# Design Document — Project Workspace Console

## Overview

This design turns the CLI Bridge mid-layer console from two isolated, action-centric
pages (`/console`, `/console/goals`) into a single **project cockpit**: a three-region
workspace where **Project** is the organizing entity and conversation, goals, plans, steps,
reviews, prompt drafts, audit, and memory are all facets *of the active project*.

The design preserves the existing security model verbatim. The console stays a **thin
client**: it issues `GET`/`POST` calls to `/bridge/*` endpoints that already enforce
redaction, capability gating, plan approval, the per-step state-mutating gate, the step
ceiling, and tier permission. No business logic, CLI invocation, auto-execution, or gate
bypass is added on the client.

### Key finding from code review

The backend has **no `Project` entity**. Today's grouping key is `sessionId`, attached to
`Goal`, `AgentReviewRequest`, `PendingPrompt`, `OutboundPrompt`, `AuditEvent`, and
`BridgePacket`. Separately, the `WorkBuddy*` types in `packages/shared/src/types.ts` already
carry a `projectId`. So "project" is a latent concept that this feature promotes to
first-class.

Two viable strategies follow from that finding. This design adopts a **phased approach** so
the UI can ship first against a derived projection, then harden into a backend entity.

---

## Architecture

### Strategy: phased, projection-first

```
Phase A (UI shell + projection)        Phase B (backend Project entity)
─────────────────────────────         ───────────────────────────────
Project = derived view over            Project = first-class stored entity
existing sessionId-tagged data         goals/reviews/prompts carry projectId
                                        new /bridge/projects* read endpoints
client groups by project key           server aggregates project status
```

**Phase A** introduces a `ProjectProjection` computed on the client from existing list
endpoints (`/bridge/goals`, `/bridge/reviews`, `/bridge/pending-prompts`, `/bridge/metrics`),
keyed by a derived project key. This unblocks the entire cockpit UI/UX without backend
schema change and keeps the thin-client guarantee intact (it only reads).

**Phase B** (optional, follow-on) promotes Project to a stored entity with a small
`ProjectStore` and read-only aggregation endpoints. The UI's data layer is designed so that
swapping the projection source for real endpoints is a localized change.

> The requirements' **layout, project scoping, gated goal/review workflows, and UX/accessibility
> (R1, R2, R3, R5, R6, R7, R8, R9, R11)** are fully satisfiable in Phase A. The **rich status
> panel figures and true conversation/memory (parts of R3, R4, R6.4)** are **not** backed by
> current data and are Phase B items — see "Data Availability" below.

### Data Availability (what the backend actually exposes today)

A direct review of the bridge endpoints and `BridgeMetricsSummary` shows the cockpit mockup
asks for several fields that **have no data source yet**. This table is the honest contract:

| UI element (from mockup)              | Backing data today                          | Phase |
| ------------------------------------- | ------------------------------------------- | ----- |
| Goal list + status                    | `GET /bridge/goals` (Goal/Plan)             | A     |
| Plan steps + gate state               | `GET /bridge/goals` (Plan.steps)            | A     |
| Reviews list                          | `GET /bridge/reviews`                       | A     |
| Prompt drafts                         | `GET /bridge/pending-prompts`              | A     |
| Progress (steps done / total)         | derived from active Plan.steps              | A     |
| Activity timeline                     | **derived** from goals/steps/reviews/prompts| A     |
| Connection state                      | `GET /bridge/metrics` (auth probe)          | A     |
| Branch in top bar                     | `BridgePacket.context.branch` (often empty) | A*    |
| Version / milestone label             | **none**                                    | B     |
| Slice count (e.g. 4/6)                | **none**                                    | B     |
| Test pass count (e.g. 297/297)        | **none**                                    | B     |
| Commits ahead of remote               | **none**                                    | B     |
| Project memory / facts                | **none** (no memory store)                  | B     |
| True conversation log (You/Bridge)    | **none** (no message store)                 | B     |

`A*` = available only when packets carry branch context; otherwise hidden.

**Consequence:** in Phase A the right-hand status panel is intentionally sparser than the
mockup — it shows derived step progress, the goals summary, and gate state, and renders
"unavailable"/empty for version, slices, tests, commits-ahead, and memory. The Phase A
timeline is a derived activity feed, not a chat log. Phase B introduces the backend sources
(a status/aggregation source, a memory store, and optionally a conversation store) needed to
match the full mockup.

### Project key derivation (Phase A)

Existing identifiers follow a `"<prefix>-<timestamp>"` convention
(`'goal-console-' + Date.now()`, `'console-' + Date.now()`). For Phase A:

- A **project key** is derived from a configurable rule, defaulting to a single implicit
  project (`"cli-bridge"`) so existing data appears under one project rather than fragmenting
  per session.
- The UI allows naming/selecting projects; the active project key is stored in
  `localStorage` (non-sensitive) while the pairing token stays in memory only.
- When Phase B lands, the derived key is replaced by a real `projectId` without changing the
  view contracts.

### Client architecture (single-page, dependency-free)

Consistent with the current self-contained HTML approach (no build step, served as a string),
the cockpit is a single document served at a new route, structured into clear modules within
one `<script>`:

```
renderProjectConsoleHtml()
└─ <head> design tokens (CSS custom properties)
└─ <body> three-region grid
   ├─ TopBar
   ├─ LeftNav      (ProjectList + SectionNav)
   ├─ Workspace    (CurrentGoalCard + Timeline + PlanCard + SectionPanels)
   ├─ StatusPanel  (Progress + ActiveSlice + Goals + LatestAudit + Memory)
   └─ CommandBar
   ── script ──
   ├─ api()              thin fetch wrapper (token header)
   ├─ store{}            in-memory app state (activeProject, view, caches)
   ├─ projection         buildProjects(goals, reviews, prompts, metrics)
   ├─ render*()          pure-ish render functions per region
   └─ actions{}          goal/review/gate calls → existing endpoints
```

### Route decision

- New route: **`GET /console/project`** renders the cockpit.
- `/console` and `/console/goals` are **retained** during transition (R requirements do not
  require deletion). The cockpit links to them as "classic" views; once validated, a later
  slice can redirect them. This avoids a risky big-bang replacement.

### Request/response flow (unchanged endpoints)

```
Browser (cockpit)                    local-server /bridge/*
─────────────────                    ──────────────────────
connect (token) ───────────────────▶ GET /bridge/metrics        (auth probe)
load project view ─────────────────▶ GET /bridge/goals
                                      GET /bridge/reviews
                                      GET /bridge/pending-prompts
                                      GET /bridge/metrics
create goal ───────────────────────▶ POST /bridge/goals
generate plan ─────────────────────▶ POST /bridge/goals/plan      (review-only)
approve plan ──────────────────────▶ POST /bridge/goals/approve   (human gate)
run next step ─────────────────────▶ POST /bridge/goals/step      (single advance)
approve gate ──────────────────────▶ POST /bridge/goals/gate      (per-step gate)
cancel ────────────────────────────▶ POST /bridge/goals/cancel
create/confirm/dispatch review ────▶ POST /bridge/reviews[/confirm|/dispatch]
```

No new write endpoints are introduced. Every mutation already has its gate server-side.

---

## Components and Interfaces

### Client-side view model (Phase A)

```ts
// Derived, read-only. Computed entirely on the client from existing endpoints.
interface ProjectProjection {
  key: string;                 // derived project key (Phase A) / projectId (Phase B)
  name: string;                // display name (user-editable label, persisted locally)
  statusLabel: string;         // e.g. "v2.0 in progress" | "idle"
  goals: GoalWithPlan[];       // from GET /bridge/goals
  reviews: ReviewRow[];        // from GET /bridge/reviews
  prompts: PromptRow[];        // from GET /bridge/pending-prompts
  metrics: BridgeMetricsSummary | null;
}

interface ProjectStatus {
  // Phase A: derived from active Plan.steps (done/total). Phase B: version/slice source.
  progress: { milestone: string | null; completed: number; total: number } | null;
  activeSlice: { title: string; status: string; next: string } | null;
  goalsSummary: Array<{ label: string; status: GoalStatus }>;
  // Phase B only: no commit/test data exists today → null in Phase A.
  latestAudit: { summary: string; tests?: string; aheadCommits?: number } | null;
  memory: string[];            // Phase B only; Phase A renders empty/placeholder
  blockedGate: { goalId: string; stepIndex: number } | null;
}
```

`progress`, `activeSlice`, and the goals summary are derived from goal/plan/step state in
Phase A. `latestAudit` and `memory` have **no backend source today** (see "Data Availability")
and render as explicit "unavailable"/empty (R4.7) until Phase B; `progress.milestone` is
likewise `null` in Phase A.

### App state

```ts
const store = {
  token: '',                 // memory only
  base: location.origin,
  activeProjectKey: '',      // mirrored to localStorage
  view: 'workspace',         // 'workspace'|'reviews'|'prompts'|'audit'|'memory'
  cache: { goals: [], reviews: [], prompts: [], metrics: null },
};
```

### Region responsibilities

- **TopBar** — product name, active project name, branch (from packet/audit `context.branch`
  when present, else hidden), connection status pill.
- **LeftNav** — `ProjectList` (selectable, with status label, empty state with "create first
  project"); `SectionNav` (Conversations, Goals, Reviews, Prompts, Audit, Memory) switching
  `store.view`.
- **Workspace** — `CurrentGoalCard` (active goal + status + actions), `Timeline`
  (project-scoped entries, role-distinguished), `PlanCard` (steps table + gate buttons),
  and `SectionPanel` (renders reviews/prompts/audit/memory when those views are active).
- **StatusPanel** — Progress, Active Slice, Goals, Latest Audit, Memory, plus a visible
  gated-state indicator (R4.6).
- **CommandBar** — single input; submit routes by lightweight intent detection to
  create-goal / continue / generate-plan, never to direct dispatch (R8.4).

### Phase B backend interfaces (follow-on, documented for continuity)

```ts
// New, read-only aggregation endpoints (no new mutation authority):
GET /bridge/projects            -> { projects: ProjectSummary[] }
GET /bridge/projects/:key       -> { project, goals, reviews, prompts, audit, status }
```

```ts
interface ProjectSummary { key: string; name: string; statusLabel: string; updatedAt: number; }
```

Phase B adds an optional `projectId` to `Goal`/`AgentReviewRequest`/`PendingPrompt` and a
small in-memory `ProjectStore`, mirroring the existing store patterns. It introduces no new
gate and no execution authority — it only groups and reads.

---

## Data Models

### Phase A — no schema change

Project is a client-side projection. The console reads existing shapes (`Goal`, `Plan`,
`PlanStep`, `AgentReviewRequest`, `PendingPrompt`, `BridgeMetricsSummary`) and groups them.

### Phase B — additive, backward-compatible

- Add optional `projectId?: string` to `Goal`, `AgentReviewRequest`, `PendingPrompt`.
- Add `Project { id; name; createdAt; updatedAt }` and `ProjectStore` (in-memory, snapshot
  hydrate/export following `json-snapshot-store` patterns).
- Backfill: records without `projectId` map to the default `"cli-bridge"` project, preserving
  existing data.

The phased model means the UI never blocks on schema migration, satisfying the
canonical-docs-before-implementation rule without forcing a backend change in the same slice.

---

## UX and Visual Design

### Layout

CSS Grid, three columns with a top bar and bottom command bar:

```
grid-template-rows: 56px 1fr 64px;        /* topbar / body / commandbar */
body row -> grid-template-columns: 280px 1fr 320px;  /* nav / workspace / status */
```

- **Responsive (R2.6):** below ~1100px, the status panel collapses behind a toggle; below
  ~760px, the left nav becomes a drawer. Navigation and status remain reachable.

### Design tokens (CSS custom properties)

Reuse the existing slate dark palette as tokens so future theming is trivial:

```
--bg:#0f172a; --surface:#1e293b; --border:#334155; --text:#e2e8f0;
--muted:#94a3b8; --accent:#2563eb; --warn:#b45309; --danger:#7f1d1d;
--done:#14532d; --gate:#b45309;
```

### Status semantics (carried from goal console)

Pills keep their established meaning and color: `done` (green), `failed` (red),
`blocked-needs-gate` (amber), `mutating` (orange). Gate and Cancel buttons stay visually
distinct from read/refresh actions (R11.4).

### Interaction principles

- Every action shows in-progress → result/error feedback inline (R11.1).
- Each region has explicit loading and empty states (R11.2).
- Data refreshes in-place after actions; no full page reload (R11.6).
- Timeline and result blocks wrap and scroll rather than overflow (R11.5).

### Accessibility (R11.3)

- Semantic landmarks: `<header>`, `<nav>`, `<main>`, `<aside>`, `<footer>`.
- All controls keyboard-operable; visible focus rings; command bar submits on Enter.
- Status conveyed by text label in addition to color (pills include text).
- Inputs have associated `<label>`s; live regions (`aria-live="polite"`) announce action
  status. Note: full WCAG conformance requires manual assistive-tech testing beyond this
  design.

---

## Error Handling

- **Auth failure** on any call → connection pill shows "auth failed (status)"; dependent
  actions are blocked until reconnect (R9.4).
- **Action failure** (4xx/5xx) → inline error on the originating control; no gate bypass, no
  auto-retry of state-mutating steps (R5.6, R9.2).
- **Empty/unavailable data** → explicit empty states; status fields render "unavailable"
  rather than fabricated values (R4.7).
- **No active project** → command bar and goal actions prompt to select/create a project
  first (R1.5, R8.5).
- **Network/transport error** → caught in `api()`; surfaced as a non-destructive error
  message; state cache is left unchanged.

---

## Correctness Properties

These are invariants the implementation must always uphold, independent of UI state.

### Property 1: Thin-client invariant
The cockpit performs only `GET` reads and `POST` calls to existing `/bridge/*` endpoints; it
never spawns a process, calls a CLI, or contains gate logic.

**Validates: Requirements 9.1, 9.2**

### Property 2: No gate bypass
For any state-mutating step, the UI cannot transition it to running without a prior
successful `POST /bridge/goals/gate`; the server remains the sole gate authority.

**Validates: Requirements 5.4, 9.5**

### Property 3: No auto-advance
Completing a step never triggers the next step automatically; a distinct user action is
required for each advance.

**Validates: Requirements 5.5**

### Property 4: Plan-before-execution
No step action is offered or issued until the plan is approved; a generated plan is always
review-only first.

**Validates: Requirements 5.3**

### Property 5: Project scoping
Every rendered list (timeline, goals, reviews, prompts, audit, memory) reflects exactly the
active project's data; switching projects fully replaces scoped content with no cross-project
leakage.

**Validates: Requirements 3.4, 6.6**

### Property 6: Token confinement
The pairing token exists only in page memory and is sent on every bridge call; only the
non-sensitive active-project key may be persisted locally.

**Validates: Requirements 9.3**

### Property 7: Truthful status
A status field is shown only when derivable from real data; otherwise an explicit
"unavailable"/empty state is rendered, never a fabricated value.

**Validates: Requirements 4.7**

### Property 8: Additive backend (Phase B)
Any backend Project work is read-only aggregation plus an optional `projectId`; it introduces
no new mutation authority and preserves existing data via default-project backfill.

**Validates: Requirements 10.1, 10.3**

## Testing Strategy

Aligned with the existing `tests/*.test.mjs` node test suite and the current
`console-ui.test.mjs` / `console-goals-ui.test.mjs` precedent (HTML-string assertions + flow
checks).

1. **Render/structure tests** (`project-console-ui.test.mjs`): the cockpit HTML contains the
   three regions, project list, section nav, status panel, and command bar; links to classic
   consoles exist; no inline business logic markers (e.g. no direct CLI calls).
2. **Projection unit tests**: `buildProjects()` / `buildStatus()` group goals/reviews/prompts
   by project key and derive progress/active-slice/gated-state correctly, including
   empty-data and missing-field cases.
3. **Gate-preservation tests**: assert the cockpit calls the existing endpoints in the
   correct order (create→confirm→dispatch; plan→approve→step→gate) and never a CLI directly;
   reuse the endpoint contracts already covered by `bridge-goals-api`/`bridge-reviews-api`
   tests.
4. **Regression**: existing `/console` and `/console/goals` tests must keep passing
   (non-deletion guarantee).
5. **Phase B (when implemented)**: `project-store.test.mjs` and `bridge-projects-api.test.mjs`
   for grouping, backfill of `projectId`, and read-only aggregation; verify no new mutation
   authority is introduced.

---

## Open Decisions (resolved defaults, changeable)

1. **Project source:** default to Phase A projection now; Phase B entity as a follow-on
   slice. (Resolves the "does Project exist in backend?" question: it does not yet — promoted
   via projection first.)
2. **Console replacement:** new `/console/project` route alongside existing consoles during
   transition, rather than replacing them in one step.
3. **Project key rule:** default single implicit `"cli-bridge"` project so existing
   `sessionId`-tagged data is not fragmented; user-named projects layer on top.
4. **Status-panel data honesty (added after review):** version/milestone, slice counts, test
   results, commits-ahead, memory, and a true conversation log have **no backend source
   today**. Phase A renders these as "unavailable"/empty and ships a derived activity feed;
   Phase B adds the backing sources. The cockpit's Phase A appearance is therefore
   intentionally sparser than the mockup.
5. **Multi-project UX is mocked in Phase A:** because all data groups under one implicit
   project until Phase B adds `projectId`, the project list and project switching are
   exercised meaningfully only once Phase B lands.
