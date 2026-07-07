# Terminal Veteran Review: Blockers

## P0 Critical - Must Fix

### P0-1: Windows Incompatibility - Signal-based Process Termination

**File**: `apps/local-server/src/workbuddy/command-backend.ts`
**Lines**: 132-136

**Issue**: The code uses Unix signals (`SIGTERM`, `SIGKILL`) for process termination, which are not supported by Windows `child_process.spawn()`.

```typescript
const timer = setTimeout(() => {
  timedOut = true;
  child.kill('SIGTERM');  // Unix only!
  setTimeout(() => {
    if (!child.killed) child.kill('SIGKILL');  // Unix only!
  }, 2000);
}, timeoutMs);
```

**Impact**: Timeout handling completely fails on Windows. Processes will run indefinitely.

**Fix Required**: Use `child.kill()` without signal argument (graceful terminate on Windows) or `taskkill /pid %pid% /T /F` on Windows.

---

### P0-2: Missing Argument Validation in Command Execution

**File**: `apps/local-server/src/workbuddy/command-backend.ts`
**Lines**: 86-106

**Issue**: After parsing `argv` from prompt, individual arguments have no length or count limits. An attacker with allowlist access could pass extremely long arguments.

```typescript
const argv = parseArgv(prompt);
// No validation: argv.length, argv[i].length
const command = argv[0];
if (!isAllowed(command)) { ... }
```

**Impact**: Potential for argument buffer overflow, resource exhaustion, or passing malformed data to commands.

**Fix Required**: Add validation:
- Max argument count (e.g., 20)
- Max argument length (e.g., 4096 chars)
- Reject arguments starting with `-` unless expected

---

## P1 High Priority - Should Fix

### P1-1: No Graceful Shutdown Handler

**File**: `apps/local-server/src/server.ts`

**Issue**: Server has no `SIGTERM`/`SIGINT` handlers. On shutdown, active requests are dropped and persistence may be incomplete.

**Impact**: Data loss on restart; active command executions abandoned.

**Fix Required**: Add shutdown handler that:
1. Stops accepting new connections
2. Waits for active requests to complete (with timeout)
3. Persists runtime state
4. Closes server

---

### P1-2: Incomplete Persistence Failure Checks

**File**: `apps/local-server/src/routes/bridge-api.ts`
**Lines**: 2617-2619

**Issue**: `getPersistenceFailure()` is checked at request start but not before write operations that could fail silently.

```typescript
if (runtime.getPersistenceFailure()) {
  return error(503, 'Runtime persistence fault; restart after repairing storage');
}
```

**Impact**: Subsequent `runtime.persist()` calls will throw but are not caught uniformly.

**Fix Required**: Wrap all `persist()` calls in try-catch or check failure state before operations.

---

### P1-3: Working Directory Not Validated

**File**: `apps/local-server/src/workbuddy/command-backend.ts`
**Lines**: 108-109

**Issue**: `workingDirectory` from task parameter is resolved but not validated for existence or safety.

```typescript
const workDir = task.workingDirectory ? resolve(task.workingDirectory) : cwd;
// No existence check: if (!existsSync(workDir)) ...
```

**Impact**: Execution in non-existent or unsafe directories.

**Fix Required**: Validate directory exists and is within allowed paths.

---

### P1-4: No Command Execution Audit Trail

**File**: `apps/local-server/src/workbuddy/command-backend.ts`

**Issue**: Each command execution should be logged to audit log for security accountability, but there's no such logging.

**Impact**: No forensic trail for command execution investigations.

**Fix Required**: Add `auditLog.createAndAppend()` entry for each execution with command, args, result, duration.

---

## P2 Medium Priority - Consider Fixing

### P2-1: Unsafe Content-Security-Policy

**File**: `apps/local-server/src/server.ts`
**Lines**: 313-319

**Issue**: CSP allows `'unsafe-inline'` which weakens XSS protection.

```typescript
'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; ..."
```

**Fix**: Use nonce-based CSP or remove `unsafe-inline` with hash-based allowances.

---

### P2-2: Missing Structured Logging

**File**: `apps/local-server/src/server.ts`, `command-backend.ts`

**Issue**: Uses raw `console.log/warn/error` without levels, correlation IDs, or structured fields.

**Fix**: Implement a logger interface with levels (debug/info/warn/error), correlation IDs, and JSON output option.

---

### P2-3: No Circuit Breaker Pattern

**File**: `apps/local-server/src/server.ts`

**Issue**: Failed operations do not trigger temporary disable of downstream services. Repeated failures will keep hammering unresponsive services.

**Fix**: Implement circuit breaker with threshold-based opening and time-based reset.

---

### P2-4: Rate Limiter No Retry-After Detail

**File**: `apps/local-server/src/server.ts`
**Lines**: 271-278

**Issue**: 429 response includes `Retry-After` header but no guidance on backoff strategy.

**Fix**: Document exponential backoff guidance or implement server-side backoff.

---

### P2-5: No Exit Event Handler for Child Process

**File**: `apps/local-server/src/workbuddy/command-backend.ts`

**Issue**: Missing `child.on('exit', ...)` handler; relies solely on `close` event.

**Fix**: Add exit handler to capture non-graceful terminations.

---

### P2-6: parseJsonBody Null Returns Not Uniformly Handled

**File**: `apps/local-server/src/routes/goal-loop-routes.ts`
**Lines**: 119-126

**Issue**: `parseJsonBody` returns `null` on timeout/error but callers may not check for null.

**Fix**: Throw typed errors or use Result pattern instead of null returns.
