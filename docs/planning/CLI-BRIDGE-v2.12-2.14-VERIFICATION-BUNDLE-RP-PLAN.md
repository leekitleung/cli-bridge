# CLI Bridge v2.12–v2.14 — Verification Bundle — RP-2.12 Planning Bundle

**Batch**: `RP-2.12` (review/planning — owned by the reviewing/planning agent)
**Status**: ADR-0017 ACCEPTED; ADR-0018/ADR-0019 remain PROPOSED — DEFERRED
**Date**: 2026-06-13
**Produces**: ADR-0017 (ACCEPTED), ADR-0018/ADR-0019 (PROPOSED — DEFERRED) +
this execution roadmap

This bundle continues the verification line opened by ADR-0016 (v2.11). It
plans the full chain in one pass while preserving strict batch boundaries: each
ADR gets its own EX batch, its own dedicated commit, and its own REVIEW gate.
No two ADRs may be implemented in a single combined batch.

---

## 1. Why these three, and why now

ADR-0016 (v2.11, ACCEPTED) shipped a read-only, note-free verification **status
summary** and explicitly deferred three next steps:

- §3 — stored verification-text display is blocked **until a typed, non-free-text
  evidence field exists**.
- Alternative **C** — real harness/test execution → own ADR.
- Alternative **D** — Git/CI/GitHub status integration → own ADR.

This bundle resolves all three, in the only order their dependencies allow:

```
ADR-0017  typed verification result model      (data + inert display; no execution)
   │  unblocks (typed sink)
   ▼
ADR-0018  local live verification execution     (bounded, opt-in, human-gated run → typed result)
   │  unblocks (execution + result-mapping patterns)
   ▼
ADR-0019  Git/CI/GitHub provider integration    (read-only external status → typed result)
```

Risk rises with each step: 0017 is pure schema/display; 0018 crosses the
**no-execution** boundary; 0019 crosses the **no-network/no-credential**
boundary. Each higher-risk ADR depends on its predecessor being accepted *and*
closed.

---

## 2. Dependency and gating rules

- **ADR-0017** depends on nothing; it is the foundation and can be accepted now.
- **ADR-0018** must not be accepted or implemented until ADR-0017 is accepted
  and `EX-2.12-1` has closed through `REVIEW-2.12-1`; its own acceptance must
  also fix the offline-execution proof, structured-command representation, env/
  cwd policy, and workspace-mutation risk posture.
- **ADR-0019** must not be accepted or implemented until ADR-0018 is accepted
  and `EX-2.13-1` has closed through `REVIEW-2.13-1`; its own acceptance must
  also fix provider scope, exact read endpoint(s)/command(s), credential supply,
  timeout/rate-limit behavior, and redaction proof.
- Accepting the **group** (one-time) is allowed, but each ADR retains an
  independent status, independent acceptance conditions, and an independent
  ADR-0007 §2 prerequisite review (required for 0018 and 0019). Group acceptance
  records intent; it does not collapse the gates.
- If any phase fails its REVIEW, the chain pauses; the next batch must be a
  bounded follow-up patch for that phase's findings only — not the next ADR.

---

## 3. Execution sequence (batch boundaries)

| Order | Batch | Owner | Scope | Returns to |
|---|---|---|---|---|
| 1 | `EX-2.12-1` | execution | ADR-0017 typed model: types + builder + inert console display + contract + tests | `REVIEW-2.12-1` |
| 2 | `REVIEW-2.12-1` | reviewing | Verify ADR-0017 acceptance conditions; authorize closeout commit | `RP`/next |
| 3 | `EX-2.13-1` | execution | ADR-0018 local live execution: opt-in `verifyCommand`, contained runner, exit→typed mapping, audit | `REVIEW-2.13-1` |
| 4 | `REVIEW-2.13-1` | reviewing | Verify ADR-0018 acceptance conditions + ADR-0007 §2; authorize closeout | `RP`/next |
| 5 | `EX-2.14-1` | execution | ADR-0019 read-only `git`/CI/GitHub status → typed result, memory-only creds, audit | `REVIEW-2.14-1` |
| 6 | `REVIEW-2.14-1` | reviewing | Verify ADR-0019 acceptance conditions + ADR-0007 §2 + credential review | bundle close |

Each `EX-*` produces **one dedicated commit** carrying only that slice's allowed
files. No EX batch commits/pushes until its REVIEW authorizes. No EX batch
continues into the next slice without returning to review.

---

## 4. Per-ADR handoff prerequisites

| ADR | Handoff doc to author on acceptance | Pre-acceptance gate |
|---|---|---|
| 0017 | `CLI-BRIDGE-v2.12-TYPED-VERIFICATION-MODEL-HANDOFF.md` | ADR-0017 accepted |
| 0018 | `CLI-BRIDGE-v2.13-LOCAL-LIVE-VERIFICATION-HANDOFF.md` | ADR-0017 closed + ADR-0018 accepted + ADR-0007 §2 review + offline-execution proof fixed |
| 0019 | `CLI-BRIDGE-v2.14-GIT-CI-PROVIDER-HANDOFF.md` | ADR-0018 closed + ADR-0019 accepted + ADR-0007 §2 + credential review + provider scope/redaction proof fixed |

(The handoff docs are authored in a follow-up planning step at each acceptance,
mirroring the ADR-0016 → v2.11 handoff pattern. They are not pre-written here so
that each reflects the real repo state at its time.)

---

## 5. Group acceptance ledger

Record each decision explicitly; do not mark any ADR ACCEPTED without a senior
review decision (per the workflow contract).

| ADR | Capability | Risk | Status | Accepted on | Reviewer |
|---|---|---|---|---|---|
| 0017 | Typed verification result model (data + display) | low | ACCEPTED | 2026-06-13 | Senior review |
| 0018 | Local live verification execution | high (execution) | PROPOSED — DEFERRED | — | — |
| 0019 | Git/CI/GitHub read-only provider | high (network + creds) | PROPOSED — DEFERRED | — | — |

**Group-acceptance semantics (hard rule).** "Accepting the bundle" is bounded
and does NOT promote every ADR to ACCEPTED:

- Only **ADR-0017** may be promoted to `ACCEPTED` on group acceptance, because it
  has no predecessor gate and no extra prerequisite review.
- **ADR-0018** and **ADR-0019** may at most be recorded as
  `ACCEPTED-INTENT — DEFERRED`. They MUST NOT be set to `ACCEPTED` at group
  acceptance, because each still requires, before its own acceptance:
  (a) its predecessor's `EX-*` batch closed through REVIEW, **and**
  (b) a dedicated ADR-0007 §2 prerequisite review (plus, for ADR-0019, a
  credential-handling review).
- `ACCEPTED-INTENT` confers no authorization to write code and does not satisfy
  any acceptance condition; it only records that the direction is endorsed
  pending the staged gates. Promotion of 0018/0019 to `ACCEPTED` is a separate,
  explicit senior-review decision recorded in this ledger at its own gate, after
  the unresolved sandbox/provider decisions named in §2 and §4 are fixed.
- The bundle is never implemented as a single combined batch; the per-ADR EX /
  REVIEW sequence in §3 is binding.

---

## 6. Held boundaries across the whole bundle

- ADR-0007 patch-only / no-workspace-write / no-VCS-mutation line stays held;
  none of 0017–0019 authorizes commit/push/merge/PR or apply-to-disk.
- No autonomy: no scheduler/daemon/queue/background/webhook/model trigger in any
  slice; 0018 runs and 0019 fetches are human-gated/human-triggered.
- No raw surface: raw notes, raw output, raw API payloads, tokens, `sha256`,
  absolute/isolated paths, and diffs are never rendered in any slice.
- No free-text outcome inference; the typed result comes only from explicit
  storage (0017), exit code (0018), or discrete external status (0019).

---

## 7. Next action

Dispatch `EX-2.12-1` to an execution agent using
`CLI-BRIDGE-v2.12-TYPED-VERIFICATION-MODEL-HANDOFF.md`, then return to
`REVIEW-2.12-1` before any further execution. Do not author v2.13/v2.14 handoffs
or accept ADR-0018/ADR-0019 until their predecessor closeout and
pre-acceptance design blockers are resolved.
