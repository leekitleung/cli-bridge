# RP-WEB-AUTO-C - Bounded Automatic Loop Policy

Status: READY-FOR-EX

Date: 2026-06-19

## Review Basis

Stage A and Stage B are accepted:

- `docs/reviews/REVIEW-WEB-AUTO-A.md` is `PASS`.
- `docs/reviews/REVIEW-WEB-AUTO-B.md` is `PASS`.
- Stage B real Chrome-for-Testing evidence:
  `output/playwright/stage-b-cft-one-round.png`.

Stage C may implement bounded loops, but only within the loop policy below.

## Product Boundary

The middle layer owns loop policy. The extension remains a one-round transport:

```text
server creates exactly one authorized outbound
extension fills/submits/returns exactly that outbound
server decides whether another round is allowed
```

Returned ChatGPT content is evidence for the next middle-layer decision. It is
not execution authority and cannot confirm prompts, mutate files, run commands,
choose endpoints, or expand capabilities.

## Stage C Loop Model

Introduce a server-owned loop record:

```text
loopId
projectId
goalId
sessionId
endpointId
status: queued | running | paused | cancelling | cancelled | done | failed
round: number
maxRounds: number       default 3, hard maximum 10
perRoundTimeoutMs
totalDeadlineAt
noProgressLimit
lastProgressHash
seenContentHashes
currentOutboundPromptId?
createdAt / updatedAt
evidence[]
```

Allowed loop transitions:

```text
queued -> running
running -> paused
paused -> running
running|paused -> cancelling -> cancelled
running -> done
running -> failed
```

Allowed round transitions remain the Stage B outbound state machine. Stage C
must not add new extension-side submission authority.

## Stop Conditions

The server must stop before creating the next outbound when any condition is
true:

- `round >= maxRounds`;
- `maxRounds > 10` was requested;
- total deadline reached;
- per-round timeout reached;
- user paused or cancelled the loop;
- inbound content hash repeats;
- no-progress threshold reached;
- inbound response is empty, ambiguous, rejected, unsafe, or conflicts with an
  existing return;
- current outbound is uncertain after restart, especially `submitted` or
  `responding`;
- pairing loss, navigation uncertainty, active transport conflict, or server
  restart uncertainty is detected;
- the next action would require shell, MCP, workspace write, Git, PR, merge,
  deployment, or human approval authority.

## Recovery Policy

On server restart or store hydration:

- loops with no active outbound may resume only from sanitized persisted loop
  metadata;
- loops with `submitted`, `responding`, or otherwise uncertain active outbound
  must stop as `failed` or `paused` for review;
- no outbound may be replayed automatically after an uncertain submission;
- cancelled loops invalidate unclaimed work and prevent new outbound creation.

## EX-WEB-AUTO-C Prompt

Implement Stage C bounded loops only.

Allowed files:

- `packages/shared/src/types.ts`
- `packages/shared/src/schemas.ts`
- `apps/local-server/src/storage/*loop*`
- `apps/local-server/src/storage/outbound-prompt-store.ts`
- `apps/local-server/src/routes/bridge-api.ts`
- `apps/extension/src/content/outbound-poller.ts` only if needed to preserve
  one-round transport observability; do not add new submission authority
- focused tests under `tests/*loop*.test.mjs`, `tests/bridge-api.test.mjs`,
  `tests/outbound-poller.test.mjs`, and existing boundary tests
- this planning/review documentation

Forbidden scope:

- MCP integration;
- arbitrary browser automation outside ChatGPT Web;
- shell, terminal, command execution, workspace write, Git commit/push/merge,
  PR creation, deployment, or automatic approval;
- extension-side loop policy ownership;
- hidden always-on loops;
- any path that can exceed ten rounds;
- automatic retry after uncertain submit.

Implementation requirements:

1. Add server-owned loop storage with sanitized reports and evidence.
2. Add HTTP routes to create/start, pause, resume, cancel, status/report, and
   advance one loop round.
3. Enforce default `maxRounds = 3` and hard `maxRounds <= 10`.
4. Create at most one outbound per active loop round.
5. Use content hashes to stop repeated-content loops.
6. Enforce per-round timeout and total deadline.
7. Make pause/cancel win before any next claim or submission.
8. Ensure restart recovery never replays uncertain `submitted` or `responding`
   rounds.
9. Preserve Stage B one-round authorization, return idempotency, and endpoint
   routing boundaries.
10. Keep all returned content as untrusted inbound evidence only.

Required verification:

- `npm run typecheck`
- `npm test`
- `npm run build-extension`
- boundary scan:

  ```bash
  rg -n "requestSubmit|KeyboardEvent|\\.submit\\(|localStorage|document\\.cookie|CodexManaged|MockAgent|/bridge/run|/bridge/shell|/bridge/exec" apps/extension/src apps/extension/dist
  ```

- deterministic tests for max rounds, hard max 10, per-round timeout, total
  deadline, pause, cancel, repeated content, no progress, idempotent duplicate
  return, changed duplicate conflict, restart uncertainty, and race prevention.
- controlled logged-in Chrome-for-Testing E2E that completes at least two
  rounds and proves the hard stop.

## REVIEW-WEB-AUTO-C Gate

Review must inspect:

- real diff and call chains;
- loop state transitions and storage hydration;
- tests and runtime evidence;
- Chrome E2E multi-round evidence;
- historical boundary checklist from Stage A/B:
  - no endpoint id in extension-owned active relay session;
  - no extension routing decision;
  - no browser secret reads;
  - no Enter-key, `requestSubmit`, or form `.submit()` fallback;
  - no shell/run/workspace/Git/MCP authority;
  - no automatic replay after uncertain submission.

Stage C passes only if all required verification is green and the real Chrome
E2E proves bounded multi-round behavior plus hard-stop enforcement.
