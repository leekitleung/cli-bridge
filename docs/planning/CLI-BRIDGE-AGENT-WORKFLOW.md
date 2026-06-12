# CLI Bridge Agent Workflow

## Purpose

CLI Bridge uses multiple agent roles during planning and implementation. To keep
phase boundaries clear, review/planning work and execution work are handled as
separate batches.

This workflow is a governance convention for agent collaboration. It does not
change product scope, runtime behavior, or any ADR decision.

## Batch Types

| Prefix | Owner | Purpose |
|--------|-------|---------|
| `RP-*` | Reviewing/planning agent | Inspect current state, review phase readiness, decide next slice, write execution prompts. |
| `EX-*` | Execution agent | Implement the bounded prompt, run verification, report evidence. |
| `REVIEW-*` | Reviewing agent | Review an execution diff and decide closeout, follow-up, or block. |

## Required Flow

```text
RP-* planning/review
  -> EX-* bounded execution
  -> REVIEW-* actual-diff review
  -> RP-* next planning decision
```

Execution batches do not self-authorize the next batch. After each execution
batch, the project returns to review/planning before any further implementation.

## RP-* Responsibilities

The reviewing/planning agent is responsible for:

- reading the current planning documents and relevant source state;
- distinguishing implemented, planned, deferred, and blocked work;
- checking whether ADRs or handoffs authorize the next step;
- reviewing actual diffs and affected call chains after execution;
- producing execution prompts with background, goals, scope, forbidden items,
  suggested order, acceptance criteria, verification commands, and return format.

The reviewing/planning agent should not perform implementation fixes inside a
review batch unless the user explicitly asks for that combined action.

## EX-* Responsibilities

The execution agent is responsible for:

- following the prompt exactly;
- staying inside the allowed view and modification ranges;
- implementing the authorized slice only;
- running the requested verification commands;
- reporting changed files, verification results, boundary evidence, and any
  remaining review questions.

The execution agent must not decide product direction, accept ADRs, expand
architecture scope, or continue into future-stage capabilities.

## REVIEW-* Responsibilities

The reviewing agent must:

- base findings on the actual diff and affected call chains;
- separate blocking issues, non-blocking risks, and style notes;
- check tests and verification against the requested batch;
- check phase boundaries and forbidden capabilities;
- decide `Approved`, `Approved with Notes`, `Request Changes`, or `Blocked`.

If changes are required, the next `EX-*` batch should be a focused follow-up for
those findings only.

## Current v2.4a Application

Completed sequence:

```text
RP-2.4a-1: ADR-0004 senior review
  -> EX-2.4a-1: ADR acceptance documentation sync
  -> RP-2.4a-2: v2.4a handoff review
  -> EX-2.4a-2: PlannerModel implementation batch, only after ADR acceptance and handoff approval
  -> REVIEW-2.4a-2: PlannerModel implementation review
  -> EX-2.4a-3: closeout documentation sync
  -> EX-2.4a-3b: closeout documentation consistency follow-up
  -> REVIEW-2.4a-3b: approved
```

v2.4a PlannerModel closeout is approved and published in commit `1eb6200`.
Further v2.4b/v2.5+ work must return to `RP-*` planning before any execution
batch is authorized.
