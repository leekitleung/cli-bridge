# ADR-0019: Git/CI/GitHub Verification Provider Integration (v2.14 planning)

Status: PROPOSED — DEFERRED until ADR-0017 and ADR-0018 are accepted and closed

Date: 2026-06-13
Bundle: RP-2.12 Planning Bundle (ADR-0017 → ADR-0018 → ADR-0019)
Depends on: ADR-0017 (typed verification result model) and ADR-0018 (local live
            verification execution) — both accepted AND implemented
Blocks: none (last member of the bundle)
Acceptance: NOT YET ACCEPTED. This ADR crosses the long-standing **no network /
            no `git` / no CI / no provider API** boundary. It proposes a
            strictly **read-only** integration that reads `git` and/or CI/GitHub
            check status and maps it to the typed `VerificationResult` from
            ADR-0017. It does NOT authorize any VCS write (commit/push/merge/PR
            creation), workspace-write, autonomy, or credential persistence.

## Context

This is Alternative **D** deferred by ADR-0016:

> **D. Git/CI/GitHub status integration** — Requires outbound network and
> credential handling; out of the current boundary. Deferred to a separate ADR.

With ADR-0017 (typed sink) and ADR-0018 (local machine-grounded results), the
remaining verification source is **external status**: local `git` state and
remote CI / GitHub check results. Reading them lets the typed verification
result reflect what CI actually reported, not just a local run.

This is the first ADR in the program to cross the **outbound network +
credential** boundary. Every prior ADR — including ADR-0018, which crosses
execution but stays offline — forbade `git`, CI, GitHub/provider APIs, and any
outbound request. ADR-0019 therefore carries the heaviest prerequisite load:
ADR-0007 §2 plus a dedicated credential-handling story.

## Decision

### 0. Decision status

**PROPOSED — DEFERRED.** No code, and no acceptance, until ALL of:

1. ADR-0017 accepted and `EX-2.12-1` closed (typed sink exists);
2. ADR-0018 accepted and `EX-2.13-1` closed (execution/result-mapping patterns
   established);
3. this ADR receives its own explicit senior acceptance with a satisfied
   ADR-0007 §2 prerequisite review **and** an approved credential-handling
   design.

Implementation, if accepted, proceeds in `EX-2.14-1` and returns to
`REVIEW-2.14-1`. This is the final member of the bundle.

### 1. What is proposed (read-only status integration)

PERMIT a strictly **read-only** verification provider that maps external status
to the typed `VerificationResult`:

- **Local `git` read-only status**: read-only inspection (e.g. current
  branch/HEAD, clean/dirty, last-commit metadata) used as context for the typed
  result. No `git` write of any kind.
- **CI / GitHub check status read**: read-only API calls (e.g. latest CI run or
  PR check conclusion for the project's branch/commit) mapped to typed
  `passed`/`failed`/`errored`/`unknown`.
- Stored as ADR-0017 typed `VerificationEvidence` (result + recency + sanitized
  provider/check label), **not** raw API payloads, logs, tokens, or URLs with
  secrets.
- Opt-in per project (mirroring `workspaceApplyEnabled` / ADR-0018
  `verifyCommand` opt-in); off by default; human-triggered fetch (no background
  polling).

### 2. What remains forbidden

- Any **VCS write**: `git commit`/`push`/`merge`/`rebase`/tag, branch mutation,
  PR/MR creation, review submission, merge-queue actions (ADR-0007 line held).
- Workspace-write / apply-to-disk / auto-apply (ADR-0007).
- Autonomy: no background poller/scheduler/daemon/webhook listener; every fetch
  is human-triggered.
- Credential persistence: tokens are memory-only for the request, never written
  to store/audit/log/disk; never echoed in any read surface.
- Surfacing raw API responses, raw `git` output, tokens, secret-bearing URLs,
  `sha256` content, absolute paths, or diffs.
- Free-text outcome inference (the typed result comes from the discrete check
  conclusion / exit status, not from parsing logs).
- Acting on behalf of the user to change remote state in any way.

### 3. Scope

In scope (for an accepted `EX-2.14-1`):

- Opt-in per-project provider config (which provider, repo/branch identity);
  off by default.
- Read-only `git` status reader and/or read-only CI/GitHub check-status client
  (human-triggered fetch).
- Mapping of discrete external status → typed `VerificationResult`, stored as
  ADR-0017 evidence with sanitized labels only.
- Memory-only credential handling with explicit redaction.
- Audit event for each fetch (provider, repo/branch label, typed result, timing)
  with redaction.
- Tests proving read-only, no-write, no-autonomy, credential redaction,
  fail-closed, and typed mapping.

Out of scope:

- Any VCS/remote write (commit/push/merge/PR/review/merge-queue).
- Workspace-write/apply (ADR-0007).
- Background polling / webhooks / schedulers.
- Persisted credentials.
- Raw payload/log/token/diff display.

### 4. ADR-0007 §2 prerequisites + credential addendum (MUST all be satisfied)

| Prerequisite | ADR-0019 position |
|---|---|
| Reversibility | Read-only; performs no remote or local mutation, so nothing to reverse. |
| Containment | Outbound requests limited to the configured provider/repo for status reads only; `git` reads are read-only; no write paths. |
| Human authority preserved | Each fetch is human-triggered; no action changes remote/local state. |
| No autonomy | No poller/scheduler/daemon/webhook; no model-triggered fetch. |
| Audit completeness | Each fetch audited (provider/repo/branch label, typed result, timing) with token/secret redaction. |
| Fail-closed | Auth failure / network error / missing config / rate limit → typed `errored`/`unknown`, no retry storm, no partial success surfaced as pass. |
| Opt-in and revocable | Per-project opt-in, off by default, disableable; offline flow (ADR-0017/0018) remains fully functional when off. |
| **Credential handling (addendum)** | Tokens supplied per request, **memory-only**, never persisted to store/disk/log/audit, never echoed; scoped to read-only status; documented redaction. |

### 5. Open questions the EX handoff/review must resolve

- **Provider scope**: `git` local read only, or also remote CI/GitHub? If
  GitHub, which read-only endpoints (checks/status), and minimal token scope.
- **Credential supply**: how a read-only token is provided per request and
  proven non-persistent; behavior when absent (fail-closed `unknown`).
- **Identity mapping**: how a project maps to repo/branch/commit for the status
  query, without trusting arbitrary user-supplied URLs unsafely.
- **Rate limiting / errors**: backoff, no retry storm, timeout, fail-closed.
- **Redaction proof**: tests that tokens/URLs/raw payloads never reach store,
  audit, log, or console.
- **Boundary confirmation**: read-only client cannot be extended into a write
  path (commit/push/PR) within this slice.

## Alternatives Considered

### A. No external integration (status quo after ADR-0018)
Typed results reflect only local runs; CI/remote truth is invisible. Lower risk.

### B. Read-only `git`/CI/GitHub status → typed result (this ADR)
Recommended. Adds external grounding with the smallest viable network surface,
read-only, opt-in, human-triggered, memory-only credentials.

### C. Full VCS integration (commit/push/merge/PR)
Rejected here. That is squarely ADR-0007 workspace-write/VCS-mutation territory
and requires its own per-capability ADR(s); not in this bundle.

## Risk Acceptance

- **Outbound network surface**: first network capability. Mitigation: read-only,
  opt-in, human-triggered, scoped to status reads, fail-closed.
- **Credential exposure**: tokens are a new secret class (ADR-0007 named this).
  Mitigation: memory-only, never persisted/audited/echoed, minimal read scope,
  redaction tests.
- **Write-path erosion**: a provider client invites "also push/merge".
  Mitigation: ADR-0007 line explicitly held; no write endpoints authorized; any
  VCS mutation needs a separate ADR.
- **Autonomy creep**: status reads invite polling/webhooks. Mitigation: explicit
  no-autonomy prerequisite; human-triggered fetch only.
- **Payload leakage**: API responses/logs may carry secrets/paths. Mitigation:
  typed result + sanitized labels only; raw payloads never surfaced.

## Consequences

If accepted and implemented: the typed verification result can reflect read-only
local `git` and/or remote CI/GitHub check status, opt-in and human-triggered,
with memory-only credentials and no write/autonomy.

If rejected/deferred: verification results stay local (ADR-0018) and
manual/typed (ADR-0017); external CI/remote truth remains out of scope.

## Acceptance Conditions

An `EX-2.14-1` handoff and `REVIEW-2.14-1` closeout MUST verify:

1. **Predecessors closed**: ADR-0017 and ADR-0018 accepted and their EX batches
   closed; this ADR reuses the typed sink and result-mapping patterns.
2. **Read-only only**: no `git` write, no commit/push/merge/rebase/tag/branch
   mutation, no PR/MR/review/merge-queue action, anywhere in the change.
3. **No workspace-write/apply**: ADR-0007 line held.
4. **Opt-in + human-triggered**: off by default; each fetch is human-triggered;
   no poller/scheduler/daemon/webhook/model trigger.
5. **Credentials memory-only**: tokens never persisted to store/disk/log/audit
   and never echoed; minimal read-only scope; redaction tests included.
6. **No raw surface**: raw API payloads, raw `git` output, tokens, secret URLs,
   `sha256`, absolute paths, and diffs never reach store/audit/log/console.
7. **Typed mapping only**: discrete external status → typed
   `VerificationResult`; no free-text inference.
8. **Audit + redaction**: each fetch audited with redaction.
9. **Fail-closed**: auth/network/rate-limit/missing-config → typed
   `errored`/`unknown`, no retry storm, no false pass.
10. **Backward compatible + revocable**: disabling restores the offline flow;
    existing tests pass.
11. **Tests**: read-only/no-write, no-autonomy, credential redaction,
    fail-closed, no-raw-surface, and typed-mapping behavior.

## Allowed files (proposed for EX-2.14-1, to be finalized at acceptance)

- `packages/shared/src/types.ts` — additive opt-in provider config on `Project`
  and any read-only status DTO (reusing ADR-0017 evidence types).
- A new read-only provider module under `apps/local-server/src/` (e.g.
  `verification/status-provider.ts`) — `git`-status read and/or CI/GitHub
  read-only client, with redaction.
- `apps/local-server/src/routes/bridge-api.ts` and/or
  `apps/local-server/src/routes/project-console.ts` — human-triggered fetch
  affordance and typed-result surfacing only.
- Audit/observability wiring for the fetch event (redacted).
- `docs/contracts/bridge-projects-api.md`, `CHANGELOG.md`, relevant
  `tests/*.mjs` suites.

Exact file list is fixed in the `EX-2.14-1` handoff after acceptance; anything
outside it requires STOP-and-report.

## Handoff prompt sketch (EX-2.14-1)

> Implement only ADR-0019, and only after ADR-0017 and ADR-0018 have closed.
> Add an opt-in, per-project, read-only verification provider that reads local
> `git` status and/or remote CI/GitHub check status (human-triggered fetch) and
> maps the discrete status to the typed `VerificationResult`, stored as ADR-0017
> evidence with sanitized labels. Handle any token memory-only; never persist,
> audit, log, or echo it. Do NOT perform any VCS write (commit/push/merge/PR),
> workspace-write, background polling, or raw-payload display. Run the full
> verification command set and report read-only/credential-redaction evidence.
> One dedicated `EX-2.14-1` commit; do not commit/push until `REVIEW-2.14-1`
> authorizes.

## Status / Next

PROPOSED — DEFERRED. Final member of the bundle. Acceptance requires both
predecessors closed plus an explicit ADR-0007 §2 + credential-handling review.
