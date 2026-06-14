# ADR-0022: GitHub Combined Commit-Status Augmentation (v2.17 planning)

Status: PROPOSED — awaiting explicit acceptance

Date: 2026-06-14
Depends on: ADR-0019-b (remote GitHub checks provider) — ACCEPTED & CLOSED
Acceptance: NOT YET ACCEPTED. A bounded increment to the ACCEPTED ADR-0019-b
            remote provider: add the legacy **combined commit status** read
            (`/commits/{ref}/status`) alongside the existing check-runs read and
            merge both into one typed `VerificationResult` by a fixed precedence
            rule. It reuses ALL ADR-0019-b containment unchanged (HTTPS-only +
            standard TLS, owner/repo charset + `encodeURIComponent(ref)`, no
            cross-host redirect, bounded read, timeout, single-run lock,
            memory-only operator-set token, redaction). It introduces **no new
            credential mechanism, no new provider, no new identity/HTTP surface**.
            Because it crosses no *new* boundary (same outbound+credential class
            already accepted under ADR-0019-b), acceptance needs an ADR-0007 §2
            review but **no fresh credential-handling review**.

## Scope decision (RP-2.17)

The "0019-b remote increment" direction bundles three items; RP-2.17 scopes them:

- **GitHub Enterprise** — already supported: ADR-0019-b's `apiBaseUrl` is
  operator-configured, so a GHE base URL already works. This is operator
  validation + a doc note, **not** a code change. Out of scope here (no ADR
  needed); optionally noted in the contract.
- **Multi-provider (GitLab/etc.)** — needs a provider abstraction; a larger
  separate ADR. **Deferred / out of scope.**
- **Combined commit status** — the real bounded code increment (this ADR).

## Context

ADR-0019-b reads **check-runs** (`/commits/{ref}/check-runs`) and maps the
aggregate `conclusion` to a typed result. GitHub Actions reports via check-runs,
but many external CIs (and some integrations) report via the **legacy commit
status API** (`/commits/{ref}/status`, combined `state: success|pending|failure`)
and emit **no** check-runs. For such repos, check-runs-only returns `unknown`
even though a real pass/fail exists in the commit status. This ADR augments the
provider to also read combined commit status and merge both signals into one
typed result — closing that blind spot using the exact same containment.

## Decision

### 0. Decision status

**PROPOSED.** No code until explicit acceptance + an `EX-2.17-1` handoff.

### 1. What is permitted

PERMIT a second read-only call and a fixed merge, within the existing
ADR-0019-b provider:

- **Second endpoint (read-only)**: `GET {apiBaseUrl}/repos/{owner}/{repo}/commits/{ref}/status`
  (Accept `application/vnd.github+json`). Same URL containment, HTTPS-only +
  standard TLS, no cross-host redirect, bounded read, timeout, token, redaction
  as the check-runs call. Read-only; only the combined `state` field is used.
- **Both reads per confirm**: on a single human-triggered confirm, the provider
  performs the check-runs read and the combined-status read (sequentially, under
  the existing per-project single-run lock), then merges. Each call is
  independently bounded and fail-closed.
- **Both sources normalized to a signal** (RP-2.17-a). Each source maps to a
  signal in `{ failed, errored, pending, passed, skipped, none }`:
  - **check-runs source `cr`**: any failing conclusion
    (`failure/timed_out/cancelled/action_required/stale`) → `failed`; else any
    `queued/in_progress`/missing conclusion → `pending`; else ≥1 `success` →
    `passed`; else all `skipped/neutral` → `skipped`; **zero check-runs →
    `none`** (absence, NOT blocking); call auth/timeout/5xx-after-retry →
    `errored`.
  - **combined-status source `st`**: read top-level `state` **and** `total_count`
    (only these; never parse/surface `statuses[]`). `state==='failure'` →
    `failed`; `state==='success'` → `passed`; **`state==='pending' &&
    total_count>0` → `pending`**; **`state==='pending' && total_count===0` →
    `none`** (no statuses, NOT pending — F2); HTTP 404/422 → `none`;
    auth/timeout/5xx-after-retry → `errored`.
- **Fixed merge ladder** (RP-2.17-a, highest wins; `none` is absence, never
  blocks): take the highest-ranked signal present across `{cr, st}`:
  1. **failed** — if either source is `failed`.
  2. **errored** — else if either source is `errored`.
  3. **unknown** — else if either source is `pending`.
  4. **passed** — else if either source is `passed`.
  5. **skipped** — else if either source is `skipped`.
  6. **unknown** — else (both `none`: no check-runs and no statuses).

  Worked cases (F1 regression guards): `cr:none + st:passed → passed` (the
  classic-status-only blind spot is now resolved); `cr:pending + st:passed →
  unknown`; `cr:passed + st:none → passed`; `cr:failed + st:passed → failed`;
  `cr:errored + st:passed → errored`; `cr:none + st:none → unknown`. Deterministic,
  no inference.
- **Stored evidence** (ADR-0017): `result`, `commandLabel = "github-checks"`
  (unchanged label or `"github-status"` — implementer keeps the existing label
  to avoid a schema/UI change), `recordedAt`, timing, flags only. No raw
  payloads, no `statuses[]` contents, no token, no URL, no identity.
- **Token scope (RP-2.17-a, F3)**: the combined-status read requires an
  additional read-only permission. The minimal operator token scope is now
  **"Checks: read" + "Commit statuses: read"** (GitHub fine-grained token
  permission names; classic equivalent: a read-only `repo`-scoped token on
  private repos). This is **not** a new credential mechanism (same memory-only
  operator-set token store), but the operator token *contract* expands by one
  read permission; ADR/handoff/contract must state it.

### 2. What remains forbidden (unchanged from ADR-0019-b)

- No third endpoint, no write/PR/merge/status-write, no second provider.
- No new credential mechanism / no HTTP-supplied identity/token/url/host.
- No non-HTTPS, no cross-host redirect, no insecure TLS, no retry storm
  (≤1 retry per call), no poller/webhook/scheduler/model trigger.
- No raw API payload / `statuses[]` / token / URL / path / identity / `sha`
  surfaced or stored; redaction applies to all error/timeout surfaces.
- No free-text inference; only the discrete enum/state values drive the result.
- No VCS write; ADR-0007 line held.

### 3. Scope

In scope (for an accepted `EX-2.17-1`):

- A combined-status read in the existing `github-checks-provider.ts` reusing
  `buildUrl`/`readCappedBody`/`safeFetchJson` containment (status path variant).
- The fixed `state` mapping and the fixed merge precedence above.
- A doc note that `apiBaseUrl` already supports GitHub Enterprise.
- Tests: status-only repo (no check-runs) → typed result from status; merge
  precedence cases; status 404/no-statuses → no-signal (falls back to check-runs);
  both-errored → errored; URL containment for the status path; token never
  leaks; injected fetch (no real network).
- CHANGELOG + contract.

Out of scope:

- Multi-provider abstraction (separate ADR).
- `statuses[]` per-context detail display (only combined `state` used).
- Any new endpoint/route surface, console gate change beyond reusing the
  existing confirm.

### 4. ADR-0007 §2 prerequisites (delta vs ADR-0019-b)

Identical posture to ADR-0019-b; the only delta is a second read-only GET to the
same configured host with the same token and the same bounded read. No new
credential, no new identity surface, no new host. Containment/fail-closed/
no-autonomy/audit-redaction all unchanged. → ADR-0007 §2 review only; **no fresh
credential-handling review** (credential mechanism is unchanged).

### 5. Boundary and invariants

| Invariant | ADR-0022 position |
|---|---|
| Read-only | Two read-only GETs; no write. |
| Single provider / host | Same configured GitHub host; no new provider. |
| Containment | Reuses ADR-0019-b URL/TLS/redirect/timeout/bounded-read/lock unchanged for both calls. |
| Credentials | Reuses the memory-only operator-set token store; no new mechanism. |
| No raw surface | Only typed result + existing sanitized fields; `statuses[]`/payloads never surfaced. |
| Deterministic merge | Fixed precedence; no inference. |
| Fail-closed | Per-call fail-closed; both-errored → errored; no false pass. |

## Alternatives Considered

### A. Keep check-runs only
Repos using only the legacy commit-status API stay `unknown`. Rejected — the
blind spot is the motivation.

### B. Combined status augmentation with fixed merge (this ADR)
Recommended. Smallest increment closing the blind spot, full containment reuse.

### C. General multi-provider / per-context status detail
Larger; needs provider abstraction and a richer (riskier) surface. Deferred.

## Risk Acceptance

- **Second outbound call**: doubles egress per confirm. Mitigation: same host,
  same token, both bounded/timed/locked; human-triggered only.
- **Merge ambiguity**: combining two sources risks inconsistent outcomes.
  Mitigation: fixed deterministic precedence (failure-wins); tests pin every
  case.
- **Payload growth (`statuses[]`)**: combined status returns per-context
  entries. Mitigation: only the top-level `state` is read; `statuses[]` is never
  parsed-for-display or surfaced; bounded read still applies.

## Consequences

If accepted and implemented: the provider yields a correct typed result for
repos using check-runs, classic commit statuses, or both — using the same
accepted containment and credential model.

If rejected: classic-status-only repos keep showing `unknown`.

## Acceptance Conditions

An `EX-2.17-1` handoff and `REVIEW-2.17-1` closeout MUST verify:

1. **Two read-only endpoints only**: `/commits/{ref}/check-runs` and
   `/commits/{ref}/status`; no third endpoint, no write/PR/merge/status-write.
2. **Containment reused for the status call**: HTTPS-only + standard TLS, owner/
   repo charset + `encodeURIComponent(ref)`, no cross-host redirect, bounded
   read, timeout, single-run lock, injectable fetch (no real network in tests).
3. **No new credential / identity surface**: reuses the memory-only operator-set
   token; no HTTP-supplied owner/repo/ref/url/host/token; absent token/config →
   409/no call (unchanged).
4. **Fixed source-signal mapping + merge ladder** exactly as §1 (RP-2.17-a):
   both sources normalized to `{failed,errored,pending,passed,skipped,none}`
   with zero-check-runs → `none` and `state==='pending' && total_count===0` →
   `none`; merge ladder `failed > errored > pending(→unknown) > passed >
   skipped > (both none →unknown)`. Deterministic; no inference. Regression
   guard: `cr:none + st:passed → passed`.
5. **`total_count` read (F2)**: the status source distinguishes real-pending
   (`total_count>0`) from no-statuses (`total_count===0 → none`); only top-level
   `state` + `total_count` are read; `statuses[]` is never parsed/surfaced.
6. **errored vs false pass**: a source `errored` ranks above `passed` (never a
   false `passed` when a source errored); only `failed` outranks `errored`.
7. **No raw surface**: no `statuses[]`/payload/token/URL/identity/`sha` stored or
   shown; error/timeout strings redacted.
8. **Token scope (F3)**: ADR/handoff/contract document the minimal read-only
   scope as **Checks: read + Commit statuses: read**; no new credential
   mechanism (same memory-only operator-set token); absent token/config →
   409/no call (unchanged).
9. **Stored as ADR-0017 evidence**: sanitized label/timing/flags only.
10. **No autonomy / human-triggered**: reuses the existing confirm gate.
11. **Tests**: status-only repo (`cr:none + st:passed`) → `passed`;
    `cr:pending + st:passed` → `unknown`; `state:pending,total_count:0` → `none`
    fallback; `cr:failed + st:passed` → `failed`; one-source-errored → `errored`;
    both-none → `unknown`; status-path URL containment; token-never-leaks (incl.
    error/timeout); injected fetch (no real network).
12. **Backward compatible**: existing 0019-b/provider/console tests pass; the
    change is additive within the existing provider.

## Allowed files (proposed for EX-2.17-1)

- `apps/local-server/src/verification/github-checks-provider.ts` — combined-status
  read + `state` mapping + merge.
- `packages/shared/src/types.ts` — only if a small additive field is required
  (prefer none; keep the existing `GithubChecksView` shape).
- `apps/local-server/src/routes/bridge-api.ts` — only wiring if strictly required
  (prefer none; the confirm handler already calls the provider).
- `docs/contracts/bridge-projects-api.md` — combined-status note + GHE note.
- `CHANGELOG.md` — record `EX-2.17-1`.
- `tests/github-checks-provider.test.mjs` (and route/console suites only if
  wiring changes) — the §9 tests.

Otherwise STOP and report.

## Handoff prompt sketch (EX-2.17-1)

> Implement only ADR-0022. In `github-checks-provider.ts`, add a second
> read-only GET to `/commits/{ref}/status` reusing the existing containment
> (HTTPS/TLS/redirect/timeout/bounded-read/token/redaction/URL safety). Normalize
> BOTH sources to a signal in `{failed,errored,pending,passed,skipped,none}`:
> check-runs → `none` when zero check-runs; combined status → read top-level
> `state` AND `total_count` (never `statuses[]`), `state:pending,total_count:0` →
> `none`, `state:pending,total_count>0` → `pending`, 404/422 → `none`,
> auth/timeout/5xx → `errored`. Merge by the fixed ladder
> `failed > errored > pending(→unknown) > passed > skipped > (both none →
> unknown)` (regression guard: `cr:none + st:passed → passed`). Store the merged
> typed result as ADR-0017 evidence (sanitized). Update the contract/handoff/
> operator docs: minimal read-only token scope is now **Checks: read + Commit
> statuses: read**. Add no third endpoint, no provider, no new credential
> mechanism/identity surface, no raw `statuses[]`/payload/token. Add the §11
> tests (injected fetch, no real network). Run typecheck, lint, provider +
> touched suites, npm test, git diff --check. One dedicated `EX-2.17-1` diff; do
> not commit/push until `REVIEW-2.17-1` authorizes.

## Status / Next

PROPOSED. On acceptance, author `CLI-BRIDGE-v2.17-COMBINED-STATUS-HANDOFF.md`
for `EX-2.17-1`, then return to `REVIEW-2.17-1`. Multi-provider and per-context
status detail remain deferred to separate ADRs.
