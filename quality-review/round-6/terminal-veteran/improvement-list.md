# Terminal Veteran Review: Improvement List

## Error Handling Improvements

### EH-1: Windows-Compatible Process Termination
**Priority**: P0
**Files**: `command-backend.ts`
**Current**: Uses `child.kill('SIGTERM')` and `child.kill('SIGKILL')`
**Proposed**:
```typescript
const terminate = () => {
  if (process.platform === 'win32') {
    // Windows: use taskkill or just destroy
    child.kill();
  } else {
    child.kill('SIGTERM');
    setTimeout(() => {
      if (!child.killed) child.kill('SIGKILL');
    }, 2000);
  }
};
```

---

### EH-2: Argument Validation
**Priority**: P0
**Files**: `command-backend.ts`
**Current**: No argument validation after `parseArgv()`
**Proposed**:
```typescript
const MAX_ARG_COUNT = 20;
const MAX_ARG_LENGTH = 4096;

if (argv.length > MAX_ARG_COUNT) {
  return { ok: false, failureReason: `Too many arguments (max ${MAX_ARG_COUNT})` };
}
for (const arg of argv.slice(1)) {
  if (arg.length > MAX_ARG_LENGTH) {
    return { ok: false, failureReason: `Argument too long (max ${MAX_ARG_LENGTH})` };
  }
}
```

---

### EH-3: Child Process Exit Handler
**Priority**: P2
**Files**: `command-backend.ts`
**Current**: Only `close` event handler
**Proposed**: Add exit handler:
```typescript
child.on('exit', (code, signal) => {
  // Log unexpected exits
  console.warn(`[CommandBackend] Process exited unexpectedly: code=${code} signal=${signal}`);
});
```

---

### EH-4: Structured Error Response Pattern
**Priority**: P1
**Files**: `goal-loop-routes.ts`
**Current**: `parseJsonBody` returns `null` on error
**Proposed**: Use Result pattern:
```typescript
type ParseResult<T> = { ok: true; data: T } | { ok: false; error: string };
async function parseJsonBody<T>(...): Promise<ParseResult<T>>
```

---

### EH-5: Retry Logic for Transient Failures
**Priority**: P2
**Files**: `server.ts`, `bridge-api.ts`
**Current**: No retry on transient failures
**Proposed**: Add exponential backoff for:
- Network failures
- Persistence write failures
- External service timeouts

---

## Logging Improvements

### LOG-1: Structured Logger Interface
**Priority**: P1
**Files**: All server files
**Current**: Raw `console.log/warn/error`
**Proposed**:
```typescript
interface LogEntry {
  level: 'debug' | 'info' | 'warn' | 'error';
  timestamp: string;
  correlationId?: string;
  component: string;
  message: string;
  context?: Record<string, unknown>;
}
```

---

### LOG-2: Request Correlation IDs
**Priority**: P1
**Files**: `server.ts`, `bridge-api.ts`
**Current**: No request-scoped tracing
**Proposed**: Generate UUID at request start, propagate through all operations:
```typescript
const correlationId = randomUUID();
console.info({ correlationId, path, method }, 'Request started');
```

---

### LOG-3: Command Execution Audit Trail
**Priority**: P1
**Files**: `command-backend.ts`
**Current**: No audit logging of executions
**Proposed**:
```typescript
// Log every execution attempt
auditLog.createAndAppend({
  type: 'command_execution',
  source: 'command-backend',
  target: command,
  result: { ok, exitCode, failureReason },
  metadata: { argv, durationMs, outputSize: stdout.length + stderr.length }
});
```

---

### LOG-4: Log Sampling for High-Volume Paths
**Priority**: P2
**Files**: `bridge-api.ts`
**Current**: Logs on every heartbeat/metrics request
**Proposed**: Sample 1% of high-volume paths:
```typescript
if (isHighVolumePath(pathname) && Math.random() > 0.01) return;
// Only log 1% of high-volume requests
```

---

## Graceful Degradation Improvements

### GD-1: Graceful Shutdown Handler
**Priority**: P1
**Files**: `server.ts`
**Current**: No shutdown handling
**Proposed**:
```typescript
const shutdown = async (signal: string) => {
  console.info(`Received ${signal}, starting graceful shutdown...`);
  server.close();
  
  // Wait for active requests (max 30s)
  await new Promise(resolve => setTimeout(resolve, 30_000));
  
  // Persist state
  runtime.persist();
  
  process.exit(0);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
```

---

### GD-2: Circuit Breaker Pattern
**Priority**: P2
**Files**: `server.ts`
**Current**: No circuit breaker
**Proposed**:
```typescript
interface CircuitBreaker {
  failures: number;
  lastFailure: number;
  state: 'closed' | 'open' | 'half-open';
  threshold: number;
  resetTimeout: number;
}
```

---

### GD-3: Persistence Failure Pre-check
**Priority**: P1
**Files**: `bridge-api.ts`
**Current**: Check at request start only
**Proposed**: Check before all write operations:
```typescript
function safePersist(runtime: BridgeRuntime): void {
  if (runtime.getPersistenceFailure()) {
    throw new Error('Persistence unavailable');
  }
  runtime.persist();
}
```

---

### GD-4: Fallback for External Service Failures
**Priority**: P2
**Files**: `bridge-api.ts`
**Current**: Direct errors on GitHub checks failure
**Proposed**: Cache last successful result, serve on failure:
```typescript
const cacheKey = `github-checks:${projectKey}:${ref}`;
const cached = cache.get(cacheKey);
if (!result.ok && cached) {
  return ok({ ...cached, stale: true });
}
```

---

## Security Improvements

### SEC-1: Remove unsafe-inline from CSP
**Priority**: P2
**Files**: `server.ts`
**Current**: `'unsafe-inline'` in script-src
**Proposed**: Use nonce-based CSP:
```typescript
const nonce = crypto.randomBytes(16).toString('base64');
'Content-Security-Policy': `script-src 'self' 'nonce-${nonce}';`
// Add nonce to inline scripts
```

---

### SEC-2: Working Directory Validation
**Priority**: P1
**Files**: `command-backend.ts`
**Current**: No directory validation
**Proposed**:
```typescript
import { existsSync } from 'node:fs';
const workDir = task.workingDirectory ? resolve(task.workingDirectory) : cwd;
if (!existsSync(workDir)) {
  return { ok: false, failureReason: 'Working directory does not exist' };
}
// Optional: restrict to allowed paths
```

---

### SEC-3: Command Execution Rate Limiting
**Priority**: P1
**Files**: `command-backend.ts`
**Current**: No per-command rate limiting
**Proposed**: Track execution counts per command:
```typescript
const executionCounts = new Map<string, { count: number; resetAt: number }>();
// Reject if command exceeds rate limit
```

---

### SEC-4: Audit Log for Auth Failures
**Priority**: P2
**Files**: `server.ts`, `bridge-api.ts`
**Current**: Failed auth only returns error
**Proposed**: Log all auth failures with client IP:
```typescript
if (!authContext) {
  auditLog.createAndAppend({
    type: 'auth_failure',
    source: clientIp,
    result: { ok: false }
  });
}
```

---

### SEC-5: Input Sanitization for Display
**Priority**: P2
**Files**: `bridge-api.ts`
**Current**: User input may be displayed without sanitization
**Proposed**: Sanitize all user-controlled strings before storage/display:
```typescript
function sanitizeForDisplay(str: string): string {
  return str.replace(/[<>&"']/g, c => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;',
    '"': '&quot;', "'": '&#39;'
  }[c]));
}
```

---

## Testing Improvements

### TEST-1: Windows CI Environment
**Priority**: P0
**Files**: CI configuration
**Current**: Likely Unix-only CI
**Proposed**: Add Windows CI job to catch signal-related issues

---

### TEST-2: Command Backend Integration Tests
**Priority**: P1
**Files**: Tests
**Current**: No dedicated command-backend tests
**Proposed**:
- Test allowlist enforcement
- Test shell metacharacter blocking
- Test timeout behavior
- Test output cap enforcement
- Test Windows path handling

---

### TEST-3: Chaos Testing
**Priority**: P2
**Files**: Tests
**Current**: No chaos testing
**Proposed**: Test behavior under:
- Network interruption
- Disk full conditions
- Memory pressure
- Process kill scenarios
