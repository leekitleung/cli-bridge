# Round 6: Destructive QA Improvement List

**Review Date:** 2026-07-07

---

## Immediate Improvements (Fix in Current Sprint)

### 1. Add Input Validation Middleware

**Priority:** P0
**Files:** `goal-loop-routes.ts`

```typescript
// Add after parseJsonBody function
function validateId(id: string, name: string, maxLength: number = 64): string | null {
  if (!id || typeof id !== 'string') {
    return `${name} is required`;
  }
  if (id.length === 0) {
    return `${name} cannot be empty`;
  }
  if (id.length > maxLength) {
    return `${name} exceeds maximum length of ${maxLength}`;
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
    return `${name} contains invalid characters`;
  }
  return null;
}
```

Usage:
```typescript
const goalId = extractGoalId(pathname);
const goalIdError = validateId(goalId ?? '', 'goalId');
if (goalIdError) {
  return sendJson(res, 400, { ok: false, error: goalIdError }), true;
}
```

---

### 2. Add Health Check Lock

**Priority:** P0
**Files:** `executor-registry.ts`

Add mutex/lock to prevent concurrent health check batches:
```typescript
private healthCheckLock = false;

// In startHealthCheck:
this.healthCheckTimer = setInterval(async () => {
  if (this.healthCheckLock) {
    console.warn('[ExecutorRegistry] Health check skipped - previous still running');
    return;
  }
  this.healthCheckLock = true;
  try {
    // ... health check logic
  } finally {
    this.healthCheckLock = false;
  }
}, this.healthCheckIntervalMs);
```

---

### 3. Implement Circuit Breaker

**Priority:** P1
**Files:** `executor-registry.ts`

```typescript
const CIRCUIT_FAILURE_THRESHOLD = 5;
const CIRCUIT_RESET_TIMEOUT_MS = 60_000; // 1 minute

private circuitBreakers = new Map<string, {
  failures: number;
  lastFailureAt: number;
  state: 'closed' | 'open' | 'half-open';
}>();

async execute(task: ExecutorTask, options?: { executorId?: string; preferredTags?: string[] }): Promise<ExecutorResult> {
  const executor = /* ... */;
  
  if (executor) {
    const cb = this.circuitBreakers.get(executor.id);
    if (cb?.state === 'open') {
      if (Date.now() - cb.lastFailureAt < CIRCUIT_RESET_TIMEOUT_MS) {
        return { ok: false, failureReason: 'circuit-open', durationMs: 0 };
      }
      // Transition to half-open
      cb.state = 'half-open';
    }
  }
  
  const result = await executor.execute(task);
  
  // Update circuit breaker on failure
  if (!result.ok) {
    this.recordExecutorFailure(executor.id);
  } else if (this.circuitBreakers.get(executor.id)?.state === 'half-open') {
    this.circuitBreakers.set(executor.id, { failures: 0, lastFailureAt: 0, state: 'closed' });
  }
  
  return result;
}

private recordExecutorFailure(executorId: string): void {
  const cb = this.circuitBreakers.get(executorId) ?? { failures: 0, lastFailureAt: 0, state: 'closed' };
  cb.failures++;
  cb.lastFailureAt = Date.now();
  
  if (cb.failures >= CIRCUIT_FAILURE_THRESHOLD) {
    cb.state = 'open';
    console.warn(`[ExecutorRegistry] Circuit opened for ${executorId}`);
  }
  
  this.circuitBreakers.set(executorId, cb);
}
```

---

## Short-term Improvements (Next Sprint)

### 4. Add Symlink Detection

**Priority:** P1
**Files:** `opencode-executor.ts`

```typescript
import { lstat, realpath } from 'node:fs/promises';

async function isPathSafe(workingDir: string, workspaceRoot: string): Promise<boolean> {
  try {
    const resolved = path.resolve(workingDir);
    const stats = await lstat(resolved);
    
    // If symlink, resolve to real path and check
    if (stats.isSymbolicLink()) {
      const realPath = path.resolve(await realpath(resolved));
      return realPath.startsWith(workspaceRoot + path.sep) || realPath === workspaceRoot;
    }
    
    return resolved.startsWith(workspaceRoot + path.sep) || resolved === workspaceRoot;
  } catch {
    return false;
  }
}
```

---

### 5. Add Jitter to Polling Intervals

**Priority:** P1
**Files:** `workbuddy-executor.ts`, `executor-registry.ts`

```typescript
function jitterDelay(baseMs: number, jitterFraction: number = 0.2): number {
  const jitter = baseMs * jitterFraction * (Math.random() * 2 - 1);
  return Math.round(baseMs + jitter);
}

// Usage in workbuddy-executor.ts
const pollIntervalMs = 2000;
await new Promise(resolve => setTimeout(resolve, jitterDelay(pollIntervalMs)));

// Usage in health check
const intervalMs = jitterDelay(this.healthCheckIntervalMs, 0.1);
setInterval(/* ... */, intervalMs);
```

---

### 6. Add Output Size Limits

**Priority:** P2
**Files:** `workbuddy-executor.ts`

```typescript
const MAX_OUTPUT_BYTES = 10_000_000; // 10MB

function truncateOutput(output: string | undefined): { value: string; truncated: boolean } {
  if (!output) return { value: '', truncated: false };
  if (output.length <= MAX_OUTPUT_BYTES) return { value: output, truncated: false };
  return { value: output.slice(0, MAX_OUTPUT_BYTES), truncated: true };
}

// Usage:
const { value: truncatedStdout, truncated } = truncateOutput(result.stdout);
if (truncated) {
  return {
    ok: result.ok,
    stdout: truncatedStdout,
    stderr: (result.stderr ?? '') + '\n[Output truncated: exceeded 10MB limit]',
    exitCode: result.exitCode,
    failureReason: result.failureReason ?? 'output-truncated',
  };
}
```

---

### 7. Expose Hydration Failures

**Priority:** P2
**Files:** `bridge-api.ts`

```typescript
// Add to BridgeRuntime interface:
interface BridgeRuntime {
  // ... existing fields
  readonly hydrationIssues?: Array<{
    count: number;
    at: number;
  }>;
}

// In createBridgeRuntime:
let hydrationIssues: Array<{ count: number; at: number }> = [];

// After hydration loop:
if (hydrationFailures > 0) {
  hydrationIssues.push({ count: hydrationFailures, at: Date.now() });
  console.error(`[BridgeRuntime] CRITICAL: ${hydrationFailures} hydration failures - data loss may have occurred`);
}

// Add to returned runtime:
return {
  // ... existing fields
  hydrationIssues,
};
```

Add diagnostic endpoint to expose issues:
```typescript
if (pathname === '/bridge/diagnostics/hydration' && method === 'GET') {
  return ok({
    issues: runtime.hydrationIssues ?? [],
    totalFailures: (runtime.hydrationIssues ?? []).reduce((sum, i) => sum + i.count, 0),
  }), true;
}
```

---

### 8. Add Validation in parseGoalLoopConfig

**Priority:** P2
**Files:** `goal-automation-loop.ts`

```typescript
export function parseGoalLoopConfig(loop: AutomationLoopRun): GoalLoopConfig | null {
  if (!loop.pendingInput) return null;
  try {
    const config = JSON.parse(loop.pendingInput) as GoalLoopConfig;
    
    // Validate structure
    if (typeof config !== 'object' || config === null) {
      console.error('[GoalLoop] Config is not an object');
      return null;
    }
    
    if (typeof config.planId !== 'string' || config.planId.length === 0) {
      console.error('[GoalLoop] Config missing or invalid planId');
      return null;
    }
    
    // Optional field validation
    if (config.workingDirectory !== undefined && typeof config.workingDirectory !== 'string') {
      console.error('[GoalLoop] Config workingDirectory must be string');
      return null;
    }
    
    if (config.autoVerify !== undefined && typeof config.autoVerify !== 'boolean') {
      console.error('[GoalLoop] Config autoVerify must be boolean');
      return null;
    }
    
    return config;
  } catch (e) {
    console.error('[GoalLoop] Failed to parse config:', e);
    return null;
  }
}
```

---

## Long-term Improvements (Future Architecture)

### 9. Add Chaos Engineering Tests

**Priority:** P1
**Files:** `tests/e2e/`

```typescript
// tests/e2e/chaos/chaos-executor.spec.ts

describe('Executor Chaos Tests', () => {
  it('should handle executor timeout gracefully', async () => {
    // Mock slow executor
    const slowExecutor = {
      id: 'slow',
      async execute() {
        await new Promise(r => setTimeout(r, 300_000));
        return { ok: true, stdout: '', durationMs: 300_000 };
      },
      getCapabilities() { return { id: 'slow', name: 'Slow', transport: 'mock' }; }
    };
    
    registry.register(slowExecutor);
    const result = await registry.execute({ taskId: '1', prompt: 'test', proposalId: 'p1' });
    
    // Should timeout after configured timeout
    expect(result.ok).toBe(false);
    expect(result.failureReason).toContain('timeout');
  });
  
  it('should handle executor crash', async () => {
    const crashingExecutor = {
      id: 'crash',
      async execute() { throw new Error('Executor crashed'); },
      getCapabilities() { return { id: 'crash', name: 'Crash', transport: 'mock' }; }
    };
    
    registry.register(crashingExecutor);
    const result = await registry.execute({ taskId: '1', prompt: 'test', proposalId: 'p1' });
    
    expect(result.ok).toBe(false);
    expect(result.failureReason).toContain('executor-error');
  });
});
```

---

### 10. Add Rate Limiting

**Priority:** P2
**Files:** New middleware

```typescript
// middleware/rate-limit.ts

interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
}

export function createRateLimiter(config: RateLimitConfig) {
  const requests = new Map<string, number[]>();
  
  return function rateLimit(req: IncomingMessage): boolean {
    const key = req.socket.remoteAddress ?? 'unknown';
    const now = Date.now();
    const window = requests.get(key) ?? [];
    
    // Remove old requests outside window
    const valid = window.filter(t => t > now - config.windowMs);
    
    if (valid.length >= config.maxRequests) {
      return false; // Rate limited
    }
    
    valid.push(now);
    requests.set(key, valid);
    return true;
  };
}

// Usage in goal-loop-routes.ts:
const rateLimit = createRateLimiter({ windowMs: 60_000, maxRequests: 100 });

if (!rateLimit(req)) {
  return sendJson(res, 429, { ok: false, error: 'Rate limit exceeded' }), true;
}
```

---

### 11. Add Execution Request ID Validation

**Priority:** P2
**Files:** `goal-loop-routes.ts`

```typescript
// Add UUID validation
function isValidUUID(id: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(id);
}

// In approve handler:
const executionIdError = validateId(body?.executionId ?? '', 'executionId');
if (executionIdError) {
  return sendJson(res, 400, { ok: false, error: executionIdError }), true;
}

if (!isValidUUID(body.executionId)) {
  return sendJson(res, 400, { ok: false, error: 'executionId must be a valid UUID' }), true;
}
```

---

### 12. Add Request Timeout per Route

**Priority:** P1
**Files:** `goal-loop-routes.ts`

```typescript
// Add timeout per route type
const ROUTE_TIMEOUTS: Record<string, number> = {
  '/loop/start': 30_000,
  '/loop/stop': 5_000,
  '/loop/status': 5_000,
  '/loop/gates': 5_000,
  '/loop/approve': 10_000,
};

// In handleGoalLoopRequest:
const timeoutMs = ROUTE_TIMEOUTS[remainingPath] ?? 30_000;
const timeoutId = setTimeout(() => {
  res.writeHead(504, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: false, error: 'Request timeout' }));
}, timeoutMs);

try {
  // Handle request
} finally {
  clearTimeout(timeoutId);
}
```

---

## Summary

| ID | Priority | Estimated Effort | Impact |
|----|----------|------------------|--------|
| 1. Input Validation | P0 | 2 hours | Prevents DoS attacks |
| 2. Health Check Lock | P0 | 30 min | Prevents race conditions |
| 3. Circuit Breaker | P1 | 4 hours | Prevents cascading failures |
| 4. Symlink Detection | P1 | 2 hours | Closes security gap |
| 5. Jitter | P1 | 1 hour | Improves reliability |
| 6. Output Limits | P2 | 2 hours | Prevents memory exhaustion |
| 7. Hydration Visibility | P2 | 2 hours | Improves debugging |
| 8. Config Validation | P2 | 1 hour | Prevents null pointer errors |
| 9. Chaos Tests | P1 | 8 hours | Improves confidence |
| 10. Rate Limiting | P2 | 4 hours | Prevents abuse |
| 11. UUID Validation | P2 | 1 hour | Input sanitization |
| 12. Route Timeouts | P1 | 2 hours | Prevents hangs |
