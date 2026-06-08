# CLI Bridge v1.3 Planning Handoff

## 1. Verdict

Status: PLANNING (requirements-first) + IMPLEMENTATION for a single restricted
slice — Minimal JSON File Persistence.

All bridge state (packets, audit events, pending prompts, derived metrics) is
currently in-memory. A local-server restart loses the entire audit trail and
metrics history, which weakens the "safe, traceable relay" value. v1.3 adds a
minimal opt-in JSON file persistence layer with strict content boundaries.

## 2. Requirements

R1. The local server MAY persist bridge state to a JSON file so that an audit
trail and metrics survive a restart.

R2. Persistence MUST be opt-in. By default (and in tests) the server stays
in-memory; persistence activates only when a runtime directory is configured
(`CLI_BRIDGE_DATA_DIR` env var or explicit config).

R3. Persistence MUST write only redacted, persistable fields:
- packets: the full `BridgePacket` (which already contains `processedContent`
  only — `rawContent` is never part of the packet).
- audit events.
- pending prompts (which carry `processedContent`-derived prompt text only).

R4. Raw content MUST NEVER be written to disk. `InMemoryPacketStore.rawContents`
stays memory-only and is excluded from any snapshot.

R5. On startup, if a snapshot file exists, the server MUST hydrate packets,
audit events, and pending prompts from it, and every hydrated record MUST pass
the existing schema validators; invalid records are skipped, not trusted.

R6. Persistence MUST be best-effort and MUST NOT crash the server: a write or
read failure is logged-by-return and the server continues in-memory.

R7. The runtime data directory MUST be git-ignored and MUST NOT be written
inside tracked source, `dist/`, or upstream/canonical paths. The path is
resolved from the configured directory only; no path traversal from request
input is possible (requests never supply file paths).

R8. No new HTTP surface, no shell endpoint, no auto-send, no agent control.

## 3. Scope (this slice)

Allowed:

- new `apps/local-server/src/storage/json-snapshot-store.ts`: read/write a single
  JSON snapshot `{ version, packets, auditEvents, pendingPrompts }`.
- snapshot hydration/serialization helpers on the existing in-memory stores
  (export/import methods that never touch rawContent).
- wiring in `bridge-api.ts` `createBridgeRuntime` to accept an optional data dir,
  hydrate on construction, and persist after mutations.
- `.gitignore` entry for the runtime data directory.
- tests for: round-trip persistence, rawContent never serialized, invalid record
  skipping, missing-file startup, and write-failure resilience.

## 4. Hard Non-Goals

- no database, no external storage dependency.
- no rawContent persistence (even under debug-ttl in this slice).
- no persistence of pairing tokens or secrets.
- no new endpoint, shell surface, auto-send, or agent loop.
- no concurrent multi-process locking (single local process assumed).

## 5. Safety Rules

- snapshot serialization is allow-list based: it copies only the typed store
  records, never the rawContent map.
- hydration validates every record with `assertBridgePacket` /
  `assertAuditEvent` and skips invalid ones.
- the data directory is created under the configured root only; the snapshot
  filename is a fixed constant, never derived from request input.

## 6. Acceptance Gates

- in-memory default unchanged; tests pass without a data dir.
- with a temp data dir: create -> restart (new runtime from same dir) ->
  packets / audit / pending prompts / metrics are restored.
- a serialized snapshot file never contains rawContent.
- invalid snapshot records are skipped without throwing.
- full local gate passes: build, lint, typecheck, test.

## 7. Implementation Status

Completed Minimal JSON File Persistence:

- added `apps/local-server/src/storage/json-snapshot-store.ts`: best-effort
  read/write of a single `bridge-snapshot.json` (`{ version, packets,
  auditEvents, pendingPrompts }`); never throws on disk failure.
- added export/hydrate methods to the in-memory stores: `exportPackets` /
  `hydratePackets`, `exportEvents` / `hydrateEvents`, `exportPrompts` /
  `hydratePrompts`. Hydration validates each record with the existing schema
  validators (and a pending-prompt shape guard) and skips invalid ones.
- `createBridgeRuntime` now accepts `{ dataDir }` (or `CLI_BRIDGE_DATA_DIR`),
  hydrates on construction, and exposes `persist()`; `bridge-api` calls
  `persist()` after each mutation.
- raw content is never exported: `InMemoryPacketStore.rawContents` has no export
  path and is excluded from the snapshot.
- `.gitignore` excludes `.cli-bridge-data/` and `*.cli-bridge-runtime/`.
- tests (`tests/json-persistence.test.mjs`): cross-restart round-trip, raw secret
  never serialized, in-memory default writes nothing, invalid records skipped.

Not added (still deferred): see §8.

Local gate: build, lint, typecheck, test all pass on Windows (127/127).

## 8. Deferred List

- debug-ttl rawContent persistence with expiry.
- snapshot compaction / rotation.
- multi-process safety / file locking.
- a persisted metrics time-series (only current summary is derivable today).
