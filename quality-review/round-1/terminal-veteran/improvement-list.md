# Terminal Veteran Quality Review - Prioritized Improvements

## Priority 1: Critical Production Fixes (Week 1)

These must be addressed before any production deployment.

### 1.1 Snapshot Persistence Crash Prevention
**File:** `apps/local-server/src/routes/bridge-api.ts`
**Effort:** Medium (2-3 days)
**Risk:** Low

**Current State:**
```typescript
const persist = (): void => {
  if (persistenceFailure) {
    throw new Error(persistenceFailure);  // KILLS SERVER
  }
  // ...
  if (!result.ok) {
    throw new Error(...);  // KILLS SERVER
  }
};
```

**Implementation:**
```typescript
const persist = (): boolean => {
  if (!snapshotStore) return true;
  if (persistenceFailure) return false;
  const result = snapshotStore.write(...);
  if (!result.ok) {
    console.error('[Persistence] Write failed:', result.error);
    runtime.degradeToInMemoryMode();
    return false;
  }
  return true;
};
```

**Verification:** Restart server while disk is full; server should enter degraded mode and log warning, not crash.

---

### 1.2 Server Error Event Handler
**File:** `apps/local-server/src/server.ts`
**Effort:** Low (2 hours)
**Risk:** None

**Implementation:**
```typescript
server.on('error', (err) => {
  console.error('[Server] Unhandled server error:', {
    code: err.code,
    message: err.message,
    syscall: err.syscall,
    timestamp: new Date().toISOString(),
  });
  // Log before exit for operational visibility
  process.exit(1);
});
```

---

### 1.3 Goal Loop Runner Supervision
**File:** `apps/local-server/src/goal/goal-automation-loop.ts`
**Effort:** Medium (2-3 days)
**Risk:** Medium

**Implementation Options:**
1. Integrate with `startGoalLoopRunner` into a supervised pool
2. Add health check that verifies runner is still active
3. Implement restart-on-failure with exponential backoff
4. Add metrics: runner status, ticks processed, errors

```typescript
interface GoalLoopRunnerMetrics {
  loopId: string;
  status: 'running' | 'stopped' | 'failed';
  ticksProcessed: number;
  errors: number;
  lastTickAt: number | null;
  lastError: string | null;
}
```

---

### 1.4 Rate Limiter IP Trust Fix
**File:** `apps/local-server/src/security/rate-limiter.ts`
**Effort:** Low (1 day)
**Risk:** Low

**Implementation:**
```typescript
// Only trust X-Forwarded-For from known proxy IPs
const TRUSTED_PROXIES = new Set([
  '127.0.0.1',
  '::1',
  // Add configured proxies only
  ...(process.env.TRUSTED_PROXY_IPS?.split(',') ?? [])
]);

getClientIp(directIp: string, xForwardedFor?: string | null): string {
  if (xForwardedFor && TRUSTED_PROXIES.has(directIp)) {
    return xForwardedFor.split(',')[0].trim();
  }
  return directIp;
}
```

---

## Priority 2: Operational Foundation (Week 2-3)

### 2.1 Structured Error Codes
**Files:** Throughout API handlers
**Effort:** Medium (3-4 days)
**Risk:** Low

**Implementation:**
```typescript
export enum ErrorCode {
  PROPOSAL_NOT_FOUND = 'PROPOSAL_NOT_FOUND',
  ENDPOINT_OFFLINE = 'ENDPOINT_OFFLINE',
  VALIDATION_FAILED = 'VALIDATION_FAILED',
  // ... exhaustive list
}

interface ErrorResult {
  status: 'error';
  code: ErrorCode;
  message: string;
  details?: unknown;
  retryable: boolean;
}
```

---

### 2.2 Correlation IDs
**Files:** `server.ts`, `bridge-api.ts`
**Effort:** Medium (2-3 days)
**Risk:** Low

**Implementation:**
```typescript
// In request handler
const correlationId = request.headers['x-correlation-id'] 
  ?? randomUUID();
  
// Attach to response
response.setHeader('x-correlation-id', correlationId);

// Use in all logs
console.log(JSON.stringify({
  level: 'info',
  correlationId,
  path: url.pathname,
  method: request.method,
  // ...
}));
```

---

### 2.3 Enhanced Health Endpoint
**Files:** `health.ts`
**Effort:** Low (1 day)
**Risk:** None

**Implementation:**
```typescript
interface HealthPayload {
  status: 'ok' | 'degraded' | 'unhealthy';
  serviceName: string;
  serviceVersion: string;
  uptime: number;
  checks: {
    snapshot: HealthCheck;
    diskSpace: HealthCheck;
    memory: HealthCheck;
    dependencies: DependencyHealth[];
  };
}

interface HealthCheck {
  status: 'ok' | 'warning' | 'critical';
  message?: string;
  value?: unknown;
}
```

---

### 2.4 Structured Logging
**Files:** Throughout
**Effort:** High (1-2 weeks)
**Risk:** Medium

**Implementation:**
```typescript
// Use pino or winston
import pino from 'pino';

const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  formatters: {
    level: (label) => ({ severity: label }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

// Replace all console.* calls
logger.info({ correlationId }, 'Server started');
logger.error({ err }, 'Request failed');
```

---

### 2.5 Graceful Shutdown
**Files:** `server.ts`
**Effort:** Low (1 day)
**Risk:** Medium

**Implementation:**
```typescript
async function gracefulShutdown(signal: string) {
  console.log(`[Server] Received ${signal}, shutting down gracefully...`);
  
  // Stop accepting new connections
  server.close();
  
  // Wait for in-flight requests (with timeout)
  await Promise.race([
    waitForActiveRequests(),
    new Promise(r => setTimeout(r, 30_000)),
  ]);
  
  // Final persistence
  runtime.persist();
  
  process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
```

---

## Priority 3: Resilience Patterns (Week 3-4)

### 3.1 Circuit Breaker
**Files:** New file `utils/circuit-breaker.ts`
**Effort:** Medium (2-3 days)
**Risk:** Low

**Implementation:**
```typescript
export class CircuitBreaker {
  constructor(
    private readonly name: string,
    private readonly options: CircuitBreakerOptions
  ) {}

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    switch (this.state) {
      case 'open':
        if (this.shouldAttemptReset()) {
          this.state = 'half-open';
          return this.execute(fn);
        }
        throw new CircuitOpenError(this.name);
      case 'half-open':
        try {
          const result = await fn();
          this.recordSuccess();
          return result;
        } catch {
          this.recordFailure();
          throw;
        }
    }
  }
  
  private recordSuccess(): void { /* ... */ }
  private recordFailure(): void { /* ... */ }
}
```

**Usage:**
```typescript
const githubBreaker = new CircuitBreaker('github-checks', {
  failureThreshold: 5,
  resetTimeout: 60_000,
});

const result = await githubBreaker.execute(() => fetchGithubChecks(...));
```

---

### 3.2 Prometheus Metrics Export
**Files:** New route or middleware
**Effort:** Low (1-2 days)
**Risk:** None

**Implementation:**
```typescript
app.get('/metrics', (req, res) => {
  res.set('Content-Type', 'text/plain');
  res.send(prometheusRegister.metrics());
});
```

**Metrics to expose:**
- `cli_bridge_http_requests_total{method, path, status}`
- `cli_bridge_http_request_duration_seconds{method, path}`
- `cli_bridge_command_executions_total{command, result}`
- `cli_bridge_command_duration_seconds{command}`
- `cli_bridge_queue_depth{name}`
- `cli_bridge_snapshot_write_duration_seconds`
- `cli_bridge_snapshot_write_errors_total`

---

### 3.3 Dead Letter Queue for ChatGPT Web Source
**Files:** `chatgpt-web-source-adapter.ts`
**Effort:** Medium (2 days)
**Risk:** Low

**Implementation:**
```typescript
interface DeadLetterEntry {
  originalRequest: ChatGptSourceRequest;
  failureReason: string;
  attemptCount: number;
  lastAttemptAt: number;
  originalResult?: ChatGptSourceResult;
}

export class ChatGptWebSourceQueue {
  private readonly deadLetter: DeadLetterEntry[] = [];
  private readonly MAX_DLQ_SIZE = 1000;
  
  fail(requestId: string): ChatGptSourceRequest | undefined {
    // ... existing logic
    if (attemptCount >= 3) {
      this.moveToDeadLetter(req, 'Max retries exceeded');
    }
  }
  
  private moveToDeadLetter(req: ChatGptSourceRequest, reason: string) {
    this.deadLetter.push({
      originalRequest: req,
      failureReason: reason,
      attemptCount: req.claimedAt ? 1 : 0,
      lastAttemptAt: Date.now(),
    });
    // Trim if over limit
    if (this.deadLetter.length > this.MAX_DLQ_SIZE) {
      this.deadLetter.shift();
    }
  }
}
```

---

### 3.4 Write-Ahead Log for Critical Operations
**Files:** New file or extend snapshot store
**Effort:** High (1 week)
**Risk:** High

**Consideration:** This is a significant architectural change. Alternative: increase snapshot frequency for critical operations.

---

## Priority 4: Monitoring & Observability (Week 4+)

### 4.1 Latency Histograms
**Implementation:** Add histogram metrics for all operations
```typescript
const requestDuration = new Histogram({
  name: 'http_request_duration_ms',
  help: 'HTTP request latency',
  buckets: [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000],
});
```

### 4.2 Alerting Rules
**Files:** Alerting configuration
```yaml
groups:
  - name: cli-bridge
    rules:
      - alert: HighErrorRate
        expr: rate(cli_bridge_errors_total[5m]) > 0.1
        for: 1m
      - alert: PersistenceFailures
        expr: rate(cli_bridge_snapshot_write_errors_total[5m]) > 0
        for: 0m
      - alert: HighQueueDepth
        expr: cli_bridge_queue_depth > 100
        for: 5m
```

### 4.3 Distributed Tracing
**Implementation:** Add OpenTelemetry tracing
```typescript
import { trace } from '@opentelemetry/api';

const tracer = trace.getTracer('cli-bridge');
const span = tracer.startSpan('handleBridgeRequest');
```

---

## Summary Table

| ID | Improvement | Priority | Effort | Impact |
|----|-------------|----------|--------|--------|
| 1.1 | Snapshot crash prevention | P0 | Medium | Critical |
| 1.2 | Server error handler | P0 | Low | Critical |
| 1.3 | Goal loop supervision | P0 | Medium | Critical |
| 1.4 | Rate limiter IP fix | P0 | Low | Critical |
| 2.1 | Error codes | P1 | Medium | High |
| 2.2 | Correlation IDs | P1 | Medium | High |
| 2.3 | Health endpoint | P1 | Low | High |
| 2.4 | Structured logging | P1 | High | High |
| 2.5 | Graceful shutdown | P1 | Low | Medium |
| 3.1 | Circuit breaker | P2 | Medium | Medium |
| 3.2 | Prometheus metrics | P2 | Low | Medium |
| 3.3 | Dead letter queue | P2 | Medium | Medium |
| 3.4 | WAL | P3 | High | Medium |
| 4.1 | Latency histograms | P3 | Medium | Medium |
| 4.2 | Alerting rules | P3 | Low | High |
| 4.3 | Distributed tracing | P3 | High | Medium |

---

## Estimated Timeline

| Week | Focus | Deliverables |
|------|-------|--------------|
| Week 1 | P0 fixes | Crash prevention, error handlers, rate limiter |
| Week 2 | Operational foundation | Error codes, correlation IDs, health endpoint |
| Week 3 | Logging & shutdown | Structured logging, graceful shutdown |
| Week 4 | Resilience patterns | Circuit breaker, metrics, DLQ |
| Week 5+ | Monitoring | Alerting, tracing, dashboards |
