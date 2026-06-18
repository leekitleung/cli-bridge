# Five-Role Hardening Follow-up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development and execute each batch only after the preceding REVIEW passes.

**Goal:** Close every reproducible Round-1 red line, then repeat the same five independent reviews against one traceable build until every score is at least 90 with no red line.

**Architecture:** Preserve server-owned routing, loopback auth, `shell:false`, no auto-send, no automatic clipboard write, and explicit preview/confirm gates. Repair data and lifecycle failures before changing product presentation, then build and capture evidence from the exact reviewed commit.

**Tech Stack:** Node.js 22, TypeScript, `node:test`, Chrome extension Manifest V3, local HTML console.

---

### Task 1: EX-90-1F data-integrity follow-up

**Files:**
- Modify: `apps/local-server/src/storage/json-snapshot-store.ts`
- Modify: `apps/local-server/src/routes/bridge-api.ts`
- Modify: `apps/local-server/src/storage/inbound-message-store.ts`
- Modify: `apps/local-server/src/storage/relay-context-store.ts`
- Test: `tests/json-persistence.test.mjs`
- Test: `tests/inbound-routing-e2e.test.mjs`

- [ ] Write failing tests proving a failed persistence mutation is not observable, inbound/relay/idempotency state survives restart, malformed records trigger backup recovery or startup failure, and rename completion includes directory durability.
- [ ] Run the focused tests and verify each fails for the missing behavior.
- [ ] Add the minimum snapshot schema and transactional/fault-state behavior needed to pass without widening any HTTP authority.
- [ ] Run focused persistence, relay, and historical boundary tests.
- [ ] Run lint, typecheck, and the full suite; publish REVIEW-90-1F before Task 2.

### Task 2: EX-90-2F terminal follow-up

**Files:**
- Modify: `scripts/start-local-configured.ts`
- Modify: `apps/local-server/src/verification/profile-runner.ts`
- Modify: `apps/local-server/src/adapters/command-runner.ts`
- Modify: `apps/local-server/src/process/contained-process.ts`
- Modify: `scripts/start-local.cmd`
- Test: `tests/local-launcher.test.mjs`
- Test: `tests/verification-profile-runner.test.mjs`
- Test: `tests/command-runner.test.mjs`
- Test: `tests/process-lifecycle.test.mjs`

- [ ] Write failing tests for opener spawn errors, symlink cwd escape, exact-cap output, Windows wrapper exit propagation, and bounded Windows tree termination.
- [ ] Verify RED, then implement only those lifecycle corrections while retaining structured argv, allowlists, cwd containment, output redaction, and `shell:false`.
- [ ] Run focused tests, historical boundary tests, and the full local gate; publish REVIEW-90-2F before Task 3.

### Task 3: EX-90-3 product workflow and launch

**Files:**
- Modify: `package.json`
- Modify: `README.md`
- Modify: `scripts/start-local-configured.ts`
- Modify: `scripts/manual-inbound-e2e.mjs`
- Modify: `apps/extension/src/content/outbound-poller.ts`
- Modify: `apps/extension/src/ui/state.ts`
- Modify: `apps/extension/src/ui/bridge-panel.tsx`
- Modify: `apps/extension/src/popup/index.ts`
- Modify: `apps/local-server/src/routes/project-console.ts`
- Test: `tests/local-launcher.test.mjs`
- Test: `tests/inbound-routing-e2e.test.mjs`
- Test: `tests/outbound-poller.test.mjs`
- Test: `tests/extension-loop-panel.test.mjs`
- Test: `tests/project-console-ui.test.mjs`
- Test: `tests/project-console-behavior.test.mjs`

- [ ] Write failing tests for `npm start`, server-owned E2E seeding, poller events, unpaired disabling, one active primary action, return in-flight lock/retry, collapse/theme/a11y contracts, and equivalent mobile navigation.
- [ ] Verify RED, then implement the approved native utility console design without auto-send, automatic clipboard writes, endpoint selection, or new execution surfaces.
- [ ] Run focused UI/interaction tests, build the extension, and run the full local gate.
- [ ] Capture popup, ChatGPT panel states, project console desktop/mobile, and failure/retry screenshots from the exact reviewed build.

### Task 4: Final evidence and five-role rerun

**Files:**
- Create: `docs/reviews/REVIEW-FIVE-ROLE-R2.md`

- [ ] Record commit, source/build hashes, screenshot paths, focused/full test counts, architecture-boundary replay, and remote gate output.
- [ ] Dispatch the same five roles independently with the same evidence manifest and scoring rule.
- [ ] If any score is below 90 or any red line remains, authorize only a findings-specific follow-up EX and repeat all five reviews.
- [ ] Commit and push only after the local gate passes; require remote-head equality and explicit passing CI before final acceptance.
