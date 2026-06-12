# CLI Bridge v2.4b — CriticModel Implementation Handoff

**Status**: IMPLEMENTATION HANDOFF — authorized by ADR-0005  
**Date**: 2026-06-12  
**Based on**: `ADR-0005-critic-model-advisory-review.md` (ACCEPTED)

---

## 0. Purpose

This handoff defines the minimum implementation slice for CriticModel. The
feature is advisory-only: it reviews a model-generated PlanDraft and returns
structured critique items beside the draft. It cannot approve, attach, mutate,
dispatch, execute, revise, or reject a plan.

---

## 1. API Shape Decision

ADR-0005 §9 required choosing exactly one API shape before implementation.

**Chosen shape**: extend the existing `POST /bridge/goals/plan` model-api flow
with optional `criticSource`.

```json
{
  "goalId": "goal-id",
  "plannerSource": "model-api",
  "criticSource": "none | model-api",
  "apiKey": "memory-only key"
}
```

Justification:

- The first CriticModel use case is reviewing the PlanDraft produced by the
  same model-api planning request.
- Reusing `/bridge/goals/plan` avoids a new HTTP route and keeps the returned
  critique tied to an advisory draft that is not attached to the goal.
- `criticSource` defaults to `"none"`, preserving existing `review-cli` and
  PlannerModel behavior.
- CriticModel failure fails only the advisory model request; no goal, plan, or
  step state is mutated.

Rejected for this slice: a new critique-only endpoint. It may be useful for
human-authored draft review later, but that is outside the minimum ADR-0005
implementation and would require a separate handoff.

---

## 2. Scope

Implemented capability:

- `criticSource: "model-api"` on `plannerSource: "model-api"` requests.
- `ModelProvider.critique()` advisory method.
- `CritiqueDraft` schema validation and forbidden-action rejection.
- `model_critique_request` / `model_critique_result` audit events.
- Response payload includes `critique` and `meta.critic` only when requested.
- Console static read-only status copy may mention CriticModel availability, but
  no action button is added.

Not implemented:

- Critique-only review of human-authored drafts.
- PlannerModel -> CriticModel -> PlannerModel revision loop.
- ArbiterModel, ReplannerModel, SummarizerModel, AuditExplainerModel.
- Any execution, dispatch, apply, commit, push, merge, scheduler, or workspace
  write behavior.

---

## 3. Allowed Modification Range

| Area | Files |
|---|---|
| Provider interface | `apps/local-server/src/model/provider-interface.ts` |
| Critic prompt | New `apps/local-server/src/model/critic-prompt.ts` |
| Critic validation | New `apps/local-server/src/model/critic-model.ts` |
| OpenAI-compatible adapter | `apps/local-server/src/model/openai-adapter.ts` |
| Model route wiring | `apps/local-server/src/routes/bridge-api.ts` |
| Audit event types | `packages/shared/src/types.ts` |
| Console read-only copy | `apps/local-server/src/routes/project-console.ts` |
| Tests | `tests/model-api.test.mjs` |
| Changelog | `CHANGELOG.md` |

---

## 4. Forbidden List

- No new endpoint in this slice.
- No mutation of goal, plan, step, team, artifact, project, snapshot, or
  workspace state from CriticModel output.
- No plan attachment or approval from model output.
- No automatic reject/cancel on `blocking` critique severity.
- No self-iteration or automatic revision.
- No shell/exec/run/command endpoint.
- No auto-apply, auto-commit, auto-push, auto-merge.
- No WorkBuddy executor promotion.
- No multi-provider routing or provider selection expansion.
- No new npm dependencies.

---

## 5. Verification Criteria

Required commands:

```text
npm run typecheck
npm run lint
npm test
git diff --check
```

Required tests:

- `criticSource: model-api` returns advisory critique with the draft and does
  not attach a plan.
- `blocking` severity is a label only and does not reject, mutate, cancel, or
  approve goal/plan/step state.
- Invalid critique schema fails closed.
- Forbidden-action critique content is rejected or sanitized before display.
- Audit events include request/result metadata and redact API key, raw prompt,
  raw response, file content, and CLI content.
- Existing `plannerSource: model-api` without `criticSource` remains unchanged.
- `criticSource` is rejected unless paired with `plannerSource: model-api`.
- Console contains no CriticModel execute/dispatch/apply controls.

---

## 6. Closeout Checklist

- [ ] ADR-0005 Acceptance Condition 1 satisfied: one API shape chosen and
      justified above.
- [ ] ADR-0005 Acceptance Condition 2 satisfied by tests.
- [ ] ADR-0005 Acceptance Condition 3 satisfied: no self-iteration loop.
- [ ] Full verification commands pass.
- [ ] Review confirms no new endpoint, no mutation path, no execution path, and
      no hidden state change from critique output.
