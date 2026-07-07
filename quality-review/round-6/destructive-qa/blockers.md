# Round 6: Destructive QA Blockers

**Review Date:** 2026-07-07

---

## P0 Critical Blockers

### P0-1: No Input Validation on HTTP Route Parameters

**File:** `goal-loop-routes.ts`
**Line:** 86-89, 119-127, 250-257

**Issue:**
`goalId` is extracted from URL via simple regex without length or character validation:
```typescript
function extractGoalId(pathname: string): string | null {
  const match = pathname.match(/^\/bridge\/goals\/([^/]+)/);
  return match ? match[1] : null;
}
```

An attacker can submit arbitrarily long `goalId` values (e.g., 1MB of characters) that could:
- Cause DoS via memory exhaustion in downstream stores
- Trigger regex catastrophic backtracking
- Overflow logging/audit systems

**Proof of Concept:**
```bash
curl -X POST 'http://localhost:31337/bridge/goals/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/loop/start' \
  -H 'Content-Type: application/json' \
  -d '{"planId": "test"}'
```

**Fix Required:**
```typescript
const MAX_GOAL_ID_LENGTH = 64;
function extractGoalId(pathname: string): string | null {
  const match = pathname.match(/^\/bridge\/goals\/([^/]+)/);
  if (!match) return null;
  const goalId = match[1];
  if (goalId.length > MAX_GOAL_ID_LENGTH) return null;
  if (!/^[a-zA-Z0-9_-]+$/.test(goalId)) return null;
  return goalId;
}
```

---

### P0-2: Race Condition in Health Check Interval

**File:** `executor-registry.ts`
**Line:** 307-321

**Issue:**
Health check runs in a fixed interval without coordinating concurrent checks:
```typescript
this.healthCheckTimer = setInterval(async () => {
  for (const executor of this.list()) {
    if (executor.healthCheck) {
      // If healthCheck() takes longer than healthCheckIntervalMs,
      // this interval fires again and runs another batch
      const healthy = await executor.healthCheck();
      this.updateHealth(executor.id, healthy);
    }
  }
  onStatusChange?.(this.getStatus());
}, this.healthCheckIntervalMs);
```

If `healthCheckIntervalMs` is 30s and a health check takes 35s (slow network), two checks overlap, potentially corrupting `healthyExecutors` set.

**Proof of Concept:**
1. Network latency causes healthCheck to take 35s
2. After 30s, next interval fires
3. Two concurrent health checks update `healthyExecutors`
4. Race condition: last write wins, state may be inconsistent

**Fix Required:**
```typescript
let healthCheckInProgress = false;
this.healthCheckTimer = setInterval(async () => {
  if (healthCheckInProgress) {
    console.warn('[ExecutorRegistry] Skipping health check - previous still running');
    return;
  }
  healthCheckInProgress = true;
  try {
    // ... health check logic
  } finally {
    healthCheckInProgress = false;
  }
}, this.healthCheckIntervalMs);
```

---

## P1 High Priority Blockers

### P1-1: No Circuit Breaker for Unhealthy Executors

**File:** `executor-registry.ts`
**Lines:** 168-196

**Issue:**
When an executor fails repeatedly, the system continues sending requests to it. Health check marks it unhealthy but `select()` still returns it if no other healthy executors exist.

```typescript
select(options?: { preferredTags?: string[] }): ExecutorBackend | undefined {
  const healthy = this.listHealthy();
  if (healthy.length === 0) {
    console.warn('[ExecutorRegistry] No healthy executors available');
    return undefined;
  }
  // Returns first healthy executor
  return healthy[0];
}
```

**Impact:**
A failing executor could cause cascading failures across all execution requests.

**Fix Required:**
Add circuit breaker with half-open state:
```typescript
interface ExecutorCircuitState {
  failures: number;
  lastFailureAt: number;
  state: 'closed' | 'open' | 'half-open';
}

private readonly circuitBreakers = new Map<string, ExecutorCircuitState>();

// Check circuit breaker before returning executor
if (circuitBreaker.state === 'open' && Date.now() - circuitBreaker.lastFailureAt < RESET_TIMEOUT) {
  return undefined; // Circuit is open, reject requests
}
```

---

### P1-2: Symlink Attack in Working Directory Validation

**File:** `opencode-executor.ts`
**Lines:** 88-101

**Issue:**
Working directory validation does not handle symlinks:
```typescript
const workspaceRoot = path.resolve(this.options.workingDirectory);
const resolvedWorkingDir = path.resolve(workingDir);
if (!resolvedWorkingDir.startsWith(workspaceRoot + path.sep) && resolvedWorkingDir !== workspaceRoot) {
  resolve({ ok: false, ... });
  return;
}
```

If `workingDir` is a symlink pointing outside `workspaceRoot`, validation passes but files can be accessed outside the sandbox.

**Proof of Concept:**
```bash
# In workspaceRoot
ln -s /etc malicious_dir
# Now workingDirectory can be set to "malicious_dir" which resolves to /etc
```

**Fix Required:**
```typescript
import { lstat } from 'node:fs/promises';

async function isPathSafe(workingDir: string, workspaceRoot: string): Promise<boolean> {
  const resolved = path.resolve(workingDir);
  
  // Check for symlinks
  try {
    const stats = await lstat(resolved);
    if (stats.isSymbolicLink()) {
      // Resolve symlink and check again
      const realPath = path.resolve(await fs.realpath(resolved));
      return realPath.startsWith(workspaceRoot + path.sep);
    }
  } catch {
    // Ignore lstat errors
  }
  
  return resolved.startsWith(workspaceRoot + path.sep);
}
```

---

### P1-3: Fixed Polling Interval Causes Thundering Herd

**File:** `workbuddy-executor.ts`
**Lines:** 141-158

**Issue:**
Fixed 2000ms polling interval with no jitter:
```typescript
const pollIntervalMs = 2000; // From 1000ms to 2000ms

while (Date.now() < timeoutAt) {
  const result = this.adapter.getResult(workbuddyTask.taskId);
  if (result) { /* ... */ }
  await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
}
```

Multiple concurrent requests will poll at exactly the same intervals, potentially overwhelming the adapter.

**Fix Required:**
```typescript
// Add jitter: +/- 20% randomization
const jitter = pollIntervalMs * 0.2 * (Math.random() * 2 - 1);
const actualInterval = Math.round(pollIntervalMs + jitter);
await new Promise(resolve => setTimeout(resolve, actualInterval));
```

---

## P2 Medium Priority Blockers

### P2-1: Silent Hydration Failures

**File:** `bridge-api.ts`
**Lines:** 1750-1752

**Issue:**
Hydration failures are logged but not exposed to operators:
```typescript
if (hydrationFailures > 0) {
  console.warn(`[BridgeRuntime] Total hydration failures: ${hydrationFailures}`);
}
```

Data loss occurs silently.

**Fix Required:**
```typescript
if (hydrationFailures > 0) {
  console.error(`[BridgeRuntime] CRITICAL: ${hydrationFailures} hydration failures`);
  // Expose via runtime state
  if (!runtime.hydrationIssues) runtime.hydrationIssues = [];
  runtime.hydrationIssues.push({
    count: hydrationFailures,
    at: Date.now(),
  });
}
```

---

### P2-2: Missing Null Check in parseGoalLoopConfig

**File:** `goal-automation-loop.ts`
**Lines:** 77-84

**Issue:**
```typescript
export function parseGoalLoopConfig(loop: AutomationLoopRun): GoalLoopConfig | null {
  if (!loop.pendingInput) return null;
  try {
    return JSON.parse(loop.pendingInput) as GoalLoopConfig;
  } catch {
    return null; // Silent failure
  }
}
```

Callers may not handle `null` return value, leading to null pointer exceptions.

**Fix Required:**
Add validation of required fields:
```typescript
export function parseGoalLoopConfig(loop: AutomationLoopRun): GoalLoopConfig | null {
  if (!loop.pendingInput) return null;
  try {
    const config = JSON.parse(loop.pendingInput) as GoalLoopConfig;
    // Validate required fields
    if (!config.planId || typeof config.planId !== 'string') {
      console.error('[GoalLoop] Invalid config: missing planId');
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

### P2-3: No Output Size Limit on WorkBuddy Results

**File:** `workbuddy-executor.ts`
**Lines:** 143-155

**Issue:**
```typescript
const result = this.adapter.getResult(workbuddyTask.taskId);
if (result) {
  return {
    ok: result.ok,
    stdout: result.stdout ?? '',
    stderr: result.stderr,
    // No size check before returning
  };
}
```

Malicious WorkBuddy adapter could return multi-GB stdout/stderr, causing memory exhaustion.

**Fix Required:**
```typescript
const MAX_OUTPUT_BYTES = 10_000_000; // 10MB

if (result.stdout && result.stdout.length > MAX_OUTPUT_BYTES) {
  return {
    ok: false,
    stdout: result.stdout.slice(0, MAX_OUTPUT_BYTES),
    stderr: 'Output truncated: exceeded 10MB limit',
    failureReason: 'output-exceeded-limit',
  };
}
```

---

## Summary Table

| ID | Severity | Category | Issue |
|----|----------|----------|-------|
| P0-1 | Critical | Security | No input validation on HTTP route parameters |
| P0-2 | Critical | Edge Cases | Race condition in health check interval |
| P1-1 | High | Security | No circuit breaker for unhealthy executors |
| P1-2 | High | Security | Symlink attack in working directory validation |
| P1-3 | High | Edge Cases | Fixed polling interval causes thundering herd |
| P2-1 | Medium | Breaking Changes | Silent hydration failures |
| P2-2 | Medium | Edge Cases | Missing null check in parseGoalLoopConfig |
| P2-3 | Medium | Edge Cases | No output size limit on WorkBuddy results |

**Total Blockers:** 8
**Critical:** 2
**High:** 3
**Medium:** 3
