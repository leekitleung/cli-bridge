# CLI Bridge v2.17 - GitHub Combined Commit-Status Augmentation - Implementation Handoff (ADR-0022)

**Status**: HANDOFF AUTHORIZED - **DISPATCHABLE ON EXPLICIT HUMAN TRIGGER**.
ADR-0022 was accepted by `REVIEW-ADR-0022` PASS (ADR-0007 §2 delta review; no
fresh credential-mechanism review) on 2026-06-15. `EX-2.17-1` requires an
explicit human dispatch and returns to `REVIEW-2.17-1`.
**Date**: 2026-06-15
**Batch**: `EX-2.17-1` (execution) -> returns to `REVIEW-2.17-1`
**Based on**:
- `docs/planning/ADR-0022-github-combined-commit-status-augmentation.md`
- Existing provider: `apps/local-server/src/verification/github-checks-provider.ts`
- Existing tests: `tests/github-checks-provider.test.mjs`
- Existing contract: `docs/contracts/bridge-projects-api.md`

---

## 0. Scope note

Implement **only ADR-0022**: add the GitHub combined commit-status read to the
existing ADR-0019-b GitHub provider and merge it with check-runs into one typed
`VerificationResult`.

This is still one provider family, the same configured host, the same
memory-only operator token store, and the same human confirm gate. Do not add a
new provider abstraction, route, credential mechanism, scheduler, or console
capability.

## 1. Goal

Classic-status-only repositories currently appear `unknown` because the provider
reads only `/commits/{ref}/check-runs`. Add:

```text
GET {apiBaseUrl}/repos/{owner}/{repo}/commits/{encodeURIComponent(ref)}/status
```

Then normalize check-runs and combined status to fixed source signals and merge
them by the ADR-0022 ladder.

## 2. Fixed behavior (no execution-agent decisions)

### Source calls

- Existing check-runs read remains:
  `/repos/{owner}/{repo}/commits/{ref}/check-runs`.
- Add exactly one second read:
  `/repos/{owner}/{repo}/commits/{ref}/status`.
- Both calls reuse the same ADR-0019-b containment:
  HTTPS-only, standard TLS, owner/repo `^[A-Za-z0-9._-]+$`, ref rejected when
  empty/contains `..`/control chars and inserted only as one
  `encodeURIComponent(ref)` path segment, no cross-host redirect, timeout,
  bounded body read, <=1 retry per call, injectable fetch, redacted errors, same
  memory-only token.
- Fetches are sequential under the existing single-run lock.

### Source signal mapping

Normalize both sources to:

```text
failed | errored | pending | passed | skipped | none
```

Check-runs source `cr`:

- Any `failure`, `timed_out`, `cancelled`, `action_required`, or `stale`
  conclusion -> `failed`.
- Any `queued`, `in_progress`, `null`, missing, or unfinished conclusion ->
  `pending`.
- At least one `success` -> `passed`.
- All `skipped` or `neutral` -> `skipped`.
- Zero check-runs -> `none` (absence; not blocking).
- Auth, rate limit, timeout, network, parse, shape, or 5xx-after-retry error ->
  `errored`.

Combined-status source `st`:

- Read only top-level `state` and `total_count`; do not parse, persist, audit,
  or display `statuses[]`.
- `state === "failure"` -> `failed`.
- `state === "success"` -> `passed`.
- `state === "pending" && total_count > 0` -> `pending`.
- `state === "pending" && total_count === 0` -> `none`.
- HTTP 404 or 422 -> `none`.
- Auth, rate limit, timeout, network, parse, shape, or 5xx-after-retry error ->
  `errored`.

### Merge ladder

Take the highest-ranked signal across `{cr, st}`:

1. `failed` -> result `failed`
2. `errored` -> result `errored`
3. `pending` -> result `unknown`
4. `passed` -> result `passed`
5. `skipped` -> result `skipped`
6. both `none` -> result `unknown`

Regression guards:

- `cr:none + st:passed -> passed`
- `cr:pending + st:passed -> unknown`
- `cr:passed + st:none -> passed`
- `cr:failed + st:passed -> failed`
- `cr:errored + st:passed -> errored`
- `cr:none + st:none -> unknown`

## 3. Token contract

No new credential mechanism is allowed. Continue using the existing
memory-only operator-set GitHub token.

Update docs to say the minimum read-only token scope is now:

```text
Checks: read + Commit statuses: read
```

Use GitHub fine-grained permission names. For classic tokens on private repos,
document the read-only classic equivalent as needed. Do not accept token,
owner, repo, host, URL, or ref from HTTP input.

## 4. Allowed files

- `apps/local-server/src/verification/github-checks-provider.ts`
- `tests/github-checks-provider.test.mjs`
- `docs/contracts/bridge-projects-api.md`
- `CHANGELOG.md`
- `packages/shared/src/types.ts` only if a small additive field is strictly
  required; prefer no type shape change.
- `apps/local-server/src/routes/bridge-api.ts` only if strictly required; prefer
  no route wiring change because the confirm handler already calls the provider.
- Route/console suites only if wiring changes.

Anything else -> STOP and report.

## 5. Forbidden

- No third endpoint.
- No write, PR, merge, status-write, commit, branch, push, pull, or VCS mutation.
- No new provider family, GitLab, generic CI, provider registry, or abstraction.
- No HTTP-supplied owner/repo/ref/url/host/token.
- No non-HTTPS, insecure agent, `NODE_TLS_REJECT_UNAUTHORIZED=0`, cross-host
  redirect, or arbitrary URL.
- No retry storm; <=1 retry per call.
- No poller, webhook, scheduler, auto-refresh, or model-triggered network call.
- No raw API payload, `statuses[]`, token, Authorization header value, URL,
  owner, repo, ref, branch, SHA, path, or identity stored/audited/returned/rendered.
- No free-text inference; only closed source signals drive the result.

## 6. Required tests

Add provider tests using injected `fetchFn`; never hit real network.

Required coverage:

1. Status-only success: zero check-runs + status `success` -> `passed`.
2. Check-runs pending + status `success` -> `unknown`.
3. Status `pending,total_count:0` -> `none`, falling back to check-runs.
4. Status `pending,total_count>0` -> `unknown`.
5. Check-runs failed + status `success` -> `failed`.
6. One source errored + other passed -> `errored`.
7. Both none -> `unknown`.
8. Status 404 and 422 -> `none`, not failure.
9. Status path URL containment: owner/repo whitelist, encoded ref as one segment,
   final calls limited to the configured host and the two allowed paths.
10. Cross-host redirect rejected for the status call.
11. Oversized/invalid status response fails closed and does not leak token.
12. Token never appears in URL, response, error, audit-facing view, or test output.
13. View shape remains sanitized; no raw payload, `statuses[]`, URL, owner/repo/
    ref, branch, SHA, or Authorization value.
14. Existing 0019-b check-runs mapping tests remain passing.

## 7. Verification commands

Run and report all:

- `npm run typecheck`
- `npm run lint`
- `node --test tests/github-checks-provider.test.mjs`
- Any touched route/console suites if wiring changes
- `npm test`
- `git diff --check`

## 8. Report / pre-review material

Report:

- Changed files.
- Source signal mapping and merge ladder implementation.
- Evidence that only the two read-only GitHub endpoints are called.
- Evidence that status reads reuse URL containment, timeout, bounded body,
  redirect rejection, retry, fetch injection, and redaction.
- Evidence that token scope docs were updated to Checks: read + Commit statuses:
  read.
- Verification pass counts, `npm test` total, and diff-check.
- Confirm not committed/pushed; leave dirty tree for `REVIEW-2.17-1`.

## 9. Closeout

One dedicated `EX-2.17-1` commit of the allowed files; do not commit/push until
`REVIEW-2.17-1` authorizes. Control returns to RP afterward.
