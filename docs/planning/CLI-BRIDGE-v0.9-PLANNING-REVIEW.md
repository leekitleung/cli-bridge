# CLI Bridge v0.9 Planning Review

## Verdict

PATCH REQUIRED.

v0.9 planning is directionally acceptable, but the active roadmap still contains a transport boundary mismatch that must be patched before implementation planning can be treated as closed.

## Findings

P0: none.

P1: none.

P2:

1. `docs/planning/CLI-BRIDGE-ROADMAP-AFTER-v0.3.md` still lists v0.9 preferred transport as `clipboard or managed-pty`.

   The v0.9 planning handoff correctly sets preferred transport to clipboard and allows managed PTY only with separate approval. The roadmap wording weakens that boundary and conflicts with the active v0.3 caveat that Codex Managed PTY real delivery remains experimental.

2. `docs/planning/CLI-BRIDGE-ROADMAP-AFTER-v0.3.md` says command transport is allowed if the tool has a stable non-interactive CLI mode.

   The v0.9 planning handoff requires separate approval. The roadmap should match that stricter boundary and should keep command transport review-only if it is ever approved.

## Evidence

Endpoint boundary:

- v0.9 is planning-only and does not create endpoint implementation code.
- Candidate agents are limited to OpenCode, DeepSeek TUI, and other local TUI agents as planning subjects.

Transport boundary:

- `CLI-BRIDGE-v0.9-PLANNING-HANDOFF.md` sets preferred transport to clipboard.
- The same handoff allows managed PTY only with separate approval.
- The roadmap still says `clipboard or managed-pty`, which is too broad for a preferred transport statement.

Review-only contract:

- v0.9 planning handoff requires review-only prompt and result capture contracts.
- It preserves redaction, audit, and second confirmation boundaries.

Scope leakage scan:

- The v0.9 planning handoff forbids implementation code, OpenCode adapter implementation, DeepSeek adapter implementation, command transport implementation, managed PTY transport implementation, shell endpoints, automatic source-agent feedback, automatic execution, automatic ChatGPT send, automatic agent loops, GitHub API / CI automatic reader, MCP, and app-prompt integration.

Residual caveats:

- ChatGPT Web real manual E2E remains unvalidated.
- Codex Managed PTY real delivery remains experimental.
- Clipboard handoffs do not prove real Claude Code or reverse review E2E.
- v0.8 does not validate real WorkBuddy integration.

## Required Fixes

Patch `docs/planning/CLI-BRIDGE-ROADMAP-AFTER-v0.3.md` v0.9 section:

- Change preferred transport from `clipboard or managed-pty` to `clipboard`.
- State managed PTY is separately approved fallback only and must not be the default while the v0.3 Managed PTY caveat remains active.
- State command transport requires both a stable non-interactive review-only CLI mode and separate approval.

## Verification

Required after this review document is committed:

```text
npm run build-extension
npm run lint
npm run typecheck
npm run test
```

## Next Step

Run a v0.9 planning patch only.

Do not begin v0.9 implementation until the P2 roadmap transport mismatch is patched and reviewed.
