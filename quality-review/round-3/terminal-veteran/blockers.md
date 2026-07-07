# Blocking Issues - Terminal Veteran Review

## P0 - Critical (Must Fix Before Production)

### P0-1: Busy-Wait Polling in WorkBuddyExecutor

**File:** `apps/local-server/src/execution/workbuddy-executor.ts` (lines 139-157)

**Issue:**
```typescript
while (Date.now() < timeoutAt) {
  const result = this.adapter.getResult(workbuddyTask.taskId);
  if (result) { return result; }
  await new Promise(resolve => setTimeout(resolve, 1000)); // Busy wait!
}
```

**Impact:**
- Wastes CPU cycles (1000ms of blocked wait per poll)
- Under high load, creates unnecessary garbage from timer creation
- Doesn't respond to executor being shut down mid-polling

**Fix Required:**
Replace with event-based signaling or at minimum use a longer poll interval (e.g., 5 seconds) and add process shutdown awareness.

---

### P0-2: Health Check Timer Keeps Process Alive

**File:** `apps/local-server/src/execution/executor-registry.ts` (lines 305-318)

**Issue:**
```typescript
this.healthCheckTimer = setInterval(async () => {
  // ...
}, this.healthCheckIntervalMs);
```

**Impact:**
- `setInterval` without `unref()` keeps Node.js event loop alive
- Process may not exit cleanly when all work is done
- Conflicts with `local-auto-pair-session.ts` cleanup which correctly uses `unref()`

**Fix Required:**
Add `this.healthCheckTimer.unref()` after `setInterval` or store timer reference and call `unref()` on it.

---

## P1 - High Priority

### P1-1: Bridge Timeout Missing `request.destroy()`

**File:** `apps/local-server/src/server.ts` (lines 381-386)

**Issue:**
```typescript
const bridgeTimeout = setTimeout(() => {
  if (!response.headersSent) {
    writeJson(504, { ... });
  }
  // Missing: request.destroy();
}, BRIDGE_REQUEST_TIMEOUT_MS);
```

**Contrast with request timeout (lines 336-341):**
```typescript
const requestTimeout = setTimeout(() => {
  if (!response.headersSent) { writeJson(504, {...}); }
  request.destroy(); // <-- Present here but missing in bridgeTimeout
}, REQUEST_TIMEOUT_MS);
```

**Impact:**
- If `handleBridgeRequest` hangs, timeout fires but request socket stays open
- Connection leak under slow/malicious clients
- Resource exhaustion under sustained load

**Fix Required:**
Add `request.destroy()` after or alongside `writeJson` in bridgeTimeout handler.

---

### P1-2: Silent Error Swallowing in Background Loops

**File:** `apps/local-server/src/goal/goal-automation-loop.ts` (lines 492-506)

**Issue:**
```typescript
export function startGoalLoopRunner(...) {
  let stopped = false;
  const run = async () => {
    while (!stopped) {
      // ...
      await new Promise(resolve => setTimeout(resolve, tickIntervalMs));
    }
  };
  run().catch(console.error); // Silent swallow!
  return () => { stopped = true; };
}
```

**Impact:**
- Unhandled exceptions in background loop silently disappear
- No alerting/metrics for loop failures
- `console.error` output not structured, hard to filter

**Fix Required:**
Add proper error handling: either emit to a callback, write to a dedicated error log, or propagate via event emitter.

---

### P1-3: Inconsistent Shell Usage in OpenCodeExecutor

**File:** `apps/local-server/src/execution/opencode-executor.ts`

**Issue:**
```typescript
// Line 95: execute() correctly uses shell: false
const proc = spawn(this.options.openCodePath, args, {
  shell: false,  // SECURITY FIX: Correct
});

// Line 156: healthCheck() uses shell: true
const proc = spawn(this.options.openCodePath, ['--version'], {
  shell: true,   // Inconsistent, potential risk
});
```

**Impact:**
- Inconsistent security posture
- Health check could be vector for command injection if path is configurable
- Creates confusion about security boundaries

**Fix Required:**
Use `shell: false` consistently. If `--version` flag doesn't work without shell, that's a symptom of missing PATH resolution.

---

### P1-4: No Request Body Size Limit

**File:** `apps/local-server/src/server.ts` (lines 421-425)

**Issue:**
```typescript
const chunks: Buffer[] = [];
request.on('data', (chunk: Buffer) => chunks.push(chunk)); // No size check!
request.on('end', () => {
  const body = JSON.parse(Buffer.concat(chunks).toString());
```

**Impact:**
- Malicious client can send unlimited body size
- Memory exhaustion attack on large JSON payloads
- No protection against zip bombs or decompression bombs

**Fix Required:**
Add size check:
```typescript
const MAX_BODY_SIZE = 1024 * 1024; // 1MB
let totalSize = 0;
request.on('data', (chunk: Buffer) => {
  totalSize += chunk.length;
  if (totalSize > MAX_BODY_SIZE) {
    request.destroy();
    return;
  }
  chunks.push(chunk);
});
```

---

## P2 - Medium Priority

### P2-1: Missing Correlation IDs for Request Tracing

**Files:** Throughout `server.ts`

**Impact:** Difficult to correlate logs across async operations.

**Recommendation:** Add `X-Request-ID` header generation and propagation.

---

### P2-2: No Circuit Breaker for Executor Failures

**File:** `apps/local-server/src/execution/executor-registry.ts`

**Impact:** Continuous failed requests to unhealthy executor wastes resources.

**Recommendation:** Implement circuit breaker: after N consecutive failures, mark executor unhealthy for cooldown period.

---

### P2-3: Missing Graceful Shutdown Handler

**File:** `apps/local-server/src/server.ts`

**Impact:** In-flight requests dropped on SIGTERM.

**Recommendation:** Add `server.close()` with timeout and cleanup handlers.

---

### P2-4: Session Token Entropy

**File:** `apps/local-server/src/security/local-auto-pair-session.ts` (line 37)

**Issue:** `randomBytes(32)` is good but tokens aren't rotated on re-authentication.

**Recommendation:** Consider shorter TTL and token rotation.

---

### P2-5: No Retry with Exponential Backoff

**Files:** Throughout executor and bridge code

**Impact:** Transient failures (network blips, brief unavailability) cause permanent failures.

**Recommendation:** Add retry logic with exponential backoff for network operations.

---

### P2-6: Memory Leak in Rate Limiter Diagnostics

**File:** `apps/local-server/src/security/rate-limiter.ts`

**Impact:** `entries` Map grows indefinitely if IPs don't repeat (cleanups happen but Map grows during accumulation phase).

**Recommendation:** Add hard limit on Map size with LRU eviction.
