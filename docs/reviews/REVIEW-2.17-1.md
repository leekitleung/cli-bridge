# REVIEW-2.17-1 - ADR-0022 closeout

**Date**: 2026-06-15
**Reviewer**: zs (RP-2.17)
**Verdict**: **PASS** - ADR-0022 accepted and closed.

## Scope

`EX-2.17-1` implements ADR-0022: GitHub combined commit-status augmentation for
the existing ADR-0019-b provider. The slice adds one second read-only GitHub
endpoint, `/commits/{ref}/status`, and merges it with the existing check-runs
read into one typed `VerificationResult`.

## Review history

The first review pass found two real issues and was changed to
**CHANGES REQUIRED**:

- F1: `safeFetchText()` cleared the timeout immediately after `fetchFn()`
  returned, before body consumption. This regressed the ADR-0019-b containment
  fix requiring timeout coverage through response body read.
- F2: the retry test changed from an exact assertion to `>= 2`, which would not
  prevent retry storms.

`EX-2.17-1-followup` fixed both:

- `clearTimeout()` now runs only in `finally`, so the `AbortController` timeout
  spans fetch and body consumption.
- `timeoutMs` is injectable for provider tests while defaulting to 10s.
- The 5xx retry test now asserts check-runs = 2, status = 2, total = 4.
- A hung streaming-body regression test proves body read is aborted quickly.

## Acceptance evidence

| # | Criterion | Evidence |
|---|-----------|----------|
| 1 | Two read-only endpoints only | Provider builds only `/check-runs` and `/status`; no write/PR/merge/status-write call. |
| 2 | Containment reused | Both URL builders enforce HTTPS, owner/repo whitelist, encoded ref, same host/path construction, injected fetch, redirect rejection, bounded body, timeout, and retry policy. |
| 3 | No new credential / identity surface | Existing memory-only token and operator config are reused; route tests prove HTTP override body does not affect either URL. |
| 4 | Fixed source signals + merge ladder | Check-runs and combined status normalize to `failed|errored|pending|passed|skipped|none`; ladder is `failed > errored > pending -> unknown > passed > skipped > both none -> unknown`. |
| 5 | `total_count` distinction | Status source reads only top-level `state` and `total_count`; `pending,total_count=0` maps to `none`. |
| 6 | No false pass on errors | One errored source outranks passed and returns `errored`; failed still outranks errored. |
| 7 | No raw surface | View shape remains sanitized; `statuses[]`, raw payload, token, URL, owner/repo/ref, branch, and SHA are not exposed. |
| 8 | Token scope documented | Contract guidance now includes read-only `checks:read` + `commit_statuses:read`. |
| 9 | ADR-0017 evidence shape | Existing `github-checks` label/timing/flags result shape is preserved. |
| 10 | Human-triggered only | Existing route/console confirm gate is reused; no poller, webhook, scheduler, or auto-refresh added. |
| 11 | Tests | Provider tests cover status-only success, pending/no-status distinction, precedence cases, URL containment, redirect rejection, oversized response, timeout-through-body, retry bounds, and token non-leakage. |
| 12 | Backward compatible | Route/provider/full suites pass with the expected two outbound calls. |

## Files

- `apps/local-server/src/verification/github-checks-provider.ts`
- `tests/github-checks-provider.test.mjs`
- `tests/bridge-projects-api.test.mjs`
- `docs/contracts/bridge-projects-api.md`
- `CHANGELOG.md`

## Verification

```
npm run typecheck
npm run lint
node --test tests/github-checks-provider.test.mjs
node --test tests/bridge-projects-api.test.mjs
npm test
git diff --check
```

## Decision

ADR-0022 is **CLOSED**. Control returns to RP.
