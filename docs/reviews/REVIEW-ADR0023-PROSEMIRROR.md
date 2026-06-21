# REVIEW-ADR0023-PROSEMIRROR

Status: PASS

Date: 2026-06-22

Reviewer: RP agent (independent verification, did not trust EX report)

## Batch

EX-ADR0023-PROSEMIRROR — restore `execCommand('insertText')` composer fill in
`chatgpt-dom.ts` as an ADR-0023 in-intent bug fix (fill ≠ send).

## Changed Files (verified: exactly 3, all within allowed boundary)

1. `apps/extension/src/content/chatgpt-dom.ts` (+27 lines)
2. `tests/chatgpt-dom.test.mjs` (+97 lines)
3. `docs/planning/ADR-0023-chatgpt-web-automation-authorization.md` (+4/-1 lines)

No other files touched. Pre-existing uncommitted changes in `scripts/` and
`docs/runbooks/` belong to EX-HARNESS-INFRA-CFT (separate batch, separate
review).

## Boundary Verification

### Source-boundary scan (independently run)

Scanned `chatgpt-dom.ts` for all 8 forbidden patterns:

| Pattern | Matches |
|---|---|
| `KeyboardEvent` | 0 |
| `keydown` | 0 |
| `keypress` | 0 |
| `requestSubmit` | 0 |
| `.submit(` | 0 |
| `form.submit` | 0 |
| `click.*send` | 0 |
| `dispatchEvent.*submit` | 0 |

**PASS** — zero forbidden patterns. Bare `Enter` correctly not scanned (false
positives on `center`, `EnterText`, comments).

### ADR-0023 diff (verified line-by-line)

One bullet appended to the **Allowed** section under "ChatGPT DOM Rules":

> Composer fill may use `document.execCommand('insertText')` (or an equivalent
> `beforeinput`-firing API) to trigger the framework's input pipeline, provided
> no submission mechanism is invoked.

Prior line's `.` changed to `;` for list continuity. **Forbidden, Decision,
Superseded, Status, Acceptance Conditions — all untouched.** Exactly as
authorized.

### chatgpt-dom.ts diff (verified line-by-line)

Restored `execCommand('insertText')` as primary fill method in
`fillContentEditable`:
1. Focus composer
2. Set up selection range covering existing content
3. Call `document.execCommand('insertText', false, text)` — fires real
   `beforeinput` that ProseMirror captures
4. If execCommand returns true, return early
5. If unavailable or fails (caught), fall through to existing DOM fallback

No send-button click, no keyboard simulation, no requestSubmit, no form
submission. Pure fill path. Consistent with ADR-0023 Stage A authorization
("reliability for the existing automatic-fill path").

## Test Results

| Check | Result |
|---|---|
| `npm run typecheck` (tsc --noEmit) | PASS |
| `npm run build-extension` | PASS |
| `node --test tests/chatgpt-dom.test.mjs` | 36/36 PASS (incl. 3 new source-boundary tests) |

New tests:
- Prove fill calls `execCommand('insertText')` with correct text
- Prove beforeinput pipeline is triggered
- Source-boundary scan asserting zero forbidden patterns in chatgpt-dom.ts

## Full Suite (npm test)

997 tests, 979 pass, 17 fail, 1 cancelled. All 17 failures verified as
pre-existing/environmental (Windows sandbox: persistence fsync, runtime
rehydration, cwdPolicy symlinks, process-lifecycle spawn). Zero failures in
chatgpt-dom or any changed-area test. Baseline comparison (stash + re-run on
clean f27e000) confirmed identical 17 failures — not regressions.

## Real Chrome Evidence

DEFERRED — sandbox has no real Chrome/ChatGPT environment. execCommand path
proven via unit test with mocked document.execCommand. Real Chrome verification
deferred to REVIEW or a subsequent evidence batch. The code change is a faithful
restoration of the exact code removed by revert c96742e.

## STOP Triggers

None. All changes within 3 allowed files. No scope creep.

## Verdict

**PASS** — boundary respected, fill path correctly restored, source-boundary
proven, ADR-0023 clarification minimal and correct. No send/submission
mechanism introduced.
