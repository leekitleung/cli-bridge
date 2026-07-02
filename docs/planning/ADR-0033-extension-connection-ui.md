# ADR-0033: Extension Connection UI Boundary

Status: Accepted

Date: 2026-07-02

## Context

ADR-0031 made conversation planner-gated. ADR-0032 added a local WorkBuddy
execution connector. After these changes, the browser extension should not act
as the execution control plane. Its role is to connect ChatGPT Web as a planner
or source surface and provide connection diagnostics.

## Decision

The extension UI is reduced to connection status:

- Popup: Local Bridge health, browser session pairing status, Open Project
  Console, Clear Session, and advanced manual-token fallback.
- ChatGPT page panel: planner/source connection status and Open Project Console.
- Existing manual relay utilities may remain only as collapsed legacy tools.

The extension must not expose WorkBuddy execution state, executor logs,
source/target pairing selection, accept/reject, dispatch, or route controls.

## Security Boundary

- No token in page DOM, URL, localStorage, chrome.storage.local, or persisted artifacts. Extension popup fallback may hold typed input only until save/clear.
- No WorkBuddy inbox/result/log route in extension proxy allowlist.
- No executor authority in content script or popup.
- No auto-send boundary expansion.

## Consequences

Users use `/console/project` as the main UI. The extension becomes a small
diagnostic and connector surface.
