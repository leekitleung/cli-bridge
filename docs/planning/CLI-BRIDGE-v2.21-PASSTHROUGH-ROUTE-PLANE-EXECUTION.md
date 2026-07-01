# CLI Bridge v2.21 Passthrough Route Plane Execution Plan

Status: Draft

Date: 2026-07-02

Source plan: `docs/superpowers/plans/2026-07-02-passthrough-route-plane.md`

## Objective

Execute the Passthrough Route Plane rollout without widening CLI Bridge into an
agent framework. The implementation must preserve the existing verified
conversation-pairing behavior while adding four internal layers:

1. transcript visibility;
2. instruction packets;
3. execution packets;
4. single-mode task routes.

## Execution Mode

Recommended mode: subagent-driven development.

Reason:

- The route plane has clear vertical slices with independent tests.
- Each slice has a narrow file set and a reviewable commit.
- Review gates are required after every EX batch by repository workflow rules.
- Context pressure is lower when each EX agent owns one layer only.

Inline execution is acceptable only if each task stops at the same REVIEW gate
before moving to the next task.

## Global Boundary

CLI Bridge is a stateful control-plane router and passthrough data-plane.

Allowed:

- auth and session binding;
- endpoint routing;
- lifecycle state;
- queues, retries, and idempotency;
- audit metadata;
- visibility filtering;
- protocol-level rendering;
- safety redaction;
- delimiter wrapping;
- transport normalization.

Forbidden:

- semantic interpretation;
- summarization;
- ranking;
- rewriting executor output;
- bridge-authored final answers;
- generic shell, run, exec, Git, PR, or workspace mutation endpoints;
- extension-side confirm, dispatch, loop run, or route authority expansion.

## Gate 0: ADR Acceptance

Owner: RP/review agent.

Input:

- `docs/superpowers/plans/2026-07-02-passthrough-route-plane.md`

Actions:

1. Create `docs/planning/ADR-0029-passthrough-route-plane.md` exactly from Task 0 in the source plan.
2. Keep status as `Proposed`.
3. Commit:

```bash
git add docs/planning/ADR-0029-passthrough-route-plane.md
git commit -m "docs: propose passthrough route plane boundary"
```

Required review decision:

- Human explicitly accepts ADR-0029.

Do not start EX-1 before ADR-0029 is accepted.

## EX-1: Transcript Visibility

Owner: execution agent.

Source task:

- `docs/superpowers/plans/2026-07-02-passthrough-route-plane.md` Task 1

Scope:

- Add `kind` and `visibility` to conversation transcript events.
- Hydrate legacy events safely.
- Render only user-visible events in Project Console.
- Keep existing legacy admin hiding as fallback.

Allowed files:

- `apps/local-server/src/storage/conversation-transcript-store.ts`
- `apps/local-server/src/storage/json-snapshot-store.ts`
- `apps/local-server/src/routes/project-console.ts`
- `tests/conversation-visibility.test.mjs`
- `tests/project-console-behavior.test.mjs`

Required tests:

```bash
node --experimental-strip-types --test tests/conversation-visibility.test.mjs tests/project-console-behavior.test.mjs
npm run typecheck
```

Expected commit:

```bash
git add apps/local-server/src/storage/conversation-transcript-store.ts apps/local-server/src/storage/json-snapshot-store.ts apps/local-server/src/routes/project-console.ts tests/conversation-visibility.test.mjs tests/project-console-behavior.test.mjs
git commit -m "feat: add conversation transcript visibility"
```

REVIEW-1 must verify:

- `instruction` events cannot render in user transcript.
- Existing returned target events still render.
- Existing bridge preview/action internals stay hidden.
- No token, cookie, action id, task id, or route id leaks into transcript.

## EX-2: Instruction Packets

Owner: execution agent.

Source task:

- `docs/superpowers/plans/2026-07-02-passthrough-route-plane.md` Task 2

Scope:

- Add internal instruction packet store.
- Create instruction packet from each conversation message.
- Persist and hydrate instruction packets.
- Do not expose instruction packet metadata through conversation message API response.

Allowed files:

- `apps/local-server/src/storage/conversation-instruction-store.ts`
- `apps/local-server/src/routes/bridge-api.ts`
- `apps/local-server/src/storage/json-snapshot-store.ts`
- `tests/conversation-route-plane.test.mjs`
- `tests/json-persistence.test.mjs`

Required tests:

```bash
node --experimental-strip-types --test tests/conversation-route-plane.test.mjs tests/json-persistence.test.mjs
npm run typecheck
```

Expected commit:

```bash
git add apps/local-server/src/storage/conversation-instruction-store.ts apps/local-server/src/routes/bridge-api.ts apps/local-server/src/storage/json-snapshot-store.ts tests/conversation-route-plane.test.mjs tests/json-persistence.test.mjs
git commit -m "feat: add internal conversation instruction packets"
```

REVIEW-2 must verify:

- Instruction payload is internal state, not transcript output.
- API response includes user message text only as user transcript event.
- `payloadHash`, instruction id, and instruction metadata do not appear in user-visible responses.
- Snapshot round trip preserves packets without token/cookie/header material.

## EX-3: Execution Packets

Owner: execution agent.

Source task:

- `docs/superpowers/plans/2026-07-02-passthrough-route-plane.md` Task 3

Scope:

- Add execution packet store.
- Convert WorkBuddy result into an execution packet.
- Render user transcript output from executor-emitted fields only.
- Preserve current WorkBuddy inbox/result protocol URL shape.

Allowed files:

- `apps/local-server/src/storage/conversation-execution-store.ts`
- `apps/local-server/src/routes/bridge-api.ts`
- `apps/local-server/src/storage/json-snapshot-store.ts`
- `tests/conversation-route-plane.test.mjs`
- `tests/conversation-execution-api.test.mjs`
- `tests/json-persistence.test.mjs`

Required tests:

```bash
node --experimental-strip-types --test tests/conversation-route-plane.test.mjs tests/conversation-execution-api.test.mjs tests/json-persistence.test.mjs
npm run typecheck
```

Expected commit:

```bash
git add apps/local-server/src/storage/conversation-execution-store.ts apps/local-server/src/routes/bridge-api.ts apps/local-server/src/storage/json-snapshot-store.ts tests/conversation-route-plane.test.mjs tests/conversation-execution-api.test.mjs tests/json-persistence.test.mjs
git commit -m "feat: add conversation execution packets"
```

REVIEW-3 must verify:

- User-visible answer body is derived from executor fields only.
- Bridge does not synthesize, summarize, or rank executor output.
- Failed executor text is shown only when it comes from executor failure fields.
- Execution packets are persisted and hydrated.

## EX-4: Single Task Routes

Owner: execution agent.

Source task:

- `docs/superpowers/plans/2026-07-02-passthrough-route-plane.md` Task 4

Scope:

- Add internal task route store.
- Support only `mode: "single"`.
- Link instruction -> route -> executor task -> execution packet.
- Keep parallel and fallback modes out of scope.

Allowed files:

- `apps/local-server/src/storage/conversation-route-store.ts`
- `apps/local-server/src/storage/conversation-action-store.ts`
- `apps/local-server/src/conversation/conversation-route-adapter.ts`
- `apps/local-server/src/conversation/conversation-route-registry.ts`
- `apps/local-server/src/routes/bridge-api.ts`
- `apps/local-server/src/storage/json-snapshot-store.ts`
- `tests/conversation-route-plane.test.mjs`
- `tests/conversation-execution-api.test.mjs`
- `tests/json-persistence.test.mjs`

Required tests:

```bash
node --experimental-strip-types --test tests/conversation-route-plane.test.mjs tests/conversation-execution-api.test.mjs tests/json-persistence.test.mjs
npm run typecheck
npm run lint
```

Expected commit:

```bash
git add apps/local-server/src/storage/conversation-route-store.ts apps/local-server/src/storage/conversation-action-store.ts apps/local-server/src/conversation/conversation-route-adapter.ts apps/local-server/src/conversation/conversation-route-registry.ts apps/local-server/src/routes/bridge-api.ts apps/local-server/src/storage/json-snapshot-store.ts tests/conversation-route-plane.test.mjs tests/conversation-execution-api.test.mjs tests/json-persistence.test.mjs
git commit -m "feat: add single conversation task routes"
```

REVIEW-4 must verify:

- Route ids stay internal.
- `mode` is only `single`.
- No parallel/fallback state is implemented.
- Duplicate dispatch does not create duplicate routes for the same action.
- Existing conversation-pairing and WorkBuddy inbox behavior still works.

## EX-5: Acceptance Gate

Owner: RP/review agent or final execution agent with review handoff.

Source task:

- `docs/superpowers/plans/2026-07-02-passthrough-route-plane.md` Task 5

Scope:

- Add deterministic acceptance script.
- Prove end-to-end local path:

```text
conversation message
-> instruction packet
-> single route
-> WorkBuddy inbox
-> WorkBuddy result
-> execution packet
-> user-visible executor_output
```

Allowed files:

- `scripts/passthrough-route-plane-acceptance.ts`
- `tests/passthrough-route-plane-acceptance.test.mjs`
- `tests/project-console-behavior.test.mjs`

Required tests:

```bash
node --experimental-strip-types scripts/passthrough-route-plane-acceptance.ts
npm run typecheck
npm run lint
npm test
git diff --check
```

Expected commit:

```bash
git add scripts/passthrough-route-plane-acceptance.ts tests/passthrough-route-plane-acceptance.test.mjs tests/project-console-behavior.test.mjs
git commit -m "test: add passthrough route plane acceptance"
```

Final REVIEW must verify:

- Full test suite passes.
- Acceptance script passes.
- Project Console shows no instruction, route, task, action, confirm, or dispatch internals.
- User-visible answer body comes from executor result fields.
- Extension did not gain mutation authority.
- No generic shell/run/exec/Git/PR/workspace mutation endpoint was added.

## Subagent Prompts

Use these prompts as the starting point for each EX agent.

### EX-1 Prompt

Implement Task 1 from `docs/superpowers/plans/2026-07-02-passthrough-route-plane.md`.
Stay within the EX-1 allowed files in `docs/planning/CLI-BRIDGE-v2.21-PASSTHROUGH-ROUTE-PLANE-EXECUTION.md`.
Use TDD: write `tests/conversation-visibility.test.mjs`, confirm failure, implement minimal code, run required tests, commit with `feat: add conversation transcript visibility`.
Do not modify route, instruction, execution packet, extension, auth, or WorkBuddy protocol code.

### EX-2 Prompt

Implement Task 2 from `docs/superpowers/plans/2026-07-02-passthrough-route-plane.md`.
Stay within the EX-2 allowed files in `docs/planning/CLI-BRIDGE-v2.21-PASSTHROUGH-ROUTE-PLANE-EXECUTION.md`.
Use TDD: extend `tests/conversation-route-plane.test.mjs`, confirm failure, add `conversation-instruction-store`, wire runtime and snapshot persistence, run required tests, commit with `feat: add internal conversation instruction packets`.
Do not expose instruction metadata in user-visible API responses.

### EX-3 Prompt

Implement Task 3 from `docs/superpowers/plans/2026-07-02-passthrough-route-plane.md`.
Stay within the EX-3 allowed files in `docs/planning/CLI-BRIDGE-v2.21-PASSTHROUGH-ROUTE-PLANE-EXECUTION.md`.
Use TDD: make WorkBuddy result create an execution packet before transcript output, run required tests, commit with `feat: add conversation execution packets`.
Do not summarize, rewrite, rank, or semantically merge executor output.

### EX-4 Prompt

Implement Task 4 from `docs/superpowers/plans/2026-07-02-passthrough-route-plane.md`.
Stay within the EX-4 allowed files in `docs/planning/CLI-BRIDGE-v2.21-PASSTHROUGH-ROUTE-PLANE-EXECUTION.md`.
Use TDD: add a single task route lifecycle test, implement `conversation-route-store`, link instruction/action/route/task/result, run required tests, commit with `feat: add single conversation task routes`.
Do not implement parallel or fallback mode.

### EX-5 Prompt

Implement Task 5 from `docs/superpowers/plans/2026-07-02-passthrough-route-plane.md`.
Stay within the EX-5 allowed files in `docs/planning/CLI-BRIDGE-v2.21-PASSTHROUGH-ROUTE-PLANE-EXECUTION.md`.
Add and run the deterministic acceptance script, run the full gate, commit with `test: add passthrough route plane acceptance`.
Report exact test counts and any residual risks.

## Stop Rules

Stop and return to RP/REVIEW if any of these occur:

- ADR-0029 is not explicitly accepted.
- A required test cannot be made green within the allowed file set.
- A task requires parallel or fallback mode.
- A task needs extension authority expansion.
- A task needs a generic shell/run/exec/Git/PR/workspace mutation endpoint.
- User-visible transcript would need bridge-authored semantic output.
- Existing conversation-pairing behavior regresses.

## Completion Criteria

The rollout is complete only when:

- ADR-0029 is accepted.
- EX-1 through EX-5 commits exist.
- Every REVIEW gate passes.
- `npm run typecheck` passes.
- `npm run lint` passes.
- `npm test` passes.
- `node --experimental-strip-types scripts/passthrough-route-plane-acceptance.ts` passes.
- `git diff --check` passes.
- Final worktree is clean.
