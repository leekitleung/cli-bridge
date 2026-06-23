# RP: Real-Evidence Gate Reform

Status: ADOPTED

Date: 2026-06-23

Owner: reviewing/planning agent

## Context

`EX-E-REAL-EVIDENCE-RERUN` proved that the previous closeout gate is too
dependent on fragile browser state. The run on 2026-06-23 produced deterministic
contract evidence for seven scenarios, but the release gate still blocked on:

- `cli-route`: `confirmation-timeout` because the human confirmation card was
  not confirmed before the harness timeout.
- `chatgpt-route`: `blocked-real-chatgpt` because the logged-in browser/profile
  path failed while navigating to ChatGPT (`ERR_CONNECTION_CLOSED`).

Neither result showed a product-code boundary violation. They showed that the
release decision was coupled to human browser state, external login state,
network reachability, and timing. Those are valid environment signals, but they
are not stable enough to be the default blocking release gate.

## Decision

Adopt a two-layer evidence model for dual-endpoint automation closeout.

### Layer 1: deterministic release gate

This layer is blocking. It must be repeatable on a normal development or CI
host without a logged-in browser session.

It validates:

- typecheck and extension build;
- focused dual-endpoint harness tests;
- source-boundary scans for dangerous flags, auto-confirm, direct submit/send,
  and direct execution-proposal confirm/dispatch shortcuts;
- deterministic scenario evidence for binding lock, same-provider and
  mixed-provider binding, fail-closed timeout/uncertain/cancel behavior,
  WorkBuddy non-execution, cleanup, sanitizer behavior, and `relaySeam` shape;
- no product, harness, dependency, or runbook mutation inside evidence-capture
  batches;
- no sensitive evidence output (pairing tokens, cookies, credentials, raw
  provider config, raw prompts/replies/transcripts, private profile contents).

Layer 1 is enough to unblock deterministic closeout if it passes.

### Layer 2: real browser environment evidence

This layer is non-blocking by default. It is still valuable and should be
captured when a suitable environment exists, but it must be recorded as
environment evidence rather than the primary release gate.

It may include:

- real ChatGPT Web profile or CDP runs;
- manual `/console/goals` confirmation;
- screenshots and per-scenario evidence under
  `output/playwright/dual-endpoint-automation/**`;
- explicit environment-blocked records when login, network, CDP, browser
  profile, ChatGPT navigation, or human confirmation timing is unavailable.

Layer 2 becomes blocking only when the release scope explicitly says that real
ChatGPT Web end-to-end evidence is required for that release.

## Gate Semantics

`REVIEW-E-REAL-EVIDENCE` is replaced by `REVIEW-DETERMINISTIC-EVIDENCE` for the
default closeout path.

`REVIEW-DETERMINISTIC-EVIDENCE` passes only if all are true:

1. `npm run typecheck` passes.
2. `npm run build-extension` passes.
3. `node --experimental-strip-types --test tests/*dual-endpoint-release-e2e*.test.mjs`
   passes.
4. `npm test` has no new failures beyond the documented environmental baseline
   accepted by RP.
5. Source-boundary scans find no auto-confirm, dangerous flags, shell bypass,
   direct submit/send automation, or execution-proposal confirm/dispatch
   shortcuts.
6. Contract evidence covers all non-browser scenarios and shows fail-closed
   behavior where expected.
7. `relaySeam` is validated at the harness contract level: field shape,
   sanitizer preservation, and absence on non-`chatgpt-route` evidence.
8. Evidence outputs and logs are sanitized.
9. Cleanup leaves no harness-owned server/browser/CLI process.

`REVIEW-DETERMINISTIC-EVIDENCE` blocks if any deterministic safety boundary
fails, including:

- auto-confirm or direct execution-proposal confirm/dispatch;
- endpoint binding replacement after approval;
- WorkBuddy accepted as an executor;
- fail-closed scenarios retrying or dispatching;
- unsafe source patterns;
- sanitizer leakage;
- process leaks not documented as external environment exceptions;
- any code/doc/dependency mutation in an evidence-only batch.

`REVIEW-DETERMINISTIC-EVIDENCE` does not block solely because real ChatGPT Web,
CDP, login, browser navigation, or human confirmation timing is unavailable.
Those are recorded as Layer 2 `ENV-BLOCKED` evidence.

## Required Documentation Changes

The existing `RP-DUAL-ENDPOINT-REAL-EVIDENCE-CLOSEOUT.md` remains the history of
the prior real-evidence recovery. It should be amended to state that this RP
supersedes the default `REVIEW-E-REAL-EVIDENCE` blocking rule.

The dual-endpoint runbook should keep the real-browser commands, but label them
as environment evidence unless a release explicitly promotes Layer 2 to a hard
gate.

## Execution Prompt: EX-GATE-REFORM-DOCS

Owner: execution agent.

Allowed files:

- `docs/planning/RP-DUAL-ENDPOINT-REAL-EVIDENCE-CLOSEOUT.md`
- `docs/runbooks/dual-endpoint-automation.md`
- `docs/reviews/REVIEW-DUAL-ENDPOINT-AUTOMATION-CONTROL-E-REAL-EVIDENCE.md`

Scope:

- Documentation only.
- No product code, harness code, tests, dependencies, generated evidence, or
  screenshots.

Required edits:

1. Add a short supersession note to the closeout RP, pointing to this decision
   and naming the two-layer gate.
2. Rename the default closeout review target from hard
   `REVIEW-E-REAL-EVIDENCE` to `REVIEW-DETERMINISTIC-EVIDENCE`.
3. Preserve real browser evidence commands as optional Layer 2 environment
   evidence.
4. Clarify that `blocked-real-chatgpt`, CDP unavailability, login expiry,
   ChatGPT navigation failure, and human confirmation timeout are `ENV-BLOCKED`
   unless the release explicitly requires real ChatGPT Web evidence.
5. Keep the anti-scope-creep rule: no code fix may be made inside an evidence
   capture batch.

Verification:

```bash
rg -n "REVIEW-E-REAL-EVIDENCE|REVIEW-DETERMINISTIC-EVIDENCE|ENV-BLOCKED|Layer 2|real browser" docs/planning/RP-DUAL-ENDPOINT-REAL-EVIDENCE-CLOSEOUT.md docs/runbooks/dual-endpoint-automation.md docs/reviews/REVIEW-DUAL-ENDPOINT-AUTOMATION-CONTROL-E-REAL-EVIDENCE.md
git diff --check
```

Report back:

- changed docs;
- exact new default gate name;
- whether any old hard-gate wording remains intentionally as historical text;
- verification output summary.
