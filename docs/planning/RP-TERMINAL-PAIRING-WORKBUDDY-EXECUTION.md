# RP-TERMINAL-PAIRING-WORKBUDDY-EXECUTION

**Status**: Draft v2 — revised per review feedback (2026-06-29)
**Type**: RP (Review/Planning) — document only, no code changes
**Date**: 2026-06-29
**Prepared by**: WorkBuddy (planning agent)
**Revision**: Applied review patch — see §11 Changelog

---

## 1. Context

### 1.1 What we have today

CLI Bridge currently uses an **per-plan binding model**. When creating a plan,
the operator manually selects a reasoning endpoint and an execution endpoint.
The resulting `RunEndpointBinding` is locked at plan approval time and cannot
be changed mid-run. This is correct for the plan lifecycle, but it creates
friction at project and goal scope — every goal/plan starts from scratch with
no default pairing.

The current WorkBuddy identity is defined as:

| Artifact | Statement |
|----------|-----------|
| `provider-capability.ts:93` | `canExecute: false` — "non-executing task source/result sink" |
| `schemas.ts:1117` | `'WorkBuddy cannot be an executor'` — hard schema rejection |
| ADR-0003 §7 | "WorkBuddy MUST NOT trigger execution, MUST NOT bypass plan approval" |
| ADR-0024 §6 | "Current WorkBuddy identity remains non-executing. A future WorkBuddy execution route requires a separately registered endpoint identity, a bounded adapter, capability evidence, focused tests, and explicit ADR amendment or replacement." |
| `bridge-workbuddy-api.md` | "All mutations are strictly non-executing" |
| Console UI | Labeled "Non-executing" |

This was the correct boundary for v2.2. It is now the starting point, not the
target state.

### 1.2 What we're changing

The fundamental driver: **pairing should bind to the project's default
collaboration structure, not to each individual conversation.** The user
should choose a default team once per project, then every goal and plan
derives from that preset.

Three architectural shifts:

1. **WorkBuddy upgrades** from "non-executing sink" to "optional execution
   endpoint" — behind full middle-layer gating, never self-authorizing.

2. **Pairing becomes a layered lifecycle**, not a one-shot per-plan choice:
   ```
   Project preset → Goal binding snapshot → Plan locked binding → Step proposal
   ```

3. **Terminal-terminal pairing** is mediated entirely by the middle-layer
   endpoint registry. Terminals register capabilities but never directly
   control each other.

### 1.3 Why now

The project has accumulated the necessary foundations:
- `RunEndpointBinding` with immutable hash + locked-at semantics (ADR-0024)
- `ExecutionProposal` with confirmation workflow
- `InMemoryEndpointRegistry` with capability validation
- `ProviderCapabilityDeclaration` with static provider metadata
- Goal/Plan/PlanStep state machine
- The console-based per-step gate

The missing pieces are project-level defaults, goal-scoped snapshots, and a
WorkBuddy execution transport. These are natural extensions of existing
abstractions, not a new system.

---

## 2. Current State Baseline

### 2.1 Endpoint registry

```ts
// apps/local-server/src/endpoints/endpoint-registry.ts
class InMemoryEndpointRegistry {
  register(endpoint: AgentEndpoint): EndpointRegistryResult;
  get(endpointId: string): AgentEndpoint | undefined;
  list(): AgentEndpoint[];
  can(endpointId: string, action: EndpointAction): boolean;
  validateAction(endpointId: string, action: EndpointAction): EndpointRegistryResult;
}
```

Endpoints are statically defined in `mock-endpoints.ts`. No runtime
registration, no heartbeat, no offline detection, no `projectRef`.

### 2.2 AgentEndpoint type

```ts
// packages/shared/src/types.ts:580-588
type AgentEndpoint = {
  id: string;
  label: string;
  transport: 'mock' | 'clipboard' | 'command' | 'managed-pty' | 'file-protocol' | 'web-dom';
  risk: 'low' | 'medium' | 'high' | 'experimental';
  capabilities: AgentEndpointCapabilities;
  adapterName?: string;
  experimental?: boolean;
};
```

Missing: `projectRef`, `status` (online/offline/busy), `lastSeenAt`. Transport
union does not include `'terminal'` or `'workbuddy'`. No new capability fields
are needed — existing `canReview`/`canSummarize`/`canExecute` cover planner
and verifier role selection; roles are determined by the preset binding, not by
additional capability bits.

### 2.3 Provider capabilities

`KNOWN_PROVIDER_CAPABILITIES.workbuddy`:
- `canExecute: false`, `canReview: false`, `canProposePatch: false`, `canVerify: false`
- `description: 'WorkBuddy — non-executing task source/result sink'`

`validateProviderCapability()` rejects any provider where `canExecute === false`
with `'Provider workbuddy cannot execute'`.

### 2.4 RunEndpointBinding

```ts
// packages/shared/src/types.ts:716-735
interface RunEndpointBinding {
  goalId: string;
  planId: string;
  parentPlanId?: string;
  reasoningEndpointId: string;
  executionEndpointId: string;
  reasoningEndpoint: RunEndpointBindingEndpointRef;
  executionEndpoint: RunEndpointBindingEndpointRef;
  reasoningTier: AutomationReasoningTier;       // 'high'
  executionTier: AutomationExecutionTier;        // 'medium' | 'low'
  executionPermissionProfile: string;
  executionWorkingDirectoryRef: string;
  maxSteps: number;
  maxReasoningRounds: number;
  deadlineAt: string;
  createdAt: number;
  updatedAt: number;
  bindingHash: string;
  lockedAt?: number;
}
```

This is per-plan. No goal-scoped snapshot exists. No project-preset reference.
`RunEndpointBindingEndpointRef` has only `id`, `label`, `transport`, and
`capabilities.canExecute` — not the full capability set.

### 2.5 Pairing authentication

`pairing.ts` provides token-based auth: `createPairingToken()` generates
32-char hex, `verifyPairingToken()` uses `timingSafeEqual`. This is a raw
authentication token — it is NOT a pairing concept in the Team Preset sense.

### 2.6 Execution dispatch

`execution-dispatcher.ts` validates proposals against bindings and runs them
through `command-runner.ts`. Dispatched commands go to `codex` or `claude` CLI
processes directly (synchronous spawn). There is no pull-based inbox and no
WorkBuddy adapter.

### 2.7 WorkBuddy integration

`/bridge/projects/:key/workbuddy` is a non-executing task system with four
record types: `record-task`, `record-review-result`, `record-prompt-draft`,
`record-ledger`. All mutations are explicitly non-executing. No execution
lifecycle integration.

---

## 3. Decision

### 3.1 WorkBuddy upgrades to optional execution endpoint

The sentence "WorkBuddy cannot execute" is now **historical state**, not a
forward boundary.

WorkBuddy becomes a registered execution endpoint with **target capabilities** (all
currently `false`; transitioning to `true` in EX-4):
- `canExecute: true` — in the provider capability declaration
- `canReview: true` — for review roles in team presets
- `canVerify: true` — for verification roles in team presets
- `canReturnOutput: true` — via structured inbox/result protocol
- `transport: 'workbuddy'` — new transport type for pull-based execution
- canonical endpoint id: `workbuddy` — the existing provider capability id,
  command syntax, preset storage, binding snapshots, and UI must all use this id.
  Do not introduce a parallel `workbuddy-executor` id unless a later ADR
  explicitly migrates every provider/binding/UI reference together.

This upgrade is **gated behind**:
1. An endpoint registry that supports runtime registration/heartbeat/offline
2. A pull-based inbox/result protocol (WorkBuddy pulls tasks; it doesn't
   receive pushes from the middle layer)
3. The full middle-layer gating chain (proposal → confirm → dispatch → audit)

WorkBuddy MUST NOT:
- Self-confirm proposals
- Modify bindings
- Choose its own project root
- Output unstructured results

### 3.2 Pairing lifecycle: four layers

```
Layer 1: Project Team Preset — saved per-project, editable, affects NEW goals only
  ↓ copy at goal creation
Layer 2: Goal Binding Snapshot — immutable after creation, rebind-able before plan approval
  ↓ generate plan
Layer 3: Plan Locked Binding — hash-locked at approval, no rebind, derive-only
  ↓ create proposal
Layer 4: Step Proposal — single-use confirmation, endpoint from locked binding
```

#### Layer 1 — Project Team Preset

```ts
interface ProjectTeamPreset {
  projectId: string;
  plannerEndpointId: string;
  executorEndpointId: string;
  verifierEndpointId?: string;
  mode: 'sequential';
  isolation: 'patch-only';
  updatedAt: number;
}
```

- Stored per-project, persisted alongside project data.
- API: `GET /bridge/projects/:key/team-preset`, `PUT /bridge/projects/:key/team-preset`.
- Composer commands: `pair status`, `pair planner X executor Y`, `pair reset`.
- Changing the preset does NOT retroactively affect existing goals.
- Only endpoints with matching capabilities pass validation (executor must have
  `canExecute: true`).

#### Layer 2 — Goal Binding Snapshot

When a goal is created:
- If the project has a preset → snapshot is auto-created from preset.
- If no preset → goal created without snapshot; `pair` command required.
- The snapshot is **versioned**: before plan approval, the operator may issue
  `rebind` to create a new snapshot version (audited replacement, not silent
  mutation). The old version is retained for audit.
- `rebind executor workbuddy` / `rebind planner claude-code-command` create a
  new versioned snapshot record and audit entry. The original snapshot's
  `source: 'project-preset'` is preserved; the replacement's source becomes
  `'manual-rebind'`.
- After plan approval, rebind is FORBIDDEN — the locked binding is the
  authoritative snapshot version for that plan.

```ts
interface GoalBindingSnapshot {
  snapshotId: string;
  goalId: string;
  version: number;
  plannerEndpointId: string;
  executorEndpointId: string;
  verifierEndpointId?: string;
  mode: 'sequential';
  isolation: 'patch-only';
  source: 'project-preset' | 'manual' | 'manual-rebind';
  parentSnapshotId?: string;  // for rebind lineage
  createdAt: number;
}
```

#### Layer 3 — Plan Locked Binding

Unchanged from current ADR-0024 semantics. When a plan is created from a goal
with a snapshot, the binding locks at approval:

```text
approve plan → bindingHash computed, lockedAt set
rebind is FORBIDDEN after lock
change requires derive (parentPlanId)
```

#### Layer 4 — Step Proposal

Unchanged from current ADR-0024 §5 semantics. Every execution dispatch requires
a one-time human confirmation. The confirmation card shows binding identity,
step, proposal preview, and remaining limits. Confirmation is single-use and
bound to `planId + stepId + proposalId + contentHash + bindingHash`.

### 3.3 Terminal-terminal pairing is mediated

Terminals do not directly control each other. The interaction model:

```text
Terminal A (Claude Code) → registers at middle layer → capabilities known
Terminal B (WorkBuddy)   → registers at middle layer → capabilities known
Middle layer             → pairs A as planner, B as executor in project preset
                         → creates binding snapshot at goal creation
                         → locks binding at plan approval
                         → enqueues task to B's inbox at step execution
Terminal B               → pulls task from its inbox
                         → returns structured result to middle layer
Middle layer             → records audit, advances plan state
```

### 3.4 Endpoint transport hierarchy

New transport type: `'workbuddy'` — pull-based terminal inbox.

The transport union becomes:
```ts
type AgentEndpointTransport =
  | 'mock' | 'clipboard' | 'command' | 'managed-pty'
  | 'file-protocol' | 'web-dom'
  | 'terminal'      // new: generic terminal endpoint (non-WorkBuddy)
  | 'workbuddy';    // new: WorkBuddy pull-based endpoint
```

### 3.5 Forbidden behaviors (non-negotiable)

This section lists what the new system MUST NOT allow. These are hard
boundaries, not "best effort."

| # | Forbidden behavior | Enforcement |
|---|-------------------|-------------|
| F1 | Terminals directly controlling other terminals | Architecture: all interaction through middle layer |
| F2 | WorkBuddy self-confirming proposals | Confirmation is a console-only action |
| F3 | WorkBuddy modifying bindings | Bindings are server-authoritative, not client-writable |
| F4 | WorkBuddy choosing its own project root | `executionWorkingDirectoryRef` is server-resolved |
| F5 | Automatic execution without human confirmation | Per ADR-0024 §5, every execution requires confirmation |
| F6 | Generic shell/exec/run HTTP endpoints | No new `/exec` or `/shell` routes |
| F7 | Mid-run endpoint replacement (rebind after lock) | `lockedAt` check on all rebind operations |
| F8 | Project preset change retroactively affecting goals | Snapshots isolate goals from preset changes |
| F9 | Persisting raw unredacted content | Existing redaction rules unchanged |
| F10 | WorkBuddy output accepted without schema validation | Result schema validator rejects malformed returns |
| F11 | Offline endpoint selected as executor | Capability check includes online status |
| F12 | Secret/token persistence at rest | Endpoint registry does not store credentials |

---

## 4. Architectural Impact

### 4.1 ADRs that need amendment

| ADR | Current statement | Change |
|-----|-------------------|--------|
| ADR-0003 §7 | WorkBuddy "MUST NOT trigger execution, MUST NOT bypass plan approval, MUST NOT become a controller" | Keep MUST NOT bypass/must-not-controller. Remove MUST NOT trigger execution — instead, WorkBuddy may execute *through the middle layer only*. Add: "WorkBuddy execution is mediated by the controlled execution layer (this ADR) and subject to all gates, confirmations, and audit." |
| ADR-0024 §6 | "Current WorkBuddy identity remains non-executing. A future WorkBuddy execution route requires a separately registered endpoint identity..." | Now is that future. The separately registered endpoint identity is canonical endpoint id `workbuddy`, registered through the endpoint registry with bounded adapter, capability evidence, focused tests. This ADR amendment is the explicit authorization. |

### 4.2 New ADR

This document is the planning input for a new ADR (will be numbered after
acceptance) covering terminal pairing and WorkBuddy execution.

### 4.3 Non-ADRs that need update

| Document | Change |
|----------|--------|
| `README.md` | Update security boundaries section: WorkBuddy execution is gated, not forbidden |
| `docs/contracts/bridge-workbuddy-api.md` | Add inbox/result endpoints, mark old non-executing boundary as historical |
| `CHANGELOG.md` | Entry for WorkBuddy execution upgrade |

---

## 5. Affected Code — Inventory (No Changes Here)

This section enumerates every file and test that will be touched in EX
phases. This is a **read-only inventory** — no code is changed in this RP.

### 5.1 Core types and schemas (EX-1 through EX-4)

| File | What changes |
|------|-------------|
| `packages/shared/src/types.ts` | Add `'terminal'` and `'workbuddy'` to transport union; add `ProjectTeamPreset`, `GoalBindingSnapshot`, `EndpointSession` types; extend `AgentEndpoint` with `projectRef`, `status`, `lastSeenAt` |
| `packages/shared/src/schemas.ts` | Add validators for new types; remove line 1117 `'WorkBuddy cannot be an executor'` rejection; add schema validation for inbox results |
| `packages/shared/src/constants.ts` | Add route constants for new endpoints |

### 5.2 Endpoint registry (EX-1)

| File | What changes |
|------|-------------|
| `apps/local-server/src/endpoints/endpoint-registry.ts` | Add `heartbeat`, `offline`, `register` with `projectRef`; add status tracking; add `listByProject`, `listOnline` |
| `apps/local-server/src/endpoints/mock-endpoints.ts` | Add WorkBuddy endpoint definition; add heartbeat/status fields |

### 5.3 Provider capabilities (EX-4)

| File | What changes |
|------|-------------|
| `apps/local-server/src/storage/provider-capability.ts` | Set `workbuddy.canExecute = true`, `canReview = true`, `canVerify = true`; update description; adjust `validateProviderCapability` for workbuddy |

### 5.4 Team preset (EX-2)

| File | What changes |
|------|-------------|
| `apps/local-server/src/storage/project-team-preset-store.ts` | **New file** — `InMemoryProjectTeamPresetStore`: CRUD for `ProjectTeamPreset`, snapshot persistence via `exportPresets`/`hydratePreset`, independent of existing `InMemoryTeamSpecStore` in `team-store.ts` |
| `apps/local-server/src/routes/bridge-api.ts` | Add `GET/PUT /bridge/projects/:key/team-preset` routes |
| `apps/local-server/src/routes/project-console.ts` | Add `pair` command handling in the composer (`handleCommand` at L2040); show current default team in project view |
| `apps/local-server/src/routes/console-goals.ts` | Show "will use: X → Y → Z" on goal creation |

### 5.5 Goal binding snapshot (EX-3)

| File | What changes |
|------|-------------|
| `apps/local-server/src/storage/goal-store.ts` | Extend `createGoal` to auto-create snapshot from preset; add `GoalBindingSnapshot` storage |
| `apps/local-server/src/storage/automation-binding-store.ts` | Extend to handle goal-scoped snapshots |
| `apps/local-server/src/goal/goal-orchestrator.ts` | Integrate snapshot into plan creation flow |

### 5.6 WorkBuddy execution adapter (EX-4)

| File | What changes |
|------|-------------|
| `apps/local-server/src/routes/bridge-api.ts` | Add `GET /bridge/endpoints/:id/inbox/next`, `POST /bridge/endpoints/:id/results`, `POST /bridge/endpoints/:id/log` |
| `apps/local-server/src/adapters/workbuddy-execution-adapter.ts` | **New file** — WorkBuddy pull-based execution adapter |
| `apps/local-server/src/execution/execution-dispatcher.ts` | Add WorkBuddy dispatch path (enqueue to inbox vs. direct spawn) |

### 5.7 Console UI (EX-5)

| File | What changes |
|------|-------------|
| `apps/local-server/src/routes/project-console.ts` | Add online endpoints list, project default team, goal binding, execution proposal target views in workspace context |
| `apps/local-server/src/routes/project-ui-theme.ts` | May need minor CSS additions for pairing display |

### 5.8 Tests that WILL change in EX phases

Tests are identified but NOT modified in this RP batch.

| Test file | Current assertion | EX phase | New assertion |
|-----------|-------------------|----------|---------------|
| `tests/provider-capability.test.mjs` | L20: `workbuddy.errors.some(e => e.includes('cannot execute'))` | EX-4 | WorkBuddy passes execution validation; `canExecute: true` |
| `tests/provider-capability.test.mjs` | L9: test name "keeps WorkBuddy non-executing" | EX-4 | Rename: "WorkBuddy registered as execution endpoint" |
| `tests/endpoint-capabilities.test.mjs` | Review endpoints cannot execute | EX-1 | No change (review endpoints stay non-executing) |
| `tests/project-console-ui.test.mjs` | L346-L351: "Non-executing" label check | EX-5 | Change to reflect optional execution capability |
| `tests/workbuddy-state.test.mjs` | L35: "non-executing state" validation | EX-4 | Add execution state paths |
| `tests/bridge-workbuddy-api.test.mjs` | Non-executing mutation tests | EX-4 | Add inbox/result endpoint tests |
| `tests/bridge-teams-api.test.mjs` | L2: "non-executing" comment | EX-1 | Update comment |

### 5.9 Tests that WILL NOT change

| Test file | Reason |
|-----------|--------|
| `tests/command-runner.test.mjs` | Command runner remains codex/claude only; WorkBuddy does not use it |
| `tests/claude-review-handoff.test.mjs` | Claude review endpoint stays non-executing |
| `tests/codex-feasibility-handoff.test.mjs` | Codex feasibility endpoint stays non-executing |

---

## 6. Migration Path — Phase Order

The recommended phase order is enforced by capability dependencies:

```
EX-1 (Endpoint Registry) ── required before ──→ EX-2 (Team Preset)
     │                                              │
     │                                              └── required before ──→ EX-3 (Goal Snapshot)
     │                                                                           │
     └── required before ──→ EX-4 (WorkBuddy Execution) ←── required before ──┘
                                  │
                                  └── required before ──→ EX-5 (Terminal UX)
                                                               │
                                                               └──→ EX-6 (Acceptance Gate)
```

**Critical ordering constraint**: Do NOT change `workbuddy.canExecute = true`
before EX-1 and EX-4 are complete. Without the endpoint registry upgrade and
the inbox/result protocol, declaring execution capability creates a false
promise that the system cannot fulfill. The capability change is in EX-4, not
EX-1.

### Phase summary

| Phase | What | Lines of change (est.) | Risk |
|-------|------|----------------------|------|
| EX-1 | Endpoint session registry | ~300 | Low — additive |
| EX-2 | Project team preset | ~400 | Low — new data model, new routes |
| EX-3 | Goal binding snapshot | ~350 | Medium — touches goal creation flow |
| EX-4 | WorkBuddy execution endpoint | ~500 | High — capability change + new adapter |
| EX-5 | Terminal pairing UX | ~250 | Low — UI only |
| EX-6 | Acceptance gate | ~150 | Low — verification only |

---

## 7. Snapshot Persistence & Migration

### 7.1 Storage location

All preset and snapshot data is persisted in `CLI_BRIDGE_DATA_DIR` (same
directory used by `json-snapshot-store.ts` for goals, plans, projects).

```
CLI_BRIDGE_DATA_DIR/
├── project-team-presets.json     # EX-2: array of ProjectTeamPreset
├── goal-binding-snapshots.json   # EX-3: array of GoalBindingSnapshot
├── goals.json                    # existing
├── plans.json                    # existing
├── projects.json                 # existing
└── ...
```

### 7.2 Fail-closed migration rules

Endpoint session online state from EX-1 is runtime-only. Registered terminal
sessions must re-register after server restart; stale `online`/`busy` state must
not be written to or restored from durable storage.

| Condition | Behavior |
|-----------|----------|
| Preset file missing | Server starts with empty preset store; no error |
| Preset references unknown endpoint | Preset is valid but un-usable; `pair status` shows warning; goal creation uses `no preset` path |
| Preset references offline endpoint | Same as unknown endpoint: goal creation falls back, `pair status` shows "offline" |
| Snapshot references endpoint not in registry | Snapshot loads but validator rejects plan creation with that snapshot |
| Snapshot missing `version` field (pre-versioning) | Hydrate as version 1, source `'project-preset'` |
| Snapshot has duplicate `snapshotId` | Keep newest by `createdAt`; log duplicate |
| Preset file corrupted (invalid JSON) | Skip the file, start with empty store, log warning |
| Goal has snapshots but no preset | Normal — manual mode; no error |
| Server restarts with previously registered endpoint sessions | Sessions are absent/offline until terminal re-registration |

### 7.3 Hydration order

1. Load built-in/static endpoints from registry (EX-1); runtime session endpoints
   are not hydrated as online
2. Load project team presets (EX-2)
3. Load goal binding snapshots (EX-3)
4. Validate cross-references (endpoint exists, goal exists, project exists)

Invalid cross-references are **skipped** (fail-open) — the server starts, but
the affected preset/snapshot is unavailable. The operator sees a warning in
`pair status`.

---

## 8. Command Acceptance Tests (pair / rebind / binding)

These are the canonical command behaviors. Implementation must satisfy all of
them; EX-5 deduplication against these is fine.

### 8.1 `pair status`

```text
GIVEN a project with a team preset
WHEN  operator enters "pair status"
THEN  console shows:
        Planner:  claude-code-command (online)
        Executor: workbuddy (online)
        Verifier: codex-command (online)
        Mode:     sequential / isolation: patch-only

GIVEN a project without a team preset
WHEN  operator enters "pair status"
THEN  console shows:
        No default team preset for this project.
        Use "pair planner X executor Y" to set one.

GIVEN a project where preset's executor is offline
WHEN  operator enters "pair status"
THEN  console shows executor as "offline" with warning icon
```

### 8.2 `pair planner X executor Y`

```text
GIVEN online endpoints claude-code-command, workbuddy, codex-command
WHEN  operator enters "pair planner claude-code-command executor workbuddy"
THEN  team preset is saved/updated
AND   console shows confirmation: "Default team: Claude → WorkBuddy"

GIVEN endpoint codex-command has canExecute=false
WHEN  operator enters "pair planner claude-code-command executor codex-command"
THEN  rejected: "codex-command cannot execute"

GIVEN endpoint workbuddy is offline
WHEN  operator enters "pair planner claude-code-command executor workbuddy"
THEN  accepted with warning: "workbuddy is offline; execution will be blocked"

WHEN  operator enters "pair planner claude-code-command executor workbuddy verifier codex-command"
THEN  all three roles are set
```

### 8.3 `pair reset`

```text
GIVEN a project with a team preset
WHEN  operator enters "pair reset"
THEN  preset is cleared
AND   console shows: "Default team preset removed. Existing goals unchanged."
AND   existing goal snapshots are NOT affected
```

### 8.4 `rebind` (goal scope)

```text
GIVEN a goal with binding snapshot v1 (planner: claude, executor: codex)
AND   no plan has been created yet
WHEN  operator enters "rebind executor workbuddy"
THEN  snapshot v2 is created (source: 'manual-rebind', parent: v1.snapshotId)
AND   console shows: "Executor changed: codex → workbuddy (snapshot v2)"
AND   v1 is retained in audit

GIVEN a goal with binding snapshot v1
AND   a plan has been approved (binding locked)
WHEN  operator enters "rebind executor workbuddy"
THEN  rejected: "Cannot rebind: plan is locked. Derive a new plan instead."

GIVEN a goal without any binding snapshot
WHEN  operator enters "rebind executor workbuddy"
THEN  rejected: "No binding snapshot. Use 'pair' to create one."
```

### 8.5 `binding status` (console)

```text
GIVEN an active goal with binding snapshot
WHEN  operator enters "binding status"
THEN  shows:
        Goal: <goal summary>
        Snapshot: v1 (source: project-preset)
        Planner:  claude-code-command
        Executor: workbuddy
        Status:   unlocked (no plan approved yet)

GIVEN a goal where a plan is approved and binding is locked
WHEN  operator enters "binding status"
THEN  shows "Status: locked (plan <planId> approved at <time>)"
AND   rebind controls are disabled
```

---

## 9. Gate

### 9.1 RP gate (this document)

- [ ] Only document changes — zero code modifications.
- [ ] Explicitly lists which tests will change in each EX phase.
- [ ] Explicitly lists which ADRs need amendment.
- [ ] Defines forbidden behaviors (F1–F12) as non-negotiable.
- [ ] Preserves the rule: terminals do not directly control terminals.
- [ ] Preserves the rule: WorkBuddy execution is behind full middle-layer gating.

### 9.2 Acceptance gate for implementation

After all EX phases:
```bash
npm run typecheck
npm run lint
npm test
npm run build-extension
```

### 9.3 Behavioral gate scenarios (for EX-6)

1. New project without preset → no endpoint auto-selected
2. Set project preset → new goal auto-inherits
3. Modify preset → existing goal bindings unchanged
4. Rebind after plan approval → rejected (locked binding)
5. WorkBuddy executor proposal → requires human confirm
6. WorkBuddy offline → not selectable as executor
7. WorkBuddy returns malformed result → failed (not silently accepted)
8. Audit records bindingHash, endpointId, proposalId, result status

---

## 10. Risk Acceptance

| Risk | Mitigation |
|------|-----------|
| WorkBuddy execution opens a new attack surface | Pull-based inbox; WorkBuddy cannot self-confirm, modify bindings, or choose project root; schema validation rejects malformed returns |
| Capability declaration false promise | EX-4 gates `canExecute=true` behind inbox/result protocol implementation |
| Project preset change breaks historical goals | Snapshots isolate goals from preset changes; immutable after creation |
| Confirmation fatigue | Per-proposal confirm is existing ADR-0024 §5 behavior; no change |
| Terminal-terminal coupling | Middle-layer mediation prevents direct control; each terminal only registers capabilities |

---

## 11. Relationship to Existing Decisions

| Decision | Relationship |
|----------|-------------|
| ADR-0003 Controlled Execution Layer | Unchanged. WorkBuddy execution is subject to all its gates. §7 amended from "MUST NOT trigger" to "may execute through the controlled execution layer." |
| ADR-0024 Dual-Endpoint Automation | Unchanged. WorkBuddy becomes a pairable endpoint but the binding, confirmation, and fail-closed rules all apply. §6 updated to reflect current state. |
| ADR-0004 Model API Middle Layer | Unchanged. No model API authority for WorkBuddy. |
| ADR-0006 Multi-Provider AgentTeam | Unchanged. Sequential, single-concurrency, patch-only. WorkBuddy fits these constraints. |
| ADR-0023 ChatGPT Web Automation | Unchanged. No execution authority for ChatGPT Web returns. |

---

## 12. Next Steps

1. **Review this RP document.** Explicit operator reply of `接受` (or equivalent)
   required before any EX phase begins.

2. **After RP acceptance, before EX-1**: Produce ADR amendments for ADR-0003 §7
   and ADR-0024 §6. These amendments remove the "WorkBuddy MUST NOT execute"
   hard boundary and authorize the WorkBuddy execution endpoint identity. ADR
   amendments must be accepted before EX-4 changes `canExecute=true`; producing
   them early avoids EX-4 being blocked on a missing authorizing decision.

3. **After ADR amendments accepted**: Execute EX-1 through EX-6 in order, each
   returning to an RP/REVIEW batch between phases.

4. **After EX-6**: Update README security boundaries, mark old "non-executing"
   language as historical in docs, and update the ADR amendments from §2 above
   with implementation notes (which tests pass, what the final capability
   declarations are).

---

## 13. EX-1 Execution Prompt — Endpoint Session Registry

> **Ownership**: This section is the complete, self-contained execution prompt
> for the EX-1 batch. The executing agent must follow it without expanding scope.

### 13.1 Objective

Add runtime endpoint registration, heartbeat, and offline detection to
`InMemoryEndpointRegistry`. Endpoints must declare their capabilities at
registration and remain discoverable while online. No dispatch, no task
routing, no execution — registry only.

### 13.2 Allowed modification range

- `apps/local-server/src/endpoints/endpoint-registry.ts` — extend existing class
- `apps/local-server/src/endpoints/mock-endpoints.ts` — update DEFAULT_ENDPOINTS
- `packages/shared/src/types.ts` — add `'terminal'`, `'workbuddy'` to transport
  union; add `EndpointSession` fields to `AgentEndpoint`
- `packages/shared/src/schemas.ts` — validators for new fields
- `packages/shared/src/constants.ts` — route constants
- `apps/local-server/src/routes/bridge-api.ts` — four new routes
- `tests/endpoint-registry.test.mjs` — must pass; update as needed

**Forbidden in EX-1**:
- Do NOT create new capability fields (`canReason`, `canVerify`). Existing
  `canReview`/`canSummarize`/`canExecute` are sufficient for EX-2 role selection.
- Do NOT create provider-capability changes or WorkBuddy execution paths.
- Do NOT allow externally registered endpoints to declare `canExecute: true`.
  EX-1 session registration is discoverability-only; execution-capable runtime
  registration is explicitly deferred to EX-4.
- Do NOT add `pair` / `rebind` commands.
- Do NOT touch `team-store.ts` or create `project-team-preset-store.ts`.
- Do NOT add `/inbox`, `/results`, `/log` routes — those are EX-4.
- Do NOT persist endpoint session `online`/`busy` state. Runtime endpoint
  sessions must re-register after restart.

### 13.3 Implementation steps

**Step 1 — Extend AgentEndpoint type**

In `packages/shared/src/types.ts`:
- Add `'terminal'` and `'workbuddy'` to the `AgentEndpointTransport` union.
- Add optional fields to `AgentEndpoint`:
  ```ts
  projectRef?: string;
  status?: 'online' | 'offline' | 'busy';
  lastSeenAt?: number;  // Unix ms timestamp
  ```
- Do NOT add `canReason`/`canVerify` to `AgentEndpointCapabilities`.

**Step 2 — Add schemas**

In `packages/shared/src/schemas.ts`:
- Add `validateAgentEndpointStatus` function: accepts only `'online' | 'offline' | 'busy'`.
- Add `validateEndpointTransport` function: must include `'terminal'` and `'workbuddy'` in valid set.
- Add `validateEndpointRegistration` function: checks `endpointId`, `label`,
  `transport`, `capabilities`; rejects registration with unknown transport.
  EX-1 must also reject any external registration whose capabilities include
  `canExecute: true`.
- Do NOT modify the WorkBuddy execution rejection on line 1117 — that's EX-4.

**Step 3 — Add route constants**

In `packages/shared/src/constants.ts`:
- Add `ENDPOINTS_PATH = '/bridge/endpoints'` (or inline in routes).

**Step 4 — Extend InMemoryEndpointRegistry**

In `apps/local-server/src/endpoints/endpoint-registry.ts`:
- Add `register(endpoint: AgentEndpoint): EndpointRegistryResult` — stores
  endpoint with `status: 'online'`, `lastSeenAt: Date.now()`. Rejects duplicate
  `endpointId` with `duplicate-endpoint-id`. Reconnect/online recovery is handled
  by `heartbeat`, not by duplicate `register`.
- Add `heartbeat(endpointId: string): EndpointRegistryResult` — updates
  `lastSeenAt` to `Date.now()`, sets status to `online`. Returns error if
  endpoint not found or already `offline`.
- Add `offline(endpointId: string, reason?: string): EndpointRegistryResult` —
  sets status to `offline`, records reason in returned result.
- Add `listOnline(): AgentEndpoint[]` — returns endpoints with `status === 'online'`.
- Add `listByProject(projectRef: string): AgentEndpoint[]` — filters by `projectRef`.
- Do not add `exportEndpoints()` / `hydrateEndpoint()` in EX-1. Runtime endpoint
  sessions are not durable; built-in/static endpoints are restored by
  `createBridgeRuntime`, and terminal sessions re-register after restart.

**Step 5 — Add mock endpoints**

In `apps/local-server/src/endpoints/mock-endpoints.ts`:
- Add `workbuddy` endpoint definition:
  ```ts
  {
    id: 'workbuddy',
    label: 'WorkBuddy',
    transport: 'workbuddy',
    risk: 'medium',
    capabilities: { canAcceptPrompt: true, canReturnOutput: true,
                    canReview: true, canExecute: false, canSummarize: false },
    adapterName: 'workbuddy-execution',
    experimental: true,
  }
  ```
  Note: `canExecute: false` in mock — stays false until EX-4. This endpoint
  exists in the registry but won't pass execution dispatch until EX-4.
- Add `claude-code-command` with `transport: 'command'` (if not already present
  with that transport — verify against existing definitions).
- Extend `DEFAULT_AGENT_ENDPOINTS` array.

**Step 6 — Add HTTP routes**

In `apps/local-server/src/routes/bridge-api.ts`:
- `POST /bridge/endpoints/register` — body: `{ endpointId, label, transport,
  capabilities, projectRef? }`. Validates with schemas, calls `registry.register()`.
  Returns 201 with registered endpoint or 409 on duplicate. In EX-1, rejects
  `capabilities.canExecute === true` with 409/400 so the route cannot create a
  new execution-capable binding target before EX-4.
- `POST /bridge/endpoints/:id/heartbeat` — calls `registry.heartbeat(id)`.
  Returns 200 or 404.
- `GET /bridge/endpoints` — calls `registry.list()`. Supports optional query
  params: `?projectRef=X` → `listByProject(X)`, `?online=true` → `listOnline()`.
- `POST /bridge/endpoints/:id/offline` — body: `{ reason? }`. Calls
  `registry.offline(id, reason)`. Returns 200 or 404.
- All routes require origin guard + pairing token (standard `/bridge/*` auth).

**Step 7 — Tests**

In `tests/endpoint-registry.test.mjs`:
- Test: register endpoint → status online, lastSeenAt set.
- Test: heartbeat updates lastSeenAt.
- Test: offline sets status offline.
- Test: duplicate register returns error.
- Test: listOnline excludes offline endpoints.
- Test: listByProject filters correctly.
- Test: heartbeat on offline endpoint returns error.
- Test: endpoint with `transport: 'workbuddy'` registers successfully.
- Test: endpoint with `transport: 'terminal'` registers successfully.
- Test: transport union validation rejects unknown transports.
- Test: status union validation rejects invalid status values.
- Test: external registration with `canExecute: true` is rejected in EX-1.
- Test: runtime registered endpoint is not snapshotted/hydrated as online.

### 13.4 Verification commands

```bash
node --experimental-strip-types --test tests/endpoint-registry.test.mjs
npm run typecheck
npm test
```

All existing tests must continue to pass. No test regressions.

### 13.5 Deliverables

- Modified: `packages/shared/src/types.ts`, `schemas.ts`, `constants.ts`
- Modified: `endpoint-registry.ts`, `mock-endpoints.ts`
- Modified: `bridge-api.ts` (four new routes)
- Modified/verified: `tests/endpoint-registry.test.mjs`
- Report: changed files list, test results, any boundary evidence

---

## 14. Changelog

| Version | Date | Changes |
|---------|------|---------|
| v1 (initial) | 2026-06-29 | Initial RP draft |
| v2 (review patch) | 2026-06-29 | Must-fix: (1) team-store.ts → new `project-team-preset-store.ts` (2) `console.ts` → `project-console.ts` for command routing (3) ADR amendment timing moved before EX-4 (4) "already reviews" → target capability language (5) Added complete EX-1 prompt. Recommended: (6) snapshot immutable→versioned/audited replacement (7) removed `canReason`/`canVerify` from AgentEndpoint (8) persistence & migration §7 (9) command acceptance tests §8 |
| v3 (review patch) | 2026-06-29 | Fixed final blockers: canonical WorkBuddy endpoint id is `workbuddy`; EX-1 rejects external `canExecute: true`; duplicate register returns conflict; runtime endpoint online/busy state is non-durable. |
