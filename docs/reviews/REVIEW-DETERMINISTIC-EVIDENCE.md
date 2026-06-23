# REVIEW-DETERMINISTIC-EVIDENCE

Verdict: PASS

Date: 2026-06-23

Owner: reviewing agent. No implementation fixes performed.

Spec: `docs/planning/RP-REAL-EVIDENCE-GATE-REFORM.md`

## Summary

Layer 1 deterministic release evidence passes. The default dual-endpoint
automation closeout is no longer blocked by unavailable logged-in browser state,
CDP state, ChatGPT navigation, or human confirmation timing. Those are Layer 2
environment evidence under the adopted gate reform.

This review does not claim real ChatGPT Web end-to-end evidence passed. The most
recent real-browser attempt remains `ENV-BLOCKED`:

- `cli-route`: `confirmation-timeout`
- `chatgpt-route`: `blocked-real-chatgpt`

No code, harness, dependency, or product behavior change was made to compensate
for those environment blocks.

## Repository State

- Branch: `main`
- Working tree before review: existing documentation changes for gate reform.
- Code/harness changes in this review: none.
- Generated deterministic evidence:
  `output/playwright/deterministic-evidence-review/2026-06-23T14-27-04-773Z-*.json`

## Layer 1 Gate Results

| Check | Result |
|---|---|
| `npm run typecheck` | PASS |
| `npm run build-extension` | PASS |
| `node --experimental-strip-types --test tests/*dual-endpoint-release-e2e*.test.mjs` | PASS, 17/17 |
| Harness-only forbidden shortcut scan | PASS, no matches in `scripts/dual-endpoint-release-e2e.ts` or `scripts/web-auto-release-e2e.ts` |
| Deterministic dry-run evidence | PASS, 9/9 scenarios |
| Deterministic evidence sanitizer scan | PASS, no sensitive-field matches |
| Cleanup/process check | PASS, no harness-owned process left |
| `npm test` | 1009/1010 PASS, 1 known non-regression failure |

### Full-suite note

`npm test` reports one failure:

- `tests/web-auto-release-e2e.test.mjs`: the assertion expects
  `/profile-dir or connect-cdp is required/`, while the current error message is
  `profile-dir, connect-cdp, or connect-active-chrome is required`.

This same failure was observed in the preceding run before this review document
was written. It is a stale test expectation for the documented
`connect-active-chrome` mode, not a dual-endpoint deterministic safety boundary
failure and not a regression from this review.

## Deterministic Evidence

The dry-run deterministic evidence command passed:

```bash
npm run dual-endpoint:e2e -- --scenario all --reasoning-cli codex-command --execution-cli codex-medium --profile-dir output/playwright/stage-b-cft-open-profile --dry-run --output-dir output/playwright/deterministic-evidence-review
```

Generated files:

- `2026-06-23T14-27-04-773Z-cli-route.json`
- `2026-06-23T14-27-04-773Z-chatgpt-route.json`
- `2026-06-23T14-27-04-773Z-same-provider.json`
- `2026-06-23T14-27-04-773Z-mixed-provider.json`
- `2026-06-23T14-27-04-773Z-failure-timeout.json`
- `2026-06-23T14-27-04-773Z-uncertain-dispatch.json`
- `2026-06-23T14-27-04-773Z-control-pause-cancel.json`
- `2026-06-23T14-27-04-773Z-workbuddy-boundary.json`
- `2026-06-23T14-27-04-773Z-cleanup.json`

All nine report `evidenceStatus: "passed"` and
`failureClassification: "none"`.

## Boundary Review

### Source shortcuts

The harness-only source scan found no forbidden shortcuts in:

- `scripts/dual-endpoint-release-e2e.ts`
- `scripts/web-auto-release-e2e.ts`

The broader source scan produced expected non-blocking matches in existing
allowlist/constants/tests:

- `apps/local-server/src/adapters/command-runner.ts` contains explicit denylisted
  dangerous flags.
- `apps/local-server/src/routes/bridge-api.ts` defines execution proposal route
  constants.
- `tests/dual-endpoint-release-e2e.test.mjs` asserts forbidden strings are absent
  from the harness.

These are not harness bypasses.

### Sensitive output

The deterministic evidence directory was scanned for pairing tokens, cookies,
credentials, raw provider config, raw prompts/replies/transcripts, and private
browser state markers. No matches were found.

### Process cleanup

Post-run process inspection found no remaining harness-owned local server,
browser, dual-endpoint release process, or test server process. Matches were
only the inspection commands themselves.

## Layer 2 Environment Evidence

The latest Layer 2 real-browser run remains useful but non-blocking under
`RP-REAL-EVIDENCE-GATE-REFORM`:

- Evidence timestamp:
  `output/playwright/dual-endpoint-automation/2026-06-23T12-39-48-649Z-*.json`
- `cli-route`: `blocked`, `confirmation-timeout`
- `chatgpt-route`: `blocked`, `blocked-real-chatgpt`
- Seven contract scenarios: `passed`

These are recorded as `ENV-BLOCKED` conditions because they depend on logged-in
browser/profile/CDP availability and human timing. They do not justify code,
harness, dependency, selector, or confirmation-behavior changes in an
evidence-capture batch.

## Verdict

PASS for `REVIEW-DETERMINISTIC-EVIDENCE`.

The default closeout path may proceed to final closeout using Layer 1
deterministic evidence. If a release later explicitly requires real ChatGPT Web
end-to-end evidence, Layer 2 must be re-run in a prepared browser environment
and reviewed separately.
