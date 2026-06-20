# ADR-0023: ChatGPT Web Automation Authorization Boundary

Status: Accepted

Date: 2026-06-19

Accepted: 2026-06-19 by explicit operator reply: `接受`

## Review Findings

1. **Current implementation does not yet support automatic Web submission.**
   `outbound-poller.ts` claims, fills, and acknowledges an outbound prompt, then
   records an active relay session. `chatgpt-dom.ts` only locates and fills the
   composer. The reviewed Stage A baseline contains no approved send-button
   click, keyboard simulation, `requestSubmit`, or form submission path.

2. **The server has reusable return-route foundations, but not the Stage B
   outbound lifecycle.** The current stores and routes already provide
   server-owned relay context, inbound queue routing, operation-id based
   extract-return idempotency, redaction, and endpoint ownership checks. The
   outbound record still only models `queued -> claimed -> delivered` plus
   terminal failures. It does not yet model `submitted`, `responding`,
   `response-ready`, `returned`, authorization hashes, expiration, or uncertain
   submission recovery.

3. **ADR-0002 remains the active prohibition until this ADR is accepted.**
   ADR-0002 rejected automatic ChatGPT Web send for v1.5b. This ADR does not
   authorize implementation while it is Proposed. Acceptance would supersede
   only the Web-DOM auto-send rejection in ADR-0002; all unrelated prohibitions
   remain active.

4. **The highest-risk boundary is duplicate or ambiguous submission.**
   Stage B cannot rely on broad DOM selectors, Enter-key fallback, form submit,
   or "composer cleared" alone. It needs a narrow native send-control detector
   and post-submit evidence tied to the authorized outbound.

5. **Returned ChatGPT content remains untrusted data.** Automatic return may
   enqueue an inbound message through the server-owned relay context, but it
   must not confirm pending prompts, execute commands, mutate a workspace,
   write files, commit, push, merge, create PRs, or choose a destination route
   from extension-side data.

## Context

`CLI-BRIDGE-WEB-AUTOMATION-RP.md` approves a three-stage direction:

1. Stage A: make the current poll-and-fill path observable and recoverable
   without changing the manual-send boundary.
2. Stage B: allow one authorized automatic ChatGPT Web submission and automatic
   return.
3. Stage C: allow bounded automatic loops owned by the middle layer.

The direction intentionally conflicts with ADR-0002's Web-DOM auto-send
rejection. A replacement decision is required before Stage B execution can pass
review.

## Decision

CLI Bridge may proceed with ChatGPT Web automation under this boundary:

1. Stage A may implement reliability, observability, reconnect, cancellation,
   timeout, and sanitized acceptance evidence for the existing automatic-fill
   path. Stage A must preserve manual send. No code in Stage A may click the
   send control, synthesize keyboard submission, call `requestSubmit`, submit a
   form, or create an automatic inbound return.

2. Stage B may implement exactly one automatic ChatGPT Web submission per
   accepted outbound authorization. The middle layer's outbound record is the
   authorization. The extension must not ask for a second approval before
   submitting that authorized outbound.

3. Stage B may automatically return the matching ChatGPT assistant reply to the
   server-owned relay context. The return is data ingestion only; it grants no
   execution, confirmation, workspace, terminal, Git, MCP, or PR authority.

4. Stage C may implement bounded automatic loops only after Stage A and Stage B
   pass their reviews and after loop policy is refined in `RP-WEB-AUTO-C`.
   Loop ownership belongs to the middle layer. The extension transports only
   one authorized round at a time.

## Superseded Portion of ADR-0002

On acceptance, this ADR supersedes only these ADR-0002 positions:

- "automatic ChatGPT Web send" as a rejected route;
- "send-button click automation" as categorically rejected.

The replacement is narrower: automatic ChatGPT Web submission is allowed only
for Stage B and Stage C records that satisfy this ADR's authorization,
idempotency, DOM certainty, audit, and recovery requirements.

All other ADR-0002 rejections remain active:

- generic command, shell, run, or exec HTTP endpoints;
- user-provided commands or arbitrary argv;
- dangerous permission bypass flags;
- automatic source-agent feedback outside the approved Web relay;
- unbounded loops.

## Stage B Authorization Requirements

An outbound authorization must be created and owned by the middle layer. It
must include:

- `outboundPromptId`;
- `sessionId`;
- target `chatgpt-web`;
- redacted content hash;
- expiration time;
- a claim or submission lease;
- server-side audit metadata.

The extension may submit only when all of the following are true:

- the claimed outbound is current, unexpired, and targets `chatgpt-web`;
- the composer text exactly matches the authorized redacted content hash;
- ChatGPT is not already streaming;
- exactly one visible, enabled, native ChatGPT send control is identified;
- no pause, cancel, disconnect, navigation uncertainty, or active conflicting
  session exists.

Any mismatch, ambiguity, expiration, stale claim, or content change fails
closed. A failed or uncertain submission must not be retried automatically.

## ChatGPT DOM Rules

Allowed:

- narrow, fixture-covered selectors for the composer, native send control,
  latest user message, assistant response, and streaming state;
- a single native click on the approved send control after authorization and
  composer-hash verification;
- read-only observation of visible ChatGPT page state needed to prove
  submitted/responding/response-ready/returned transitions.

Forbidden:

- Enter-key, keyboard, or shortcut simulation;
- `requestSubmit`, `.submit()`, or generic form submission;
- broad "first button" or text-label-only send selectors;
- cookie, localStorage, sessionStorage, token, account, or page-secret reads;
- hidden controls or disabled controls;
- retrying a submission after ambiguous page evidence.

## Automatic Return Requirements

The extension may return only the assistant response that is associated with the
submitted outbound:

- wait until streaming has ended;
- require stable non-empty assistant content;
- reject stale, ambiguous, empty, or multi-candidate responses;
- send through the existing server-owned relay context;
- include the outbound identity as the operation id;
- store only redacted processed content and audit metadata.

The server must create at most one inbound message for an outbound operation.
Same-content duplicate returns are idempotent replays. Changed duplicate returns
are conflicts and stop the session.

## Stage C Loop Requirements

Stage C is not authorized for implementation by this ADR alone. After Stage B
review, `RP-WEB-AUTO-C` must refine loop policy using observed Stage B evidence.
The later loop design must preserve these minimum requirements:

- one explicit start authorization tied to a Goal and loop limit;
- default maximum `3` rounds and hard maximum `10`;
- per-round timeout and total deadline;
- pause/cancel wins before any next claim or submission;
- one active round per loop and one submission owner per outbound;
- restart recovery never replays uncertain submitted rounds;
- returned model content is evidence, not execution authority.

## Account, Privacy, and Prompt-Injection Risks

Account risk cannot be eliminated in code. The feature drives a logged-in
ChatGPT Web session and may conflict with service expectations or account
automation limits. Operators must treat the feature as explicit opt-in and must
retain visible status and audit evidence.

Prompt-injection risk is contained by routing returned content only as untrusted
inbound data. Returned content cannot directly execute terminal commands,
confirm pending prompts, mutate files, or expand capability scope.

Privacy risk is contained by redaction, no raw unredacted persistence, no page
secret access, no endpoint routing from the extension, and sanitized acceptance
reports.

## Acceptance Conditions

This ADR can be accepted only by explicit human review. Acceptance means:

- ADR-0002's Web-DOM auto-send prohibition is replaced only within this ADR's
  narrow boundary;
- Stage A execution is authorized;
- Stage B implementation remains blocked until Stage A passes
  `REVIEW-WEB-AUTO-A`;
- Stage C implementation remains blocked until Stage B passes review and
  `RP-WEB-AUTO-C` completes.

## EX-WEB-AUTO-A Prompt

```text
EX-WEB-AUTO-A - Implement Stage A reliability and evidence only.

Allowed files:
- apps/extension/src/content/active-relay-session.ts
- apps/extension/src/content/bridge-client.ts
- apps/extension/src/content/chatgpt-dom.ts
- apps/extension/src/content/extraction.ts
- apps/extension/src/content/index.ts
- apps/extension/src/content/outbound-poller.ts
- apps/extension/src/ui/bridge-panel.tsx
- apps/extension/src/ui/state.ts
- apps/local-server/src/routes/bridge-api.ts
- apps/local-server/src/storage/audit-log.ts
- apps/local-server/src/storage/outbound-prompt-store.ts
- packages/shared/src/schemas.ts
- packages/shared/src/types.ts
- tests/active-relay-session.test.mjs
- tests/background-proxy.test.mjs
- tests/bridge-api.test.mjs
- tests/bridge-client.test.mjs
- tests/chatgpt-dom.test.mjs
- tests/extension-build.test.mjs
- tests/extension-loop-panel.test.mjs
- tests/outbound-poller.test.mjs
- narrowly required Stage A docs or acceptance script/report files

Forbidden:
- send-button click automation;
- keyboard simulation;
- requestSubmit or form submission;
- automatic inbound return;
- MCP, arbitrary shell, terminal control, workspace write, commit, push, merge,
  PR, or external deployment scope;
- Stage B or Stage C state transitions beyond read-only placeholders needed to
  report Stage A status.

Required implementation:
- define one relay-session state machine for pairing, claim, fill, ack, wait,
  failure, cancellation, reconnect, and completion evidence;
- preserve existing claim lease and duplicate-poller protections;
- detect disconnects and resume polling after valid re-pair;
- record sanitized state transitions and failure reasons;
- expose read-only status for Project Console and acceptance tools;
- produce an automated acceptance report with no pairing tokens and no raw
  content.

Required tests:
- existing extension and server tests remain green;
- new tests cover duplicate claims, reconnect, navigation, streaming, timeout,
  cancellation, and evidence redaction;
- source-boundary tests prove no send-button click, keyboard submission,
  requestSubmit, or form submission exists in the Stage A diff.

Required runtime evidence:
- run `npm run typecheck`;
- run `npm test`;
- run `npm run build-extension`;
- perform a real Chrome ChatGPT run proving claim, fill, ack, and failure
  recovery without automatic send.

Return control to REVIEW-WEB-AUTO-A with changed files, tests, boundary
evidence, Chrome evidence, and unresolved risks.
```
