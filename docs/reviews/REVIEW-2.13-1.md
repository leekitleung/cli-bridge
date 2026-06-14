# CLI Bridge v2.13 — REVIEW-2.13-1 — Local Live Verification Execution Closeout

**Batch**: `REVIEW-2.13-1` (reviewing batch — owned by the reviewing agent)
**Decision**: **PASS — closeout authorized**
**Date**: 2026-06-13
**Reviews**: `EX-2.13-1` implementation of ADR-0018 (local live verification
execution), including the `EX-2.13-1-followup-j` test/evidence fixes.

**Baseline**: `59f0905` (accept ADR-0018 + author EX-2.13-1 handoff);
`HEAD ≡ origin/main` at review start, EX dirty tree uncommitted as required.

**Governing contracts**:
- `docs/planning/ADR-0018-local-live-verification-execution.md` (ACCEPTED)
- `docs/planning/CLI-BRIDGE-v2.13-LOCAL-LIVE-VERIFICATION-HANDOFF.md`

---

## 1. Review history

`REVIEW-2.13-1-j` first returned **CHANGES REQUIRED** with three findings:

- **F1** — `tests/verification-profile-runner.test.mjs` `cwdPolicy valid subPath`
  test failed (`errored` vs expected `passed`).
- **F2** — three v2.13 `tests/project-console-behavior.test.mjs` tests failed on
  `sleep is not defined`.
- **F3** — the route confirm success test used a real `echo` spawn instead of an
  injected fake runner, leaving a weak no-execution evidence gap.

`EX-2.13-1-followup-j` addressed all three within test/evidence scope only:

- **F1 (fixture bug, not implementation bug)** — the runner compares the raw
  `root` against `path.resolve(root, subPath)`; the test passed a POSIX literal
  `/tmp/real`, which on Windows resolves to a drive-prefixed path and fails the
  containment check. Production roots come from `normalizeProjectWorkspaceRoots`
  (already `path.resolve`d), so the runner is correct for real inputs. Fix:
  the test now uses `path.resolve('/tmp/real')` and asserts spawn `cwd ===
  path.join(root, 'sub')`. **No runner/runtime change.**
- **F2** — replaced 6 `await sleep(100)` calls with the file's existing inline
  `await new Promise(r => setTimeout(r, 100))` pattern; also corrected three
  `/verification/profiles` fixtures from `data:` to `payload:` to match the test
  mock's body shape so the gate renders.
- **F3** — `makeVerifyRuntime` now injects a counting fake `verificationSpawnFn`
  via `createBridgeRuntime` (an existing hook); the confirm-success test asserts
  spawn invoked exactly once with the selected profile's `file`/`args` and
  `cwd === path.resolve(projectWorkspaceRoots['cli-bridge'])`, with no
  `stdout/stderr/output/argv/cwd/env/root` leak in response, store, or audit.
  The no-confirm / no-root / baselineRoot-no-fallback tests assert the fake
  spawn is never invoked.

## 2. Scope / allowed-files check — PASS

The EX-2.13-1 slice (14 files) is within the ADR-0018 "Allowed file families"
and the handoff's fixed list:

- `packages/shared/src/types.ts`, `packages/shared/src/schemas.ts`
- `apps/local-server/src/verification/profile-runner.ts` (new)
- `apps/local-server/src/storage/verification-run-store.ts` (new)
- `apps/local-server/src/routes/bridge-api.ts`,
  `apps/local-server/src/routes/project-console.ts`
- `apps/local-server/src/storage/project-store.ts`,
  `apps/local-server/src/storage/json-snapshot-store.ts`
- `docs/contracts/bridge-projects-api.md`, `CHANGELOG.md`
- `tests/verification-profile-runner.test.mjs`,
  `tests/bridge-projects-api.test.mjs`,
  `tests/project-console-behavior.test.mjs`, `tests/json-persistence.test.mjs`

No file outside the slice; no ADR-0019 code.

## 3. ADR-0018 acceptance-condition verdicts — all PASS

1. **ADR-0017 sink** — runs store typed `VerificationEvidence`/`VerificationRunRecord`; satisfied.
2. **Profiles only, no defined command** — only operator-configured
   `verifyProfiles` run; project/API/console reference `verifyProfileId` and
   trigger; confirm rejects `command/argv/cwd/env/shell/...` overrides (400).
3. **No shell** — runner spawns with `shell: false`, structured argv.
4. **Per-run human gate + risk disclosure** — confirm requires `confirm:true`
   (else 409); gate UI shows label + `networkRisk` + `mutationRisk`.
5. **Containment** — cwd resolved within project root; env allowlist;
   single-run lock; traversal rejected pre-spawn.
6. **Network honesty** — no bridge-initiated network / `git` / provider client
   in the new code; only the labeled posture asserted.
7. **No write/apply/commit/push/merge** — ADR-0007 line held.
8. **Typed mapping only** — exit 0 → passed, finite non-zero → failed,
   signal/timeout/spawn-error → errored; no free-text inference.
9. **No raw output** — stdout/stderr transient, capped, discarded; stored/
   displayed = result + commandLabel + timing + flags only.
10. **Audit + redaction** — run audit carries profile label/result/timing only;
    no cwd/root/argv/env/stdout/stderr.
11. **Fail-closed** — missing/disabled profile, gate denial, lock contention,
    timeout/spawn error, non-project cwd → no run or errored/unknown.
12. **No autonomy** — no scheduler/daemon/model trigger.
13. **Opt-in revocable + backward compatible** — `verifyProfileId` default off;
    removal restores no-execution flow; existing suites pass.
14. **Tests** — profile-only, `shell:false`, gate risk display, cwd/env
    containment, lock, timeout/kill, fail-closed, no-raw-output, no bridge
    network/`git`, no autonomy, typed mapping — present.
15. **Run root resolution (no fallback)** — cwd only from
    `projectWorkspaceRoots[projectKey]`; missing root → 409 + no spawn; no
    `baselineRoot` fallback; cross-project isolation; traversal rejected; audit
    excludes absolute cwd. Verified by route + runner tests.

## 4. Independent verification (reviewer reran)

| Command | Result |
|---|---|
| `node --test tests/verification-profile-runner.test.mjs` | 13/13 pass |
| `node --test tests/project-console-behavior.test.mjs` | 26/26 pass |
| `node --test tests/bridge-projects-api.test.mjs` | 54/54 pass |
| `npm run typecheck` | pass |
| `npm run lint` | pass |
| `npm test` | 657/657 pass (prior full-suite run) |
| `git diff --check` | pass (LF→CRLF warnings only) |

## 5. Findings

None blocking. The implementation is faithful to ADR-0018 (RP-2.13-a / RP-2.13-b
design) and the EX-2.13-1 handoff, with strong containment/no-execution test
coverage. The followup-j fixes stayed within test/evidence scope; no runner or
runtime behavior was changed for F1/F3.

## 6. Decision & closeout authorization

**PASS.** `REVIEW-2.13-1` authorizes the dedicated `EX-2.13-1` closeout commit
carrying exactly the 14 slice files. This review record is committed separately
as the `REVIEW-2.13-1` artifact.

## 7. Next

- ADR-0018 line is implemented and closed.
- **ADR-0019** (Git/CI/GitHub verification provider) remains **PROPOSED —
  DEFERRED**. It must not start before control returns to an `RP` batch, and it
  carries its own ADR-0007 §2 + credential-handling review prerequisites. No
  early start, no combined batch.
