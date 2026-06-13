# ADR-0016: Project Verification Evidence Status Source (v2.11 planning)

Status: PROPOSED

Date: 2026-06-13

## Context

The project console's right-side status panel has a **Verification** card that
is still a placeholder. Today:

- `apps/local-server/src/project-observability/builders.ts`
  `buildHarnessVerification()` already derives a read-only
  `HarnessVerificationView` from existing store data: team slot artifacts whose
  `verificationNotes` is a non-empty trimmed string, plus a v2.1 placeholder
  fallback derived from plan steps. It never echoes raw notes and never infers
  pass/fail.
- `buildDerivedMemory()` already emits a `sourceKind: 'verification'` entry
  ("Verification evidence recorded for step …") with the same source rules and
  the same no-echo / no-pass-fail posture.
- `GET /bridge/projects/:key/verification` returns `buildHarnessVerification`;
  `GET /bridge/projects/:key/memory` and `/audit` return the other derived
  views.
- The console right-panel Verification card renders only
  `verView.status` + a record count, styled "unavailable"; the Verification
  section view shows the v2.1 placeholder records table.

So the data plumbing for read-only verification evidence already exists and is
already redaction-safe (presence-only, no raw notes, no pass/fail). What is
missing is a real, consolidated **status source** for the panel: a compact,
read-only summary that tells an operator what verification evidence has been
recorded for the active project, sourced entirely from records the bridge
already holds.

This continues the lowest-risk branch of the roadmap. v2.5-v2.10 closed the
apply / baseline / classification / project-root line. The remaining read-only
direction ("Status panel real sources") connects naturally to the existing
`/verification`, `/memory`, `/audit`, and team-artifact records without touching
raw content, diff, writes, or any execution.

## Decision

### 0. Decision status

**PROPOSED**. This ADR authorizes no implementation. No code may be written
until it is explicitly accepted and a separate `EX-2.11-1` implementation
handoff is created.

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
  (`verificationNotes` present), reusing the existing
  `buildHarnessVerification` / `buildDerivedMemory` source rules;
- the most recent verification-evidence timestamps (presence/recency only);
- a small count of recent relevant audit events already in the audit view;
- any already-recorded **test-command text evidence** that exists as stored
  artifact text, surfaced as inert text only (see §3 boundary).

The status source MUST NOT:

- run tests, a harness, a build, or any command; spawn or exec anything;
- read `git` status, run `git`, or call any VCS/CI/GitHub API;
- echo raw `verificationNotes`, raw provider output, or raw artifact content;
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
- Reuse of the existing redaction posture (presence-only, no raw notes, no
  pass/fail inference).
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

### 3. Test-command text evidence boundary

If test-command evidence is surfaced, it is limited to **inert display of text
already stored** as artifact evidence (for example a recorded command string or
a short recorded summary), shown verbatim-but-redacted under the existing
redaction rules, with no execution and no interpretation. The status source must
not:

- execute the command,
- attribute a pass/fail result to it,
- fetch or compute any new result for it.

If presence-only is safer for v2.11, the implementation MAY surface only "test
evidence recorded (N)" counts and defer any text display to a later ADR. The
implementation handoff must choose one and lock it.

### 4. Source-of-truth and aggregation shape

Two implementation shapes are possible; the handoff must pick one:

- **A. Client-side aggregation** (console reads existing
  `/verification` + `/memory` + `/audit` + project detail and composes the
  summary). No new endpoint. Mirrors the ADR-0013 console pattern.
- **B. Server-side derived summary** (a new pure builder, e.g.
  `buildVerificationStatusSummary`, over existing `ObservabilityInput`, exposed
  via the existing `/verification` response or a sibling read-only field). No
  new raw data; deterministic; matches the existing builders pattern.

**Recommended: B**, as a small additive field on the existing read-only
verification view, because the redaction/source rules already live server-side
in `builders.ts` and are easier to test and keep consistent there. Either way,
no new raw-data surface and no execution.

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
- **Raw-notes leakage**: surfacing verification evidence could leak raw notes.
  Mitigation: reuse the existing presence-only builder rules; tests assert no
  raw notes appear.
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
3. **No raw notes / content**: no raw `verificationNotes`, provider output,
   artifact content, `sha256`, absolute path, or isolated dir path appears in
   responses or console output.
4. **No pass/fail inference**: only explicitly stored discrete status is shown;
   free-text notes are never parsed to derive an outcome.
5. **Presence/counts posture**: verification evidence is surfaced as
   presence/counts/recency (and, if chosen, inert stored text per §3), never as
   a computed result.
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

PROPOSED. Await explicit accept/reject/revise decision.

If accepted:

1. Draft `CLI-BRIDGE-v2.11-VERIFICATION-EVIDENCE-STATUS-HANDOFF.md` for
   `EX-2.11-1`.
2. Keep implementation bounded to read-only aggregation, console status-panel
   rendering, tests, contract, and changelog.
3. Live harness/test execution, `git`/CI/GitHub integration, raw-notes display,
   diff/raw content, and apply-from-preview remain deferred and each require a
   separate ADR.
