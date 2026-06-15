# CLI Bridge v2.20 — Command-First UI UX Validation Gate

**Status**: UX VALIDATION GATE — target design ready for `EX-2.20-1` with the
constraints below. This document validates the intended experience, not the
current implemented UI.
**Date**: 2026-06-15
**Batch**: `UX-2.20` pre-implementation review for `RP-2.20` ->
`EX-2.20-1`
**Scope**: `/console/project` middle-layer UI information architecture,
interaction flow, project-plan placement, command-first usage, and safety-gate
visibility.

---

## 0. Verdict

The target v2.20 command-first UI direction is valid for implementation as a
bounded `EX-2.20-1` slice.

The current implemented console should be treated as failing this UX gate
because it still behaves like a feature cockpit: left feature navigation,
cards/sections as primary destinations, and a secondary command bar. `EX-2.20-1`
should optimize the existing console toward the target layout without adding
backend capability.

## 1. UX success criteria

The target UI passes only if all checks are true:

1. The first thing the operator can identify is the active project.
2. The main workspace order is:
   current goal -> active project plan -> current/next step -> next action ->
   transcript/timeline -> command composer.
3. The active project plan is visible under the current goal, not hidden in
   left navigation or a separate feature page.
4. Every state exposes one primary next action.
5. The left rail is recent session + projects + project-owned history, not
   feature navigation.
6. Reviews, prompts, audit, memory, verification, tasks, and teams are context
   surfaces or command-addressable views, not primary workflow tabs.
7. Safety gates are explicit but not noisy: approval/cancel/verification
   confirmations appear inline at the relevant step.
8. No new backend endpoint, command runner, auth behavior, model parser,
   conversation storage, private session import, shell-history import, or
   terminal transcript capture is introduced.

## 2. Target first-use flow

| Step | User sees first | Expected action | UX requirement |
| --- | --- | --- | --- |
| Connect | Active project placeholder, auth status, disabled composer or connect prompt | Enter pairing token and connect | Token flow remains visible but not the product center |
| First project state | Project strip, empty current goal, empty plan area | Type a goal as plain text | Empty state gives one operational next command |
| Goal created | Current goal appears, plan area says draft/no plan | `plan` | Plan placement is immediately discoverable |
| Plan ready | Plan summary under goal, approval gate inline | `approve plan` or approval control | Gate is explicit and local to the plan |
| Execution | Next step and transcript update | `continue` | User does not need feature navigation |

## 3. Target return-use flow

| Step | User sees first | Expected action | UX requirement |
| --- | --- | --- | --- |
| Reopen console | Recent session at top left, active project restored, current goal/plan in center | Inspect or type `status` | Fast orientation within seconds |
| Resume old project | Project-owned history visible under the project | Select project or `switch project <key>` | History belongs to project, not global feature tabs |
| Continue work | Main workspace shows next action | `continue`, `approve gate`, `verify`, or `plan` | One primary next action is obvious |
| Review context | Recent timeline and project history are visible | `history`, `plan history`, `audit`, or `verify` | Context is command-addressable without becoming main nav |

## 4. Scenario validation matrix

| Scenario | What user sees first | Expected command/action | Single primary next action | Plan visible under goal? | Works without feature nav? | Gate behavior |
| --- | --- | --- | --- | --- | --- | --- |
| No active goal | Active project, empty current goal, empty plan area, recent project timeline | Type natural-language goal | Create goal | Yes, as empty plan placeholder | Yes | None |
| Draft goal waiting for plan | Current goal with draft status; plan area says no plan yet | `plan` | Generate plan | Yes | Yes | None |
| Plan awaiting approval | Goal + plan summary + step count + approval state | `approve plan` or inline approval | Approve plan | Yes | Yes | Inline approval only |
| Executing plan with next step | Goal + approved/executing plan + current/next step | `continue` | Run next step | Yes | Yes | None unless next step is mutating |
| Blocked mutating gate | Goal + plan + blocked step highlighted | `approve gate` or inline gate approval | Approve gate | Yes | Yes | Explicit, local to blocked step |
| Verification failure | Goal + plan + failed verification fact near the affected step | `verify` or inspect failure context | Inspect/trigger existing verification control | Yes | Yes | Verification confirmation remains explicit |
| Returning to old project | Recent session + project list + project-owned history | Select project or `switch project <key>` | Resume selected project | Yes after project selection | Yes | Shows any active gate inline |
| Switching projects | Left rail project list, active project strip updates on selection | Select project or `switch project <key>` | Show selected project state | Yes for selected project | Yes | No cross-project gate leakage |

## 5. Layout validation

### Left rail

Pass condition:

- Top item is at most one recent-session affordance.
- Project list is the primary navigation.
- Each project can reveal project-owned history from existing timeline/detail
  data.
- Feature areas are not left-nav tabs.

Fail condition:

- Left rail contains Reviews/Prompts/Audit/Memory/Verification/Tasks/Team as
  primary tabs.
- History is global and detached from project ownership.
- Recent session becomes a separate inbox that competes with project context.

### Main workspace

Pass condition:

- Current goal is visible first.
- Active project plan is directly below the current goal.
- Plan summary shows status, next step, progress, and blocked gate if present.
- One next action appears before the timeline.
- Timeline is still available but does not push goal/plan below the fold.

Fail condition:

- Plan is hidden behind a section/tab.
- User must inspect multiple panels to know the next action.
- Timeline appears as a generic chat log with no goal/plan state anchoring.

### Inline facts

Pass condition:

- Shows compact facts inline with the relevant goal, plan, step, or timeline
  item: gate, verification, audit count, latest event.
- Does not introduce a persistent right-side feature panel as the default
  workflow.
- Does not become the main control surface.

Fail condition:

- Right side repeats large cards or competes with the command workspace.
- Facts imply unavailable backend data exists.
- Token or raw sensitive data appears as visible text.

### Command composer

Pass condition:

- Composer is always the primary action entry.
- Natural-language task text creates a project-scoped goal.
- Short commands route deterministically to existing controlled actions.
- Unknown commands fail closed with help.

Fail condition:

- Composer is visually secondary to buttons.
- Commands imply arbitrary shell/exec/run capability.
- Ambiguous state-changing commands guess a target.

## 6. Command validation

| Command | Target behavior | UX result | Boundary |
| --- | --- | --- | --- |
| Plain task text | Create project-scoped goal | Starts work without choosing a feature | Existing goal endpoint only |
| `plan` | Generate plan for active draft goal | Plan appears under goal | Existing plan endpoint only |
| `approve plan` | Approve active awaiting plan | Plan state advances | Explicit approval gate |
| `continue` | Run next approved/executing step | Step advances | Existing step endpoint only |
| `approve gate` | Approve exactly one blocked gate | Mutating step may proceed | Explicit gate; fail closed if ambiguous |
| `status` | Render current project/goal/verification state | Read-only orientation | No mutation |
| `history` | Show active project timeline-derived history | Project context recovery | Existing data only |
| `plan history` | Show historical plan entries from existing project data | Planning continuity | Existing data only |
| `verify` | Show verification context and existing controls | Failure recovery | Existing verification confirmations |
| `switch project <key>` | Switch to existing project | Context changes visibly | No cross-project leakage |

## 7. UX risks to carry into EX-2.20-1

1. **Synthetic conversation risk**: existing timeline is activity-derived, not a
   true message store. UI copy must avoid pretending it is full chat history.
2. **Next-action overreach**: derived next action must only summarize existing
   state. It must not decide product or architecture direction.
3. **Plan visibility vs density**: plan must be visible without expanding into
   a table-heavy dashboard by default.
4. **Recent session ambiguity**: recent session must not override the active
   project or create a second source of truth.
5. **Feature context discoverability**: removing feature tabs is correct, but
   context commands must make `audit`, `verify`, `history`, and `plan history`
   discoverable.

## 8. Acceptance checklist for EX-2.20-1 review

- [ ] Left rail is recent session + project-owned history, not feature tabs.
- [ ] Active project is always visible.
- [ ] Current goal is first in the main workspace.
- [ ] Active plan is directly below the current goal.
- [ ] One next action appears from existing state.
- [ ] Timeline/history is project-scoped and activity-derived.
- [ ] Safety gates are explicit and inline.
- [ ] Command composer is visually and functionally primary.
- [ ] Old feature sections are context surfaces, not primary navigation.
- [ ] No new backend capability or endpoint appears.
- [ ] No generic command/shell/exec/run path appears.
- [ ] No private session, shell-history, or automatic terminal transcript capture appears.
- [ ] Pairing-token discipline remains unchanged.

## 9. Recommendation

Proceed to `EX-2.20-1` only if the execution agent treats this document and
`CLI-BRIDGE-v2.20-COMMAND-FIRST-UI-RP.md` as the UX contract. The implementation
should be judged primarily by whether the eight scenario states expose one
obvious next action without feature navigation.
