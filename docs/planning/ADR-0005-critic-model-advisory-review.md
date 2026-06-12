# ADR-0005: CriticModel Advisory Review

Status: PROPOSED

Date: 2026-06-12

## Context

ADR-0004 accepted the minimum Model API middle-layer boundary and authorized
PlannerModel only. The v2.4a PlannerModel implementation is complete and
closeout-approved. It can generate an advisory PlanDraft through the existing
`POST /bridge/goals/plan` route when `plannerSource: "model-api"` is requested,
then schema-validates and PolicyEngine-checks the draft before display. It does
not attach the plan automatically.

The post-v2.3 planning handoff and PLAN-AGENTTEAM-PROJECT-CONTROL-PLANE.md list
CriticModel as a future candidate role after PlannerModel. ADR-0004 explicitly
left all non-PlannerModel roles unauthorized until a separate ADR or explicit
amendment.

This ADR decides whether CriticModel may be added as the next model role. It
does NOT authorize implementation until accepted and followed by an execution
handoff.

## Decision

### 1. Whether CriticModel is allowed

**Proposed decision**: PERMIT, under a narrower advisory-only boundary than
PlannerModel.

CriticModel MAY review a proposed PlanDraft and produce structured critique
items. Its output is advisory evidence only. It cannot create, rewrite, attach,
approve, dispatch, or execute a plan.

### 2. Scope

The first CriticModel slice is limited to:

- Input: Goal summary, project metadata, the already-produced PlanDraft, and a
  minimal policy summary.
- Output: `CritiqueDraft` containing bounded items such as:
  - `severity`: `info | warning | blocking`
  - `category`: `scope | safety | sequencing | test_coverage | policy`
  - `message`: concise user-facing explanation
  - `stepId` or `stepIndex`: optional reference to the reviewed step
  - `suggestedAction`: optional advisory text, not executable instructions
- Display: read-only console annotation beside a model-suggested or
  human-authored draft.
- Audit: request/result events that record status and metadata without raw
  prompt, raw response, API key, or file contents.

CriticModel is not part of the execution scheduler. It is not a second planner.
It is not an arbiter. A blocking critique does not automatically reject,
mutate, or cancel anything; it is surfaced to the human and to later validation
logic as advisory context only.

### 3. canExecute boundary

**Proposed decision**: CriticModel registers as `canExecute: false`.

CriticModel cannot:

- Modify files, repository state, workspace content, snapshots, or authoritative
  goal/plan/step state.
- Bypass plan approval, step ceiling, per-step gates, state-changing gates,
  audit, or failure-stop behavior.
- Trigger slot dispatch, provider execution, WorkBuddy execution, scheduler
  behavior, commit, push, merge, CI, or external commands.
- Turn a PlanDraft into an approved Plan.
- Override PolicyEngine or schema validation.
- Promote WorkBuddy or any non-executing tool into an executor.

### 4. Relationship to PlannerModel

CriticModel can review:

- A PlannerModel advisory draft.
- A human-authored draft before approval, if explicitly requested.

CriticModel cannot call PlannerModel, request automatic revision, or start a
self-iteration loop. If a future flow wants
`PlannerModel -> CriticModel -> PlannerModel revises`, that requires a separate
ADR or amendment covering bounded iteration, retry limits, audit trace, and
human approval semantics.

### 5. Validation and failure behavior

CriticModel output MUST be schema-validated before display. Invalid output is
rejected fail-closed for the critique attempt, without mutating the reviewed
draft.

Failure semantics:

- Missing API key: return a controlled "model API unavailable" result.
- Timeout/network/provider error: fail the critique attempt only.
- Schema or policy violation: reject the critique result and write audit.
- No automatic retry for schema/policy failures.
- Existing manual planning and existing PlannerModel planning remain available.

### 6. Prompt-injection controls

- Goal descriptions and PlanDraft text are untrusted input.
- CriticModel receives a fixed system preamble that defines the critique role,
  output schema, and forbidden actions before any user content.
- Prompt assembly must avoid raw file content and raw CLI output.
- Model output containing executable instructions, shell commands, git
  operations, secret requests, gate-bypass instructions, or workspace-write
  instructions MUST be rejected or sanitized before display.

### 7. Redaction and retention

CriticModel follows ADR-0004 retention rules:

- API keys are memory-only and never serialized.
- Raw prompts and raw responses are not persisted.
- Audit records store metadata and summary only.
- No raw file content, secrets, raw CLI output, or provider payloads are written
  to snapshots, audit, or HTTP responses.

### 8. Audit events

If accepted, implementation SHOULD add model-specific audit events equivalent
to:

- `model_critique_request`
- `model_critique_result`

Minimum metadata:

- `projectId`, `goalId`, and optional `planId` or draft correlation id.
- provider, endpoint, latency, status, failure kind, token budget, and usage.
- critique item count and highest severity.

Audit MUST NOT include raw prompt text, raw model output, API keys, raw file
content, or raw CLI output.

### 9. API and UI surface

Implementation SHOULD prefer the smallest surface that preserves existing
routes and contracts. Candidate options:

1. Add an optional `criticSource: "none" | "model-api"` field to the existing
   `POST /bridge/goals/plan` model flow and return critique alongside the
   advisory draft.
2. Add a new critique-only sub-action under the existing goal planning API if
   review of human-authored drafts requires a clean request shape.

The execution handoff must choose one option and justify it. Any new endpoint,
if proposed, must remain read-only and must not become an execution or mutation
path.

Console display must label critique as model-suggested advisory text. It must
not add approve, dispatch, apply, execute, commit, push, merge, or auto-fix
controls.

### 10. ADR-0003 and ADR-0004 invariants

CriticModel MUST preserve all ADR-0003 and ADR-0004 invariants:

| Invariant | ADR-0005 position |
|---|---|
| Plan approval required before execution | Unchanged. Critique does not approve plans. |
| Step ceiling hard 10 | Unchanged. Critique cannot expand plan scope. |
| Per-step gate for state-changing steps | Unchanged. Critique cannot bypass gates. |
| Audit for operations | Extended with critique request/result metadata. |
| Failure-stop | Unchanged. Critique failure does not advance execution state. |
| WorkBuddy non-executing | Unchanged. |
| No shell/exec/run/command endpoint | Unchanged. |
| No auto-apply/commit/push/merge | Unchanged. |
| PlannerModel advisory-only | Unchanged. CriticModel is also advisory-only. |

## Risk Acceptance

- **Critique may be mistaken or overconfident**: the output is advisory and
  clearly labeled; PolicyEngine and human approval remain authoritative.
- **Prompt injection through plan text**: the reviewed draft may contain
  hostile text. Mitigation: fixed preamble, schema validation, forbidden-action
  filtering, no tools, no execution.
- **False blocking critique may slow planning**: blocking severity is a label,
  not an automatic reject. Human review decides.
- **Cost and latency**: critique is an opt-in model call with budget and timeout
  limits.
- **Scope creep toward self-iteration**: this ADR forbids automatic revision
  loops. Replanner or Arbiter behavior requires a later ADR.

## Consequences

If accepted:

- CriticModel becomes the next allowed model role after PlannerModel.
- A separate implementation handoff must define exact files, request shape,
  schema, audit event typing, prompt text, tests, and verification commands.
- CriticModel remains advisory-only and cannot mutate authoritative state.

If rejected:

- PlannerModel remains the only allowed Model API role.
- Plan review continues through human review, schema validation, PolicyEngine,
  and existing audit/console surfaces.

## Status / Next

PROPOSED. No implementation is authorized by this document while it remains
PROPOSED.

Before execution can start:

1. A reviewer must explicitly accept or reject ADR-0005.
2. If accepted, create an implementation handoff with allowed modification
   range, forbidden list, tests, and closeout checklist.
3. Execution must remain in an `EX-*` batch and return to review before any
   further model-role expansion.
