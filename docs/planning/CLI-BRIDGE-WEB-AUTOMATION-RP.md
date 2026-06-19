# CLI Bridge Web Automation RP

Status: RP direction approved; implementation not yet authorized  
Date: 2026-06-19

## 1. Decision Summary

CLI Bridge will advance ChatGPT Web automation in three gated stages:

1. reliable transport observability;
2. one-round automatic Web relay;
3. bounded automatic loops.

Creating an outbound request in the middle layer is the authorization to use
ChatGPT Web for that request. The extension must not ask for a second approval
before submitting it. A completed ChatGPT reply may return automatically to the
middle layer because that return is data ingestion, not execution authority.

Each automatic loop requires one explicit start authorization tied to a Goal
and a configured round limit. Once started, individual rounds do not require
additional confirmation.

This direction conflicts with the active ADR-0002 prohibition on Web DOM
automatic send. A replacement or amendment ADR must be reviewed before any
Stage B implementation begins.

## 2. Invariants

- The extension is a transport adapter, not the loop decision maker.
- Returned ChatGPT content is untrusted model output.
- Automatic return must not directly execute a command, mutate a workspace,
  confirm a pending prompt, commit, push, merge, or create a PR.
- No generic shell, exec, command, terminal attachment, cookie, localStorage,
  or page-secret access is introduced.
- Raw unredacted content is not persisted.
- Every outbound submission and inbound return is idempotent and auditable.
- Ambiguous page state fails closed.
- A stop or pause request wins over claiming or submitting the next round.

## 3. Stage A - Reliability and Evidence

### Goal

Make the existing poll-and-fill path observable and recoverable without
changing the manual-send boundary.

### Required behavior

- Define one relay-session state machine for pairing, claim, fill, ack, wait,
  failure, cancellation, and completion evidence.
- Detect disconnects and resume polling after a valid re-pair.
- Preserve the existing claim lease and duplicate-poller protections.
- Record sanitized state transitions and failure reasons.
- Expose enough read-only status for the Project Console and acceptance tools.
- Produce an automated acceptance report without pairing tokens or raw content.

### Exit gate

- Existing extension and server tests remain green.
- New tests cover duplicate claims, reconnect, navigation, streaming, timeout,
  cancellation, and evidence redaction.
- A real Chrome run proves claim, fill, ack, and failure recovery.
- No send-button click, `requestSubmit`, form submission, or keyboard simulation
  exists in the Stage A diff.

## 4. Stage B - One-Round Automatic Web Relay

### Authorization model

An accepted middle-layer outbound record is the single authorization for one
Web submission. Authorization is bound to:

- `outboundPromptId`;
- `sessionId`;
- redacted content hash;
- target `chatgpt-web`;
- expiration time.

Any mismatch or content change invalidates the authorization.

### State model

```text
queued
  -> claimed
  -> filled
  -> submitted
  -> responding
  -> response-ready
  -> returned

Any active state -> cancelled | expired | failed
```

### Submission rules

- Submit only after the filled composer text matches the authorized hash.
- Use one narrowly identified, visible, enabled native ChatGPT send control.
- Do not submit while ChatGPT is already streaming.
- Never fall back to Enter-key simulation, broad button selection,
  `requestSubmit`, or form submission.
- Mark `submitted` only after page evidence shows the prompt became the latest
  user message or the composer cleared in the expected conversation state.
- Never retry a submission whose result is uncertain; stop for recovery.

### Automatic return rules

- Observe the assistant response associated with the submitted user message.
- Wait until streaming has ended and the response content is stable.
- Reject empty, ambiguous, stale, or multi-candidate responses.
- Route through the existing server-owned relay context; the extension must not
  choose the destination endpoint.
- Redact before storage and create at most one inbound message per outbound.
- A duplicate return with the same identity is an idempotent replay; a changed
  return for the same identity is a conflict and stops the session.

### Exit gate

- Deterministic DOM fixtures cover all selectors and uncertainty branches.
- Server tests cover authorization, expiration, state transitions, idempotency,
  conflicts, cancellation, and audit redaction.
- A real logged-in Chrome run proves outbound through inbound with no extension
  interaction after initial pairing.
- The replacement ADR is accepted before execution review can pass.

## 5. Stage C - Bounded Automatic Loops

### Loop ownership

The middle layer owns loop policy and creates each next outbound. The extension
only transports one authorized round at a time.

### Loop specification

Every loop is bound to a project and Goal and includes:

- `loopId`, `projectId`, `goalId`, and current `round`;
- requested `maxRounds`, default `3`, hard maximum `10`;
- per-round timeout and total deadline;
- total content/token budget;
- allowed endpoint route;
- explicit stop conditions;
- status and last-progress evidence.

### Mandatory stop conditions

- Goal-completion decision;
- configured maximum rounds, deadline, or budget reached;
- user pause or cancel;
- repeated outbound or inbound content hash;
- no-progress threshold;
- empty, ambiguous, rejected, or unsafe response;
- pairing loss, navigation, server restart uncertainty, or transport conflict;
- any execution or approval requirement outside the loop's authority.

### Recovery and concurrency

- Persist sanitized loop metadata and processed content only.
- Use per-round leases and compare-and-set transitions.
- Permit only one active round per loop and one submission owner per outbound.
- After restart, uncertain `submitted` rounds stop for review; they are never
  automatically replayed.
- Pause/cancel invalidates unclaimed work and prevents the next outbound.

### Completion authority

A deterministic rule may stop a loop directly. A model-produced completion
claim is evidence, not authority, until validated by the middle-layer policy.
Completion must not imply terminal execution or workspace mutation.

### Exit gate

- Model-based and deterministic test suites cover max-round, no-progress,
  repeated-content, timeout, restart, race, cancel, and uncertain-submit cases.
- A controlled real Chrome test completes at least two rounds and proves the
  hard stop.
- No test or runtime path can exceed the hard maximum of ten rounds.

## 6. Required Review Flow

1. `RP-WEB-AUTO-ADR`: draft and review the ADR replacing the ADR-0002 Web-send
   prohibition. No implementation.
2. `EX-WEB-AUTO-A`: implement Stage A only.
3. `REVIEW-WEB-AUTO-A`: review real diff, tests, and Chrome evidence.
4. `EX-WEB-AUTO-B`: implement Stage B only after Stage A acceptance and ADR
   acceptance.
5. `REVIEW-WEB-AUTO-B`: review one-round real-browser evidence.
6. `RP-WEB-AUTO-C`: refine loop policy from observed Stage B behavior.
7. `EX-WEB-AUTO-C`: implement bounded loops only.
8. `REVIEW-WEB-AUTO-C`: review multi-round stop and recovery evidence.

No execution batch may continue into the next stage without its intervening
review batch.

## 7. Explicit Non-Goals

- Arbitrary browser automation outside ChatGPT Web.
- Invisible global always-on loops.
- Unlimited rounds or unattended recovery from uncertain submission.
- Automatic execution of returned content.
- Generic filesystem, shell, terminal, Git write, or deployment authority.
- MCP or local project-context implementation in these Web automation stages.

## 8. Next Batch Prompt

```text
RP-WEB-AUTO-ADR - Review and draft the architecture decision that would replace
the ADR-0002 prohibition on automatic ChatGPT Web submission.

Allowed files:
- docs/planning/ADR-0001-v1.5-automation-boundary.md
- docs/planning/ADR-0002-v1.5b-command-transport.md
- one new ADR under docs/planning/
- this RP document only if review findings require correction

Required review:
- inspect the current outbound poller, ChatGPT DOM adapter, active relay session,
  outbound/inbound stores, route guards, audit types, tests, and real-browser
  evidence;
- enumerate account, DOM ambiguity, duplicate-send, prompt-injection, restart,
  privacy, and loop-escalation risks;
- decide whether the Stage B authorization and fail-closed design is acceptable;
- preserve all hard prohibitions unrelated to Web transport;
- define exact prerequisites for Stage A and Stage B execution batches.

Forbidden:
- implementation code;
- accepting the ADR without an explicit review decision;
- automatic terminal or workspace execution;
- MCP or project-context scope;
- Stage C implementation planning beyond its policy prerequisites.

Output:
- findings first;
- ADR decision or required revisions;
- if approved, a bounded EX-WEB-AUTO-A prompt with allowed files, explicit
  non-goals, focused tests, full gates, real Chrome evidence, and return to
  REVIEW-WEB-AUTO-A.
```
