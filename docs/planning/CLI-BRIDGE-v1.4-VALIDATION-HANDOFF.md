# CLI Bridge v1.4 Validation Handoff — Real ChatGPT Web Manual E2E

## 1. Purpose

This is a VALIDATION handoff, not a code slice. Since v0.3 the project has carried
two unvalidated caveats: real ChatGPT Web manual E2E and real Codex Managed PTY
delivery. Earlier execution environments could not drive a logged-in browser, so
these stayed "blocked". This document gives a human operator a precise,
reproducible script to validate (or refute) the ChatGPT Web path and record
evidence.

No product code changes are required to run this. If validation reveals a defect,
that becomes a separate code slice.

## 2. Preconditions

- Node 22+ installed.
- Repo at the commit under test; record the commit hash.
- `npm install` has been run.
- A Chromium browser with a logged-in ChatGPT session.

Build and start:

```bash
npm run build-extension
npm run start:local-server   # note the printed pairing token / URL
```

Load the extension:

1. `chrome://extensions` -> Developer mode -> Load unpacked.
2. Select `apps/extension/dist`.
3. Open `https://chatgpt.com` and confirm the Bridge Panel mounts (bottom-right).

## 3. Test Matrix

For each case record: PASS / FAIL, what was observed, and any console error.

### T1 — Fill into composer
- Type text into the panel textarea, click 填入.
- Expect: text appears in the ChatGPT composer; status shows `success: filled:*`.
- Expect: ChatGPT does NOT auto-send (message is not submitted).

### T2 — Fill fallback to clipboard
- Make the composer unavailable (e.g. focus a non-chat route) and click 填入.
- Expect: status shows `fallback`; the text is on the clipboard.

### T3 — Extract user selection
- Select text in an assistant reply, click 提取.
- Expect: preview shows the selected text; status `success: selection`.

### T4 — Extract marker block
- In an assistant reply containing `## Next Prompt for Codex`, with nothing
  selected, click 提取.
- Expect: the block under the marker is extracted; status `success: marker`.

### T5 — Extract last assistant fallback
- With no selection and no marker, click 提取.
- Expect: the last complete assistant message is extracted;
  status `success: assistant-fallback`.

### T6 — Streaming blocked
- While ChatGPT is still generating, click 提取.
- Expect: status `blocked`; no text extracted.

### T7 — Copy
- With preview populated, click 复制.
- Expect: status `success: copied`; clipboard holds the preview text.

### T8 — Loop status transitions
- Observe the loop status line:
  - after a successful 填入 -> `loop: awaiting-user-send`.
  - after a successful 提取 -> `loop: pending-confirmation`.

### T9 — Server sync (optional, requires pairing token)
- Set the pairing token in extension storage (DevTools console on the extension
  service worker): `chrome.storage.local.set({ cliBridgePairingToken: '<token>' })`.
- Reload the ChatGPT tab, repeat T1 and T3.
- Expect: `GET /bridge/packets` and `GET /bridge/pending-prompts` (with the
  pairing token header) now show the recorded records.
- Expect: a redacted packet — no secret leaks into `processedContent`.

## 4. Evidence To Capture

- commit hash under test.
- per-case PASS/FAIL with one-line observation.
- screenshots for T1, T6, T8 (most fragile to DOM changes).
- for T9: the JSON returned by `/bridge/packets` and `/bridge/metrics`.

## 5. Result Recording

Append results to this file under a "## 6. Results" heading, or open a dated
review doc under `docs/reviews/`. If any case FAILs, file the specific DOM
selector or behavior gap; that becomes the next code slice.

## 6. Boundary Reminder

This validation must not be used to justify adding: auto-send, keyboard
simulation, stop-session, attach-existing-terminal, or any shell endpoint. If the
DOM path is fragile, the correct response is to strengthen the clipboard fallback,
not to automate sending.
