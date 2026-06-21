# Dual-Endpoint Automation Runbook

This runbook verifies ADR-0024 dual-endpoint automation evidence. The harness is
release evidence tooling only. It does not grant the extension endpoint
selection, proposal edit, proposal confirmation, or execution dispatch authority.

## Prerequisites

- `npm install` has completed.
- `npm run typecheck`, `npm run build-extension`, and `npm test` pass locally.
- For CLI-route evidence, provide a real logged-in high-tier reasoning CLI
  endpoint and a distinct medium/low execution CLI endpoint:

```bash
npm run dual-endpoint:e2e -- --scenario cli-route --reasoning-cli codex-command --execution-cli codex-medium
```

- For ChatGPT-route evidence, provide either a logged-in Chrome profile or an
  existing CDP browser session:

```bash
npm run dual-endpoint:e2e -- --scenario chatgpt-route --profile-dir output/playwright/stage-b-cft-open-profile --execution-cli codex-medium
```

```bash
npm run dual-endpoint:e2e -- --scenario chatgpt-route --connect-cdp http://127.0.0.1:9224 --execution-cli codex-medium
```

## Endpoint Setup

Register endpoint identities before running real evidence:

- Reasoning endpoint role: `planner-reviewer`, tier `high`, `canExecute=false`.
- Execution endpoint role: `bounded-executor`, tier `medium` or `low`,
  `canExecute=true`.
- Same-provider evidence must use two visibly distinct profiles from one
  provider, for example `codex-command` and `codex-medium`.
- Mixed-provider evidence may pair compatible tools at start, but the binding
  must lock after approval and must not be swapped later.

## Commands

Run all scenarios:

```bash
npm run dual-endpoint:e2e -- --scenario all --reasoning-cli codex-command --execution-cli codex-medium --profile-dir output/playwright/stage-b-cft-open-profile
```

Dry-run the evidence writer and scenario contract:

```bash
npm run dual-endpoint:e2e -- --scenario all --reasoning-cli codex-command --execution-cli codex-medium --profile-dir output/playwright/stage-b-cft-open-profile --dry-run
```

Run focused harness tests:

```bash
node --experimental-strip-types --test tests/*dual-endpoint-release-e2e*.test.mjs
```

## Human Confirmation Steps

For each execution proposal, inspect the console card before confirming:

- endpoint ids and roles;
- reasoning and execution tiers;
- project and working directory;
- execution permission profile;
- Plan step and reasoning round;
- limits and deadline;
- prompt preview, content hash, and binding hash.

Confirm only once per proposal. Do not confirm a stale, edited, paused,
cancelled, expired, or wrong-binding proposal.

## Expected Evidence

Evidence is written under:

```text
output/playwright/dual-endpoint-automation/
```

Each scenario JSON includes scenario, timestamp, git commit and dirty flag, Plan
and proposal ids when available, endpoint ids and roles, tiers, binding/content
hashes, transition sequence, confirmation identity, failure classification, and
screenshot paths.

Evidence must not contain pairing tokens, cookies, credentials, raw provider
config, absolute private profile contents, complete prompts, complete replies,
or unredacted command output.

## Failure Troubleshooting

- `blocked-real-cli`: configure real high-tier reasoning and medium/low
  execution CLI endpoint ids.
- `blocked-real-chatgpt`: provide a logged-in ChatGPT profile or CDP browser.
- `confirmation-timeout`: reopen `/console/goals`, refresh server state, and
  confirm the current proposal only.
- `cleanup-failed`: inspect local server, browser, and child CLI processes; a
  successful default run must leave no harness-owned process behind.

## Cleanup

The default release run must close any harness-owned local server, browser, and
child CLI. Debug sessions may keep an externally connected CDP browser open, but
that exception must be recorded in the evidence review.
