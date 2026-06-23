# REVIEW: Dual-Endpoint Automation Control

Status: PASS-DETERMINISTIC-EVIDENCE

Date: 2026-06-20

Updated: 2026-06-23 — default closeout gate superseded by
`docs/planning/RP-REAL-EVIDENCE-GATE-REFORM.md`; Layer 1 deterministic evidence
passed in `docs/reviews/REVIEW-DETERMINISTIC-EVIDENCE.md`.

Reviewed scope:

- `docs/planning/ADR-0024-dual-endpoint-middle-layer-automation-control.md`
- `docs/planning/RP-DUAL-ENDPOINT-AUTOMATION-CONTROL.md`
- `docs/reviews/REVIEW-DUAL-ENDPOINT-AUTOMATION-CONTROL-A.md`
- `docs/reviews/REVIEW-DUAL-ENDPOINT-AUTOMATION-CONTROL-B.md`
- `docs/reviews/REVIEW-DUAL-ENDPOINT-AUTOMATION-CONTROL-C.md`
- `docs/reviews/REVIEW-DUAL-ENDPOINT-AUTOMATION-CONTROL-D.md`
- `scripts/dual-endpoint-release-e2e.ts`
- `tests/dual-endpoint-release-e2e.test.mjs`
- `docs/runbooks/dual-endpoint-automation.md`
- `package.json`

## Findings

### Supersession — 2026-06-23

The original finding below remains historically accurate for the previous hard
real-browser gate. It is superseded for default closeout by the adopted
two-layer gate:

- Layer 1 deterministic evidence is blocking and has passed.
- Layer 2 real browser / logged-in ChatGPT evidence is recorded as
  `ENV-BLOCKED` when unavailable, unless a release explicitly promotes it to a
  hard gate.

1. BLOCKED: Real-chain release evidence is missing.

   RP-DUAL-ENDPOINT-AUTOMATION-CONTROL requires sanitized real evidence for
   both a logged-in high-tier CLI reasoning route and a logged-in ChatGPT Web
   route before the final review may pass. The harness and runbook now exist,
   but the actual run in this environment produced blocked evidence because no
   real high-tier reasoning CLI endpoint, medium/low execution CLI endpoint, or
   logged-in ChatGPT profile/CDP browser was provided.

## Passed Evidence

- REVIEW-A through REVIEW-D each inspected the actual repository state, real
  diffs, call chains, tests, and phase boundaries before advancing.
- Both upper reasoning routes share the same middle-layer artifact/proposal
  contract in the implemented server model.
- Endpoint binding creation, locking, and proposal confirmation are server-owned
  and content/binding hash checked.
- Execution dispatch remains behind unique operator confirmation and the
  extension cannot confirm, edit, dispatch, select endpoints, mutate
  permissions, or choose project roots.
- Pause/cancel controls are available through server APIs and extension payloads
  are limited to proposal id plus optional reason.
- WorkBuddy remains non-executing and is rejected as an execution endpoint in
  the implemented capability gates.
- EX-E added a repeatable release harness entry point, scenario contract tests,
  evidence redaction, blocked-evidence classification, and a runbook with
  prerequisites, commands, human confirmation steps, expected outputs, cleanup,
  and troubleshooting.

## Blocked Evidence

```bash
npm run dual-endpoint:e2e -- --scenario all
```

Result: BLOCKED evidence generated. The command reported:

- `cli-route`: `blocked-real-cli`
- `chatgpt-route`: `blocked-real-chatgpt`
- `same-provider`: `blocked-real-cli`
- `mixed-provider`: `blocked-real-cli`
- `failure-timeout`: `blocked-real-cli`
- `uncertain-dispatch`: `blocked-real-cli`
- `control-pause-cancel`: `blocked-real-cli`
- `workbuddy-boundary`: `blocked-real-cli`
- `cleanup`: `blocked-real-cli`

Latest blocked evidence JSON was written under:

```text
output/playwright/dual-endpoint-automation/2026-06-20T07-21-39-097Z-*.json
```

This is the correct result for the current environment. It is not a simulated
release pass. The blocked evidence includes `failureClassification` and
`processExitClassification` fields, so it still satisfies the sanitized evidence
shape while explicitly refusing to claim real provider success.

## Verification

```bash
node --experimental-strip-types --test tests/*dual-endpoint-release-e2e*.test.mjs
```

Result: PASS, 6/6.

```bash
npm run dual-endpoint:e2e -- --scenario all --reasoning-cli codex-high --execution-cli codex-medium --profile-dir output/playwright/stage-b-cft-open-profile --dry-run
```

Result: PASS for harness contract/dry-run evidence writing. The generated
`dry-*` ids are not accepted as final release evidence.

```bash
npm run typecheck
```

Result: PASS.

```bash
npm run build-extension
```

Result: PASS.

```bash
npm test
```

Result: PASS, 986/986.

```bash
rg -n "pairingToken|document\.cookie|localStorage|shell: *true|--dangerously|--yolo|--full-auto|requestSubmit|KeyboardEvent|\.submit\(" scripts apps packages
```

Result: REVIEWED. Matches are limited to expected pairing-token handling,
existing console storage text, existing web-auto harness token use, and
dual-endpoint evidence redaction rules. No dangerous shell mode, dangerous CLI
flags, DOM submit automation, `requestSubmit`, or synthetic keyboard submit
shortcut was introduced by EX-E.

```bash
git diff --check
```

Result: PASS.

## Decision

PASS for the default deterministic closeout gate.

Evidence:

- `docs/planning/RP-REAL-EVIDENCE-GATE-REFORM.md`
- `docs/reviews/REVIEW-DETERMINISTIC-EVIDENCE.md`
- `output/playwright/deterministic-evidence-review/2026-06-23T14-27-04-773Z-*.json`

Layer 2 real-browser evidence remains `ENV-BLOCKED` and non-blocking by default:

- `cli-route`: `confirmation-timeout`
- `chatgpt-route`: `blocked-real-chatgpt`

The historical decision text below is retained for the previous hard real-chain
gate.

The implementation and harness work are ready for real release evidence, but
the final gate cannot pass until a run supplies:

- a real logged-in high-tier CLI reasoning endpoint;
- a distinct medium/low execution endpoint;
- a logged-in ChatGPT profile or CDP browser for the ChatGPT route;
- sanitized evidence showing fixed bindings, unique confirmation, correlated
  execution result, failure/control stop behavior, WorkBuddy rejection, and
  cleanup.

Final status for the superseded hard real-browser gate remains
`BLOCKED-ON-REAL-EVIDENCE`. Final status for the default deterministic gate is
`PASS-DETERMINISTIC-EVIDENCE`.
