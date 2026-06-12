# ADR-0004: Model API Middle Layer

Status: ACCEPTED

Date: 2026-06-12
Acceptance: Senior review passed (2026-06-12). Follow-up wording fix applied (60e4fa9).
            PlannerModel failure semantics tightened (8d7ce67).
            Agent workflow governance added (6b8ebb6, AGENTS.md).

## Context

Through v2.3, CLI Bridge operates without holding, invoking, or proxying model
API credentials. Codex and Claude Code run as local CLIs under the user's own
environment; the bridge governs their output through the controlled execution
layer (ADR-0003). The bridge's product value is local observability, explicit
policy, visible gates, interruptibility, and audit — not model hosting.

PLAN-AGENTTEAM-PROJECT-CONTROL-PLANE.md §9 describes potential Model API roles
(PlannerModel, CriticModel, ArbiterModel, etc.) as deferred future work requiring
a dedicated ADR before any implementation. The post-v2.3 planning handoff
identifies this as Track B — ADR-0004 Model API Decision.

This ADR decides whether, and under what minimum boundary, model API calls may
enter the bridge middle layer. It does NOT implement any model API runtime.

## Decision

### 1. Whether the bridge may hold model API credentials

**Decision**: PERMIT, under strict constraints.

The bridge MAY hold a user-provided API key (OpenAI-compatible endpoint), but
only under these conditions:

- The key is opt-in per project or per run.
- The key is stored only in memory (never persisted to disk in plaintext).
- The key is never serialized into snapshot files, audit records, or HTTP
  response payloads.
- The key is never shared between projects without explicit user action.
- If a key is not provided, the bridge MUST degrade to "model API unavailable"
  without blocking existing non-model features (goal lifecycle, plan approval,
  slot execution, audit, console).

### 2. Minimum allowed scope

**Decision**: PlannerModel only, in the first slice.

The first allowed Model API role is:

- **PlannerModel**: accepts a Goal description and context (project state,
  approved tier, available endpoints) and produces a structured PlanDraft.

PlannerModel output is advisory — a suggestion. The orchestrator always applies
schema validation and PolicyEngine checks before accepting any plan. The human
approval step (ADR-0003 §5) is unchanged.

Additional roles (CriticModel, ArbiterModel, SummarizerModel, ReplannerModel,
AuditExplainerModel) are NOT authorized in this ADR. Each requires a separate
ADR or an explicit amendment to ADR-0004 after PlannerModel evidence is gathered.

### 3. canExecute boundary

**Decision**: Model API endpoints register as `canExecute: false`.

Model API calls produce advisory output only. They cannot:

- Modify files, repository state, or workspace content.
- Bypass any ADR-0003 gate (plan approval, per-step gate, state-changing gate).
- Trigger automatic execution, commit, push, merge, or CI dispatch.
- Replace the human approval step.
- Promote WorkBuddy or any non-executing tool into an executor.

### 4. Redaction and retention

- Prompt content sent to model APIs MUST be redacted before audit logging:
  no raw CLI output, no raw file content, no secrets.
- Model API responses MUST be summarized for audit; raw response text is never
  persisted.
- Audit events for model API calls MUST include: model provider, endpoint,
  request token count, response token count, latency, status, failure reason.
- No raw prompt/response pair is stored on disk.

### 5. Prompt-injection controls

- User-provided Goal descriptions are treated as untrusted input.
- The bridge MUST prepend a fixed system preamble that defines the PlannerModel
  role, output schema, and forbidden topics before any user input.
- The bridge MUST validate that model output conforms to the expected schema
  (PlanStep shape, tier constraints, step ceiling) before accepting it.
- Model output that violates schema or ADR-0003 invariants MUST be rejected
  fail-closed, with an audit event and a user-visible generic failure reason.
  The bridge MUST NOT retry policy or schema failures without explicit opt-in.

### 6. Budget, retry, timeout, failure-stop

- **Budget**: per-call token limit, configurable (default 4096 input, 2048
  output). The bridge MUST abort a call that would exceed the budget.
- **Retry**: no automatic retry on schema-validation or policy-rejection
  failure. Retry on transient network errors only, with exponential backoff
  (max 3 retries, max 30s total).
- **Timeout**: per-call timeout (default 30s). On timeout, the bridge returns
  the failure to the caller without fallback.
- **Failure-stop**: if PlannerModel fails (network, timeout, schema rejection),
  the model planning attempt stops and surfaces the failure to the user. Existing
  manual goal/plan workflows remain available. No automatic replanning without
  human approval.

### 7. Offline behavior

- If no model API key is configured, or if the endpoint is unreachable, the
  bridge MUST NOT block.
- Existing goal/plan/step workflows (manual plan creation, human-written plans,
  plan approval) continue to work without a Model API.
- The console must clearly indicate whether a Model API is available or
  unavailable per project.

### 8. Audit and decision trace

Model API interactions produce audit events of type:

- `model_plan_request`: PlannerModel called, includes goalId, token budget,
  provider, latency, status.
- `model_plan_result`: PlannerModel response received, includes goalId,
  accepted/rejected, schema-validation status, policy-check status.

These events carry `goalId`, `projectId`, and `sessionId`. They do NOT carry raw
prompt content, raw model output, or API keys.

### 9. Advisory output vs authoritative state

Model output is advisory. It becomes authoritative state ONLY after:

1. Schema validation passes.
2. PolicyEngine check passes (ADR-0003 invariants, step ceiling, tier
   constraints).
3. Human approves the resulting Plan.

Before these three steps, model output is a draft — displayed in the console
with a clear "model-suggested" label, distinct from human-authored and
orchestrator-finalized plans.

### 10. ADR-0003 invariants preservation

ADR-0004 MUST NOT weaken any ADR-0003 invariant:

| ADR-0003 invariant | ADR-0004 position |
|---|---|
| Plan approval required before execution | Unchanged. Model-suggested plans still require human approval. |
| Step ceiling (hard 10) | Unchanged. Model output exceeding 10 steps is rejected. |
| Per-step gate for state-changing steps | Unchanged. Model cannot bypass the gate. |
| Audit for every operation | Extended: model calls add model_plan_request / model_plan_result events. |
| Failure-stop on consecutive failures | Unchanged for execution steps. PlannerModel failure does not advance or mutate step state unless a later approved implementation explicitly invokes it inside a PlanStep. |
| WorkBuddy non-executing | Unchanged. |
| No shell/exec/run/command endpoint | Unchanged. |
| No auto-apply/commit/push/merge | Unchanged. |

## Risk Acceptance

- **Model API becomes a single point of unavailability**: if PlannerModel is
  unreachable, plan generation degrades to the existing manual flow. Mitigation:
  existing non-model workflows are preserved as the fallback.
- **Prompt injection through Goal descriptions**: user input reaches a model
  API. Mitigation: fixed system preamble, output schema validation, no tool
  execution from model output.
- **API key exposure**: if the bridge holds a key in memory, a memory dump or
  process snapshot could expose it. Mitigation: key never persisted; process
  isolation is the user's responsibility.
- **Vendor dependency**: the bridge depends on an external model API for plan
  suggestions. Mitigation: the bridge is never dependent on the model for
  correctness of state transitions (PolicyEngine always validates).
- **Cost**: model API calls incur cost. Mitigation: budget limits, opt-in per
  project, no automatic retry loops.

## Consequences

Accepted consequences:

- A new `ModelProvider` abstraction is authorized within the v2.4a PlannerModel boundary.
- PlannerModel as the first role is authorized and implemented under the v2.4a handoff.
- The v2.4a implementation handoff proceeded through review and closeout.
- ADR-0003 invariants remain binding and are not weakened.

Rejected alternative, retained for decision history:

- Model API remains entirely outside the bridge.
- Plan generation continues through the existing review-only command transport
  path (`POST /bridge/goals/plan`), which uses allowlisted argv with
  `shell: false` and the existing plan parser / PolicyEngine gates.
- ADR-0004 is closed as Rejected with reasons recorded.

## Status / Next

ACCEPTED. Senior review passed (2026-06-12). v2.4a PlannerModel closeout is
approved in commit `1eb6200`.

1. v2.4a PlannerModel implementation is complete and closeout-approved.
2. CriticModel, ArbiterModel, ReplannerModel, multi-provider AgentTeam,
   workspace-write, and auto-apply/commit/push/merge remain outside this ADR's
   implemented scope and require separate approval.
