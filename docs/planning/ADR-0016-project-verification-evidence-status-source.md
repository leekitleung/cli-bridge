# ADR-0016: Project Verification Evidence Status Source (v2.11 planning)

Status: ACCEPTED

Date: 2026-06-13
Acceptance: Senior review passed (2026-06-13) after a bounded revision that
            corrected the verification-notes boundary (`/verification.records`
            may carry raw `notes`; `/memory` is presence-only). Accepted with
            conditions on the `EX-2.11-1` handoff (see "Acceptance Conditions").
            Authorizes only a strictly read-only, note-free verification-evidence
            status source for the console status panel, derived from existing
            records (recommended Shape B: additive sanitized server-side
            summary). Does NOT authorize test/harness execution, spawn/exec,
            `git`/CI/GitHub/network, raw-notes/content display, pass/fail
            inference, `sha256`/absolute-path/diff exposure, stored
            verification-text display, or any write/apply-from-preview surface.

## Context

The project console's right-side status panel has a **Verification** card that
is still a placeholder. Today:

The two existing read-only views have **different** exposure postures, which
this ADR must not conflate:

- `apps/local-server/src/project-observability/builders.ts`
  `buildDerivedMemory()` emits a `sourceKind: 'verification'` entry
  ("Verification evidence recorded for step …"). This is **presence-only**: it
  reports that evidence exists and never echoes the raw notes or infers
  pass/fail.
- `buildHarnessVerification()` (returned by `GET /bridge/projects/:key/verification`)
  is read-only but **currently includes the raw trimmed `verificationNotes`** as
  `HarnessVerificationRecord.notes` (`builders.ts:380`), plus a v2.1 placeholder
  fallback derived from `done` plan steps. The contract documents this:
  `docs/contracts/bridge-projects-api.md` shows `"notes": "npm test passed"` in
  the `/verification` response. So `/verification` is **not** note-free today.
- `GET /bridge/projects/:key/audit` and `/memory` return their own derived
  views; `/audit` and `/memory` do not echo raw verification notes.
- The console right-panel Verification card currently renders only
  `verView.status` + a record count (styled "unavailable") and **does not render
  `notes`**; the Verification section view shows the v2.1 placeholder records
  table (also without notes).

So the data plumbing for read-only verification evidence already exists, but it
is **not uniformly note-free**: `/memory` is presence-only while `/verification`
API records still carry raw notes. The console panel happens to display only
status/count today, so a status summary can still be built safely — but only if
v2.11 derives a **sanitized summary that excludes notes** rather than relying on
the raw `/verification.records`. What is missing is that real, consolidated,
note-free **status source** for the panel.

This continues the lowest-risk branch of the roadmap. v2.5-v2.10 closed the
apply / baseline / classification / project-root line. The remaining read-only
direction ("Status panel real sources") connects naturally to the existing
`/verification`, `/memory`, `/audit`, and team-artifact records without touching
raw content, diff, writes, or any execution.

## Decision

### 0. Decision status

**ACCEPTED** (2026-06-13). Senior review passed after the bounded
verification-notes boundary revision. This decision authorizes the scope in
§1-§6 and the "Acceptance Conditions" only. No code may be written until the
`EX-2.11-1` implementation handoff is created; implementation proceeds in an
`EX-*` batch and returns to a `REVIEW-2.11-1` batch for closeout.

### 1. Whether a real verification-evidence status source is allowed

**Proposed decision**: PERMIT a strictly read-only verification-evidence status
source for the project console status panel, aggregating **only** records the
bridge already exposes through existing derived views and store data. It
introduces no execution, no new external data source, and no new raw-data
surface.

The status source MAY surface, for the active project:

- goal / plan status counts already available in the project detail/status
  (e.g. active vs terminal goals, plan step completion);
- a **count** of team slot artifacts that carry verification evidence
  (`verificationNotes` present), computed from existing inputs — but it MUST NOT
  consume or pass through the raw `notes` text itself;
- the most recent verification-evidence timestamps (presence/recency only);
- a small count of recent relevant audit events already in the audit view.

The status source MUST NOT:

- run tests, a harness, a build, or any command; spawn or exec anything;
- read `git` status, run `git`, or call any VCS/CI/GitHub API;
- consume, render, or echo raw `verificationNotes` (including the existing
  `HarnessVerificationRecord.notes` field on `/verification`), raw provider
  output, or raw artifact content;
- infer or display pass/fail/green/red beyond what is explicitly stored as a
  discrete status field (it must not parse free-text notes to guess outcomes);
- read raw baseline/result content, produce diff or line-level detail;
- expose `sha256`, absolute host paths, or isolated directory paths;
- add apply/promote/commit/write/discard controls or apply-from-preview;
- add a scheduler/model/background loop that refreshes verification state.

### 2. Scope

In scope for a future accepted implementation:

- A read-only status-source aggregation for the active project, built from
  existing derived views and store data only.
- Console status-panel rendering of that summary (counts, recency, inert
  labels), replacing the current placeholder.
- Reuse of the **presence-only** posture for the new summary (no raw notes, no
  pass/fail inference), matching `buildDerivedMemory` rather than the
  note-carrying `/verification.records`.
- Tests proving no execution, no raw-content/notes echo, no `git`/CI/network,
  and no pass/fail inference.
- Contract and CHANGELOG updates.

Out of scope:

- Running tests/harness/build; any spawn/exec.
- `git` status/diff/commit/push/merge/PR/merge queue; worktree.
- CI status reads, GitHub (or any provider) API calls, any outbound network.
- Echoing raw `verificationNotes` / provider output / artifact content.
- Pass/fail inference from free text.
- Baseline preview, raw content, `sha256`, textual diff, line-level detail.
- Apply-from-preview, promote, write, main-tree access.
- Scheduler/model-triggered refresh or autonomy.
- New project-record fields or any write surface.

### 3. Test-command text evidence — deferred

Surfacing stored test-command text is **deferred** for v2.11. The only stored
verification text today is the free-text `verificationNotes` field, and
displaying it would directly undermine the no-raw-notes boundary. Therefore
v2.11 surfaces verification evidence as **presence / counts / recency only**
("test evidence recorded (N)", most-recent timestamp), never as note text.

Inert display of stored verification text may be reconsidered only by a later
ADR, and only if a **typed, non-free-text** evidence field (for example a
discrete `result` enum or a structured command record) is introduced first.
Until then, no stored verification text is rendered.

### 4. Source-of-truth and aggregation shape

Two implementation shapes are possible; the handoff must pick one:

- **A. Client-side aggregation** (console reads existing
  `/verification` + `/memory` + `/audit` + project detail and composes the
  summary). No new endpoint. Mirrors the ADR-0013 console pattern.
- **B. Server-side derived summary** (a new pure builder, e.g.
  `buildVerificationStatusSummary`, over existing `ObservabilityInput`, exposed
  via the existing `/verification` response as an **additive** read-only summary
  field or a sibling read-only field). The summary is derived from existing
  records but **excludes** `notes`, provider output, artifact content, absolute
  paths, `sha256`, and any inferred outcome — it carries only counts, recency,
  and discrete stored status. It does not modify or remove the existing
  `records[].notes` field (backward compatible), but the new summary and the
  console panel consume only the sanitized summary, never `records[].notes`.

**Recommended: B**, as a small additive sanitized summary field on the existing
read-only verification view, because the redaction/source rules already live
server-side in `builders.ts` and a note-free summary is easier to test and keep
consistent there. Because `/verification.records` still carries raw `notes`, the
v2.11 status panel must bind to the new sanitized summary, not to the raw
records. Either shape introduces no new raw-data surface and no execution.

### 5. ADR-0007 prerequisites

| Prerequisite | ADR-0016 position |
|---|---|
| Reversibility | No write capability; read-only aggregation of existing records. |
| Containment | Reads only existing in-process store/derived views; no filesystem, no network, no spawn. |
| Human authority preserved | Viewing status never triggers apply, run, promote, or write. |
| No autonomy | No scheduler/daemon/model loop; refresh is user-driven via existing console load. |
| Audit completeness | Surfaces existing audit/verification records only; adds no new sensitive data. |
| Fail-closed | Missing/malformed records render an inert "unavailable" state with no fallback execution or reads. |
| Opt-in and revocable | Bound to the existing read-only project observability surface; no new capability toggle needed. |

### 6. Boundary and invariants

| Invariant | ADR-0016 position |
|---|---|
| Read-only presentation | Aggregation/display only; no write, run, or mutation. |
| No execution | No test/harness/build run; no spawn/exec. |
| No `git` / CI / network | No VCS, CI, or provider/GitHub API; no outbound request. |
| No raw notes / content | Presence/counts only; existing redaction posture preserved. |
| No pass/fail inference | Only explicitly stored status is shown; free text is never parsed for outcome. |
| No diff / sha256 / absolute path | Preserved. |
| No apply-from-preview / write | Preserved. |
| Existing observability APIs | Backward compatible; at most an additive read-only field (Shape B). |

## Alternatives Considered

### A. Leave the Verification card as a placeholder

Zero risk, zero value. Leaves the "Status panel real sources" direction open.

### B. Read-only aggregation of existing records (this ADR)

Recommended. Smallest useful step; reuses existing redaction-safe derived views;
no execution, no new external surface.

### C. Real harness/test execution and live pass/fail

High value but high risk: requires spawning processes, capturing output, and
trust boundaries far beyond the current read-only posture. Explicitly deferred;
needs its own ADR with a much stronger sandbox/authority story.

### D. Git/CI/GitHub status integration

Requires outbound network and credential handling; out of the current boundary.
Deferred to a separate ADR.

## Risk Acceptance

- **Pass/fail temptation**: a verification panel invites inferring green/red
  from notes. Mitigation: forbid free-text outcome inference; show only stored
  discrete status and presence/counts.
- **Raw-notes leakage**: the existing `/verification.records[].notes` field
  already carries raw notes, so a new summary must not pass them through.
  Mitigation: derive a sanitized, note-free summary (matching the presence-only
  `buildDerivedMemory` posture); bind the panel to the summary, not the raw
  records; tests assert no raw notes appear in the new surface even when input
  notes are present.
- **Scope creep to execution**: a status source can invite "just run it."
  Mitigation: this ADR forbids any execution/spawn and defers live verification
  to a separate ADR.
- **External integration creep**: panel could invite CI/GitHub badges.
  Mitigation: no network/CI/VCS is authorized here.

## Consequences

If accepted and implemented, the console status panel shows a real, read-only
summary of recorded verification evidence and project status, built from records
the bridge already holds, with no execution and no new raw-data surface.

If rejected, the Verification card stays a placeholder and the "Status panel
real sources" direction remains open.

## Acceptance Conditions

An `EX-2.11-1` handoff and closeout review MUST verify all of the following:

1. **Read-only / no execution**: no test/harness/build run, no spawn/exec, no
   `git`, no CI, no network, no GitHub/provider API anywhere in the change.
2. **Existing records only**: the summary is derived solely from existing store
   data / derived views (`/verification`, `/memory`, `/audit`, project detail).
   No new raw-data field beyond an optional additive read-only summary (Shape B).
3. **No raw notes / content in the new surface**: the new status summary and the
   console status panel never expose raw `verificationNotes`, provider output,
   artifact content, `sha256`, absolute path, or isolated dir path. Note that
   the existing `/verification.records[].notes` field may still legally carry
   raw notes for backward compatibility; tests MUST assert that even when input
   artifacts / legacy `/verification.records` contain raw `verificationNotes`,
   the new summary field and the console panel do **not** surface that text.
4. **No pass/fail inference**: only explicitly stored discrete status is shown;
   free-text notes are never parsed to derive an outcome.
5. **Presence/counts posture**: verification evidence is surfaced as
   presence/counts/recency only, never as note text and never as a computed
   result. Stored verification text display remains deferred (§3).
6. **Fail-closed rendering**: missing/malformed records render inert
   "unavailable" without triggering any read, run, or network call.
7. **No write/affordance**: no apply/promote/commit/run/discard control, link,
   or command in the status source.
8. **Determinism**: any server-side builder is a pure function of its inputs
   (same inputs → same output), matching the existing builders.
9. **Tests**: cover the summary render, the no-execution/no-network boundary,
   the no-raw-notes / no-pass-fail-inference boundary, and the fail-closed
   unavailable state.
10. **Backward compatibility**: existing observability, console, project, and
    persistence tests continue to pass; any view change is additive.

## Status / Next

ACCEPTED (2026-06-13). Proceed to the implementation handoff.

Next:

1. Author `CLI-BRIDGE-v2.11-VERIFICATION-EVIDENCE-STATUS-HANDOFF.md` for
   `EX-2.11-1`.
2. Keep implementation bounded to the read-only sanitized summary, console
   status-panel binding, tests, contract, and changelog.
3. Live harness/test execution, `git`/CI/GitHub integration, raw-notes display,
   stored verification-text display, diff/raw content, and apply-from-preview
   remain deferred and each require a separate ADR.
