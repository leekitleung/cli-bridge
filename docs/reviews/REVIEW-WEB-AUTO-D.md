# REVIEW-WEB-AUTO-D - Release E2E Harness Hardening

Status: PASS

Date: 2026-06-20

## Decision

`EX-WEB-AUTO-D` is accepted.

The reusable release harness reproduced Stage B and Stage C in one real,
logged-in `--scenario all` run. The operator explicitly directed the final gate
to use ordinary Google Chrome through `--connect-cdp`; the profile-dir launch
path for Chrome-for-Testing remains supported by the same harness.

## Implemented

- `scripts/web-auto-release-e2e.ts`
  - supports `--scenario stage-b-one-round|stage-c-two-rounds|all`;
  - supports `--profile-dir`, `--chrome-path`, `--remote-debugging-port`,
    `--connect-cdp`, `--base-port`, `--output-dir`, `--keep-browser`, and
    `--dry-run`;
  - builds the extension;
  - launches Chrome-for-Testing with `apps/extension/dist`, or connects to an
    already-open CDP browser that has the extension loaded;
  - discovers the extension id;
  - selects CLI Bridge by extension manifest when a connected browser has
    multiple extension workers;
  - starts the local server through `startLocalServer`;
  - configures the server-owned inbound route used by the release scenarios;
  - injects the pairing token into extension session storage without printing
    it;
  - writes sanitized JSON evidence under `output/playwright/web-auto-release`;
  - classifies common failures;
  - closes the local server and harness-owned browser by default;
  - closes the Playwright CDP handle without closing an operator-owned browser.
- `npm run web-auto:e2e`
- `tests/web-auto-release-e2e.test.mjs`
- `docs/runbooks/web-auto-release-e2e.md`

## Real Browser Evidence

Command:

```bash
npm run web-auto:e2e -- --scenario all \
  --connect-cdp http://127.0.0.1:9225 \
  --base-port 31337 \
  --output-dir output/playwright/web-auto-release
```

Result: `ok: true`.

- Stage B JSON:
  `output/playwright/web-auto-release/2026-06-19T22-31-54-697Z-stage-b-one-round.json`
- Stage B screenshot:
  `output/playwright/web-auto-release/2026-06-19T22-31-54-697Z-stage-b-one-round.png`
- Stage C JSON:
  `output/playwright/web-auto-release/2026-06-19T22-31-54-697Z-stage-c-two-rounds.json`
- Stage C screenshot:
  `output/playwright/web-auto-release/2026-06-19T22-31-54-697Z-stage-c-two-rounds.png`

Stage B reached `returned`, preserved the required eight-event evidence
sequence, and recorded the exact inbound marker.

Stage C round 1 and round 2 both reached `returned` with inbound markers. The
final advance returned `done` with `max-rounds-reached`, created no outbound,
and the evidence contains exactly two Stage C prompt ids.

Both JSON files are sanitized and contain no pairing token, cookies, or full
assistant reply body.

## Verification

- `npm run typecheck`: passed.
- `node --experimental-strip-types --test tests/web-auto-release-e2e.test.mjs`:
  11/11 passed.
- `npm run build-extension`: passed.
- `npm test`: 942/942 passed.
- connected-browser dry-run: passed.
- invalid-scenario failure path: failed closed with usage and validation error.
- `git diff --check`: passed.
- post-run cleanup: no listener on `127.0.0.1:31337` and no harness process.

## Boundary Scan

Focused scan over the extension and release harness returned no matches:

```bash
rg -n "requestSubmit|KeyboardEvent|\\.submit\\(|localStorage|document\\.cookie|CodexManaged|MockAgent|/bridge/run|/bridge/shell|/bridge/exec" apps/extension/src apps/extension/dist scripts/web-auto-release-e2e.ts
```

The broader RP-D scan over all `scripts` reports pre-existing static allowlist
strings in `scripts/lint.mjs`:

```text
scripts/lint.mjs: MockAgentAdapter.ts
scripts/lint.mjs: CodexManagedPtyAdapter.ts
```

Those hits are pre-existing static allowlist strings in `scripts/lint.mjs`, not
runtime authority and not introduced by Stage D. The focused scan confirms the
release harness adds no prohibited browser submission fallback, cookie access,
shell/run route, managed PTY, or mock-agent authority.

## Residual Risk

Real-browser evidence remains dependent on an operator-maintained ChatGPT login
and current ChatGPT availability. One preceding attempt returned ChatGPT's own
`Something went wrong` response; the harness failed closed because the inbound
marker was absent. The accepted rerun used a clean temporary chat and passed.

Chrome-for-Testing may encounter a Cloudflare human-verification interstitial;
the final accepted run used ordinary Google Chrome as explicitly directed by
the operator. This does not change runtime, routing, loop policy, DOM submission,
or permission boundaries.
