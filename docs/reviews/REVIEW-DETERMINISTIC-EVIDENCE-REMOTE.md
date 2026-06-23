# REVIEW-DETERMINISTIC-EVIDENCE-REMOTE

Verdict: BLOCKED-ON-CI-TEST

Date: 2026-06-24

Owner: reviewing agent. No implementation fixes performed.

Spec:

- `docs/planning/RP-REAL-EVIDENCE-GATE-REFORM.md`
- `docs/reviews/REVIEW-DETERMINISTIC-EVIDENCE.md`

## Summary

The deterministic closeout commit was pushed successfully and remote HEAD now
matches local HEAD. The remote review gate is blocked only by CI failing in
`npm test`. The failure is locally reproducible as the same stale assertion
already documented in `REVIEW-DETERMINISTIC-EVIDENCE`.

No remote diff, push, or HEAD mismatch remains.

## Remote State

- Commit: `0027c1da1c13684fabadec1f52274680a084317a`
- Branch: `main`
- Upstream: `origin/main`
- Remote matches local: yes
- Working tree at review time: clean
- Remote diff scope: `none`

Push result:

```text
77d5166..0027c1d  main -> main
```

## Remote Gate

`npm run remote-review-gate` result:

```text
verdict: fail
failures: ci-failing
warnings: pr-unavailable
```

PR status is unavailable because local `gh` is not authenticated. This is a
warning, not the blocking failure.

CI:

- Workflow: `CI`
- Run id: `28036040338`
- URL: `https://github.com/leekitleung/cli-bridge/actions/runs/28036040338`
- Job: `verify`
- Job id: `82989535991`
- Conclusion: `failure`

The GitHub Actions job metadata shows:

- `npm ci`: success
- `npm run lint`: success
- `npm run typecheck`: success
- `npm run build-extension`: success
- `npm test`: failure

GitHub job logs were not downloadable through the public API without elevated
repository rights, and local `gh` is not authenticated. Public check-run
annotations only reported `Process completed with exit code 1`.

## Local Reproduction

The same `npm test` failure reproduces locally at HEAD:

- Tests: `1010`
- Pass: `1009`
- Fail: `1`

Failure:

```text
tests/web-auto-release-e2e.test.mjs
web auto release harness rejects missing profile and invalid scenario
```

Expected regex:

```text
/profile-dir or connect-cdp is required/
```

Actual error:

```text
profile-dir, connect-cdp, or connect-active-chrome is required
```

This is a stale test expectation for the documented `connect-active-chrome`
mode, not a remote-head mismatch and not a deterministic closeout documentation
diff issue.

## Verdict

Remote publication of the deterministic closeout is complete, but remote
acceptance is blocked by the CI `npm test` failure above.

Next authorized batch should be a narrow follow-up:

```text
EX-CI-STABLE-WEB-AUTO-ERROR-MESSAGE
```

Scope:

- Update the stale assertion in `tests/web-auto-release-e2e.test.mjs` to accept
  the current `connect-active-chrome` wording.
- Do not change harness behavior, product code, browser automation, extension
  DOM behavior, dependencies, or release-gate semantics.

Required verification for that batch:

```bash
node --experimental-strip-types --test tests/web-auto-release-e2e.test.mjs
npm test
npm run remote-review-gate
git diff --check
```
