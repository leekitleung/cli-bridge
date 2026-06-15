# CLI Bridge v2.19 — Operator Launcher Convenience (Low-Risk Wrapper) — RP Plan

**Status**: RP PLAN — proposal only. Dispatchable as `EX-2.19-1` on an explicit
human trigger; returns to `REVIEW-2.19-1` before any closeout/commit/push.
**Date**: 2026-06-15
**Batch**: `RP-2.19` (review/planning) → authorizes `EX-2.19-1` → `REVIEW-2.19-1`
**Owner**: reviewing/planning agent
**Builds on**: RP-2.18 / EX-2.18-1 operator configured local launcher
(`f55baa8`, `47945e4`, local-only, not pushed)
**Reuses (no new boundary)**: ADR-0018/0019/0022 live capabilities unchanged;
the v2.18 launcher; the existing `/console/project` UI and its pairing-token auth.

---

## 0. Decision: no new ADR; explicitly NOT touching auth semantics

This slice is **operator convenience packaging only**. It crosses no new
architectural or security boundary:

- No new HTTP route/endpoint/provider/credential mechanism.
- No change to the pairing-token auth model. The per-session **random** token
  remains the default and is still required on every request.
- No change to runner permissions or the ADR-0018 `shell:false` boundary.
- No change to default `npm run start:local-server` behavior.

A **stable/reusable pairing token** was explicitly considered and **rejected for
this slice**: it changes auth semantics from a per-launch session secret to a
long-lived reusable key — a deliberate security downgrade that must be its own
ADR (or at least its own RP review), never folded into a convenience wrapper.
RP-2.19 therefore packages ergonomics around the *existing* token, never around
weakening it.

## 1. Scope (fixed at RP — not EX decisions)

Exactly four items:

1. **Default config path.** When `CLI_BRIDGE_LOCAL_CONFIG` is unset/empty, the
   configured launcher defaults to `scripts/local-config.json`. The env var
   still overrides. If neither the env nor the default file exists, fail with a
   clear message pointing at `scripts/local-config.example.json`.

2. **Windows double-click entry.** A `scripts/start-local.cmd` that ONLY sets
   the default config path (if not already set) and invokes the existing
   `npm run start:local-server:configured`. No logic beyond launching. Double-
   clicking it (or a shortcut to it) starts the server.

3. **Auto-open console (no token in URL at all — decision A).** After bind, the
   launcher MAY open the default browser to `{url}/console/project`.
   - The token MUST NOT be placed in the URL at all — **not** in the query and
     **not** in the `#fragment`. (Decision A: even though a fragment is not sent
     to the server, keeping the secret entirely out of the URL avoids
     mis-copy/screenshot/extension-read risk and removes hash-parsing surface.)
   - Auto-open must be **best-effort and suppressible** (honor `CLI_BRIDGE_NO_OPEN`)
     and MUST be skipped in tests / non-interactive runs. Failure to open is
     non-fatal.

4. **Console remembers token (localStorage only).** The console MAY persist the
   pairing token to `localStorage` so a returning browser session does not need
   re-entry.
   - Manual entry MUST still work and remain the default contract (a returning
     value only pre-fills; the operator can clear/overwrite it; no auto-connect).
   - The token MUST NOT be sent to the server as anything other than the
     existing `x-cli-bridge-pairing-token` header, MUST NOT enter any request
     URL/query, MUST NOT be written to the config file, server state, or any
     log/audit/summary.

## 2. Explicitly excluded (out of scope)

- A **stable/fixed pairing token** of any kind.
- The pairing token in the URL **query OR `#fragment`** (decision A: no token in
  the URL at all).
- Saving the pairing token in the config file or any server-side store.
- Any path that **bypasses** pairing-token auth.
- **Auto-enabling GitHub checks** or **auto-triggering verification** on launch
  (launch only registers/looks up; the human still clicks Confirm/Fetch).
- Any new endpoint, route, provider, or credential mechanism.
- GitHub token handling changes (still env-only + memory-only, unchanged).

## 3. Boundaries / invariants (unchanged)

- Pairing token stays a per-launch random session secret, required on every
  request. RP-2.19 only changes *where the operator copies it from*, never its
  lifecycle.
- Loopback-only, operator-only, human-launched. No autonomy/scheduler.
- Default `start:local-server` and runner permissions provably unchanged.
- GitHub token: env-only, memory-only, never persisted/printed.

## 4. Allowed files (EX-2.19-1)

- `scripts/start-local-configured.ts` — default config path resolution; optional
  best-effort, suppressible browser open (no token in the URL at all — no query,
  no fragment).
- `scripts/start-local.cmd` (new) — double-click launcher wrapper.
- `apps/local-server/src/routes/project-console.ts` — localStorage token
  persistence (default still manual). No `#fragment` token parsing (decision A).
- `tests/local-launcher.test.mjs` — default-path resolution helper test.
- `tests/project-console-behavior.test.mjs` (or the existing console suite) —
  token-discipline tests (see §5).
- `docs/contracts/bridge-projects-api.md` — only a short operator-UX note if
  warranted.
- `CHANGELOG.md` — record `EX-2.19-1`.

Anything else → STOP and report.

## 5. Test requirements (minimum; fixed at RP)

1. **Default-path resolution** is a pure/testable helper: env set → uses env;
   env unset + default file present → uses `scripts/local-config.json`; neither
   → throws a clear, example-pointing error. Cover both `resolveConfigPath`
   (path selection) AND `loadConfig({})` (missing-both throws with an
   example-pointing message). (No real server boot required.)
2. **Auto-open is inert in tests**: opening the browser is guarded so the test
   path never spawns a browser; assert the guard (e.g. suppressed when the
   no-open flag/env is set or when non-interactive).
3. **Console token discipline** (the key safety tests):
   - the persisted/parsed token never appears in any **request URL/query** —
     only in the `x-cli-bridge-pairing-token` header;
   - the token never appears as **visible DOM text** (it lives in the password
     input value / JS state / localStorage, not rendered into page text);
   - no `#fragment` token parsing exists and no token is ever read from
     `location.hash` (decision A — no token in the URL at all);
   - the token never appears in any server-facing log/summary string.
4. **Manual entry still works**: a fresh browser/profile with no stored token
   falls back to manual Connect exactly as today.
5. Existing console security tests (e.g. id-must-not-contain-`run`, no
   token/raw leakage) remain green.

## 6. Verification commands (EX-2.19-1 must run and report)

- `npm run typecheck`
- `npm run lint`
- `node --test tests/local-launcher.test.mjs`
- `node --test tests/project-console-behavior.test.mjs` (and any touched console suite)
- `npm test`
- `git diff --check`

## 7. Acceptance conditions (REVIEW-2.19-1)

1. Default config path works with env override intact; missing-both fails clearly.
2. `start-local.cmd` only sets default config + launches; contains no extra logic.
3. Auto-open never puts the token in the URL at all (no query, no fragment); no
   `location.hash` token parsing exists; auto-open is suppressible and inert
   in tests.
4. Console localStorage persistence keeps manual entry as the default contract;
   token never in request URL/query, DOM text, config, server state, or logs.
5. Auth model unchanged: per-launch random token still required on every
   request; no stable token, no bypass.
6. Default `start:local-server` behavior and runner permissions provably unchanged.
7. Excluded items (§2) absent.
8. Tests §5.1–§5.5 present and passing; full suite green; diff-check clean.
9. One dedicated `EX-2.19-1` commit of the allowed files; **no commit/push until
   `REVIEW-2.19-1` authorizes**.

## 8. Handoff prompt (EX-2.19-1)

> Implement only the RP-2.19 low-risk convenience wrapper. Do NOT change the
> pairing-token auth model: keep the per-launch random token required on every
> request; no stable/fixed/persisted-to-config token; no auth bypass.
>
> 1. Default config path: in the launcher, when `CLI_BRIDGE_LOCAL_CONFIG` is
>    unset/empty, default to `scripts/local-config.json` (env still overrides);
>    if neither exists, throw a clear error pointing at the example. Extract a
>    pure resolver helper and unit-test it.
> 2. Add `scripts/start-local.cmd` that only sets the default config path (if
>    unset) and runs `npm run start:local-server:configured`. No other logic.
> 3. Optional best-effort, suppressible browser open to `{url}/console/project`
>    after bind: never put the token in the URL at all — not in the query and
>    not in the `#fragment` (decision A). Skip in tests / non-interactive;
>    opening failure is non-fatal.
> 4. In `project-console.ts`: persist the pairing token to localStorage with
>    manual entry still the default (pre-fill the input on load, save on a
>    successful connect; never auto-connect). Do NOT add any `#fragment`/
>    `location.hash` token parsing.
>    The token must only ever be sent in the `x-cli-bridge-pairing-token`
>    header — never in a request URL/query, DOM text, config, server state, or
>    log.
> 5. Tests: default-path resolver AND `loadConfig` missing-both error; auto-open
>    inert in tests; console token discipline (not in URL/query, no fragment
>    parsing, not in DOM text, not in logs); manual entry still works; existing
>    console security tests stay green.
> 6. Exclude: stable token, token-in-config, auth bypass, auto-enable github
>    checks, auto verification, any new endpoint/credential mechanism.
> 7. Run typecheck, lint, the launcher + console suites, npm test, git diff
>    --check. One dedicated `EX-2.19-1` diff; do not commit/push until
>    `REVIEW-2.19-1` authorizes.

## 9. Status / Next

RP-2.19 plan authored (proposal only; no implementation). Repo state at
authoring: working tree clean; local `main` is **2 commits ahead** of
`origin/main` (`f55baa8` RP-2.18 plan, `47945e4` EX-2.18-1 launcher), **not
pushed**. `EX-2.19-1` is dispatchable on an explicit human trigger and returns to
`REVIEW-2.19-1` before closeout. Stable pairing token remains deferred to its own
ADR/RP.
