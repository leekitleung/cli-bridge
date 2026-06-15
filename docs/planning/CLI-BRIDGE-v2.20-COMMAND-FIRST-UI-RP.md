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
3. Move current section content behind command-addressable rendering or compact
   collapsed context surfaces.
4. Expand the existing deterministic `handleCommand()` to the allowlisted
   command families in §3.
5. Keep safety buttons for plan approval, gate approval, cancel confirmation,
   and verification confirmation.
6. Simplify the extension panel into a compact bridge composer/status surface
   only if it can be done without new content-script capability.
7. Update UI tests to assert command-first structure and preserved safety
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
2. Old section names may exist as context labels, but tests must prove they are
   not the primary workflow path.
3. `handleCommand()` remains allowlisted and deterministic:
   - goal creation passes `projectId: store.activeProjectKey`;
   - `plan` routes to `/bridge/goals/plan`;
   - `continue` routes to `/bridge/goals/step`;
   - `approve plan` routes to `/bridge/goals/approve`;
   - `approve gate` routes to `/bridge/goals/gate` only for an existing blocked
     gate;
   - `status` is read-only;
   - unknown command shows help/fail-closed behavior.
4. The no-generic-command invariant remains green:
   `/exec`, `/shell`, `/run`, generic `/command`, `spawn(`, `execFile(`,
   `child_process`, `requestSubmit`, and raw CLI strings are absent from the
   client HTML.
5. Existing pairing-token discipline remains green.
6. Extension build test remains green if the extension panel is touched.
7. No new endpoint strings appear outside the existing allowlist.

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
2. The first slice is still a thin client over existing server state and gates.
3. No new backend capability, endpoint, execution path, auth behavior, or model
   parser is introduced.
4. All safety-critical gates remain explicit and discoverable.
5. Deterministic command routing covers the required command families and fails
   closed on unknown/ambiguous commands.
6. Existing project isolation and pairing-token discipline remain unchanged.
7. Tests in §7 are present and passing; full verification suite green;
   `git diff --check` clean.
8. One dedicated `EX-2.20-1` diff; no commit/push until `REVIEW-2.20-1`
   authorizes.

## 10. Handoff prompt for EX-2.20-1

> Implement only the v2.20 command-first middle-layer UI reset. Do not add any
> backend route, endpoint, model parser, generic command runner, shell/exec/run
> path, auth change, or new workflow capability.
>
> The goal is to make `/console/project` feel command-first: one primary
> composer, transcript/status as the main workspace, and feature sections moved
> into compact context surfaces. Keep the UI as a thin client over the existing
> bridge endpoints and server-owned gates.
>
> Required command handling is deterministic and allowlisted: plain text creates
> a project-scoped goal; `plan` generates a plan for the active draft goal;
> `continue` runs the next approved/executing step; `approve plan` approves the
> active awaiting-approval plan; `approve gate` approves the single current
> blocked gate if present; `cancel` uses explicit confirmation; `status`,
> `audit`, `memory`, `teams`, `apply`, and `verify` render read-only or existing
> controlled context; `switch project <key>` switches to an existing project.
> Unknown or ambiguous commands fail closed with short guidance.
>
> Keep buttons only for Connect/auth, safety gates, cancel confirmation,
> verification confirmation, and disambiguation. Do not leave section-clicking
> as the primary workflow.
>
> Allowed files: `apps/local-server/src/routes/project-console.ts`,
> `apps/extension/src/ui/bridge-panel.tsx`, `apps/extension/src/ui/state.ts`
> only if needed, `tests/project-console-ui.test.mjs`,
> `tests/project-console-behavior.test.mjs` only if affected,
> `tests/extension-build.test.mjs`, and `CHANGELOG.md`. Anything else requires
> stopping and reporting.
>
> Tests must prove command-first structure, deterministic allowlisted routing,
> no generic command/shell/exec/run path, unchanged pairing-token discipline,
> and no new endpoint strings outside the existing allowlist. Run typecheck,
> lint, the touched console/extension suites, `npm test`, and `git diff --check`.

## 11. Status / next

RP-2.20 records the UI direction and an executable first slice. It does not
dispatch implementation by itself. The next action is an explicit human trigger
for `EX-2.20-1`, followed by `REVIEW-2.20-1`.
