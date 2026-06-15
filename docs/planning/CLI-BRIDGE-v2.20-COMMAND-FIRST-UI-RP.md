# CLI Bridge v2.20 — Command-First Middle-Layer UI Reset — RP Plan

**Status**: RP PLAN — proposal only. Dispatchable as `EX-2.20-1` only after an
explicit human trigger; returns to `REVIEW-2.20-1` before any closeout/commit/push.
**Date**: 2026-06-15
**Batch**: `RP-2.20` (review/planning) -> authorizes `EX-2.20-1` ->
`REVIEW-2.20-1`
**Owner**: reviewing/planning agent
**User signal**: the current middle-layer UI is too far from the desired
minimal, Codex-like experience. The desired interaction should be command-first,
not "click a feature button to enter that feature."
Follow-up clarification: the left side should not become a feature navigation
rail. It should have at most one "recent session" affordance, while conversation
history primarily belongs under each corresponding project.
**Reuses (no new boundary)**: existing `/console/project`, existing extension
panel hooks, existing pairing-token auth, existing goal/review/verification
endpoints, and the existing no-generic-command-endpoint invariant.

---

## 0. Decision: command-first UI, not a generic command runner

The product direction is accepted at RP level: the middle-layer UI should be
reset from a feature-console shape to a command-first operator surface.

This does **not** authorize a shell, arbitrary command execution, a new
transport, or a free-form action endpoint. "Command-first" means the UI parses
operator intent and routes it to existing controlled workflow actions. It must
remain a thin client over server-owned state and gates.

The core product model is:

```text
operator intent -> controlled intent parser -> existing bridge endpoint/gate
                -> transcript/status update -> next suggested action
```

The UI should feel closer to Codex: one primary composer, a running transcript,
compact status, and explicit confirmation gates only when a workflow boundary
requires human approval.

## 1. Problem diagnosis

The current UI has accumulated a "control room" shape:

- `/console/project` uses top bar + left navigation + center cards + right
  status panel + bottom command bar.
- The command bar exists, but it is secondary. It routes only a small subset of
  goal actions while the surrounding interface still teaches the operator to
  click sections and action buttons.
- The left rail currently mixes project selection and feature-section
  navigation. The desired model is different: left-side structure should orient
  the operator around recent/project conversations, not around feature modules.
- The extension panel exposes direct feature buttons (`fill`, `extract`,
  `copy`) instead of acting as a small bridge composer/status surface.

This is not just visual polish. The current interaction model makes the
operator choose a feature area before expressing intent. That is the opposite
of the desired Codex-like flow, where the operator states intent first and the
system determines the controlled next action.

## 2. Alternatives considered

### Option A — restyle the existing console

Keep the three-region dashboard, reduce visual weight, rename buttons, and make
cards calmer.

**Pros**: lowest implementation risk; mostly CSS/test updates.
**Cons**: does not fix the interaction model. It would still be a feature
dashboard with a command bar bolted on.

### Option B — command-first console with collapsible context

Make the composer and transcript the primary surface. Move projects, sections,
verification, audit, memory, teams, and apply results into compact context panes
or command-addressable views. Keep explicit gate buttons only where safety
requires confirmation.

**Pros**: matches the desired Codex-like model; preserves existing server
boundaries; can be implemented incrementally without new backend capability.
**Cons**: requires careful tests so existing controlled actions do not disappear
or become ambiguous.

### Option C — make only the extension panel command-first

Leave `/console/project` as the full dashboard, and make the ChatGPT page panel
minimal.

**Pros**: smaller first patch.
**Cons**: splits the product model. The main middle-layer UI remains the part
the user dislikes.

**Recommendation**: Option B, with a very small first execution slice that
changes the surface model but not the backend capability model.

## 3. Target interaction model

### Primary surface

The first viewport should contain:

1. A transcript-like workspace: latest goal, system status, recent bridge
   events, plan state, verification evidence, and gate state as messages.
2. One primary command composer fixed near the bottom.
3. A compact project/status strip.
4. Optional context panes that are collapsed by default or shown only when
   command-addressed.

The user should not need to click into "Reviews", "Prompts", "Audit", "Memory",
"Verification", "Tasks", or "Team" just to understand what to do next.

### Product / UX layout specification

The interface should optimize for an operator who returns repeatedly to a
project and wants to understand "where am I, what is the plan, what is next?"
within seconds. The design language should be quiet, utilitarian, and
text-first. Avoid marketing-style cards, oversized hero areas, decorative
gradients, and feature dashboards.

The default desktop layout:

```text
+------------------------------------------------------------------------+
| project/status strip: active project, branch/status, auth indicator    |
+----------------+---------------------------------------+---------------+
| recent         | current project context               | compact facts |
| projects       | - current goal                        | - gates       |
| project        | - project plan summary                | - verify      |
| history        | - current/next step                   | - audit count |
|                | - transcript / timeline               | - last event  |
+----------------+---------------------------------------+---------------+
| command composer                                                       |
+------------------------------------------------------------------------+
```

Information hierarchy:

1. **Current project**: the operator must always know which project commands
   will affect.
2. **Current goal**: one sentence, status, and whether it is draft/planned/
   executing/blocked/done.
3. **Project plan**: placed directly below the current goal in the main
   workspace. Show plan status, next step, completed/total steps, and blocked
   gate if any. This is not a left-nav item and not a separate feature page.
4. **Next action**: one clear suggestion derived from current state, such as
   `plan`, `approve plan`, `continue`, `approve gate`, `verify`, or `status`.
5. **Transcript / timeline**: recent project conversation and bridge events,
   newest useful context near the command composer.
6. **Secondary facts**: verification, audit, memory, teams, apply result, and
   review details are compact facts or command-addressable context, not default
   workflow destinations.

Planner placement:

- The active project plan belongs in the main workspace, fixed near the top of
  the current project context, immediately under the current goal.
- The plan should be summarized first, with step details expandable inline.
- Historical plans belong to the corresponding project's conversation history
  and are reached via `history`, `plan history`, or project history selection.
- The right context column may repeat plan progress or blocked-gate facts, but
  it must not become the primary plan surface.

Interaction rules:

- The command composer is the primary action entry. It should accept natural
  task text plus short commands.
- The interface should always show what a command will target before a
  state-changing action runs. If target ambiguity exists, ask for selection
  instead of guessing.
- Safety gates remain explicit controls. They may appear inline inside the
  transcript/plan summary, but not as a large button grid.
- Empty states should be operational, not instructional: show the next valid
  command, not prose explaining the product.
- The UI should preserve density: compact rows, predictable alignment, no nested
  cards, no card-inside-card surfaces, and no large decorative panels.

Responsive behavior:

- Desktop: three zones are allowed, but the center command/transcript workspace
  must dominate visual weight.
- Medium width: right facts collapse into inline facts under the plan summary.
- Mobile/narrow: left rail collapses behind a project/history switcher; the
  main flow remains current goal -> plan -> next action -> transcript ->
  composer.

### Left rail: recent session + project-owned history

The left side should be conversation/project oriented, not feature oriented:

1. A single recent-session affordance at the top for fast resume of the last
   active bridge conversation/session.
2. A project list where each project owns its relevant conversation history.
   Existing project timeline entries should be rendered as the first source of
   project history.
3. Feature areas (`reviews`, `prompts`, `audit`, `memory`, `verification`,
   `tasks`, `team`) must not appear as primary left navigation. They may be
   surfaced only as command-addressable context or compact facets inside the
   active project conversation.

This aligns with `PLAN-PROJECT-CONVERSATION-TIMELINE.md`: conversation history
is project-scoped observability. `EX-2.20-1` may only present history derived
from existing project timeline/project detail data. It must not introduce
private Codex/Claude session-file reads, shell-history reads, automatic terminal
attachment, or a new transcript persistence model.

### Commands

The UI parser remains deterministic and allowlisted. Initial command families:

- `goal <text>` or any plain natural-language task when no active draft is
  being addressed -> create a goal for the active project.
- `plan` / `generate plan` / `生成 plan` -> generate a plan for the active draft
  goal.
- `continue` / `继续` -> run the next approved/executing step.
- `approve plan` -> approve the active awaiting-approval plan.
- `approve gate` -> approve the current blocked mutating step gate, if exactly
  one is active.
- `cancel` -> cancel the active goal, with an explicit confirmation affordance.
- `status` -> show current project/goal/verification status in transcript.
- `review` -> route only to the existing review workflow if the existing review
  section action already supports the active project; otherwise explain the
  missing precondition. No new review backend behavior.
- `verify` -> show verification status and available controlled verification
  actions. Network or local verification still uses existing human confirmation
  controls.
- `audit`, `memory`, `teams`, `apply` -> show compact read-only context in the
  transcript or context pane.
- `switch project <key>` -> switch active project if present.
- `recent` / `最近会话` -> focus the recent-session affordance if a recent
  session exists; otherwise show the active project conversation.
- `history` / `历史` -> show the active project's conversation history from
  existing timeline data.
- `plan history` / `规划历史` -> show historical plan entries from the active
  project's existing timeline/detail data when available.

Unknown commands should fail closed with a short explanation and suggested
known commands. They must not be forwarded to any backend as arbitrary text
except the existing "create goal" path when treated as a goal description.

### Buttons

Buttons remain only for safety or selection:

- Connect/auth.
- Approve plan.
- Approve gate.
- Cancel confirmation.
- Fetch remote checks / run local verification confirmation.
- Disambiguation when a command matches multiple possible targets.

Feature-navigation buttons should not be the primary path.

## 4. Security and architecture boundaries

Unchanged invariants:

- No `/exec`, `/shell`, `/run`, generic `/command`, arbitrary argv, cwd, env, or
  raw command execution surface.
- No new backend endpoint for this first UI reset.
- No pairing-token auth change; token only in `x-cli-bridge-pairing-token`.
- No auto-run loop, no scheduled execution, no auto-send to ChatGPT.
- UI remains a thin client. Business logic, capability gating, redaction,
  project isolation, step gates, and verification constraints remain server-side.
- A command can only select among existing controlled actions; it cannot invent
  a capability.

Boundary implication: if command-first UX later needs model-assisted intent
classification, that is a separate ADR/RP because it changes command
interpretation risk. `EX-2.20-1` must stay deterministic.

## 5. EX-2.20-1 scope

First slice goal: make the product direction visible while preserving every
current server boundary.

Allowed:

1. Reframe `/console/project` so the command composer and transcript/status
   stream are the primary center of the interface.
2. Keep existing data fetches, endpoint calls, and controlled workflow actions.
3. Move current section content behind command-addressable rendering or inline
   conversation context surfaces; do not keep a persistent right-side feature
   panel as the default workflow.
4. Replace the current feature-section left nav with a conversation/project
   rail: recent session first, then projects with project-owned history
   summaries derived from existing timeline/detail data.
5. Place the active project plan in the main workspace directly below the
   current goal, with compact progress and next-step summary.
6. Add a derived "next action" line in the main workspace from existing
   goal/plan/gate/verification state.
7. Expand the existing deterministic `handleCommand()` to the allowlisted
   command families in §3.
8. Keep safety buttons for plan approval, gate approval, cancel confirmation,
   and verification confirmation.
9. Simplify the extension panel into a compact bridge composer/status surface
   only if it can be done without new content-script capability.
10. Update UI tests to assert command-first structure and preserved safety
   boundaries.

Forbidden:

- Any new backend route or endpoint.
- Any generic command/shell/exec/run path.
- Any new model API dependency for intent parsing.
- Any change to goal/review/verification server semantics.
- Any auth, token, project-root, GitHub token, runner permission, or audit
  behavior change.
- Any feature expansion beyond existing controlled actions.
- Any visual redesign that leaves the old feature-navigation model as the main
  workflow.
- Any new conversation/thread storage, private session-file import, shell-history
  import, or automatic terminal transcript capture.

## 6. Allowed files for EX-2.20-1

- `apps/local-server/src/routes/project-console.ts`
- `apps/extension/src/ui/bridge-panel.tsx`
- `apps/extension/src/ui/state.ts` only if needed for labels/status shape
- `tests/project-console-ui.test.mjs`
- `tests/project-console-behavior.test.mjs` only if existing behavior assertions
  need to follow the UI reshaping
- `tests/extension-build.test.mjs`
- `CHANGELOG.md`

Anything else -> STOP and report.

## 7. Test requirements

Minimum tests for `EX-2.20-1`:

1. Project console HTML exposes one primary command composer and transcript-like
   workspace as first-class elements.
2. Left rail exposes recent session + project-owned history affordances, not
   feature-section navigation as the primary workflow.
3. Active project plan appears in the main workspace below the current goal;
   plan is not represented as a primary left-nav destination.
4. A derived next-action affordance appears from existing state and does not
   introduce new backend behavior.
5. Old section navigation (`#section-nav`, `data-view`, click/keydown tab
   routing) must be absent; context is reached through composer commands and
   rendered inline without hiding goal/plan/timeline.
6. `handleCommand()` remains allowlisted and deterministic:
   - goal creation passes `projectId: store.activeProjectKey`;
   - `plan` routes to `/bridge/goals/plan`;
   - `continue` routes to `/bridge/goals/step`;
   - `approve plan` routes to `/bridge/goals/approve`;
   - `approve gate` routes to `/bridge/goals/gate` only for an existing blocked
     gate;
   - `status` is read-only;
   - `recent` / `history` / `plan history` are read-only UI focus/context
     commands;
   - unknown command shows help/fail-closed behavior.
7. History rendering is derived only from existing project timeline/detail data;
   no private session-file, shell-history, automatic terminal transcript, or new
   transcript persistence path appears.
8. The no-generic-command invariant remains green:
   `/exec`, `/shell`, `/run`, generic `/command`, `spawn(`, `execFile(`,
   `child_process`, `requestSubmit`, and raw CLI strings are absent from the
   client HTML.
9. Existing pairing-token discipline remains green.
10. Extension build test remains green if the extension panel is touched.
11. No new endpoint strings appear outside the existing allowlist.

## 8. Verification commands

`EX-2.20-1` must run and report:

- `npm run typecheck`
- `npm run lint`
- `node --test tests/project-console-ui.test.mjs`
- `node --test tests/project-console-behavior.test.mjs` if touched or affected
- `node --test tests/extension-build.test.mjs` if extension files are touched
- `npm test`
- `git diff --check`

## 9. Acceptance conditions for REVIEW-2.20-1

1. The main console workflow is command-first: composer + transcript/status are
   primary, feature sections are context surfaces rather than the main path.
2. The left rail is recent-session + project-owned conversation history, not a
   feature navigation rail.
3. Active project plan is visible in the main workspace directly below the
   current goal, with compact progress and next-step summary.
4. The UI exposes one derived next action without hiding explicit safety gates.
5. The first slice is still a thin client over existing server state and gates.
6. No new backend capability, endpoint, execution path, auth behavior, or model
   parser is introduced.
7. All safety-critical gates remain explicit and discoverable.
8. Deterministic command routing covers the required command families and fails
   closed on unknown/ambiguous commands.
9. Conversation history is project-scoped and derived from existing timeline
   data only; no private session or terminal history capture is introduced.
10. Existing project isolation and pairing-token discipline remain unchanged.
11. Tests in §7 are present and passing; full verification suite green;
   `git diff --check` clean.
12. One dedicated `EX-2.20-1` diff; no commit/push until `REVIEW-2.20-1`
   authorizes.

## 10. Handoff prompt for EX-2.20-1

> Implement only the v2.20 command-first middle-layer UI reset. Do not add any
> backend route, endpoint, model parser, generic command runner, shell/exec/run
> path, auth change, or new workflow capability.
>
> The goal is to make `/console/project` feel command-first: one primary
> composer, transcript/status as the main workspace, and feature sections moved
> into inline or command-addressable context surfaces rather than a persistent
> right-side feature panel. The left rail must be recent-session +
> project-owned conversation history, not feature-section navigation. Keep the
> UI as a thin client over the existing bridge endpoints and server-owned gates.
> Use a quiet, utilitarian, text-first layout. The main workspace order is:
> current project/goal, active project plan summary, current/next step, derived
> next action, transcript/timeline, command composer. The plan must live in the
> main workspace under the current goal, not in left navigation or a separate
> feature page.
>
> Required command handling is deterministic and allowlisted: plain text creates
> a project-scoped goal; `plan` generates a plan for the active draft goal;
> `continue` runs the next approved/executing step; `approve plan` approves the
> active awaiting-approval plan; `approve gate` approves the single current
> blocked gate if present; `cancel` uses explicit confirmation; `status`,
> `audit`, `memory`, `teams`, `apply`, and `verify` render read-only or existing
> controlled context; `recent` focuses the recent-session affordance; `history`
> shows the active project's existing timeline-derived conversation history;
> `plan history` shows historical plan entries from existing project data;
> `switch project <key>` switches to an existing project. Unknown or ambiguous
> commands fail closed with short guidance.
>
> Keep buttons only for Connect/auth, safety gates, cancel confirmation,
> verification confirmation, and disambiguation. Do not leave section-clicking
> as the primary workflow. Do not use decorative dashboard cards, nested cards,
> oversized hero areas, or feature-button grids.
>
> Allowed files: `apps/local-server/src/routes/project-console.ts`,
> `apps/extension/src/ui/bridge-panel.tsx`, `apps/extension/src/ui/state.ts`
> only if needed, `tests/project-console-ui.test.mjs`,
> `tests/project-console-behavior.test.mjs` only if affected,
> `tests/extension-build.test.mjs`, and `CHANGELOG.md`. Anything else requires
> stopping and reporting.
>
> Tests must prove command-first structure, deterministic allowlisted routing,
> left rail as recent-session + project-owned history rather than feature nav,
> active plan placement under current goal, derived next-action display,
> no private session/shell-history/terminal transcript capture, no generic
> command/shell/exec/run path, unchanged pairing-token discipline, and no new
> endpoint strings outside the existing allowlist. Run typecheck, lint, the
> touched console/extension suites, `npm test`, and `git diff --check`.

## 11. Status / next

RP-2.20 records the UI direction and an executable first slice. The
pre-implementation UX validation gate is recorded in
`docs/reviews/CLI-BRIDGE-v2.20-UX-VALIDATION-GATE.md`; `EX-2.20-1` should treat
that file and this RP plan as the UX contract. This document does not dispatch
implementation by itself. The next action is an explicit human trigger for
`EX-2.20-1`, followed by `REVIEW-2.20-1`.
