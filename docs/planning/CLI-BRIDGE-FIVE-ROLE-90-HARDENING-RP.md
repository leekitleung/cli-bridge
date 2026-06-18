# CLI Bridge Five-Role 90+ Hardening RP

**Date**: 2026-06-18

**Status**: APPROVED FOR BOUNDED EXECUTION

## Goal

Raise the finished product to at least 90/100 with no red lines from five
independent reviewers: heavy vibe coder, native visual designer, zero-document
new user, ten-year terminal veteran, and destructive quality officer.

## Fixed boundaries

The work must preserve:

- no automatic ChatGPT send;
- no automatic clipboard write;
- no endpoint selection or `endpointId` in the content script;
- server-owned return routing;
- explicit preview and confirmation before return;
- loopback-only server binding;
- pairing-token authentication;
- no generic shell endpoint or arbitrary command execution;
- no automatic terminal injection, commit, push, merge, or PR action.

## Approaches considered

1. **Patch only visible issues.** Fast, but leaves security and lifecycle red
   lines. Rejected.
2. **Shrink the declared product scope.** Would hide rather than fix shipped
   surfaces and contradict the requested finished-product review. Rejected.
3. **Risk-first hardening followed by a coherent workflow redesign.**
   Recommended: repair authority, data integrity, and process lifecycle first;
   then build the visual/state experience on stable contracts.

## EX-90-1 - Authority, idempotency, persistence, secrets

### Allowed scope

- relay/outbound/extract-return contracts and directly affected stores;
- extension pairing storage and return operation identifiers;
- JSON snapshot writer/reader and persistence error propagation;
- redaction rules;
- directly affected tests and runbook text.

### Required behavior

1. HTTP outbound creation no longer accepts an endpoint identifier. A trusted
   runtime option chooses the inbound endpoint, and invalid configuration fails
   closed.
2. Pairing state uses session-only extension storage, never persistent local
   storage.
3. Extract-return carries a server-issued outbound operation identifier.
   Repeating the same confirmed return yields the original result and never a
   second inbound message.
4. Snapshot updates use same-directory temporary write, flush, atomic rename,
   and a recoverable backup. Corrupt primary data restores from backup or fails
   startup; it never silently starts empty.
5. Persistence failures are observable and cannot be reported as successful
   durable mutations.
6. Redaction covers common AWS access keys, Slack tokens, npm tokens,
   authorization headers, cookies, and existing formats.

### Forbidden scope

- UI redesign;
- terminal/process changes;
- new endpoint types;
- auto-send or executor pull implementation.

### Verification

- red/green regression tests for every required behavior;
- focused security, snapshot, relay, and extension client tests;
- full lint, typecheck, build, and test gate.

## REVIEW-90-1

Replay the historical boundary list:

- pairing token remains the auth gate;
- no `endpointId` in content script;
- failed ack creates no relay context;
- claim token and lease fencing remain intact;
- no auto-send or automatic clipboard write;
- snapshot schemas remain backward compatible or fail explicitly.

Only REVIEW-90-1 may authorize EX-90-2.

## EX-90-2 - Terminal and lifecycle hardening

### Allowed scope

- command/profile process runners;
- configured launcher lifecycle;
- review HTTP workflow;
- remote-review gate;
- directly affected tests and operator documentation.

### Required behavior

1. Timeout terminates the entire spawned process tree, waits for close, and
   escalates after a bounded grace period.
2. Launcher bootstrap failure closes the server before returning nonzero.
3. Launcher handles SIGINT/SIGTERM with bounded graceful shutdown.
4. Review HTTP timeout spans connection and body consumption and returns a
   stable nonzero diagnostic.
5. Every remote gate subprocess has a timeout.
6. Missing or pending required CI evidence cannot produce PASS or exit zero.
7. Output caps use a shared byte budget across stdout and stderr.

### Forbidden scope

- widening command allowlists;
- shell execution;
- attach-to-existing-terminal;
- UI redesign.

### Verification

Use real temporary child/grandchild, ignored-SIGTERM, hung HTTP, failed
bootstrap, and hung remote-command probes in addition to unit tests.

## REVIEW-90-2

Replay `shell:false`, structured argv, cwd containment, env allowlist,
timeout-spans-body, at-most-one retry, redaction, and no orphan process
boundaries. Only REVIEW-90-2 may authorize EX-90-3.

## EX-90-3 - Product workflow and visual finish

### Direction

Use a restrained **native utility console** aesthetic: host-aware dark/light
theme, compact collapsed affordance, deliberate monospace accents, one active
primary action, and explicit numbered stages. Avoid a generic floating form or
decorative visual effects that compete with ChatGPT.

### Allowed scope

- extension panel, popup, state and poller event contracts;
- project console responsive navigation and status presentation;
- one discoverable repository start command and in-product first-run guidance;
- UI fixtures, interaction tests, and current screenshots.

### Required behavior

1. Panel stages read as: connect, send to ChatGPT, select/preview, confirm
   return. Only the current action is primary.
2. Poller fill/ack/failure updates the visible state immediately.
3. Return confirmation has an in-flight lock, disabled state, and explicit
   failure/retry feedback.
4. Unpaired actions are disabled with a direct recovery instruction.
5. Panel follows host color scheme, can collapse, does not obscure the primary
   composer, and meets readable contrast/target sizes.
6. Mobile project console exposes current project, switching, history, and
   facts through an equivalent compact navigation surface.
7. Connection states use text plus icon/shape, never color alone.
8. Product language is consistent and explains command outcomes without a
   separate document.
9. `npm start` is the single repository launch entry and opens the console by
   default while preserving safe configuration checks.

### Forbidden scope

- auto-send;
- endpoint selection;
- persistence or terminal architecture changes;
- speculative dashboards or animation frameworks.

### Verification

- interaction tests for double-click, stale-state, auth errors, and each stage;
- accessibility/source assertions;
- real desktop and mobile browser screenshots;
- real ChatGPT extension panel and popup evidence;
- full local gate.

## Final five-role gate

After all three reviews pass:

1. collect current real-product screenshots and runtime evidence;
2. give every role the same evidence manifest and scoring rule;
3. run five independent reviews;
4. if any role is below 90 or reports a red line, open a bounded follow-up EX
   containing only those findings and repeat all five reviews;
5. publish scores, evidence, caveats, commits, remote synchronization, and CI
   status. Missing required evidence remains a failure, not a warning pass.

