# Quality Breaker Review - Improvement List

## Prioritized Improvements (P0 -> P1 -> P2)

---

## P0 Improvements - Critical (Fix Before Production)

### P0-1: Race Condition - Make ChatGPT Queue ClaimNext Atomic
**Priority**: CRITICAL
**File**: `apps/local-server/src/conversation/chatgpt-web-source-adapter.ts`
**Lines**: 151-157

**Current Code**:
```typescript
claimNext(): ChatGptSourceRequest | undefined {
  for (const req of this.requests.values()) {
    if (req.status !== 'pending') continue;
    return this.claim(req.id);  // NOT ATOMIC
  }
  return undefined;
}
```

**Required Fix**:
```typescript
claimNext(): ChatGptSourceRequest | undefined {
  for (const req of this.requests.values()) {
    if (req.status !== 'pending') continue;
    // Atomic compare-and-swap
    const current = this.requests.get(req.id);
    if (current && current.status === 'pending') {
      const updated: ChatGptSourceRequest = {
        ...current,
        status: 'claimed',
        claimedAt: Date.now(),
      };
      this.requests.set(req.id, updated);
      // Track metrics
      this.claimTimestamps.push(updated.claimedAt);
      if (this.claimTimestamps.length > MAX_SAMPLE_SIZE) {
        this.claimTimestamps.shift();
      }
      return clone(updated);
    }
  }
  return undefined;
}
```

---

### P0-2: Timeout Memory Leak - Clear Bridge Timeout on All Paths
**Priority**: CRITICAL
**File**: `apps/local-server/src/server.ts`
**Lines**: 369-391

**Required Fix**: Always clear both timeouts before any response:

```typescript
handleBridgeRequest(bridgeRuntime, method, pathname, request, url.searchParams, authContext)
  .then((result) => {
    clearTimeout(bridgeTimeout);
    clearTimeout(requestTimeout);
    if (sourceRelayPath) {
      recordSourceRelayBridgeRequest(url.pathname, { resultStatus: result.statusCode });
    }
    writeBridgeResult(result, response);
  })
  .catch((err) => {
    clearTimeout(bridgeTimeout);
    clearTimeout(requestTimeout);
    console.error('[Server] Bridge request error:', err);
    writeJson(500, { status: 'error', code: 'INTERNAL_ERROR', message: 'Internal bridge error' }, response);
  });
```

Also add at the end of the async handler:
```typescript
} catch (err) {
  clearTimeout(requestTimeout);
  clearTimeout(bridgeTimeout);  // ADD THIS
  // ... rest of catch
}
```

---

### P0-3: X-Forwarded-For Validation
**Priority**: CRITICAL
**File**: `apps/local-server/src/security/rate-limiter.ts`
**Lines**: 41-66

**Required Fix**: Do not trust X-Forwarded-For without verification:

```typescript
getClientIp(directIp: string, xForwardedFor?: string | null): string {
  // SECURITY: Never trust X-Forwarded-For from direct connections
  // Only use it if request comes from a known trusted proxy
  // For localhost development, validate the first IP is reasonable
  if (xForwardedFor && directIp === '127.0.0.1') {
    const firstIp = xForwardedFor.split(',')[0].trim();
    // Validate IP format before using
    if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(firstIp)) {
      return firstIp;
    }
  }
  return directIp;
}
```

**Server-side fix** (server.ts:260-262):
```typescript
// SECURITY: Only trust X-Forwarded-For from localhost proxy
const clientIp = (request.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim();
const useXff = clientIp && directIp === '127.0.0.1';
const ip = useXff ? clientIp : directIp;
```

---

### P0-4: Snapshot Hydration Fail-Closed
**Priority**: CRITICAL
**File**: `apps/local-server/src/routes/bridge-api.ts`
**Lines**: 1667-1735

**Required Fix**: Fail-closed hydration:

```typescript
if (read.ok && read.snapshot) {
  const errors: string[] = [];
  
  // Hydrate with validation
  try {
    packetStore.hydratePackets(read.snapshot.packets);
  } catch (e) {
    errors.push(`packets: ${e.message}`);
  }
  
  try {
    auditLog.hydrateEvents(read.snapshot.auditEvents);
  } catch (e) {
    errors.push(`auditEvents: ${e.message}`);
  }
  
  // ... other stores ...
  
  // If any errors, fail startup
  if (errors.length > 0) {
    throw new Error(`Snapshot hydration failed: ${errors.join('; ')}`);
  }
}
```

---

### P0-5: Nonce Input Validation
**Priority**: CRITICAL
**File**: `apps/local-server/src/server.ts`
**Lines**: 410-423

**Required Fix**:
```typescript
request.on('end', () => {
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString());
    const nonce = body.nonce;
    if (typeof nonce !== 'string') {
      writeJson(400, { status: 'error', code: 'INVALID_REQUEST', message: 'nonce must be a string' }, response);
      return;
    }
    if (nonce.length < 32 || nonce.length > 128) {
      writeJson(400, { status: 'error', code: 'INVALID_REQUEST', message: 'nonce must be 32-128 characters' }, response);
      return;
    }
    // Validate hex characters only
    if (!/^[a-f0-9]+$/i.test(nonce)) {
      writeJson(400, { status: 'error', code: 'INVALID_REQUEST', message: 'nonce must be hex characters' }, response);
      return;
    }
    const result = autoPairStore.claimExtensionSession(nonce);
    if (!result.ok) {
      writeJson(409, { status: 'error', code: 'CLAIM_FAILED', message: result.message }, response);
      return;
    }
    writeJson(200, { extensionSessionToken: result.extensionSessionToken }, response);
  } catch (err) {
    console.error('[Server] Extension claim error:', err);
    writeJson(400, { status: 'error', code: 'INVALID_REQUEST', message: 'Invalid request body' }, response);
  }
});
```

---

### P0-6: Pairing Token Not Logged
**Priority**: CRITICAL
**File**: `apps/local-server/src/server.ts`
**Lines**: 499-500

**Required Fix**: Remove token logging entirely:
```typescript
// REMOVE THIS:
// const maskedToken = handle.pairingToken.slice(0, 8) + '****';
// console.log(`Pairing token: ${maskedToken}`);

// Instead, log a non-sensitive reference:
// console.log(`Pairing token configured (use console UI to view)`);
```

Or use a hash:
```typescript
const tokenHash = createHash('sha256').update(handle.pairingToken).digest('hex').slice(0, 8);
console.log(`Pairing token hash: ${tokenHash}`);
```

---

### P0-7: CSRF Protection for Console Endpoints
**Priority**: CRITICAL
**File**: `apps/local-server/src/server.ts`
**Lines**: 296-321

**Required Fix**: Add CSRF tokens:
```typescript
// Generate CSRF token
import { randomBytes } from 'node:crypto';

function generateCsrfToken(): string {
  return randomBytes(32).toString('hex');
}

// In console session creation:
const csrfToken = generateCsrfToken();
const session = autoPairStore.createConsoleSession();
response.setHeader('set-cookie', [
  `cli_bridge_console_session=${session.consoleSessionToken}; HttpOnly; SameSite=Strict; Path=/`,
  `csrf_token=${csrfToken}; HttpOnly; SameSite=Strict; Path=/`,
]);
```

And validate CSRF on state-changing operations.

---

### P0-8: Atomic Store Operations
**Priority**: CRITICAL
**File**: All stores
**Issue**: Operations across multiple stores not atomic

**Required Fix**: Implement write-ahead logging or use transactions:

```typescript
// Example: Transaction pattern
class Transaction {
  private operations: Array<() => void> = [];
  private rolledBack = false;

  add(operation: () => void) {
    this.operations.push(operation);
  }

  commit() {
    if (this.rolledBack) return;
    for (const op of this.operations) {
      op();
    }
  }

  rollback() {
    this.rolledBack = true;
    // Reverse operations if possible
  }
}
```

---

### P0-9: Handle Uncaught Errors in Request Handler
**Priority**: CRITICAL
**File**: `apps/local-server/src/server.ts`
**Lines**: 332-464

**Required Fix**:
```typescript
(async () => {
  try {
    // ... handlers
  } catch (err) {
    clearTimeout(requestTimeout);
    clearTimeout(bridgeTimeout);  // Clear ALL timeouts
    console.error('[Server] Unhandled request error:', err);
    if (!response.headersSent && !response.writableEnded) {
      writeJson(500, { status: 'error', code: 'INTERNAL_ERROR', message: 'Internal server error' }, response);
    }
    // Ensure response is ended
    if (!response.writableEnded) {
      response.end();
    }
  }
})();

// Also add unhandled rejection handler at process level:
process.on('unhandledRejection', (reason, promise) => {
  console.error('[Server] Unhandled Rejection:', reason);
});
```

---

## P1 Improvements - High Priority

### P1-1: Add Request Correlation IDs
**Priority**: HIGH
**Files**: Throughout

**Fix**: Add UUID to each request and propagate through all logs:
```typescript
const requestId = randomUUID();
request.headers['x-request-id'] = requestId;

// Log with request ID
console.log(`[${requestId}] Processing ${pathname}`);
```

### P1-2: Add Security Headers
**Priority**: HIGH
**File**: `apps/local-server/src/server.ts`

**Fix**: Add headers to all responses:
```typescript
response.setHeader('X-Content-Type-Options', 'nosniff');
response.setHeader('X-Frame-Options', 'DENY');
response.setHeader('Cache-Control', 'no-store');
```

### P1-3: Bound Metrics Arrays
**Priority**: HIGH
**File**: `apps/local-server/src/conversation/chatgpt-web-source-adapter.ts`

**Fix**: Enforce MAX_SAMPLE_SIZE:
```typescript
// Already has check but verify consistency
if (this.completionTimestamps.length >= MAX_SAMPLE_SIZE) {
  this.completionTimestamps.shift();
}
this.completionTimestamps.push(result.returnedAt);
```

### P1-4: Persistence Failure Circuit Breaker
**Priority**: HIGH
**File**: `apps/local-server/src/routes/bridge-api.ts`

**Fix**: Stop accepting mutations after persistence failure:
```typescript
const persist = (): void => {
  if (!snapshotStore) return;
  if (persistenceFailure) {
    throw new Error(`Persistence fault detected: ${persistenceFailure}`);
  }
  // ... rest
};
```

### P1-5: Cookie Secure Flag
**Priority**: HIGH
**File**: `apps/local-server/src/server.ts`

**Fix**: Add Secure flag when serving over HTTPS:
```typescript
const secure = process.env.HTTPS === 'true';
const cookieOptions = `HttpOnly; SameSite=Strict; Path=/${secure ? '; Secure' : ''}`;
response.setHeader('set-cookie', `cli_bridge_console_session=${token}; ${cookieOptions}`);
```

### P1-6: Audit Log Durability
**Priority**: HIGH
**File**: `apps/local-server/src/storage/audit-log.ts`

**Fix**: Write to disk immediately for critical events:
```typescript
// For security-sensitive events, flush immediately
if (event.type.startsWith('session_') || event.type.startsWith('auth_')) {
  await this.flushToDisk();
}
```

### P1-7: Thread-Safe In-Memory Stores
**Priority**: HIGH
**Files**: All InMemory*Store classes

**Fix**: Add mutex for concurrent access:
```typescript
import { Mutex } from 'async-mutex';

class InMemoryPacketStore {
  private mutex = new Mutex();
  
  async createPacket(...) {
    return this.mutex.runExclusive(() => {
      // existing logic
    });
  }
}
```

### P1-8: Input Validation Schema
**Priority**: HIGH
**Files**: `apps/local-server/src/routes/bridge-api.ts`

**Fix**: Use JSON Schema validation for all request bodies:
```typescript
import Ajv from 'ajv';

const ajv = new Ajv();
const packetSchema = {
  type: 'object',
  required: ['sessionId', 'content'],
  properties: {
    sessionId: { type: 'string', minLength: 1 },
    content: { type: 'string' }
  }
};

function validateBody(body: unknown, schema: object) {
  const validate = ajv.compile(schema);
  if (!validate(body)) {
    return { ok: false, errors: validate.errors };
  }
  return { ok: true };
}
```

---

## P2 Improvements - Medium Priority

### P2-1: Add Circuit Breaker for External Services
**Priority**: MEDIUM
**Files**: GitHub checks, verification profiles

### P2-2: Implement Health Checks for All Dependencies
**Priority**: MEDIUM
**Files**: Server startup

### P2-3: Add Request/Response Logging
**Priority**: MEDIUM
**Files**: Throughout

### P2-4: Implement Rate Limiter Persistence
**Priority**: MEDIUM
**Files**: `rate-limiter.ts`

### P2-5: Add Request Timeouts to All Async Operations
**Priority**: MEDIUM
**Files**: Throughout

### P2-6: Implement Proper Error Codes
**Priority**: MEDIUM
**Files**: Throughout

### P2-7: Add Metrics Export
**Priority**: MEDIUM
**Files**: Throughout

### P2-8: Implement Request Retries with Backoff
**Priority**: MEDIUM
**Files**: External API calls

### P2-9: Add Graceful Shutdown
**Priority**: MEDIUM
**Files**: `server.ts`

### P2-10: Implement Connection Pooling
**Priority**: MEDIUM
**Files**: Network operations

---

## Summary Table

| ID | Priority | Category | Estimated Effort |
|----|----------|----------|------------------|
| P0-1 | CRITICAL | Race Condition | Low |
| P0-2 | CRITICAL | Memory Leak | Low |
| P0-3 | CRITICAL | Security Bypass | Low |
| P0-4 | CRITICAL | Data Integrity | High |
| P0-5 | CRITICAL | Input Validation | Low |
| P0-6 | CRITICAL | Information Disclosure | Low |
| P0-7 | CRITICAL | CSRF | Medium |
| P0-8 | CRITICAL | Data Integrity | High |
| P0-9 | CRITICAL | Error Handling | Low |
| P1-1 | HIGH | Observability | Medium |
| P1-2 | HIGH | Security Headers | Low |
| P1-3 | HIGH | Memory Leak | Low |
| P1-4 | HIGH | Error Handling | Medium |
| P1-5 | HIGH | Security | Low |
| P1-6 | HIGH | Data Integrity | Medium |
| P1-7 | HIGH | Concurrency | High |
| P1-8 | HIGH | Input Validation | Medium |
| P2-1 to P2-10 | MEDIUM | Various | Various |

---

## Recommended Implementation Order

1. **Week 1**: Fix all P0 issues (Critical Path)
2. **Week 2**: Fix P1 observability and input validation
3. **Week 3**: Address P1 concurrency and data integrity
4. **Week 4**: P2 improvements and polish

---

## Notes

- All P0 fixes should have tests added
- Consider adding integration tests for race conditions
- Add chaos engineering tests for failure scenarios
- Document security assumptions in architecture docs
