# CLI Bridge v2.1 AgentTeam / Project Control Plane Planning Review

## 0. Status

Status: PLANNING REVIEW.

This review covers:

- `CLI-BRIDGE-v2.1-AGENTTEAM-DISCUSSION-RAW.md`
- `PLAN-AGENTTEAM-PROJECT-CONTROL-PLANE.md`

The review checks fidelity from RAW to PLAN, internal consistency, alignment with
upstream canonical planning documents, and risks/gaps to address before any
AgentTeam implementation handoff.

## A. Fidelity: RAW Topics Covered By PLAN

| RAW §1 topic | PLAN location | Coverage |
| --- | --- | --- |
| Harness / memory / self-iteration enter the middle layer | §10 / §11 / scattered | Partial: harness and memory are complete; self-iteration needs a dedicated boundary section. RAW §2.4's "bounded non-mutating allowed; mutation-capable must follow ADR-0003 controls" is not explicit enough. |
| AgentTeam can define roles | §6 | Covered. |
| AgentTeam start conditions | §7 | Covered, with review-only and execution thresholds separated. |
| Whether WorkBuddy can enable AgentTeam | §5 safe flow | Covered. |
| UI project/task progress | §12 | Covered. |
| WorkBuddy/qclaw/openclaw/hermes may execute | §5 | Covered through endpoint identity model. |
| AgentTeam = multi-slot, default single-provider | §3 | Covered. |
| Multi-slot capability must be explicit | §4 | Covered. |
| Middle-layer model API | §9 | Covered through structured roles and bounded flow. |
| Local archive and organized plan | RAW + PLAN files | Covered. |

Fidelity conclusion: the core decisions are preserved. The main missing item is
an explicit self-iteration safety boundary section.

## B. Internal Consistency

The plan is coherent overall. Items to tighten:

1. `ToolProvider` must be clarified as a registration namespace, not a
   permission carrier. Authority comes from endpoint capabilities.
2. Parallel execution should require both `supportsParallelSlots=true` and
   `maxSlots >= 2`; otherwise the orchestrator must reject or fall back
   explicitly.
3. `harness-verifier` should be stated as one implementation of the generic
   `verify` mode, not a new mode dimension.
4. MemoryStore, ConversationTimeline, and AuditLog need a clearer responsibility
   boundary and cross-link to `PLAN-PROJECT-CONVERSATION-TIMELINE.md`.
5. AuditExplainerModel output must be a model-generated annotation/summary, not
   audit truth.

## C. Alignment With Upstream Canonical Docs

Checked against:

- `ADR-0003-controlled-execution-layer.md`
- `CLI-BRIDGE-v2.0-IMPLEMENTATION-HANDOFF.md`
- `PLAN-GOAL-DRIVEN-DYNAMIC-WORKFLOW.md`
- `PLAN-LAYERED-ORCHESTRATION-AND-CONSOLE.md`
- `PLAN-PROJECT-CONVERSATION-TIMELINE.md`

Alignment status:

- ADR-0003 now references the AgentTeam plan and clarifies WorkBuddy's current
  task-system identity is not a permanent product limit.
- v2.0 handoff points v2.1+ readers to PLAN + RAW.
- Goal-driven dynamic workflow plan links to AgentTeam plan.
- Layered orchestration/console plan links to AgentTeam plan.
- `PLAN-PROJECT-CONVERSATION-TIMELINE.md` still needs a reciprocal link because
  AgentTeam plan lists ConversationTimeline as a subsystem.

Additional ADR-0003 invariants to restate in the AgentTeam plan:

- Step ceiling default 1, hard max 10.
- Consecutive failure stop threshold 2.
- Replanning that exceeds the approved Goal scope must re-trigger plan-level
  approval.

## D. Gaps And Risks

### Gaps

1. Self-iteration boundaries need a dedicated section.
2. Conceptual schema needs an explicit note that concrete schemas/state machines
   belong to future v2.x handoffs.
3. AgentTeam partial-failure strategy is undefined.
4. Patch overlap detection / merge queue algorithm is TBD.
5. Cost/budget model is not defined.
6. Long-lived memory review workflow is not defined.

### Risks

| Risk | Explanation | Suggested mitigation |
| --- | --- | --- |
| Planning outpaces implementation | v2.0 through v2.5+ contain many large increments. | Each v2.x needs its own ADR/handoff before code. |
| PolicyEngine becomes implicit single source of truth | The plan names PolicyEngine but does not list minimal invariants. | Add a PolicyEngine invariants section. |
| v2.4 is too large | It combines multi-provider AgentTeam, model API, replan, and self-iteration. | Split into v2.4a and v2.4b. |
| Memory and timeline blur | Two stores can diverge if not bounded. | Link timeline as event stream, memory as derived/reviewed summary. |
| "Existing wording" clarification is soft | Future readers may miss which docs were updated. | List synchronized upstream docs. |

## E. Strengths

- Correctly treats AgentTeam as multi-slot by default, not necessarily
  multi-tool.
- Correctly upgrades WorkBuddy from "never executor" to "task-system identity is
  non-executing; executor identity is separate and governed."
- Separates review-only and execution team start conditions.
- Keeps non-goals aligned with v2.0 hard boundaries.
- Keeps patch-proposal first aligned with ADR-0003.
- Rejects free-form model-to-model loops in favor of structured, schema-checked
  model roles.

## F. Priority Revisions

1. Add a self-iteration boundary section.
2. Add replanning scope-overflow invariant to model API/replan section.
3. Clarify ToolProvider is a namespace, not an authority source.
4. Tighten parallel slot rules.
5. Clarify AuditExplainerModel authority.
6. Restate ADR-0003 thresholds in AgentTeam start/sequence sections.
7. Cross-link `PLAN-PROJECT-CONVERSATION-TIMELINE.md`.
8. Split v2.4 into v2.4a and v2.4b.
9. List synchronized upstream documents.
10. Add Open Questions appendix.

## G. RAW File Notes

`CLI-BRIDGE-v2.1-AGENTTEAM-DISCUSSION-RAW.md` is a suitable source record:

- It states it is a raw discussion record, not an implementation handoff.
- It lists the 10 original topics.
- It preserves original decision semantics.
- It keeps non-authorizations aligned with PLAN §14.
- It links to the canonical PLAN.

Recommended addition: state the PLAN synchronization status in RAW §0 so readers
know whether the canonical plan has caught up with the raw discussion.

## H. Review Outcome

Planning review outcome: revise PLAN and cross-links before using the AgentTeam
plan as input to any implementation handoff.

