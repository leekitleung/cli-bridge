# REVIEW-HARNESS-INFRA-CFT

Status: PASS

Date: 2026-06-22

Reviewer: RP agent (independent verification, did not trust EX report)

## Batch

EX-HARNESS-INFRA-CFT — re-land 6 harness-only infra fixes that were reverted
with `5120d45` (commit `c96742e`). Harness/tooling only — zero `apps/` product
change, zero new dependency.

## Changed Files (verified: harness + runbook only, zero apps/packages/dep)

1. `scripts/web-auto-release-e2e.ts` (+65 lines: Fix 1, 4, 6)
2. `scripts/dual-endpoint-release-e2e.ts` (+24 lines: Fix 2, 3, 5, 6)
3. `docs/runbooks/dual-endpoint-automation.md` (+8 lines: CDP build skip + port notes)

No other files touched by this batch. `chatgpt-dom.ts` changes in working tree
belong to EX-ADR0023-PROSEMIRROR (separate batch, separate review).

## Boundary Verification

### File scope (independently verified)

```
git diff --stat -- apps/ packages/ package.json package-lock.json
→ apps/extension/src/content/chatgpt-dom.ts | 27 ++++++  (EX-ADR0023, not this batch)
→ zero packages/ changes
→ zero package.json/package-lock.json changes
```

**PASS** — this batch touched only `scripts/` + `docs/runbooks/`. Zero
`apps/`, zero `packages/`, zero dependency files.

### Source-avoidance scan (independently run)

Scanned both changed script files for all forbidden patterns:

| Pattern | Matches |
|---|---|
| `KeyboardEvent` | 0 |
| `keydown` | 0 |
| `keypress` | 0 |
| `requestSubmit` | 0 |
| `.submit(` | 0 |
| `form.submit` | 0 |
| `/bridge/execution-proposals/confirm` | 0 |
| `/bridge/execution-proposals/dispatch` | 0 |

**PASS** — zero forbidden patterns. No auto-confirm, no marker fallback, no
send/submission logic introduced.

### Fix-by-fix verification (diff reviewed line-by-line)

**Fix 1 — CFT Chrome discovery:** `discoverChromePath` is now `async`. Honors
`--chrome-path` input first (existsSync check). Falls back to
`loadPlaywright()` → `playwright.chromium.executablePath()`. macOS-only
`DEFAULT_CFT_ROOT` constant removed. Both callers (`launchBrowser` + dryRun
validation) updated to `await`. ✅

**Fix 2 — CDP-mode build skip:** `createChatgptRuntime` wraps
`buildWebAutoExtension()` in `if (!args.connectCdp && !args.connectActiveChrome)`.
Existing dist check remains as clear error. ✅

**Fix 3 — Server port wiring:** `startDualEndpointServer` accepts `port` in
options (destructured, default 0). `runRealChatgptRoute` passes
`port: DEFAULT_LOCAL_SERVER_PORT` (31337), imported from
`packages/shared/src/constants.ts`. **Import only — packages/ source
unchanged.** ✅

**Fix 4 — CDP extension-id fallback:** `discoverExtensionId` falls back to
`browser.newBrowserCDPSession()` → `Target.getTargets` when
`serviceWorkers()` + `selectCliBridgeExtensionId` fails. Read-only target
enumeration: matches `service_worker` targets with `chrome-extension://` URL
and title `CLI Bridge`. Session detached in `finally` block. No injection. ✅

**Fix 5 — ACTIVE_HANDOFF_PATH Windows:** Changed from POSIX
`'/tmp/cli-bridge-dual-endpoint-active.json'` to
`resolve(tmpdir(), 'cli-bridge-dual-endpoint-active.json')` using `node:os`. ✅

**Fix 6 — Entry-point guard Windows:** Both files now use
`fileURLToPath(import.meta.url)` from `node:url` instead of
`resolve(new URL(import.meta.url).pathname)`. Fixes Windows drive-letter
doubling (`H:\H:\...`). ✅

## Test Results

| Check | Result |
|---|---|
| `npm run typecheck` (tsc --noEmit) | PASS |
| `npm run build-extension` | PASS |
| `git diff --check` (whitespace) | PASS |
| `node --test tests/dual-endpoint-release-e2e.test.mjs` | 17/17 PASS |

## Full Suite (npm test)

997 tests, 979 pass, 17 fail, 1 cancelled. All 17 failures verified as
pre-existing/environmental via baseline comparison (stash + re-run on clean
f27e000 → identical 17 failures). The 1 web-auto harness failure (#936/#19)
also fails on baseline — not a regression from this batch.

## STOP Triggers

None. All 6 fixes stayed within the 4 allowed files. No scope creep.

## Verdict

**PASS** — all 6 fixes correctly re-landed, harness-only boundary respected,
zero apps/packages/dependency changes, source-avoidance clean, tests green.
No auto-confirm, no marker fallback, no DOM/relay/loop behavior change.
