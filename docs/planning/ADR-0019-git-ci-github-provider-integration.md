# ADR-0019: Git/CI/GitHub Verification Provider Integration (v2.14 planning)

Status: SPLIT (RP-2.14). **ADR-0019-a** (read-only LOCAL git status, offline) —
        pre-acceptance design FIXED, awaiting `REVIEW-ADR-0019-a` (ADR-0007 §2;
        no credential review needed). **ADR-0019-b** (remote CI/GitHub + memory-
        only credentials) — PROPOSED — DEFERRED.

Date: 2026-06-13 (revised 2026-06-13: RP-2.14 a/b split)
Bundle: RP-2.12 Planning Bundle (ADR-0017 → ADR-0018 → ADR-0019)
Depends on: ADR-0017 and ADR-0018 — both ACCEPTED and CLOSED
            (`EX-2.12-1` `cfce284`, `EX-2.13-1` `b87b622`)
Blocks: none (last member of the bundle)
Acceptance: NOT YET ACCEPTED. RP-2.14 split this ADR so the network/credential
            boundary is isolated. **ADR-0019-a** reads ONLY local `git`
            read-only state (no network, no credentials, no VCS write) and
            surfaces it as sanitized context; its design is fixed in
            "RP-2.14 split decision" below and it needs only an ADR-0007 §2
            review (no credential review). **ADR-0019-b** (remote CI/GitHub
            check status + memory-only credentials → typed pass/fail) remains
            DEFERRED and keeps the full credential-handling prerequisite. The
            §1-§5 umbrella text below describes the combined original intent and
            now governs ADR-0019-b.

## RP-2.14 split decision (a/b) and ADR-0019-a fixed design

**Decision (RP-2.14).** ADR-0019 is split into two independently-gated slices so
the heaviest boundary (outbound network + credentials) is isolated:

- **ADR-0019-a — read-only LOCAL git status context** (this slice, `EX-2.14-1`).
  Offline; no network; no credentials; no VCS write. Surfaces sanitized git
  status as *context only* (not a pass/fail result). Needs only an ADR-0007 §2
  review (no credential review). Design is fixed below; nothing is left to the
  execution agent.
- **ADR-0019-b — remote CI/GitHub check status + memory-only credentials** →
  typed pass/fail. Remains **PROPOSED — DEFERRED**; keeps the full
  credential-handling prerequisite and the §1-§5 umbrella scope below. Must not
  start before its own explicit acceptance + ADR-0007 §2 + credential review.

Rationale: ADR-0019-b is what crosses the network/credential line; ADR-0019-a
delivers a complete read-only chain (read → sanitized view → GET endpoint →
inert console → redacted audit) without crossing it, and can be accepted on the
lighter ADR-0007 §2 gate alone.

### ADR-0019-a — fixed pre-acceptance design (no execution-agent decisions)

- **Capability**: opt-in per project `gitStatusEnabled` (additive, default off);
  human-triggered `GET /bridge/projects/:key/verification/git-status`; reads the
  local git state of the project's workspace root. git status is **context
  only** and is **NOT** mapped to `VerificationResult` pass/fail.
- **Root resolution (reuse ADR-0018 rule)**: cwd comes ONLY from
  `projectWorkspaceRoots[projectKey]`; **no `baselineRoot` fallback**; absent
  project root → `409` / **no spawn**.
- **Exact read-only commands** (`shell: false`, structured argv, bounded
  timeout, output cap, output discarded, injectable spawn for tests):
  - `git rev-parse --is-inside-work-tree`
  - `git branch --show-current`
  - `git status --porcelain`
  - `git rev-list --left-right --count @{u}...HEAD` (ahead/behind; `null` when no
    upstream — local refs only, never `git fetch`/`pull`/network).
  No `git` write of any kind (no commit/push/merge/rebase/tag/checkout/branch
  mutation/fetch/pull).
- **Execution environment (FIXED — Containment, RP-2.14-a)**: the `git` child
  does **not** inherit the host environment. Pass a minimal env allowlist
  sufficient for `git` resolution (`PATH`; on Windows also `SystemRoot` /
  `SystemDrive`), plus fixed safety vars `GIT_TERMINAL_PROMPT=0` (never prompt
  for credentials) and `GIT_OPTIONAL_LOCKS=0`. Invoke with
  `git -c core.fsmonitor= -c core.hooksPath=<empty>` (or equivalent) so a
  repository's local config cannot drive command execution during `git status`.
  Trust note: `projectWorkspaceRoots[projectKey]` is operator-configured (never
  HTTP), so the repo is an operator-trusted location — consistent with ADR-0018
  running operator profiles in the same root; these flags are defense-in-depth.
  No network egress is performed by any command above.
- **Sanitized `GitStatusView`**: `{ branch: string|null, dirty: boolean,
  aheadCount: number|null, behindCount: number|null, isGitRepo: boolean,
  fetchedAt: number, available: boolean }`. **Never** exposes commit hash/SHA,
  remote URL, absolute path, raw git stdout/stderr, or diff. `branch` is
  length-capped and stripped of control characters, and HTML-escaped at the
  console.
- **Fail-closed**: non-repo → `isGitRepo:false`; spawn/timeout/parse error →
  inert "unavailable"; `gitStatusEnabled` off or no project root → `409`.
- **Audit**: one redacted fetch event with a fixed field whitelist
  (`project`, `isGitRepo`, `dirty`, `aheadCount`, `behindCount`, `timing`); no
  path/URL/hash/token/raw output, and not the branch name.
- **No** network, **no** credentials, **no** autonomy/poller/webhook, **no** VCS
  write, **no** write/apply/promote/run affordance.

### ADR-0019-a acceptance conditions (`REVIEW-2.14-1`)

1. Read-only git only: exactly the four read commands above; `shell:false`
   structured argv; no git write, no `fetch`/`pull`.
2. No network / no credentials anywhere in the new code (source + tests prove it).
3. Root only from `projectWorkspaceRoots[key]`; no `baselineRoot` fallback;
   absent root → `409` and **no spawn** (injected spawn call count = 0).
4. Opt-in `gitStatusEnabled` default off; off → `409`; removal restores prior
   behavior; fully backward compatible.
5. Sanitized view only: no commit hash/SHA, remote URL, absolute path, raw
   output, or diff in response / store / audit / console.
6. git status is context only; never mapped to `VerificationResult`.
7. Human-triggered GET only; no poller/scheduler/webhook/model trigger.
8. Fail-closed on non-repo / spawn / timeout / parse error.
9. Audit redacted; no sensitive fields.
10. Determinism/injection: reader testable via injected fake spawn; asserts
    read-only argv + cwd source + no sensitive output.
11. No ADR-0019-b code (no remote/CI/GitHub/provider client, no token handling).
12. **Execution environment (Containment)**: the `git` child runs with a minimal
    env allowlist (no host-env inheritance) plus `GIT_TERMINAL_PROMPT=0` and
    `GIT_OPTIONAL_LOCKS=0`, and with repo-config command execution disabled
    (`-c core.fsmonitor=` / empty hooks path). Tests assert the spawn receives
    the allowlisted env and the hardening flags, and never the full host env.
13. **Branch + audit sanitization**: `branch` is length-capped and
    control-char-stripped (and HTML-escaped at the console); the audit event
    carries only the §-fixed field whitelist and never the branch name, paths,
    URLs, hashes, tokens, or raw output.

### ADR-0019-a allowed files (for `EX-2.14-1`)

- `packages/shared/src/types.ts` — `GitStatusView`; `Project.gitStatusEnabled?`.
- `packages/shared/src/schemas.ts` — accept `gitStatusEnabled` (boolean), reject
  command/argv/cwd/env/root/remote/token-like fields.
- `apps/local-server/src/verification/git-status-reader.ts` (new) — `shell:false`
  read-only git reader, root resolution (no fallback), timeout/cap, injectable
  `gitSpawnFn`.
- `apps/local-server/src/routes/bridge-api.ts` — GET git-status endpoint + spawn
  injection wiring (read-only).
- `apps/local-server/src/routes/project-console.ts` — inert context display.
- `apps/local-server/src/storage/project-store.ts` — `gitStatusEnabled` opt-in;
  `apps/local-server/src/storage/json-snapshot-store.ts` only if opt-in
  persistence requires it.
- `docs/contracts/bridge-projects-api.md`, `CHANGELOG.md`.
- `tests/git-status-reader.test.mjs` (new), `tests/bridge-projects-api.test.mjs`,
  `tests/project-console-behavior.test.mjs`, `tests/json-persistence.test.mjs`
  (last only if opt-in persistence requires it).

The execution handoff is `CLI-BRIDGE-v2.14-GIT-STATUS-PROVIDER-HANDOFF.md`.
ADR-0019-a stays NOT ACCEPTED until `REVIEW-ADR-0019-a` (ADR-0007 §2) passes.

---

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
  result. No `git` write of any kind. The accepted handoff must name the exact
  read commands or library calls; a broad "run git" authorization is not enough.
- **CI / GitHub check status read**: read-only API calls (e.g. latest CI run or
  PR check conclusion for the project's branch/commit) mapped to typed
  `passed`/`failed`/`errored`/`unknown`. The accepted handoff must choose the
  provider(s), endpoint(s), token scope, timeout, and rate-limit behavior.
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

### 5. Pre-acceptance blockers the next planning review must resolve

These are not execution-agent design choices. ADR-0019 must not be promoted to
ACCEPTED until a planning/review batch fixes each item below and carries the
chosen answers into the `EX-2.14-1` handoff.

- **Provider scope**: `git` local read only, or also remote CI/GitHub? If
  GitHub, which read-only endpoints (checks/status), and minimal token scope.
  This must be resolved before acceptance; otherwise EX-2.14-1 is not bounded.
- **Credential supply**: how a read-only token is provided per request and
  proven non-persistent; behavior when absent (fail-closed `unknown`). This
  must be resolved before acceptance.
- **Identity mapping**: how a project maps to repo/branch/commit for the status
  query, without trusting arbitrary user-supplied URLs unsafely.
- **Rate limiting / errors**: backoff, no retry storm, timeout, fail-closed.
- **Redaction proof**: tests that tokens/URLs/raw payloads never reach store,
  audit, log, or console. This must be resolved before acceptance.
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

1. **Predecessors closed + provider design fixed**: ADR-0017 and ADR-0018
   accepted and their EX batches closed; provider scope, exact read endpoints/
   commands, credential supply, timeout/rate-limit behavior, and redaction proof
   are fixed before implementation.
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
  `verification/status-provider.ts`) — exact local `git` read(s) and/or exact
  CI/GitHub read-only client fixed by the acceptance review, with redaction.
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
> Add an opt-in, per-project, read-only verification provider using only the
> exact local `git` read(s) and/or remote CI/GitHub read-only endpoint(s) fixed
> by the acceptance review. Fetches are human-triggered and map discrete status
> to the typed `VerificationResult`, stored as ADR-0017 evidence with sanitized
> labels. Handle any token memory-only; never persist, audit, log, or echo it.
> Do NOT perform any VCS write (commit/push/merge/PR), workspace-write,
> background polling, or raw-payload display. Run the full verification command
> set and report read-only/credential-redaction evidence. Prepare one dedicated
> `EX-2.14-1` diff; do not commit/push until `REVIEW-2.14-1` authorizes the
> closeout commit.

## Status / Next

SPLIT (RP-2.14). **ADR-0019-a** (read-only local git status) has a fixed
pre-acceptance design above and awaits `REVIEW-ADR-0019-a` (ADR-0007 §2 only);
on acceptance, dispatch `CLI-BRIDGE-v2.14-GIT-STATUS-PROVIDER-HANDOFF.md` for
`EX-2.14-1`, then return to `REVIEW-2.14-1`. **ADR-0019-b** (remote CI/GitHub +
memory-only credentials) remains PROPOSED — DEFERRED and keeps the full
ADR-0007 §2 + credential-handling prerequisite; it must not start before its own
explicit acceptance and must never be merged into the ADR-0019-a batch.
