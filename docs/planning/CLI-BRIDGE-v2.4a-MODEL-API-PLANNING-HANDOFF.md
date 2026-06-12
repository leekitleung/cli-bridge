# CLI Bridge v2.4a — PlannerModel Implementation Handoff

**Status**: HANDOFF DRAFT — Awaiting handoff review (ADR-0004 accepted)
**Date**: 2026-06-12
**Based on**: `ADR-0004-model-api-middle-layer.md` (ACCEPTED)
**Prerequisite**: This handoff MUST be reviewed and approved before any implementation begins.
               ADR-0004 is already accepted.

---

## 0. Purpose

This handoff describes the minimum scope, preconditions, allowed modifications,
and verification criteria for the v2.4a PlannerModel implementation slice.

**It is NOT an authorization to implement.** Implementation may begin only after this handoff is reviewed and approved (ADR-0004 is already accepted).

---

## 1. Scope

### 1.1 What v2.4a will implement (if approved)

| Capability | Detail |
|-----------|--------|
| `ModelProvider` interface | Abstract model caller with `plan(goal, context) → PlanDraft` contract. |
| OpenAI-compatible provider adapter | Single adapter implementing the interface. |
| In-memory API key | Opt-in per project; never persisted to disk. |
| PlannerModel prompt assembly | System preamble + Goal + project context → structured plan draft. |
| Schema validation | Model output validated against PlanStep schema before acceptance. |
| PolicyEngine check | Tier constraints, step ceiling, endpoint capability checked before display. |
| Advisory display in console | "Model-suggested" label, distinct from human-authored plans. |
| Budget / timeout / retry | Per-call limits as specified in ADR-0004 §6. |
| Audit events | `model_plan_request` and `model_plan_result` event types. |
| Offline degradation | Missing API key → "unavailable" state; existing manual plan flow unchanged. |

### 1.2 What v2.4a will NOT implement

- CriticModel, ArbiterModel, SummarizerModel, ReplannerModel, or AuditExplainerModel.
- Automatic replanning after failure.
- Model-driven slot dispatch or execution decisions.
- Self-iteration loops (model calling itself).
- Multi-model routing or provider selection logic beyond the single adapter.
- Parallel model calls.
- Any model output that bypasses schema validation, PolicyEngine, or human approval.
- API key persistence, key rotation, or multi-key management.
- Model API for any purpose other than plan suggestion.
- Any ADR-0003 gate bypass.

### 1.3 What remains unchanged

- Plan approval always requires human confirmation.
- Step ceiling (hard 10) enforced by PolicyEngine regardless of model output.
- Per-step gate for state-changing steps remains binding.
- WorkBuddy remains non-executing.
- No shell/exec/run/command endpoint.
- No auto-apply, auto-commit, auto-push, auto-merge.
- Console remains read-only for model output (display only, no dispatch button).

### 1.4 Implementation entry strategy

The PlannerModel reuses the existing `POST /bridge/goals/plan` endpoint. No new
endpoint is created.

- Add an optional `plannerSource` field to the request body:
  - `"review-cli"` (default) — existing behavior, unchanged.
  - `"model-api"` — uses the model provider to generate an advisory PlanDraft.
- `plannerSource: "model-api"` requires:
  - An in-memory API key configured for the project.
  - The goal in `draft` status.
  - The output is an advisory PlanDraft — schema-validated, PolicyEngine-checked,
    but never automatically attached to the goal.
- Model failure or key unavailability:
  - Returns a controlled error (does NOT attach a plan to the goal).
  - Does NOT mutate existing goal/plan/step state.
  - Existing `review-cli` default is unaffected.
- Implementation modifies the existing `POST /bridge/goals/plan` handler in
  `apps/local-server/src/routes/bridge-api.ts` to route to the model planner
  when `plannerSource === "model-api"`.
- The model planner logic is implemented in a separate module
  (`apps/local-server/src/model/planner-model.ts`) that calls the
  `ModelProvider` interface and applies schema/PolicyEngine checks before
  returning. It does NOT mutate `goal-plan-generator.ts`.

### 1.5 System preamble

The implementation batch MUST add `apps/local-server/src/model/planner-prompt.ts`
with a fixed, reviewable system preamble before model API calls are wired.
Minimum requirements for the preamble:

- Defines PlannerModel role: produce a structured plan draft from a Goal description.
- Specifies output schema: array of PlanStep-like objects with `intent`, `kind`,
  `tier`, `isStateMutating`.
- Forbids the model from suggesting: shell commands, git operations beyond patch,
  auto-apply, commit, push, merge, or any ADR-0003 gate bypass.
- Caps suggested step count at the ADR-0003 hard ceiling (10).
- The preamble text must be reviewed as part of the implementation batch review.

---

## 2. Preconditions for implementation

Before writing code:
- [x] ADR-0004 status = ACCEPTED.
- [ ] This handoff reviewed and approved.
- [ ] `ModelProvider` interface design finalized.
- [ ] System preamble text approved (security review for prompt injection).
- [ ] Audit event types (`model_plan_request`, `model_plan_result`) added to
  `AUDIT_EVENT_TYPES` in types.ts (type-only — no runtime behavior until
  implementation).

---

## 3. Allowed modification range

| For implementation | Files |
|-------------------|-------|
| `ModelProvider` interface | New file: `apps/local-server/src/model/provider-interface.ts` |
| OpenAI-compatible adapter | New file: `apps/local-server/src/model/openai-adapter.ts` (Node built-in `fetch` only; no new npm dependencies) |
| PlannerModel plan generation | New file: `apps/local-server/src/model/planner-model.ts` (calls ModelProvider, applies schema/PolicyEngine checks) |
| PlannerModel prompt assembly | New file: `apps/local-server/src/model/planner-prompt.ts` (fixed system preamble) |
| Routing: planner source selection | `apps/local-server/src/routes/bridge-api.ts` (add `plannerSource` field to existing goals/plan handler; route to model planner) |
| Audit event types | `packages/shared/src/types.ts` (add `model_plan_request` and `model_plan_result` types only) |
| API key config | `apps/local-server/src/model/api-key.ts` (in-memory only; never persisted) |
| Console display | `apps/local-server/src/routes/project-console.ts` (model-suggested label) |
| Tests — model API | New file: `tests/model-api.test.mjs` |
| Tests — goal plan regression | `tests/bridge-goals-api.test.mjs` (verify review-cli default unchanged, new model-api field) |

### Forbidden modifications

- No change to existing execution orchestrator, slot advance, or TeamSpec runtime.
- No change to `apps/local-server/src/goal/goal-plan-generator.ts` (model planner is a separate module).
- No change to persistence or snapshot logic to store API keys.
- No new npm dependencies (use Node built-in `fetch` for HTTP calls).
- No new HTTP endpoint (reuse existing `/bridge/goals/plan`).

---

## 4. Verification criteria

Before the implementation batch is considered ready for review:

- [ ] `npm run typecheck` pass.
- [ ] `npm run lint` pass.
- [ ] `npm test` pass (no regression on existing 498+ tests).
- [ ] New model API tests cover: happy path, missing key, network failure,
  schema validation rejection, step ceiling enforcement, budget enforcement,
  audit events, redaction of raw model output, and PlannerModel failure not
  advancing or mutating existing goal/plan/step state.
- [ ] Console show model-suggested label with no execute/dispatch button.
- [ ] API key never appears in snapshot files, audit records, or HTTP responses.
- [ ] Existing goal/plan/step workflows work unchanged when model API is
  unavailable.
- [ ] No new shell/exec/run/command endpoint, no auto-apply, no gate bypass.
- [ ] `git diff --check` pass.

---

## 5. v2.4a vs v2.4b / v2.5+ boundary

| Capability | v2.4a | v2.4b+ |
|-----------|--------|-------------|
| PlannerModel | ✅ Authorized by ADR-0004; pending handoff approval | — |
| CriticModel / ArbiterModel | ❌ Not authorized | Requires separate ADR |
| Multi-provider AgentTeam | ❌ Not authorized | v2.4b (Track C) |
| Parallel slots | ❌ Not authorized | Deferred past v2.4 |
| Workspace-write auto-apply | ❌ Not authorized | v2.5+ (Track D) |
| Worktree / branch / merge queue | ❌ Not authorized | v2.5+ (requires separate ADR) |
| Self-iteration / replan loops | ❌ Not authorized | Requires separate ADR |
| Model API key persistence | ❌ Not authorized | In-memory only in v2.4a |

---

## 6. Reference Chain

```text
PLAN-AGENTTEAM-PROJECT-CONTROL-PLANE.md §9
  → ADR-0004-model-api-middle-layer.md (ACCEPTED)
    → CLI-BRIDGE-v2.4a-MODEL-API-PLANNING-HANDOFF.md (this document)
      → CLI-BRIDGE-POST-v2.3-PLANNING-HANDOFF.md §3 Track B
        → ADR-0003-controlled-execution-layer.md (binding invariants)
```

---

*This handoff authorizes implementation only after this document is reviewed and approved. ADR-0004 is already accepted.*
