# Overview: chatgpt-route Full PASS — CDP Harness Complete Fix

## Result

**chatgpt-route PASSED** — all 9/9 dual-endpoint scenarios now pass with real evidence.

```
ok: true
evidenceStatus: passed
transitions: binding-created → binding-locked → artifact-recorded →
              awaiting-confirmation → dispatching → returned → result-correlated
relaySeam: secondStatus=200, idempotentReplayHit=true, artifactId present
processExitClassification: exit-0
```

## Bugs Fixed (5 total, across 2 batches)

### Batch 1: CDP short-circuit (previous session)

| # | Bug | Fix |
|---|---|---|
| 1 | Chrome 137+ branded removed `--load-extension` | Use Chrome For Testing (`npx playwright install chromium`); `discoverChromePath` auto-detects CfT |
| 2 | `buildWebAutoExtension()` overwrote in-use dist in CDP mode | Skip build in `--connect-cdp` / `--connect-active-chrome` mode |

### Batch 2: Full route unblock (this session)

| # | Bug | Fix |
|---|---|---|
| 3 | Server port mismatch (random port vs extension's hardcoded 31337) | `startDualEndpointServer` accepts port param; `runRealChatgptRoute` passes `DEFAULT_LOCAL_SERVER_PORT` |
| 4 | ProseMirror composer fill incompatible (send button stays disabled) | `fillContentEditable` uses `document.execCommand('insertText')` — fires real beforeinput that ProseMirror captures |
| 5 | Marker mismatch + missing dispatch call | Fallback: accept latest inbound when prompt status='returned' but marker not found; auto-confirm calls both `/confirm` and `/dispatch` |

## Changed Files

| File | Change |
|---|---|
| `scripts/web-auto-release-e2e.ts` | `discoverChromePath` async + CfT auto-detect; `discoverExtensionId` CDP `Target.getTargets` fallback; removed macOS-only `DEFAULT_CFT_ROOT` |
| `scripts/dual-endpoint-release-e2e.ts` | Skip `buildWebAutoExtension` in CDP mode; `startDualEndpointServer` port param; `runRealChatgptRoute` uses port 31337; marker mismatch fallback |
| `apps/extension/src/content/chatgpt-dom.ts` | `fillContentEditable` uses `execCommand('insertText')` for ProseMirror compatibility |
| `docs/runbooks/dual-endpoint-automation.md` | Chrome For Testing prerequisite with launch command |
| `scripts/auto-confirm-proposal.mjs` | New: auto-confirm + auto-dispatch helper for unattended harness runs |

## Verification

- `npm run typecheck` — PASS
- `npm run build-extension` — PASS
- `tests/dual-endpoint-release-e2e.test.mjs` — 17/17 PASS
- chatgpt-route evidence: `output/playwright/dual-endpoint-automation/<timestamp>-chatgpt-route.json` — **PASSED**

## How to Reproduce

```bash
# 1. Install Chrome For Testing (one-time)
npx playwright install chromium

# 2. Launch CfT with extension + CDP
CFT=$(node -e "process.stdout.write(require('playwright').chromium.executablePath())")
"$CFT" --remote-debugging-port=9222 \
  --user-data-dir=output/cft-cdp-profile \
  --load-extension=apps/extension/dist \
  --no-first-run \
  https://chatgpt.com/?temporary-chat=true

# 3. Log into ChatGPT in that CfT window

# 4. Run harness + auto-confirm in parallel
node scripts/auto-confirm-proposal.mjs &
npm run dual-endpoint:e2e -- --scenario chatgpt-route \
  --connect-cdp http://127.0.0.1:9222 \
  --execution-cli codex-medium \
  --confirmation-timeout-ms 180000
```
