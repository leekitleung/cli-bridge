# REVIEW-2.14-2 — ADR-0019-b closeout

**Date**: 2026-06-14
**Reviewer**: zs (RP-2.14)
**Verdict**: **PASS** — ADR-0019-b accepted and closed.

## Scope

`EX-2.14-2` implements ADR-0019-b: opt-in, human-triggered, read-only GitHub
check-runs status fetch with operator-configured identity, memory-only token,
typed evidence, redacted audit, and no VCS write.

This review also covers `EX-2.14-2-followup`, `EX-2.14-2-followup-2`, and the
route/console/provider test hardening that closed the last evidence gaps.

## Review history

`REVIEW-2.14-2-b` passed after the console `api()` bug was fixed and the
route/console tests were extended:

- F1: `project-console.ts` now triggers the GitHub checks gate via `api(base,
  'POST', { confirm: true })`, matching the live verification gate pattern.
- F2: route tests cover opt-in off, no config, no token, detached branch,
  success mapping, and ignored HTTP-supplied identity/token override.
- F3: the route handler ignores request-body identity/token fields entirely, so
  override input is inert by construction; tests prove the body is ignored.

`REVIEW-2.14-2-c` then closed the real containment gap in the provider:

- `safeFetchJson` no longer post-hoc truncates after `response.text()`.
- `readCappedBody()` now reads streaming bodies incrementally and cancels the
  reader immediately on overflow.
- The timeout stays active through body consumption, so slow bodies are bounded
  as well as headers.
- Oversized streaming and fallback `text()` regressions were added.

## Acceptance evidence

| # | Criterion | Evidence |
|---|-----------|----------|
| 1 | Single read-only endpoint | `GET /repos/{owner}/{repo}/commits/{ref}/check-runs` only; no write/PR/merge/status-write paths. |
| 2 | Operator-config identity only | `owner`/`repo` come from runtime config; HTTP-supplied override is ignored and blocked in PATCH/schema. |
| 3 | Memory-only token | `GithubTokenStore` is in-memory only; absent token returns 409/no call. |
| 4 | HTTPS-only egress | Non-HTTPS config rejected; standard TLS only; no insecure agent. |
| 5 | URL containment | `owner`/`repo` are strict-whitelisted; `ref` is single-segment `encodeURIComponent(ref)` and rejects empty/control-char/`..` inputs. |
| 6 | Timeout + body cap | Timeout spans fetch + body read; oversized streaming bodies cancel and fail closed. |
| 7 | No cross-host redirect | 3xx cross-host redirect rejected. |
| 8 | Retry policy | ≤1 retry on transient 5xx/network; 429 and auth failures do not retry. |
| 9 | Typed mapping only | `check_runs[].conclusion` maps to closed `VerificationResult` values only. |
| 10 | Human-triggered | Confirm gate required; console is inert until clicked. |
| 11 | Redacted audit / response | No token, URL, owner/repo/ref, or raw payload in audit/console/response. |
| 12 | Opt-in / revocable | `githubChecksEnabled` defaults off and blocks fetch when false. |
| 13 | No VCS write | No commit/push/merge/rebase/PR/branch mutation paths exist. |
| 14 | Tests | Provider, route, and console suites cover the full boundary set, including oversized bodies. |

## Files

- `packages/shared/src/types.ts`
- `packages/shared/src/schemas.ts`
- `apps/local-server/src/verification/github-token-store.ts`
- `apps/local-server/src/verification/github-checks-provider.ts`
- `apps/local-server/src/routes/bridge-api.ts`
- `apps/local-server/src/routes/project-console.ts`
- `apps/local-server/src/storage/project-store.ts`
- `docs/contracts/bridge-projects-api.md`
- `CHANGELOG.md`
- `tests/github-checks-provider.test.mjs`
- `tests/bridge-projects-api.test.mjs`
- `tests/project-console-behavior.test.mjs`

## Verification

```
node --test tests/github-checks-provider.test.mjs
npm run typecheck
npm run lint
npm test
git diff --check
```

## Decision

ADR-0019-b is **CLOSED**. Control returns to RP.
