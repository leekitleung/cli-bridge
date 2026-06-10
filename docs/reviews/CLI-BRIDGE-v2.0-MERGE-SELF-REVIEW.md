# CLI Bridge v2.0 — Merge Self-Review

**Date**: 2026-06-10
**Branch**: `feat/v2.0-goal-data-model`

## Scope Summary

v2.0 adds Project Workspace — a project-centric data model and console that
organizes bridge records (goals, reviews, prompts, audit events) under named
projects with metadata editing, archive/unarchive lifecycle, and project-scoped
audit filtering.

### Implemented

| Feature | Detail |
|---------|--------|
| `/console/project` | Three-region project workspace UI (nav, workspace, status) |
| `/bridge/projects` | Aggregation endpoint — lists projects with stats |
| `/bridge/projects/:key` | Project detail — goals, reviews, prompts, audit, derived status |
| `PATCH /bridge/projects/:key` | Metadata editing (label, description) |
| Archive/unarchive | Soft-archive, guards, `?includeArchived=true` toggle |
| AuditEvent.projectId | Authoritative filtering + legacy packetId fallback |
| Snapshot persistence | Metadata, archive state, audit projectId survive restart |
| Console management UI | Inline edit, archive buttons, show-archived toggle |

### Not in scope (v2.1+ / future)

- Hard-delete (`DELETE /bridge/projects/:key`)
- Status panel real data sources (git, test-run, memory, etc.)
- AgentTeam multi-agent orchestration
- Model API integration

## Security Boundary

| Concern | Status |
|---------|--------|
| Console HTML | Server-rendered static HTML; inline JS uses `escapeHtml()` on all server-derived values |
| API paths | Console fetches only allowlisted `/bridge/*` paths; 19 `escapeHtml()` call sites |
| Shell/exec/spawn | Zero paths in console, contract, or implementation |
| Pairing token | In-memory only (`store.token`), never persisted |
| Authentication | Origin + pairing token, shared with all `/bridge/*` endpoints |
| Archive guards | Default project `cli-bridge` not archivable (409 + UI guard); archived projects block mutation creates |
| Audit filtering | projectId authoritative; no cross-project sessionId leakage |

## Implemented Endpoint Matrix

| Method | Path | Status | Auth |
|--------|------|--------|------|
| GET | `/bridge/projects` | ✅ | token |
| GET | `/bridge/projects?includeArchived=true` | ✅ | token |
| GET | `/bridge/projects/:key` | ✅ | token |
| PATCH | `/bridge/projects/:key` | ✅ (label/desc only) | token |
| POST | `/bridge/projects/:key/archive` | ✅ (non-default only) | token |
| POST | `/bridge/projects/:key/unarchive` | ✅ | token |

## Test Evidence

| Suite | Tests |
|-------|-------|
| `tests/bridge-projects-api.test.mjs` | 31 endpoint contract tests |
| `tests/project-console-ui.test.mjs` | 15 static HTML/safety tests |
| `tests/project-console-behavior.test.mjs` | 9 jsdom UI interaction tests |
| `tests/json-persistence.test.mjs` | 8 snapshot round-trip tests |
| All other suites | 320 tests (unchanged from pre-v2.0) |
| **Total** | **383/383 pass** |

Targeted verification:
```
npm run typecheck   → pass
npm run lint        → pass
npm test            → 383/383 pass
git diff --check    → pass
```

## Known Non-Goals

- `DELETE /bridge/projects/:key` — explicitly unauthorized; only archive supported
- Status panel `version`, `milestone`, `tests`, `commits`, `memory` — marked "not yet available"
- `audit.projectId` call-site propagation is complete for all project-scoped records;
  non-scoped call sites (bridge-loop, outbound, handoffs) intentionally excluded

## Residual Risks

| Risk | Mitigation |
|------|------------|
| Legacy audit events without projectId depend on packetId fallback | Fallback preserved and tested; all new events carry projectId |
| Console inline edit uses `innerHTML` for input replacement | EscapeHtml on all injected values; only the label edit input accepts user text |
| jsdom `dispatchEvent('change')` on checkboxes not firing in test harness | Worked around via `window.refreshAll()` in behavior tests; real browsers unaffected |

## Review Checkpoints

- [ ] No `shell|exec|spawn|daemon|provider|auto-run` in console or new endpoints
- [ ] All audit filtering follows authoritative `projectId` → packetId fallback
- [ ] Default project never shows archive button (UI) or accepts archive (API)
- [ ] PATCH only sends `{ label, description }`; `key`, `createdAt`, `archivedAt` rejected
- [ ] Legacy snapshot data (without projectId on audit events) hydrates correctly
- [ ] No hard-delete, AgentTeam, status real sources, or execution endpoints added
