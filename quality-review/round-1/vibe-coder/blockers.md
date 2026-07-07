# CLI Bridge Quality Review - Blockers

**Reviewer**: Vibe Coder (Developer Experience Focus)
**Date**: 2026-07-07
**Project**: CLI Bridge

---

## P0 - Production Blockers (Must Fix Before Deploy)

### P0-1: No Input Validation on API Requests

**Severity**: Critical
**Files**: `server.ts`, `bridge-api.ts`

All JSON body parsing lacks schema validation. Attackers can send malformed data.

```typescript
// server.ts line 414 - NO VALIDATION
const body = JSON.parse(Buffer.concat(chunks).toString());
const result = autoPairStore.claimExtensionSession(body.nonce ?? '');
```

**Impact**: Type confusion attacks, undefined behavior, potential crashes
**Fix**: Use `assertXxx()` schema validators from `packages/shared/src/schemas.ts`

---

### P0-2: Silent Failure in Hydration Loops

**Severity**: Critical
**Files**: `bridge-api.ts` (lines 1667-1734)

All hydration uses `catch { /* skip bad record */ }` - no logging, no metrics.

```typescript
// bridge-api.ts line 1668-1669
for (const project of read.snapshot.projects ?? []) {
  projectStore.hydrateProject(project);
}
```

**Impact**: Silent data corruption, impossible to debug production issues
**Fix**: Log skipped records with reason, emit metrics, add health checks

---

### P0-3: BridgeRuntime Interface Has 50+ Properties

**Severity**: Critical
**Files**: `bridge-api.ts` (lines 153-233)

The `BridgeRuntime` interface is a god object with 50+ properties.

```typescript
export interface BridgeRuntime {
  // ... 50+ properties including:
  packetStore: InMemoryPacketStore;
  auditLog: InMemoryAuditLog;
  // ... 48 more
}
```

**Impact**: Impossible to test, hard to maintain, violates SRP
**Fix**: Split into smaller contexts (StorageContext, ExecutionContext, etc.)

---

### P0-4: No Request Body Size Limits

**Severity**: Critical
**Files**: `server.ts`

```typescript
// server.ts line 410-411 - unbounded buffer accumulation
const chunks: Buffer[] = [];
request.on('data', (chunk: Buffer) => chunks.push(chunk));
```

**Impact**: Memory exhaustion DoS attacks
**Fix**: Implement max body size check before accumulation

---

### P0-5: No Rate Limiting State Cleanup on Server Restart

**Severity**: Critical
**Files**: `rate-limiter.ts`

Rate limit state is in-memory only - resets on restart (acceptable) but no persistent blocklist.

**Impact**: Brute force attacks reset on restart
**Fix**: Consider persistent blocklist for repeated offenders

---

## P1 - High Priority Issues (Should Fix)

### P1-1: bridge-api.ts is 5474 Lines

**Severity**: High
**Files**: `bridge-api.ts`

Single file contains routing, handlers, validation, hydration, runtime creation.

**Impact**: Cognitive overload, merge conflicts, hard to test
**Fix**: Split into route modules, handler modules, separate files per domain

---

### P1-2: Missing Error Type Hierarchy

**Severity**: High
**Files**: All route handlers

No custom error classes - errors are just strings.

```typescript
// server.ts line 327
writeJson(504, { status: 'error', code: 'REQUEST_TIMEOUT', message: 'Request timeout' }, response);
```

**Impact**: Can't programmatically distinguish error types, no error codes enum
**Fix**: Create `BridgeError` class with codes enum

---

### P1-3: Test Coverage Below 40%

**Severity**: High
**Files**: `tests/` directory

Only 4 test files, no coverage for:
- Storage stores
- Extension code
- API handlers
- Error paths

**Impact**: regressions undetected, refactoring risk
**Fix**: Add unit tests for all storage stores and handlers

---

### P1-4: No Health Checks for Dependencies

**Severity**: High
**Files**: `server.ts`, `health.ts`

Server exposes `/health` but doesn't check if stores are functional.

**Impact**: Load balancer routes traffic to unhealthy instances
**Fix**: Add store health checks to health endpoint

---

### P1-5: Command Backend Allowlist Has Windows cmd.exe Bypass

**Severity**: High
**Files**: `command-backend.ts` (line 38)

```typescript
// command-backend.ts line 38
if (process.platform === 'win32' && command.toLowerCase() === 'cmd.exe') {
  return true;
}
```

**Impact**: cmd.exe can execute ANY command on Windows
**Fix**: Remove cmd.exe bypass or make it configurable with warnings

---

## P2 - Medium Priority Issues

### P2-1: No Request/Response Type Definitions

**Severity**: Medium
**Files**: All route handlers

API contracts are implicit, not documented as types.

**Impact**: API drift, frontend integration issues
**Fix**: Add Zod/Joi schemas and generate types

---

### P2-2: No Structured Logging

**Severity**: Medium
**Files**: All files

Uses `console.log/error` instead of structured logger.

**Impact**: Hard to aggregate logs, no log levels
**Fix**: Use pino or winston with structured output

---

### P2-3: No API Versioning

**Severity**: Medium
**Files**: All routes

All endpoints are `/bridge/v1/...` implicitly - no version prefix.

**Impact**: Breaking changes require new endpoint paths
**Fix**: Add `/bridge/v1/` prefix to all endpoints

---

### P2-4: No Request ID Tracing

**Severity**: Medium
**Files**: `server.ts`

No correlation IDs for request tracing.

**Impact**: Impossible to trace requests across async operations
**Fix**: Add `X-Request-ID` header generation and propagation

---

### P2-5: executor-registry.ts Uses Global Singleton

**Severity**: Medium
**Files**: `executor-registry.ts` (lines 332-344)

```typescript
let globalRegistry: ExecutorRegistry | undefined;
export function getExecutorRegistry(): ExecutorRegistry {
  if (!globalRegistry) {
    globalRegistry = new ExecutorRegistry();
  }
  return globalRegistry;
}
```

**Impact**: Hard to test, global state, potential memory leaks
**Fix**: Use dependency injection

---

## Summary

| Priority | Count | Examples |
|----------|-------|----------|
| P0 | 5 | Input validation, silent failures, god object, no body limits |
| P1 | 5 | File size, error types, test coverage, health checks, cmd bypass |
| P2 | 5 | Type definitions, logging, versioning, tracing, singletons |

**Recommendation**: Address all P0 issues before any production deployment. P1 issues should be scheduled for next sprint.
