# CLI Bridge v2.18 — Operator Configured Local Launcher — RP Plan

**Status**: RP PLAN — CHANGES REQUIRED on the current dirty-tree prototype.
Dispatchable as `EX-2.18-1` on an explicit human trigger; returns to
`REVIEW-2.18-1` before any closeout/commit/push.
**Date**: 2026-06-15
**Batch**: `RP-2.18` (review/planning) → authorizes `EX-2.18-1` → `REVIEW-2.18-1`
**Owner**: reviewing/planning agent
**Reuses (no new boundary)**:
- ADR-0018 — local live verification execution (`shell:false` contained runner) — ACCEPTED & CLOSED
- ADR-0019-a — read-only local git status — ACCEPTED & CLOSED
- ADR-0019-b — remote GitHub checks provider (memory-only operator token) — ACCEPTED & CLOSED
- ADR-0022 — GitHub combined commit-status augmentation — ACCEPTED & CLOSED

---

## 0. Why this is RP, not just a test script

A hands-on (实操) verification session produced a working prototype, but the
prototype is **a new operator entry point** (`npm run start:local-server:configured`),
not a throwaway script. Per the cli-bridge batch contract, a new governed entry
point closes through a bounded RP → EX → REVIEW slice. The prototype currently
lives in the dirty tree and is **not committed**.

### ADR determination — no new ADR required

The launcher introduces **no new architectural or security boundary**:

- It **reuses** the already-accepted live capabilities (ADR-0018/0019/0022)
  exactly as accepted; it grants the runner no new permission.
- It adds **no new HTTP surface, route, endpoint, provider, or credential
  mechanism**. It only *calls* the existing authenticated `POST /bridge/projects`
  and `PATCH /bridge/projects/:key` endpoints over loopback with the printed
  pairing token.
- It does **not change** the default `npm run start:local-server` behavior
  (still no operator config → live verification stays 409 fail-closed).
- The only touched controlled runtime is one **backward-compatible** signature
  extension on `startLocalServer` (optional second arg, threaded to the existing
  `createBridgeRuntime(options)`).

Because it crosses no new boundary and changes no accepted invariant, this is a
governed-tooling slice recorded by this RP plan; **no numbered ADR is created**.
If a future change gives the launcher a *new* capability (auto-apply, a new
endpoint, a persisted token, scheduler/auto-refresh, or a runner permission
change), that requires its own ADR.

## 1. What the launcher is (scope, fixed at RP)

`scripts/start-local-configured.ts`, run via
`npm run start:local-server:configured`:

1. Reads a JSON operator config from env `CLI_BRIDGE_LOCAL_CONFIG` (a file path).
2. Builds a **memory-only** `GithubTokenStore` from env only
   (`CLI_BRIDGE_GH_TOKEN` global, `CLI_BRIDGE_GH_TOKEN__<key>` per project; `-`→`_`).
   Tokens never come from the JSON file, are never printed, never persisted.
3. Calls `startLocalServer(config.port, { projectWorkspaceRoots, verifyProfiles,
   githubChecksConfig, githubTokenStore, baselineRoot })`.
4. After bind, over loopback with the pairing token: `POST /bridge/projects`
   then `PATCH /bridge/projects/:key` to set `gitStatusEnabled` /
   `verifyProfileId` / `githubChecksEnabled` per configured project.
5. Prints URL + pairing token + a per-project feature/flag summary.

Operator-only, loopback-only, human-launched. No autonomy, no scheduler.

## 2. Findings that MUST be fixed before closeout (review verdict)

The prototype is **CHANGES REQUIRED**. Two findings block acceptance.

### F1 — Example config misleads Windows operators (correctness)

`scripts/local-config.example.json` still uses `"argv": ["npm", "run", ...]`.
The ADR-0018 runner spawns with `shell:false` (an accepted security boundary).
On Windows, Node refuses to spawn `.cmd`/`.bat` wrappers (e.g. `npm` / `npm.cmd`)
without a shell, so those profiles fail (`errored`, or a synchronous spawn throw
surfaced as HTTP 500). This was reproduced during the 实操 session:
`node --version` → `passed`; `npm.cmd run typecheck` → 500.

**Required fix**: the committed example must be runnable as-shipped. Either:
- use a real, directly-spawnable executable (e.g. `["node", "--version"]`) for
  the default example profile, **and/or**
- provide explicit OS-split example profiles with a clear note that Windows
  `argv[0]` must be a real executable (not a `.cmd`/`.bat` wrapper), because the
  runner is `shell:false` by ADR-0018.

The launcher header note already states the Windows constraint; the example file
must be consistent with it.

### F2 — Launcher silently swallows HTTP 409 on all requests (fail-closed)

The prototype's `api()` helper accepts `409` for **every** request. That is only
correct for the `POST /bridge/projects` "project already exists" idempotency
case. For `PATCH /bridge/projects/:key` (and any other config request), a `409`
(or any non-2xx) means **configuration did not take effect**, and swallowing it
makes the launcher report success while the project is unconfigured.

**Required fix**: accept a duplicate `409` **only** for the create-project POST.
Every other request (PATCH and any future config call) must **fail closed**:
throw / non-zero exit with a redacted message, so a misconfiguration is loud,
not silent.

## 3. Boundaries (fixed at RP; not EX decisions)

- No new HTTP surface/route/endpoint/provider/credential mechanism.
- No change to default `start:local-server` behavior or to runner permissions
  (`shell:false`, cwd containment, env allowlist, timeout, output cap all
  unchanged).
- Token source is env-only + memory-only store; never written to file, log,
  audit, snapshot, or stdout.
- The launcher only calls existing authenticated endpoints over loopback with
  the pairing token; it sets no project field other than the already-writable
  `gitStatusEnabled` / `githubChecksEnabled` / `verifyProfileId`.
- `startLocalServer` signature change must be backward compatible: existing
  `startLocalServer()` / `startLocalServer(port)` callers and the default
  entrypoint behave identically.
- `.gitignore` keeps real operator configs out of the repo
  (`scripts/local-config*.json`), while `scripts/local-config.example.json`
  stays tracked.

## 4. Allowed files (EX-2.18-1)

- `apps/local-server/src/server.ts` — backward-compatible optional
  `runtimeOptions` arg threaded to `createBridgeRuntime`.
- `scripts/start-local-configured.ts` — launcher (with F2 fixed; extract
  testable helpers per §5).
- `scripts/local-config.example.json` — F1 fix (runnable, OS-aware example).
- `package.json` — `start:local-server:configured` script.
- `.gitignore` — local-config ignore + example allowlist.
- `tests/local-launcher.test.mjs` (new) — §5 tests.
- `docs/contracts/bridge-projects-api.md` — only if an operator-launcher note is
  warranted; prefer a short note pointing at this RP plan.
- `CHANGELOG.md` — record `EX-2.18-1`.

Anything else → STOP and report.

## 5. Test requirements (minimum; fixed at RP)

Scripts that boot a long-lived server are hard to unit-test, so EX must extract
the testable core into pure functions and cover them. Required:

1. **Passthrough**: `startLocalServer(0, runtimeOptions)` boots on an ephemeral
   port and the injected runtime options reach the runtime — e.g. a configured
   `verifyProfiles`/`projectWorkspaceRoots` is observable through an existing
   read path (such as the verification-profiles endpoint reporting the profile),
   using an injected spawn/fetch so **no real process/network** runs.
2. **Default path unchanged**: `startLocalServer()` (no options) still yields a
   runtime where live verification is 409 fail-closed (no profiles, no roots) —
   i.e. the default entrypoint behavior is provably unchanged.
3. **F2 — no silent 409 swallow**: extract the request/bootstrap policy into a
   testable helper (e.g. `shouldAccept409(method, path)` or a `bootstrapProjects`
   that takes an injected `fetch`-like fn). Test that:
   - a `409` on `POST /bridge/projects` is treated as success (idempotent), and
   - a `409` (or other non-2xx) on `PATCH /bridge/projects/:key` **fails closed**
     (throws / signals failure), and the failure message contains no token.
4. **F1 — example validity** (lightweight): a test (or lint-style assertion)
   that the shipped `local-config.example.json` parses and its default profile
   `argv[0]` is a directly-spawnable executable (not ending in `.cmd`/`.bat`),
   so the as-shipped example cannot regress back to a shell-wrapper command.
5. **Config/token helpers**: pure `loadConfig`/validation and
   `resolveTokenForProject` (env precedence: per-project over global; missing →
   undefined) are unit-tested; assert tokens never appear in any printed/summary
   string the launcher produces.

If a full end-to-end script test is too costly, items 1–2 exercise
`startLocalServer` directly and items 3–5 exercise extracted helpers; that is the
acceptable minimum.

## 6. Verification commands (EX-2.18-1 must run and report)

- `npm run typecheck`
- `npm run lint`
- `node --test tests/local-launcher.test.mjs`
- any touched existing suites
- `npm test`
- `git diff --check`

## 7. Acceptance conditions (REVIEW-2.18-1)

1. F1 fixed: shipped example is runnable as-shipped; Windows `shell:false`
   constraint is consistent between the launcher note and the example.
2. F2 fixed: only the create-project POST tolerates `409`; all other config
   requests fail closed with redacted messaging.
3. Default `start:local-server` behavior and runner permissions provably
   unchanged (test §5.2; no new HTTP surface/route/provider/credential
   mechanism; `shell:false` and all runner caps intact).
4. `startLocalServer` signature change is backward compatible.
5. Token discipline: env-only, memory-only, never in file/log/audit/snapshot/
   stdout (test §5.5).
6. Tests §5.1–§5.5 present and passing; full verification suite green; diff-check
   clean (Windows LF/CRLF notices benign).
7. One dedicated `EX-2.18-1` commit of the allowed files; **no commit/push until
   `REVIEW-2.18-1` authorizes**.

## 8. Handoff prompt (EX-2.18-1)

> Implement only the RP-2.18 operator local launcher slice. Keep the dirty-tree
> prototype's working behavior but fix F1 and F2, and add tests.
>
> - Keep `startLocalServer(port, runtimeOptions?)` backward compatible; default
>   entrypoint and `createBridgeRuntime` default path unchanged.
> - F1: make `scripts/local-config.example.json` runnable as-shipped — default
>   profile uses a directly-spawnable executable (e.g. `node --version`) and/or
>   OS-split examples with a clear note that Windows `argv[0]` must not be a
>   `.cmd`/`.bat` wrapper (runner is `shell:false`, ADR-0018). Keep it consistent
>   with the launcher header note.
> - F2: in the launcher, accept a `409` ONLY for `POST /bridge/projects`
>   (idempotent "already exists"); every other request (PATCH and any other)
>   must fail closed (throw / non-zero exit) with a token-free message.
> - Extract testable helpers: config load/validate, `resolveTokenForProject`
>   (env precedence), and the 409/bootstrap policy (injected fetch-like fn).
> - Add `tests/local-launcher.test.mjs` covering §5.1–§5.5 with injected
>   spawn/fetch — no real process/network.
> - Do NOT add any endpoint/route/provider/credential mechanism, change default
>   behavior, or alter runner permissions. Token stays env-only + memory-only,
>   never printed/persisted.
> - Run typecheck, lint, the new suite, npm test, git diff --check. One dedicated
>   `EX-2.18-1` diff; do not commit/push until `REVIEW-2.18-1` authorizes.

## 9. Status / Next

RP-2.18 plan authored. Current prototype remains in the **dirty tree, not
committed**. `EX-2.18-1` is dispatchable on an explicit human trigger and returns
to `REVIEW-2.18-1` before closeout. No CHANGELOG entry yet (planning proposes;
EX records at implementation time).
