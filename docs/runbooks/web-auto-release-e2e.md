# Web Auto Release E2E Runbook

## Purpose

Use `scripts/web-auto-release-e2e.ts` to reproduce the accepted ChatGPT Web
automation release evidence from a logged-in Chrome-for-Testing profile.

This is local evidence tooling only. It does not add product authority and does
not grant shell, workspace write, Git, MCP, PR, merge, or deployment access to
the browser extension.

## Prerequisites

- Node/npm are installed.
- The repository dependencies are installed.
- A Chrome-for-Testing binary is available. The harness defaults to the local
  Playwright cache when present.
- `--profile-dir` points to a Chrome-for-Testing profile already logged in to
  ChatGPT.
- No other process is bound to the chosen `--base-port` or
  `--remote-debugging-port`.

The harness builds `apps/extension/dist`, launches Chrome-for-Testing with the
unpacked extension, starts the local server, injects the pairing token into
extension session storage, and never prints the token.

## Commands

Dry-run argument and local preflight check:

```bash
npm run web-auto:e2e -- --dry-run --scenario all --profile-dir output/playwright/stage-b-cft-open-profile
```

Run both release scenarios:

```bash
npm run web-auto:e2e -- --scenario all --profile-dir output/playwright/stage-b-cft-open-profile
```

Run against an already-open Chrome or Chrome-for-Testing instance with CDP enabled:

```bash
npm run web-auto:e2e -- --scenario all --connect-cdp http://127.0.0.1:9224
```

The connected browser must already be logged in to ChatGPT and must already have
the unpacked `apps/extension/dist` extension loaded with an active service
worker. Other installed extensions are allowed; the harness identifies CLI
Bridge from its extension manifest. In `--connect-cdp` mode the harness closes
its Playwright CDP handle at the end; it does not close the operator-owned
browser.

Run only Stage B:

```bash
npm run web-auto:e2e -- --scenario stage-b-one-round --profile-dir output/playwright/stage-b-cft-open-profile
```

Run only Stage C:

```bash
npm run web-auto:e2e -- --scenario stage-c-two-rounds --profile-dir output/playwright/stage-b-cft-open-profile
```

Optional debugging:

```bash
npm run web-auto:e2e -- --scenario all --profile-dir output/playwright/stage-b-cft-open-profile --keep-browser
```

Use `--keep-browser` only for manual debugging. By default, the harness closes
the local server and harness-owned browser.

## Expected Output

Successful CLI output is a small JSON object:

```json
{
  "ok": true,
  "evidence": [
    {
      "scenario": "stage-b-one-round",
      "screenshotPath": "...",
      "promptIdsHash": "..."
    }
  ]
}
```

Detailed evidence is written under:

```text
output/playwright/web-auto-release/
```

Each scenario writes:

```text
<timestamp>-<scenario>.json
<timestamp>-<scenario>.png
```

The JSON includes scenario, timestamp, git commit, dirty-tree flag, extension
id, Chrome version, server port, prompt ids, loop id when applicable, outbound
evidence sequence, inbound marker checks, hard-stop result for Stage C, and the
screenshot path.

The JSON must not include pairing tokens, cookies, or full assistant reply
text. Marker strings are retained because they are the acceptance proof.

## Acceptance Checks

Stage B passes when the outbound evidence sequence is exactly:

```text
queued -> claimed -> filled-and-acknowledged -> waiting-manual-send -> submitted -> responding -> response-ready -> returned
```

and the inbound queue contains the scenario marker.

Stage C passes when:

- round 1 reaches `returned`;
- round 1 inbound marker is present;
- round 2 is created exactly once;
- round 2 reaches `returned`;
- round 2 inbound marker is present;
- final advance returns `done` with `max-rounds-reached`;
- no third outbound is created;
- the ChatGPT page does not contain the third-round sentinel marker.

## Failure Classes

The harness writes sanitized failure JSON for common failures:

- `build-failed`
- `playwright-unavailable`
- `chrome-unavailable`
- `chrome-launch-failed`
- `extension-missing`
- `extension-id-missing`
- `not-logged-in`
- `panel-unpaired`
- `chatgpt-timeout`
- `outbound-failed`
- `inbound-missing`
- `hard-stop-failed`
- `cleanup-failed`
- `unexpected-error`

## Troubleshooting

If the harness reports `not-logged-in`, open the supplied profile manually in
Chrome-for-Testing and sign in to ChatGPT, then rerun.

If it reports `extension-id-missing`, run `npm run build-extension` and confirm
`apps/extension/dist/manifest.json` exists. For `--connect-cdp`, also open
`chrome://extensions`, confirm developer mode is enabled, and reload the already
installed CLI Bridge extension so its service worker is active.

If it reports `panel-unpaired`, check that the ChatGPT page displays the
`CLI BRIDGE` panel and that no other local server is using the selected port.

If it reports `chatgpt-timeout`, inspect the screenshot. ChatGPT may be slow,
rate-limited, logged out, or blocked by an interstitial.

If cleanup fails, check:

```bash
lsof -nP -iTCP:<base-port> -sTCP:LISTEN
```

By default a successful run should leave no local server and no harness-owned
Chrome-for-Testing process running.
