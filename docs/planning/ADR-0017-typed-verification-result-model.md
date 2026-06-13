# ADR-0017: Typed Verification Result Model (v2.12 planning)

Status: ACCEPTED

Date: 2026-06-13
Bundle: RP-2.12 Planning Bundle (ADR-0017 → ADR-0018 → ADR-0019)
Depends on: none (foundation of the bundle)
Blocks: ADR-0018 (local live verification execution), ADR-0019 (Git/CI/GitHub provider)
Acceptance: ACCEPTED by senior review (2026-06-13) for `EX-2.12-1` only.
            This ADR is the data-model-only foundation of the v2.12-v2.14
            verification line. It authorizes a strictly additive,
            **non-executing** typed verification-result field plus its inert
            display. It does NOT authorize any product/runtime capability to run
            tests/harness/build, spawn/exec, `git`/CI/GitHub/network,
            raw-notes/raw-output display, pass/fail inference from free text, or
            any write/apply surface. Execution-agent verification commands
            remain allowed only as review checks, not as product behavior.
            ADR-0018 and ADR-0019 remain PROPOSED — DEFERRED.

## Context

ADR-0016 (v2.11, ACCEPTED) shipped a strictly read-only, note-free
verification-evidence **status summary** for the project console. In doing so it
recorded a hard limitation in §3 ("Test-command text evidence — deferred"):

> The only stored verification text today is the free-text `verificationNotes`
> field … Inert display of stored verification text may be reconsidered only by
> a later ADR, and only if a **typed, non-free-text** evidence field (for
> example a discrete `result` enum or a structured command record) is introduced
> first.

The current code confirms the gap. Verification evidence is **free text only**:

- `packages/shared/src/types.ts`
  - `SlotArtifact.verificationNotes?: string` — free text, the only stored
    verification text.
  - `HarnessVerificationRecord.harnessStatus: string` — a free, untyped string;
    not a discrete enum.
  - `VerificationStatusSummary` (added in v2.11) carries note-free
    counts/recency only (`evidenceCount`, `lastRecordedAt`, `doneStepCount`,
    `totalStepCount`).
- `apps/local-server/src/project-observability/builders.ts`
  - `buildVerificationStatusSummary` counts artifacts whose `verificationNotes`
    is a non-empty trimmed string; `buildHarnessVerification` echoes the raw
    `notes` for backward compatibility but the console binds only to `summary`.

Because there is no typed, discrete result field, the console can only ever show
presence/counts/recency. It cannot show "passed / failed / skipped" without
either (a) parsing free text — forbidden by ADR-0016 §6 ("No pass/fail
inference") — or (b) introducing the typed field this ADR proposes.

This ADR is the lowest-risk member of the v2.12-v2.14 bundle. It is a **pure
schema + presentation** change. It introduces no execution, no network, and no
new external data source. It is the prerequisite §3 named, and it unblocks the
two higher-risk ADRs that actually *produce* a typed result:

- ADR-0018 (local live verification execution) populates the typed field from a
  bounded, human-gated local command run.
- ADR-0019 (Git/CI/GitHub provider) populates it from a read-only provider
  status read.

Neither downstream ADR can store a trustworthy discrete outcome until a typed
field exists. Hence this foundation lands first.

## Decision

### 0. Decision status

**ACCEPTED** (2026-06-13). Senior review accepted ADR-0017 only, with execution
delegated to a separate execution agent. No runtime code may be written until an
`EX-2.12-1` implementation handoff is authored. Implementation proceeds in an
`EX-2.12-1` batch and returns to `REVIEW-2.12-1` for closeout. Acceptance of
this ADR does **not** imply acceptance of ADR-0018 or ADR-0019.

### 1. What is permitted

PERMIT a strictly additive, non-executing **typed verification result** model:

- A discrete `VerificationResult` enum (proposed values:
  `'passed' | 'failed' | 'skipped' | 'errored' | 'unknown'`; implementer
  finalizes the exact closed set as an `as const` tuple, matching the existing
  `SLOT_STATUSES` / `TEAM_STATUSES` style).
- An additive structured `VerificationEvidence` record carrying **typed**
  fields only — for example: `result: VerificationResult`, an optional
  non-free-text `commandLabel?: string` (a short, enumerated/sanitized label,
  **not** an arbitrary command line), `recordedAt: number`, and provenance
  (`teamId`, `slotId`, `planStepId`). It MUST NOT carry raw command output, raw
  notes, exit-code-derived stack traces, paths, or `sha256`.
- An optional additive typed field on the recording path (e.g.
  `SlotArtifact.verificationResult?: VerificationResult` and/or a typed field on
  the observability record) so a result can be stored **through the existing
  artifact-recording flow** — the same path that sets `verificationNotes` today.
- Extension of `VerificationStatusSummary` / `HarnessVerificationView` with
  additive typed counts (e.g. counts by discrete result) — still note-free.
- Console rendering of the **discrete typed status** as inert text (now
  permitted because it is typed, not free-text parsing). This satisfies the
  ADR-0016 §3 condition for showing a stored discrete outcome.

### 2. What is forbidden (unchanged from ADR-0016)

This ADR MUST NOT, and does not authorize product/runtime code to:

- run tests, a harness, a build, or any command; spawn or exec anything;
- read or run `git`, call any VCS/CI/GitHub API, or make any outbound network
  request;
- populate the typed field from execution or from a provider — **storing a
  result is still done only through the existing manual/provider artifact path**
  and the value is treated as untrusted, advisory input (execution-based
  population is ADR-0018; provider-based population is ADR-0019);
- infer the typed `result` by parsing free-text `verificationNotes` (no
  pass/fail inference; the typed field is only set when explicitly supplied);
- display raw `verificationNotes`, raw provider output, artifact content,
  `sha256`, absolute/isolated paths, or diff;
- add any apply/promote/commit/run/discard control or apply-from-preview;
- add a scheduler/model/background loop.

### 3. Scope

In scope (for an accepted `EX-2.12-1`):

- Additive typed `VerificationResult` enum and `VerificationEvidence` type in
  `packages/shared`.
- Additive optional typed field on the artifact/record recording path.
- Additive typed counts on the summary/view; note-free preserved.
- Inert console rendering of the discrete typed status.
- Contract + CHANGELOG updates; tests proving the boundaries.

Out of scope:

- Any execution / spawn / exec (ADR-0018).
- Any `git`/CI/GitHub/network/credential handling (ADR-0019).
- Pass/fail inference from free text.
- Raw notes/output/content/diff/`sha256`/path display.
- Removing or changing the existing `verificationNotes` / `notes` /
  `harnessStatus` fields (must stay backward compatible).
- Any write/apply/promote surface.

### 4. ADR-0007 prerequisites

| Prerequisite | ADR-0017 position |
|---|---|
| Reversibility | Pure additive schema/display; no write to workspace or VCS. |
| Containment | No filesystem, network, or spawn; in-process types and derived views only. |
| Human authority preserved | Storing a typed result uses the existing human/provider artifact path; viewing triggers nothing. |
| No autonomy | No scheduler/daemon/model loop. |
| Audit completeness | Typed result is additive provenance; no new sensitive data, no raw output. |
| Fail-closed | Missing/malformed typed result renders inert "unknown"/"unavailable". |
| Opt-in and revocable | Additive field; absence is valid and behaves as today. |

### 5. Boundary and invariants

| Invariant | ADR-0017 position |
|---|---|
| Read-only presentation | Display only; storing a result reuses the existing recording path, adds no new write surface. |
| No execution | No test/harness/build run; no spawn/exec. |
| No `git` / CI / network | None. |
| No raw notes / output / content | Typed discrete fields only; raw `notes` left intact but never newly surfaced. |
| No pass/fail inference | Typed `result` is only shown when explicitly stored; free text is never parsed. |
| No diff / sha256 / absolute path | Preserved. |
| No apply-from-preview / write | Preserved. |
| Backward compatibility | Existing `verificationNotes`/`notes`/`harnessStatus` unchanged; all additions optional. |

## Alternatives Considered

### A. Keep free-text only
Zero work, but permanently blocks any trustworthy discrete-outcome display and
blocks ADR-0018/ADR-0019, which need a typed sink. Rejected.

### B. Typed result model, data + inert display only (this ADR)
Recommended. Smallest step that unblocks the line; no execution, no network.

### C. Introduce the typed field together with execution
Couples a safe schema change to the high-risk execution boundary. Rejected:
violates the bundle's "each capability independently gated" rule and the
batch-boundary contract.

## Risk Acceptance

- **Inference temptation**: a typed `result` invites auto-deriving it from
  notes. Mitigation: ADR forbids inference; result is set only when explicitly
  supplied through the existing path; tests assert free text never yields a
  typed result.
- **Field bloat / leakage**: a structured evidence record could grow to carry
  raw output. Mitigation: closed typed field set; `commandLabel` is a
  sanitized/enumerated label, not a command line; tests assert no raw
  output/path/hash in the typed surface.
- **Premature trust**: a stored `result` could be mistaken for verified truth.
  Mitigation: the value remains untrusted/advisory in v2.12 (no execution proves
  it); only ADR-0018/ADR-0019 produce machine-grounded results.

## Consequences

If accepted and implemented: the console can show a discrete, typed verification
status (passed/failed/etc.) when one is stored, satisfying ADR-0016 §3, with no
execution and no new raw surface. The typed field becomes the sink that
ADR-0018 and ADR-0019 populate.

If rejected: verification display stays presence/counts only, and ADR-0018 /
ADR-0019 cannot store a trustworthy discrete outcome.

## Acceptance Conditions

An `EX-2.12-1` handoff and `REVIEW-2.12-1` closeout MUST verify:

1. **No product execution / no network**: no test/harness/build runner, no
   spawn/exec, no `git`, no CI, no GitHub/provider API, no outbound request
   added to product/runtime code. Execution-agent verification commands are
   permitted only for review and must not become bridge behavior.
2. **Additive & backward compatible**: existing `verificationNotes`, `notes`,
   `harnessStatus`, and `VerificationStatusSummary` fields are unchanged; all new
   fields are optional.
3. **Typed, closed result set**: `VerificationResult` is a closed `as const`
   tuple; no free-text outcome field is introduced.
4. **No inference**: a free-text `verificationNotes` (e.g. "npm test passed")
   does NOT produce a typed `result`; the typed field is set only when explicitly
   supplied.
5. **No raw surface**: the typed evidence/summary/console never expose raw
   notes, raw output, artifact content, `sha256`, absolute/isolated path, or
   diff. `commandLabel` (if present) is a sanitized label, not a command line.
6. **Inert display**: the console renders the discrete typed status as inert
   text with no affordance; missing result → inert "unknown"/"unavailable"
   fail-closed.
7. **Determinism**: any builder change remains a pure function of inputs.
8. **Tests**: cover the typed-result render, no-inference, no-raw-surface,
   backward compatibility, and fail-closed behavior.

## Allowed files (proposed for EX-2.12-1)

- `packages/shared/src/types.ts` — add `VerificationResult` const/type,
  `VerificationEvidence` type, optional typed field on `SlotArtifact` and/or the
  observability record; extend `VerificationStatusSummary`/
  `HarnessVerificationView` additively.
- `packages/shared/src/schemas.ts` — update artifact validation/allowlists for
  the additive typed result field only; do not allow command/output/path/hash
  fields.
- `apps/local-server/src/project-observability/builders.ts` — populate typed
  counts / typed record fields from existing inputs; no new source.
- `apps/local-server/src/routes/project-console.ts` — render the discrete typed
  status inertly.
- `apps/local-server/src/routes/bridge-api.ts` — wiring-only acceptance of the
  typed artifact field if required by the existing artifact-recording path; no
  new route and no execution/provider logic.
- `docs/contracts/bridge-projects-api.md` — document the additive typed fields.
- `CHANGELOG.md` — record `EX-2.12-1`.
- `tests/bridge-project-observability.test.mjs`,
  `tests/project-console-behavior.test.mjs`, `tests/bridge-teams-api.test.mjs`
  (and `-ui` if needed) — boundary tests.

Otherwise STOP and report rather than expand scope.

## Handoff prompt sketch (EX-2.12-1)

> Implement only ADR-0017. Add the additive typed `VerificationResult` enum and
> `VerificationEvidence` record, an optional typed result field on the existing
> recording path, additive typed counts on the verification summary/view, and
> inert console rendering of the discrete typed status. Do NOT run anything,
> touch `git`/CI/network, infer results from free text, or surface raw
> notes/output. Keep all changes additive and backward compatible. Run
> `npm run typecheck`, `npm run lint`, the listed `node --test` suites,
> `npm test`, and `git diff --check`. Prepare one dedicated `EX-2.12-1` diff
> carrying only the allowed files; do not commit/push until `REVIEW-2.12-1`
> authorizes the closeout commit.

## Status / Next

ACCEPTED. Proceed to `CLI-BRIDGE-v2.12-TYPED-VERIFICATION-MODEL-HANDOFF.md` for
`EX-2.12-1`, then return to `REVIEW-2.12-1`. ADR-0018 and ADR-0019 remain
PROPOSED — DEFERRED and each require their own acceptance and their
predecessor's closeout.
