# Prioritized Improvement List

## Priority 1: Authentication & Authorization

### 1.1 Centralized Auth Middleware
**Effort:** High  
**Impact:** Critical  
**Files:** `apps/local-server/src/routes/bridge-api.ts`

Add authentication middleware that runs before route handling:
```typescript
// Suggested implementation
const AUTH_REQUIRED_ROUTES = new Set([
  '/bridge/goals',
  '/bridge/projects',  // Most project routes
  '/bridge/execution-proposals',
  '/bridge/automation',
]);

function requireAuth(pathname: string, authContext?: BridgeAuthContext): BridgeResult | null {
  if (AUTH_REQUIRED_ROUTES.has(pathname) || pathname.startsWith('/bridge/projects/')) {
    if (!authContext) return error(401, 'Authentication required');
    // Additional kind checks per route...
  }
  return null; // Auth not required
}
```

### 1.2 Add Auth to Conversation Messages
**Effort:** Low  
**Impact:** High  
**Files:** `apps/local-server/src/routes/bridge-api.ts:3869`

Add auth check after line 3869:
```typescript
if (method === 'POST') {
  if (authContext?.kind !== 'console-cookie' && authContext?.kind !== 'pairing-token') {
    return error(403, 'Conversation requires authentication');
  }
  // ... existing validation
}
```

---

## Priority 2: Concurrency Safety

### 2.1 Add Mutex for Goal State Transitions
**Effort:** High  
**Impact:** High  
**Files:** `apps/local-server/src/goal/goal-orchestrator.ts`

Implement optimistic locking or mutex for goal advancement:
```typescript
// Option A: Mutex approach
import { Mutex } from 'async-mutex';

class GoalOrchestrator {
  private advanceMutex = new Mutex();
  
  async advance(goalId: string, options?: {...}): Promise<AdvanceResult> {
    return this.advanceMutex.runExclusive(async () => {
      // Existing advance logic
    });
  }
}
```

### 2.2 Add Version Field to Goal/Plan
**Effort:** Medium  
**Impact:** Medium  
**Files:** `packages/shared/src/types.ts`

Add optimistic locking:
```typescript
interface Goal {
  id: string;
  version: number;  // Increment on each update
  // ...
}

interface AdvanceOptions {
  expectedVersion: number;
}
```

### 2.3 Synchronize ExecutionStats Map
**Effort:** Low  
**Impact:** Medium  
**Files:** `apps/local-server/src/execution/execution-dispatcher-v2.ts:68-73`

Use a thread-safe approach or add mutex:
```typescript
private readonly executionStats = new Map<string, {...}>();
private statsMutex = new Mutex();
```

---

## Priority 3: Data Privacy

### 3.1 Redact rawProviderOutput
**Effort:** Low  
**Impact:** High  
**Files:** `apps/local-server/src/routes/bridge-api.ts:901-903`

Change:
```typescript
if (body.rawProviderOutput !== undefined && typeof body.rawProviderOutput === 'string') {
  const redacted = redactSensitiveContent(body.rawProviderOutput);
  artifact.rawProviderOutput = redacted.processedContent;
  if (redacted.redactionApplied) {
    artifact.redactionApplied = true;
  }
}
```

### 3.2 Add Comprehensive Secret Detection
**Effort:** Medium  
**Impact:** High  
**Files:** `apps/local-server/src/security/redaction.ts`

Add patterns for:
- JWT tokens
- Database connection strings
- Cloud provider credentials
- SSH private keys

### 3.3 Audit Log Integrity Protection
**Effort:** High  
**Impact:** Medium  
**Files:** `apps/local-server/src/storage/audit-log.ts`

Add HMAC signature to audit entries:
```typescript
interface AuditEvent {
  id: string;
  // ... existing fields
  integrityHash?: string;
}

function computeIntegrityHash(event: AuditEvent): string {
  const data = JSON.stringify({...event, integrityHash: undefined});
  return crypto.createHmac('sha256', process.env.AUDIT_SECRET!)
    .update(data).digest('hex');
}
```

---

## Priority 4: Input Validation

### 4.1 Validate workingDirectory in Executors
**Effort:** Medium  
**Impact:** High  
**Files:** 
- `apps/local-server/src/execution/opencode-executor.ts`
- `apps/local-server/src/execution/workbuddy-executor.ts`

Add validation:
```typescript
function validateWorkingDirectory(cwd: string, allowedRoots: string[]): boolean {
  const resolved = path.resolve(cwd);
  return allowedRoots.some(root => resolved.startsWith(root));
}
```

### 4.2 Add Schema Validation for All Artifacts
**Effort:** Medium  
**Impact:** Medium  
**Files:** `apps/local-server/src/routes/bridge-api.ts`

Create artifact schema validator and run all artifact fields through it.

### 4.3 Normalize All User Input Paths
**Effort:** Low  
**Impact:** Medium  
**Files:** Multiple

Use `path.normalize()` on all file paths before processing.

---

## Priority 5: Error Handling

### 5.1 Add Global Async Error Handler
**Effort:** Low  
**Impact:** High  
**Files:** `apps/local-server/src/server.ts`

```typescript
process.on('unhandledRejection', (reason, promise) => {
  console.error('[Unhandled Rejection]', reason);
  // Send alert, log to monitoring
});
```

### 5.2 Wrap Source Adapter Calls
**Effort:** Low  
**Impact:** Medium  
**Files:** `apps/local-server/src/routes/bridge-api.ts:3981-3994`

Add timeout wrapper:
```typescript
const TIMEOUT_MS = 30_000;

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  errorMessage: string
): Promise<T> {
  const timeout = new Promise<T>((_, reject) => 
    setTimeout(() => reject(new Error(errorMessage)), timeoutMs)
  );
  return Promise.race([promise, timeout]);
}
```

### 5.3 Add Circuit Breaker for External Calls
**Effort:** Medium  
**Impact:** Medium  
**Files:** `apps/local-server/src/verification/profile-runner.ts`

Protect against cascading failures from GitHub API, model providers, etc.

---

## Priority 6: Resource Management

### 6.1 Clean Up ChatGPT Web Timers
**Effort:** Medium  
**Impact:** Medium  
**Files:** `apps/local-server/src/routes/bridge-api.ts`

Track timers and clear on completion:
```typescript
const pendingTimers = new Map<string, ReturnType<typeof setTimeout>>();

function scheduleChatGptWebSourceTimeout(...) {
  const timer = setTimeout(() => {...}, timeoutMs);
  pendingTimers.set(requestId, timer);
}

function clearChatGptWebTimeout(requestId: string) {
  const timer = pendingTimers.get(requestId);
  if (timer) {
    clearTimeout(timer);
    pendingTimers.delete(requestId);
  }
}
```

### 6.2 Reduce Rate Limiter Cleanup Interval
**Effort:** Low  
**Impact:** Low  
**Files:** `apps/local-server/src/security/rate-limiter.ts`

Change cleanup interval from 60s to 10s.

### 6.3 Add Memory Monitoring
**Effort:** Low  
**Impact:** Low  
**Files:** `apps/local-server/src/server.ts`

Add periodic memory usage logging and alerts.

---

## Priority 7: Testing

### 7.1 Add Fuzz Testing for Input Validation
**Effort:** Medium  
**Impact:** High  
**Files:** `tests/e2e/`

Create fuzz tests for:
- Malformed JSON bodies
- Invalid project keys
- Path traversal attempts
- Injection attempts

### 7.2 Add Concurrency Stress Tests
**Effort:** Medium  
**Impact:** High  
**Files:** `tests/e2e/`

Test concurrent goal advancement, plan approvals, etc.

### 7.3 Add Security Test Suite
**Effort:** Medium  
**Impact:** High  
**Files:** `tests/e2e/`

Test authentication bypass attempts, rate limit bypass, etc.

---

## Priority 8: Documentation

### 8.1 Document Security Model
**Effort:** Low  
**Impact:** Medium  
**Files:** `docs/security-model.md`

Document:
- Authentication flow
- Authorization model
- Threat model
- Known limitations

### 8.2 Document Error Codes
**Effort:** Low  
**Impact:** Low  
**Files:** `docs/error-codes.md`

Create comprehensive error code documentation.

---

## Time Estimates

| Priority | Task | Estimated Hours |
|----------|------|-----------------|
| 1 | Centralized Auth Middleware | 8 |
| 1 | Add Auth to Conversation Messages | 2 |
| 2 | Goal State Mutex | 6 |
| 2 | ExecutionStats Synchronization | 2 |
| 3 | Redact rawProviderOutput | 1 |
| 3 | Audit Log Integrity | 8 |
| 4 | workingDirectory Validation | 4 |
| 5 | Global Error Handler | 1 |
| 5 | Source Adapter Timeout | 2 |
| 6 | Timer Cleanup | 4 |
| 7 | Security Test Suite | 16 |
| 8 | Security Documentation | 4 |

**Total Estimated: ~58 hours**
