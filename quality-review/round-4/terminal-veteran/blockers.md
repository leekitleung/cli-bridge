# Terminal Veteran Blockers - Round 4

## P0 Blockers: None

## P1 Blockers

### P1-1: No Structured Logging

**Files:** Throughout codebase

**Issue:** Console.log statements lack levels (info/warn/error) and tags.

**Impact:** Hard to filter/aggregate logs in production.

---

### P1-2: No Circuit Breaker for Executors

**Files:** `executor-registry.ts`, `execution-dispatcher-v2.ts`

**Issue:** Failed executors continue receiving requests until explicitly unregistered.

**Impact:** Cascade failures possible.

---

## P2 Blockers

### P2-1: No Correlation IDs for Requests

**Files:** `server.ts`, `bridge-api.ts`

**Issue:** Requests lack tracking IDs for debugging across services.

**Impact:** Hard to trace request flows.

---

## Summary

| ID | Severity | Description |
|----|----------|-------------|
| P1-1 | High | No structured logging |
| P1-2 | High | No circuit breaker |
| P2-1 | Medium | No correlation IDs |
