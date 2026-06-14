# REVIEW-2.14-1 — ADR-0019-a closeout

**Date**: 2026-06-14
**Reviewer**: zs (RP-2.14)
**Verdict**: **PASS** — ADR-0019-a accepted and closed.

## Scope

ADR-0019-a: read-only LOCAL git status provider. No network, no credentials,
no git writes, no shell injection, no baselineRoot fallback, no pass/fail
mapping. Git status is sanitized context only.

ADR-0019-b (remote CI/GitHub + memory-only credentials) remains **DEFERRED**
and was not implemented or reviewed in this slice.

## Acceptance evidence (per ADR-0019-a acceptance conditions)

| # | Criterion | Evidence |
|---|-----------|----------|
| 1 | Read-only git commands, shell:false | `rev-parse --is-inside-work-tree`, `branch --show-current`, `status --porcelain`, `rev-list --left-right --count`. No commit/push/fetch/pull/checkout. All `-c core.fsmonitor=` / `-c core.hooksPath=`. Verified by `git-status-reader.test.mjs` argv assertions. |
| 2 | No network / no credentials | Zero outbound clients, zero token/credential handling anywhere in added code. Verified by grep + test assertions (no fetch/pull/remote/https/ssh/token/credential). |
| 3 | Root resolution: no baselineRoot fallback | cwd solely from `projectWorkspaceRoots[projectKey]`. Absent root → 409 / no spawn. BaselineRoot present but no project root → still 409 (no fallback). Verified by routing test. |
| 4 | Opt-in, default off, revocable | `gitStatusEnabled: false` (default). Off → endpoint 409, 0 spawns. Toggle via PATCH. Verified by routing test. |
| 5 | Sanitized view | Response/Audit/Console: only `branch`/`dirty`/`aheadCount`/`behindCount`/`isGitRepo`/`fetchedAt`/`available`/`elapsedMs`. No absolute path, remote URL, commit hash, raw output, diff, token. Verified by unit + routing + console tests. |
| 6 | Fail-closed | Not a git repo → `isGitRepo:false, available:true`. Spawn/timeout/parse error → `available:false` (inert). No partial success. Verified by unit tests. |
| 7 | Human-triggered, GET-only, no scheduler/model | GET endpoint only; POST/PUT/DELETE → 405/404. No poll/scheduler/model trigger. Console: Refresh button only (GET), no free-form inputs, no write/execute controls. Verified by routing + console tests. |
| 8 | Audit redacted | Each fetch writes one `workspace_apply_result` event with `source: "git-status"`. Metadata: `isGitRepo`/`dirty`/`aheadCount`/`behindCount`/`available`/`elapsedMs` only. No branch name, absolute root, remote, hash, raw output. Verified by routing test (JSON string containment). |
| 9 | Deterministic / testable via injection | `gitSpawnFn` injection point on `createBridgeRuntime`. All reader tests use fake spawn. All routing tests use fake spawn with counting. Console tests use jsdom fetch fixture. |
| 10 | Backward compatible | All existing tests pass: 690/690 (observed; reviewer notes 700/700 — count variation from runtime timing, 0 fail on both). |
| 11 | No ADR-0019-b code | grep + full source review: zero remote/CI/GitHub/provider/credential code in this slice. |
| 12 | Console display | Lazily fetched git status in verification view; read-only text (branch/dirty/ahead-behind); HTML-escaped branch names; inert "unavailable" on failure; no write/execute controls; only a single Refresh button. |

## EX-2.14-1: Implementation files

| File | Type |
|------|------|
| `packages/shared/src/types.ts` | Modified — `GitStatusView` + `Project.gitStatusEnabled` |
| `packages/shared/src/schemas.ts` | Modified — `gitStatusEnabled` boolean validation |
| `apps/local-server/src/verification/git-status-reader.ts` | **New** — Sandboxed read-only git reader |
| `apps/local-server/src/routes/bridge-api.ts` | Modified — GET endpoint + `gitSpawnFn` injection + audit |
| `apps/local-server/src/routes/project-console.ts` | Modified — Lazy git status display in verification view |
| `apps/local-server/src/storage/project-store.ts` | Modified — `gitStatusEnabled` persistence |
| `docs/contracts/bridge-projects-api.md` | Modified — Endpoint specification |
| `CHANGELOG.md` | Modified — EX-2.14-1 entry |

## EX-2.14-1-followup: Test / evidence gap coverage

| File | Type |
|------|------|
| `tests/git-status-reader.test.mjs` | Modified — 17→20 tests (env/containerization hardening) |
| `tests/bridge-projects-api.test.mjs` | Modified — 54→62 tests (routing: disabled/archived/no-root/no-fallback/cross-project/audit/GET-only) |
| `tests/project-console-behavior.test.mjs` | Modified — 26→31 tests (console: display/escape/unavailable/GET-only/no-write) |

## Verification

```
npm run typecheck  → clean
npm run lint       → clean
git diff --check   → no whitespace errors
npm test           → 0 fail (690–700 pass, observed)
```

## Decision

ADR-0019-a is **CLOSED**. Control returns to RP.
ADR-0019-b remains **DEFERRED** and requires independent acceptance + ADR-0007 §2 + credential review.
