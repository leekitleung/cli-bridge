# Terminal Veteran - Improvement List

## Error Handling Improvements

### EH-1: Add Error Boundaries to Background Loops
**Files:** `goal-automation-loop.ts`, `automation-loop-runner.ts`
**Priority:** P1

Add structured error handling with retry/backoff for background operations:
- Wrap `orchestrator.advance()` in try-catch with exponential backoff
- Implement error callback mechanism for operator notification
- Add error metrics to observability endpoints

### EH-2: Consistent Error Propagation in Bridge API
**File:** `bridge-api.ts` (snapshot hydration section)
**Priority:** P2

Replace silent `catch {}` blocks with logging and metrics:
```typescript
let skippedRecords = 0;
for (const t of read.snapshot.workbuddyTasks ?? []) {
  try { workbuddyExecution.hydrateTask(t); }
  catch (err) {
    skippedRecords++;
    console.warn('[BridgeRuntime] Hydration skip:', { record: 'task', error: String(err) });
  }
}
// Report skippedRecords in metrics
```

### EH-3: Add Error Types for Executors
**File:** `executor-registry.ts`
**Priority:** P2

Define specific error classes instead of string-based `failureReason`:
```typescript
class ExecutorTimeoutError extends Error {
  constructor(public readonly executorId: string, public readonly durationMs: number) {
    super(`Executor ${executorId} timed out after ${durationMs}ms`);
    this.name = 'ExecutorTimeoutError';
  }
}
```

---

## Timeout Improvements

### T-1: Add Timeout to WorkBuddy Adapter Operations
**File:** `workbuddy-execution-adapter.ts`
**Priority:** P1

Wrap blocking operations with timeout:
```typescript
async claimNextWithTimeout(endpointId: string, timeoutMs = 5000): Promise<Task | null> {
  return Promise.race([
    this.claimNext(endpointId),
    new Promise<null>((_, reject) =>
      setTimeout(() => reject(new Error('claim-timeout')), timeoutMs)
    ),
  ]).catch(() => null);
}
```

### T-2: Implement Circuit Breaker for Executor Failures
**File:** `executor-registry.ts`
**Priority:** P1

Add circuit breaker pattern to prevent cascading failures:
```typescript
interface CircuitBreakerState {
  failures: number;
  lastFailure: number;
  state: 'closed' | 'open' | 'half-open';
}

private readonly circuitBreakers = new Map<string, CircuitBreakerState>();
private readonly CIRCUIT_THRESHOLD = 5;
private readonly CIRCUIT_RESET_MS = 60_000;
```

### T-3: Add Timeout to Source Relay Response Wait
**File:** `source-relay-poller.ts`
**Priority:** P2

Current `waitForStableAssistantResponse` uses hardcoded timeout. Make configurable with environment variable override.

---

## Logging Improvements

### L-1: Implement Structured JSON Logging
**File:** New file `logger.ts` in `packages/shared/src/`
**Priority:** P1

Create production-ready structured logger:
```typescript
interface LogEntry {
  timestamp: string;       // ISO 8601
  level: LogLevel;         // 'debug' | 'info' | 'warn' | 'error'
  service: string;         // 'server' | 'bridge-api' | 'executor'
  correlationId?: string;  // Request/loop correlation
  message: string;
  metadata?: Record<string, unknown>;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
}
```

### L-2: Add Correlation IDs to Async Chains
**File:** `server.ts`, `bridge-api.ts`
**Priority:** P2

Propagate correlation IDs from request through to executor execution:
```typescript
// In server.ts request handler
const correlationId = request.headers['x-correlation-id'] ?? randomUUID();

// Pass to bridge-api handlers
handleBridgeRequest(bridgeRuntime, ..., { correlationId })
```

### L-3: Implement Log Level Configuration
**File:** `server.ts`
**Priority:** P2

Allow runtime log level configuration via environment:
```typescript
const LOG_LEVEL = process.env.LOG_LEVEL ?? 'info'; // 'debug' | 'info' | 'warn' | 'error'
```

---

## Graceful Degradation Improvements

### GD-1: Source Relay Automatic Recovery After Max Backoff
**File:** `source-relay-poller.ts`
**Priority:** P2

Implement recovery mode after max backoff attempts:
```typescript
const RECOVERY_MODE_INTERVAL_MS = 60_000; // Check once per minute

if (backoffAttempts >= MAX_BACKOFF_ATTEMPTS && !isInRecoveryMode) {
  isInRecoveryMode = true;
  // Schedule periodic recovery attempts
  recoveryTimer = setInterval(() => attemptRecovery(), RECOVERY_MODE_INTERVAL_MS);
}
```

### GD-2: Dead Letter Queue for Failed WorkBuddy Results
**File:** `workbuddy-execution-adapter.ts`
**Priority:** P2

Store failed results for later analysis/retry:
```typescript
private readonly deadLetterQueue: Array<{
  task: Task;
  result: WorkBuddyExecutionResult;
  failedAt: number;
  failureReason: string;
}>;
```

### GD-3: Executor Health Check with Automatic Recovery
**File:** `executor-registry.ts`
**Priority:** P2

After marking executor unhealthy, periodically probe for recovery:
```typescript
private readonly healthProbes = new Map<string, ReturnType<typeof setTimeout>>();

private scheduleHealthProbe(executorId: string): void {
  const delay = Math.min(30_000 * Math.pow(2, this.failureCounts.get(executorId) ?? 0), 300_000);
  this.healthProbes.set(executorId, setTimeout(async () => {
    if (await this.executors.get(executorId)?.healthCheck?.()) {
      this.updateHealth(executorId, true);
    } else {
      this.scheduleHealthProbe(executorId);
    }
  }, delay));
}
```

### GD-4: Implement Graceful Shutdown Handler
**File:** `server.ts`
**Priority:** P2

Handle SIGTERM/SIGINT for clean shutdown:
```typescript
function setupGracefulShutdown(server: http.Server): void {
  const shutdown = (signal: string) => {
    console.log(`Received ${signal}, shutting down gracefully...`);
    server.close(() => {
      console.log('HTTP server closed');
      process.exit(0);
    });
    // Force exit after 30s
    setTimeout(() => process.exit(1), 30_000);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}
```

---

## Security Improvements

### S-1: Add Shell Metacharacter Validation
**File:** `command-backend.ts`
**Priority:** P0

Reject commands containing shell metacharacters:
```typescript
const SHELL_METACHAR_PATTERN = /[;&|`$(){}<>\\!#*?"'\[\]]/;

function parseArgv(input: string): string[] {
  // ... existing parsing logic
  if (SHELL_METACHAR_PATTERN.test(current)) {
    throw new Error('Shell metacharacters not allowed');
  }
}
```

### S-2: Add Prompt/Input Length Limits
**File:** `execution-dispatcher.ts`
**Priority:** P2

Validate input lengths before passing to executors:
```typescript
const MAX_PROMPT_LENGTH = 100_000;  // 100KB
const MAX_STDIN_LENGTH = 1_000_000; // 1MB

if (task.prompt.length > MAX_PROMPT_LENGTH) {
  return { ok: false, ..., failureReason: 'prompt-too-large' };
}
```

### S-3: Validate WorkBuddy Payload Numeric Fields
**File:** `bridge-api.ts` (sanitizeWorkBuddyPayload)
**Priority:** P2

Add range validation for numeric fields to prevent DoS:
```typescript
case 'record-task': {
  const status = body.status as string;
  const validStatuses = ['pending', 'running', 'done', 'failed'];
  if (!validStatuses.includes(status)) {
    return `Invalid status: ${status}`;
  }
  // ...
}
```

### S-4: Rate Limit Response Body Size
**File:** `server.ts`
**Priority:** P2

Limit response body sizes to prevent memory exhaustion:
```typescript
const MAX_RESPONSE_BYTES = 10_000_000; // 10MB

// In writeBridgeResult
if (Buffer.byteLength(JSON.stringify(result.payload)) > MAX_RESPONSE_BYTES) {
  writeJson(413, { status: 'error', message: 'Response too large' }, response);
}
```

---

## Observability Improvements

### O-1: Add Metrics Endpoint for Error Rates
**File:** `goal-loop-routes.ts` (handleDiagnosticsMetricsRequest)
**Priority:** P2

Include error rate metrics:
```typescript
metrics.executors = {
  ...metrics.executors,
  errorRates: executorStatus.executors.map(e => ({
    id: e.id,
    recentErrors: errorCounts.get(e.id) ?? 0,
    errorRate: calculateErrorRate(e.id),
  })),
};
```

### O-2: Add Request Duration Histograms
**File:** `server.ts`
**Priority:** P2

Track request duration percentiles for performance analysis:
```typescript
const requestDurations: number[] = [];

request.on('close', () => {
  requestDurations.push(Date.now() - requestStartTime);
  // Keep last 1000 samples
  if (requestDurations.length > 1000) requestDurations.shift();
});
```

### O-3: Health Check Should Include Dependency Status
**File:** `routes/health.ts`
**Priority:** P2

Extend health endpoint with dependency status:
```typescript
function createHealthPayload(...) {
  return {
    ...,
    dependencies: {
      executorRegistry: getExecutorRegistry().getStatus(),
      storage: {
        persistenceFailure: runtime.getPersistenceFailure(),
        lastPersistAt: lastPersistTimestamp,
      },
    },
  };
}
```

---

## Testing Improvements

### T-1: Add Chaos Testing for Timeouts
**Files:** `tests/`
**Priority:** P2

Add integration tests that simulate:
- Network delays
- Executor timeouts
- Memory pressure
- Process crashes

### T-2: Add Property-Based Testing for Argv Parser
**File:** `tests/unit/command-backend.test.ts`
**Priority:** P2

Use property-based testing to discover edge cases:
```typescript
import fc from 'fast-check';
fc.assert(
  fc.property(fc.string(), (input) => {
    const argv = parseArgv(input);
    // Verify no shell injection possible
  })
);
```

---

## Summary Checklist

| ID | Category | Priority | Estimated Effort |
|----|----------|----------|------------------|
| EH-1 | Error Handling | P1 | Medium |
| EH-2 | Error Handling | P2 | Low |
| EH-3 | Error Handling | P2 | Low |
| T-1 | Timeout | P1 | Medium |
| T-2 | Timeout | P1 | High |
| T-3 | Timeout | P2 | Low |
| L-1 | Logging | P1 | High |
| L-2 | Logging | P2 | Medium |
| L-3 | Logging | P2 | Low |
| GD-1 | Graceful Degradation | P2 | Medium |
| GD-2 | Graceful Degradation | P2 | Medium |
| GD-3 | Graceful Degradation | P2 | Medium |
| GD-4 | Graceful Degradation | P2 | Low |
| S-1 | Security | P0 | Low |
| S-2 | Security | P2 | Low |
| S-3 | Security | P2 | Low |
| S-4 | Security | P2 | Low |
| O-1 | Observability | P2 | Low |
| O-2 | Observability | P2 | Low |
| O-3 | Observability | P2 | Low |
| T-1 | Testing | P2 | High |
| T-2 | Testing | P2 | Medium |
