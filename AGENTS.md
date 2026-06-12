# Agent Workflow Rules

This repository uses separate review/planning and execution batches.

## Batch Ownership

- `RP-*` batches are owned by the reviewing/planning agent.
- `EX-*` batches are owned by execution agents.
- `REVIEW-*` batches are owned by the reviewing agent after an execution batch.

## Review / Planning Batches

Reviewing/planning agents must:

- inspect the actual repository state before making phase decisions;
- review real diffs, affected call chains, tests, and phase boundaries;
- decide whether a phase can proceed, needs changes, or is blocked;
- produce complete execution prompts for `EX-*` batches;
- keep findings and recommendations separate from implementation work.

Reviewing/planning agents must not:

- perform implementation fixes during a review batch unless the user explicitly asks;
- mark an ADR accepted without an explicit review/acceptance decision;
- let execution convenience expand the approved product or architecture boundary.

## Execution Batches

Execution agents must:

- follow the provided `EX-*` prompt and allowed modification range;
- implement only the authorized slice;
- run the requested verification commands;
- report changed files, tests, boundary evidence, and unresolved questions.

Execution agents must not:

- make product direction or architecture route decisions;
- introduce future-stage capabilities not authorized by the prompt;
- continue into another execution slice without returning to a review/planning batch.

## Control Flow

After every `EX-*` batch, control returns to an `RP-*` or `REVIEW-*` batch before
any further execution. If a review requests changes, the next execution batch
must be a bounded follow-up patch for those findings only.
