# Terminal Veteran Quality Review - Blockers

## P0 Issues (Production-Blocking)

These issues would cause immediate operational failures in production.

---

### P0-1: Snapshot Persistence Failure Crashes Runtime

**Location:** `apps/local-server/src/routes/bridge-api.ts` lines 1738-1779

**Problem:**
```typescript
let persistenceFailure: string | undefined;
const persist = (): void => {
  if (!snapshotStore) return;
  if (persistenceFailure) {
    throw new Error(persistenceFailure);  // CRASHES HERE
  }
  const result = snapshotStore.write(...);
  if (!result.ok) {
    persistenceFailure = `Snapshot write failed: ${result.error ?? 'unknown error'}`;
    throw new Error(persistenceFailure);  // OR HERE
  }
};
```

**Impact:** Any snapshot write failure (disk full, permissions, I/O error) throws an exception. Since `persist()` is called after EVERY state mutation via HTTP handlers, a single write failure kills the entire server process, losing in-flight requests.

**Evidence:**
- `persist()` is called in ~50+ handler code paths
- No try-catch around `persist()` calls
- Only check is at line 2599: `if (runtime.getPersistenceFailure())` — but this only prevents NEW operations, not the crash

**Fix Required:** Wrap snapshot writes in try-catch, return error result, degrade to in-memory-only mode instead of throwing.

---

### P0-2: No Server-Level Error Event Handler

**Location:** `apps/local-server/src/server.ts` lines 467-475

**Problem:**
```typescript
const server = createServer(requestHandler);

await new Promise<void>((resolve, reject) => {
  server.once('error', reject);  // Only listens once, then unbinds
  server.listen(port, LOCAL_SERVER_HOST, () => {
    server.off('error', reject);
    resolve();
  });
});
```

**Impact:** After the server binds successfully, if the TCP socket encounters an error (port exhaustion, EMFILE, network interface down), the error is unhandled and the process crashes with no logging.

**Fix Required:**
```typescript
server.on('error', (err) => {
  console.error('[Server] Fatal server error:', err);
  process.exit(1);
});
```

---

### P0-3: Detached Goal Loop Runner With No Supervision

**Location:** `apps/local-server/src/goal/goal-automation-loop.ts` lines 485-512

**Problem:**
```typescript
export function startGoalLoopRunner(
  runtime: BridgeRuntime,
  loopId: string,
  tickIntervalMs: number = 5000,
): () => void {
  let stopped = false;
  const run = async () => {
    while (!stopped) {
      // ...
      await new Promise(resolve => setTimeout(resolve, tickIntervalMs));
    }
  };
  run().catch(console.error);  // SILENT FAILURE
  return () => { stopped = true; };
}
```

**Impact:**
- `run().catch(console.error)` silently swallows all errors — no alerting
- No mechanism to detect if the runner died
- No restart on failure
- No lifecycle management (what happens if server restarts?)

**Fix Required:** Integrate with a supervisor, add health monitoring, implement restart logic.

---

### P0-4: Rate Limiter Trusts X-Forwarded-For From Any Source

**Location:** `apps/local-server/src/security/rate-limiter.ts` lines 41-66

**Problem:**
```typescript
getClientIp(directIp: string, xForwardedFor?: string | null): string {
  if (xForwardedFor) {
    // If directIp is loopback/private, trust XFF
    if (directIp === '127.0.0.1' || directIp === '::1' || 
        directIp.startsWith('192.168.') || directIp.startsWith('10.')) {
      return firstIp;  // TRUSTED WITHOUT VALIDATION
    }
    // Only check if directIp not in XFF
    if (!ips.includes(directIp)) {
      console.warn(`[RateLimiter] X-Forwarded-For mismatch: direct=${directIp}, xff=${firstIp}`);
      return directIp;
    }
  }
  return directIp;
}
```

**Impact:**
- Any localhost/private network request can inject arbitrary X-Forwarded-For values
- Attacker with local access can bypass rate limits by setting X-Forwarded-For
- `console.warn` is insufficient for security events

**Fix Required:** Only trust X-Forwarded-For from known proxy IPs (configured list), or always use direct IP for rate limiting.

---

## P1 Issues (High Priority - Operational Impact)

These issues don't immediately crash the system but will cause significant operational problems.

---

### P1-1: No Circuit Breaker on External Dependencies

**Location:** Throughout, but specifically `apps/local-server/src/verification/github-checks-provider.ts`

**Problem:** Every GitHub API call retries once on failure, but there's no circuit breaker. If GitHub is down, all verification requests will slowly drain resources with retries.

**Impact:**
- Cascade failure when external service is degraded
- No way to temporarily disable a failing dependency
- Metrics will show increasing latency/error rates with no mitigation

**Fix Required:** Implement circuit breaker pattern with half-open state for GitHub checks and any other external calls.

---

### P1-2: No Request Correlation IDs

**Location:** `apps/local-server/src/server.ts`, `apps/local-server/src/routes/bridge-api.ts`

**Problem:** Every HTTP request is processed without a correlation ID. When a request flows through multiple handlers, there's no way to trace it in logs.

**Impact:**
- Debugging production issues requires asking users for request timestamps
- Cannot correlate extension logs with server logs
- Impossible to track request lifecycle end-to-end

**Fix Required:**
```typescript
// Generate at entry point
const correlationId = request.headers['x-correlation-id'] 
  ?? request.headers['x-request-id'] 
  ?? randomUUID();
response.setHeader('x-correlation-id', correlationId);
// Include in all logs
```

---

### P1-3: Health Endpoint Doesn't Check Dependencies

**Location:** `apps/local-server/src/routes/health.ts`

**Problem:**
```typescript
export function createHealthPayload(
  host: string,
  port: number,
  pairingToken?: string,
): HealthPayload {
  return {
    status: 'ok',  // ALWAYS 'ok'
    serviceName: SERVICE_NAME,
    serviceVersion: SERVICE_VERSION,
    host,
    port,
  };
}
```

**Impact:**
- Load balancers/health checks get no useful information
- Cannot detect: disk full, memory pressure, snapshot corruption, dependency failures
- Health check passes even when the system is unhealthy

**Fix Required:**
```typescript
export function createHealthPayload(...) {
  const checks = {
    snapshotWritable: testSnapshotWrite(),
    diskSpace: checkDiskSpace(),
    memoryUsage: checkMemoryUsage(),
  };
  const healthy = Object.values(checks).every(Boolean);
  return {
    status: healthy ? 'ok' : 'degraded',
    checks,
    // ...
  };
}
```

---

### P1-4: ChatGPT Web Queue Has No Dead-Letter Handling

**Location:** `apps/local-local-server/src/conversation/chatgpt-web-source-adapter.ts`

**Problem:**
- `cleanup()` method only removes old requests by age
- Failed requests (`status === 'failed'`) accumulate forever
- No visibility into failure patterns
- No retry mechanism

**Impact:**
- Memory leak from accumulated failed requests
- Cannot investigate why requests fail
- No automatic retry with backoff

**Fix Required:**
- Add failed request archive
- Implement retry with exponential backoff
- Add alerting on failure rate thresholds

---

### P1-5: All Stores Are In-Memory With No Persistence Guarantees

**Location:** All `InMemory*Store` classes throughout

**Problem:** While snapshots provide persistence, all runtime state is in-memory. There's no Write-Ahead Log (WAL) or transaction log to ensure durability between snapshots.

**Impact:**
- Any crash between snapshots loses state
- Long-running operations have no checkpoint
- Cannot audit state changes between snapshots

**Fix Required:** Implement WAL or increase snapshot frequency for critical operations.

---

## P2 Issues (Medium Priority - Operational Nuisance)

---

### P2-1: Raw Console Logging Throughout

**Locations:** Throughout, e.g.:
- `server.ts` line 389: `console.error('[Server] Bridge request error:', err);`
- `local-auto-pair-session.ts` line 81: `console.log(\`[LocalAutoPair] Cleaned up...\`)`

**Problem:** No structured logging, no log levels, no JSON format for machine parsing.

**Fix Required:** Implement structured logger (pino, winston) with configurable levels and JSON output.

---

### P2-2: No Metrics Export

**Problem:** Metrics exist internally (`createMetricsSummary()`, `getMetrics()`) but are only available via HTTP endpoints, not in Prometheus/OpenTelemetry format.

**Impact:** Cannot integrate with standard monitoring stacks.

**Fix Required:** Add `/metrics` endpoint in Prometheus format.

---

### P2-3: Error Responses Don't Include Error Codes

**Location:** Throughout `bridge-api.ts`

**Problem:**
```typescript
function error(statusCode: number, message: string): BridgeResult {
  return { statusCode, payload: { status: 'error', message } };
}
```

**Impact:**
- No machine-readable error codes for clients
- Clients must parse human messages to determine error type
- Makes error handling in clients fragile

**Fix Required:**
```typescript
return { statusCode, payload: { 
  status: 'error', 
  code: 'PROPOSAL_NOT_FOUND',  // Add error codes
  message 
}};
```

---

### P2-4: Missing Request Timeouts on Sub-Operations

**Problem:** While HTTP requests have timeouts, individual sub-operations don't:
- GitHub API calls have 10s timeout but no total deadline
- CLI command timeouts are configurable but have no circuit breaker
- Database/snapshot operations have no timeout

**Fix Required:** Add timeout tracking for all sub-operations, implement cancellation propagation.

---

### P2-5: No Graceful Shutdown Handler

**Location:** `apps/local-server/src/server.ts`

**Problem:** `server.ts` has no signal handlers for SIGTERM/SIGINT. Server doesn't flush pending requests or close connections gracefully on shutdown.

**Fix Required:**
```typescript
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);
```

---

## Summary

| Priority | Count | Primary Impact |
|----------|-------|---------------|
| P0 | 4 | Runtime crashes, security bypass |
| P1 | 5 | Cascade failures, debugging difficulty |
| P2 | 5 | Operational friction, monitoring gaps |

**Recommendation:** Address all P0 issues before production deployment. P1 issues should be tracked and addressed in the first post-deployment sprint. P2 issues can be addressed based on operational needs.
