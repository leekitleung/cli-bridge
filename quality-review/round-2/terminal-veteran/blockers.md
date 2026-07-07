# Terminal Veteran - P0/P1/P2 Blockers

## P0 - Critical (Must Fix)

### P0-1: Command Injection via Shell Metacharacters
**File:** `apps/local-server/src/workbuddy/command-backend.ts`
**Lines:** 72-93 (parseArgv function)

```typescript
function parseArgv(input: string): string[] {
  // ...
  // Does not reject: ; | & $() `` > < etc.
}
```

**Issue:** The argv parser only handles quoting but does not reject shell metacharacters. A malicious prompt like:
```
echo "hi"; rm -rf /
```
Would parse as two commands, though `isAllowed()` would block `rm`. However, edge cases exist where commands like `echo` could be chained with permitted commands.

**Impact:** Potential command injection if combined with an allowed command that supports command chaining.

**Recommendation:** Add shell metacharacter validation:
```typescript
const SHELL_METACHARACTERS = /[;|&$`()<>]/;
if (SHELL_METACHARACTERS.test(command)) {
  return { ok: false, ..., failureReason: 'shell-metacharacter-detected' };
}
```

---

## P1 - High (Should Fix)

### P1-1: Silent Error Swallowing in Goal Loop Runner
**File:** `apps/local-server/src/goal/goal-automation-loop.ts`
**Lines:** 506

```typescript
run().catch(console.error);
```

**Issue:** Background goal loop errors are only logged to console. No alerting, no retry logic, no dead letter queue.

**Impact:** Failed goal loops may silently stall without operator awareness.

**Recommendation:** Add error callback and implement retry with exponential backoff:
```typescript
export function startGoalLoopRunner(
  runtime: BridgeRuntime,
  loopId: string,
  tickIntervalMs: number = 5000,
  onError?: (err: unknown) => void,
): () => void {
  // ...
  run().catch((err) => {
    onError?.(err);
    console.error('[GoalLoopRunner] Background error:', err);
  });
}
```

### P1-2: Missing Timeout on WorkBuddy Adapter Operations
**File:** `apps/local-server/src/adapters/workbuddy-execution-adapter.ts`
**Affected:** `claimNext()`, `getResult()` called from `pollAndProcess()`

**Issue:** The polling loop in `WorkBuddyExecutor.pollAndProcess()` calls adapter methods that may hang indefinitely if the WorkBuddy backend is unresponsive.

**Impact:** Single polling thread could block, preventing other tasks from being processed.

**Recommendation:** Add AbortSignal-based timeout to adapter operations or wrap in race condition:
```typescript
const result = await Promise.race([
  this.adapter.claimNext(endpointId),
  new Promise((_, reject) => setTimeout(() => reject(new Error('claim-timeout')), 5000)),
]);
```

### P1-3: No Structured Logging for Production Observability
**Files:** Multiple (server.ts, bridge-api.ts, executor-registry.ts)

**Issue:** All logging uses `console.log/error/debug` with plain text. No machine-parseable format, no log levels, no correlation IDs.

**Impact:** Production debugging requires manual log parsing. Cannot integrate with log aggregation systems (ELK, Datadog, etc.).

**Recommendation:** Implement structured logger:
```typescript
interface LogEntry {
  timestamp: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  service: string;
  correlationId?: string;
  message: string;
  metadata?: Record<string, unknown>;
}
```

---

## P2 - Medium (Nice to Fix)

### P2-1: Source Relay Backoff Never Auto-Recovers
**File:** `apps/extension/src/content/source-relay-poller.ts`
**Lines:** 264-272, 280-295

**Issue:** When source relay enters backoff mode, it stays in backoff until a manual `ping()` or `tick()` call succeeds. No automatic recovery attempt after max backoff.

**Impact:** Extended outages require manual intervention.

**Recommendation:** Implement recovery attempt after max backoff with degraded mode:
```typescript
if (backoffAttempts >= MAX_BACKOFF_ATTEMPTS && !isInRecoveryMode) {
  isInRecoveryMode = true;
  currentBackoffIntervalMs = INITIAL_BACKOFF_MS;
  options.onEvent?.({ type: 'entering-recovery-mode' });
}
```

### P2-2: Inconsistent Error Propagation in Bridge API
**File:** `apps/local-server/src/routes/bridge-api.ts`
**Lines:** Multiple (1642-1736 snapshot hydration)

**Issue:** Snapshot hydration errors are silently caught with empty `catch {}` blocks:
```typescript
try { workbuddyExecution.hydrateTask(t); } catch { /* skip bad record */ }
```

**Impact:** Data corruption may go unnoticed. No metrics on hydration failures.

**Recommendation:** Log and track hydration failures:
```typescript
let hydrationErrors = 0;
for (const t of read.snapshot.workbuddyTasks ?? []) {
  try { workbuddyExecution.hydrateTask(t); }
  catch (err) {
    hydrationErrors++;
    console.warn('[BridgeRuntime] Failed to hydrate task:', err);
  }
}
```

### P2-3: Missing Input Length Limits Before Executor Execution
**File:** `apps/local-server/src/execution/execution-dispatcher.ts`
**Affected:** `dispatch()` method

**Issue:** The `prompt` field in `TaskDescriptor` has no length validation before being passed to executors.

**Impact:** Large prompts could cause memory issues or timeout downstream executors.

**Recommendation:** Add length validation:
```typescript
const MAX_PROMPT_LENGTH = 100_000; // 100KB
if (task.prompt.length > MAX_PROMPT_LENGTH) {
  return { ok: false, executorId: 'none', result: { ok: false, ..., failureReason: 'prompt-too-large' } };
}
```

### P2-4: ExecutorRegistry Singleton Cannot Be Reset
**File:** `apps/local-server/src/execution/executor-registry.ts`
**Lines:** 332-344

**Issue:** Global singleton pattern prevents runtime reconfiguration or testing without process restart.

**Impact:** Difficult to test executor selection logic. Cannot hot-reload executor configurations.

**Recommendation:** Consider dependency injection pattern instead of global singleton:
```typescript
// Instead of getExecutorRegistry() singleton
export function createExecutorRegistry(options?: ExecutorRegistryOptions): ExecutorRegistry {
  return new ExecutorRegistry(options);
}
```

---

## Summary

| ID | Severity | File | Issue |
|----|----------|------|-------|
| P0-1 | Critical | command-backend.ts | Shell metacharacter injection |
| P1-1 | High | goal-automation-loop.ts | Silent error swallowing |
| P1-2 | High | workbuddy-execution-adapter.ts | Missing operation timeouts |
| P1-3 | High | Multiple | No structured logging |
| P2-1 | Medium | source-relay-poller.ts | Backoff no auto-recovery |
| P2-2 | Medium | bridge-api.ts | Silent hydration failures |
| P2-3 | Medium | execution-dispatcher.ts | No prompt length limits |
| P2-4 | Medium | executor-registry.ts | Singleton immutability |
