# ADR-0020: Console Verification Run-History Presentation (v2.15 planning)

Status: PROPOSED — awaiting explicit acceptance

Date: 2026-06-14
Depends on: ADR-0017 (typed model), ADR-0018 (local live execution), ADR-0019-a
            (git status), ADR-0019-b (github checks) — all ACCEPTED & CLOSED
Acceptance: NOT YET ACCEPTED. This is a strictly read-only, console-only
            presentation increment that renders the **already-exposed**,
            already-sanitized `liveRunRecords` run history in the project
            console verification view. It introduces no new endpoint, no
            execution, no network, no credential, and no write surface. Because
            it crosses no capability boundary, it requires only a light
            acceptance (no ADR-0007 §2 execution/credential review).

## Context

The 0017→0019 verification bundle is CLOSED. Verification runs (ADR-0018 local
profiles, ADR-0019-b github checks) are stored as sanitized
`VerificationRunRecord`s in `verificationRunStore` and persisted across restarts
(`json-snapshot-store` round-trips `verificationRunRecords`).

`GET /bridge/projects/:key/verification` already:

- attaches the full sanitized history as `liveRunRecords` (each record:
  `projectKey`, `profileId`, `commandLabel`, `result`, `recordedAt`,
  `elapsedMs`, `truncated`, `outputDiscarded` — **no raw output, no token, no
  URL, no path, no identity**), and
- merges those runs into `summary` (counts/recency).

The project console renders the **summary** (status-panel Verification card,
ADR-0016/0017 typed counts) and the artifact-derived typed records + the live
gates (ADR-0018/0019-a/0019-b), but it **never renders `liveRunRecords`** — so
the accumulated run history (e.g. "profile X passed 3m ago; github-checks failed
1m ago") is invisible in the UI even though the server already returns it,
sanitized. This ADR closes that presentation gap.

## Decision

### 0. Decision status

**PROPOSED.** No code until explicit acceptance + an `EX-2.15-1` handoff. This is
a console-only read-only change consuming an existing response field.

### 1. What is permitted

PERMIT rendering the existing `verification.liveRunRecords` array as an **inert,
read-only run-history list** in the console verification view:

- For each record (most-recent first, capped to a small N, e.g. 20): a typed
  result pill (`passed/failed/skipped/errored/unknown`), the sanitized
  `commandLabel`, relative/ISO recency from `recordedAt`, and `elapsedMs`.
- Optional `truncated`/`outputDiscarded` shown as inert flags only.
- HTML-escape every string field before insertion.
- Missing/empty/malformed `liveRunRecords` → inert "no runs recorded" (fail-
  closed), no fetch/run/network.

### 2. What is forbidden

- No new endpoint; consume only the existing `/verification` response already
  fetched by the console (no new fetch).
- No execution, spawn, `git`, network, credential, or provider call.
- No raw output / token / URL / absolute path / commit hash / branch / owner /
  repo / diff display (the field is already sanitized; the console must not
  invent or fetch any of these).
- No write/apply/promote/commit/run/discard control, link, or affordance; no
  re-trigger button beyond the existing gates (the history list is display-only).
- No pass/fail inference; render only the stored discrete `result`.
- No scheduler/poller/auto-refresh loop.

### 3. Scope

In scope (for an accepted `EX-2.15-1`):

- Console verification view: an inert run-history list bound to
  `store.cache.verification.liveRunRecords`.
- Contract note that `liveRunRecords` is consumed by the console (the field
  already exists; document it if not already).
- Tests: history renders sanitized fields + escaping; empty/malformed → inert
  "no runs"; no write/execute control; no extra fetch; no raw/token/identity in
  DOM.
- CHANGELOG.

Out of scope:

- Any backend/endpoint change (the field is already returned).
- New verification capability, provider, execution, or boundary.
- Goal/plan-step-level binding of verification results (possible later ADR).

### 4. ADR-0007 prerequisites

| Prerequisite | ADR-0020 position |
|---|---|
| Reversibility | Pure read-only display; no state change. |
| Containment | Consumes an existing sanitized response field; no fs/network/spawn. |
| Human authority | Viewing triggers nothing. |
| No autonomy | No scheduler/auto-refresh. |
| Audit completeness | No new data; nothing to audit. |
| Fail-closed | Missing/malformed history → inert "no runs". |
| Opt-in and revocable | Bound to existing read-only verification view. |

### 5. Boundary and invariants

| Invariant | ADR-0020 position |
|---|---|
| Read-only presentation | Display only; no new fetch, no mutation. |
| No execution / network / credential | None. |
| No new endpoint | Consumes existing `/verification.liveRunRecords`. |
| No raw/token/identity surface | Sanitized fields only; HTML-escaped. |
| No write affordance | History list is inert; no controls/links. |
| No pass/fail inference | Renders stored discrete `result` only. |

## Alternatives Considered

### A. Leave run history server-only
Zero work; the UI keeps hiding data the server already returns. Rejected — low
value retained, the field exists unused.

### B. Inert console run-history list (this ADR)
Recommended. Smallest read-only step; consumes existing sanitized data; no new
surface.

### C. Bind verification results to goal/plan steps in the goal view
Higher value but larger; needs identity mapping run↔step and its own ADR.
Deferred.

## Risk Acceptance

- **Stale display**: history reflects the last `/verification` fetch only.
  Mitigation: render `recordedAt` recency; no auto-refresh implied.
- **Field drift**: a future record field could carry sensitive data.
  Mitigation: console renders an explicit allow-list of fields and escapes them;
  tests assert no raw/token/identity in the DOM even if extra fields appear.

## Consequences

If accepted and implemented: the console verification view shows the recorded,
sanitized run history, making the 0017→0019 verification output visible without
any new capability or boundary.

If rejected: run history stays server-only / summary-only.

## Acceptance Conditions

An `EX-2.15-1` handoff and `REVIEW-2.15-1` closeout MUST verify:

1. **Console-only, no backend change**: no route/endpoint/store change; consumes
   the existing `/verification.liveRunRecords` already fetched.
2. **No execution/network/credential**: none added.
3. **Allow-list render + escaping**: only `result`, `commandLabel`,
   `recordedAt`, `elapsedMs`, and inert `truncated`/`outputDiscarded` flags are
   rendered; all strings HTML-escaped; no raw/token/URL/path/hash/branch/owner/
   repo/diff.
4. **Inert / no affordance**: history list has no button/link/input or
   write/execute control; no new fetch.
5. **Fail-closed**: missing/empty/malformed `liveRunRecords` → inert "no runs".
6. **No pass/fail inference**: only stored discrete `result` rendered.
7. **Tests**: render of sanitized fields + escaping, empty/malformed → "no
   runs", no-control/no-extra-fetch, no raw/token/identity in DOM even when a
   record carries an unexpected field.
8. **Backward compatible**: existing observability/console/persistence tests
   pass; the change is additive console rendering only.

## Allowed files (proposed for EX-2.15-1)

- `apps/local-server/src/routes/project-console.ts` — render the inert
  run-history list in the verification view.
- `docs/contracts/bridge-projects-api.md` — note `liveRunRecords` is consumed by
  the console (document the sanitized field if not already).
- `CHANGELOG.md` — record `EX-2.15-1`.
- `tests/project-console-behavior.test.mjs` — the §7 tests.

Otherwise STOP and report.

## Handoff prompt sketch (EX-2.15-1)

> Implement only ADR-0020. In the console verification view, render
> `store.cache.verification.liveRunRecords` as an inert, most-recent-first,
> capped run-history list showing only the allow-listed sanitized fields
> (result pill, commandLabel, recency, elapsedMs, inert flags), all HTML-escaped.
> Add no endpoint, no fetch, no execution/network/credential, and no
> write/execute control. Missing/malformed → inert "no runs". Add the §7 tests.
> Run typecheck, lint, the touched node --test suites, npm test, git diff --check.
> One dedicated `EX-2.15-1` diff; do not commit/push until `REVIEW-2.15-1`
> authorizes.

## Status / Next

PROPOSED. On acceptance, author `CLI-BRIDGE-v2.15-VERIFICATION-RUN-HISTORY-HANDOFF.md`
for `EX-2.15-1`, then return to `REVIEW-2.15-1`.
